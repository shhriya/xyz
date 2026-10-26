"""
FastAPI Router for Real Live Snowflake Connection & Multi-Domain Telemetry.
Provides live metadata discovery (Databases, Schemas, Tables) and dynamic query processing.
"""

from fastapi import APIRouter, Body, Query
from typing import Dict, Any, Optional
from .connections import (
    get_saved_connections, add_saved_connection, test_snowflake_connection,
    update_saved_connection_schema, update_saved_connection_cortex, delete_saved_connection,
)
from .service import get_analytics_dashboard_data, query_ai_analyst
from .snowflake_live import (
    fetch_live_databases, fetch_live_schemas, fetch_live_tables, generate_live_telemetry,
    _save_scope_creds, get_shared_live_snowflake_connection,
)

router = APIRouter(prefix="/api/cfo", tags=["cfo_analytics"])


def _connection_for(connection_id: Optional[str]) -> Dict[str, Any]:
    """Resolves a saved connection by id.

    Falls back to the first saved connection only when no id was asked for. Falling back after a
    miss silently served a *different* project — which, with several projects on one Snowflake
    login, meant work could be attributed to and stored against the wrong one.
    """
    conns = get_saved_connections()
    if connection_id:
        return next((c for c in conns if c.get("id") == connection_id), {})
    return conns[0] if conns else {}

@router.get("/connections")
def list_connections():
    """Returns all saved Snowflake connections."""
    return {
        "status": "success",
        "connections": get_saved_connections()
    }

@router.post("/connections")
def save_connection(payload: Dict[str, Any] = Body(...)):
    """Saves a new Snowflake connection."""
    conn = add_saved_connection(payload)
    _save_scope_creds(conn, scope=payload.get("scope", "analytics"))
    return {
        "status": "success",
        "message": f"Connection '{conn['name']}' saved successfully.",
        "connection": conn
    }

@router.post("/connections/update-schema")
def update_connection_schema_endpoint(payload: Dict[str, Any] = Body(...)):
    """Updates database and schema for an active Snowflake connection."""
    # id first: an account is shared by every project on the same Snowflake login, so resolving by
    # account could update a different project than the caller meant.
    connection_id = payload.get("id", "")
    account_or_id = connection_id or payload.get("account", "")
    database = payload.get("database", "")
    schema = payload.get("schema", "")
    updated = update_saved_connection_schema(
        account_or_id, database=database, schema=schema, connection_id=connection_id
    )
    if updated:
        _save_scope_creds(updated, scope=payload.get("scope", "analytics"))
    return {"status": "success", "connection": updated}

@router.post("/connections/test")
def test_connection(payload: Dict[str, Any] = Body(...)):
    """Tests Snowflake connection credentials."""
    return test_snowflake_connection(payload)

@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: str):
    """Permanently removes a saved connection (a 'project'). Does not touch anything already
    materialized in Snowflake itself (semantic views, the Cortex agent, KPI views) — only the
    app's own saved-connection record and its cached credentials for that scope."""
    deleted = delete_saved_connection(connection_id)
    if not deleted:
        return {"status": "error", "message": f"No saved connection found with id {connection_id}."}
    return {"status": "success", "message": "Connection deleted."}

@router.post("/snowflake/databases")
def get_databases(payload: Dict[str, Any] = Body(...)):
    """Fetches real databases from live Snowflake connection."""
    databases = fetch_live_databases(payload)
    return {"status": "success", "databases": databases}

@router.post("/snowflake/schemas")
def get_schemas(payload: Dict[str, Any] = Body(...)):
    """Fetches real schemas in source database from live Snowflake connection."""
    database = payload.get("database", "")
    schemas = fetch_live_schemas(payload, database=database)
    return {"status": "success", "schemas": schemas}

@router.post("/snowflake/tables")
def get_tables(payload: Dict[str, Any] = Body(...)):
    """Fetches real tables in source schema from live Snowflake connection."""
    database = payload.get("database", "")
    schema = payload.get("schema", "")
    tables = fetch_live_tables(payload, database=database, schema=schema)
    return {"status": "success", "tables": tables}

@router.get("/dashboard")
def fetch_dashboard(
    connectionId: Optional[str] = Query(None),
    domain: Optional[str] = Query(None),
    database: Optional[str] = Query(None),
    schema: Optional[str] = Query(None)
):
    """
    Returns domain-adapted analytics dashboard data (10 KPIs, 7 Visualizations, Executive Report).
    Queries real live Snowflake telemetry using authenticated credentials.
    """
    conns = get_saved_connections()
    matched_conn = next((c for c in conns if c.get("id") == connectionId), None)
    if not matched_conn and conns:
        matched_conn = conns[0]
    
    return generate_live_telemetry(credentials=matched_conn or {}, database=database, schema=schema, domain=domain)

