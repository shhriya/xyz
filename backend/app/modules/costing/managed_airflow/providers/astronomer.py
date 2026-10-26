"""
Astronomer (Astro) cost tracking.

Real data source: the Astro Platform API (`api.astronomer.io/platform/v1beta1`), called with
the user's own API token, for the deployment's actual resource configuration — scheduler size,
worker queues (machine type, min/max worker count). Astro bills primarily via Astro Compute
Unit (ACU) hours consumed by these resources.

Deliberately NOT computed here: a dollar total. Unlike AWS (Cost Explorer) or GCP (BigQuery
billing export), Astronomer does not publish a documented API that returns an account's actual
invoiced $ amount, and ACU-hour pricing varies by contract/plan tier. Rather than multiply a
real resource count by a guessed rate — which is exactly the kind of fabricated number this
codebase has deliberately avoided everywhere else (see dbt Cloud billing) — this reports the
real resource configuration and points to Astro's own Usage page for the actual $ figure.

NOT YET LIVE-TESTED, and lower confidence than the AWS/GCP providers: no Astro account or
current API documentation was available while writing this, so the exact endpoint path and
response field names below should be verified against Astronomer's current API reference
(https://www.astronomer.io/docs/astro/api/overview) and adjusted before relying on this.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict

import requests

logger = logging.getLogger("uvicorn.error")

API_BASE = "https://api.astronomer.io/platform/v1beta1"

CREDENTIAL_FIELDS = [
    {"key": "astroApiToken", "label": "Astro API Token", "type": "password", "required": True,
     "help": "Astro → Organization Settings → API Tokens"},
    {"key": "astroOrganizationId", "label": "Astro Organization ID", "type": "text", "required": True},
    {"key": "astroDeploymentId", "label": "Astro Deployment ID", "type": "text", "required": True},
]


def _headers(payload: Dict[str, Any]) -> Dict[str, str]:
    return {"Authorization": f"Bearer {payload.get('astroApiToken', '').strip()}", "Accept": "application/json"}


def _get_deployment(payload: Dict[str, Any]) -> Dict[str, Any]:
    org_id = (payload.get("astroOrganizationId") or "").strip()
    deployment_id = (payload.get("astroDeploymentId") or "").strip()
    url = f"{API_BASE}/organizations/{org_id}/deployments/{deployment_id}"
    resp = requests.get(url, headers=_headers(payload), timeout=20)
    resp.raise_for_status()
    return resp.json()


def test_connection(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not payload.get("astroApiToken") or not payload.get("astroOrganizationId") or not payload.get("astroDeploymentId"):
        return {"status": "error", "message": "API Token, Organization ID, and Deployment ID are all required."}
    try:
        deployment = _get_deployment(payload)
        return {
            "status": "success",
            "connected": True,
            "deploymentName": deployment.get("name"),
            "message": f"Connected to Astro deployment '{deployment.get('name', payload.get('astroDeploymentId'))}'.",
        }
    except requests.HTTPError as ex:
        return {"status": "error", "connected": False, "message": f"Astro API error: {ex.response.status_code} {ex.response.text[:200]}"}
    except Exception as ex:
        logger.error(f"[Astro Cost] Connection test failed: {ex}")
        return {"status": "error", "connected": False, "message": f"Astro authentication failed: {ex}"}


def get_cost_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not payload.get("astroApiToken") or not payload.get("astroOrganizationId") or not payload.get("astroDeploymentId"):
        return {"status": "error", "message": "API Token, Organization ID, and Deployment ID are all required."}

    try:
        deployment = _get_deployment(payload)
    except requests.HTTPError as ex:
        return {"status": "error", "message": f"Astro API error: {ex.response.status_code} {ex.response.text[:200]}"}
    except Exception as ex:
        logger.error(f"[Astro Cost] Deployment lookup failed: {ex}")
        return {"status": "error", "message": f"Astro authentication failed: {ex}"}

    scheduler = deployment.get("scheduler", {}) or {}
    worker_queues = deployment.get("workerQueues", []) or []

    environment = {
        "name": deployment.get("name"),
        "deploymentId": deployment.get("id"),
        "airflowVersion": deployment.get("airflowVersion"),
        "schedulerAu": scheduler.get("au") or deployment.get("schedulerAu"),
        "schedulerReplicas": scheduler.get("replicas") or deployment.get("schedulerReplicas"),
        "workerQueues": [
            {
                "name": q.get("name"),
                "astroMachine": q.get("astroMachine"),
                "minWorkerCount": q.get("minWorkerCount"),
                "maxWorkerCount": q.get("maxWorkerCount"),
            }
            for q in worker_queues
        ],
    }

    return {
        "status": "success",
        "provider": "astronomer",
        "environment": environment,
        "summary": {
            "lastRefreshedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "totalCostUsd": None,
            "costNote": (
                "Astro bills by Compute Unit-hours (scheduler + worker + triggerer resources shown above) "
                "at a rate set by your plan/contract — this is not exposed via the Astro API. "
                "See Astro → Usage in the Astronomer UI for the exact billed amount."
            ),
        },
    }
