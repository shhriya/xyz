import uuid
from typing import Dict, Any, List
import time
from .snowflake_live import (
    create_live_snowflake_connection,
    get_shared_live_snowflake_connection,
    SNOWFLAKE_CONNECTOR_AVAILABLE,
    _SHARED_SNOWFLAKE_SESSION_POOL,
    sanitize_snowflake_account,
)

from app.db.document_store import DocumentStore
from app.db.models import SavedConnectionModel

# Saved connections live in the saved_connections table (newest first, encrypted at rest).
_STORE = DocumentStore(SavedConnectionModel)

# Working copy of the table; refreshed from the database before every read or change so that
# multiple workers never serve stale connections.
_saved_connections: List[Dict[str, Any]] = []


def _refresh_connections() -> List[Dict[str, Any]]:
    _saved_connections[:] = _STORE.load_list()
    return _saved_connections


def _save_connections(conns: List[Dict[str, Any]]):
    _STORE.save_list(conns, key=lambda c: c["id"])


def get_saved_connections() -> List[Dict[str, Any]]:
    return _refresh_connections()


def add_saved_connection(details: Dict[str, Any]) -> Dict[str, Any]:
    # Normalized before storing so every later account-string comparison (matching an existing
    # connection, backfilling credentials, resolving a shared session) compares like with like —
    # a raw value like "ACCT.snowflakecomputing.com" saved here would silently fail every one of those.
    account = sanitize_snowflake_account(details.get("account", "").strip())
    username = details.get("username", "").strip()
    passcode = str(details.get("passcode", "")).strip()
    auth_method = details.get("authMethod") or details.get("auth_method") or "password"
    authenticator = str(details.get("authenticator", "")).strip()
    if auth_method == "password_mfa" and not authenticator:
        authenticator = "username_password_mfa"
    # Never save single-use 30s TOTP passcode to disk; tokens are cached securely in OS keyring
    passcode = ""
    passcode_in_pwd = bool(details.get("passcodeInPassword") or details.get("passcode_in_password"))
    private_key = details.get("privateKey") or details.get("private_key") or ""
    private_key_passphrase = details.get("privateKeyPassphrase") or details.get("private_key_passphrase") or ""
    token = details.get("token") or details.get("oauthToken") or ""

    _refresh_connections()

    # Identity is explicit wherever the caller knows it, and only inferred as a last resort.
    #
    #   id            -> update exactly that record. Used when editing a project's credentials, and
    #                    by the modal's own Save after its Test already created the record, so the
    #                    two steps can't produce two projects.
    #   as_new_project-> never merge. "New Project" means a new project even when the account and
    #                    username repeat, which they usually do.
    #   otherwise     -> match on account + username + scope (+ database when both sides give one).
    #
    # The inferred path alone was the bug: database is optional, so creating a second project
    # without choosing one left incoming_db empty, the database check was skipped, and the "new"
    # project merged into the first one — inheriting its id, database and schema, and therefore
    # opening the first project's dashboard.
    explicit_id = str(details.get("id") or "").strip()
    as_new_project = bool(details.get("asNewProject") or details.get("as_new_project"))
    incoming_db = (details.get("database") or "").strip().upper()
    incoming_name = str(details.get("name") or "").strip().lower()

    def _is_match(c: Dict[str, Any]) -> bool:
        if c.get("account") != account or c.get("username") != username:
            return False
        if c.get("scope", "analytics") != details.get("scope", "analytics"):
            return False
        existing_name = str(c.get("name") or "").strip().lower()
        if incoming_name and existing_name and incoming_name != existing_name:
            return False
        existing_db = (c.get("database") or "").strip().upper()
        if incoming_db and existing_db and incoming_db != existing_db:
            return False
        return True

    if explicit_id:
        existing = next((c for c in _saved_connections if c.get("id") == explicit_id), None)
    elif as_new_project:
        existing = None
    else:
        existing = next((c for c in _saved_connections if _is_match(c)), None)
    if existing:
        existing["name"] = details.get("name") or existing.get("name")
        existing["domain"] = details.get("domain") or existing.get("domain")
        existing["password"] = details.get("password", "").strip() or existing.get("password", "")
        existing["passcode"] = ""
        existing["authMethod"] = auth_method
        existing["authenticator"] = authenticator or existing.get("authenticator", "")
        existing["passcodeInPassword"] = passcode_in_pwd
        if private_key:
            existing["privateKey"] = private_key
            existing["privateKeyPassphrase"] = private_key_passphrase
        if token:
            existing["token"] = token
        existing["warehouse"] = details.get("warehouse", "COMPUTE_WH").strip() or "COMPUTE_WH"
        existing["database"] = details.get("database", "").strip() or existing.get("database", "")
        existing["schema"] = details.get("schema", "").strip() or existing.get("schema", "")
        existing["role"] = details.get("role", "ACCOUNTADMIN").strip() or "ACCOUNTADMIN"
        existing["status"] = "connected"
        existing["latencyMs"] = details.get("latencyMs", 25)
        existing["scope"] = details.get("scope", "analytics")
        _save_connections(_saved_connections)
        return existing

    # A length-derived id (conn_custom_{len+1}) collides the moment the list ever shrinks or is
    # filtered inconsistently elsewhere; a random id can't collide regardless of list history.
    conn_id = f"conn_custom_{uuid.uuid4().hex[:12]}"
    new_conn = {
        "id": conn_id,
        "name": details.get("name") or f"Snowflake {details.get('domain', 'Custom')} Connection",
        "domain": details.get("domain", ""),
        "account": account,
        "username": username,
        "password": details.get("password", "").strip(),
        "passcode": "",
        "authMethod": auth_method,
        "authenticator": authenticator,
        "passcodeInPassword": passcode_in_pwd,
        "privateKey": private_key,
        "privateKeyPassphrase": private_key_passphrase,
        "token": token,
        "warehouse": details.get("warehouse", "COMPUTE_WH").strip() or "COMPUTE_WH",
        "database": details.get("database", "").strip(),
        "schema": details.get("schema", "").strip(),
        "role": details.get("role", "ACCOUNTADMIN").strip() or "ACCOUNTADMIN",
        "status": "connected",
        "latencyMs": details.get("latencyMs", 25),
        "scope": details.get("scope", "analytics")
    }
    _saved_connections.insert(0, new_conn)
    _save_connections(_saved_connections)
    return new_conn


