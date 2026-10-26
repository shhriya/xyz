"""
Generalized governance sync pipeline (any source type).

  sync_source(...)        Connect-and-sync entry point used by the Sync modal. Consults GOV_SOURCE_REGISTRY:
                            not registered        -> Setup  (load data + LLM KPI discovery)
                            registered, changed   -> Setup  (for this source only)
                            registered, unchanged -> Refresh
  refresh_source(id)      Plain data pull for an already set-up source using its saved connection details.
                          NEVER calls the LLM and never imports kpi_discovery_service.
  load_dashboard(id)      Executes the stored V_GOV_KPI_* views for a source. NEVER calls the LLM.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from . import source_store
from .adapters import build_adapter
from .adapters.base_adapter import SourceAdapter
from .query_capture_service import capture_queries
from .snowflake_helpers import (
    get_snowflake_conn_from_user_input,
    query_rows,
    safe_identifier,
    validate_snowflake_creds,
)
from .source_registry import (
    CORE_TABLES,
    GOVERNANCE_TABLES,
    compute_schema_signature,
    ensure_governance_tables,
    get_registry_entry,
    load_core_records,
    make_source_id,
    prune_core_history,
    touch_registry_after_refresh,
    upsert_registry_after_setup,
)

EventFn = Callable[[Dict[str, Any]], None]

#: Last dashboard payload per source (used by the chatbot when Snowflake is unreachable). Not a data source for the UI.
_DASHBOARD_CACHE: Dict[str, Dict[str, Any]] = {}

STEP_AUTH, STEP_FETCH, STEP_LOAD, STEP_AI, STEP_DASHBOARD = 1, 2, 3, 4, 5


def _noop(_: Dict[str, Any]) -> None:
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch(adapter: SourceAdapter, emit: EventFn) -> Dict[str, Any]:
    emit({"type": "step", "step": STEP_AUTH, "message": f"Authenticating with {adapter.display_label}"})
    auth_info = adapter.authenticate()
    emit({"type": "step", "step": STEP_FETCH, "message": "Pulling jobs, runs and run results"})
    jobs = adapter.fetch_jobs()
    runs = adapter.fetch_runs()
    run_results = adapter.fetch_run_results()
    return {"auth": auth_info, "jobs": jobs, "runs": runs, "run_results": run_results}


def _load(conn, adapter: SourceAdapter, fq_db: str, fq_schema: str, source_id: str, data: Dict[str, Any]) -> Dict[str, int]:
    fq = f"{fq_db}.{fq_schema}"
    counts = load_core_records(conn, fq, source_id, adapter.source_type, data["jobs"], data["runs"], data["run_results"])
    adapter.create_extension_ddls(conn, fq_db, fq_schema)
    counts.update(adapter.load_extensions(conn, fq_db, fq_schema, source_id))
    # Query level (drill-down level 3). Best-effort: an account without ACCOUNT_USAGE access still
    # gets the primary query per model from the data the adapter already synced.
    capture = capture_queries(conn, fq, source_id, adapter.source_type)
    counts["GOV_RUN_QUERIES"] = max(0, int(capture.get("seeded") or 0))
    # Core rows now accumulate across syncs, so bound them here rather than letting "all-time" grow
    # without limit. Runs after the load so a sync never prunes rows it is about to re-add.
    prune_core_history(conn, fq, source_id)
    return counts


def sync_source(
    source_type: str,
    adapter_config: Dict[str, Any],
    snowflake_creds: Dict[str, Any],
    target_db: Optional[str] = None,
    target_schema: Optional[str] = None,
    emit: EventFn = _noop,
) -> Dict[str, Any]:
    adapter = build_adapter(source_type, adapter_config)
    validate_snowflake_creds(snowflake_creds)
    db = safe_identifier(target_db or adapter.default_target_db, "database")
    schema = safe_identifier(target_schema or adapter.default_target_schema, "schema")
    fq = f"{db}.{schema}"

    data = _fetch(adapter, emit)
    identity = adapter.connection_identity()
    source_id = make_source_id(adapter.source_type, identity)
    signature = compute_schema_signature(adapter, data["jobs"], data["runs"], data["run_results"])

    emit({"type": "step", "step": STEP_LOAD, "message": f"Connecting to Snowflake and loading {fq}"})
    conn = get_snowflake_conn_from_user_input(snowflake_creds)
    try:
        ensure_governance_tables(conn, db, schema)
        registry = get_registry_entry(conn, fq, source_id)
        if registry is None:
            mode, reason = "setup", "New source: not found in GOV_SOURCE_REGISTRY"
        elif registry.get("schema_signature") != signature["signature"]:
            mode, reason = "setup", "Registered source whose metadata structure changed"
        else:
            mode, reason = "refresh", "Registered source with unchanged structure"
        emit({"type": "mode", "mode": mode, "reason": reason, "source_id": source_id})

        counts = _load(conn, adapter, db, schema, source_id, data)
        display_name = adapter.display_name()
        discovery = None
        role_status = None

        if mode == "setup":
            emit({"type": "step", "step": STEP_AI, "message": "Analyzing metadata and building KPIs with AI"})
            # Imported lazily so the Refresh path never loads the LLM-backed discovery module.
            from .kpi_discovery_service import discover_and_build_kpis
            from .readonly_role import provision_readonly_role

            discovery = discover_and_build_kpis(
                conn, adapter, db, schema, source_id,
                progress=lambda msg: emit({"type": "log", "step": STEP_AI, "message": msg}),
            )
            upsert_registry_after_setup(conn, fq, source_id, adapter.source_type, display_name, identity, signature, discovery["layout"])
            role_status = provision_readonly_role(
                conn, db, schema, snowflake_creds.get("warehouse") or "COMPUTE_WH",
                tables=[*GOVERNANCE_TABLES, *adapter.extension_tables()],
                views=[k["view_name"] for k in discovery["active_kpis"]],
                grantee_user=snowflake_creds.get("username") or snowflake_creds.get("user"),
            )
        else:
            touch_registry_after_refresh(conn, fq, source_id)

        now = _now_iso()
        source_store.upsert_source({
            "source_id": source_id,
            "source_type": adapter.source_type,
            "display_name": display_name,
            "connection_identity": identity,
            "adapter_config": adapter_config,
            "snowflake_credentials": snowflake_creds,
            "target_db": db,
            "target_schema": schema,
            "last_synced_at": now,
            "last_mode": mode,
            **({"last_setup_at": now, "readonly_role": role_status} if mode == "setup" else {}),
        })

        emit({"type": "step", "step": STEP_DASHBOARD, "message": "Rendering dashboard from KPI views"})
        dashboard = _build_dashboard(conn, source_store.get_source(source_id))
    finally:
        conn.close()

    return {
        "status": "success",
        "mode": mode,
        "mode_reason": reason,
        "source_id": source_id,
        "message": f"{'Set up' if mode == 'setup' else 'Refreshed'} {display_name} in {fq}",
        "row_counts": counts,
        "kpi_discovery": discovery and {k: discovery[k] for k in ("generated_by", "active_kpis", "rejected_kpis")},
        "readonly_role": role_status,
        "dashboard": dashboard,
    }


def refresh_source(source_id: str) -> Dict[str, Any]:
    """Plain refresh: saved connection -> adapter pull -> load. No LLM, no KPI discovery."""
    entry = source_store.get_source(source_id)
    if not entry:
        raise LookupError(f"Unknown source_id '{source_id}'. Connect it through Sync first.")

    adapter = build_adapter(entry["source_type"], entry.get("adapter_config") or {})
    db, schema = entry["target_db"], entry["target_schema"]
    fq = f"{db}.{schema}"
    data = _fetch(adapter, _noop)
    signature = compute_schema_signature(adapter, data["jobs"], data["runs"], data["run_results"])

    conn = get_snowflake_conn_from_user_input(entry["snowflake_credentials"])
    try:
        # Every statement is CREATE ... IF NOT EXISTS, so this is cheap and idempotent. It is here so
        # a Refresh picks up tables added by a newer build (GOV_RUN_QUERIES, for one) instead of
        # failing against a schema created by an older version until someone re-runs full Setup.
        ensure_governance_tables(conn, db, schema)
        registry = get_registry_entry(conn, fq, source_id)
        if registry is None:
            raise LookupError(f"Source '{source_id}' is not registered in {fq}.GOV_SOURCE_REGISTRY. Run Sync to set it up.")
        counts = _load(conn, adapter, db, schema, source_id, data)
        touch_registry_after_refresh(conn, fq, source_id)
        source_store.update_source(source_id, last_synced_at=_now_iso(), last_mode="refresh")
        dashboard = _build_dashboard(conn, source_store.get_source(source_id))
    finally:
        conn.close()

    schema_changed = registry.get("schema_signature") != signature["signature"]
    return {
        "status": "success",
        "mode": "refresh",
        "source_id": source_id,
        "message": f"Refreshed {entry.get('display_name')}",
        "row_counts": counts,
        "schema_changed": schema_changed,
        "schema_change_hint": (
            "The source's metadata structure changed since setup. Run Sync from the Configure dialog to rebuild KPIs."
            if schema_changed else None
        ),
        "dashboard": dashboard,
    }


def load_dashboard(source_id: str) -> Dict[str, Any]:
    entry = source_store.get_source(source_id)
    if not entry:
        raise LookupError(f"Unknown source_id '{source_id}'.")
    conn = get_snowflake_conn_from_user_input(entry["snowflake_credentials"])
    try:
        return _build_dashboard(conn, entry)
    finally:
        conn.close()


def _build_dashboard(conn, entry: Dict[str, Any]) -> Dict[str, Any]:
    source_id = entry["source_id"]
    fq = f"{entry['target_db']}.{entry['target_schema']}"
    registry = get_registry_entry(conn, fq, source_id) or {}
    try:
        layout = json.loads(registry.get("dashboard_layout") or "{}")
    except json.JSONDecodeError:
        layout = {}

    definitions = query_rows(
        conn,
        f"SELECT KPI_NAME, LABEL, DESCRIPTION, CHART_TYPE, SECTION, DISPLAY_ORDER, UNIT, DISPLAY_CONFIG, VIEW_NAME, "
        f"SQL_DEFINITION, GENERATED_BY, GENERATED_AT FROM {fq}.GOV_KPI_DEFINITIONS "
        f"WHERE SOURCE_ID = %s AND IS_ACTIVE = TRUE ORDER BY DISPLAY_ORDER",
        (source_id,),
    )["rows"]

    panels = []
    for d in definitions:
        panel = {
            "kpi_name": d["KPI_NAME"], "label": d["LABEL"], "description": d["DESCRIPTION"],
            "chart_type": d["CHART_TYPE"], "section": d["SECTION"], "unit": d["UNIT"],
            "display": json.loads(d["DISPLAY_CONFIG"] or "{}"), "view_name": d["VIEW_NAME"],
            "sql_definition": d["SQL_DEFINITION"], "columns": [], "rows": [],
        }
        try:
            result = query_rows(conn, f"SELECT * FROM {fq}.{d['VIEW_NAME']}", limit=500)
            panel.update(result)
        except Exception as e:
            panel["error"] = str(e)
        panels.append(panel)

    dashboard = {
        "status": "success",
        "is_synced": True,
        "source": {k: entry.get(k) for k in ("source_id", "source_type", "display_name", "target_db", "target_schema", "last_synced_at", "last_setup_at")},
        "layout": layout if layout.get("tabs") else {"tabs": []},
        "panels": panels,
        "kpi_generated_by": definitions[0]["GENERATED_BY"] if definitions else None,
        "kpi_generated_at": definitions[0]["GENERATED_AT"] if definitions else None,
        "core_tables": CORE_TABLES,
    }
    _DASHBOARD_CACHE[source_id] = dashboard
    return dashboard


def cached_dashboard(source_id: str) -> Optional[Dict[str, Any]]:
    return _DASHBOARD_CACHE.get(source_id)


def test_source_connection(source_type: str, adapter_config: Dict[str, Any]) -> Dict[str, Any]:
    return build_adapter(source_type, adapter_config).test_connection()
