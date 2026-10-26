"""
Semantic View Generator & Cortex Agent Auto-Creation.

Flow:
  1. User selects a gold-layer schema.
  2. The schema is introspected (tables, columns, profiled sample values) and the LLM decides how
     to split it into one or more SEMANTIC VIEWS — each view is an analytic subject area (a fact
     plus the dimensions it joins to), with its own dimensions, measures and relationships.
  3. The proposed views are shown in the UI, where they can be edited, removed, or added manually.
  4. Approving creates a real `CREATE OR REPLACE SEMANTIC VIEW` per view in Snowflake.
  5. A Cortex agent is created with one text-to-SQL tool per created view, plus a dedicated role
     that is granted exactly those views.
  6. The dashboard and the Analyst Agent chat both answer through those views.

This module and kpi_dashboard_service.py are the only cfo_analytics call sites allowed to use the
LLM, and only on explicit user-triggered actions (never on a dashboard page load).
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.db.document_store import DocumentStore
from app.db.models import SemanticModelModel
from app.modules.ai_governance import llm_client
from app.modules.ai_governance.snowflake_helpers import execute, safe_identifier

SAMPLE_ROWS = 50
MAX_TABLES = 40
MAX_VIEWS = 12

_STORE = DocumentStore(SemanticModelModel)

AGGREGATIONS = {"sum", "avg", "count", "count_distinct", "min", "max"}


# ---------------------------------------------------------------------------
# 1. Introspection
# ---------------------------------------------------------------------------

def _short(value: Any, limit: int = 100) -> Any:
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "…"
    return value


def _profile_values(values: List[Any]) -> Dict[str, Any]:
    non_null = [v for v in values if v is not None and v != ""]
    profile: Dict[str, Any] = {"non_null_ratio": round(len(non_null) / len(values), 2) if values else 0}
    hashable = sorted({json.dumps(v, default=str, sort_keys=True) for v in non_null})
    if non_null and len(hashable) <= 12:
        profile["distinct_values"] = [_short(json.loads(d)) for d in hashable]
    return profile


def classify_table_role(table_name: str, columns: List[str]) -> str:
    """A first-pass hint only — the LLM makes the real call and may override this."""
    lower = table_name.lower()
    if lower.startswith("dim_") or lower.startswith("dim"):
        return "dimension"
    if lower.startswith("fct_") or lower.startswith("fact_"):
        return "fact"
    if lower.startswith("mart_"):
        return "mart"

    fk_like = [c for c in columns if c.upper().endswith("_ID")]
    measure_like = [
        c for c in columns
        if any(w in c.upper() for w in ("AMOUNT", "TOTAL", "COUNT", "QTY", "QUANTITY", "REVENUE", "SCORE", "RATE"))
    ]
    if len(fk_like) >= 2 and measure_like:
        return "fact"
    if len(fk_like) <= 2 and not measure_like:
        return "dimension"
    return "fact" if measure_like else "dimension"


def introspect_gold_schema(conn, database: str, schema: str,
                           table_names: Optional[List[str]] = None) -> Dict[str, Any]:
    """Profile the objects a model should be built from.

    `table_names` limits the profile to an explicit user selection (tables and/or views). Without
    it the whole schema is profiled, capped at MAX_TABLES to bound the LLM prompt — that cap is a
    silent truncation on large schemas, which is exactly why the caller should let the user pick.
    """
    db = safe_identifier(database, "database")
    sch = safe_identifier(schema, "schema")
    wanted = {str(t).strip().upper() for t in (table_names or []) if str(t).strip()}
    cur = conn.cursor()
    try:
        cur.execute(f'USE DATABASE "{db}"')
        cur.execute(f'USE SCHEMA "{sch}"')

        objects: List[Dict[str, str]] = []
        for stmt, kind in (("SHOW TABLES", "TABLE"), ("SHOW VIEWS", "VIEW")):
            try:
                cur.execute(stmt)
                for r in cur.fetchall():
                    objects.append({"name": r[1], "kind": kind})
            except Exception:
                pass

        if wanted:
            # An explicit selection is already bounded by the user, so no truncation.
            objects = [o for o in objects if str(o["name"]).upper() in wanted]
        else:
            objects = objects[:MAX_TABLES]

        cur.execute(
            f'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM "{db}".INFORMATION_SCHEMA.COLUMNS '
            f"WHERE TABLE_SCHEMA = %s ORDER BY TABLE_NAME, ORDINAL_POSITION",
            (sch,),
        )
        columns_by_table: Dict[str, List[tuple]] = {}
        for table, column, dtype in cur.fetchall():
            columns_by_table.setdefault(table, []).append((column, dtype))

        tables_profile: Dict[str, Any] = {}
        for obj in objects:
            table = obj["name"]
            cols = columns_by_table.get(table, [])
            if not cols:
                continue
            col_names = [c[0] for c in cols]
            try:
                quoted = ", ".join(f'"{c}"' for c in col_names)
                cur.execute(f'SELECT {quoted} FROM "{db}"."{sch}"."{table}" LIMIT {SAMPLE_ROWS}')
                rows = cur.fetchall()
            except Exception:
                rows = []

            tables_profile[table] = {
                "kind": obj["kind"],
                "role_hint": classify_table_role(table, col_names),
                "columns": {
                    name: {"data_type": dtype, **_profile_values([r[i] for r in rows])}
                    for i, (name, dtype) in enumerate(cols)
                },
                "sample_rows": [{name: _short(r[i]) for i, (name, _d) in enumerate(cols)} for r in rows[:3]],
            }

        # Column-name overlap hints; the LLM decides the real relationships.
        hints: List[Dict[str, Any]] = []
        all_cols = {t: set(p["columns"].keys()) for t, p in tables_profile.items()}
        for table, cols in all_cols.items():
            for other, other_cols in all_cols.items():
                if other == table:
                    continue
                shared = [c for c in cols if c in other_cols and c.upper().endswith("_ID")]
                for join_col in shared:
                    hints.append({"from_table": table, "to_table": other, "join_column": join_col})

        return {"database": db, "schema": sch, "tables": tables_profile, "relationship_hints": hints}
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# 2. LLM proposal — the LLM decides how many views and what each covers
# ---------------------------------------------------------------------------

def _system_prompt(fq: str) -> str:
    return f"""You are a data architect designing Snowflake SEMANTIC VIEWS over the selected tables and views in {fq}.

