"""
KPI Discovery (Setup flow only).

After a new or structurally-changed source's metadata lands in Snowflake:
  1. Introspect that source's tables (INFORMATION_SCHEMA + profiled sample rows + VARIANT attribute keys).
  2. Ask the LLM to design the dashboard: tab labels + KPI definitions as SQL with a chart type.
     Only dbt seeds the prompt with known-good KPIs; every other source is designed from its data alone.
  3. Validate every statement (static guard, EXPLAIN object check, execution, row-shape sanity).
     Failed statements get one LLM repair round.
  4. Persist to GOV_KPI_DEFINITIONS and materialize accepted KPIs as V_GOV_KPI_<SOURCE_ID>_<KPI_NAME> views.

This module is the only place (besides the chatbot) allowed to call the LLM.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import llm_client
from .adapters.base_adapter import SourceAdapter
from .snowflake_helpers import execute, json_dumps_safe, to_json_safe
from .source_registry import CORE_TABLES
from .sql_guard import validate_readonly_query

SECTIONS = ["OVERVIEW", "PERFORMANCE", "EXPLORER", "QUALITY", "FRESHNESS", "RECOMMENDATIONS"]
CHART_TYPES = {"kpi_card", "bar", "line", "donut", "table", "recommendation"}
ICONS = [
    "Activity", "AlertTriangle", "BarChart3", "BookOpen", "Briefcase", "CheckCircle2", "Clock", "Database",
    "Droplets", "GitBranch", "Layers", "ShieldCheck", "Tag", "Timer", "TrendingUp", "XCircle", "Zap",
]
BRAND_COLORS = ["#10338D", "#1C58F6", "#16A34A", "#FF3C00", "#DC2626", "#6366F1", "#071339"]
MAX_HEADLINE_KPIS = 10
MAX_PANELS = 26
SAMPLE_ROWS = 200

ProgressFn = Callable[[str], None]


# ---------------------------------------------------------------------------
# 1. Introspection
# ---------------------------------------------------------------------------

def _short(value: Any, limit: int = 120) -> Any:
    value = to_json_safe(value)
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "…"
    return value


def _profile_values(values: List[Any]) -> Dict[str, Any]:
    non_null = [v for v in values if v is not None and v != ""]
    profile: Dict[str, Any] = {"non_null_ratio": round(len(non_null) / len(values), 2) if values else 0}
    hashable = [json.dumps(to_json_safe(v), sort_keys=True, default=str) for v in non_null]
    distinct = sorted(set(hashable))
    if non_null and len(distinct) <= 12:
        profile["distinct_values"] = [_short(json.loads(d)) for d in distinct]
    elif non_null:
        profile["examples"] = [_short(json.loads(d)) for d in distinct[:3]]
    return profile


def introspect_source(conn, target_db: str, target_schema: str, source_id: str, tables: List[str]) -> Dict[str, Any]:
    cur = conn.cursor()
    try:
        cur.execute(
            f"SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM {target_db}.INFORMATION_SCHEMA.COLUMNS "
            f"WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN ({','.join(['%s'] * len(tables))}) ORDER BY TABLE_NAME, ORDINAL_POSITION",
            (target_schema, *tables),
        )
        columns_by_table: Dict[str, List[Tuple[str, str]]] = {}
        for table, column, dtype in cur.fetchall():
            columns_by_table.setdefault(table, []).append((column, dtype))

        profile: Dict[str, Any] = {"tables": {}}
        for table in tables:
            cols = [c for c in columns_by_table.get(table, []) if c[0] != "ATTRIBUTES_RAW"]
            if not cols:
                continue
            cur.execute(f"SELECT COUNT(*) FROM {target_db}.{target_schema}.{table} WHERE SOURCE_ID = %s", (source_id,))
            row_count = int(cur.fetchone()[0])
            col_names = [c[0] for c in cols]
            cur.execute(
                f"SELECT {', '.join(col_names)} FROM {target_db}.{target_schema}.{table} WHERE SOURCE_ID = %s LIMIT {SAMPLE_ROWS}",
                (source_id,),
            )
            rows = cur.fetchall()

            column_profiles = {}
            attribute_keys: Dict[str, List[Any]] = {}
            for i, (name, dtype) in enumerate(cols):
                values = [r[i] for r in rows]
                if dtype == "VARIANT":
                    for v in values:
                        obj = json.loads(v) if isinstance(v, str) else v
                        if isinstance(obj, dict):
                            for k, av in obj.items():
                                attribute_keys.setdefault(k, []).append(av)
                    column_profiles[name] = {"data_type": dtype}
                else:
                    column_profiles[name] = {"data_type": dtype, **_profile_values(values)}

            table_profile: Dict[str, Any] = {"row_count_for_source": row_count, "columns": column_profiles}
            if attribute_keys:
                table_profile["ATTRIBUTES_keys"] = {
                    k: {"json_types": sorted({type(v).__name__ for v in vals if v is not None}), **_profile_values(vals)}
                    for k, vals in sorted(attribute_keys.items())
                }
            table_profile["sample_rows"] = [
                {name: _short(r[i], 80) for i, (name, dtype) in enumerate(cols) if dtype != "VARIANT"}
                for r in rows[:3]
            ]
            profile["tables"][table] = table_profile
        return profile
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# 2. Prompting
# ---------------------------------------------------------------------------

def _materialize_seed(seed: Optional[Dict[str, Any]], fq: str, source_id: str) -> Optional[Dict[str, Any]]:
    if not seed:
        return None
    kpis = []
    for k in seed.get("kpis", []):
        kpis.append({**k, "sql_definition": k["sql_definition"].replace("{FQ}", fq).replace("{SOURCE_ID}", source_id)})
    return {"tabs": seed.get("tabs", []), "kpis": kpis}


def _system_prompt(fq: str, source_id: str, source_type: str, allowed_tables: List[str], seeded: bool) -> str:
    headline_rule = (
        f"Propose 8-{MAX_HEADLINE_KPIS} headline KPIs (chart_type kpi_card). Seeded KPIs that validate against the data may all be kept even if that exceeds {MAX_HEADLINE_KPIS}."
        if seeded else
        f"Propose 8-{MAX_HEADLINE_KPIS} headline KPIs (chart_type kpi_card)."
    )
    return f"""You are a data-governance analyst designing a monitoring dashboard for one connected scheduler/pipeline source.
