"""
Common governance AI Copilot (source-aware, not source-specific).

Every call is scoped to one source_id. Before prompting, the service loads that source's table/column
schema and its active GOV_KPI_DEFINITIONS (with current values) as context. When the model needs more
than the context, it may propose a SELECT, which is guarded (single read-only statement, SOURCE_ID
filter, EXPLAIN-verified object list) and executed through a connection that runs as the read-only
chatbot role. If that role is unavailable, no SQL is executed at all.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import llm_client, source_store
from .adapters import get_adapter_class
from .readonly_role import CHATBOT_ROLE, connect_as_chatbot
from .snowflake_helpers import query_rows
from .source_registry import CORE_TABLES
from .sql_guard import validate_readonly_query
from .sync_service import cached_dashboard

logger = logging.getLogger("governance_chat_service")

MAX_RESULT_ROWS = 100


def _allowed_tables(source_type: str) -> List[str]:
    return [*CORE_TABLES, "GOV_KPI_DEFINITIONS", *get_adapter_class(source_type)({}).extension_tables()]


def _schema_context(conn, entry: Dict[str, Any], tables: List[str]) -> Dict[str, List[str]]:
    rows = query_rows(
        conn,
        f"SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM {entry['target_db']}.INFORMATION_SCHEMA.COLUMNS "
        f"WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN ({','.join(['%s'] * len(tables))}) ORDER BY TABLE_NAME, ORDINAL_POSITION",
        (entry["target_schema"], *tables),
    )["rows"]
    schema: Dict[str, List[str]] = {}
    for r in rows:
        if r["COLUMN_NAME"] != "ATTRIBUTES_RAW":
            schema.setdefault(r["TABLE_NAME"], []).append(f"{r['COLUMN_NAME']} {r['DATA_TYPE']}")
    return schema


def _attribute_keys_context(conn, entry: Dict[str, Any]) -> Dict[str, List[str]]:
    fq = f"{entry['target_db']}.{entry['target_schema']}"
    keys: Dict[str, List[str]] = {}
    for table in CORE_TABLES:
        try:
            rows = query_rows(
                conn,
                f"SELECT DISTINCT f.KEY AS K FROM {fq}.{table} t, LATERAL FLATTEN(input => t.ATTRIBUTES) f "
                f"WHERE t.SOURCE_ID = %s LIMIT 200",
                (entry["source_id"],),
            )["rows"]
            keys[table] = sorted(r["K"] for r in rows)
        except Exception as e:
            logger.info("attribute key lookup failed for %s: %s", table, e)
    return keys


def _kpi_context(conn: Optional[Any], entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Active KPI definitions for this source, with current values for headline KPIs."""
    fq = f"{entry['target_db']}.{entry['target_schema']}"
    if conn is not None:
        defs = query_rows(
            conn,
            f"SELECT KPI_NAME, LABEL, DESCRIPTION, CHART_TYPE, SECTION, UNIT, VIEW_NAME, SQL_DEFINITION "
            f"FROM {fq}.GOV_KPI_DEFINITIONS WHERE SOURCE_ID = %s AND IS_ACTIVE = TRUE ORDER BY DISPLAY_ORDER",
            (entry["source_id"],),
        )["rows"]
        out = []
        for d in defs:
            item = {k.lower(): v for k, v in d.items()}
            try:
                result = query_rows(conn, f"SELECT * FROM {fq}.{d['VIEW_NAME']}", limit=15)
                item["current_rows"] = result["rows"]
            except Exception as e:
                item["current_rows_error"] = str(e)[:200]
            out.append(item)
        return out
    dashboard = cached_dashboard(entry["source_id"]) or {}
    return [
        {"kpi_name": p["kpi_name"], "label": p["label"], "description": p.get("description"), "chart_type": p["chart_type"],
         "unit": p.get("unit"), "sql_definition": p.get("sql_definition"), "current_rows": (p.get("rows") or [])[:15]}
        for p in dashboard.get("panels", [])
    ]


def _system_prompt(entry: Dict[str, Any], schema: Dict[str, Any], attr_keys: Dict[str, Any], kpis: List[Dict[str, Any]], can_query: bool) -> str:
    fq = f"{entry['target_db']}.{entry['target_schema']}"
    query_rules = (
        f"""If the context does not already answer the question precisely, set "sql" to ONE Snowflake SELECT that answers it:
- read only the tables listed in SCHEMA, fully qualified as {fq}.<TABLE>
- filter every table reference with SOURCE_ID = '{entry['source_id']}'
- VARIANT attributes are read as ATTRIBUTES:key::TYPE
- add LIMIT {MAX_RESULT_ROWS}
Otherwise set "sql" to null."""
        if can_query else
        'Live querying is unavailable right now; always set "sql" to null and answer from the context only.'
    )
    return f"""You are the AI Governance Copilot for the Relanto Data Intelligence platform.
You are answering questions about ONE monitored source only: {entry.get('display_name')} (type {entry['source_type']}, source id {entry['source_id']}),
whose metadata lives in {fq}. Never discuss or query other sources.

Respond with a JSON object: {{"answer": "markdown answer", "sql": "SELECT ... or null"}}.
Answer conversationally with clean Markdown (short sections, bullets, **bold** key metrics). Don't show SQL in the answer unless the user asks for it.
{query_rules}

SCHEMA (table -> columns):
{json.dumps(schema)}

ATTRIBUTE KEYS observed in each table's ATTRIBUTES column:
{json.dumps(attr_keys)}

DASHBOARD KPI DEFINITIONS for this source (with current values):
{json.dumps(kpis, default=str)[:60000]}
"""