@router.post("/dashboard")
def fetch_dashboard_live(payload: Dict[str, Any] = Body(...)):
    """
    POST endpoint for querying live Snowflake dashboard with full credentials.
    """
    credentials = payload.get("credentials", {})
    database = payload.get("database", credentials.get("database"))
    schema = payload.get("schema", credentials.get("schema"))
    domain = payload.get("domain", credentials.get("domain"))

    return generate_live_telemetry(credentials=credentials, database=database, schema=schema, domain=domain)

@router.post("/ai-query")
def process_ai_query(payload: Dict[str, Any] = Body(...)):
    """
    AI Data Analyst Q&A endpoint. Accepts question, domain, and context.
    """
    question = payload.get("question", "")
    domain = payload.get("domain") or "Custom"
    context = payload.get("context", {})
    return query_ai_analyst(question=question, domain=domain, context=context)

@router.post("/enterprise-dashboard")
def fetch_enterprise_dashboard(payload: Dict[str, Any] = Body(...)):
    """
    Massive 5-page enterprise financial monitoring dashboard data endpoint.
    Queries the GOLD semantic layer directly.
    """
    from .enterprise_live import generate_enterprise_telemetry
    return generate_enterprise_telemetry(payload)


# ---------------------------------------------------------------------------
# Semantic View Generator (Phase A) & Cortex Agent Auto-Creation (Phase B)
# ---------------------------------------------------------------------------

def _conn_for_payload(payload: Dict[str, Any]):
    creds = payload.get("credentials") or _connection_for(payload.get("connectionId"))
    conn, _ = get_shared_live_snowflake_connection(creds, scope="analytics")
    return conn, creds


def _pick_default_schema(conn, database: str) -> Dict[str, Any]:
    """Business-user path: no schema picker, so guess one. A schema literally named/containing
    GOLD wins (the medallion convention every other module in this app already assumes); with
    exactly one real schema there's nothing to guess; otherwise it's genuinely ambiguous and the
    caller has to ask — returned as candidates rather than silently picking wrong."""
    from app.modules.ai_governance.snowflake_helpers import safe_identifier
    if not database:
        return {"schema": None, "candidates": []}
    db = safe_identifier(database, "database")
    cur = conn.cursor()
    cur.execute(f'SHOW SCHEMAS IN DATABASE "{db}"')
    names = [r[1] for r in cur.fetchall() if r[1].upper() not in ("INFORMATION_SCHEMA", "PUBLIC")]
    gold = [n for n in names if "GOLD" in n.upper()]
    if len(gold) == 1:
        return {"schema": gold[0], "candidates": names}
    if len(names) == 1:
        return {"schema": names[0], "candidates": names}
    return {"schema": None, "candidates": names}


@router.post("/dashboard/quickstart")
def quickstart_dashboard_endpoint(payload: Dict[str, Any] = Body(...)):
    """The whole business-user flow behind one call: pick a schema if none was given, reuse or
    generate a semantic model, materialize its views, reuse or create a Cortex agent, then
    build/return the dashboard. Every step below is the exact function the manual wizard
    (/semantic/generate, /semantic/draft/{id}/approve, /semantic/{id}/create-agent,
    /dashboard/generate) already calls — this only sequences them and skips whatever already
    exists, so re-opening the tab resolves in one fast call instead of redoing any Snowflake DDL."""
    from . import semantic_view_generator as svg
    from . import kpi_dashboard_service as kds

    try:
        conn, creds = _conn_for_payload(payload)
    except Exception as e:
        return {"status": "error", "stage": "connect", "message": str(e)}
    conn_id = creds.get("id") or creds.get("account") or ""
    database = payload.get("database") or creds.get("database") or ""
    schema = payload.get("schema") or creds.get("schema") or ""

    if not schema:
        try:
            pick = _pick_default_schema(conn, database)
        except Exception as e:
            return {"status": "error", "stage": "schema", "message": str(e)}
        if not pick["schema"]:
            return {"status": "needs_schema", "database": database, "candidates": pick["candidates"]}
        schema = pick["schema"]

    try:
        model = svg.find_active_model(conn_id, database, schema)
        if not model:
            draft = svg.generate_semantic_model(conn, connection_id=conn_id, database=database, schema=schema)
            svg.set_status(draft["id"], "approved")
            model = svg.materialize_semantic_model(conn, draft["id"])
    except Exception as e:
        return {"status": "error", "stage": "semantic_model", "message": str(e)}

    try:
        if not (creds.get("cortexRole") and creds.get("cortexSemanticModel")):
            agent_model = svg.create_agent(
                conn, model["id"], f"{schema}_AGENT",
                warehouse=creds.get("warehouse") or "COMPUTE_WH", username=creds.get("username") or "",
            )
            creds = update_saved_connection_cortex(
                conn_id, cortex_role=agent_model["agent"]["role"],
                cortex_semantic_model=agent_model["agent"]["fq_name"], domain=agent_model.get("name") or "",
            )
            model = agent_model
    except Exception as e:
        return {"status": "error", "stage": "agent", "message": str(e)}

    try:
        owner = creds.get("id") or creds.get("account") or ""
        schema_id = kds.schema_id_for(database, schema, owner)
        dashboard = (kds.resolve_dashboard(schema_id, owner, database, schema)
                     or kds.discover_and_build_dashboard(conn, model, connection_id=owner))
    except Exception as e:
        return {"status": "error", "stage": "dashboard", "message": str(e)}

    return {
        "status": "success", "stage": "ready", "database": database, "schema": schema,
        "model": model, "dashboard": dashboard, "connection": creds,
    }


