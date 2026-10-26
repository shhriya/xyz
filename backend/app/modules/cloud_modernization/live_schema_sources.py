"""
Live schema introspection for Schema-Aware Generation, across every source type the form
offers — Snowflake, Oracle, and Databricks (Unity Catalog). Each source implements the same
four-function shape (databases -> schemas -> tables -> columns), matching
cfo_analytics.snowflake_live's existing fetch_live_* functions exactly, so
schema_import.normalize_live_columns_to_entities and the router endpoints that call these
work identically no matter which source produced the data:

    fetch_databases(creds) -> List[str]
    fetch_schemas(creds, database) -> List[str]
    fetch_tables(creds, database, schema) -> List[{"name", "kind", "rows"}]
    fetch_columns(creds, database, schema, tables) -> {table_name: [{"name","type","pk","nullable"}]}

Zero mock data: every function either returns what the source actually reports, or raises so
the caller shows a real connection error — never a fabricated schema.
"""
import logging
from typing import Any, Dict, List, Optional

import oracledb
import requests

logger = logging.getLogger("uvicorn.error")

SUPPORTED_SOURCE_TYPES = ("snowflake", "oracle", "databricks")

# Oracle's built-in/system schemas — never useful as a Schema-Aware Generation source, and
# would otherwise clutter the schema picker on every connection.
_ORACLE_SYSTEM_SCHEMAS = {
    "SYS", "SYSTEM", "OUTLN", "DBSNMP", "APPQOSSYS", "WMSYS", "XDB", "ORDSYS", "ORDDATA",
    "CTXSYS", "MDSYS", "OLAPSYS", "LBACSYS", "GSMADMIN_INTERNAL", "ANONYMOUS", "AUDSYS",
    "GGSYS", "DVSYS", "DVF", "REMOTE_SCHEDULER_AGENT", "SYSBACKUP", "SYSDG", "SYSKM", "SYSRAC",
}


# ── Oracle ──────────────────────────────────────────────────────────────────────────────────

def _oracle_connect(creds: Dict[str, Any]):
    host = (creds.get("host") or creds.get("account") or "").strip()
    port = int(creds.get("port") or 1521)
    service_name = (creds.get("serviceName") or creds.get("database") or "").strip()
    dsn = (creds.get("dsn") or "").strip()
    if not dsn:
        if not host or not service_name:
            raise ValueError("Host and Service Name are required for an Oracle connection.")
        dsn = oracledb.makedsn(host, port, service_name=service_name)
    return oracledb.connect(user=creds.get("username") or "", password=creds.get("password") or "", dsn=dsn)


def oracle_fetch_databases(creds: Dict[str, Any] = None) -> List[str]:
    """Oracle has no catalog level above schema — the connection is already scoped to one
    database/service. Represented as a single selectable "database" so the UI's
    database -> schema -> table flow stays the same shape across every source type."""
    creds = creds or {}
    label = creds.get("serviceName") or creds.get("database") or creds.get("dsn") or creds.get("host") or "ORACLE"
    conn = _oracle_connect(creds)
    conn.close()
    return [label]


def oracle_fetch_schemas(creds: Dict[str, Any] = None, database: str = "") -> List[str]:
    conn = _oracle_connect(creds or {})
    try:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT OWNER FROM ALL_TABLES ORDER BY OWNER")
        return [r[0] for r in cur.fetchall() if r[0] not in _ORACLE_SYSTEM_SCHEMAS]
    finally:
        conn.close()


def oracle_fetch_tables(creds: Dict[str, Any] = None, database: str = "", schema: str = "") -> List[Dict[str, Any]]:
    if not schema:
        return []
    conn = _oracle_connect(creds or {})
    try:
        cur = conn.cursor()
        objects: List[Dict[str, Any]] = []
        cur.execute("SELECT TABLE_NAME, NUM_ROWS FROM ALL_TABLES WHERE OWNER = :owner ORDER BY TABLE_NAME", owner=schema)
        for name, num_rows in cur.fetchall():
            objects.append({"name": name, "kind": "TABLE", "rows": int(num_rows) if num_rows else 0})
        cur.execute("SELECT VIEW_NAME FROM ALL_VIEWS WHERE OWNER = :owner ORDER BY VIEW_NAME", owner=schema)
        for (name,) in cur.fetchall():
            objects.append({"name": name, "kind": "VIEW", "rows": 0})
        return objects
    finally:
        conn.close()


