"""
Live dbt Cloud BILLING telemetry. Zero mocked data.

dbt Cloud's Admin API has no billing/invoice endpoint — verified directly against the live API:
GET .../billing/, .../invoices/, .../usage/, .../subscriptions/, .../plan/, and the v3 account
endpoint all return 404. dbt Cloud meters usage-based plans through Metronome and settles
invoices outside any API a customer's service token can call, so no $ total for compute/model
builds can be fetched here — showing one would mean inventing it.

What IS real and billing-relevant, and lives on the account resource itself (one API call,
GET accounts/{id}/), is what this module reports:
  - Plan identifier and seat counts/types (the actual unit dbt Cloud invoices on self-serve plans)
  - Account lock/trial/cancellation status — i.e. whether billing is even current
  - Billing contact email and which external billing system (Metronome/Salesforce/other) owns
    the account, so the user knows exactly where to go for the real invoice amount
  - A $ seat cost ONLY for plans with public list pricing (free Developer, or self-serve Team).
    Enterprise/custom plans get the real seat count with an explicit "pricing is contractual"
    note instead of a fabricated number.

Job/run/model monitoring (success rates, build durations, model counts, etc.) is deliberately
NOT part of this module — that already exists in the Governance → Monitoring tab, and belongs
there, not in a billing view.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.modules.ai_governance.dbt_sync_service import dbt_get_data, dbt_get_artifact
from app.modules.ai_governance import source_store

logger = logging.getLogger("uvicorn.error")

# Published dbt Labs list pricing used ONLY for plans we can positively identify below.
TEAM_PLAN_DEVELOPER_SEAT_USD = 100.0

RUNS_PAGE_SIZE = 100
MAX_RUN_PAGES = 5  # bounds pagination to at most 500 runs per refresh
RUN_RESULTS_SAMPLE_LIMIT = 40  # bounds N+1 artifact fetches for model-level outcome sampling


def _parse_dbt_timestamp(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).strip().replace(" ", "T"))
    except ValueError:
        return None


def _resolve_credentials(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Accepts either a direct {dbtServiceToken, dbtBaseUrl} pair, or a sourceId referencing an
    already-registered dbt Monitoring connection, so a user who already connected dbt Cloud for
    Governance/Monitoring does not have to re-enter credentials for billing tracking."""
    source_id = (payload.get("sourceId") or "").strip()
    if source_id:
        entry = source_store.get_source(source_id)
        if not entry or entry.get("source_type") != "dbt":
            raise ValueError(f"No dbt Cloud source registered with id '{source_id}'.")
        cfg = entry.get("adapter_config") or {}
        return {
            "dbtServiceToken": (cfg.get("dbtServiceToken") or "").strip(),
            "dbtBaseUrl": (cfg.get("dbtBaseUrl") or "").strip().rstrip("/"),
            "sourceId": source_id,
            "displayName": entry.get("display_name"),
        }
    return {
        "dbtServiceToken": (payload.get("dbtServiceToken") or "").strip(),
        "dbtBaseUrl": (payload.get("dbtBaseUrl") or "").strip().rstrip("/"),
        "sourceId": None,
        "displayName": None,
    }


