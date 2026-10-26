"""
KPI-driven shared dashboard (Phase D).

For a schema with an active semantic model (from semantic_view_generator.py), this module asks
the LLM to pick the important KPIs and chart layout, validates every generated SQL statement
against live Snowflake, and materializes accepted KPIs as views — one fixed dashboard per schema,
generated once and shared by every viewer (not per-user).

This is intentionally decoupled from the ad hoc AI-analyst chat (service.py:query_ai_analyst):
that surface answers one question at a time and is never persisted; this module produces a
precomputed, persisted, schema-wide dashboard. They share only the semantic model as a common
vocabulary of tables/measures/dimensions.

Follows the same introspect -> LLM JSON -> validate/repair -> materialize pipeline shape as
ai_governance/kpi_discovery_service.py, retargeted at a semantic model instead of governance
metadata tables (no re-profiling of Snowflake is needed — the semantic model already encodes
what's available).
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.db.document_store import DocumentStore
from app.db.models import KpiDashboardModel
from app.modules.ai_governance import llm_client
from app.modules.ai_governance.snowflake_helpers import execute
from app.modules.ai_governance.sql_guard import validate_readonly_query_generic

SECTIONS = ["OVERVIEW", "TRENDS", "BREAKDOWN", "DETAIL"]
CHART_TYPES = {"kpi_card", "bar", "line", "donut", "table"}
MAX_KPIS = 24

_STORE = DocumentStore(KpiDashboardModel)


# ---------------------------------------------------------------------------
# 1. Prompting (input is the semantic model, already-profiled — no re-introspection)
# ---------------------------------------------------------------------------

def _model_tables(model: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Tables across every semantic view in the model, de-duplicated by name."""
    seen, tables = set(), []
    for view in model.get("views", []):
        for t in view.get("tables", []):
            if t["name"] not in seen:
                seen.add(t["name"])
                tables.append(t)
    return tables


def _system_prompt(model: Dict[str, Any]) -> str:
    fq = f"{model['database']}.{model['schema']}"
    view_summaries = []
    for view in model.get("views", []):
        if view.get("status") != "created":
            continue
        view_summaries.append(f"SEMANTIC VIEW {view['fq_name']} — {view.get('description') or ''}")
        for t in view.get("tables", []):
            measures = ", ".join(f"{m['name']} ({m['default_aggregation']} of {m['expr']})" for m in t["measures"])
            dims = ", ".join(d["name"] for d in t["dimensions"])
            times = ", ".join(d["name"] for d in t["time_dimensions"])
            view_summaries.append(
                f"  - {t['name']} ({t['role']}): measures=[{measures}] dimensions=[{dims}] time_dimensions=[{times}]"
            )
    return f"""You are a BI analyst designing a shared KPI dashboard for the schema {fq}.
The approved semantic model exposes these semantic views and their underlying tables:
{chr(10).join(view_summaries)}

Propose the most important KPIs a business user would want to see first, using ONLY the tables/columns above,
always fully qualified as {fq}.<TABLE>.

Return ONLY a JSON object:
{{
  "sections": [{{"id": one of {SECTIONS}, "label": "short section label", "description": "one sentence"}}],
  "kpis": [{{
      "kpi_name": "UPPER_SNAKE_CASE, unique, <= 40 chars",
      "label": "display label",
      "description": "one short sentence",
      "section": one of {SECTIONS},
      "chart_type": one of {sorted(CHART_TYPES)},
      "unit": "optional short unit such as %, $, rows",
      "sql_definition": "Snowflake SELECT statement"
  }}]
}}

Rules:
- Propose 6-10 headline KPIs (chart_type kpi_card) for OVERVIEW, using the fact/mart tables' measures.
- Add supporting panels (bar/line/donut/table) for TRENDS/BREAKDOWN/DETAIL using dimensions and time_dimensions
  to slice the measures; at most {MAX_KPIS} kpis total.
- Single statement, no trailing semicolon, no DDL/DML.
- Result shapes (column names are mandatory):
  kpi_card -> exactly 1 row with a column VALUE
  bar, donut -> columns LABEL, VALUE; at most 25 rows
  line -> first column X (ordered time/category), then one or more numeric series columns
  table -> any meaningful columns, at most 200 rows, ORDER BY something useful
- Guard divisions with NULLIF and wrap aggregates in COALESCE so empty results return 0 rather than NULL."""