Source type: {source_type}. Source id: {source_id}. Monitoring schema: {fq}.

You receive a profile of the metadata this source's adapter loaded into Snowflake: tables, column types, observed
values, VARIANT attribute keys (column ATTRIBUTES) and sample rows. Decide what matters for THIS source purely from
that evidence. Do not assume what a "job", "run", "status" or "duration" means beyond what the observed values show
(e.g. use the exact status values you see; if a column is always null, don't build on it).

Return ONLY a JSON object:
{{
  "tabs": [{{"id": one of {SECTIONS}, "label": "short tab label suited to this source", "description": "one sentence"}}],  // all 6 ids, in that order
  "kpis": [{{
      "kpi_name": "UPPER_SNAKE_CASE, unique, <= 40 chars",
      "label": "display label",
      "description": "one short sentence (shown as chart subtitle)",
      "section": one of {SECTIONS},
      "chart_type": one of {sorted(CHART_TYPES)},
      "unit": "optional short unit such as %, s, min, rows",
      "display": {{"icon": one of {ICONS}, "color": one of {BRAND_COLORS}, "orientation": "vertical|horizontal (bar only)"}},
      "sql_definition": "Snowflake SELECT statement"
  }}]
}}

Rules:
- {headline_rule} Headline KPIs belong to OVERVIEW.
- Add supporting panels (bar / line / donut / table / recommendation) so that every tab the data can support has at
  least one panel; at most {MAX_PANELS} kpis in total. RECOMMENDATIONS should hold one `recommendation` panel.
- Only read these tables, always fully qualified as {fq}.<TABLE>: {', '.join(allowed_tables)}.
- EVERY table reference must be filtered with SOURCE_ID = '{source_id}' (including inside CTEs and subqueries).
- Read VARIANT attributes as ATTRIBUTES:key::TYPE; use TRY_TO_* conversions for strings that hold timestamps/numbers.
- Only use columns and attribute keys present in the profile. Single statement, no trailing semicolon, no DDL/DML.
- Result shapes (column names are mandatory):
  kpi_card       -> exactly 1 row with a column VALUE (number, or short string like '3/4')
  bar, donut     -> columns LABEL, VALUE; at most 25 rows
  line           -> first column X (ordered category or timestamp), then one or more numeric series columns
  table          -> any meaningful columns, at most 200 rows, ORDER BY something useful
  recommendation -> columns PRIORITY ('HIGH'|'MEDIUM'|'LOW'), TITLE, DESCRIPTION computed from the data with CASE logic
- Guard divisions with NULLIF and wrap aggregates in COALESCE so empty sources return 0 rather than NULL."""


def _user_prompt(profile: Dict[str, Any], seed: Optional[Dict[str, Any]]) -> str:
    parts = ["METADATA PROFILE:", json.dumps(profile, default=str)]
    if seed:
        parts += [
            "",
            "KNOWN-GOOD STARTING POINT for this source type (proven on other deployments). Confirm each definition against the"
            " profile above: keep what the data supports, fix what it doesn't, and extend with anything valuable it misses.",
            json.dumps(seed),
        ]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 3. Normalization & validation
# ---------------------------------------------------------------------------

def _normalize_kpi(raw: Dict[str, Any], order: int) -> Optional[Dict[str, Any]]:
    name = re.sub(r"[^A-Z0-9_]", "_", str(raw.get("kpi_name") or raw.get("label") or "").upper()).strip("_")[:40]
    chart_type = str(raw.get("chart_type") or "").lower()
    sql = str(raw.get("sql_definition") or "").strip()
    if not name or not sql or chart_type not in CHART_TYPES:
        return None
    section = str(raw.get("section") or "").upper()
    if section not in SECTIONS:
        section = "OVERVIEW" if chart_type == "kpi_card" else ("RECOMMENDATIONS" if chart_type == "recommendation" else "PERFORMANCE")
    display = raw.get("display") if isinstance(raw.get("display"), dict) else {}
    if display.get("icon") not in ICONS:
        display.pop("icon", None)
    if display.get("color") not in BRAND_COLORS:
        display.pop("color", None)
    return {
        "kpi_name": name,
        "label": str(raw.get("label") or name.replace("_", " ").title())[:500],
        "description": str(raw.get("description") or "")[:2000],
        "section": section,
        "chart_type": chart_type,
        "unit": str(raw.get("unit") or "")[:20],
        "display": display,
        "sql_definition": sql,
        "display_order": order,
    }


def _normalize_proposal(proposal: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    tabs_by_id = {str(t.get("id", "")).upper(): t for t in (proposal.get("tabs") or []) if isinstance(t, dict)}
    tabs = [
        {"id": s, "label": str((tabs_by_id.get(s) or {}).get("label") or s.title())[:60],
         "description": str((tabs_by_id.get(s) or {}).get("description") or "")[:300]}
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
    return tabs, kpis[:MAX_PANELS]


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
            return f"table returned more than 200 rows; add a LIMIT."
    elif chart_type == "recommendation":
        if not {"PRIORITY", "TITLE", "DESCRIPTION"} <= cols:
            return f"recommendation must return PRIORITY, TITLE, DESCRIPTION (got {columns})."
    return None


def validate_kpi(conn, kpi: Dict[str, Any], source_id: str, target_db: str, target_schema: str, allowed_tables: List[str]) -> Optional[str]:
    error, normalized = validate_readonly_query(conn, kpi["sql_definition"], source_id, target_db, target_schema, allowed_tables)
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
    return _shape_error(kpi["chart_type"], columns, rows)


def _validate_all(conn, kpis, source_id, target_db, target_schema, allowed_tables):
    accepted, rejected = [], []
    for k in kpis:
        err = validate_kpi(conn, k, source_id, target_db, target_schema, allowed_tables)
        (rejected if err else accepted).append({**k, "validation_message": err or "ok"})
    return accepted, rejected


# ---------------------------------------------------------------------------
# Heuristic fallback (no LLM reachable, non-seeded source types)
# Mechanically derived from the profile: counts, observed low-cardinality distributions, envelope timings.
# ---------------------------------------------------------------------------

def _heuristic_proposal(profile: Dict[str, Any], fq: str, source_id: str) -> Dict[str, Any]:
    kpis: List[Dict[str, Any]] = []
    where = f"WHERE SOURCE_ID = '{source_id}'"
    tables = profile.get("tables", {})
    for table, tp in tables.items():
        if tp.get("row_count_for_source", 0) == 0:
            continue
        pretty = table.replace("GOV_", "").replace("_", " ").title()
        kpis.append({"kpi_name": f"{table}_COUNT", "label": f"Total {pretty}", "section": "OVERVIEW", "chart_type": "kpi_card",
                     "sql_definition": f"SELECT COUNT(*) AS VALUE FROM {fq}.{table} {where}"})
        cols = tp.get("columns", {})
        if cols.get("DURATION_SECS", {}).get("non_null_ratio", 0) > 0:
            kpis.append({"kpi_name": f"{table}_AVG_DURATION", "label": f"Avg {pretty} Duration", "unit": "s", "section": "OVERVIEW",
                         "chart_type": "kpi_card",
                         "sql_definition": f"SELECT COALESCE(ROUND(AVG(DURATION_SECS), 1), 0) AS VALUE FROM {fq}.{table} {where}"})
        if "distinct_values" in cols.get("STATUS", {}):
            kpis.append({"kpi_name": f"{table}_STATUS_MIX", "label": f"{pretty} by Status", "section": "PERFORMANCE", "chart_type": "donut",
                         "sql_definition": f"SELECT STATUS AS LABEL, COUNT(*) AS VALUE FROM {fq}.{table} {where} GROUP BY STATUS ORDER BY VALUE DESC LIMIT 25"})
        if cols.get("STARTED_AT", {}).get("non_null_ratio", 0) > 0 and cols.get("DURATION_SECS", {}).get("non_null_ratio", 0) > 0 and table == "GOV_RUNS":
            kpis.append({"kpi_name": "RUN_DURATION_TREND", "label": "Duration Trend", "unit": "s", "section": "PERFORMANCE", "chart_type": "line",
                         "sql_definition": f"SELECT X, DURATION_SECS FROM (SELECT STARTED_AT AS X, DURATION_SECS FROM {fq}.{table} {where} AND STARTED_AT IS NOT NULL ORDER BY STARTED_AT DESC LIMIT 50) ORDER BY X"})
        for key, kp in list(tp.get("ATTRIBUTES_keys", {}).items()):
            values = kp.get("distinct_values") or []
            if 2 <= len(values) <= 12 and kp.get("json_types") in (["str"], ["bool"]) and len([k for k in kpis if k["chart_type"] == "bar"]) < 4:
                safe_key = re.sub(r"[^A-Za-z0-9_]", "", key)
                if safe_key:
                    kpis.append({"kpi_name": f"{table}_{safe_key.upper()}_MIX"[:40], "label": f"{pretty} by {key}", "section": "QUALITY", "chart_type": "bar",
                                 "sql_definition": f"SELECT COALESCE(ATTRIBUTES:{safe_key}::STRING, '(none)') AS LABEL, COUNT(*) AS VALUE FROM {fq}.{table} {where} GROUP BY LABEL ORDER BY VALUE DESC LIMIT 25"})
        listing_cols = [c for c, cp in cols.items() if c not in ("SOURCE_ID", "SOURCE_TYPE", "ATTRIBUTES", "SYNC_TIMESTAMP") and cp.get("non_null_ratio", 0) > 0][:8]
        if listing_cols:
            section = "EXPLORER" if table in ("GOV_JOBS",) or table not in CORE_TABLES else "PERFORMANCE"
            kpis.append({"kpi_name": f"{table}_LISTING", "label": f"{pretty} Inventory", "section": section, "chart_type": "table",
                         "sql_definition": f"SELECT {', '.join(listing_cols)} FROM {fq}.{table} {where} LIMIT 200"})
    return {"tabs": [{"id": s, "label": s.title()} for s in SECTIONS], "kpis": kpis}


# ---------------------------------------------------------------------------
# 4. Persistence
# ---------------------------------------------------------------------------

def view_name_for(source_id: str, kpi_name: str) -> str:
    return f"V_GOV_KPI_{source_id}_{kpi_name}"[:255]


def _drop_existing_views(conn, target_db: str, target_schema: str, source_id: str) -> None:
    cur = conn.cursor()
    try:
        cur.execute(f"SHOW VIEWS IN SCHEMA {target_db}.{target_schema}")
        name_idx = [d[0].lower() for d in cur.description].index("name")
        prefix = f"V_GOV_KPI_{source_id}_"
        stale = [r[name_idx] for r in cur.fetchall() if str(r[name_idx]).upper().startswith(prefix)]
    finally:
        cur.close()
    for view in stale:
        execute(conn, f"DROP VIEW IF EXISTS {target_db}.{target_schema}.{view}")


def _persist(conn, target_db: str, target_schema: str, source_id: str, accepted, rejected, generated_by: str) -> List[Dict[str, Any]]:
    fq = f"{target_db}.{target_schema}"
    generated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    execute(conn, f"UPDATE {fq}.GOV_KPI_DEFINITIONS SET IS_ACTIVE = FALSE WHERE SOURCE_ID = %s", (source_id,))
    _drop_existing_views(conn, target_db, target_schema, source_id)

    active = []
    rows = []
    for k in accepted:
        view = view_name_for(source_id, k["kpi_name"])
        message = k["validation_message"]
        is_active = True
        try:
            execute(conn, f"CREATE OR REPLACE VIEW {fq}.{view} AS {k['sql_definition']}")
            active.append({**k, "view_name": view})
        except Exception as e:
            is_active, message, view = False, f"View creation failed: {e}", None
        rows.append((k, view, message, is_active))
    for k in rejected:
        rows.append((k, None, k["validation_message"], False))

    insert_sql = (
        f"INSERT INTO {fq}.GOV_KPI_DEFINITIONS (SOURCE_ID, KPI_NAME, LABEL, DESCRIPTION, SQL_DEFINITION, CHART_TYPE, SECTION, "
        f"DISPLAY_ORDER, UNIT, DISPLAY_CONFIG, VIEW_NAME, GENERATED_BY, VALIDATION_MESSAGE, GENERATED_AT, IS_ACTIVE) "
        f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
    )
    cur = conn.cursor()
    try:
        cur.executemany(insert_sql, [
            (source_id, k["kpi_name"], k["label"], k["description"], k["sql_definition"], k["chart_type"], k["section"],
             k["display_order"], k["unit"], json_dumps_safe(k.get("display") or {}), view, generated_by,
             (message or "")[:4000], generated_at, is_active)
            for k, view, message, is_active in rows
        ])
    finally:
        cur.close()
    return active


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def discover_and_build_kpis(
    conn, adapter: SourceAdapter, target_db: str, target_schema: str, source_id: str,
    progress: Optional[ProgressFn] = None,
) -> Dict[str, Any]:
    log = progress or (lambda msg: print(f"[kpi discovery] {msg}"))
    fq = f"{target_db}.{target_schema}"
    allowed_tables = [*CORE_TABLES, *adapter.extension_tables()]

    log("Introspecting source tables and columns")
    profile = introspect_source(conn, target_db, target_schema, source_id, allowed_tables)
    seed = _materialize_seed(adapter.kpi_seed_hints(), fq, source_id)
    system = _system_prompt(fq, source_id, adapter.source_type, allowed_tables, seeded=bool(seed))
    turns = [{"role": "user", "content": _user_prompt(profile, seed)}]

    log("Asking the LLM to propose KPIs")
    proposal = llm_client.complete_json(system, turns, temperature=0.2, max_tokens=16000, timeout=120)
    generated_by = "llm"
    if not proposal or not proposal.get("kpis"):
        if seed:
            log("LLM unavailable; falling back to the validated dbt seed KPIs")
            proposal, generated_by = seed, "seed_fallback"
        else:
            log("LLM unavailable; deriving KPIs mechanically from the metadata profile")
            proposal, generated_by = _heuristic_proposal(profile, fq, source_id), "heuristic_fallback"

    tabs, kpis = _normalize_proposal(proposal)
    log(f"Validating {len(kpis)} proposed KPI definitions")
    accepted, rejected = _validate_all(conn, kpis, source_id, target_db, target_schema, allowed_tables)

    if rejected and generated_by == "llm":
        log(f"Repairing {len(rejected)} KPI definitions that failed validation")
        repair_turns = turns + [
            {"role": "assistant", "content": json.dumps({"tabs": tabs, "kpis": kpis})},
            {"role": "user", "content": (
                "These KPI definitions failed validation. Return JSON {\"kpis\": [...]} containing corrected versions of ONLY "
                "these kpis (same kpi_name), or omit any that cannot be fixed with the available data:\n"
                + json.dumps([{"kpi_name": r["kpi_name"], "chart_type": r["chart_type"], "sql_definition": r["sql_definition"],
                               "error": r["validation_message"]} for r in rejected])
            )},
        ]
        repaired = llm_client.complete_json(system, repair_turns, temperature=0.1, max_tokens=12000, timeout=120)
        if repaired and repaired.get("kpis"):
            order_by_name = {r["kpi_name"]: r["display_order"] for r in rejected}
            _, fixed = _normalize_proposal({"kpis": repaired["kpis"]})
            fixed = [{**f, "display_order": order_by_name.get(f["kpi_name"], f["display_order"])} for f in fixed if f["kpi_name"] in order_by_name]
            fixed_ok, still_bad = _validate_all(conn, fixed, source_id, target_db, target_schema, allowed_tables)
            fixed_names = {f["kpi_name"] for f in fixed_ok}
            accepted += fixed_ok
            rejected = [r for r in rejected if r["kpi_name"] not in fixed_names]
            rejected = [r for r in rejected if r["kpi_name"] not in {s["kpi_name"] for s in still_bad}] + still_bad

    if not accepted:
        raise RuntimeError(
            "KPI discovery produced no valid KPI definitions. "
            + "; ".join(f"{r['kpi_name']}: {r['validation_message']}" for r in rejected[:5])
        )

    accepted.sort(key=lambda k: k["display_order"])
    log(f"Materializing {len(accepted)} KPI views")
    active = _persist(conn, target_db, target_schema, source_id, accepted, rejected, generated_by)
    return {
        "layout": {"tabs": tabs},
        "generated_by": generated_by,
        "active_kpis": [{"kpi_name": k["kpi_name"], "view_name": k["view_name"]} for k in active],
        "rejected_kpis": [{"kpi_name": r["kpi_name"], "reason": r["validation_message"]} for r in rejected],
    }