@router.post("/semantic/generate")
def generate_semantic_model_endpoint(payload: Dict[str, Any] = Body(...)):
    """Introspects the selected tables/views and proposes a Cortex semantic model draft.

    `tables` is an optional explicit selection; without it the whole schema is profiled.
    """
    from . import semantic_view_generator as svg
    try:
        conn, creds = _conn_for_payload(payload)
        model = svg.generate_semantic_model(
            conn, connection_id=creds.get("id") or creds.get("account") or "",
            database=payload.get("database", ""), schema=payload.get("schema", ""),
            domain_hint=payload.get("domainHint"),
            table_names=payload.get("tables") or None,
        )
        return {"status": "success", "model": model}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/semantic/draft/{model_id}")
def get_semantic_draft_endpoint(model_id: str):
    from . import semantic_view_generator as svg
    model = svg.get_draft(model_id)
    if not model:
        return {"status": "error", "message": f"No semantic model found for id {model_id}."}
    return {"status": "success", "model": model}

@router.get("/semantic/models")
def list_semantic_models_endpoint(connectionId: Optional[str] = Query(None)):
    from . import semantic_view_generator as svg
    return {"status": "success", "models": svg.list_models(connection_id=connectionId)}

@router.put("/semantic/draft/{model_id}")
def update_semantic_draft_endpoint(model_id: str, payload: Dict[str, Any] = Body(...)):
    from . import semantic_view_generator as svg
    model = svg.update_draft(model_id, payload)
    if not model:
        return {"status": "error", "message": f"No semantic model found for id {model_id}."}
    return {"status": "success", "model": model}

@router.post("/semantic/draft/{model_id}/approve")
def approve_semantic_draft_endpoint(model_id: str, payload: Dict[str, Any] = Body(default={})):
    """Creates every proposed semantic view in Snowflake and marks the model active."""
    from . import semantic_view_generator as svg
    try:
        conn, _creds = _conn_for_payload(payload)
        svg.set_status(model_id, "approved")
        model = svg.materialize_semantic_model(conn, model_id, only_view=payload.get("viewName"))
        return {"status": "success", "model": model}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/semantic/{model_id}/add-views")
def add_semantic_views_endpoint(model_id: str, payload: Dict[str, Any] = Body(...)):
    """Asks the LLM to propose additional semantic views for tables not yet covered."""
    from . import semantic_view_generator as svg
    try:
        conn, _creds = _conn_for_payload(payload)
        model = svg.add_views(conn, model_id, table_names=payload.get("tables"), instruction=payload.get("instruction"))
        return {"status": "success", "model": model}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/semantic/{model_id}/views")
def add_manual_view_endpoint(model_id: str, payload: Dict[str, Any] = Body(...)):
    """Adds a semantic view the user defined by hand (they choose name + tables)."""
    from . import semantic_view_generator as svg
    try:
        conn, _creds = _conn_for_payload(payload)
        model = svg.add_manual_view(
            conn, model_id,
            view_name=payload.get("viewName", ""),
            description=payload.get("description", ""),
            table_names=payload.get("tables") or [],
        )
        return {"status": "success", "model": model}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.put("/semantic/{model_id}/views/{view_name}")
def update_view_endpoint(model_id: str, view_name: str, payload: Dict[str, Any] = Body(...)):
    from . import semantic_view_generator as svg
    model = svg.update_view(model_id, view_name, payload)
    if not model:
        return {"status": "error", "message": f"View {view_name} not found."}
    return {"status": "success", "model": model}

