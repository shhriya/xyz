from fastapi import APIRouter, Body
from typing import Dict, Any
from .dbt_cost_service import get_dbt_cost_summary, test_dbt_cost_connection, get_dbt_build_usage

router = APIRouter(prefix="/api/dbt/costing", tags=["dbt_costing"])


@router.post("/summary")
def get_cost_summary(payload: Dict[str, Any] = Body(default={})):
    """
    Live dbt Cloud billing/plan/seat telemetry, derived entirely from the dbt Cloud Admin API v2
    with the caller's own service token (either passed directly, or via a registered
    Monitoring source's sourceId). Zero mocked data.
    """
    return get_dbt_cost_summary(payload)


@router.post("/build-usage")
def get_build_usage(payload: Dict[str, Any] = Body(default={})):
    """
    Real dbt Cloud model-build usage (run counts/outcomes today/week/month, trend, sampled
    model-level success/fail). No build quota — that figure isn't exposed by any dbt Cloud API.
    """
    return get_dbt_build_usage(payload)


@router.post("/test-connection")
def test_cost_connection(payload: Dict[str, Any] = Body(...)):
    """Real dbt Cloud authentication test (zero mock)."""
    return test_dbt_cost_connection(payload)
