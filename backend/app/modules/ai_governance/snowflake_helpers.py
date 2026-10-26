"""
Source-agnostic Snowflake helpers shared by every governance source adapter,
the sync/refresh pipeline, KPI discovery, and the chatbot.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import snowflake.connector
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.serialization import (
        Encoding, NoEncryption, PrivateFormat, load_pem_private_key,
    )
    SNOWFLAKE_AVAILABLE = True
except ImportError:
    SNOWFLAKE_AVAILABLE = False


_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]{0,254}$")


def safe_identifier(value: str, label: str = "identifier") -> str:
    """Validates a Snowflake identifier that gets interpolated into SQL text."""
    cleaned = (value or "").strip().upper()
    if not _IDENTIFIER_RE.match(cleaned):
        raise ValueError(f"Invalid Snowflake {label}: '{value}'. Use letters, digits and underscores only.")
    return cleaned


def get_snowflake_conn_from_user_input(creds: Dict[str, Any], role_override: Optional[str] = None):
    if not SNOWFLAKE_AVAILABLE:
        raise RuntimeError("snowflake-connector-python is not installed in Python environment.")

    account = (creds.get("account") or "").strip()
    account = re.sub(r"\.snowflakecomputing\.com$", "", account, flags=re.IGNORECASE)
    user = (creds.get("username") or creds.get("user") or "").strip()
    password = creds.get("password", "")
    warehouse = (creds.get("warehouse") or "COMPUTE_WH").strip()
    role = role_override or (creds.get("role") or "").strip() or None
    auth_method = (creds.get("authMethod") or "password").lower()

    if not account:
        raise ValueError("Snowflake Account Identifier is required (e.g. xy12345.us-east-1).")
    if not user:
        raise ValueError("Snowflake Username is required.")

    base_params = dict(
        account=account,
        user=user,
        warehouse=warehouse,
        role=role,
        autocommit=True,
        client_session_keep_alive=True,
    )

    if auth_method == "keypair" and creds.get("privateKeyPath"):
        passphrase_str = creds.get("passphrase") or None
        passphrase = passphrase_str.encode() if passphrase_str else None
        pem_data = Path(creds["privateKeyPath"]).read_bytes()
        pk = load_pem_private_key(pem_data, password=passphrase, backend=default_backend())
        pk_der = pk.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
        # Key-pair auth builds a JWT whose issuer embeds the username literally; Snowflake compares
        # that against the account's canonical (uppercase, for an unquoted identifier) username, so a
        # lowercase/mixed-case username here causes a real "JWT token is invalid" (390144) even with a
        # correctly registered key. Password auth below doesn't have this issue.
        return snowflake.connector.connect(**{**base_params, "user": user.upper()}, private_key=pk_der)
    if not password:
        raise ValueError("Snowflake Password is required for authentication.")
    return snowflake.connector.connect(**base_params, password=password)


def validate_snowflake_creds(creds: Optional[Dict[str, Any]]) -> None:
    if not creds or not (creds.get("account") or "").strip():
        raise ValueError("Snowflake Account Identifier is required.")
    if not (creds.get("username") or creds.get("user")):
        raise ValueError("Snowflake Username is required.")
    if not creds.get("password") and not creds.get("privateKeyPath"):
        raise ValueError("Snowflake Password is required.")


def execute(conn, sql: str, params=None):
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
    finally:
        cur.close()


def execute_rowcount(conn, sql: str, params=None) -> int:
    """Like execute(), but reports how many rows the DML touched. Used by the retention prune so it
    can say what it removed; -1 when the driver doesn't report a count."""
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return int(cur.rowcount) if cur.rowcount is not None else -1
    finally:
        cur.close()


def execute_many(conn, sql: str, rows: list[tuple]):
    """Insert rows using executemany. If that fails, fall back to row-by-row insert."""
    if not rows:
        return
    cur = conn.cursor()
    try:
        cur.executemany(sql, rows)
        print(f"    [execute_many] Inserted {len(rows)} rows via executemany")
    except Exception as e:
        print(f"    [execute_many] executemany FAILED ({e}), falling back to row-by-row insert...")
        success_count = 0
        for i, row in enumerate(rows):
            try:
                cur.execute(sql, row)
                success_count += 1
            except Exception as row_err:
                if i < 3:
                    print(f"    [execute_many] Row {i} failed: {row_err}")
                    print(f"    [execute_many] Row data: {str(row)[:300]}")
        print(f"    [execute_many] Fallback: {success_count}/{len(rows)} rows inserted")
    finally:
        cur.close()


def query_rows(conn, sql: str, params=None, limit: Optional[int] = None) -> Dict[str, Any]:
    """Runs a query and returns JSON-safe {columns, rows} where rows are dicts."""
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        columns = [d[0].upper() for d in (cur.description or [])]
        raw = cur.fetchmany(limit) if limit else cur.fetchall()
        rows = [{c: to_json_safe(v) for c, v in zip(columns, r)} for r in raw]
        return {"columns": columns, "rows": rows}
    finally:
        cur.close()


def to_json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def json_dumps_safe(value: Any) -> str:
    return json.dumps(value, default=lambda o: to_json_safe(o) if not isinstance(o, (set, tuple)) else list(o))


def verify_table_count(conn, target_db: str, target_schema: str, table_name: str) -> int:
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT COUNT(*) FROM {target_db}.{target_schema}.{table_name}")
        return int(cur.fetchone()[0])
    except Exception:
        return -1
    finally:
        cur.close()
