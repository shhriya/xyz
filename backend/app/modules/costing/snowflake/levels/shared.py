import logging
from typing import Any, Dict, List

logger = logging.getLogger("uvicorn.error")

# Time-window SQL fragments shared by every level. `_au`/`_date` distinguish filtering a
# TIMESTAMP column (ACCOUNT_USAGE views, keyed by START_TIME) from a DATE column
# (ORGANIZATION_USAGE/daily-usage views, keyed by USAGE_DATE) — comparing a DATE column to a
# TIMESTAMP expression silently works in Snowflake but is worth keeping explicit.
TIME_RANGES = {
    "weekly": {
        "date_filter_au": "DATEADD(day, -7, CURRENT_TIMESTAMP())",
        "date_filter_date": "DATEADD(day, -7, CURRENT_DATE())",
        "period_str": "Last 7 Days",
        "trend_group": "START_TIME::DATE, TO_CHAR(START_TIME, 'Dy')",
    },
    "yearly": {
        "date_filter_au": "DATEADD(day, -365, CURRENT_TIMESTAMP())",
        "date_filter_date": "DATEADD(day, -365, CURRENT_DATE())",
        "period_str": "Last 365 Days",
        "trend_group": "DATE_TRUNC('MONTH', START_TIME), TO_CHAR(START_TIME, 'Mon YYYY')",
    },
    "monthly": {
        "date_filter_au": "DATEADD(day, -30, CURRENT_TIMESTAMP())",
        "date_filter_date": "DATEADD(day, -30, CURRENT_DATE())",
        "period_str": "Last 30 Days",
        "trend_group": "START_TIME::DATE, TO_CHAR(START_TIME, 'DD Mon')",
    },
}


def resolve_time_range(time_range: str) -> Dict[str, str]:
    return TIME_RANGES.get(time_range, TIME_RANGES["monthly"])


# Standard credit rates by Snowflake Edition, used only when neither the organization rate sheet
# nor a usage-based rate derivation is reachable (mirrors cost_service.py's existing fallback).
EDITION_RATES = {
    "STANDARD": 2.00,
    "ENTERPRISE": 3.00,
    "BUSINESS_CRITICAL": 4.00,
    "TRIAL": 2.50,
    "UNKNOWN": 3.00,
}


def run_query(cur, sql: str) -> List[Dict[str, Any]]:
    """Execute SQL and return rows as dicts keyed by lowercase column name — the generic
    "run SQL, get rows" helper the costing module didn't have before (every metric used to
    hand-roll its own execute/fetchall loop)."""
    cur.execute(sql)
    cols = [d[0].lower() for d in (cur.description or [])]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def get_session_identity(cur) -> Dict[str, str]:
    active_role, active_wh, snowflake_ver, edition = "UNKNOWN", "UNKNOWN", "Unknown", "ENTERPRISE"
    try:
        cur.execute("SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_VERSION()")
        row = cur.fetchone()
        if row:
            active_role = row[0] or "UNKNOWN"
            active_wh = row[1] or "UNKNOWN"
            snowflake_ver = row[2] or "Unknown"
    except Exception:
        pass
    try:
        cur.execute("SHOW PARAMETERS LIKE 'EDITION' IN ACCOUNT")
        p_row = cur.fetchone()
        if p_row and len(p_row) > 1:
            edition = str(p_row[1]).upper()
    except Exception:
        pass
    return {"role": active_role, "warehouse": active_wh, "version": snowflake_ver, "edition": edition}