def test_dbt_cost_connection(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        creds = _resolve_credentials(payload)
    except ValueError as e:
        return {"status": "error", "message": str(e)}

    token, base_url = creds["dbtServiceToken"], creds["dbtBaseUrl"]
    if not token or not base_url:
        return {"status": "error", "message": "dbt Cloud Service Token and Base URL are required."}

    try:
        accounts = dbt_get_data(base_url, token, "accounts/")
        if not accounts:
            return {"status": "error", "connected": False, "message": "No dbt Cloud accounts accessible with this token."}
        acc = accounts[0]
        return {
            "status": "success",
            "connected": True,
            "accountId": acc.get("id"),
            "accountName": acc.get("name"),
            "plan": acc.get("plan"),
            "message": f"Connected to dbt Cloud: {acc.get('name', 'Account')} (ID: {acc.get('id')})",
        }
    except Exception as ex:
        logger.error(f"[dbt Cloud Billing] Connection test failed: {ex}")
        return {"status": "error", "connected": False, "message": f"dbt Cloud authentication failed: {ex}"}


def _seat_cost(plan: str, developer_seats: int) -> Dict[str, Any]:
    plan_lower = (plan or "").lower()
    if "developer" in plan_lower:
        return {"seatCostUsd": 0.0, "seatCostNote": "Free dbt Cloud Developer plan (up to 1 developer seat)."}
    if plan_lower.startswith("team"):
        cost = round(developer_seats * TEAM_PLAN_DEVELOPER_SEAT_USD, 2)
        return {
            "seatCostUsd": cost,
            "seatCostNote": f"Team plan list price: ${TEAM_PLAN_DEVELOPER_SEAT_USD:.0f}/developer seat/month × {developer_seats} seat(s).",
        }
    return {
        "seatCostUsd": None,
        "seatCostNote": f"Plan '{plan or 'Unknown'}' is custom/negotiated pricing — dbt Cloud does not expose invoice amounts via API. Check your dbt Cloud billing portal for the exact rate.",
    }


def _billing_system(account: Dict[str, Any]) -> Dict[str, Any]:
    if account.get("metronome_customer_id"):
        return {"system": "Metronome (usage-based billing)", "note": "This account's usage-based charges are metered and invoiced through Metronome, not exposed via the dbt Cloud API."}
    if account.get("salesforce_customer_id"):
        return {"system": "Salesforce (Enterprise contract)", "note": "This account is billed under a negotiated Enterprise contract managed in Salesforce."}
    if account.get("third_party_billing"):
        return {"system": str(account.get("third_party_billing")), "note": "Billed through a third-party reseller/marketplace (e.g. a cloud marketplace private offer)."}
    return {"system": "Self-serve (credit card)", "note": "Standard self-serve billing via the dbt Cloud billing portal."}


def get_dbt_cost_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        creds = _resolve_credentials(payload)
    except ValueError as e:
        return {"status": "error", "message": str(e)}

    token, base_url = creds["dbtServiceToken"], creds["dbtBaseUrl"]
    if not token or not base_url:
        return {"status": "error", "message": "dbt Cloud Service Token and Base URL are required."}

    try:
        accounts = dbt_get_data(base_url, token, "accounts/")
        if not accounts:
            return {"status": "error", "message": "No dbt Cloud accounts accessible with this token."}
        account = accounts[0]
    except Exception as ex:
        logger.error(f"[dbt Cloud Billing] Account lookup failed: {ex}")
        return {"status": "error", "message": f"dbt Cloud authentication failed: {ex}"}

    plan = account.get("plan")
    developer_seats = int(account.get("developer_seats") or 0)
    read_only_seats = int(account.get("read_only_seats") or 0)
    it_seats = int(account.get("it_seats") or 0)
    explorer_seats = int(account.get("explorer_seats") or 0)
    analyst_seats = int(account.get("analyst_seats") or 0)
    seat_cost = _seat_cost(plan, developer_seats)
    billing_system = _billing_system(account)

    # Active vs inactive user counts — real, from the account's own user list (is_active field),
    # separate from developer_seats above (a purchased-seat count, not a "how many people actually
    # log in" count). Best-effort: license utilization still returns without this if it fails.
    active_users, inactive_users = None, None
    try:
        users = dbt_get_data(base_url, token, f"accounts/{account.get('id')}/users/")
        active_users = sum(1 for u in users if u.get("is_active"))
        inactive_users = sum(1 for u in users if not u.get("is_active"))
    except Exception as ex:
        logger.warning(f"[dbt Cloud Billing] User list fetch failed: {ex}")

    return {
        "status": "success",
        "account": {
            "id": account.get("id"),
            "name": account.get("name"),
            "plan": plan,
            "businessCritical": account.get("business_critical"),
            "createdAt": account.get("created_at"),
        },
        "billing": {
            "lastRefreshedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "seats": {
                "developer": developer_seats,
                "readOnly": read_only_seats,
                "it": it_seats,
                "explorer": explorer_seats,
                "analyst": analyst_seats,
                "total": developer_seats + read_only_seats + it_seats + explorer_seats + analyst_seats,
                "activeUsers": active_users,
                "inactiveUsers": inactive_users,
            },
            "seatCostUsd": seat_cost["seatCostUsd"],
            "seatCostNote": seat_cost["seatCostNote"],
            "planLimits": {
                "runSlots": account.get("run_slots"),
                "queueLimit": account.get("queue_limit"),
                "runDurationLimitHours": round((account.get("run_duration_limit_seconds") or 0) / 3600.0, 1),
            },
            "accountStatus": {
                "locked": account.get("locked"),
                "lockReason": account.get("lock_reason"),
                "lockCause": account.get("lock_cause"),
                "unlockedAt": account.get("unlocked_at"),
                "pendingCancel": account.get("pending_cancel"),
                "unlockIfSubscriptionRenewed": account.get("unlock_if_subscription_renewed"),
                "trialEndDate": account.get("trial_end_date"),
            },
            "billingEmail": account.get("billing_email_address"),
            "billingSystem": billing_system["system"],
            "billingSystemNote": billing_system["note"],
        },
    }