You receive a profile of every table: columns with data types, profiled/sampled values, a naming-based
role hint, and column-overlap join hints. The hints are only hints — you decide the real roles and joins.

Split the schema into SEMANTIC VIEWS. Each view is one analytic subject area that a business user would
ask questions about: typically ONE fact/transaction table together with the dimension tables it joins to.
Do not put unrelated facts in the same view. Most schemas need 1-5 views; never more than {MAX_VIEWS}.

Return ONLY JSON:
{{
  "name": "short_snake_case_name_for_the_whole_model",
  "description": "one sentence about this schema",
  "views": [{{
    "view_name": "SV_UPPER_SNAKE_CASE",
    "description": "what business questions this view answers",
    "tables": [{{
      "name": "TABLE_NAME (must exist in the profile)",
      "role": "fact" | "dimension" | "mart",
      "description": "one sentence",
      "dimensions": [{{"name": "snake_case", "expr": "COLUMN_NAME", "description": "...",
                        "data_type": "...", "synonyms": ["..."], "confidence": "high"|"low"}}],
      "time_dimensions": [{{"name": "snake_case", "expr": "COLUMN_NAME", "description": "...",
                             "data_type": "...", "confidence": "high"|"low"}}],
      "measures": [{{"name": "snake_case", "expr": "COLUMN_NAME", "description": "...",
                      "default_aggregation": one of {sorted(AGGREGATIONS)}, "data_type": "...",
                      "synonyms": ["..."], "confidence": "high"|"low"}}],
      "relationships": [{{"to_table": "TABLE_IN_THE_SAME_VIEW", "join_column": "COLUMN_NAME",
                           "cardinality": "many_to_one"|"one_to_one"|"many_to_many",
                           "confidence": "high"|"low"}}]
    }}]
  }}]
}}

Rules:
- Only reference tables and columns that exist in the profile.
- A relationship may only point at a table included in the SAME view.
- Numeric, non-key columns on fact/mart tables become measures; pick the aggregation that will not
  double-count (a column that is already a rate/percentage/average must not be summed).