def delete_saved_connection(connection_id: str) -> bool:
    """Removes a saved connection permanently. Returns False if no connection with that id exists."""
    _refresh_connections()
    remaining = [c for c in _saved_connections if c.get("id") != connection_id]
    if len(remaining) == len(_saved_connections):
        return False
    _saved_connections[:] = remaining
    _save_connections(_saved_connections)
    return True


def update_saved_connection_schema(account_or_id: str, database: str = "", schema: str = "",
                                   connection_id: str = ""):
    """Records the database/schema a project was scoped to.

    Identified by connection id wherever the caller knows it. Falling back to the account was the
    only lookup before, and an account is shared by every project on that login — so choosing a
    database for one project wrote it onto whichever project happened to come first in the list,
    silently swapping two projects' scopes and showing one project the other's dashboard.
    """
    conns = _refresh_connections()
    target = None
    if connection_id:
        target = next((c for c in conns if c.get("id") == connection_id), None)
    if target is None:
        target = next(
            (c for c in conns if c.get("id") == account_or_id or c.get("account") == account_or_id),
            None,
        )
    if target is None:
        return None
    if database:
        target["database"] = database
    if schema:
        target["schema"] = schema
    _save_connections(_saved_connections)
    return target


def update_saved_connection_cortex(account_or_id: str, cortex_role: str = "", cortex_semantic_model: str = "", domain: str = ""):
    """Populates the Cortex Agent role/name onto a saved connection after Phase B auto-creates
    the agent, so query_ai_analyst() picks it up with no further changes."""
    for c in _refresh_connections():
        if c.get("id") == account_or_id or c.get("account") == account_or_id:
            if cortex_role:
                c["cortexRole"] = cortex_role
            if cortex_semantic_model:
                c["cortexSemanticModel"] = cortex_semantic_model
            if domain:
                c["domain"] = domain
            _save_connections(_saved_connections)
            return c
    return None