def _fetch_runs_since(base_url: str, token: str, account_id: int, since: datetime) -> List[Dict[str, Any]]:
    """Paginates accounts/{id}/runs/ (newest first) until a page is entirely older than `since`."""
    collected: List[Dict[str, Any]] = []
    for page in range(MAX_RUN_PAGES):
        params = {"order_by": "-finished_at", "limit": RUNS_PAGE_SIZE, "offset": page * RUNS_PAGE_SIZE}
        batch = dbt_get_data(base_url, token, f"accounts/{account_id}/runs/", params)
        if not batch:
            break
        in_window = False
        for r in batch:
            finished = _parse_dbt_timestamp(r.get("finished_at"))
            if finished is None:
                collected.append(r)  # still-running/queued
                in_window = True
                continue
            if finished >= since:
                collected.append(r)
                in_window = True
        if not in_window:
            break
        if len(batch) < RUNS_PAGE_SIZE:
            break
    return collected


def _bucket_runs(runs: List[Dict[str, Any]], since: datetime, now: datetime) -> Dict[str, int]:
    in_bucket = [r for r in runs if (_parse_dbt_timestamp(r.get("finished_at")) or now) >= since]
    return {
        "total": len(in_bucket),
        "success": sum(1 for r in in_bucket if r.get("is_success")),
        "failed": sum(1 for r in in_bucket if r.get("is_error")),
        "cancelled": sum(1 for r in in_bucket if r.get("is_cancelled")),
    }


