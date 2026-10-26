from fastapi import APIRouter, Body
from typing import Dict, Any
from .cost_service import get_snowflake_cost_summary, test_snowflake_live_connection
from .levels.overview import get_org_overview
from .levels.platform import get_platform_summary
from .levels.cortex_ai import get_cortex_ai_summary, get_request_detail, list_service_requests
from .levels.cortex_requests import list_cortex_requests, get_cortex_request_detail as get_query_request_detail, get_cortex_users_summary
from .levels.shared import get_filter_dimensions
from app.modules.cfo_analytics.snowflake_live import get_shared_live_snowflake_connection

router = APIRouter(prefix="/api/cfo/costing", tags=["snowflake_costing"])

@router.post("/summary")
def get_cost_summary(payload: Dict[str, Any] = Body(default={})):
    """
    Get overall Snowflake cost summary, individual user usage attribution,
    warehouse compute stats, real-time queries, Cortex tokens, and AI FinOps suggestions.
    Connects live if credentials are provided in payload. Zero mocked data.
    """
    return get_snowflake_cost_summary(credentials=payload)

@router.post("/test-connection")
def test_snowflake_cost_connection(payload: Dict[str, Any] = Body(...)):
    """
    Real-time genuine Snowflake connection test (zero mock).
    Validates user credentials against live Snowflake and returns actual latency and edition.
    """
    return test_snowflake_live_connection(credentials=payload)

@router.post("/overview")
def get_overview(payload: Dict[str, Any] = Body(default={})):
    """
    Level 0: organization-wide spend overview (total/platform/Cortex split, spend by category,
    daily trend, top services and accounts). Degrades to this account only when the connected
    role lacks SNOWFLAKE.ORGANIZATION_USAGE access.
    """
    return get_org_overview(credentials=payload)

@router.post("/platform")
def get_platform(payload: Dict[str, Any] = Body(default={})):
    """
    Level 1 Platform: warehouses, warehouses-by-team, top queries, cloud services, storage
    (by database/table), data transfer, and other serverless features.
    """
    return get_platform_summary(credentials=payload)

@router.post("/cortex")
def get_cortex(payload: Dict[str, Any] = Body(default={})):
    """
    Level 1 Cortex AI: usage and spend across every discoverable Cortex service usage view
    (AI Functions, Agents, Snowflake Intelligence/CoWork, Analyst, Search, REST API, Document
    Processing, Fine-tuning, Provisioned Throughput, Guardrails, Cortex Code, AI Gateway).
    """
    return get_cortex_ai_summary(credentials=payload)

@router.post("/filters")
def get_filters(payload: Dict[str, Any] = Body(default={})):
    """
    Shared filter-bar dimensions (warehouses, roles, environments, departments, service types,
    accounts) reused across the Overview, Platform and Cortex AI tabs.
    """
    try:
        conn, _ = get_shared_live_snowflake_connection(payload, scope="costing")
        cur = conn.cursor()
        dims = get_filter_dimensions(cur)
        return {"status": "success", **dims}
    except Exception as ex:
        return {"status": "error", "message": str(ex)}

@router.post("/cortex/request-list")
def get_cortex_request_list(payload: Dict[str, Any] = Body(...)):
    """
    Level 3 step one: the recent individual requests for a trace-capable Cortex service (Agents,
    Snowflake Intelligence), so the UI has something to pick from before asking for one request's detail.
    """
    service = payload.get("service", "")
    limit = payload.get("limit", 20)
    return list_service_requests(credentials=payload, service=service, limit=limit)

@router.post("/cortex/request-detail")
def get_cortex_request_detail(payload: Dict[str, Any] = Body(...)):
    """
    Level 3 step two: best-effort prompt/response lookup for one specific request, for the handful
    of Cortex services that have a request/trace log. Returns an "unavailable" status for the rest.
    """
    service = payload.get("service", "")
    request_id = payload.get("requestId", "")
    return get_request_detail(credentials=payload, service=service, request_id=request_id)

@router.post("/cortex/requests")
def get_cortex_requests(payload: Dict[str, Any] = Body(...)):
    """
    Granular per-request audit and telemetry log for all Cortex AI function and agent calls.
    Supports user filtering, model filtering, text search, and pagination.
    """
    filters = payload.get("filters", {})
    page = int(payload.get("page", 1))
    page_size = int(payload.get("pageSize", 25))
    sort_by = payload.get("sortBy", "START_TIME")
    sort_order = payload.get("sortOrder", "DESC")
    return list_cortex_requests(
        credentials=payload,
        filters=filters,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order
    )

@router.post("/cortex/requests/{query_id}")
def get_single_cortex_request(query_id: str, payload: Dict[str, Any] = Body(default={})):
    """
    Detailed inspection for an individual Cortex request including prompt extraction,
    raw SQL, cost breakdown, and warehouse metrics.
    """
    return get_query_request_detail(credentials=payload, query_id=query_id)

@router.post("/cortex/users")
def get_cortex_users(payload: Dict[str, Any] = Body(default={})):
    """
    Aggregated per-user scorecard of Cortex AI invocations, latency, and credit spend.
    """
    time_range = payload.get("timeRange", "monthly")
    return get_cortex_users_summary(credentials=payload, time_range=time_range)