- ID / code / status / name columns become dimensions. The main date column becomes a time_dimension.
- Add synonyms a business user would actually say ("revenue" for an amount column).
- Mark confidence "low" on anything ambiguous — a human reviews those before the view is created."""


# ---------------------------------------------------------------------------
# 3. Normalization
# ---------------------------------------------------------------------------

def _norm_name(raw: str, limit: int = 60) -> str:
    return re.sub(r"[^a-z0-9_]", "_", str(raw or "").strip().lower()).strip("_")[:limit]


def _norm_view_name(raw: str) -> str:
    name = re.sub(r"[^A-Za-z0-9_]", "_", str(raw or "").strip().upper()).strip("_")[:100]
    if not name:
        name = "SV_VIEW"
    return name if name.startswith("SV_") else f"SV_{name}"


def _normalize_field(raw: Dict[str, Any], kind: str) -> Optional[Dict[str, Any]]:
    name = _norm_name(raw.get("name"))
    expr = str(raw.get("expr") or "").strip().upper()
    if not name or not expr:
        return None
    field = {
        "name": name,
        "expr": expr,
        "description": str(raw.get("description") or "")[:500],
        "data_type": str(raw.get("data_type") or "")[:40],
        "synonyms": [str(s)[:60] for s in (raw.get("synonyms") or []) if str(s).strip()][:10],
        "confidence": "low" if str(raw.get("confidence") or "").lower() == "low" else "high",
    }
    if kind == "measure":
        agg = str(raw.get("default_aggregation") or "sum").lower()
        field["default_aggregation"] = agg if agg in AGGREGATIONS else "sum"
    return field


def _normalize_tables(raw_tables: Any, known_tables: Dict[str, Any]) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []
    for raw in raw_tables or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip().upper()
        if name not in known_tables:
            continue  # never let the LLM invent a table
        profile_cols = {c.upper() for c in known_tables[name]["columns"]}

        def keep(field: Optional[Dict[str, Any]]) -> bool:
            return bool(field and field["expr"].split("(")[-1].strip(") ").upper() in profile_cols)

        role = str(raw.get("role") or "").lower()
        if role not in ("fact", "dimension", "mart"):
            role = known_tables[name].get("role_hint", "dimension")

        tables.append({
            "name": name,
            "role": role,
            "description": str(raw.get("description") or "")[:500],
            "dimensions": [f for f in (_normalize_field(r, "dimension") for r in raw.get("dimensions") or [] if isinstance(r, dict)) if keep(f)],
            "time_dimensions": [f for f in (_normalize_field(r, "time") for r in raw.get("time_dimensions") or [] if isinstance(r, dict)) if keep(f)],
            "measures": [f for f in (_normalize_field(r, "measure") for r in raw.get("measures") or [] if isinstance(r, dict)) if keep(f)],
            "relationships": [],
            "_raw_relationships": raw.get("relationships") or [],
        })

    names_in_view = {t["name"] for t in tables}
    for t in tables:
        rels = []
        for r in t.pop("_raw_relationships"):
            if not isinstance(r, dict):
                continue
            to_table = str(r.get("to_table") or "").strip().upper()
            join_col = str(r.get("join_column") or "").strip().upper()
            if to_table not in names_in_view or to_table == t["name"] or not join_col:
                continue
            cardinality = str(r.get("cardinality") or "many_to_one").lower()
            if cardinality not in ("many_to_one", "one_to_one", "many_to_many"):
                cardinality = "many_to_one"
            rels.append({
                "to_table": to_table, "join_column": join_col, "cardinality": cardinality,
                "confidence": "low" if str(r.get("confidence") or "").lower() == "low" else "high",
            })
        t["relationships"] = rels
    return tables


def _normalize_views(proposal: Dict[str, Any], known_tables: Dict[str, Any]) -> List[Dict[str, Any]]:
    views: List[Dict[str, Any]] = []
    seen = set()
    for raw in (proposal.get("views") or [])[:MAX_VIEWS]:
        if not isinstance(raw, dict):
            continue
        tables = _normalize_tables(raw.get("tables"), known_tables)
        if not tables:
            continue
        name = _norm_view_name(raw.get("view_name") or raw.get("name"))
        if name in seen:
            name = f"{name}_{len(views) + 1}"
        seen.add(name)
        views.append({
            "view_name": name,
            "description": str(raw.get("description") or "")[:500],
            "tables": tables,
            "source": "ai",
            "status": "draft",
            "fq_name": None,
            "ddl": None,
            "error": None,
        })
    return views


def _heuristic_views(profile: Dict[str, Any]) -> Dict[str, Any]:
    """No-LLM fallback: one view per fact table plus the dimensions it joins to."""
    tables_profile = profile["tables"]
    hints = profile["relationship_hints"]

    def build_table(name: str) -> Dict[str, Any]:
        tp = tables_profile[name]
        dims, time_dims, measures = [], [], []
        for col, cp in tp["columns"].items():
            dtype = str(cp.get("data_type") or "").upper()
            entry = {"name": _norm_name(col), "expr": col, "description": "", "data_type": dtype,
                     "synonyms": [], "confidence": "low"}
            if any(t in dtype for t in ("DATE", "TIME")) and not time_dims:
                time_dims.append(entry)
            elif any(t in dtype for t in ("NUMBER", "INT", "FLOAT", "DECIMAL", "DOUBLE")) \
                    and tp["role_hint"] in ("fact", "mart") and not col.upper().endswith("_ID"):
                measures.append({**entry, "default_aggregation": "sum"})
            else:
                dims.append(entry)
        return {"name": name, "role": tp["role_hint"], "description": "",
                "dimensions": dims, "time_dimensions": time_dims, "measures": measures, "relationships": []}

    facts = [n for n, p in tables_profile.items() if p["role_hint"] in ("fact", "mart")]
    views = []
    for fact in facts[:MAX_VIEWS]:
        related = [h["to_table"] for h in hints
                   if h["from_table"] == fact and tables_profile.get(h["to_table"], {}).get("role_hint") == "dimension"]
        members = [fact] + sorted(set(related))
        tables = [build_table(n) for n in members if n in tables_profile]
        fact_tbl = next((t for t in tables if t["name"] == fact), None)
        if fact_tbl:
            fact_tbl["relationships"] = [
                {"to_table": h["to_table"], "join_column": h["join_column"], "cardinality": "many_to_one",
                 "confidence": "low"}
                for h in hints if h["from_table"] == fact and h["to_table"] in members
            ]
        views.append({
            "view_name": _norm_view_name(fact),
            "description": f"Analytics over {fact}.",
            "tables": tables, "source": "ai", "status": "draft",
            "fq_name": None, "ddl": None, "error": None,
        })

    if not views and tables_profile:
        views = [{
            "view_name": _norm_view_name(profile["schema"]),
            "description": f"All objects in {profile['database']}.{profile['schema']}.",
            "tables": [build_table(n) for n in list(tables_profile)[:10]],
            "source": "ai", "status": "draft", "fq_name": None, "ddl": None, "error": None,
        }]

    return {
        "name": _norm_name(f"{profile['database']}_{profile['schema']}", 120),
        "description": f"Semantic model for {profile['database']}.{profile['schema']}.",
        "views": views,
    }


# ---------------------------------------------------------------------------
# 4. Store
# ---------------------------------------------------------------------------

def _load_store() -> Dict[str, Any]:
    return _STORE.load_dict()


def _save_store(store: Dict[str, Any]) -> None:
    _STORE.save_dict(store)


def get_draft(model_id: str) -> Optional[Dict[str, Any]]:
    return _load_store().get(model_id)


def list_models(connection_id: Optional[str] = None) -> List[Dict[str, Any]]:
    models = list(_load_store().values())
    if connection_id:
        models = [m for m in models if m.get("connection_id") == connection_id]
    return sorted(models, key=lambda m: m.get("updated_at", ""), reverse=True)


def find_active_model(connection_id: str, database: str, schema: str) -> Optional[Dict[str, Any]]:
    db_u, sch_u = (database or "").strip().upper(), (schema or "").strip().upper()
    for m in list_models(connection_id):
        if m.get("status") == "active" and (m.get("database") or "").upper() == db_u \
                and (m.get("schema") or "").upper() == sch_u:
            return m
    return None


def _persist(model: Dict[str, Any]) -> Dict[str, Any]:
    model["updated_at"] = datetime.now(timezone.utc).isoformat()
    store = _load_store()
    store[model["id"]] = model
    _save_store(store)
    return model


def set_status(model_id: str, status: str) -> Optional[Dict[str, Any]]:
    model = get_draft(model_id)
    if not model:
        return None
    model["status"] = status
    return _persist(model)


def update_view(model_id: str, view_name: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    model = get_draft(model_id)
    if not model:
        return None
    for v in model["views"]:
        if v["view_name"] == view_name:
            if "tables" in patch:
                v["tables"] = patch["tables"]
            if "description" in patch:
                v["description"] = str(patch["description"])[:500]
            if patch.get("view_name"):
                v["view_name"] = _norm_view_name(patch["view_name"])
            v["status"] = "draft" if v.get("status") == "created" else v.get("status", "draft")
            return _persist(model)
    return None


def delete_view(model_id: str, view_name: str) -> Optional[Dict[str, Any]]:
    model = get_draft(model_id)
    if not model:
        return None
    model["views"] = [v for v in model["views"] if v["view_name"] != view_name]
    return _persist(model)


# ---------------------------------------------------------------------------
# 5. Generation
# ---------------------------------------------------------------------------

def generate_semantic_model(conn, connection_id: str, database: str, schema: str,
                            domain_hint: Optional[str] = None,
                            table_names: Optional[List[str]] = None) -> Dict[str, Any]:
    profile = introspect_gold_schema(conn, database, schema, table_names=table_names)
    if not profile["tables"]:
        if table_names:
            raise RuntimeError(
                f"None of the selected tables or views were found in {database}.{schema}: "
                + ", ".join(table_names[:10])
            )
        raise RuntimeError(f"No tables/views with columns found in {database}.{schema}.")

    fq = f"{profile['database']}.{profile['schema']}"
    proposal = llm_client.complete_json(
        _system_prompt(fq),
        [{"role": "user", "content": "SCHEMA PROFILE:\n" + json.dumps(profile, default=str)}],
        temperature=0.2, max_tokens=16000, timeout=180,
    )
    generated_by = "llm"
    views: List[Dict[str, Any]] = []
    if proposal and proposal.get("views"):
        views = _normalize_views(proposal, profile["tables"])
    if not views:
        proposal, generated_by = _heuristic_views(profile), "heuristic_fallback"
        views = proposal["views"]

    store = _load_store()
    existing = next(
        (m for m in store.values()
         if m.get("connection_id") == connection_id
         and (m.get("database") or "").upper() == profile["database"]
         and (m.get("schema") or "").upper() == profile["schema"]),
        None,
    )
    model_id = existing["id"] if existing else f"sm_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    model = {
        "id": model_id,
        "connection_id": connection_id,
        "database": profile["database"],
        "schema": profile["schema"],
        "name": _norm_name(proposal.get("name") or f"{profile['schema']}_model", 120),
        "description": str(proposal.get("description") or "")[:1000],
        "views": views,
        "status": "draft",
        "generated_by": generated_by,
        "available_tables": sorted(profile["tables"].keys()),
        "created_at": existing["created_at"] if existing else now,
        "updated_at": now,
    }
    return _persist(model)


def add_manual_view(conn, model_id: str, view_name: str, description: str, table_names: List[str]) -> Dict[str, Any]:
    """Adds a view the user defined by hand: they pick the tables, we derive the fields from the
    live schema so the view is valid, then they can edit it like any AI-proposed view."""
    model = get_draft(model_id)
    if not model:
        raise RuntimeError(f"No semantic model found for id {model_id}.")
    if not table_names:
        raise RuntimeError("Select at least one table for the view.")

    profile = introspect_gold_schema(conn, model["database"], model["schema"])
    wanted = {t.upper() for t in table_names}
    subset = {n: p for n, p in profile["tables"].items() if n.upper() in wanted}
    if not subset:
        raise RuntimeError("None of the selected tables were found in this schema.")

    built = _heuristic_views({**profile, "tables": subset})["views"]
    tables: List[Dict[str, Any]] = []
    for v in built:
        for t in v["tables"]:
            if t["name"] not in {x["name"] for x in tables}:
                tables.append(t)

    name = _norm_view_name(view_name)
    if any(v["view_name"] == name for v in model["views"]):
        raise RuntimeError(f"A view named {name} already exists in this model.")

    model["views"].append({
        "view_name": name,
        "description": str(description or "")[:500],
        "tables": tables,
        "source": "manual",
        "status": "draft",
        "fq_name": None, "ddl": None, "error": None,
    })
    model["status"] = "draft"
    return _persist(model)


def add_views(conn, model_id: str, table_names: Optional[List[str]] = None,
              instruction: Optional[str] = None) -> Dict[str, Any]:
    """Asks the LLM to propose ADDITIONAL views for tables not yet covered."""
    model = get_draft(model_id)
    if not model:
        raise RuntimeError(f"No semantic model found for id {model_id}.")

    profile = introspect_gold_schema(conn, model["database"], model["schema"])
    covered = {t["name"] for v in model["views"] for t in v["tables"]}
    candidates = {
        n: p for n, p in profile["tables"].items()
        if (not table_names or n in {t.upper() for t in table_names}) and (table_names or n not in covered)
    }
    if not candidates:
        raise RuntimeError("No uncovered tables left to add.")

    system = _system_prompt(f"{model['database']}.{model['schema']}") + (
        f"\n\nOnly propose views over these tables: {', '.join(candidates)}."
        + (f" User instruction: {instruction}" if instruction else "")
    )
    sub_profile = {**profile, "tables": candidates}
    proposal = llm_client.complete_json(
        system, [{"role": "user", "content": "SCHEMA PROFILE:\n" + json.dumps(sub_profile, default=str)}],
        temperature=0.2, max_tokens=10000, timeout=180,
    )
    new_views = _normalize_views(proposal, candidates) if proposal else []
    if not new_views:
        new_views = _heuristic_views(sub_profile)["views"]

    existing_names = {v["view_name"] for v in model["views"]}
    for v in new_views:
        if v["view_name"] in existing_names:
            v["view_name"] = f"{v['view_name']}_{len(existing_names) + 1}"
        existing_names.add(v["view_name"])
        model["views"].append(v)

    model["status"] = "draft"
    return _persist(model)


# ---------------------------------------------------------------------------
# 6. Semantic view DDL
# ---------------------------------------------------------------------------

def _sql_str(value: Any) -> str:
    return "'" + str(value or "").replace("'", "''") + "'"


def _alias(table_name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", str(table_name))[:120]


def _primary_key_for(table: Dict[str, Any], tables: List[Dict[str, Any]]) -> Optional[str]:
    incoming = [r["join_column"] for t in tables for r in t.get("relationships", []) if r["to_table"] == table["name"]]
    if incoming:
        return incoming[0]
    if table.get("role") == "dimension":
        for d in table.get("dimensions", []):
            if str(d.get("expr", "")).upper().endswith("_ID"):
                return d["expr"]
    return None


def generate_view_ddl(model: Dict[str, Any], view: Dict[str, Any]) -> str:
    """One `CREATE OR REPLACE SEMANTIC VIEW` for a single view — a SINGLE statement, because the
    Snowflake connector rejects multi-statement text."""
    db, sch = model["database"], model["schema"]
    name = safe_identifier(view["view_name"], "semantic view name")
    fq = f"{db}.{sch}.{name}"
    tables = view["tables"]

    tables_clause, rel_clause, dim_clause, metric_clause = [], [], [], []
    for t in tables:
        a = _alias(t["name"])
        entry = [f"    {a} AS {db}.{sch}.{t['name']}"]
        pk = _primary_key_for(t, tables)
        if pk:
            entry.append(f"      PRIMARY KEY ({pk})")
        if t.get("description"):
            entry.append(f"      COMMENT = {_sql_str(t['description'])}")
        tables_clause.append("\n".join(entry))

        for i, r in enumerate(t.get("relationships", [])):
            target = next((x for x in tables if x["name"] == r["to_table"]), None)
            if not target:
                continue
            target_pk = _primary_key_for(target, tables)
            if not target_pk:
                continue
            rel_name = re.sub(r"[^A-Za-z0-9_]", "_", f"{t['name']}_to_{r['to_table']}_{i}")[:120]
            rel_clause.append(
                f"    {rel_name} AS {a}({r['join_column']}) REFERENCES {_alias(r['to_table'])}({target_pk})"
            )

        for d in [*t.get("time_dimensions", []), *t.get("dimensions", [])]:
            line = f"    {a}.{d['name']} AS {d['expr']}"
            if d.get("synonyms"):
                line += " WITH SYNONYMS (" + ", ".join(_sql_str(s) for s in d["synonyms"]) + ")"
            if d.get("description"):
                line += f" COMMENT = {_sql_str(d['description'])}"
            dim_clause.append(line)

        for m in t.get("measures", []):
            agg = str(m.get("default_aggregation") or "sum").upper()
            expr = f"COUNT(DISTINCT {m['expr']})" if agg == "COUNT_DISTINCT" else f"{agg}({m['expr']})"
            line = f"    {a}.{m['name']} AS {expr}"
            if m.get("synonyms"):
                line += " WITH SYNONYMS (" + ", ".join(_sql_str(s) for s in m["synonyms"]) + ")"
            if m.get("description"):
                line += f" COMMENT = {_sql_str(m['description'])}"
            metric_clause.append(line)

    parts = [f"CREATE OR REPLACE SEMANTIC VIEW {fq}", "  TABLES (", ",\n".join(tables_clause), "  )"]
    if rel_clause:
        parts += ["  RELATIONSHIPS (", ",\n".join(rel_clause), "  )"]
    if dim_clause:
        parts += ["  DIMENSIONS (", ",\n".join(dim_clause), "  )"]
    if metric_clause:
        parts += ["  METRICS (", ",\n".join(metric_clause), "  )"]
    parts.append(f"  COMMENT = {_sql_str(view.get('description') or view['view_name'])}")
    return "\n".join(parts)


def materialize_semantic_model(conn, model_id: str, only_view: Optional[str] = None) -> Dict[str, Any]:
    """Creates each semantic view in Snowflake, recording per-view success/failure so one bad view
    doesn't block the rest."""
    model = get_draft(model_id)
    if not model:
        raise RuntimeError(f"No semantic model found for id {model_id}.")

    created = 0
    for view in model["views"]:
        if only_view and view["view_name"] != only_view:
            continue
        ddl = generate_view_ddl(model, view)
        view["ddl"] = ddl
        try:
            execute(conn, ddl)
            view["status"] = "created"
            view["fq_name"] = f"{model['database']}.{model['schema']}.{view['view_name']}"
            view["error"] = None
            view["created_at"] = datetime.now(timezone.utc).isoformat()
            created += 1
        except Exception as e:
            view["status"] = "failed"
            view["fq_name"] = None
            view["error"] = str(e)

    if created == 0:
        errors = "; ".join(f"{v['view_name']}: {v.get('error')}" for v in model["views"] if v.get("error"))
        _persist(model)
        raise RuntimeError(f"No semantic views could be created. {errors}")

    model["status"] = "active"
    model["materialized_at"] = datetime.now(timezone.utc).isoformat()
    return _persist(model)