@router.delete("/semantic/{model_id}/views/{view_name}")
def delete_view_endpoint(model_id: str, view_name: str):
    from . import semantic_view_generator as svg
    model = svg.delete_view(model_id, view_name)
    if not model:
        return {"status": "error", "message": f"View {view_name} not found."}
    return {"status": "success", "model": model}

@router.post("/semantic/{model_id}/create-agent")
def create_cortex_agent_endpoint(model_id: str, payload: Dict[str, Any] = Body(...)):
    """Generates + executes CREATE AGENT DDL, then wires the result onto the saved connection's
    cortexRole/cortexSemanticModel fields so query_ai_analyst() picks it up automatically."""
    from . import semantic_view_generator as svg
    try:
        conn, creds = _conn_for_payload(payload)
        agent_name = payload.get("agentName") or "ANALYTICS_AGENT"
        model = svg.create_agent(
            conn, model_id, agent_name,
            warehouse=payload.get("warehouse") or creds.get("warehouse") or "COMPUTE_WH",
            agent_schema=payload.get("agentSchema"),
            username=creds.get("username") or "",
            role=payload.get("cortexRole"),
        )
        fq_agent = model["agent"]["fq_name"]
        # Bind the connection to the role this flow created, not the account's own role.
        updated_conn = update_saved_connection_cortex(
            creds.get("id") or creds.get("account") or "",
            cortex_role=model["agent"]["role"], cortex_semantic_model=fq_agent,
            domain=model.get("name") or "",
        )
        return {"status": "success", "model": model, "connection": updated_conn}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ---------------------------------------------------------------------------
# KPI-driven shared dashboard (Phase D)
# ---------------------------------------------------------------------------

@router.post("/dashboard/generate")
def generate_kpi_dashboard_endpoint(payload: Dict[str, Any] = Body(...)):
    """Generates the shared, fixed KPI dashboard for a schema.

    mode='semantic' (Path A, default) requires an active semantic model and builds KPIs over it.
    mode='direct'   (Path B) skips the semantic layer and queries the chosen tables/views directly,
                    so no semantic model or Cortex agent is needed.
    """
    from . import semantic_view_generator as svg
    from . import kpi_dashboard_service as kds
    try:
        conn, creds = _conn_for_payload(payload)
        mode = "direct" if str(payload.get("mode", "")).lower() == "direct" else "semantic"

        if mode == "direct":
            database, schema = payload.get("database", ""), payload.get("schema", "")
            if not database or not schema:
                return {"status": "error", "message": "Pick a database and schema first."}
            # Path B needs no stored model — just the scope to query.
            scope = {"database": database, "schema": schema, "available_tables": payload.get("tables") or []}
            dashboard = kds.discover_and_build_dashboard(conn, scope, mode="direct", connection_id=creds.get("id") or creds.get("account") or "")
            return {"status": "success", "dashboard": dashboard}

        model_id = payload.get("modelId")
        model = svg.get_draft(model_id) if model_id else svg.find_active_model(
            creds.get("id") or creds.get("account") or "", payload.get("database", ""), payload.get("schema", ""),
        )
        if not model or model.get("status") != "active":
            return {"status": "error", "message": "No active semantic model for this schema. Generate and approve one first."}
        dashboard = kds.discover_and_build_dashboard(conn, model, mode="semantic", connection_id=creds.get("id") or creds.get("account") or "")
        return {"status": "success", "dashboard": dashboard}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/dashboard/kpis/{schema_id}")