def _fallback_reply(entry: Dict[str, Any], kpis: List[Dict[str, Any]]) -> str:
    lines = [f"### {entry.get('display_name')} — Current KPIs", ""]
    for k in kpis:
        rows = k.get("current_rows") or []
        if k.get("chart_type") == "kpi_card" and rows:
            lines.append(f"- **{k['label']}**: {rows[0].get('VALUE')}{k.get('unit') or ''}")
    if len(lines) == 2:
        lines.append("No KPI values are available yet. Refresh the dashboard and try again.")
    lines += ["", "_The AI model is currently unreachable, so this is a direct summary of the dashboard KPIs._"]
    return "\n".join(lines)


def _history_turns(history: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return [
        {"role": "user" if h.get("role") == "user" else "assistant", "content": h.get("content", "")}
        for h in (history or [])[-6:] if h.get("content")
    ]


def process_chat_message(source_id: str, user_message: str, conversation_history: List[Dict[str, str]]) -> Dict[str, Any]:
    entry = source_store.get_source(source_id)
    if not entry:
        raise LookupError(f"Unknown source_id '{source_id}'.")
    tables = _allowed_tables(entry["source_type"])

    conn = None
    role_error = None
    try:
        conn = connect_as_chatbot(entry["snowflake_credentials"])
    except Exception as e:
        role_error = str(e)
        logger.warning("Read-only chatbot connection unavailable for %s: %s", source_id, e)

    sql_used, query_results, execution_source = None, None, "copilot_context"
    try:
        schema = _schema_context(conn, entry, tables) if conn else {}
        attr_keys = _attribute_keys_context(conn, entry) if conn else {}
        kpis = _kpi_context(conn, entry)
        system = _system_prompt(entry, schema, attr_keys, kpis, can_query=conn is not None)
        turns = _history_turns(conversation_history) + [{"role": "user", "content": user_message}]

        first = llm_client.complete_json(system, turns, temperature=0.3, max_tokens=4000, timeout=45)
        if not first:
            reply = _fallback_reply(entry, kpis)
            execution_source = "kpi_summary_fallback"
        else:
            reply = first.get("answer") or ""
            proposed_sql = first.get("sql")
            if proposed_sql and conn is not None:
                error, normalized = validate_readonly_query(
                    conn, proposed_sql, source_id, entry["target_db"], entry["target_schema"], tables,
                )
                if error:
                    logger.info("Chat SQL rejected: %s", error)
                else:
                    try:
                        result = query_rows(conn, f"SELECT * FROM ({normalized}) LIMIT {MAX_RESULT_ROWS}")
                        sql_used, execution_source = normalized, "live_snowflake"
                        query_results = {**result, "row_count": len(result["rows"])}
                        second = llm_client.complete_json(
                            system,
                            turns + [
                                {"role": "assistant", "content": json.dumps(first)},
                                {"role": "user", "content": "Query results (JSON). Answer my original question using them; set sql to null.\n"
                                                            + json.dumps(result["rows"][:50], default=str)},
                            ],
                            temperature=0.3, max_tokens=3000, timeout=45,
                        )
                        if second and second.get("answer"):
                            reply = second["answer"]
                    except Exception as e:
                        logger.info("Chat SQL execution failed: %s", e)
            if not reply:
                reply = _fallback_reply(entry, kpis)
    finally:
        if conn is not None:
            conn.close()

    if role_error:
        reply += f"\n\n_Live querying is disabled: the read-only role `{CHATBOT_ROLE}` is not available ({role_error[:160]})._"

    labels = [k["label"] for k in kpis if k.get("label")]
    suggestions = [f"Explain the current {labels[0]}"] if labels else []
    suggestions += [f"What is driving {l}?" for l in labels[1:3]]
    suggestions.append("What should we fix first on this dashboard?")

    return {
        "status": "success",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source_id": source_id,
        "reply": reply,
        "sql": sql_used if any(w in user_message.lower() for w in ("sql", "query", "select")) else None,
        "query_results": query_results,
        "execution_source": execution_source,
        "target_database": entry["target_db"],
        "target_schema": entry["target_schema"],
        "suggested_questions": suggestions[:4],
    }