def resolve_credit_rate(cur, edition: str) -> float:
    """Same resolution order cost_service.py already uses: a usage-derived rate from the
    organization's own billing, then the published rate sheet, then standard list pricing."""
    try:
        cur.execute("""
            SELECT USAGE_IN_CURRENCY, CREDITS_USED
            FROM SNOWFLAKE.ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY
            WHERE CREDITS_USED > 0 AND USAGE_IN_CURRENCY > 0
            ORDER BY USAGE_DATE DESC LIMIT 1
        """)
        row = cur.fetchone()
        if row and row[0] and row[1]:
            return round(float(row[0]) / float(row[1]), 4)
    except Exception:
        pass
    try:
        cur.execute("""
            SELECT EFFECTIVE_RATE FROM SNOWFLAKE.ORGANIZATION_USAGE.RATE_SHEET_DAILY
            WHERE SERVICE_TYPE = 'COMPUTE' AND EFFECTIVE_RATE > 0
            ORDER BY DATE DESC LIMIT 1
        """)
        row = cur.fetchone()
        if row and row[0]:
            return round(float(row[0]), 4)
    except Exception:
        pass
    return EDITION_RATES.get(edition, EDITION_RATES["UNKNOWN"])


def is_permission_error(err: Exception) -> bool:
    msg = str(err).lower()
    return "does not exist" in msg or "not authorized" in msg or "insufficient privileges" in msg


def _infer_env(name: str) -> str:
    n = (name or "").upper()
    for token, env in (("PROD", "PROD"), ("PRD", "PROD"), ("QA", "QA"), ("UAT", "QA"),
                       ("STG", "QA"), ("STAGE", "QA"), ("DEV", "DEV"), ("TEST", "DEV")):
        if token in n:
            return env
    return "UNTAGGED"


def get_filter_dimensions(cur) -> Dict[str, Any]:
    """Shared filter-bar dimensions used by every costing tab: warehouses, roles, inferred
    environments, tag-derived departments/cost-centers, service types, and — when the role has
    ORGANIZATION_USAGE access — the list of accounts in the organization."""
    warehouses: List[str] = []
    try:
        cur.execute("SHOW WAREHOUSES")
        warehouses = [str(row[0]) for row in cur.fetchall()]
    except Exception:
        pass

    roles: List[str] = []
    try:
        cur.execute("""
            SELECT DISTINCT ROLE_NAME FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
            WHERE START_TIME >= DATEADD(day, -30, CURRENT_TIMESTAMP()) AND ROLE_NAME IS NOT NULL
            LIMIT 200
        """)
        roles = sorted({str(r[0]) for r in cur.fetchall() if r[0]})
    except Exception:
        pass

    service_types: List[str] = []
    try:
        cur.execute("""
            SELECT DISTINCT SERVICE_TYPE FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
            WHERE START_TIME >= DATEADD(day, -30, CURRENT_TIMESTAMP())
        """)
        service_types = sorted({str(r[0]) for r in cur.fetchall() if r[0]})
    except Exception:
        pass

    departments: List[str] = []
    dept_status = "no_tags"
    try:
        cur.execute("""
            SELECT DISTINCT TAG_VALUE FROM SNOWFLAKE.ACCOUNT_USAGE.TAG_REFERENCES
            WHERE TAG_NAME ILIKE ANY ('COST_CENTER', 'COST_CENTRE', 'DEPARTMENT', 'TEAM', 'OWNER')
              AND TAG_VALUE IS NOT NULL
        """)
        departments = sorted({str(r[0]) for r in cur.fetchall() if r[0]})
        dept_status = "available" if departments else "no_tags"
    except Exception as e:
        dept_status = "unavailable"
        logger.info(f"Department tag lookup not available: {e}")

    accounts: List[str] = []
    accounts_status = "account_only"
    try:
        cur.execute("""
            SELECT DISTINCT ACCOUNT_NAME FROM SNOWFLAKE.ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY
            WHERE USAGE_DATE >= DATEADD(day, -30, CURRENT_DATE())
        """)
        accounts = sorted({str(r[0]) for r in cur.fetchall() if r[0]})
        if accounts:
            accounts_status = "organization"
    except Exception:
        pass

    environments = sorted({_infer_env(w) for w in warehouses} | {"PROD", "QA", "DEV", "UNTAGGED"})

    return {
        "warehouses": warehouses,
        "roles": roles,
        "environments": environments,
        "environmentInferred": True,
        "departments": departments,
        "departmentStatus": dept_status,
        "serviceTypes": service_types,
        "accounts": accounts,
        "accountsStatus": accounts_status,
    }
