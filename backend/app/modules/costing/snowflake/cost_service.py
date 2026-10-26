import os
import time
import json
import logging
from typing import Dict, Any, List
try:
    import snowflake.connector
    SNOWFLAKE_AVAILABLE = True
except ImportError:
    snowflake = None
    SNOWFLAKE_AVAILABLE = False
import datetime
from typing import Optional

logger = logging.getLogger("uvicorn.error")

# Standard credit rates by Snowflake Edition if ORGADMIN rate sheet is not accessible
EDITION_RATES = {
    "STANDARD": 2.00,
    "ENTERPRISE": 3.00,
    "BUSINESS_CRITICAL": 4.00,
    "TRIAL": 2.50,
    "UNKNOWN": 3.00
}

WH_SIZE_CREDITS = {
    "X-Small": 1, "Small": 2, "Medium": 4, "Large": 8,
    "X-Large": 16, "2X-Large": 32, "3X-Large": 64, "4X-Large": 128,
    "5X-Large": 256, "6X-Large": 512
}


def sanitize_account_identifier(raw_account: str) -> str:
    """Cleans account URL or host to bare Snowflake account identifier."""
    if not raw_account:
        return ""
    acc = str(raw_account).strip()
    acc = acc.replace("https://", "").replace("http://", "")
    acc = acc.split(".snowflakecomputing.com")[0]
    acc = acc.split("/")[0]
    return acc


def build_snowflake_connection_args(credentials: Dict[str, Any]) -> Dict[str, Any]:
    """
    Constructs real snowflake connection dictionary supporting:
    - Username + Password + MFA TOTP Passcode (passcode, passcode_in_password)
    - External Browser / SSO / Passkey (authenticator='externalbrowser')
    - Key-Pair RSA Private Key (private_key_content or private_key_file)
    - OAuth Token (authenticator='oauth', token)
    """
    account_raw = credentials.get("account", "")
    account = sanitize_account_identifier(account_raw)
    user = str(credentials.get("username", "")).strip()
    password = str(credentials.get("password", "")).strip()
    passcode = str(credentials.get("passcode", "")).strip() or None
    passcode_in_password = credentials.get("passcode_in_password") or credentials.get("passcodeInPassword") or False
    auth_method = credentials.get("authMethod") or credentials.get("auth_method") or "password"
    authenticator = credentials.get("authenticator", "").strip() or None

    role = credentials.get("role", "").strip() or None
    warehouse = credentials.get("warehouse", "").strip() or None
    database = credentials.get("database", "").strip() or None
    schema = credentials.get("schema", "").strip() or None

    private_key_content = credentials.get("privateKey") or credentials.get("private_key") or credentials.get("private_key_content")
    private_key_file = credentials.get("privateKeyPath") or credentials.get("private_key_file")
    private_key_passphrase = credentials.get("privateKeyPassphrase") or credentials.get("private_key_passphrase")
    oauth_token = credentials.get("token") or credentials.get("oauthToken")

    if not account:
        raise ValueError("Snowflake Account Identifier is required.")
    if not user:
        raise ValueError("Snowflake Username is required.")

    conn_args: Dict[str, Any] = {
        "account": account,
        "user": user,
        "client_session_keep_alive": True
    }

    if auth_method == "externalbrowser" or authenticator == "externalbrowser":
        conn_args["authenticator"] = "externalbrowser"
    elif auth_method == "keypair" or (auth_method not in ("password", "password_mfa", "externalbrowser") and (private_key_content or private_key_file)):
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import serialization

        # Key-pair auth builds a JWT whose issuer embeds the username literally; Snowflake compares
        # that against the account's canonical (uppercase, for an unquoted identifier) username, so a
        # lowercase/mixed-case username here causes a real "JWT token is invalid" (390144) even with a
        # correctly registered key. Password auth doesn't have this issue, so this is scoped to key-pair only.
        conn_args["user"] = user.upper()

        key_bytes = None
        if private_key_content:
            key_bytes = private_key_content.strip().encode("utf-8")
        elif private_key_file and os.path.exists(private_key_file):
            with open(private_key_file, "rb") as kf:
                key_bytes = kf.read()
        else:
            raise ValueError("Key-pair authentication selected, but no valid private key content or file was provided.")

        pwd = private_key_passphrase.encode("utf-8") if private_key_passphrase else None
        
        try:
            p_key = serialization.load_pem_private_key(key_bytes, password=pwd, backend=default_backend())
        except (ValueError, TypeError) as e:
            if "Password was given but private key is not encrypted" in str(e):
                p_key = serialization.load_pem_private_key(key_bytes, password=None, backend=default_backend())
            else:
                raise
        pk_der = p_key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
        conn_args["private_key"] = pk_der
    elif auth_method == "oauth" or oauth_token:
        conn_args["authenticator"] = "oauth"
        conn_args["token"] = oauth_token
    else:
        # Method: Standard Password or Password + MFA TOTP passcode
        if not password:
            raise ValueError("Snowflake Password is required for password authentication.")
        conn_args["password"] = password
        
        # Standard Password Only (auth_method == 'password'): do not attach passcode
        if auth_method == "password":
            pass
        elif passcode:
            conn_args["passcode"] = passcode
            conn_args["client_store_temporary_credential"] = True

        if passcode_in_password and auth_method != "password":
            conn_args["passcode_in_password"] = True
        if authenticator and authenticator not in ("externalbrowser", "snowflake"):
            conn_args["authenticator"] = authenticator

    if role:
        conn_args["role"] = role
    if warehouse:
        conn_args["warehouse"] = warehouse
    if database:
        conn_args["database"] = database
    if schema:
        conn_args["schema"] = schema

    return conn_args


from app.modules.cfo_analytics.snowflake_live import (
    get_shared_live_snowflake_connection,
    _SHARED_SNOWFLAKE_SESSION_POOL
)

get_live_snowflake_connection = get_shared_live_snowflake_connection


def test_snowflake_live_connection(credentials: Dict[str, Any]) -> Dict[str, Any]:
    """
    Performs a genuine live Snowflake authentication test.
    Returns real latency, Snowflake version, active user, warehouse, role, and edition.
    Zero mocked data.
    """
    start_time = time.time()
    try:
        conn, is_new = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        cur.execute("SELECT CURRENT_VERSION(), CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_ACCOUNT()")
        row = cur.fetchone()
        latency_ms = int((time.time() - start_time) * 1000)

        version = row[0] if row else "Unknown"
        active_user = row[1] if row else credentials.get("username")
        active_role = row[2] if row else (credentials.get("role") or "DEFAULT")
        active_wh = row[3] if row and row[3] else (credentials.get("warehouse") or "None")
        active_acc = row[4] if row else credentials.get("account")

        # Detect edition
        edition = "STANDARD"
        try:
            cur.execute("SHOW PARAMETERS LIKE 'EDITION' IN ACCOUNT")
            p_row = cur.fetchone()
            if p_row and len(p_row) > 1:
                edition = str(p_row[1]).upper()
        except Exception:
            pass

        cur.close()

        return {
            "status": "success",
            "connected": True,
            "latencyMs": latency_ms,
            "version": version,
            "account": active_acc,
            "username": active_user,
            "role": active_role,
            "warehouse": active_wh,
            "edition": edition,
            "message": f"Successfully authenticated to Snowflake Account '{active_acc}' (Version: {version}, Edition: {edition}) as {active_user} [{active_role}] in {latency_ms}ms."
        }
    except Exception as ex:
        err_msg = str(ex)
        logger.error(f"[Snowflake Live Auth Test Error]: {err_msg}")
        requires_mfa = "MFA with TOTP is required" in err_msg or "394508" in err_msg
        is_totp_invalid = "TOTP Invalid" in err_msg or "394507" in err_msg
        friendly_hint = ""
        if requires_mfa:
            friendly_hint = " • MFA Required: Enter your 6-digit TOTP code in the Passcode field below."
        elif is_totp_invalid:
            friendly_hint = " • TOTP Passcode Expired or Invalid: Authenticator codes refresh every 30 seconds. Please check your Authenticator app and enter a fresh 6-digit passcode."
        return {
            "status": "error",
            "connected": False,
            "mfaRequired": requires_mfa or is_totp_invalid,
            "message": f"Snowflake Authentication Failed: {err_msg}{friendly_hint}"
        }


