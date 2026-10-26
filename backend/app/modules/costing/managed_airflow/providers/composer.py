"""
GCP Cloud Composer cost tracking.

Real data sources:
  - Composer API v1 `projects.locations.environments.get` for environment sizing (real,
    documented REST endpoint) — tells you Composer 1 vs 2, node count/machine type, which
    matters because the two generations have very different cost models.
  - The actual $ billed amount does NOT come from a simple "get cost for this resource" REST
    call — GCP does not offer one. The documented, supported way to get real spend for a
    specific resource is to query the project's BigQuery Billing Export table (a GCP Console
    one-time setup: Billing → Billing export → BigQuery export), filtered to this Composer
    environment's auto-attached `goog-composer-environment` resource label.

IMPORTANT — this is a real GCP prerequisite, not a limitation of this integration: if BigQuery
billing export has never been enabled on the billing account, there is NO historical cost data
to query at all, and this will correctly report zero rows rather than fabricate a number.

Auth: takes a pasted GCP service-account JSON key and exchanges it for an OAuth2 access token
using the standard "JWT Bearer" service-account flow (signed with `cryptography`, which is
already a dependency here — no `google-auth`/`google-cloud-*` packages needed).

NOT YET LIVE-TESTED — no GCP account was available while building this. The Composer REST
endpoint shape and the billing export table schema (`service.description`, `cost`, `currency`,
`labels` as a repeated {key,value} RECORD) are Google's documented public schema, but should be
confirmed against a real project + real billing export table on first use.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import requests

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

logger = logging.getLogger("uvicorn.error")

TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/cloud-platform"
TIME_RANGE_DAYS = {"weekly": 7, "monthly": 30, "yearly": 365}

CREDENTIAL_FIELDS = [
    {"key": "gcpServiceAccountJson", "label": "GCP Service Account JSON Key", "type": "textarea", "required": True,
     "help": "Full JSON key for a service account with Composer Viewer + BigQuery Job User/Data Viewer roles."},
    {"key": "gcpProjectId", "label": "GCP Project ID", "type": "text", "required": True},
    {"key": "composerLocation", "label": "Composer Region", "type": "text", "required": True, "placeholder": "us-central1"},
    {"key": "composerEnvironmentName", "label": "Composer Environment Name", "type": "text", "required": True},
    {"key": "billingExportTable", "label": "BigQuery Billing Export Table", "type": "text", "required": False,
     "placeholder": "project.dataset.gcp_billing_export_v1_XXXXXX",
     "help": "Fully-qualified table from Billing → Billing export → BigQuery export. Leave blank to skip cost lookup (environment sizing will still load)."},
]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _get_access_token(service_account_json: str) -> str:
    """Standard GCP service-account JWT Bearer flow — no google-auth dependency required."""
    if not CRYPTO_AVAILABLE:
        raise RuntimeError("the `cryptography` package is not installed on the backend.")
    info = json.loads(service_account_json)
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {
        "iss": info["client_email"],
        "scope": SCOPE,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + 3600,
    }
    signing_input = f"{_b64url(json.dumps(header).encode())}.{_b64url(json.dumps(claims).encode())}"
    private_key = serialization.load_pem_private_key(info["private_key"].encode("utf-8"), password=None)
    signature = private_key.sign(signing_input.encode("ascii"), padding.PKCS1v15(), hashes.SHA256())
    jwt_assertion = f"{signing_input}.{_b64url(signature)}"

    resp = requests.post(TOKEN_URL, data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt_assertion,
    }, timeout=20)
    resp.raise_for_status()
    return resp.json()["access_token"]


def _get_environment(token: str, project: str, location: str, env_name: str) -> Dict[str, Any]:
    url = f"https://composer.googleapis.com/v1/projects/{project}/locations/{location}/environments/{env_name}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    resp.raise_for_status()
    return resp.json()


def test_connection(payload: Dict[str, Any]) -> Dict[str, Any]:
    project = (payload.get("gcpProjectId") or "").strip()
    location = (payload.get("composerLocation") or "").strip()
    env_name = (payload.get("composerEnvironmentName") or "").strip()
    sa_json = payload.get("gcpServiceAccountJson") or ""
    if not project or not location or not env_name or not sa_json:
        return {"status": "error", "message": "Service Account JSON, Project ID, Region, and Environment Name are all required."}
    try:
        token = _get_access_token(sa_json)
        env = _get_environment(token, project, location, env_name)
        config = env.get("config", {})
        return {
            "status": "success",
            "connected": True,
            "environmentName": env.get("name", "").split("/")[-1],
            "state": env.get("state"),
            "message": f"Connected to Composer environment in project '{project}' (state: {env.get('state')}).",
        }
    except requests.HTTPError as ex:
        return {"status": "error", "connected": False, "message": f"Composer API error: {ex.response.status_code} {ex.response.text[:200]}"}
    except Exception as ex:
        logger.error(f"[Composer Cost] Connection test failed: {ex}")
        return {"status": "error", "connected": False, "message": f"GCP authentication failed: {ex}"}


def _query_billing_export(token: str, project: str, table: str, env_name: str, since: datetime) -> Dict[str, Any]:
    """Real BigQuery REST query against the user's own billing export table, filtered to this
    Composer environment's auto-attached resource label. Returns {} if no export table configured."""
    query = f"""
        SELECT service.description AS service, SUM(cost) AS cost, currency
        FROM `{table}`
        WHERE usage_start_time >= TIMESTAMP('{since.isoformat()}')
          AND EXISTS (
            SELECT 1 FROM UNNEST(labels) AS l
            WHERE l.key = 'goog-composer-environment' AND l.value = '{env_name}'
          )
        GROUP BY service, currency
        ORDER BY cost DESC
    """
    url = f"https://bigquery.googleapis.com/bigquery/v2/projects/{project}/queries"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": query, "useLegacySql": False},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def get_cost_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    project = (payload.get("gcpProjectId") or "").strip()
    location = (payload.get("composerLocation") or "").strip()
    env_name = (payload.get("composerEnvironmentName") or "").strip()
    sa_json = payload.get("gcpServiceAccountJson") or ""
    billing_table = (payload.get("billingExportTable") or "").strip()
    if not project or not location or not env_name or not sa_json:
        return {"status": "error", "message": "Service Account JSON, Project ID, Region, and Environment Name are all required."}

    time_range = (payload.get("timeRange") or "monthly").lower()
    days = TIME_RANGE_DAYS.get(time_range, 30)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    try:
        token = _get_access_token(sa_json)
    except Exception as ex:
        logger.error(f"[Composer Cost] GCP auth failed: {ex}")
        return {"status": "error", "message": f"GCP authentication failed: {ex}"}

    # 1. Real environment sizing (Composer API)
    try:
        env = _get_environment(token, project, location, env_name)
    except requests.HTTPError as ex:
        return {"status": "error", "message": f"Composer API error: {ex.response.status_code} {ex.response.text[:200]}"}
    except Exception as ex:
        logger.error(f"[Composer Cost] Environment lookup failed: {ex}")
        return {"status": "error", "message": f"Composer environment lookup failed: {ex}"}

    config = env.get("config", {}) or {}
    node_config = config.get("nodeConfig", {}) or {}
    software_config = config.get("softwareConfig", {}) or {}
    environment = {
        "name": env.get("name", "").split("/")[-1],
        "state": env.get("state"),
        "imageVersion": software_config.get("imageVersion"),
        "isComposer2": "composer-2" in (software_config.get("imageVersion") or ""),
        "machineType": node_config.get("machineType"),
        "nodeCount": config.get("nodeCount"),
        "environmentSize": config.get("environmentSize"),
        "location": location,
        "createTime": env.get("createTime"),
    }

    # 2. Real billed cost from BigQuery billing export (requires it to already be enabled)
    total_cost_by_service = []
    total_cost_usd = 0.0
    currency = "USD"
    billing_error = None
    if not billing_table:
        billing_error = "No billing export table configured — environment sizing loaded, but cost lookup was skipped."
    else:
        try:
            result = _query_billing_export(token, project, billing_table, env_name, since)
            rows = result.get("rows", [])
            for row in rows:
                f = row["f"]
                service_name, cost, curr = f[0]["v"], float(f[1]["v"]), f[2]["v"]
                total_cost_by_service.append({"service": service_name, "costUsd": round(cost, 2)})
                total_cost_usd += cost
                currency = curr or currency
        except requests.HTTPError as ex:
            billing_error = f"BigQuery query failed: {ex.response.status_code} {ex.response.text[:300]}"
            logger.warning(f"[Composer Cost] {billing_error}")
        except Exception as ex:
            billing_error = str(ex)
            logger.warning(f"[Composer Cost] Billing export query failed: {ex}")

    return {
        "status": "success",
        "provider": "composer",
        "environment": environment,
        "summary": {
            "billingPeriod": f"Last {days} Days",
            "lastRefreshedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "totalCostUsd": round(total_cost_usd, 2) if billing_error is None else None,
            "currency": currency,
            "costSource": "BigQuery Billing Export (actual billed amount, filtered by the goog-composer-environment label)",
            "billingExportError": billing_error,
        },
        "costByService": total_cost_by_service,
    }
