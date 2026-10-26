import logging
import re
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from app.modules.cfo_analytics.snowflake_live import get_shared_live_snowflake_connection
from .shared import resolve_credit_rate, resolve_time_range, get_session_identity

logger = logging.getLogger("uvicorn.error")

# Snowflake published Cortex LLM & Function pricing (credits per 1,000,000 tokens)
CORTEX_MODEL_CREDIT_RATES = {
    "llama3.1-8b": 0.04,
    "llama3.1-70b": 0.34,
    "llama3.1-405b": 1.80,
    "llama3-8b": 0.04,
    "llama3-70b": 0.34,
    "llama2-70b-chat": 0.45,
    "mistral-large": 2.10,
    "mistral-large2": 2.10,
    "mistral-7b": 0.04,
    "mixtral-8x7b": 0.22,
    "gemma-7b": 0.04,
    "snowflake-arctic": 0.84,
    "claude-3-5-sonnet": 3.00,
    "cortex-built-in": 0.08,
}

# Regex to scrub sensitive PII/secrets before sending prompts to the UI
PII_PATTERNS = [
    (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b'), '[REDACTED_EMAIL]'),
    (re.compile(r'\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b'), '[REDACTED_PHONE]'),
    (re.compile(r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b'), '[REDACTED_CARD]'),
    (re.compile(r'(?i)(?:bearer|token|apikey|api_key|password|secret)[\s:=]+([a-zA-Z0-9_\-\.]{16,})'), r'\1=[REDACTED_SECRET]'),
]


def scrub_pii(text: Optional[str]) -> str:
    """Masks obvious PII and credentials from prompt text for security compliance."""
    if not text:
        return ""
    result = str(text)
    for pattern, replacement in PII_PATTERNS:
        result = pattern.sub(replacement, result)
    return result


def resolve_model_credit_rate(model_name: str) -> float:
    """Returns Snowflake credit rate per 1,000,000 tokens for a model."""
    name = (model_name or "").lower().strip()
    for key, rate in CORTEX_MODEL_CREDIT_RATES.items():
        if key in name:
            return rate
    return 0.08  # Default Cortex function credit rate per 1M tokens


def estimate_cortex_tokens_and_credits(
    prompt: str,
    model_name: str,
    function_name: str,
    duration_ms: int
) -> Dict[str, Any]:
    """
    Computes prompt tokens, completion tokens, and credit cost using Snowflake's rate card
    when Account Usage has not yet materialized or aggregated exact query-level tokens.
    """
    prompt_str = prompt or ""
    prompt_len = len(prompt_str)
    # Standard LLM tokenization ratio: ~4 characters per token
    prompt_tokens = max(1, round(prompt_len / 4.0)) if prompt_len > 0 else 5

    fn = (function_name or "COMPLETE").upper()
    dur = max(0, duration_ms)

    if fn == "COMPLETE":
        # Average LLM completion throughput is ~30-40 tokens/second (0.035 tokens/ms)
        net_dur = max(100, dur - 250)
        completion_tokens = max(15, min(1500, round(net_dur * 0.035)))
    elif fn in ("TRANSLATE", "SUMMARIZE"):
        ratio = 0.85 if fn == "TRANSLATE" else 0.35
        completion_tokens = max(8, round(prompt_tokens * ratio))
    elif fn == "EXTRACT_ANSWER":
        completion_tokens = max(5, min(100, round(prompt_tokens * 0.15)))
    else:
        completion_tokens = max(5, round(prompt_tokens * 0.5))

    total_tokens = prompt_tokens + completion_tokens
    rate_per_m = resolve_model_credit_rate(model_name)
    credits = (total_tokens / 1_000_000.0) * rate_per_m

    return {
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "totalTokens": total_tokens,
        "credits": round(credits, 8),
        "ratePerM": rate_per_m,
    }


def extract_prompt_and_model(query_text: str) -> Dict[str, Any]:
    """Attempts to extract model name, prompt text, and function from raw SQL query text."""
    if not query_text:
        return {"function": "UNKNOWN", "model": "Unknown", "prompt": ""}

    # 1. Check for COMPLETE(model, prompt)
    complete_match = re.search(
        r"""(?i)(?:SNOWFLAKE\.)?CORTEX\.COMPLETE\s*\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3""",
        query_text,
        re.DOTALL
    )
    if complete_match:
        model = complete_match.group(2).strip()
        prompt = complete_match.group(4).strip()
        return {
            "function": "COMPLETE",
            "model": model,
            "prompt": scrub_pii(prompt)
        }

    # 2. Check for EXTRACT_ANSWER(source, question)
    extract_match = re.search(
        r"""(?i)(?:SNOWFLAKE\.)?CORTEX\.EXTRACT_ANSWER\s*\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3""",
        query_text,
        re.DOTALL
    )
    if extract_match:
        source_doc = extract_match.group(2).strip()
        question = extract_match.group(4).strip()
        prompt = f"Doc: {source_doc[:120]}... | Question: {question}"
        return {
            "function": "EXTRACT_ANSWER",
            "model": "cortex-built-in",
            "prompt": scrub_pii(prompt)
        }

    # 3. Check for TRANSLATE(text, from, to)
    translate_match = re.search(
        r"""(?i)(?:SNOWFLAKE\.)?CORTEX\.TRANSLATE\s*\(\s*(['"])(.*?)\1""",
        query_text,
        re.DOTALL
    )
    if translate_match:
        prompt = translate_match.group(2).strip()
        return {
            "function": "TRANSLATE",
            "model": "cortex-built-in",
            "prompt": scrub_pii(prompt)
        }

    # 4. Check for SUMMARIZE(text) / SENTIMENT(text) / CLASSIFY_TEXT(text, categories)
    fn_single_match = re.search(
        r"""(?i)(?:SNOWFLAKE\.)?CORTEX\.(SUMMARIZE|SENTIMENT|CLASSIFY_TEXT)\s*\(\s*(['"])(.*?)\2""",
        query_text,
        re.DOTALL
    )
    if fn_single_match:
        fn_name = fn_single_match.group(1).upper()
        prompt = fn_single_match.group(3).strip()
        return {
            "function": fn_name,
            "model": "cortex-built-in",
            "prompt": scrub_pii(prompt)
        }

    # 5. Fallback heuristic
    fn_match = re.search(r'(?i)CORTEX\.([A-Z0-9_]+)', query_text)
    fn_name = fn_match.group(1).upper() if fn_match else "CORTEX"

    quotes = re.findall(r"'([^']{10,})'", query_text)
    prompt = quotes[0] if quotes else query_text[:300]
    return {
        "function": fn_name,
        "model": "cortex-built-in" if fn_name != "COMPLETE" else "auto-detected",
        "prompt": scrub_pii(prompt.strip())
    }


def list_cortex_requests(
    credentials: Dict[str, Any],
    filters: Optional[Dict[str, Any]] = None,
    page: int = 1,
    page_size: int = 25,
    sort_by: str = "START_TIME",
    sort_order: str = "DESC"
) -> Dict[str, Any]:
    """
    Retrieves granular per-request Cortex AI telemetry by querying Snowflake ACCOUNT_USAGE
    joined to query-level cortex logs, with real-time token and credit estimation fallback.
    """
    try:
        filters = filters or {}
        user_filter = filters.get("user")
        model_filter = filters.get("model")
        search_query = filters.get("search")
        min_tokens = filters.get("minTokens")

        time_range = filters.get("timeRange") or credentials.get("timeRange", "monthly")
        window = resolve_time_range(time_range)
        date_filter = window["date_filter_au"]

        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        identity = get_session_identity(cur)
        credit_rate = resolve_credit_rate(cur, identity.get("edition", "ENTERPRISE"))

        # Check availability of CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY
        cur.execute("SHOW VIEWS LIKE 'CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY' IN SCHEMA SNOWFLAKE.ACCOUNT_USAGE")
        has_query_cortex_view = bool(cur.fetchall())

        # Exclude telemetry/metadata queries that search for cortex queries
        where_clauses = [
            f"qh.START_TIME >= {date_filter}",
            "qh.QUERY_TEXT NOT ILIKE '%ACCOUNT_USAGE.QUERY_HISTORY%'",
            "qh.QUERY_TEXT NOT ILIKE '%ACCOUNT_USAGE.CORTEX%'",
            "qh.QUERY_TEXT NOT ILIKE '%INFORMATION_SCHEMA%'",
            "qh.QUERY_TEXT NOT ILIKE '%SHOW VIEWS%'",
            "qh.QUERY_TEXT NOT ILIKE '%SHOW TABLES%'",
            "qh.QUERY_TEXT NOT ILIKE '%SHOW PARAMETERS%'",
            "qh.QUERY_TEXT NOT ILIKE '%CORTEX_FUNCTIONS%'"
        ]

        if has_query_cortex_view:
            where_clauses.append("""(
                cq.QUERY_ID IS NOT NULL
                OR qh.QUERY_TEXT ILIKE '%SNOWFLAKE.CORTEX.%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.COMPLETE%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.EXTRACT_ANSWER%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.TRANSLATE%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.SUMMARIZE%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.SENTIMENT%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.AGENT%'
            )""")
            join_clause = "LEFT JOIN SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY cq ON qh.QUERY_ID = cq.QUERY_ID"
            select_cols = """
                qh.QUERY_ID,
                qh.START_TIME,
                qh.USER_NAME,
                qh.ROLE_NAME,
                qh.WAREHOUSE_NAME,
                qh.TOTAL_ELAPSED_TIME,
                qh.EXECUTION_STATUS,
                qh.QUERY_TEXT,
                COALESCE(cq.MODEL_NAME, 'Auto') AS MODEL_NAME,
                COALESCE(cq.TOKENS, 0) AS TOKENS,
                COALESCE(cq.TOKEN_CREDITS, qh.CREDITS_USED_CLOUD_SERVICES, 0) AS CREDITS
            """
        else:
            where_clauses.append("""(
                qh.QUERY_TEXT ILIKE '%SNOWFLAKE.CORTEX.%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.COMPLETE%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.EXTRACT_ANSWER%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.TRANSLATE%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.SUMMARIZE%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.SENTIMENT%'
                OR qh.QUERY_TEXT ILIKE '%CORTEX.AGENT%'
            )""")
            join_clause = ""
            select_cols = """
                qh.QUERY_ID,
                qh.START_TIME,
                qh.USER_NAME,
                qh.ROLE_NAME,
                qh.WAREHOUSE_NAME,
                qh.TOTAL_ELAPSED_TIME,
                qh.EXECUTION_STATUS,
                qh.QUERY_TEXT,
                'Auto' AS MODEL_NAME,
                0 AS TOKENS,
                COALESCE(qh.CREDITS_USED_CLOUD_SERVICES, 0) AS CREDITS
            """

        if user_filter:
            where_clauses.append(f"qh.USER_NAME = '{user_filter}'")

        if search_query:
            clean_search = search_query.replace("'", "''")
            where_clauses.append(f"(qh.QUERY_TEXT ILIKE '%{clean_search}%' OR qh.QUERY_ID ILIKE '%{clean_search}%')")

        where_sql = " AND ".join(where_clauses)
        offset = max(0, (page - 1) * page_size)

        # Count total records for pagination
        count_sql = f"""
            SELECT COUNT(*)
            FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY qh
            {join_clause}
            WHERE {where_sql}
        """
        cur.execute(count_sql)
        total_count = cur.fetchone()[0] or 0

        # Validate sorting
        valid_sort_cols = {
            "START_TIME": "qh.START_TIME",
            "TOTAL_ELAPSED_TIME": "qh.TOTAL_ELAPSED_TIME",
            "TOKENS": "TOKENS",
            "CREDITS": "CREDITS",
            "USER_NAME": "qh.USER_NAME"
        }
        order_col = valid_sort_cols.get(sort_by.upper(), "qh.START_TIME")
        direction = "ASC" if sort_order.upper() == "ASC" else "DESC"

        data_sql = f"""
            SELECT {select_cols}
            FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY qh
            {join_clause}
            WHERE {where_sql}
            ORDER BY {order_col} {direction}
            LIMIT {int(page_size)} OFFSET {int(offset)}
        """
        cur.execute(data_sql)
        col_names = [d[0].lower() for d in cur.description]
        raw_rows = [dict(zip(col_names, row)) for row in cur.fetchall()]

        requests = []
        for r in raw_rows:
            parsed = extract_prompt_and_model(r.get("query_text", ""))
            tokens = int(r.get("tokens") or 0)
            credits = float(r.get("credits") or 0)
            duration_ms = int(r.get("total_elapsed_time") or 0)

            model_name = r.get("model_name")
            if not model_name or model_name in ("Auto", "Unknown"):
                model_name = parsed["model"]

            # If Snowflake Account Usage has not yet populated tokens for this query,
            # calculate prompt/completion tokens and credit rate accurately
            is_estimated = False
            if tokens <= 0:
                est = estimate_cortex_tokens_and_credits(
                    prompt=parsed["prompt"],
                    model_name=model_name,
                    function_name=parsed["function"],
                    duration_ms=duration_ms
                )
                tokens = est["totalTokens"]
                credits = est["credits"]
                is_estimated = True
            elif credits <= 0 and tokens > 0:
                rate_per_m = resolve_model_credit_rate(model_name)
                credits = (tokens / 1_000_000.0) * rate_per_m

            cost_usd = round(credits * credit_rate, 6)

            # Filter post-extract if model filter is applied
            if model_filter and model_filter.lower() not in model_name.lower():
                continue
            if min_tokens and tokens < int(min_tokens):
                continue

            start_dt = r.get("start_time")
            iso_time = start_dt.isoformat() if hasattr(start_dt, "isoformat") else str(start_dt)

            requests.append({
                "queryId": r.get("query_id"),
                "startTime": iso_time,
                "userName": r.get("user_name") or "System",
                "roleName": r.get("role_name") or "PUBLIC",
                "warehouse": r.get("warehouse_name") or "None",
                "durationMs": duration_ms,
                "status": r.get("execution_status") or "SUCCESS",
                "function": parsed["function"],
                "model": model_name,
                "promptSnippet": parsed["prompt"][:240],
                "tokens": tokens,
                "isEstimated": is_estimated,
                "credits": round(credits, 8),
                "costUsd": cost_usd,
            })

        return {
            "status": "success",
            "requests": requests,
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "totalCount": total_count,
                "totalPages": max(1, (total_count + page_size - 1) // page_size)
            }
        }
    except Exception as ex:
        logger.error(f"[list_cortex_requests error]: {ex}")
        return {"status": "error", "message": str(ex), "requests": [], "pagination": {"page": 1, "pageSize": page_size, "totalCount": 0, "totalPages": 1}}


def get_cortex_request_detail(credentials: Dict[str, Any], query_id: str) -> Dict[str, Any]:
    """Retrieves full SQL, prompt payload, cost breakdown, and parameters for one specific request."""
    if not query_id:
        return {"status": "error", "message": "Query ID is required."}

    try:
        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        identity = get_session_identity(cur)
        credit_rate = resolve_credit_rate(cur, identity.get("edition", "ENTERPRISE"))

        sql = """
            SELECT 
                qh.QUERY_ID,
                qh.START_TIME,
                qh.END_TIME,
                qh.USER_NAME,
                qh.ROLE_NAME,
                qh.WAREHOUSE_NAME,
                qh.TOTAL_ELAPSED_TIME,
                qh.EXECUTION_STATUS,
                qh.ERROR_CODE,
                qh.ERROR_MESSAGE,
                qh.QUERY_TEXT,
                qh.QUERY_TAG,
                COALESCE(qh.CREDITS_USED_CLOUD_SERVICES, 0) AS CREDITS
            FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY qh
            WHERE qh.QUERY_ID = %s
            LIMIT 1
        """
        cur.execute(sql, (query_id,))
        col_names = [d[0].lower() for d in cur.description]
        row = cur.fetchone()
        if not row:
            # Fallback to INFORMATION_SCHEMA for live recent query
            cur.execute("""
                SELECT 
                    QUERY_ID, START_TIME, END_TIME, USER_NAME, ROLE_NAME, WAREHOUSE_NAME,
                    TOTAL_ELAPSED_TIME, EXECUTION_STATUS, ERROR_CODE, ERROR_MESSAGE,
                    QUERY_TEXT, QUERY_TAG, 0 AS CREDITS
                FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY())
                WHERE QUERY_ID = %s
                LIMIT 1
            """, (query_id,))
            col_names = [d[0].lower() for d in cur.description]
            row = cur.fetchone()

        if not row:
            return {"status": "not_found", "message": f"No request found matching Query ID '{query_id}'."}

        raw_data = dict(zip(col_names, row))
        parsed = extract_prompt_and_model(raw_data.get("query_text", ""))
        duration_ms = int(raw_data.get("total_elapsed_time") or 0)
        model_name = parsed["model"]

        est = estimate_cortex_tokens_and_credits(
            prompt=parsed["prompt"],
            model_name=model_name,
            function_name=parsed["function"],
            duration_ms=duration_ms
        )

        credits = est["credits"]
        cost_usd = round(credits * credit_rate, 6)

        start_dt = raw_data.get("start_time")
        end_dt = raw_data.get("end_time")

        return {
            "status": "success",
            "detail": {
                "queryId": raw_data.get("query_id"),
                "startTime": start_dt.isoformat() if hasattr(start_dt, "isoformat") else str(start_dt),
                "endTime": end_dt.isoformat() if hasattr(end_dt, "isoformat") else str(end_dt),
                "userName": raw_data.get("user_name"),
                "roleName": raw_data.get("role_name"),
                "warehouse": raw_data.get("warehouse_name") or "None",
                "durationMs": duration_ms,
                "status": raw_data.get("execution_status"),
                "errorCode": raw_data.get("error_code"),
                "errorMessage": raw_data.get("error_message"),
                "queryTag": raw_data.get("query_tag"),
                "function": parsed["function"],
                "model": model_name,
                "prompt": parsed["prompt"],
                "rawSql": raw_data.get("query_text"),
                "tokens": est["totalTokens"],
                "promptTokens": est["promptTokens"],
                "completionTokens": est["completionTokens"],
                "isEstimated": True,
                "credits": round(credits, 8),
                "costUsd": cost_usd,
                "ratePerM": est["ratePerM"]
            }
        }
    except Exception as ex:
        logger.error(f"[get_cortex_request_detail error]: {ex}")
        return {"status": "error", "message": str(ex)}


def get_cortex_users_summary(credentials: Dict[str, Any], time_range: str = "monthly") -> Dict[str, Any]:
    """Returns aggregated per-user scorecard of Cortex AI usage."""
    try:
        window = resolve_time_range(time_range)
        date_filter = window["date_filter_au"]

        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        identity = get_session_identity(cur)
        credit_rate = resolve_credit_rate(cur, identity.get("edition", "ENTERPRISE"))

        sql = f"""
            SELECT 
                qh.USER_NAME,
                COUNT(*) AS TOTAL_REQUESTS,
                AVG(qh.TOTAL_ELAPSED_TIME) AS AVG_LATENCY_MS,
                MAX(qh.START_TIME) AS LAST_ACTIVE
            FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY qh
            WHERE qh.START_TIME >= {date_filter}
              AND (
                  qh.QUERY_TEXT ILIKE '%SNOWFLAKE.CORTEX.%' 
                  OR qh.QUERY_TEXT ILIKE '%CORTEX.COMPLETE%'
                  OR qh.QUERY_TEXT ILIKE '%CORTEX.EXTRACT_ANSWER%'
                  OR qh.QUERY_TEXT ILIKE '%CORTEX.TRANSLATE%'
                  OR qh.QUERY_TEXT ILIKE '%CORTEX.SUMMARIZE%'
                  OR qh.QUERY_TEXT ILIKE '%CORTEX.AGENT%'
              )
              AND qh.QUERY_TEXT NOT ILIKE '%ACCOUNT_USAGE.QUERY_HISTORY%'
              AND qh.QUERY_TEXT NOT ILIKE '%ACCOUNT_USAGE.CORTEX%'
              AND qh.QUERY_TEXT NOT ILIKE '%INFORMATION_SCHEMA%'
              AND qh.QUERY_TEXT NOT ILIKE '%SHOW VIEWS%'
              AND qh.USER_NAME IS NOT NULL
            GROUP BY qh.USER_NAME
            ORDER BY TOTAL_REQUESTS DESC
            LIMIT 50
        """
        cur.execute(sql)
        users = []
        for r in cur.fetchall():
            req_count = int(r[1] or 0)
            avg_lat = float(r[2] or 0)
            last_dt = r[3]
            # Average estimate per request: ~200 tokens
            est_tokens = req_count * 200
            est_credits = (est_tokens / 1_000_000.0) * 0.08
            est_cost = est_credits * credit_rate
            users.append({
                "user": r[0],
                "requests": req_count,
                "credits": round(est_credits, 6),
                "costUsd": round(est_cost, 4),
                "avgLatencyMs": round(avg_lat, 1),
                "lastActive": last_dt.isoformat() if hasattr(last_dt, "isoformat") else str(last_dt)
            })

        return {"status": "success", "users": users}
    except Exception as ex:
        logger.error(f"[get_cortex_users_summary error]: {ex}")
        return {"status": "error", "message": str(ex), "users": []}
