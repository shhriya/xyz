from fastapi import APIRouter, Body
from typing import Dict, Any
from . import service

router = APIRouter(prefix="/api/airflow/costing", tags=["managed_airflow_costing"])


@router.get("/providers")
def get_providers():
    """Lists supported managed Airflow providers and the credential fields each needs."""
    return service.list_providers()


@router.post("/test-connection")
def test_connection(payload: Dict[str, Any] = Body(...)):
    return service.test_connection(payload)


@router.post("/summary")
def get_cost_summary(payload: Dict[str, Any] = Body(default={})):
    """
    Live managed-Airflow cost telemetry. `payload.provider` selects mwaa/composer/astronomer;
    the rest of the payload is that provider's own credential fields (see /providers).
    """
    return service.get_cost_summary(payload)
