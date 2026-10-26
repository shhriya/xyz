"""
Read-only Snowflake role for the governance chatbot.

The role only ever receives USAGE on the warehouse/database/schema and SELECT on the monitoring
objects themselves (GOV_* tables, DBT_* extension tables, V_GOV_KPI_* views) — never schema-wide,
FUTURE, or write grants. Grants are issued during Setup, when new objects appear; Refresh creates
no objects, so it needs no grants.

Configuration (environment):
  GOV_CHATBOT_ROLE          role name (default GOV_CHATBOT_READONLY)
  GOV_CHATBOT_SF_USER       optional dedicated chatbot user (recommended)
  GOV_CHATBOT_SF_PASSWORD   password for that user
Without a dedicated user, the role is granted to the user that ran Setup and the chatbot connects
as that user with the read-only role forced as the session role.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List

from .snowflake_helpers import execute, get_snowflake_conn_from_user_input, safe_identifier

CHATBOT_ROLE = safe_identifier(os.getenv("GOV_CHATBOT_ROLE", "GOV_CHATBOT_READONLY"), "chatbot role")


def provision_readonly_role(
    conn, target_db: str, target_schema: str, warehouse: str, tables: Iterable[str], views: Iterable[str], grantee_user: str,
) -> Dict[str, Any]:
    fq = f"{target_db}.{target_schema}"
    statements: List[str] = [
        f"CREATE ROLE IF NOT EXISTS {CHATBOT_ROLE}",
        f"GRANT USAGE ON WAREHOUSE {safe_identifier(warehouse, 'warehouse')} TO ROLE {CHATBOT_ROLE}",
        f"GRANT USAGE ON DATABASE {target_db} TO ROLE {CHATBOT_ROLE}",
        f"GRANT USAGE ON SCHEMA {fq} TO ROLE {CHATBOT_ROLE}",
        *[f"GRANT SELECT ON TABLE {fq}.{t} TO ROLE {CHATBOT_ROLE}" for t in tables],
        *[f"GRANT SELECT ON VIEW {fq}.{v} TO ROLE {CHATBOT_ROLE}" for v in views],
    ]
    # Query-level drill-down resolves dbt's query ids against ACCOUNT_USAGE.QUERY_HISTORY to get the
    # full statement list and its execution statistics. Issuing this needs ACCOUNTADMIN, so it is
    # expected to fail on plenty of accounts — kept out of `statements` so an expected failure does
    # not mark the whole role not-ready. Without it the drill-down shows the one primary query per
    # model that dbt itself reports.
    optional_statements: List[str] = [
        f"GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE {CHATBOT_ROLE}",
    ]
    dedicated_user = os.getenv("GOV_CHATBOT_SF_USER")
    grantee = dedicated_user or grantee_user
    if grantee:
        # Unquoted Snowflake user names are stored upper-case; quote to allow e-mail style names.
        statements.append(f'GRANT ROLE {CHATBOT_ROLE} TO USER "{grantee.replace(chr(34), "").upper()}"')

    errors = []
    for stmt in statements:
        try:
            execute(conn, stmt)
        except Exception as e:
            errors.append(f"{stmt}: {e}")
    if errors:
        print(f"[readonly role] {len(errors)} grant(s) failed; the Setup role may lack SECURITYADMIN/OWNERSHIP privileges.")

    optional_granted, optional_skipped = [], []
    for stmt in optional_statements:
        try:
            execute(conn, stmt)
            optional_granted.append(stmt)
        except Exception as e:
            optional_skipped.append(f"{stmt}: {e}")
    if optional_skipped:
        print(f"[readonly role] {len(optional_skipped)} optional grant(s) not issued (needs ACCOUNTADMIN); "
              f"query-level execution statistics will be unavailable.")

    return {
        "role": CHATBOT_ROLE,
        "statements": len(statements),
        "ready": not errors,
        "errors": errors[:10],
        "accountUsageGranted": bool(optional_granted),
        "optionalSkipped": optional_skipped[:5],
    }


def connect_as_chatbot(snowflake_creds: Dict[str, Any]):
    """Connects with the read-only role. Raises instead of ever falling back to a privileged role."""
    creds = dict(snowflake_creds or {})
    if os.getenv("GOV_CHATBOT_SF_USER"):
        creds.update({
            "username": os.environ["GOV_CHATBOT_SF_USER"],
            "password": os.getenv("GOV_CHATBOT_SF_PASSWORD", ""),
            "authMethod": "password",
        })
    conn = get_snowflake_conn_from_user_input(creds, role_override=CHATBOT_ROLE)
    cur = conn.cursor()
    try:
        cur.execute("SELECT CURRENT_ROLE()")
        role = (cur.fetchone()[0] or "").upper()
    finally:
        cur.close()
    if role != CHATBOT_ROLE:
        conn.close()
        raise PermissionError(f"Chatbot session is not running as {CHATBOT_ROLE} (got {role}).")
    return conn