def test_snowflake_connection(details: Dict[str, Any]) -> Dict[str, Any]:
    """
    Attempts REAL live connection to Snowflake using user credentials.
    Supports Standard Password (no MFA), Password + MFA TOTP, External Browser / Passkey / SSO, and Key-Pair.
    """
    if not SNOWFLAKE_CONNECTOR_AVAILABLE:
        return {
            "status": "error",
            "connected": False,
            "message": "snowflake-connector-python package is not installed on backend environment."
        }

    start_time = time.time()
    try:
        # Attempt REAL connection to Snowflake and keep session alive in pool
        conn, is_new = get_shared_live_snowflake_connection(details)
        cursor = conn.cursor()
        
        # Run live identity query
        cursor.execute("SELECT CURRENT_VERSION(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA()")
        row = cursor.fetchone()
        
        version = row[0] if row else "Unknown"
        active_wh = row[1] if row and row[1] else details.get("warehouse", "COMPUTE_WH")
        session_db = row[2] if row and row[2] else ""
        session_sch = row[3] if row and row[3] else ""
        # Database is optional here and is chosen later, during setup. When the user left it blank,
        # any value CURRENT_DATABASE() reports is the Snowflake login's own default namespace —
        # saying "DB: X" would read as though the project is now bound to X, which it is not.
        chose_db = bool((details.get("database") or "").strip())
        # When no database was chosen, CURRENT_DATABASE() is NOT reportable as the project's scope.
        # Sessions are pooled per login and shared across projects, so the value may simply be
        # whatever the previously-opened project selected — naming it here told the user their new
        # project was on another project's database.
        scope_note = (
            f"DB: '{session_db or details.get('database')}', Schema: '{session_sch or details.get('schema') or 'N/A'}'"
            if chose_db else
            "no database selected yet — you'll choose one during setup"
        )

        cursor.close()
        # NOTE: Do NOT close conn! It stays alive in _SHARED_SNOWFLAKE_SESSION_POOL
        # so subsequent queries (e.g. costing dashboard telemetry) reuse the active session
        # without re-submitting or invalidating the single-use TOTP passcode!

        latency_ms = int((time.time() - start_time) * 1000)

        return {
            "status": "success",
            "connected": True,
            "latencyMs": latency_ms,
            "version": version,
            "message": f"Successfully authenticated & connected to real Snowflake (Version: {version}, {scope_note}) via Warehouse '{active_wh}' in {latency_ms}ms."
        }

    except Exception as e:
        error_msg = str(e)
        print(f"[Snowflake Real Auth Test Error]: {error_msg}")
        requires_mfa = "MFA with TOTP is required" in error_msg or "394508" in error_msg
        is_totp_invalid = "TOTP Invalid" in error_msg or "394507" in error_msg
        is_jwt_invalid = "390144" in error_msg or "JWT token is invalid" in error_msg
        auth_method = details.get("authMethod") or details.get("auth_method") or "password"
        friendly_hint = ""
        if requires_mfa:
            if auth_method == "password":
                friendly_hint = " • MFA Required: This Snowflake account enforces Multi-Factor Authentication. Please switch to the 'Password + MFA' tab above and enter your current 6-digit TOTP passcode."
            else:
                friendly_hint = " • MFA Required: Enter your 6-digit TOTP code in the Passcode field below."
        elif is_totp_invalid:
            friendly_hint = " • TOTP Passcode Expired or Invalid: Authenticator codes refresh every 30 seconds. Please check your Authenticator app and enter a fresh 6-digit passcode."
        elif is_jwt_invalid:
            friendly_hint = " • Key-Pair / JWT Error (390144): If you intended to use standard password authentication, switch to the 'Password' or 'Password + MFA' tab above. If using Key-Pair authentication: (1) Ensure your public key is registered in Snowflake: ALTER USER <username> SET RSA_PUBLIC_KEY='...'; (2) Ensure username is in UPPERCASE; (3) Check that your system clock is accurate (future-dated clocks invalidate JWT tokens)."
        return {
            "status": "error",
            "connected": False,
            "mfaRequired": requires_mfa or is_totp_invalid,
            "message": f"Snowflake Authentication Failed: {error_msg}{friendly_hint}"
        }