def oracle_fetch_columns(
    creds: Dict[str, Any] = None, database: str = "", schema: str = "", tables: Optional[List[str]] = None
) -> Dict[str, List[Dict[str, Any]]]:
    if not tables or not schema:
        return {}
    conn = _oracle_connect(creds or {})
    try:
        cur = conn.cursor()
        result: Dict[str, List[Dict[str, Any]]] = {}
        for table in tables:
            cur.execute(
                """
                SELECT cols.COLUMN_NAME
                FROM ALL_CONSTRAINTS cons
                JOIN ALL_CONS_COLUMNS cols
                  ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND cons.OWNER = cols.OWNER
                WHERE cons.CONSTRAINT_TYPE = 'P' AND cons.OWNER = :owner AND cons.TABLE_NAME = :tname
                """,
                owner=schema, tname=table,
            )
            pk_cols = {r[0] for r in cur.fetchall()}

            cur.execute(
                """
                SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
                FROM ALL_TAB_COLUMNS
                WHERE OWNER = :owner AND TABLE_NAME = :tname
                ORDER BY COLUMN_ID
                """,
                owner=schema, tname=table,
            )
            result[table] = [
                {"name": col_name, "type": data_type, "pk": col_name in pk_cols, "nullable": nullable == "Y"}
                for col_name, data_type, nullable in cur.fetchall()
            ]
        return result
    finally:
        conn.close()


# ── Databricks (Unity Catalog REST API) ────────────────────────────────────────────────────
# Metadata-only lookups (catalogs/schemas/tables/columns) don't need a running SQL warehouse —
# only a workspace URL and a personal access token with Unity Catalog read access.

def _databricks_base_url(creds: Dict[str, Any]) -> str:
    url = (creds.get("workspaceUrl") or creds.get("account") or "").strip().rstrip("/")
    if not url:
        raise ValueError("Workspace URL is required for a Databricks connection.")
    if not url.startswith("http"):
        url = f"https://{url}"
    return url


def _databricks_headers(creds: Dict[str, Any]) -> Dict[str, str]:
    token = (creds.get("token") or creds.get("password") or "").strip()
    if not token:
        raise ValueError("A personal access token is required for a Databricks connection.")
    return {"Authorization": f"Bearer {token}"}


def _databricks_get(creds: Dict[str, Any], path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    r = requests.get(f"{_databricks_base_url(creds)}{path}", headers=_databricks_headers(creds), params=params, timeout=20)
    if r.status_code != 200:
        raise ValueError(f"Databricks API returned {r.status_code}: {r.text[:300]}")
    return r.json()


def databricks_fetch_databases(creds: Dict[str, Any] = None) -> List[str]:
    """Unity Catalog "catalogs" are the top level — same role as a Snowflake database."""
    data = _databricks_get(creds or {}, "/api/2.1/unity-catalog/catalogs")
    return [c["name"] for c in data.get("catalogs", [])]


def databricks_fetch_schemas(creds: Dict[str, Any] = None, database: str = "") -> List[str]:
    if not database:
        return []
    data = _databricks_get(creds or {}, "/api/2.1/unity-catalog/schemas", {"catalog_name": database})
    return [s["name"] for s in data.get("schemas", []) if s["name"] != "information_schema"]


def databricks_fetch_tables(creds: Dict[str, Any] = None, database: str = "", schema: str = "") -> List[Dict[str, Any]]:
    if not database or not schema:
        return []
    data = _databricks_get(creds or {}, "/api/2.1/unity-catalog/tables", {"catalog_name": database, "schema_name": schema})
    objects = []
    for t in data.get("tables", []):
        kind = "VIEW" if t.get("table_type") == "VIEW" else "TABLE"
        objects.append({"name": t["name"], "kind": kind, "rows": 0})
    return objects


def databricks_fetch_columns(
    creds: Dict[str, Any] = None, database: str = "", schema: str = "", tables: Optional[List[str]] = None
) -> Dict[str, List[Dict[str, Any]]]:
    if not tables or not database or not schema:
        return {}
    result: Dict[str, List[Dict[str, Any]]] = {}
    for table in tables:
        data = _databricks_get(creds or {}, f"/api/2.1/unity-catalog/tables/{database}.{schema}.{table}")
        pk_cols = set()
        for constraint in data.get("table_constraints") or []:
            pkc = constraint.get("primary_key_constraint")
            if pkc:
                pk_cols.update(pkc.get("child_columns") or [])
        result[table] = [
            {
                "name": c["name"],
                "type": c.get("type_text") or c.get("type_name") or "",
                "pk": c["name"] in pk_cols,
                "nullable": bool(c.get("nullable", True)),
            }
            for c in data.get("columns", [])
        ]
    return result