def get_kpi_dashboard_endpoint(schema_id: str, payload: Dict[str, Any] = Body(default={})):
    """Read-only fetch of the shared, precomputed dashboard — same response for every viewer.
    Also executes each KPI's materialized view to attach live row data for rendering."""
    from . import kpi_dashboard_service as kds
    asking = payload.get("connectionId") or (payload.get("credentials") or {}).get("id") or ""
    # schema_id now carries the project, but a dashboard built before that change is stored under
    # the old database+schema-only key — resolve_dashboard finds it, and only when it belongs here.
    dashboard = kds.resolve_dashboard(
        schema_id, asking, payload.get("database") or "", payload.get("schema") or ""
    )
    if not dashboard:
        return {"status": "error", "message": f"No generated dashboard found for schema id {schema_id}."}

    # Second guard: the stored record names its owner, so even a key collision can't leak a
    # dashboard to a project that didn't build it.
    if asking and not kds.dashboard_belongs_to(dashboard, asking):
        return {"status": "error", "message": "No dashboard for this project yet."}
    try:
        conn, _creds = _conn_for_payload(payload)
        cur = conn.cursor()
        kpis_with_data = []
        for k in dashboard["kpis"]:
            try:
                cur.execute(f'SELECT * FROM "{dashboard["database"]}"."{dashboard["schema"]}"."{k["view_name"]}"')
                cols = [d[0].upper() for d in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            except Exception as e:
                rows = []
                k = {**k, "error": str(e)}
            kpis_with_data.append({**k, "data": rows})
        cur.close()
        dashboard = {**dashboard, "kpis": kpis_with_data}
    except Exception as e:
        dashboard = {**dashboard, "data_error": str(e)}
    return {"status": "success", "dashboard": dashboard}


# ---------------------------------------------------------------------------
# Business-user KPI editing (add with AI / change / remove / reorder / undo)
# ---------------------------------------------------------------------------

def _kpi_edit(schema_id: str, payload: Dict[str, Any], action, needs_model: bool = False):
    """Shared wrapper: resolves the connection (and the active semantic model when the AI or SQL
    validation is involved), runs `action`, and turns failures into plain-language messages."""
    from . import semantic_view_generator as svg
    from . import kpi_dashboard_service as kds
    try:
        dash = kds.get_dashboard(schema_id)
        if not dash:
            return {"status": "error", "message": "This project has no dashboard yet."}
        conn = model = None
        if needs_model or payload.get("_needs_conn"):
            conn, creds = _conn_for_payload(payload)
        if needs_model:
            model = svg.find_active_model(creds.get("id") or creds.get("account") or "", dash["database"], dash["schema"])
            if not model:
                return {"status": "error", "message": "This project's data model isn't ready. Open Advanced setup to finish it."}
        return {"status": "success", **action(kds, dash, conn, model)}
    except kds.KpiEditError as e:
        return {"status": "error", "message": str(e)}
    except Exception as e:
        return {"status": "error", "message": f"Something went wrong: {e}"}


@router.post("/dashboard/kpis/{schema_id}/propose")
def propose_kpi_endpoint(schema_id: str, payload: Dict[str, Any] = Body(...)):
    """AI drafts one KPI from a plain-language request and previews it with live rows. Not saved."""
    def act(kds, dash, conn, model):
        existing = next((k for k in dash["kpis"] if k["kpi_name"] == payload.get("kpiName")), None)
        return kds.propose_kpi(conn, model, payload.get("request") or "", dash["kpis"], existing)
    return _kpi_edit(schema_id, payload, act, needs_model=True)


@router.post("/dashboard/kpis/{schema_id}/add")
def add_kpi_endpoint(schema_id: str, payload: Dict[str, Any] = Body(...)):
    return _kpi_edit(schema_id, payload,
                     lambda kds, dash, conn, model: {"dashboard": kds.add_kpi(conn, model, schema_id, payload.get("kpi") or {})},
                     needs_model=True)


@router.post("/dashboard/kpis/{schema_id}/update")
def update_kpi_endpoint(schema_id: str, payload: Dict[str, Any] = Body(...)):
    return _kpi_edit(schema_id, payload, lambda kds, dash, conn, model: {
        "dashboard": kds.update_kpi_meta(schema_id, payload.get("kpiName") or "", payload.get("changes") or {})})


@router.post("/dashboard/kpis/{schema_id}/delete")
def delete_kpi_endpoint(schema_id: str, payload: Dict[str, Any] = Body(...)):
    return _kpi_edit(schema_id, payload, lambda kds, dash, conn, model: {
        "dashboard": kds.delete_kpi(conn, schema_id, payload.get("kpiName") or "")})


@router.post("/dashboard/kpis/{schema_id}/reorder")
def reorder_kpis_endpoint(schema_id: str, payload: Dict[str, Any] = Body(...)):
    return _kpi_edit(schema_id, payload, lambda kds, dash, conn, model: {
        "dashboard": kds.reorder_kpis(schema_id, payload.get("order") or [])})


@router.get("/dashboard/kpis/{schema_id}/versions")
def kpi_versions_endpoint(schema_id: str):
    return _kpi_edit(schema_id, {}, lambda kds, dash, conn, model: {"versions": kds.list_versions(schema_id)})


@router.post("/dashboard/kpis/{schema_id}/restore")
def restore_kpis_endpoint(schema_id: str, payload: Dict[str, Any] = Body(default={})):
    """Undo (no index) or restore a specific saved version; re-creates the views it needs."""
    return _kpi_edit(schema_id, {**payload, "_needs_conn": True}, lambda kds, dash, conn, model: {
        "dashboard": kds.restore_version(conn, schema_id, payload.get("index"))})
