"""
AWS MWAA (Managed Workflows for Apache Airflow) cost tracking.

Real data sources, both genuine AWS APIs called with the caller's own credentials:
  - `mwaa:GetEnvironment` for environment sizing (class, worker/scheduler counts).
  - AWS Cost Explorer `ce:GetCostAndUsage` for the ACTUAL billed dollar amount — this is the
    same billing engine behind the AWS Cost Explorer console, so the $ figure here is a real
    invoiced number, not price-card arithmetic (unlike dbt/Astronomer, where no such endpoint
    exists and this codebase deliberately does not fabricate a number).

Two real AWS quirks encoded here on purpose, not bugs:
  - Cost Explorer is a global service and must always be called in us-east-1, regardless of
    which region the MWAA environment itself runs in.
  - The account needs Cost Explorer enabled (one-time, in the Billing console) and the calling
    IAM principal needs `ce:GetCostAndUsage` + `mwaa:GetEnvironment` permissions.

NOT YET LIVE-TESTED — no AWS account was available while building this. Written directly
against the documented boto3 `mwaa` and `ce` client APIs, but the exact Cost Explorer SERVICE
dimension string for MWAA ("Amazon Managed Workflows for Apache Airflow") should be confirmed
against a real Cost Explorer console the first time this runs against a live account, since AWS
service name strings occasionally differ from what's shown in the console.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

logger = logging.getLogger("uvicorn.error")

try:
    import boto3
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

# AWS Cost Explorer's SERVICE dimension value for MWAA spend. Verify against Billing Console →
# Cost Explorer → group by Service if this ever returns zero cost for an account known to be paying for MWAA.
MWAA_COST_EXPLORER_SERVICE_NAME = "Amazon Managed Workflows for Apache Airflow"

TIME_RANGE_DAYS = {"weekly": 7, "monthly": 30, "yearly": 365}

CREDENTIAL_FIELDS = [
    {"key": "awsAccessKeyId", "label": "AWS Access Key ID", "type": "text", "required": True},
    {"key": "awsSecretAccessKey", "label": "AWS Secret Access Key", "type": "password", "required": True},
    {"key": "awsSessionToken", "label": "AWS Session Token", "type": "password", "required": False,
     "help": "Only needed for temporary/STS credentials."},
    {"key": "awsRegion", "label": "AWS Region", "type": "text", "required": True, "placeholder": "us-east-1"},
    {"key": "mwaaEnvironmentName", "label": "MWAA Environment Name", "type": "text", "required": True},
]


def _client(payload: Dict[str, Any], service: str, region: str):
    return boto3.client(
        service,
        region_name=region,
        aws_access_key_id=payload.get("awsAccessKeyId"),
        aws_secret_access_key=payload.get("awsSecretAccessKey"),
        aws_session_token=payload.get("awsSessionToken") or None,
    )


def test_connection(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not BOTO3_AVAILABLE:
        return {"status": "error", "message": "boto3 is not installed on the backend."}
    region = (payload.get("awsRegion") or "").strip()
    env_name = (payload.get("mwaaEnvironmentName") or "").strip()
    if not region or not env_name:
        return {"status": "error", "message": "AWS Region and MWAA Environment Name are required."}
    try:
        mwaa = _client(payload, "mwaa", region)
        env = mwaa.get_environment(Name=env_name)["Environment"]
        return {
            "status": "success",
            "connected": True,
            "environmentName": env.get("Name"),
            "environmentClass": env.get("EnvironmentClass"),
            "environmentStatus": env.get("Status"),
            "message": f"Connected to MWAA environment '{env.get('Name')}' ({env.get('EnvironmentClass')}, status: {env.get('Status')}).",
        }
    except Exception as ex:
        logger.error(f"[MWAA Cost] Connection test failed: {ex}")
        return {"status": "error", "connected": False, "message": f"MWAA authentication failed: {ex}"}


def get_cost_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not BOTO3_AVAILABLE:
        return {"status": "error", "message": "boto3 is not installed on the backend."}
    region = (payload.get("awsRegion") or "").strip()
    env_name = (payload.get("mwaaEnvironmentName") or "").strip()
    if not region or not env_name:
        return {"status": "error", "message": "AWS Region and MWAA Environment Name are required."}

    time_range = (payload.get("timeRange") or "monthly").lower()
    days = TIME_RANGE_DAYS.get(time_range, 30)
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)

    # 1. Real environment sizing (mwaa:GetEnvironment)
    try:
        mwaa = _client(payload, "mwaa", region)
        env = mwaa.get_environment(Name=env_name)["Environment"]
    except Exception as ex:
        logger.error(f"[MWAA Cost] GetEnvironment failed: {ex}")
        return {"status": "error", "message": f"MWAA authentication failed: {ex}"}

    environment = {
        "name": env.get("Name"),
        "environmentClass": env.get("EnvironmentClass"),
        "airflowVersion": env.get("AirflowVersion"),
        "schedulers": env.get("Schedulers"),
        "minWorkers": env.get("MinWorkers"),
        "maxWorkers": env.get("MaxWorkers"),
        "status": env.get("Status"),
        "region": region,
        "createdAt": str(env.get("CreatedAt")) if env.get("CreatedAt") else None,
        "webserverAccessMode": env.get("WebserverAccessMode"),
    }

    # 2. Real billed cost from Cost Explorer — always us-east-1 regardless of the env's own region.
    cost_trend = []
    total_cost_usd = 0.0
    currency = "USD"
    ce_error = None
    try:
        ce = _client(payload, "ce", "us-east-1")
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="DAILY",
            Metrics=["UnblendedCost"],
            Filter={"Dimensions": {"Key": "SERVICE", "Values": [MWAA_COST_EXPLORER_SERVICE_NAME]}},
        )
        for day_result in resp.get("ResultsByTime", []):
            amount = float(day_result["Total"]["UnblendedCost"]["Amount"])
            currency = day_result["Total"]["UnblendedCost"]["Unit"] or currency
            total_cost_usd += amount
            cost_trend.append({"day": day_result["TimePeriod"]["Start"], "costUsd": round(amount, 4)})
    except Exception as ex:
        logger.warning(f"[MWAA Cost] Cost Explorer query failed (is Cost Explorer enabled + ce:GetCostAndUsage granted?): {ex}")
        ce_error = str(ex)

    return {
        "status": "success",
        "provider": "mwaa",
        "environment": environment,
        "summary": {
            "billingPeriod": f"Last {days} Days",
            "lastRefreshedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "totalCostUsd": round(total_cost_usd, 2) if ce_error is None else None,
            "currency": currency,
            "costSource": "AWS Cost Explorer (actual billed amount, filtered to the MWAA service)",
            "costExplorerError": ce_error,
        },
        "costTrend": cost_trend,
    }