def _direct_system_prompt(db: str, schema: str, catalog: Dict[str, Any]) -> str:
    """Path B: no semantic model. The LLM writes SQL straight against the chosen tables/views."""
    fq = f"{db}.{schema}"
    lines = [f"  - {fq}.{t}: " + ", ".join(f"{c} {d}" for c, d in cols) for t, cols in catalog.items()]
    return f"""You are a BI analyst designing a shared KPI dashboard for the schema {fq}.
There is no semantic model — write SQL directly against these tables and views, with every column and its type:
{chr(10).join(lines)}

Propose the most important KPIs a business user would want to see first, using ONLY the tables/columns above,
always fully qualified as {fq}.<TABLE>. Join them on shared key columns where it makes sense.

Return ONLY a JSON object:
{{
  "sections": [{{"id": one of {SECTIONS}, "label": "short section label", "description": "one sentence"}}],
  "kpis": [{{
      "kpi_name": "UPPER_SNAKE_CASE, unique, <= 40 chars",
      "label": "display label",
      "description": "one short sentence",
      "section": one of {SECTIONS},
      "chart_type": one of {sorted(CHART_TYPES)},
      "unit": "optional short unit such as %, $, rows",
      "sql_definition": "Snowflake SELECT statement"
  }}]
}}

Rules:
- Propose 6-10 headline KPIs (chart_type kpi_card) for OVERVIEW by aggregating the numeric columns.
- Add supporting panels (bar/line/donut/table) for TRENDS/BREAKDOWN/DETAIL: group by text/ID columns, and
  derive time grains from DATE/TIMESTAMP columns with DATE_TRUNC; at most {MAX_KPIS} kpis total.
- Single statement, no trailing semicolon, no DDL/DML.
- Result shapes (column names are mandatory):
  kpi_card -> exactly 1 row with a column VALUE
  bar, donut -> columns LABEL, VALUE; at most 25 rows
  line -> first column X (ordered time/category), then one or more numeric series columns
  table -> any meaningful columns, at most 200 rows, ORDER BY something useful
- Guard divisions with NULLIF and wrap aggregates in COALESCE so empty results return 0 rather than NULL."""


def _user_prompt() -> str:
    return "Design the dashboard now."


# ---------------------------------------------------------------------------
# 2. Normalization & validation (mirrors kpi_discovery_service.py)
# ---------------------------------------------------------------------------

def _normalize_kpi(raw: Dict[str, Any], order: int) -> Optional[Dict[str, Any]]:
    name = re.sub(r"[^A-Z0-9_]", "_", str(raw.get("kpi_name") or raw.get("label") or "").upper()).strip("_")[:40]
    chart_type = str(raw.get("chart_type") or "").lower()
    sql = str(raw.get("sql_definition") or "").strip()
    if not name or not sql or chart_type not in CHART_TYPES:
        return None
    section = str(raw.get("section") or "").upper()
    if section not in SECTIONS:
        section = "OVERVIEW" if chart_type == "kpi_card" else "BREAKDOWN"
    return {
        "kpi_name": name,
        "label": str(raw.get("label") or name.replace("_", " ").title())[:200],
        "description": str(raw.get("description") or "")[:1000],
        "section": section,
        "chart_type": chart_type,
        "unit": str(raw.get("unit") or "")[:20],
        "sql_definition": sql,
        "display_order": order,
        # Set when a human edited the SQL by hand, so a later AI regeneration can warn before
        # overwriting it instead of silently discarding the correction.
        "manually_edited": bool(raw.get("manually_edited")),
    }