def get_dbt_build_usage(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Real dbt Cloud model-build usage — run counts and outcomes, derived entirely from the Admin
    API's run history and a bounded sample of run_results.json artifacts. Deliberately absent: any
    "monthly build quota" or "% of quota used" figure. Enterprise plans negotiate that ceiling
    contractually and dbt Cloud does not expose it via any API — showing one here would mean
    inventing it, so only the actual count of builds run is reported.
    """
    try:
        creds = _resolve_credentials(payload)
    except ValueError as e:
        return {"status": "error", "message": str(e)}

    token, base_url = creds["dbtServiceToken"], creds["dbtBaseUrl"]
    if not token or not base_url:
        return {"status": "error", "message": "dbt Cloud Service Token and Base URL are required."}

    try:
        accounts = dbt_get_data(base_url, token, "accounts/")
        if not accounts:
            return {"status": "error", "message": "No dbt Cloud accounts accessible with this token."}
        account_id = int(accounts[0]["id"])
    except Exception as ex:
        logger.error(f"[dbt Build Usage] Account lookup failed: {ex}")
        return {"status": "error", "message": f"dbt Cloud authentication failed: {ex}"}

    now = datetime.now(timezone.utc)
    since_month = now - timedelta(days=30)
    since_week = now - timedelta(days=7)
    since_today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    try:
        runs_30d = _fetch_runs_since(base_url, token, account_id, since_month)
    except Exception as ex:
        logger.error(f"[dbt Build Usage] Runs fetch failed: {ex}")
        return {"status": "error", "message": f"Failed to fetch run history: {ex}"}

    builds_today = _bucket_runs(runs_30d, since_today, now)
    builds_week = _bucket_runs(runs_30d, since_week, now)
    builds_month = _bucket_runs(runs_30d, since_month, now)

    # Daily trend across the 30-day window
    trend_map: Dict[str, Dict[str, Any]] = {}
    for r in runs_30d:
        finished = _parse_dbt_timestamp(r.get("finished_at"))
        if not finished:
            continue
        day = finished.strftime("%Y-%m-%d")
        t = trend_map.setdefault(day, {"day": day, "total": 0, "success": 0, "failed": 0})
        t["total"] += 1
        if r.get("is_success"):
            t["success"] += 1
        elif r.get("is_error"):
            t["failed"] += 1
    build_trend = sorted(trend_map.values(), key=lambda t: t["day"])

    # Model-level (not just run-level) outcomes, sampled from run_results.json. Same honest
    # sampling caveat as elsewhere in this app: dbt Cloud purges artifacts after a retention
    # window, and never generates run_results.json for a run that failed before the execute step.
    sample = [r for r in runs_30d if r.get("id") and r.get("finished_at")][:RUN_RESULTS_SAMPLE_LIMIT]
    successful_models, failed_models, sampled_with_results = 0, 0, 0
    for r in sample:
        try:
            run_results = dbt_get_artifact(base_url, token, account_id, int(r["id"]), "run_results.json")
        except Exception:
            run_results = None
        if not run_results or not run_results.get("results"):
            continue
        sampled_with_results += 1
        for node in run_results["results"]:
            uid = node.get("unique_id", "")
            if not uid.startswith("model."):
                continue
            status = str(node.get("status", "")).lower()
            if status in ("success", "pass"):
                successful_models += 1
            elif status in ("error", "fail"):
                failed_models += 1

    # A plain threshold rule, not AI — labeled explicitly so it's never mistaken for the
    # generative "AI Recommendations" pattern used elsewhere in this app.
    alerts = []
    if builds_week["total"] >= 5:
        failure_rate = round((builds_week["failed"] / builds_week["total"]) * 100, 1)
        if failure_rate >= 50:
            alerts.append({
                "severity": "high", "type": "build_failure_rate",
                "message": f"{failure_rate}% of runs failed in the last 7 days ({builds_week['failed']}/{builds_week['total']}).",
            })
        elif failure_rate >= 25:
            alerts.append({
                "severity": "medium", "type": "build_failure_rate",
                "message": f"{failure_rate}% of runs failed in the last 7 days ({builds_week['failed']}/{builds_week['total']}).",
            })

    return {
        "status": "success",
        "lastRefreshedAt": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "buildsToday": builds_today,
        "buildsThisWeek": builds_week,
        "buildsThisMonth": builds_month,
        "buildTrend": build_trend,
        "modelOutcomes": {
            "successfulModels": successful_models,
            "failedModels": failed_models,
            "sampledRuns": len(sample),
            "sampledRunsWithResults": sampled_with_results,
        },
        "alerts": alerts,
        "quotaNote": "dbt Cloud does not expose a model-build quota via API — Enterprise build limits are a contract term, not a fetchable number. Only actual build counts are shown above.",
    }