# ---------------------------------------------------------------------------
# Cortex usage view discovery
#
# Snowflake replaced the legacy CORTEX_FUNCTIONS_* ACCOUNT_USAGE views with CORTEX_AI_FUNCTIONS_*.
# Accounts populate one family or the other, and the newer view stores token counts inside a
# semi-structured column instead of a plain TOKENS column. Hardcoding either shape is what made an
# earlier version of this code fail silently, so the view and its columns are discovered at runtime.
# ---------------------------------------------------------------------------

CORTEX_VIEW_FALLBACKS = [
    "SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_USAGE_HISTORY",
    "SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY",
    "SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY",
    "SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_QUERY_USAGE_HISTORY",
]


def _list_cortex_views(cur):
    """Enumerate whatever Cortex usage views this account actually has, instead of assuming names.
    Snowflake has renamed this family more than once and the sets differ per account/region."""
    found = []
    try:
        cur.execute("SHOW VIEWS LIKE '%CORTEX%' IN SCHEMA SNOWFLAKE.ACCOUNT_USAGE")
        cols = [d[0].lower() for d in (cur.description or [])]
        name_idx = cols.index("name") if "name" in cols else 1
        for r in cur.fetchall():
            found.append(f"SNOWFLAKE.ACCOUNT_USAGE.{r[name_idx]}")
    except Exception as e:
        logger.info(f"Could not enumerate Cortex views, using fallback list: {e}")
    for fb in CORTEX_VIEW_FALLBACKS:
        if fb not in found:
            found.append(fb)
    return found


def _view_columns(cur, fq_view):
    """Column names of a view, or an empty set if it is missing/not authorized."""
    try:
        cur.execute(f"SELECT * FROM {fq_view} LIMIT 0")
        return {d[0].upper() for d in (cur.description or [])}
    except Exception:
        return set()