def _normalize_proposal(proposal: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    sections_by_id = {str(s.get("id", "")).upper(): s for s in (proposal.get("sections") or []) if isinstance(s, dict)}
    sections = [
        {"id": s, "label": str((sections_by_id.get(s) or {}).get("label") or s.title())[:60],
         "description": str((sections_by_id.get(s) or {}).get("description") or "")[:300]}
        for s in SECTIONS
    ]
    kpis, seen = [], set()
    for i, raw in enumerate(proposal.get("kpis") or []):
        if not isinstance(raw, dict):
            continue
        k = _normalize_kpi(raw, i)
        if k and k["kpi_name"] not in seen:
            seen.add(k["kpi_name"])
            kpis.append(k)
    return sections, kpis[:MAX_KPIS]


def _shape_error(chart_type: str, columns: List[str], rows: List[tuple]) -> Optional[str]:
    cols = set(columns)
    n = len(rows)
    if chart_type == "kpi_card":
        if n != 1 or "VALUE" not in cols:
            return f"kpi_card must return exactly 1 row with a VALUE column (got {n} rows, columns {columns})."
    elif chart_type in ("bar", "donut"):
        if not {"LABEL", "VALUE"} <= cols:
            return f"{chart_type} must return LABEL and VALUE columns (got {columns})."
        if n > 25:
            return f"{chart_type} returned {n} rows; limit to 25."
    elif chart_type == "line":
        if len(columns) < 2 or columns[0] != "X":
            return f"line must return X followed by numeric series columns (got {columns})."
    elif chart_type == "table":
        if n > 200:
            return "table returned more than 200 rows; add a LIMIT."
    return None


def _validate_kpi(conn, kpi: Dict[str, Any], target_db: str, target_schema: str, allowed_tables: List[str],
                  preview: Optional[Dict[str, Any]] = None) -> Optional[str]:
    error, normalized = validate_readonly_query_generic(conn, kpi["sql_definition"], target_db, target_schema, allowed_tables)
    kpi["sql_definition"] = normalized
    if error:
        return error
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT * FROM ({normalized}) LIMIT 201", timeout=90)
        columns = [d[0].upper() for d in cur.description]
        rows = cur.fetchall()
    except Exception as e:
        return f"SQL failed to execute: {e}"
    finally:
        cur.close()
    if len(set(columns)) != len(columns):
        return f"Duplicate output column names: {columns}"
    if preview is not None:
        preview["rows"] = [dict(zip(columns, r)) for r in rows]
    return _shape_error(kpi["chart_type"], columns, rows)


def _validate_all(conn, kpis, target_db, target_schema, allowed_tables):
    accepted, rejected = [], []
    for k in kpis:
        err = _validate_kpi(conn, k, target_db, target_schema, allowed_tables)
        (rejected if err else accepted).append({**k, "validation_message": err or "ok"})
    return accepted, rejected


# ---------------------------------------------------------------------------
# 3. Persistence (disk-JSON, consistent with this router's other stores)
# ---------------------------------------------------------------------------

def view_name_for(schema_id: str, kpi_name: str) -> str:
    return f"V_DASH_KPI_{schema_id}_{kpi_name}"[:255]


def _drop_existing_views(conn, target_db: str, target_schema: str, schema_id: str) -> None:
    cur = conn.cursor()
    try:
        cur.execute(f'SHOW VIEWS IN SCHEMA "{target_db}"."{target_schema}"')
        name_idx = [d[0].lower() for d in cur.description].index("name")
        prefix = f"V_DASH_KPI_{schema_id}_"
        stale = [r[name_idx] for r in cur.fetchall() if str(r[name_idx]).upper().startswith(prefix)]
    finally:
        cur.close()
    for view in stale:
        execute(conn, f'DROP VIEW IF EXISTS "{target_db}"."{target_schema}"."{view}"')


def _load_store() -> Dict[str, Any]:
    return _STORE.load_dict()


def _save_store(store: Dict[str, Any]) -> None:
    _STORE.save_dict(store)


def dashboard_belongs_to(dashboard: Optional[Dict[str, Any]], connection_id: str) -> bool:
    """True when this dashboard was built by the asking project or is an unowned/legacy dashboard for this scope."""
    if not dashboard:
        return False
    owner = str(dashboard.get("connection_id") or "")
    if not owner or not connection_id:
        return True
    return owner == str(connection_id)


def _project_tag(connection_id: str) -> str:
    """Short, stable tag for a project id. FNV-1a 32-bit — deliberately simple so the frontend can
    compute exactly the same value (see schemaIdFor in AnalyticsDashboard.jsx). Not security."""
    h = 2166136261
    for ch in str(connection_id):
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return format(h, "08X")


def legacy_schema_id_for(database: str, schema: str) -> str:
    """The pre-project-scoped key. Still read so dashboards built before the change keep working."""
    return re.sub(r"[^A-Z0-9_]", "_", f"{database}_{schema}".upper())[:80]


def schema_id_for(database: str, schema: str, connection_id: str = "") -> str:
    """Identifies a dashboard AND prefixes its Snowflake views.

    Includes the project, because two projects can legitimately point at the same database.schema.
    Keyed on database+schema alone, they shared one stored dashboard and one set of
    V_DASH_KPI_* views — so whichever regenerated last took ownership, dropped the other's views,
    and the other project was left showing the chooser or, worse, the first project's numbers.
    """
    base = legacy_schema_id_for(database, schema)
    if not connection_id:
        return base
    return f"{base[:71]}_{_project_tag(connection_id)}"


def get_dashboard(schema_id: str) -> Optional[Dict[str, Any]]:
    return _load_store().get(schema_id)


def resolve_dashboard(schema_id: str, connection_id: str = "",
                      database: str = "", schema: str = "") -> Optional[Dict[str, Any]]:
    """Finds a project's dashboard, including one stored under the old project-less key."""
    dash = get_dashboard(schema_id)
    if dash and dashboard_belongs_to(dash, connection_id):
        return dash

    if not (database and schema):
        return None

    legacy = get_dashboard(legacy_schema_id_for(database, schema))
    if legacy and dashboard_belongs_to(legacy, connection_id):
        return legacy

    db_u, schema_u = str(database).upper(), str(schema).upper()
    store = _load_store()

    # Priority 1: Exact connection_id + scope match
    if connection_id:
        for candidate in store.values():
            if (str(candidate.get("connection_id") or "") == str(connection_id)
                    and str(candidate.get("database") or "").upper() == db_u
                    and str(candidate.get("schema") or "").upper() == schema_u):
                return candidate

    # Priority 2: Matching scope with compatible ownership
    for candidate in store.values():
        if (str(candidate.get("database") or "").upper() == db_u
                and str(candidate.get("schema") or "").upper() == schema_u
                and dashboard_belongs_to(candidate, connection_id)):
            return candidate

    return None


def _persist(conn, target_db: str, target_schema: str, schema_id: str, accepted, rejected, generated_by: str,
             sections: List[Dict[str, Any]], mode: str = "semantic", connection_id: str = "") -> Dict[str, Any]:
    _drop_existing_views(conn, target_db, target_schema, schema_id)
    active = []
    for k in accepted:
        view = view_name_for(schema_id, k["kpi_name"])
        try:
            execute(conn, f'CREATE OR REPLACE VIEW "{target_db}"."{target_schema}"."{view}" AS {k["sql_definition"]}')
            active.append({**k, "view_name": view})
        except Exception as e:
            rejected = rejected + [{**k, "validation_message": f"View creation failed: {e}"}]

    dashboard = {
        "schema_id": schema_id,
        "database": target_db,
        "schema": target_schema,
        "sections": sections,
        "kpis": active,
        "generated_by": generated_by,
        # Which path produced this dashboard, so the UI can label it and regeneration stays consistent.
        "mode": mode,
        # schema_id is derived from database+schema alone, so two projects pointing at the same
        # schema would otherwise share (and silently adopt) each other's dashboard. This records
        # which project built it so reads can be scoped.
        "connection_id": connection_id or "",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rejected_kpis": [{"kpi_name": r["kpi_name"], "reason": r["validation_message"]} for r in rejected],
    }
    store = _load_store()
    store[schema_id] = dashboard
    _save_store(store)
    return dashboard


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _allowed_tables(semantic_model: Dict[str, Any]) -> List[str]:
    """KPI SQL may read the model's tables and the semantic views created from them."""
    tables = [t["name"] for t in _model_tables(semantic_model)]
    return tables + [v["view_name"] for v in semantic_model.get("views", []) if v.get("status") == "created"]


def discover_and_build_dashboard(conn, semantic_model: Dict[str, Any], mode: str = "semantic",
                                 connection_id: str = "") -> Dict[str, Any]:
    """mode='semantic' (Path A) builds KPIs over the approved semantic views.
    mode='direct' (Path B) skips the semantic layer and queries the chosen tables/views directly."""
    target_db, target_schema = semantic_model["database"], semantic_model["schema"]
    schema_id = schema_id_for(target_db, target_schema, connection_id)

    if mode == "direct":
        catalog = _schema_catalog(conn, target_db, target_schema)
        picked = {str(t).upper() for t in (semantic_model.get("available_tables") or [])}
        if picked:
            catalog = {t: c for t, c in catalog.items() if str(t).upper() in picked}
        if not catalog:
            raise RuntimeError(f"No readable tables or views found in {target_db}.{target_schema}.")
        allowed_tables = sorted(catalog)
        system = _direct_system_prompt(target_db, target_schema, catalog)
    else:
        allowed_tables = _allowed_tables(semantic_model)
        if not allowed_tables:
            raise RuntimeError("This semantic model has no created views to build a dashboard from.")
        system = _system_prompt(semantic_model)

    turns = [{"role": "user", "content": _user_prompt()}]
    proposal = llm_client.complete_json(system, turns, temperature=0.2, max_tokens=12000, timeout=120)
    generated_by = "llm"
    if not proposal or not proposal.get("kpis"):
        raise RuntimeError("Dashboard KPI discovery requires an LLM provider and none responded.")

    sections, kpis = _normalize_proposal(proposal)
    accepted, rejected = _validate_all(conn, kpis, target_db, target_schema, allowed_tables)

    if rejected:
        repair_turns = turns + [
            {"role": "assistant", "content": json.dumps({"sections": sections, "kpis": kpis})},
            {"role": "user", "content": (
                "These KPI definitions failed validation. Return JSON {\"kpis\": [...]} containing corrected versions of ONLY "
                "these kpis (same kpi_name), or omit any that cannot be fixed:\n"
                + json.dumps([{"kpi_name": r["kpi_name"], "chart_type": r["chart_type"], "sql_definition": r["sql_definition"],
                               "error": r["validation_message"]} for r in rejected])
            )},
        ]
        repaired = llm_client.complete_json(system, repair_turns, temperature=0.1, max_tokens=8000, timeout=120)
        if repaired and repaired.get("kpis"):
            order_by_name = {r["kpi_name"]: r["display_order"] for r in rejected}
            _, fixed = _normalize_proposal({"kpis": repaired["kpis"]})
            fixed = [{**f, "display_order": order_by_name.get(f["kpi_name"], f["display_order"])} for f in fixed if f["kpi_name"] in order_by_name]
            fixed_ok, still_bad = _validate_all(conn, fixed, target_db, target_schema, allowed_tables)
            fixed_names = {f["kpi_name"] for f in fixed_ok}
            accepted += fixed_ok
            rejected = [r for r in rejected if r["kpi_name"] not in fixed_names]
            rejected = [r for r in rejected if r["kpi_name"] not in {s["kpi_name"] for s in still_bad}] + still_bad

    if not accepted:
        raise RuntimeError(
            "Dashboard generation produced no valid KPI definitions. "
            + "; ".join(f"{r['kpi_name']}: {r['validation_message']}" for r in rejected[:5])
        )

    accepted.sort(key=lambda k: k["display_order"])
    return _persist(conn, target_db, target_schema, schema_id, accepted, rejected, generated_by, sections,
                    mode=mode, connection_id=connection_id)


# ---------------------------------------------------------------------------
# Business-user editing: add / change / remove single KPIs, with version history
# ---------------------------------------------------------------------------
# The whole dashboard is shared (one per schema, no per-user copies), so every change snapshots
# the previous state first and can be undone. SQL coming back from the browser is never trusted:
# add_kpi re-validates it against Snowflake exactly like the generator does.


MAX_VERSIONS = 20
_EDIT_LOCK = threading.Lock()


class KpiEditError(ValueError):
    """Plain-language failure shown to the business user as-is."""


CATALOG_MAX_TABLES = 80
CATALOG_MAX_COLUMNS = 60


def _schema_catalog(conn, db: str, schema: str) -> Dict[str, List[Tuple[str, str]]]:
    """Every table/view in the project's gold schema with its columns and types. The semantic
    model only summarizes a few measures/dimensions per table, which is not enough for ad hoc
    requests ("revenue by quarter" needs to see the order date column), so single-KPI requests
    get the full picture. The dashboard's own V_DASH_KPI_* views are left out."""
    cur = conn.cursor()
    try:
        cur.execute(
            f'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM "{db}".INFORMATION_SCHEMA.COLUMNS '
            "WHERE TABLE_SCHEMA = %s ORDER BY TABLE_NAME, ORDINAL_POSITION",
            (schema,),
        )
        catalog: Dict[str, List[Tuple[str, str]]] = {}
        for table, column, dtype in cur.fetchall():
            if str(table).upper().startswith("V_DASH_KPI_"):
                continue
            if table not in catalog and len(catalog) >= CATALOG_MAX_TABLES:
                continue
            cols = catalog.setdefault(table, [])
            if len(cols) < CATALOG_MAX_COLUMNS:
                cols.append((column, dtype))
        return catalog
    finally:
        cur.close()


def _catalog_prompt(db: str, schema: str, catalog: Dict[str, List[Tuple[str, str]]]) -> str:
    lines = [f"  - {db}.{schema}.{t}: " + ", ".join(f"{c} {d}" for c, d in cols) for t, cols in catalog.items()]
    return (
        "\n\nALL TABLES AND VIEWS in the project's selected data, with every column and its type — you may query ANY of "
        f"these directly (fully qualified), and join them on shared key columns:\n" + "\n".join(lines)
    )


def _single_kpi_instruction(request: str, existing: Optional[Dict[str, Any]], current: List[Dict[str, Any]]) -> str:
    others = ", ".join(k.get("label", k["kpi_name"]) for k in current if not existing or k["kpi_name"] != existing["kpi_name"])
    base = (
        "A business user wants ONE dashboard KPI. Their request, in their own words:\n"
        f"\"{request.strip()}\"\n\n"
        f"KPIs already on the dashboard: {others or 'none'}. Do not duplicate one of them.\n"
    )
    if existing:
        base += (
            "They are CHANGING this existing KPI — keep its kpi_name, adapt everything else to the request:\n"
            + json.dumps({k: existing.get(k) for k in ("kpi_name", "label", "description", "section", "chart_type", "unit", "sql_definition")})
            + "\n"
        )
    return base + (
        "Pick the chart_type that best answers it (a single number -> kpi_card, over time -> line, "
        "by category -> bar, share of a whole -> donut, a list of records -> table) and the matching section.\n"
        "Build it from the raw columns listed above — you are NOT limited to the semantic model's measures:\n"
        "- Derive any time grain from a DATE/TIMESTAMP column: DATE_TRUNC('QUARTER', col), DATE_TRUNC('MONTH', col), "
        "YEAR(col), 'Q' || QUARTER(col), etc. A missing 'quarter' column is never a reason to refuse.\n"
        "- Compute measures from raw numeric columns (SUM/AVG/COUNT/ratios), and join tables on shared id columns.\n"
        "- If the wording doesn't match a column name exactly, use the closest sensible column "
        "(revenue ~ amount/sales/total/price*quantity) and say which one in the description.\n"
        "Return ONLY JSON: {\"kpi\": {same fields as a kpi above}}\n"
        "Only if NO column in ANY table relates to the request, return ONLY {\"error\": \"one short sentence a "
        "non-technical user understands, saying what data is missing\"}. Never invent tables or columns."
    )


def _refusal_retry(reason: str) -> str:
    return (
        f"You declined with: \"{reason}\". Look again at ALL the tables and columns listed in the system prompt. "
        "Derive time grains with DATE_TRUNC/YEAR/QUARTER on any date column, compute measures from raw columns, and "
        "join tables where needed. Return {\"kpi\": {...}} with your best faithful answer. Return {\"error\": \"...\"} "
        "again only if truly no column relates to the request."
    )


CANT_BUILD = "We couldn't build that KPI from this project's data. Try rephrasing it, or ask for something more specific."


def _kpi_scope(conn, semantic_model: Dict[str, Any]) -> Tuple[str, List[str]]:
    """System prompt + allowed tables for single-KPI work: the semantic model PLUS every table
    and view in the gold schema, so ad hoc requests aren't limited to the model's summary."""
    db, schema = semantic_model["database"], semantic_model["schema"]
    system, allowed = _system_prompt(semantic_model), _allowed_tables(semantic_model)
    try:
        catalog = _schema_catalog(conn, db, schema)
    except Exception:
        catalog = {}  # no INFORMATION_SCHEMA access: fall back to the semantic model alone
    if catalog:
        system += _catalog_prompt(db, schema, catalog)
        allowed = sorted(set(allowed) | set(catalog))
    return system, allowed


def propose_kpi(conn, semantic_model: Dict[str, Any], request: str, current_kpis: List[Dict[str, Any]],
                existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Asks the AI for one KPI and validates it live. Returns {"kpi", "data"} — nothing is saved.
    A refusal is challenged once and a failing query is repaired once before the user sees an error."""
    if not (request or "").strip():
        raise KpiEditError("Describe the KPI you want, for example \"Revenue by month\".")
    target_db, target_schema = semantic_model["database"], semantic_model["schema"]
    system, allowed = _kpi_scope(conn, semantic_model)
    turns = [{"role": "user", "content": _single_kpi_instruction(request, existing, current_kpis)}]
    order = existing["display_order"] if existing else len(current_kpis)
    refused = repaired = False

    while True:
        reply = llm_client.complete_json(system, turns, temperature=0.1 if turns[1:] else 0.2, max_tokens=4000, timeout=90)
        if not reply:
            raise KpiEditError("The AI service didn't respond. Please try again in a moment.")
        turns.append({"role": "assistant", "content": json.dumps(reply)})

        if reply.get("error") and not reply.get("kpi"):
            if refused:
                raise KpiEditError(str(reply["error"])[:300])
            refused = True
            turns.append({"role": "user", "content": _refusal_retry(str(reply["error"]))})
            continue

        kpi = _normalize_kpi(reply.get("kpi") or {}, order)
        preview: Dict[str, Any] = {}
        if kpi and existing:
            kpi["kpi_name"] = existing["kpi_name"]
        error = _validate_kpi(conn, kpi, target_db, target_schema, allowed, preview) if kpi else "The KPI was incomplete."
        if not error:
            break
        if repaired:
            raise KpiEditError(CANT_BUILD)
        repaired = True
        turns.append({"role": "user", "content": f"That KPI failed validation: {error}\nReturn corrected JSON "
                                                 "{\"kpi\": {...}} or {\"error\": \"...\"} if it cannot be answered."})

    if not existing:
        taken = {k["kpi_name"] for k in current_kpis}
        base, n = kpi["kpi_name"], 2
        while kpi["kpi_name"] in taken:
            kpi["kpi_name"] = f"{base[:36]}_{n}"
            n += 1
    return {"kpi": kpi, "data": preview.get("rows", [])}


def _dashboard_or_error(schema_id: str) -> Dict[str, Any]:
    dash = get_dashboard(schema_id)
    if not dash:
        raise KpiEditError("This project has no dashboard yet.")
    return dash


def _snapshot(dash: Dict[str, Any]) -> None:
    versions = dash.get("versions") or []
    versions.append({
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "kpis": [{k: v for k, v in kpi.items() if k != "data"} for kpi in dash.get("kpis", [])],
        "sections": dash.get("sections", []),
    })
    dash["versions"] = versions[-MAX_VERSIONS:]


def _save_dashboard(dash: Dict[str, Any]) -> Dict[str, Any]:
    dash["kpis"] = sorted(dash.get("kpis", []), key=lambda k: k.get("display_order", 0))
    for i, k in enumerate(dash["kpis"]):
        k["display_order"] = i
    dash["updated_at"] = datetime.now(timezone.utc).isoformat()
    store = _load_store()
    store[dash["schema_id"]] = dash
    _save_store(store)
    return dash


def _drop_view(conn, dash: Dict[str, Any], view: str) -> None:
    try:
        execute(conn, f'DROP VIEW IF EXISTS "{dash["database"]}"."{dash["schema"]}"."{view}"')
    except Exception:
        pass  # an orphaned view is harmless; the KPI is gone from the dashboard either way


def add_kpi(conn, semantic_model: Dict[str, Any], schema_id: str, kpi: Dict[str, Any]) -> Dict[str, Any]:
    """Adds a previewed KPI, or replaces the KPI with the same name (the "change with AI" path)."""
    with _EDIT_LOCK:
        dash = _dashboard_or_error(schema_id)
        existing = next((k for k in dash["kpis"] if k["kpi_name"] == kpi.get("kpi_name")), None)
        clean = _normalize_kpi(kpi, existing["display_order"] if existing else len(dash["kpis"]))
        if not clean:
            raise KpiEditError("That KPI is incomplete — create it again.")
        if not existing and len(dash["kpis"]) >= MAX_KPIS:
            raise KpiEditError(f"A dashboard can have at most {MAX_KPIS} KPIs. Remove one first.")
        # Surface the real reason: when a user hand-edits the SQL they need the actual error
        # (bad column, syntax, wrong result shape), not a generic "create it again".
        why = _validate_kpi(conn, clean, dash["database"], dash["schema"], _kpi_scope(conn, semantic_model)[1])
        if why:
            raise KpiEditError(
                f"That SQL didn't work: {why}" if kpi.get("manually_edited")
                else "That KPI no longer works against the data. Create it again."
            )
        view = view_name_for(schema_id, clean["kpi_name"])
        try:
            execute(conn, f'CREATE OR REPLACE VIEW "{dash["database"]}"."{dash["schema"]}"."{view}" AS {clean["sql_definition"]}')
        except Exception as e:
            raise KpiEditError(f"Couldn't save the KPI: {e}") from e
        _snapshot(dash)
        dash["kpis"] = [k for k in dash["kpis"] if k["kpi_name"] != clean["kpi_name"]] + [{**clean, "view_name": view}]
        return _save_dashboard(dash)


EDITABLE_FIELDS = {"label": 200, "description": 1000, "unit": 20}
COMPATIBLE_CHARTS = {"bar": {"bar", "donut"}, "donut": {"bar", "donut"}}


def update_kpi_meta(schema_id: str, kpi_name: str, changes: Dict[str, Any]) -> Dict[str, Any]:
    """Title / description / unit / section, and bar<->donut. Anything that changes the numbers
    goes through propose_kpi instead."""
    with _EDIT_LOCK:
        dash = _dashboard_or_error(schema_id)
        kpi = next((k for k in dash["kpis"] if k["kpi_name"] == kpi_name), None)
        if not kpi:
            raise KpiEditError("That KPI isn't on the dashboard any more.")
        _snapshot(dash)
        for field, limit in EDITABLE_FIELDS.items():
            if field in changes:
                kpi[field] = str(changes[field] or "")[:limit]
        if not kpi["label"].strip():
            kpi["label"] = kpi_name.replace("_", " ").title()
        section = str(changes.get("section") or "").upper()
        if section in SECTIONS:
            kpi["section"] = section
        chart = str(changes.get("chart_type") or "").lower()
        if chart and chart != kpi["chart_type"]:
            if chart not in COMPATIBLE_CHARTS.get(kpi["chart_type"], set()):
                raise KpiEditError("That chart type needs different data — use \"Change with AI\" instead.")
            kpi["chart_type"] = chart
        return _save_dashboard(dash)


def delete_kpi(conn, schema_id: str, kpi_name: str) -> Dict[str, Any]:
    with _EDIT_LOCK:
        dash = _dashboard_or_error(schema_id)
        kpi = next((k for k in dash["kpis"] if k["kpi_name"] == kpi_name), None)
        if not kpi:
            raise KpiEditError("That KPI isn't on the dashboard any more.")
        _snapshot(dash)
        dash["kpis"] = [k for k in dash["kpis"] if k["kpi_name"] != kpi_name]
        # The view is kept so Undo can bring the KPI straight back; restore_version re-creates it anyway.
        return _save_dashboard(dash)


def reorder_kpis(schema_id: str, order: List[str]) -> Dict[str, Any]:
    with _EDIT_LOCK:
        dash = _dashboard_or_error(schema_id)
        rank = {name: i for i, name in enumerate(order)}
        _snapshot(dash)
        for k in dash["kpis"]:
            k["display_order"] = rank.get(k["kpi_name"], len(order) + k.get("display_order", 0))
        return _save_dashboard(dash)


def list_versions(schema_id: str) -> List[Dict[str, Any]]:
    dash = _dashboard_or_error(schema_id)
    return [{"index": i, "saved_at": v["saved_at"], "kpi_count": len(v["kpis"])}
            for i, v in enumerate(dash.get("versions") or [])]


def restore_version(conn, schema_id: str, index: Optional[int] = None) -> Dict[str, Any]:
    """Restores a snapshot (default: the latest one = Undo) and re-creates its views."""
    with _EDIT_LOCK:
        dash = _dashboard_or_error(schema_id)
        versions = dash.get("versions") or []
        if not versions:
            raise KpiEditError("There is nothing to undo.")
        idx = len(versions) - 1 if index is None else index
        if not 0 <= idx < len(versions):
            raise KpiEditError("That version no longer exists.")
        version = versions[idx]
        restored = []
        for k in version["kpis"]:
            try:
                execute(conn, f'CREATE OR REPLACE VIEW "{dash["database"]}"."{dash["schema"]}"."{k["view_name"]}" AS {k["sql_definition"]}')
                restored.append(k)
            except Exception:
                continue
        keep = {k["view_name"] for k in restored}
        for k in dash["kpis"]:
            if k.get("view_name") and k["view_name"] not in keep:
                _drop_view(conn, dash, k["view_name"])
        dash["kpis"] = restored
        dash["sections"] = version.get("sections") or dash.get("sections", [])
        dash["versions"] = versions[:idx]
        return _save_dashboard(dash)