def created_views(model: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [v for v in model.get("views", []) if v.get("status") == "created" and v.get("fq_name")]


# ---------------------------------------------------------------------------
# 7. Cortex agent + dedicated role
# ---------------------------------------------------------------------------

def generate_agent_ddl(model: Dict[str, Any], agent_name: str, warehouse: str = "COMPUTE_WH",
                       agent_schema: Optional[str] = None) -> str:
    """One cortex_analyst_text_to_sql tool per created semantic view. Single statement."""
    agent_name = safe_identifier(agent_name, "agent name")
    db = model["database"]
    sch = safe_identifier(agent_schema, "agent schema") if agent_schema else model["schema"]
    fq_agent = f"{db}.{sch}.{agent_name}"

    views = created_views(model)
    if not views:
        raise RuntimeError("No semantic views have been created yet. Run Approve & Create Views first.")

    def tool_name(view_name: str) -> str:
        base = re.sub(r"^SV_", "", view_name)
        return (re.sub(r"[^A-Za-z0-9]", "", base.title().replace("_", ""))[:64]) or "Analytics"

    tools, resources, routing = [], [], []
    used = set()
    for v in views:
        name = tool_name(v["view_name"])
        while name in used:
            name = f"{name}X"
        used.add(name)
        desc = v.get("description") or f"Questions answered by {v['view_name']}."
        tools.append(f'  - tool_spec:\n      type: cortex_analyst_text_to_sql\n      name: {name}\n      description: "{desc}"')
        resources.append(
            f"  {name}:\n    semantic_view: {v['fq_name']}\n"
            f"    execution_environment:\n      type: warehouse\n      warehouse: {warehouse}\n      query_timeout: 120"
        )
        routing.append(f"    Route questions about {desc.rstrip('.').lower()} to {name}.")
    tools.append('  - tool_spec:\n      type: data_to_chart\n      name: Charts\n      description: "Render query results as a chart when a visual helps."')

    orchestration = "\n".join(routing) + (
        "\n    If a question spans areas, call each relevant tool and combine the results."
        "\n    If no semantic view can answer it, say so instead of guessing."
    )

    return f"""CREATE OR REPLACE AGENT {fq_agent}
  COMMENT = 'Auto-generated analytics agent for {model["name"]}'
  PROFILE = '{{"display_name": "{model.get("description") or model["name"]}", "color": "emerald"}}'
  FROM SPECIFICATION
$$
models:
  orchestration: auto

instructions:
  response: |
    Answer concisely. Show the numbers in a table when there is more than one row.
  orchestration: |
{orchestration}

tools:
{chr(10).join(tools)}

tool_resources:
{chr(10).join(resources)}
$$"""


def role_name_for(agent_name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", f"{agent_name}_ROLE".upper())[:120]


def generate_role_statements(role: str, model: Dict[str, Any], agent_fq: str, warehouse: str,
                             username: str) -> List[tuple]:
    role = safe_identifier(role, "role name")
    db, sch = model["database"], model["schema"]
    stmts = [
        ("create role", f"CREATE ROLE IF NOT EXISTS {role}"),
        ("usage on database", f"GRANT USAGE ON DATABASE {db} TO ROLE {role}"),
        ("usage on schema", f"GRANT USAGE ON SCHEMA {db}.{sch} TO ROLE {role}"),
        ("usage on warehouse", f"GRANT USAGE ON WAREHOUSE {safe_identifier(warehouse, 'warehouse')} TO ROLE {role}"),
    ]
    for t in sorted({t["name"] for v in model["views"] for t in v["tables"]}):
        stmts.append((f"select on {t}", f"GRANT SELECT ON TABLE {db}.{sch}.{t} TO ROLE {role}"))
    for v in created_views(model):
        stmts.append((f"select on {v['view_name']}", f"GRANT SELECT ON SEMANTIC VIEW {v['fq_name']} TO ROLE {role}"))
    stmts.append(("usage on agent", f"GRANT USAGE ON AGENT {agent_fq} TO ROLE {role}"))
    if username:
        stmts.append(("grant role to user", f"GRANT ROLE {role} TO USER {safe_identifier(username, 'username')}"))
    return stmts


def provision_role(conn, model: Dict[str, Any], agent_fq: str, warehouse: str, username: str,
                   role: str) -> Dict[str, Any]:
    results = []
    for label, sql in generate_role_statements(role, model, agent_fq, warehouse, username):
        try:
            execute(conn, sql)
            results.append({"step": label, "status": "ok", "sql": sql})
        except Exception as e:
            results.append({"step": label, "status": "failed", "sql": sql, "error": str(e)})
    return {"role": role, "statements": results, "failed_count": len([r for r in results if r["status"] == "failed"])}


def create_agent(conn, model_id: str, agent_name: str, warehouse: str = "COMPUTE_WH",
                 agent_schema: Optional[str] = None, username: str = "", role: Optional[str] = None) -> Dict[str, Any]:
    model = get_draft(model_id)
    if not model or model["status"] != "active":
        raise RuntimeError("Create the semantic views first (Approve & Create Views).")

    ddl = generate_agent_ddl(model, agent_name, warehouse=warehouse, agent_schema=agent_schema)
    try:
        execute(conn, ddl)
    except Exception as e:
        msg = str(e)
        if "does not exist or not authorized" in msg or "Insufficient privileges" in msg:
            raise RuntimeError(
                f"Snowflake rejected CREATE AGENT: {msg}. The role needs CREATE AGENT on "
                f"{model['database']}.{agent_schema or model['schema']}, and the account must have Cortex Agents enabled."
            ) from e
        raise RuntimeError(f"CREATE AGENT failed: {msg}") from e

    sch = safe_identifier(agent_schema, "agent schema") if agent_schema else model["schema"]
    fq_agent = f'{model["database"]}.{sch}.{safe_identifier(agent_name, "agent name")}'
    role_provision = provision_role(conn, model, fq_agent, warehouse, username, role or role_name_for(agent_name))

    model["agent"] = {
        "name": agent_name,
        "fq_name": fq_agent,
        "ddl": ddl,
        "role": role_provision["role"],
        "role_provision": role_provision,
        "views": [v["fq_name"] for v in created_views(model)],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return _persist(model)
