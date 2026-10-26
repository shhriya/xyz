import logging
from typing import Any, Dict, List, Optional, Tuple

from app.modules.cfo_analytics.snowflake_live import get_shared_live_snowflake_connection
from ..cost_service import _view_columns
from .shared import get_session_identity, resolve_credit_rate, resolve_time_range

logger = logging.getLogger("uvicorn.error")

# Every Cortex AI service view named in the blueprint (section 1.4), with the columns that
# typically carry credits/tokens/user/model on each. Most of these are newer/preview features —
# not every account or edition has all twelve, so each is discovered at runtime via
# _view_columns (does the view exist here, what does it actually expose) rather than assumed.
#
# creditCols lists TOKEN_CREDITS first: verified live against a real account that this — not
# CREDITS/CREDITS_USED — is the actual column name on CORTEX_AGENT_USAGE_HISTORY and the
# CoWork/Intelligence views (a prior version of this file checked CREDITS/CREDITS_USED only,
# which silently reported $0 for every service that actually uses TOKEN_CREDITS). CREDITS is kept
# as a fallback since Cortex Analyst's usage view genuinely does use that plain name instead.
#
# "Snowflake CoWork" ships two possible views on different Snowflake versions — the blueprint
# itself notes "Snowflake CoWork (= Intelligence)" — so both are listed as candidates and
# whichever one actually has data on this account is used.
CORTEX_SERVICE_VIEWS = [
    {"service": "AI Functions", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY"],
     "userCols": ["USER_ID", "USER_NAME"], "modelCols": ["MODEL_NAME"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["TOKENS"]},
    {"service": "Agents", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY"],
     "userCols": ["USER_NAME", "USER_ID"], "modelCols": ["AGENT_NAME"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["TOKENS", "TOKENS_GRANULAR"]},
    {"service": "Snowflake Intelligence", "views": [
        "SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_INTELLIGENCE_USAGE_HISTORY",
        "SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY",
     ], "userCols": ["USER_NAME", "USER_ID"], "modelCols": ["AGENT_NAME", "SNOWFLAKE_INTELLIGENCE_NAME", "SNOWFLAKE_COWORK_NAME"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["TOKENS"]},
    {"service": "Cortex Analyst", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_ANALYST_USAGE_HISTORY"],
     "userCols": ["USERNAME", "USER_NAME"], "modelCols": [],
     "creditCols": ["CREDITS", "TOKEN_CREDITS", "CREDITS_USED"], "tokenCols": ["REQUEST_COUNT"]},
    {"service": "Cortex Search", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_SEARCH_DAILY_USAGE_HISTORY"],
     "userCols": [], "modelCols": ["SERVICE_NAME", "CONSUMPTION_TYPE"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": []},
    {"service": "REST API", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_REST_API_USAGE_HISTORY"],
     "userCols": ["USER_ID"], "modelCols": ["MODEL_NAME"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["TOKENS"]},
    {"service": "Document Processing", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_DOCUMENT_PROCESSING_USAGE_HISTORY"],
     "userCols": ["USER_NAME", "USER_ID"], "modelCols": ["FUNCTION_NAME"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["PAGE_COUNT", "DOCUMENT_COUNT"]},
    {"service": "Fine-tuning", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FINE_TUNING_USAGE_HISTORY"],
     "userCols": [], "modelCols": ["MODEL_NAME"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["TOKENS"]},
    {"service": "Provisioned Throughput", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_PROVISIONED_THROUGHPUT_USAGE_HISTORY"],
     "userCols": [], "modelCols": ["MODEL_NAME"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["PTU_COUNT"]},
    {"service": "AI Guardrails", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_GUARDRAILS_USAGE_HISTORY"],
     "userCols": ["USER_NAME"], "modelCols": ["AGENTIC_SOURCE"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": []},
    {"service": "Cortex Code", "views": ["SNOWFLAKE.ACCOUNT_USAGE.CORTEX_CODE_CLI_USAGE_HISTORY"],
     "userCols": ["USER_NAME"], "modelCols": [],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": ["TOKENS"]},
    {"service": "AI Gateway", "views": ["SNOWFLAKE.ACCOUNT_USAGE.AI_GATEWAY_USAGE_HISTORY"],
     "userCols": ["USER_ID"], "modelCols": ["GATEWAY_NAME", "SERVICE_TYPE"],
     "creditCols": ["TOKEN_CREDITS", "CREDITS", "CREDITS_USED"], "tokenCols": []},
]

# Of the services above, only these have a per-request trace log (a REQUEST_ID column) — verified
# live. Cortex Analyst's own usage view (CORTEX_ANALYST_USAGE_HISTORY) is aggregate-only
# (START_TIME, END_TIME, USERNAME, CREDITS, REQUEST_COUNT — no REQUEST_ID at all), so there is no
# way to drill into an individual Analyst request from ACCOUNT_USAGE; that's a Snowflake platform
# limitation, not a gap in this code. The rest (REST API, Fine-tuning, Provisioned Throughput,
# Guardrails, Cortex Code, AI Gateway, Search, Document Processing) have no trace source either.
REQUEST_TRACE_SERVICES = {"Agents", "Snowflake Intelligence"}

# A more specific "why not" for services where the real reason is worth spelling out rather than
# the generic message, keyed by service name.
UNAVAILABLE_REASONS = {
    "Cortex Analyst": (
        "Snowflake's own CORTEX_ANALYST_USAGE_HISTORY view only reports aggregate daily totals "
        "(START_TIME, END_TIME, USERNAME, CREDITS, REQUEST_COUNT) — it has no REQUEST_ID column, "
        "so there is no way to look up an individual Analyst request from ACCOUNT_USAGE. This is a "
        "Snowflake platform limitation, not something this dashboard can work around."
    ),
}


def _unavailable_message(service: str) -> str:
    return UNAVAILABLE_REASONS.get(service, f"Request-level detail is not available for {service} on this account.")


def _resolve_view(cur, candidates: List[str]) -> Tuple[Optional[str], set]:
    """Pick the first candidate view that exists here; if more than one exists, prefer whichever
    actually has rows (e.g. "Snowflake CoWork" vs. "Snowflake Intelligence" are the same feature
    renamed between Snowflake versions — only one of the two will ever be populated)."""
    found = []
    for fq in candidates:
        cols = _view_columns(cur, fq)
        if cols:
            found.append((fq, cols))
    if not found:
        return None, set()
    if len(found) == 1:
        return found[0]
    for fq, cols in found:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {fq}")
            if int((cur.fetchone() or [0])[0] or 0) > 0:
                return fq, cols
        except Exception:
            continue
    return found[0]


def get_cortex_ai_summary(credentials: Dict[str, Any]) -> Dict[str, Any]:
    """Level 1 Cortex AI (Dashboard_layout 1.docx section 1.4). Replicates the blueprint's
    "unified mart view" (AI_GOV.MART.CORTEX_COST_FACT) at query time in Python, since no such
    pre-built mart exists in this app — each discovered service view is probed and normalized
    into one common row shape instead."""
    time_range = credentials.get("timeRange", "monthly")
    window = resolve_time_range(time_range)
    date_filter = window["date_filter_au"]

    try:
        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        identity = get_session_identity(cur)
        credit_rate = resolve_credit_rate(cur, identity["edition"])

        services = []
        unavailable = []
        daily_trend_map = {}
        user_map = {}
        model_map = {}

        for svc in CORTEX_SERVICE_VIEWS:
            row = _probe_service(cur, svc, date_filter, credit_rate, daily_trend_map, user_map, model_map)
            if row is None:
                unavailable.append(svc["service"])
            else:
                services.append(row)

        total_credits = round(sum(s["credits"] for s in services), 6)
        total_cost_usd = round(total_credits * credit_rate, 2)

        daily_trend = sorted(daily_trend_map.values(), key=lambda d: d["day"])
        for d in daily_trend:
            for k in d:
                if k != "day":
                    d[k] = round(d[k], 2)

        top_users = [{"user": k, "amountUsd": round(v, 2)} for k, v in sorted(user_map.items(), key=lambda item: -item[1])[:10]]
        top_models = [{"model": k, "amountUsd": round(v, 2)} for k, v in sorted(model_map.items(), key=lambda item: -item[1])[:10]]

        return {
            "status": "success",
            "creditRate": credit_rate,
            "billingPeriod": window["period_str"],
            **identity,
            "services": sorted(services, key=lambda s: -s["credits"]),
            "unavailableServices": unavailable,
            "availableCount": len(services),
            "totalServiceCount": len(CORTEX_SERVICE_VIEWS),
            "totalCreditsAI": total_credits,
            "totalCostUsd": total_cost_usd,
            "dailyTrend": daily_trend,
            "topUsers": top_users,
            "topModels": top_models,
        }
    except Exception as ex:
        logger.error(f"[Cortex AI Level1 Error]: {ex}")
        return {"status": "error", "message": str(ex)}


def _probe_service(cur, svc: Dict[str, Any], date_filter: str, credit_rate: float, daily_map: dict, user_map: dict, model_map: dict) -> Optional[Dict[str, Any]]:
    view, cols = _resolve_view(cur, svc["views"])
    if not view:
        return None  # none of this service's candidate views exist/are authorized here

    credit_col = next((c for c in svc["creditCols"] if c in cols), None)
    token_col = next((c for c in svc["tokenCols"] if c in cols), None)
    user_col = next((c for c in svc["userCols"] if c in cols), None)
    model_col = next((c for c in svc["modelCols"] if c in cols), None)
    time_col = "START_TIME" if "START_TIME" in cols else ("USAGE_DATE" if "USAGE_DATE" in cols else None)

    credit_expr = f"SUM(COALESCE({credit_col}, 0))" if credit_col else "0"
    token_expr = f"SUM(COALESCE({token_col}, 0))" if token_col else "0"
    where_time = f"{time_col} >= {date_filter}" if time_col else "1=1"

    try:
        cur.execute(f"""
            SELECT COUNT(*) AS events, {credit_expr} AS credits, {token_expr} AS tokens
            FROM {view}
            WHERE {where_time}
        """)
        row = cur.fetchone()
    except Exception as e:
        logger.info(f"Cortex service probe failed for {view}: {e}")
        return None

    events = int(row[0] or 0) if row else 0
    credits = round(float(row[1] or 0), 6) if row else 0.0
    tokens = int(row[2] or 0) if row else 0

    if events > 0:
        if time_col:
            try:
                cur.execute(f"SELECT {time_col}::DATE, {credit_expr} FROM {view} WHERE {where_time} GROUP BY 1")
                for r in cur.fetchall():
                    day = str(r[0])
                    c = float(r[1] or 0) * credit_rate
                    if day not in daily_map:
                        daily_map[day] = {"day": day}
                    daily_map[day][svc["service"]] = daily_map[day].get(svc["service"], 0) + c
            except Exception as e:
                pass

        if user_col:
            try:
                cur.execute(f"SELECT {user_col}, {credit_expr} FROM {view} WHERE {where_time} AND {user_col} IS NOT NULL GROUP BY 1")
                for r in cur.fetchall():
                    u = str(r[0])
                    c = float(r[1] or 0) * credit_rate
                    user_map[u] = user_map.get(u, 0.0) + c
            except Exception as e:
                pass

        if model_col:
            try:
                cur.execute(f"SELECT {model_col}, {credit_expr} FROM {view} WHERE {where_time} AND {model_col} IS NOT NULL GROUP BY 1")
                for r in cur.fetchall():
                    m = str(r[0])
                    c = float(r[1] or 0) * credit_rate
                    model_map[m] = model_map.get(m, 0.0) + c
            except Exception as e:
                pass

    top_user, top_model = None, None
    dims = [c for c in (user_col, model_col) if c]
    if events > 0 and dims:
        try:
            cur.execute(f"""
                SELECT {', '.join(dims)}, {credit_expr}
                FROM {view}
                WHERE {where_time}
                GROUP BY {', '.join(dims)}
                ORDER BY {len(dims) + 1} DESC
                LIMIT 1
            """)
            top_row = cur.fetchone()
            if top_row:
                idx = 0
                if user_col:
                    top_user = str(top_row[idx])
                    idx += 1
                if model_col:
                    top_model = str(top_row[idx])
        except Exception:
            pass

    return {
        "service": svc["service"],
        "view": view.split(".")[-1],
        "events": events,
        "credits": credits,
        "costUsd": round(credits * credit_rate, 2),
        "tokens": tokens,
        "hasTokens": token_col is not None,
        "topUser": top_user,
        "topModel": top_model,
    }


def list_service_requests(credentials: Dict[str, Any], service: str, limit: int = 20) -> Dict[str, Any]:
    """Level 3 step one: the recent individual requests for a trace-capable service, so the UI has
    something concrete to let the user pick before asking for one request's full detail."""
    if service not in REQUEST_TRACE_SERVICES:
        return {"status": "unavailable", "message": _unavailable_message(service)}
    svc_cfg = next((s for s in CORTEX_SERVICE_VIEWS if s["service"] == service), None)
    if not svc_cfg:
        return {"status": "unavailable", "message": f"Unknown service: {service}."}

    time_range = credentials.get("timeRange", "monthly")
    window = resolve_time_range(time_range)
    date_filter = window["date_filter_au"]

    try:
        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        view, cols = _resolve_view(cur, svc_cfg["views"])
        if not view:
            return {"status": "unavailable", "message": f"{service} has no usage view available on this account."}
        if "REQUEST_ID" not in cols:
            return {"status": "unavailable", "message": f"{view} has no REQUEST_ID column to look up."}

        user_col = next((c for c in svc_cfg.get("userCols", []) if c in cols), None)
        model_col = next((c for c in svc_cfg.get("modelCols", []) if c in cols), None)
        credit_col = next((c for c in svc_cfg.get("creditCols", []) if c in cols), None)
        time_col = "START_TIME" if "START_TIME" in cols else ("USAGE_DATE" if "USAGE_DATE" in cols else None)

        select_cols = ["REQUEST_ID"]
        if time_col:
            select_cols.append(time_col)
        if user_col:
            select_cols.append(user_col)
        if model_col:
            select_cols.append(model_col)
        if credit_col:
            select_cols.append(credit_col)

        where_time = f"{time_col} >= {date_filter}" if time_col else "1=1"
        order_by = f"{time_col} DESC" if time_col else "REQUEST_ID DESC"

        cur.execute(f"""
            SELECT {', '.join(select_cols)}
            FROM {view}
            WHERE {where_time} AND REQUEST_ID IS NOT NULL
            ORDER BY {order_by}
            LIMIT {int(limit)}
        """)
        col_names = [d[0].lower() for d in (cur.description or [])]
        rows = [dict(zip(col_names, row)) for row in cur.fetchall()]
        for r in rows:
            for k, v in list(r.items()):
                r[k] = str(v) if v is not None else None
        if not rows:
            return {
                "status": "success",
                "requests": [],
                "message": (
                    f"{view.split('.')[-1]} has no recorded requests in this period yet. If you've used "
                    f"{service} recently, Snowflake's usage-history views can take some time to populate — "
                    f"this isn't necessarily a sign nothing happened."
                ),
            }
        return {"status": "success", "requests": rows}
    except Exception as ex:
        logger.error(f"[Cortex request list error]: {ex}")
        return {"status": "error", "message": str(ex)}


def get_request_detail(credentials: Dict[str, Any], service: str, request_id: str) -> Dict[str, Any]:
    """Level 3 step two: best-effort prompt/response lookup for one specific request."""
    if service not in REQUEST_TRACE_SERVICES:
        return {"status": "unavailable", "message": _unavailable_message(service)}
    if not request_id:
        return {"status": "error", "message": "No request selected — pick one from the request list first."}
    svc_cfg = next((s for s in CORTEX_SERVICE_VIEWS if s["service"] == service), None)
    if not svc_cfg:
        return {"status": "unavailable", "message": f"Unknown service: {service}."}
    try:
        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        view, cols = _resolve_view(cur, svc_cfg["views"])
        if not view:
            return {"status": "unavailable", "message": f"{service} has no usage view available on this account."}
        if "REQUEST_ID" not in cols:
            return {"status": "unavailable", "message": f"{view} has no REQUEST_ID column to look up."}
        cur.execute(f"SELECT * FROM {view} WHERE REQUEST_ID = %s LIMIT 1", (request_id,))
        col_names = [d[0].lower() for d in (cur.description or [])]
        row = cur.fetchone()
        if not row:
            return {"status": "not_found", "message": "No matching request found."}
        return {"status": "success", "detail": dict(zip(col_names, row))}
    except Exception as ex:
        logger.error(f"[Cortex request detail error]: {ex}")
        return {"status": "error", "message": str(ex)}