def _variant_token_keys(cur, fq_view, variant_col):
    """Inspect one real row and return (token_keys, raw_sample). The payload may be an object or an
    array of {name,value} entries, so both are handled; the raw sample is kept for diagnostics."""
    sample = ""
    try:
        cur.execute(f"SELECT {variant_col} FROM {fq_view} WHERE {variant_col} IS NOT NULL LIMIT 1")
        row = cur.fetchone()
        if not row or not row[0]:
            return [], ""
        sample = str(row[0])[:500]
        payload = row[0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        if isinstance(payload, dict):
            keys = [k for k in payload.keys() if "token" in k.lower()]
            totals = [k for k in keys if "total" in k.lower()]
            return (totals or keys), sample
        if isinstance(payload, list):
            keys = []
            for item in payload:
                if isinstance(item, dict):
                    label = str(item.get("name") or item.get("key") or "")
                    if "token" in label.lower():
                        keys.append(label)
            return keys, sample
        return [], sample
    except Exception:
        return [], sample


def _describe_cortex_view(cur, fq, date_filter):
    cols = _view_columns(cur, fq)
    if not cols:
        return None

    time_col = "START_TIME" if "START_TIME" in cols else ("END_TIME" if "END_TIME" in cols else None)
    where_time = f"{time_col} >= {date_filter}" if time_col else "1=1"
    try:
        cur.execute(f"SELECT COUNT(*) FROM {fq} WHERE {where_time}")
        row_count = int((cur.fetchone() or [0])[0] or 0)
    except Exception:
        row_count = 0

    variant_col, metrics_sample = None, ""
    token_col = next((c for c in ("TOKENS", "TOTAL_TOKENS", "TOKEN_COUNT") if c in cols), None)
    if token_col:
        token_expr = f"COALESCE({token_col}, 0)"
    else:
        variant_col = next((c for c in ("METRICS", "USAGE", "DETAILS", "USAGE_DETAILS",
                                        "TOKEN_USAGE", "ATTRIBUTES") if c in cols), None)
        token_keys, metrics_sample = _variant_token_keys(cur, fq, variant_col) if variant_col else ([], "")
        token_expr = " + ".join(
            f"COALESCE(TRY_CAST({variant_col}:\"{k}\"::STRING AS NUMBER), 0)" for k in token_keys
        ) if token_keys else "0"

    credit_col = next((c for c in ("TOKEN_CREDITS", "CREDITS", "CREDITS_USED") if c in cols), None)
    return {
        "view": fq,
        "columns": cols,
        "columnList": sorted(cols),
        "rowCount": row_count,
        "timeCol": time_col,
        "whereTime": where_time,
        "tokenExpr": token_expr,
        "creditExpr": f"COALESCE({credit_col}, 0)" if credit_col else "0",
        "functionCol": "FUNCTION_NAME" if "FUNCTION_NAME" in cols else None,
        "modelCol": "MODEL_NAME" if "MODEL_NAME" in cols else None,
        "userCol": "USER_NAME" if "USER_NAME" in cols else ("USER_ID" if "USER_ID" in cols else None),
        "hasTokens": token_expr != "0",
        "variantCol": variant_col,
        "metricsSample": metrics_sample,
    }


def pick_cortex_source(cur, date_filter):
    """Pick the Cortex view to report from. A view with rows AND real token counts beats one with
    rows but credits only, which beats one that merely exists."""
    described = [d for d in (_describe_cortex_view(cur, fq, date_filter) for fq in _list_cortex_views(cur)) if d]
    if not described:
        return None
    described.sort(key=lambda d: (d["rowCount"] > 0, d["hasTokens"], d["rowCount"]), reverse=True)
    best = described[0]
    best["candidates"] = [
        {"view": d["view"].split(".")[-1], "rows": d["rowCount"], "hasTokens": d["hasTokens"]}
        for d in described
    ]
    return best

def get_snowflake_cost_summary(credentials: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetches genuine Snowflake compute cost telemetry, real-time query executions,
    warehouse credit consumption, and Cortex AI token metrics.
    Compatible with Trial, Standard, Enterprise, and Business Critical accounts.
    Uses INFORMATION_SCHEMA for real-time (last 7 days/hours) and ACCOUNT_USAGE for extended history.
    """
    time_range = credentials.get("timeRange", "monthly")

    # Time window configuration
    if time_range == "weekly":
        date_filter_au = "DATEADD(day, -7, CURRENT_TIMESTAMP())"
        date_filter_is = "DATEADD('day', -7, CURRENT_TIMESTAMP())"
        period_str = "Last 7 Days"
        trend_group = "START_TIME::DATE, TO_CHAR(START_TIME, 'Dy')"
    elif time_range == "yearly":
        date_filter_au = "DATEADD(day, -365, CURRENT_TIMESTAMP())"
        date_filter_is = "DATEADD('day', -7, CURRENT_TIMESTAMP())"
        period_str = "Last 365 Days"
        trend_group = "DATE_TRUNC('MONTH', START_TIME), TO_CHAR(START_TIME, 'Mon YYYY')"
    else:
        # Default monthly (Last 30 Days)
        date_filter_au = "DATEADD(day, -30, CURRENT_TIMESTAMP())"
        date_filter_is = "DATEADD('day', -7, CURRENT_TIMESTAMP())"
        period_str = "Last 30 Days"
        # 'Dy' is only meaningful over a 7-day window. Across 30 days every date would render as a
        # weekday name, so "Thu" appears four or five times and the axis reads as nonsense.
        trend_group = "START_TIME::DATE, TO_CHAR(START_TIME, 'DD Mon')"

    conn = None
    try:
        conn, is_new = get_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()

        # Step 1: Detect Session Identity & Account Edition
        active_role = "UNKNOWN"
        active_wh = "UNKNOWN"
        snowflake_ver = "Unknown"
        edition = "ENTERPRISE"

        try:
            cur.execute("SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_VERSION()")
            s_row = cur.fetchone()
            if s_row:
                active_role = s_row[0] or "UNKNOWN"
                active_wh = s_row[1] or "UNKNOWN"
                snowflake_ver = s_row[2] or "Unknown"
        except Exception:
            pass

        try:
            cur.execute("SHOW PARAMETERS LIKE 'EDITION' IN ACCOUNT")
            p_row = cur.fetchone()
            if p_row and len(p_row) > 1:
                edition = str(p_row[1]).upper()
        except Exception:
            pass

        # Step 2: Determine Credit Rate & Trial Balance
        credit_rate = None
        trial_balance = None
        currency = "USD"

        # Try ORGANIZATION_USAGE if caller has ORGADMIN
        try:
            cur.execute("""
                SELECT USAGE_IN_CURRENCY, CREDITS_USED
                FROM SNOWFLAKE.ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY
                WHERE CREDITS_USED > 0 AND USAGE_IN_CURRENCY > 0
                ORDER BY USAGE_DATE DESC
                LIMIT 1
            """)
            rate_row = cur.fetchone()
            if rate_row and rate_row[0] and rate_row[1]:
                credit_rate = round(float(rate_row[0]) / float(rate_row[1]), 4)
        except Exception:
            pass

        if not credit_rate:
            try:
                cur.execute("""
                    SELECT EFFECTIVE_RATE
                    FROM SNOWFLAKE.ORGANIZATION_USAGE.RATE_SHEET_DAILY
                    WHERE SERVICE_TYPE = 'COMPUTE' AND EFFECTIVE_RATE > 0
                    ORDER BY DATE DESC
                    LIMIT 1
                """)
                rate_row = cur.fetchone()
                if rate_row and rate_row[0]:
                    credit_rate = round(float(rate_row[0]), 4)
            except Exception:
                pass

        # Remaining balance is INDEPENDENT of the credit rate: a paid account resolves a rate
        # above, and previously that skipped this query entirely, hiding the balance card on
        # exactly the accounts most likely to hold prepaid capacity.
        free_balance = None
        capacity_balance = None
        balance_status = "no_data"
        balance_message = ""

        # REMAINING_BALANCE_DAILY is an ORGANIZATION_USAGE view: try ORGADMIN, restore after.
        original_role = active_role
        switched_role = False
        try:
            cur.execute("USE ROLE ORGADMIN")
            switched_role = True
        except Exception as e:
            logger.info(f"Could not switch to ORGADMIN for balance lookup: {e}")

        try:
            cur.execute("""
                SELECT FREE_USAGE_BALANCE, CAPACITY_BALANCE, CURRENCY
                FROM SNOWFLAKE.ORGANIZATION_USAGE.REMAINING_BALANCE_DAILY
                ORDER BY DATE DESC
                LIMIT 1
            """)
            bal_row = cur.fetchone()
            if bal_row:
                free_balance = float(bal_row[0] or 0)
                capacity_balance = float(bal_row[1] or 0)
                trial_balance = free_balance + capacity_balance
                currency = bal_row[2] or "USD"
                # Rows exist but both are zero: pay-as-you-go, billed in arrears. That is a real
                # answer, not a failure, so say so rather than showing a bare $0.
                balance_status = "available" if trial_balance > 0 else "no_balance"
                if balance_status == "no_balance":
                    balance_message = "Pay-as-you-go account - no prepaid balance"
        except Exception as e:
            msg = str(e)
            if "does not exist" in msg or "not authorized" in msg or "Insufficient privileges" in msg:
                balance_status = "no_permission"
                balance_message = "Needs ORGADMIN to read the organization balance"
            else:
                balance_status = "not_supported"
                balance_message = "Balance unavailable for this account"
            logger.warning(f"Remaining balance lookup failed ({balance_status}): {msg}")
        finally:
            if switched_role and original_role and original_role != "UNKNOWN":
                try:
                    cur.execute(f"USE ROLE {original_role}")
                except Exception as e:
                    logger.warning(f"Could not restore role {original_role} after balance lookup: {e}")

        # Fallback to standard Snowflake list pricing if ORGADMIN is not available
        if not credit_rate:
            credit_rate = EDITION_RATES.get(edition, EDITION_RATES["UNKNOWN"])
            logger.info(f"Using standard {edition} pricing: ${credit_rate}/credit")

        # Step 3: Virtual Warehouse Telemetry (SHOW WAREHOUSES)
        warehouses_map = {}
        try:
            cur.execute("SHOW WAREHOUSES")
            wh_cfgs = cur.fetchall()
            for wh_cfg in wh_cfgs:
                wh_name = str(wh_cfg[0])
                wh_size = str(wh_cfg[3]) if len(wh_cfg) > 3 else "X-Small"
                auto_suspend = int(wh_cfg[11]) if len(wh_cfg) > 11 and wh_cfg[11] is not None else 300
                started_clusters = int(wh_cfg[6]) if len(wh_cfg) > 6 and wh_cfg[6] is not None else 1

                warehouses_map[wh_name] = {
                    "name": wh_name,
                    "size": wh_size,
                    "creditsConsumed": 0.0,
                    "costUsd": 0.0,
                    "autoSuspendSec": auto_suspend,
                    "activeClusters": started_clusters,
                    "optimization": "Optimal" if auto_suspend <= 300 else "Warning",
                    "recommendation": f"Auto-suspend set to {auto_suspend}s." if auto_suspend <= 300 else f"Auto-suspend is {auto_suspend}s. Reduce to 60s to avoid idle credit burn."
                }
        except Exception as e:
            logger.warning(f"SHOW WAREHOUSES not permitted or failed: {e}")

        # Step 4: Real-Time Warehouse Credit Consumption
        # Try real-time INFORMATION_SCHEMA first, blend with ACCOUNT_USAGE if available
        has_wh_credits = False
        try:
            cur.execute(f"""
                SELECT 
                    WAREHOUSE_NAME, 
                    SUM(CREDITS_USED) AS TOTAL_CREDITS
                FROM TABLE(INFORMATION_SCHEMA.WAREHOUSE_METERING_HISTORY(
                    DATE_RANGE_START => {date_filter_is}
                ))
                WHERE WAREHOUSE_NAME IS NOT NULL
                GROUP BY WAREHOUSE_NAME
                ORDER BY TOTAL_CREDITS DESC
            """)
            for row in cur.fetchall():
                wh_name = str(row[0])
                cr = round(float(row[1] or 0), 2)
                if wh_name not in warehouses_map:
                    warehouses_map[wh_name] = {
                        "name": wh_name,
                        "size": "X-Small",
                        "creditsConsumed": cr,
                        "costUsd": round(cr * credit_rate, 2),
                        "autoSuspendSec": 300,
                        "activeClusters": 1,
                        "optimization": "Optimal",
                        "recommendation": "Real-time telemetry loaded."
                    }
                else:
                    warehouses_map[wh_name]["creditsConsumed"] = cr
                    warehouses_map[wh_name]["costUsd"] = round(cr * credit_rate, 2)
                has_wh_credits = True
        except Exception as ex:
            logger.info(f"INFORMATION_SCHEMA.WAREHOUSE_METERING_HISTORY info: {ex}")

        # If time_range is yearly or monthly and ACCOUNT_USAGE is accessible, query ACCOUNT_USAGE
        if time_range in ("monthly", "yearly") or not has_wh_credits:
            try:
                cur.execute(f"""
                    SELECT 
                        WAREHOUSE_NAME, 
                        SUM(CREDITS_USED) AS TOTAL_CREDITS
                    FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
                    WHERE START_TIME >= {date_filter_au}
                      AND WAREHOUSE_NAME IS NOT NULL
                    GROUP BY WAREHOUSE_NAME
                    ORDER BY TOTAL_CREDITS DESC
                    LIMIT 20
                """)
                for row in cur.fetchall():
                    wh_name = str(row[0])
                    cr = round(float(row[1] or 0), 2)
                    if wh_name in warehouses_map:
                        # Use greater value to ensure both historical and real-time are captured
                        warehouses_map[wh_name]["creditsConsumed"] = max(warehouses_map[wh_name]["creditsConsumed"], cr)
                        warehouses_map[wh_name]["costUsd"] = round(warehouses_map[wh_name]["creditsConsumed"] * credit_rate, 2)
                    else:
                        warehouses_map[wh_name] = {
                            "name": wh_name,
                            "size": "Unknown",
                            "creditsConsumed": cr,
                            "costUsd": round(cr * credit_rate, 2),
                            "autoSuspendSec": 300,
                            "activeClusters": 1,
                            "optimization": "Optimal",
                            "recommendation": "Historical telemetry loaded."
                        }
            except Exception as ex:
                logger.info(f"ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY info: {ex}")

        warehouses = list(warehouses_map.values())
        wh_size_lookup = {w["name"]: WH_SIZE_CREDITS.get(w.get("size", ""), 1) for w in warehouses}

        # Step 5: Real-Time Query History & User Attribution
        # Query real-time INFORMATION_SCHEMA.QUERY_HISTORY
        all_queries = []
        users_map = {}

        try:
            cur.execute("""
                SELECT
                    QUERY_ID,
                    USER_NAME,
                    ROLE_NAME,
                    WAREHOUSE_NAME,
                    QUERY_TYPE,
                    LEFT(QUERY_TEXT, 4000) AS QUERY_TEXT,
                    TOTAL_ELAPSED_TIME / 1000.0 AS ELAPSED_SEC,
                    EXECUTION_STATUS,
                    START_TIME,
                    ROWS_PRODUCED,
                    COALESCE(ERROR_MESSAGE, '') AS ERROR_MESSAGE,
                    COALESCE(DATABASE_NAME, '') AS DATABASE_NAME
                FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY(
                    END_TIME_RANGE_START => DATEADD('day', -7, CURRENT_TIMESTAMP()),
                    RESULT_LIMIT => 1000
                ))
                WHERE USER_NAME != 'SYSTEM'
                  AND ROLE_NAME != 'SNOWFLAKE'
                  AND QUERY_TEXT IS NOT NULL
                ORDER BY START_TIME DESC
            """)
            for row in cur.fetchall():
                qid = str(row[0])
                uname = str(row[1] or "UNKNOWN")
                rname = str(row[2] or "UNKNOWN")
                wname = str(row[3] or "UNKNOWN")
                qtype = str(row[4] or "UNKNOWN")
                qtext = (row[5] or "").strip()
                elapsed = float(row[6] or 0)
                status = str(row[7] or "SUCCESS")
                stime = str(row[8]) if row[8] else ""
                rprod = int(row[9] or 0)
                errmsg = str(row[10] or "")
                dbname = str(row[11] or "") if len(row) > 11 else ""

                credits_per_hour = wh_size_lookup.get(wname, 1)
                est_credits = round((elapsed / 3600.0) * credits_per_hour, 5)
                est_cost = round(est_credits * credit_rate, 4)

                q_obj = {
                    "queryId": qid,
                    "userName": uname,
                    "roleName": rname,
                    "warehouseName": wname,
                    "queryType": qtype,
                    "queryText": qtext,
                    "elapsedSec": round(elapsed, 2),
                    "status": status,
                    "startTime": stime,
                    "rowsProduced": rprod,
                    "errorMessage": errmsg,
                    "databaseName": dbname,
                    "estimatedCredits": est_credits,
                    "estimatedCostUsd": est_cost,
                    "source": "REAL_TIME"
                }
                all_queries.append(q_obj)

                if uname not in users_map:
                    users_map[uname] = {
                        "userId": uname,
                        "username": uname,
                        "email": uname,
                        "role": rname,
                        "queriesRun": 0,
                        "creditsConsumed": 0.0,
                        "estimatedCostUsd": 0.0,
                        "topWarehouse": wname,
                        "avgQueryTimeSec": 0.0,
                        "totalElapsed": 0.0,
                        "status": "Active",
                        "queries": []
                    }
                u = users_map[uname]
                u["queriesRun"] += 1
                u["creditsConsumed"] = round(u["creditsConsumed"] + est_credits, 4)
                u["estimatedCostUsd"] = round(u["creditsConsumed"] * credit_rate, 2)
                u["totalElapsed"] += elapsed
                u["queries"].append(q_obj)
        except Exception as ex:
            logger.info(f"Real-time INFORMATION_SCHEMA query error: {ex}")

        # If user selected monthly/yearly, or if INFORMATION_SCHEMA had few queries, query ACCOUNT_USAGE
        if time_range in ("monthly", "yearly") or len(all_queries) < 5:
            try:
                cur.execute(f"""
                    SELECT
                        QUERY_ID,
                        USER_NAME,
                        ROLE_NAME,
                        WAREHOUSE_NAME,
                        QUERY_TYPE,
                        LEFT(QUERY_TEXT, 4000) AS QUERY_TEXT,
                        TOTAL_ELAPSED_TIME / 1000.0 AS ELAPSED_SEC,
                        EXECUTION_STATUS,
                        START_TIME,
                        ROWS_PRODUCED,
                        COALESCE(ERROR_MESSAGE, '') AS ERROR_MESSAGE,
                    COALESCE(DATABASE_NAME, '') AS DATABASE_NAME
                    FROM (
                        SELECT
                            QUERY_ID,
                            USER_NAME,
                            ROLE_NAME,
                            WAREHOUSE_NAME,
                            QUERY_TYPE,
                            QUERY_TEXT,
                            TOTAL_ELAPSED_TIME,
                            EXECUTION_STATUS,
                            START_TIME,
                            ROWS_PRODUCED,
                            ERROR_MESSAGE,
                            ROW_NUMBER() OVER (PARTITION BY USER_NAME ORDER BY START_TIME DESC) AS RN
                        FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
                        WHERE START_TIME >= {date_filter_au}
                          AND TOTAL_ELAPSED_TIME > 0
                          AND USER_NAME != 'SYSTEM'
                          AND ROLE_NAME != 'SNOWFLAKE'
                          AND QUERY_TEXT IS NOT NULL
                    )
                    WHERE RN <= 30
                    ORDER BY START_TIME DESC
                """)
                existing_qids = {q["queryId"] for q in all_queries}
                for row in cur.fetchall():
                    qid = str(row[0])
                    if qid in existing_qids:
                        continue
                    uname = str(row[1] or "UNKNOWN")
                    rname = str(row[2] or "UNKNOWN")
                    wname = str(row[3] or "UNKNOWN")
                    qtype = str(row[4] or "UNKNOWN")
                    qtext = (row[5] or "").strip()
                    elapsed = float(row[6] or 0)
                    status = str(row[7] or "SUCCESS")
                    stime = str(row[8]) if row[8] else ""
                    rprod = int(row[9] or 0)
                    errmsg = str(row[10] or "")
                    dbname = str(row[11] or "") if len(row) > 11 else ""

                    credits_per_hour = wh_size_lookup.get(wname, 1)
                    est_credits = round((elapsed / 3600.0) * credits_per_hour, 5)
                    est_cost = round(est_credits * credit_rate, 4)

                    q_obj = {
                        "queryId": qid,
                        "userName": uname,
                        "roleName": rname,
                        "warehouseName": wname,
                        "queryType": qtype,
                        "queryText": qtext,
                        "elapsedSec": round(elapsed, 2),
                        "status": status,
                        "startTime": stime,
                        "rowsProduced": rprod,
                        "errorMessage": errmsg,
                    "databaseName": dbname,
                        "estimatedCredits": est_credits,
                        "estimatedCostUsd": est_cost,
                        "source": "ACCOUNT_USAGE"
                    }
                    all_queries.append(q_obj)

                    if uname not in users_map:
                        users_map[uname] = {
                            "userId": uname,
                            "username": uname,
                            "email": uname,
                            "role": rname,
                            "queriesRun": 0,
                            "creditsConsumed": 0.0,
                            "estimatedCostUsd": 0.0,
                            "topWarehouse": wname,
                            "avgQueryTimeSec": 0.0,
                            "totalElapsed": 0.0,
                            "status": "Active",
                            "queries": []
                        }
                    u = users_map[uname]
                    u["queriesRun"] += 1
                    u["creditsConsumed"] = round(u["creditsConsumed"] + est_credits, 4)
                    u["estimatedCostUsd"] = round(u["creditsConsumed"] * credit_rate, 2)
                    u["totalElapsed"] += elapsed
                    u["queries"].append(q_obj)
            except Exception as ex:
                logger.info(f"ACCOUNT_USAGE.QUERY_HISTORY query error: {ex}")

        # Compute average elapsed time for users
        for u in users_map.values():
            if u["queriesRun"] > 0:
                u["avgQueryTimeSec"] = round(u["totalElapsed"] / u["queriesRun"], 1)

        # Fetch real emails/roles from ACCOUNT_USAGE.USERS if accessible
        if users_map:
            try:
                user_list_str = ",".join([f"'{u}'" for u in users_map.keys()])
                cur.execute(f"""
                    SELECT NAME, DEFAULT_ROLE, EMAIL 
                    FROM SNOWFLAKE.ACCOUNT_USAGE.USERS 
                    WHERE NAME IN ({user_list_str})
                """)
                for u_row in cur.fetchall():
                    un = u_row[0]
                    if un in users_map:
                        users_map[un]["role"] = u_row[1] or users_map[un]["role"]
                        users_map[un]["email"] = u_row[2] or un
            except Exception:
                pass

        users = list(users_map.values())
        expensive_queries = sorted(all_queries, key=lambda q: q["estimatedCredits"], reverse=True)[:50]

        # Step 6: Snowflake Cortex AI Tokens & AI Credits Telemetry
        #
        # Schema verified directly against a live account (2026-09) rather than assumed — an
        # earlier version of this code guessed column names that don't actually exist on some of
        # these views and silently fell through its own try/except, so nothing was ever flagged.
        # Real, confirmed schemas:
        #   CORTEX_FUNCTIONS_USAGE_HISTORY        : START_TIME, END_TIME, FUNCTION_NAME, MODEL_NAME,
        #                                            WAREHOUSE_ID, TOKEN_CREDITS, TOKENS
        #   CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY  : QUERY_ID, WAREHOUSE_ID, MODEL_NAME, FUNCTION_NAME,
        #                                            TOKENS, TOKEN_CREDITS  (query-grain, no name columns —
        #                                            must join QUERY_ID to QUERY_HISTORY for USER_NAME/WAREHOUSE_NAME)
        #   CORTEX_AI_FUNCTIONS_USAGE_HISTORY     : newer replacement view; has USER_ID/CREDITS but no
        #                                            TOKENS/TOKEN_CREDITS columns (tokens live inside a
        #                                            METRICS variant whose keys aren't documented here) —
        #                                            deliberately NOT used for token/credit numbers.
        cortex_usage = {
            "totalTokens": 0,
            "promptTokens": 0,
            "completionTokens": 0,
            "aiCredits": 0.0,
            "models": [],
            "trend": [],
            "byUser": [],
            "byWarehouse": [],
            "attributionAvailable": True,
            "status": "no_usage",
            "statusMessage": "",
            "recentCallCount": 0,
            "recentLastRunAt": "",
            "sourceView": "",
            "tokensAvailable": True,
            "sourceColumns": [],
            "metricsSample": "",
            "tokenExpr": "",
            "candidateViews": [],
        }
        cortex_query_error = ""

        cortex_source = pick_cortex_source(cur, date_filter_au)
        if cortex_source:
            cortex_usage["sourceView"] = cortex_source["view"]
            cortex_usage["tokensAvailable"] = cortex_source["hasTokens"]
            cortex_usage["sourceColumns"] = cortex_source["columnList"]
            cortex_usage["metricsSample"] = cortex_source["metricsSample"]
            cortex_usage["candidateViews"] = cortex_source.get("candidates", [])
            cortex_usage["tokenExpr"] = cortex_source["tokenExpr"]
            logger.info(
                f"Cortex usage source: {cortex_source['view']} rows={cortex_source['rowCount']} "
                f"columns={cortex_source['columnList']} variant={cortex_source['variantCol']} "
                f"tokenExpr={cortex_source['tokenExpr']} sample={cortex_source['metricsSample'][:300]}"
            )

        try:
            if not cortex_source:
                raise RuntimeError("No Cortex usage view is available on this account.")
            fn_col = cortex_source["functionCol"] or "'CORTEX'"
            model_col = f"COALESCE({cortex_source['modelCol']}, 'DEFAULT')" if cortex_source["modelCol"] else "'DEFAULT'"
            cur.execute(f"""
                SELECT
                    {fn_col} AS FUNCTION_NAME,
                    {model_col} AS MODEL,
                    COUNT(*) AS INVOCATIONS,
                    SUM({cortex_source["tokenExpr"]}) AS TOTAL_TOKENS,
                    SUM({cortex_source["creditExpr"]}) AS CREDITS_USED,
                    {"MAX(END_TIME)" if "END_TIME" in cortex_source["columns"] else "NULL"} AS LAST_USED
                FROM {cortex_source["view"]}
                WHERE {cortex_source["whereTime"]}
                GROUP BY {fn_col}, {model_col}
                ORDER BY TOTAL_TOKENS DESC
            """)
            for cr in cur.fetchall():
                toks = int(cr[3] or 0)
                creds = round(float(cr[4] or 0), 6)
                cortex_usage["totalTokens"] += toks
                cortex_usage["aiCredits"] = round(cortex_usage["aiCredits"] + creds, 6)
                cortex_usage["models"].append({
                    "function": cr[0],
                    "model": cr[1],
                    "invocations": int(cr[2] or 0),
                    "tokens": toks,
                    "credits": creds,
                    "lastUsed": str(cr[5]) if cr[5] else "",
                    "tokensPerCredit": round(toks / creds) if creds > 0 else None
                })
        except Exception as e:
            cortex_query_error = str(e)
            logger.warning(f"CORTEX_FUNCTIONS_USAGE_HISTORY query failed: {e}")

        # Also check METERING_HISTORY for AI_SERVICES credits — this is a BROADER billing bucket
        # than the function-level table above (it also covers Cortex Search, Document AI, Copilot,
        # etc.), so it can legitimately show non-zero credits even when the table above is empty.
        try:
            cur.execute(f"""
                SELECT SUM(CREDITS_USED)
                FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
                WHERE SERVICE_TYPE = 'AI_SERVICES'
                  AND START_TIME >= {date_filter_au}
            """)
            ai_m_row = cur.fetchone()
            if ai_m_row and ai_m_row[0]:
                ai_serv_credits = round(float(ai_m_row[0]), 4)
                cortex_usage["aiCredits"] = max(cortex_usage["aiCredits"], ai_serv_credits)
        except Exception:
            pass

        # ACCOUNT_USAGE.CORTEX_FUNCTIONS_USAGE_HISTORY is latency-bound (Snowflake populates it up to
        # ~3h after the call), so a Cortex query run minutes ago legitimately shows nothing there.
        # Probe QUERY_HISTORY, which is near real-time, so we can tell "not billed yet" apart from
        # "never used", "no permission" and "view not available on this account".
        if not cortex_usage["models"]:
            # NOTE: the QUERY_HISTORY table function takes END_TIME_RANGE_START — DATE_RANGE_START
            # belongs to WAREHOUSE_METERING_HISTORY and fails here. Try the real-time
            # INFORMATION_SCHEMA function first, then fall back to the ACCOUNT_USAGE view.
            cortex_match = """(
                        QUERY_TEXT ILIKE '%SNOWFLAKE.CORTEX.%'
                        OR QUERY_TEXT ILIKE '%AI_COMPLETE(%'
                        OR QUERY_TEXT ILIKE '%AI_CLASSIFY(%'
                        OR QUERY_TEXT ILIKE '%AI_FILTER(%'
                        OR QUERY_TEXT ILIKE '%AI_AGG(%'
                    )
                    AND QUERY_TEXT NOT ILIKE '%QUERY_HISTORY%'
                    AND EXECUTION_STATUS = 'SUCCESS'"""
            # ACCOUNT_USAGE first: it always resolves. The INFORMATION_SCHEMA table function needs a
            # current database on the session (database is optional on this connection), and without
            # one it fails with "invalid identifier". It is kept as a second pass because it is
            # near real-time, so it can still catch a call made in the last ~45 min that
            # ACCOUNT_USAGE has not published yet.
            probe_variants = [
                f"""SELECT COUNT(*), MAX(START_TIME)
                    FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
                    WHERE START_TIME >= DATEADD('hour', -24, CURRENT_TIMESTAMP())
                      AND {cortex_match}""",
                f"""SELECT COUNT(*), MAX(START_TIME)
                    FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY(
                        END_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP()),
                        RESULT_LIMIT => 10000
                    ))
                    WHERE {cortex_match}""",
            ]
            for probe_sql in probe_variants:
                try:
                    cur.execute(probe_sql)
                    probe_row = cur.fetchone()
                    if probe_row and int(probe_row[0] or 0) > 0:
                        cortex_usage["recentCallCount"] = int(probe_row[0])
                        cortex_usage["recentLastRunAt"] = str(probe_row[1]) if probe_row[1] else ""
                        break
                except Exception as e:
                    logger.info(f"Cortex real-time probe variant failed: {e}")

        # Resolve a single status the UI can act on.
        if cortex_usage["models"]:
            cortex_usage["status"] = "available"
        elif cortex_usage["recentCallCount"] > 0:
            cortex_usage["status"] = "pending_latency"
            cortex_usage["statusMessage"] = (
                f"{cortex_usage['recentCallCount']} Cortex call(s) detected in the last 24h "
                f"(latest {cortex_usage['recentLastRunAt']}). Snowflake's usage views can take up to "
                f"~3 hours to report tokens and credits, so the detail below will fill in shortly."
            )
        elif cortex_query_error:
            low = cortex_query_error.lower()
            if "does not exist" in low or "not authorized" in low or "insufficient privileges" in low:
                cortex_usage["status"] = "no_permission"
                cortex_usage["statusMessage"] = (
                    "Cannot read SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_USAGE_HISTORY. "
                    "The role needs ACCOUNTADMIN, or IMPORTED PRIVILEGES on the SNOWFLAKE database."
                )
            else:
                cortex_usage["status"] = "unavailable"
                cortex_usage["statusMessage"] = f"Cortex usage could not be read: {cortex_query_error[:200]}"
        else:
            cortex_usage["status"] = "no_usage"
            cortex_usage["statusMessage"] = "No Cortex functions were invoked in the selected period."

        # Step 6b: Cortex token/credit trend over the same period as the cost trend chart.
        try:
            if not cortex_source or not cortex_source["timeCol"]:
                raise RuntimeError("No time column on the chosen Cortex view; trend not available.")
            cur.execute(f"""
                SELECT
                    {trend_group},
                    SUM({cortex_source["tokenExpr"]}) AS TOTAL_TOKENS,
                    SUM({cortex_source["creditExpr"]}) AS TOTAL_CREDITS
                FROM {cortex_source["view"]}
                WHERE {cortex_source["whereTime"]}
                GROUP BY {trend_group}
                ORDER BY MIN(START_TIME) ASC
            """)
            for row in cur.fetchall():
                period_label = row[1] if len(row) > 2 else row[0]
                toks = int(row[2] or 0) if len(row) > 2 else int(row[1] or 0)
                creds = float(row[3] or 0) if len(row) > 2 else 0.0
                cortex_usage["trend"].append({
                    "period": str(period_label),
                    "tokens": toks,
                    "credits": round(creds, 6)
                })
        except Exception as e:
            logger.warning(f"Cortex trend query failed: {e}")

        # Step 6c: Per-user and per-warehouse Cortex attribution. CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY
        # has the token/credit numbers per query but only WAREHOUSE_ID (no name, no user at all) — it
        # has to be joined to QUERY_HISTORY on QUERY_ID to get USER_NAME/WAREHOUSE_NAME. If this join
        # isn't accessible (privilege, or the query-level view doesn't exist on this account/edition),
        # attributionAvailable is set False so the UI says so honestly instead of showing an empty
        # table that looks like "zero users used Cortex."
        try:
            # The newer view carries the user itself, so no join to QUERY_HISTORY is needed.
            if cortex_source and cortex_source["userCol"]:
                ucol = cortex_source["userCol"]
                if ucol == "USER_ID":
                    cur.execute(f"""
                        SELECT COALESCE(u.NAME, TO_VARCHAR(c.USER_ID)) AS USER_NAME, COUNT(*) AS INVOCATIONS,
                               SUM({cortex_source["tokenExpr"].replace("METRICS", "c.METRICS")}) AS TOTAL_TOKENS,
                               SUM({cortex_source["creditExpr"]}) AS TOTAL_CREDITS
                        FROM {cortex_source["view"]} c
                        LEFT JOIN SNOWFLAKE.ACCOUNT_USAGE.USERS u ON u.USER_ID = c.USER_ID
                        WHERE c.START_TIME >= {date_filter_au}
                        GROUP BY 1 ORDER BY TOTAL_TOKENS DESC LIMIT 10
                    """)
                else:
                    cur.execute(f"""
                        SELECT {ucol} AS USER_NAME, COUNT(*) AS INVOCATIONS,
                               SUM({cortex_source["tokenExpr"]}) AS TOTAL_TOKENS,
                               SUM({cortex_source["creditExpr"]}) AS TOTAL_CREDITS
                        FROM {cortex_source["view"]}
                        WHERE START_TIME >= {date_filter_au} AND {ucol} IS NOT NULL
                        GROUP BY 1 ORDER BY TOTAL_TOKENS DESC LIMIT 10
                    """)
                for row in cur.fetchall():
                    cortex_usage["byUser"].append({
                        "user": row[0],
                        "invocations": int(row[1] or 0),
                        "tokens": int(row[2] or 0),
                        "credits": round(float(row[3] or 0), 6)
                    })
                raise StopIteration  # attribution done; skip the legacy join path

            cur.execute(f"""
                SELECT qh.USER_NAME, COUNT(*) AS INVOCATIONS,
                       SUM(COALESCE(cq.TOKENS, 0)) AS TOTAL_TOKENS, SUM(COALESCE(cq.TOKEN_CREDITS, 0)) AS TOTAL_CREDITS
                FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY cq
                JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY qh ON cq.QUERY_ID = qh.QUERY_ID
                WHERE qh.START_TIME >= {date_filter_au} AND qh.USER_NAME IS NOT NULL
                GROUP BY qh.USER_NAME
                ORDER BY TOTAL_TOKENS DESC
                LIMIT 10
            """)
            for row in cur.fetchall():
                cortex_usage["byUser"].append({
                    "user": row[0],
                    "invocations": int(row[1] or 0),
                    "tokens": int(row[2] or 0),
                    "credits": round(float(row[3] or 0), 6)
                })

            cur.execute(f"""
                SELECT qh.WAREHOUSE_NAME, COUNT(*) AS INVOCATIONS,
                       SUM(COALESCE(cq.TOKENS, 0)) AS TOTAL_TOKENS, SUM(COALESCE(cq.TOKEN_CREDITS, 0)) AS TOTAL_CREDITS
                FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY cq
                JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY qh ON cq.QUERY_ID = qh.QUERY_ID
                WHERE qh.START_TIME >= {date_filter_au} AND qh.WAREHOUSE_NAME IS NOT NULL
                GROUP BY qh.WAREHOUSE_NAME
                ORDER BY TOTAL_TOKENS DESC
                LIMIT 10
            """)
            for row in cur.fetchall():
                cortex_usage["byWarehouse"].append({
                    "warehouse": row[0],
                    "invocations": int(row[1] or 0),
                    "tokens": int(row[2] or 0),
                    "credits": round(float(row[3] or 0), 6)
                })
        except StopIteration:
            pass  # per-user attribution already satisfied from the chosen view
        except Exception as e:
            logger.info(f"Cortex per-user/warehouse attribution not available on this account: {e}")
            if not cortex_usage["byUser"]:
                cortex_usage["attributionAvailable"] = False

        # Step 7: Cost Trend Dynamic Grouping
        cost_trend = []
        try:
            cur.execute(f"""
                SELECT 
                    {trend_group},
                    SUM(CREDITS_USED) AS TOTAL_CREDITS
                FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
                WHERE START_TIME >= {date_filter_au}
                GROUP BY {trend_group}
                ORDER BY MIN(START_TIME) ASC
            """)
            trend_rows = cur.fetchall()
            for row in trend_rows:
                day_label = row[1] if len(row) > 2 else row[1]
                credits = float(row[2] or 0) if len(row) > 2 else float(row[1] or 0)
                cost_trend.append({
                    "day": str(day_label),
                    "computeCredits": round(credits, 2),
                    "storageCredits": 0,
                    "totalCostUsd": round(credits * credit_rate, 2) if credit_rate else None
                })
        except Exception:
            pass

        # Fallback trend from INFORMATION_SCHEMA if cost_trend is empty
        if not cost_trend:
            try:
                cur.execute("""
                    SELECT 
                        START_TIME::DATE,
                        TO_CHAR(START_TIME, 'Dy'),
                        SUM(CREDITS_USED) AS TOTAL_CREDITS
                    FROM TABLE(INFORMATION_SCHEMA.WAREHOUSE_METERING_HISTORY(
                        DATE_RANGE_START => DATEADD('day', -7, CURRENT_TIMESTAMP())
                    ))
                    GROUP BY START_TIME::DATE, TO_CHAR(START_TIME, 'Dy')
                    ORDER BY START_TIME::DATE ASC
                """)
                for row in cur.fetchall():
                    day_lbl = f"{row[1]} ({row[0]})"
                    credits = float(row[2] or 0)
                    cost_trend.append({
                        "day": day_lbl,
                        "computeCredits": round(credits, 2),
                        "storageCredits": 0,
                        "totalCostUsd": round(credits * credit_rate, 2)
                    })
            except Exception:
                pass

        # Step 8: Failed Queries Waste
        failed_query_credits = 0.0
        failed_query_count = 0
        try:
            failed_from_all = [q for q in all_queries if q.get("status") == "FAIL"]
            failed_query_count = len(failed_from_all)
            failed_query_credits = round(sum(q.get("estimatedCredits", 0.0) for q in failed_from_all), 3)
        except Exception:
            pass

        # Step 8b: Filter dimensions for the Executive Overview.
        # Database and role come straight from QUERY_HISTORY. Environment has no native Snowflake
        # concept, so it is INFERRED from name patterns and labelled as such rather than presented
        # as fact. Department requires object tags, which many accounts simply do not have.
        def _infer_env(name):
            n = (name or "").upper()
            for token, env in (("PROD", "PROD"), ("PRD", "PROD"), ("QA", "QA"), ("UAT", "QA"),
                               ("STG", "QA"), ("STAGE", "QA"), ("DEV", "DEV"), ("TEST", "DEV")):
                if token in n:
                    return env
            return "UNTAGGED"

        db_map = {}
        for q in all_queries:
            db = q.get("databaseName") or ""
            if not db:
                continue
            entry = db_map.setdefault(db, {"name": db, "queries": 0, "credits": 0.0, "environment": _infer_env(db)})
            entry["queries"] += 1
            entry["credits"] = round(entry["credits"] + float(q.get("estimatedCredits") or 0), 5)
        databases = sorted(db_map.values(), key=lambda d: -d["credits"])

        roles = sorted({q.get("roleName") for q in all_queries if q.get("roleName")})
        environments = sorted({d["environment"] for d in databases} |
                              {_infer_env(w["name"]) for w in warehouses})

        # Department: only real if the account actually tags objects.
        departments = []
        dept_status = "no_tags"
        try:
            cur.execute("""
                SELECT TAG_VALUE, OBJECT_NAME, DOMAIN
                FROM SNOWFLAKE.ACCOUNT_USAGE.TAG_REFERENCES
                WHERE TAG_NAME ILIKE ANY ('COST_CENTER', 'COST_CENTRE', 'DEPARTMENT', 'TEAM', 'OWNER')
                  AND TAG_VALUE IS NOT NULL
            """)
            tag_rows = cur.fetchall() or []
            seen = {}
            for tv, obj, dom in tag_rows:
                seen.setdefault(str(tv), []).append({"object": str(obj), "domain": str(dom)})
            departments = [{"name": k, "objects": v} for k, v in sorted(seen.items())]
            dept_status = "available" if departments else "no_tags"
        except Exception as e:
            dept_status = "unavailable"
            logger.info(f"Department tag lookup not available: {e}")

        account_region = ""
        try:
            cur.execute("SELECT CURRENT_REGION()")
            account_region = str((cur.fetchone() or [""])[0] or "")
        except Exception:
            pass

        filter_dimensions = {
            "databases": databases,
            "roles": roles,
            "environments": [e for e in environments if e],
            "environmentInferred": True,
            "departments": departments,
            "departmentStatus": dept_status,
            "region": account_region,
        }

        # Step 9: Storage Usage
        storage_tb = 0.0
        try:
            cur.execute("""
                SELECT 
                    AVG(STORAGE_BYTES + STAGE_BYTES + FAILSAFE_BYTES) / POWER(1024, 4) AS AVG_STORAGE_TB
                FROM SNOWFLAKE.ACCOUNT_USAGE.STORAGE_USAGE
                WHERE USAGE_DATE >= DATEADD(day, -30, CURRENT_DATE())
            """)
            stor_row = cur.fetchone()
            if stor_row and stor_row[0]:
                storage_tb = round(float(stor_row[0]), 4)
        except Exception:
            pass

        storage_cost_usd = round(storage_tb * 23.0, 2) if storage_tb > 0 else 0.0

        # Totals
        # Warehouse compute and Cortex AI are billed as separate meters in Snowflake, so they are
        # kept as separate line items here and only added together for an explicit all-services
        # total. They are never blended into one another.
        total_compute_credits = round(sum(w["creditsConsumed"] for w in warehouses), 2)
        compute_cost_usd = round(total_compute_credits * credit_rate, 2)
        ai_credits = cortex_usage["aiCredits"]
        ai_cost_usd = round(ai_credits * credit_rate, 2)
        # Total spend covers the warehouse/storage meters only. Cortex AI is reported on its own
        # line (aiCostUsd) and is deliberately NOT rolled into this figure.
        total_cost_usd = round(compute_cost_usd + storage_cost_usd, 2)

        all_credits_for_pct = total_compute_credits + cortex_usage["aiCredits"]
        ai_credits_pct_of_total = round(cortex_usage["aiCredits"] / all_credits_for_pct * 100, 1) if all_credits_for_pct > 0 else 0.0

        # Step 10: Dynamic AI FinOps Recommendations
        ai_recs = []
        if failed_query_count > 0:
            if failed_query_credits >= 1.0:
                ai_recs.append({
                    "id": "rec_failed",
                    "severity": "High",
                    "title": f"{failed_query_count} Failed Queries Burned Compute",
                    "desc": f"{failed_query_credits} credits were consumed on {failed_query_count} failing queries. Fix query syntax or permission issues to reclaim this budget."
                })
            else:
                ai_recs.append({
                    "id": "rec_failed",
                    "severity": "Low",
                    "title": f"{failed_query_count} Immediate Query Failures",
                    "desc": f"{failed_query_count} queries failed at metadata/parse stage with {failed_query_credits} credits consumed."
                })

        for w in warehouses:
            if w.get("autoSuspendSec", 0) > 300:
                ai_recs.append({
                    "id": f"rec_wh_{w['name']}",
                    "severity": "Medium",
                    "title": f"Warehouse '{w['name']}' Auto-Suspend Too High",
                    "desc": f"Currently configured with {w['autoSuspendSec']}s auto-suspend. Reducing to 60s will save idle compute credits."
                })

        if cortex_usage["totalTokens"] > 0:
            ai_recs.append({
                "id": "rec_cortex",
                "severity": "Info",
                "title": f"AI Cortex Usage: {cortex_usage['totalTokens']:,} Tokens Processed",
                "desc": f"Processed {cortex_usage['totalTokens']:,} AI tokens consuming {cortex_usage['aiCredits']} credits across models ({', '.join([m['model'] for m in cortex_usage['models'][:3]])})."
            })

        if storage_tb > 1.0:
            ai_recs.append({
                "id": "rec_storage",
                "severity": "Medium",
                "title": f"Storage Volume at {storage_tb:.2f} TB",
                "desc": f"Active storage is {storage_tb:.2f} TB (${storage_cost_usd}/mo). Consider reviewing Time Travel and Transient table policies."
            })

        if not ai_recs:
            ai_recs.append({
                "id": "rec_ok",
                "severity": "Info",
                "title": "All Compute Clusters Operating Efficiently",
                "desc": "No major compute bottlenecks or excessive warehouse timeouts detected."
            })

        cur.close()

        return {
            "status": "success",
            "edition": edition,
            "role": active_role,
            "warehouse": active_wh,
            "version": snowflake_ver,
            "summary": {
                # Compute-only credits. Cortex credits are reported separately as aiCreditsConsumed.
                "totalCreditsConsumed": total_compute_credits,
                "computeCreditsConsumed": total_compute_credits,
                "computeCostUsd": compute_cost_usd,
                "aiCostUsd": ai_cost_usd,
                # Explicit sum of the three separate meters: compute + storage + AI.
                "totalCostUsd": total_cost_usd,
                "creditRate": credit_rate,
                "activeUsersCount": len(users),
                "warehousesCount": len(warehouses),
                "potentialSavingsUsd": round(failed_query_credits * credit_rate, 2),
                "potentialSavingsCredits": failed_query_credits,
                "billingPeriod": period_str,
                "currency": currency,
                "remainingTrialBalanceUsd": trial_balance,
                "freeUsageBalance": free_balance,
                "capacityBalance": capacity_balance,
                "balanceStatus": balance_status,
                "balanceMessage": balance_message,
                "storageCostUsd": storage_cost_usd,
                "storageTb": storage_tb,
                "failedQueryCount": failed_query_count,
                "failedQueryCreditsWasted": failed_query_credits,
                "totalTokensConsumed": cortex_usage["totalTokens"],
                "aiCreditsConsumed": cortex_usage["aiCredits"],
                "aiCreditsPctOfTotal": ai_credits_pct_of_total,
                "accountEdition": edition,
                "realTimeQueriesCount": len(all_queries),
                "lastRefreshedAt": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
            },
            "cortexUsage": cortex_usage,
            "filterDimensions": filter_dimensions,
            "users": users,
            "warehouses": warehouses,
            "costTrend": cost_trend,
            "expensiveQueries": expensive_queries,
            "aiRecommendations": ai_recs
        }

    except Exception as ex:
        account_val = sanitize_account_identifier(credentials.get("account", ""))
        user_val = str(credentials.get("username", "")).strip()
        c_key = f"{account_val}:{user_val}".lower()
        if c_key in _SHARED_SNOWFLAKE_SESSION_POOL:
            try:
                _SHARED_SNOWFLAKE_SESSION_POOL[c_key].close()
            except Exception:
                pass
            _SHARED_SNOWFLAKE_SESSION_POOL.pop(c_key, None)

        err_msg = str(ex)
        logger.error(f"[Snowflake Telemetry Error]: {err_msg}")
        requires_mfa = "MFA with TOTP is required" in err_msg or "394508" in err_msg
        is_totp_invalid = "TOTP Invalid" in err_msg or "394507" in err_msg
        friendly_hint = ""
        if requires_mfa:
            friendly_hint = " • MFA Required: Enter your 6-digit TOTP code in the Passcode field below."
        elif is_totp_invalid:
            friendly_hint = " • TOTP Passcode Expired or Invalid: Authenticator codes refresh every 30 seconds. Please check your Authenticator app and enter a fresh 6-digit passcode."
        return {
            "status": "error",
            "connected": False,
            "mfaRequired": requires_mfa or is_totp_invalid,
            "message": f"Snowflake Authentication Failed: {err_msg}{friendly_hint}"
        }
