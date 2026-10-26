"""
Connector registry for the CDC Pipeline: every database that can be a SOURCE or a TARGET.

Each connector is a SQLAlchemy dialect, which is what makes any-to-any work: the dialect
package owns identifier quoting, type DDL, parameter binding and reflection for its database,
so the load engine (service.py) is written once against SQLAlchemy Core and never contains
database-specific SQL except the few quirks listed in DIALECT_QUIRKS below.

To add a database: add an entry to CONNECTORS (form fields + engine builder + default schema),
install its SQLAlchemy dialect package, and — only if it deviates from standard SQL for
ALTER TABLE ADD COLUMN / table rename — a DIALECT_QUIRKS entry.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine, make_url


class ConnectorError(RuntimeError):
    """Bad or missing connection settings — shown to the user as-is."""


def _f(key, label, type_="text", required=True, default=None, secret=False, placeholder="", hint=""):
    return {"key": key, "label": label, "type": type_, "required": required, "default": default,
            "secret": secret, "placeholder": placeholder, "hint": hint}


HOST_DB_USER = [
    _f("host", "Host", placeholder="db.example.com"),
    _f("port", "Port", "number"),
    _f("database", "Database"),
    _f("schema", "Schema", required=False),
    _f("username", "Username"),
    _f("password", "Password", "password", secret=True),
]


def _require(cfg: Dict[str, Any], connector: Dict[str, Any]) -> None:
    missing = [f["label"] for f in connector["fields"]
               if f["required"] and not str(cfg.get(f["key"]) or f.get("default") or "").strip()]
    if missing:
        raise ConnectorError(f"{connector['label']} connection is missing: {', '.join(missing)}.")


def _v(cfg, key, connector):
    field = next((f for f in connector["fields"] if f["key"] == key), None)
    value = cfg.get(key)
    if (value is None or str(value).strip() == "") and field:
        value = field.get("default")
    return value.strip() if isinstance(value, str) else value


# ── Engine builders ───────────────────────────────────────────────────────────────────────────

def postgres_url(raw: str) -> URL:
    """A pasted connection string (Neon, Supabase, RDS, Azure, local...) -> a psycopg2 URL.
    Everything in the query string (sslmode=require, channel_binding=require, options=...) is
    passed through to libpq untouched, so hosted providers work exactly as their dashboards say."""
    raw = (raw or "").strip()
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    try:
        url = make_url(raw)
    except Exception as e:
        raise ConnectorError(f"That doesn't look like a PostgreSQL connection string: {e}") from e
    if url.get_backend_name() != "postgresql":
        raise ConnectorError("The connection string must start with postgresql:// or postgres://.")
    if not url.host or not url.database:
        raise ConnectorError("The connection string needs a host and a database name.")
    return url.set(drivername="postgresql+psycopg2")


def _postgres(cfg, c):
    if str(cfg.get("url") or "").strip():
        return create_engine(postgres_url(cfg["url"]), pool_pre_ping=True, connect_args={"connect_timeout": 15})
    # Pipelines saved before the connection-string field kept separate host/port/... values.
    if not (cfg.get("host") and cfg.get("database") and cfg.get("username")):
        raise ConnectorError("PostgreSQL connection is missing: Connection string.")
    args = {"connect_timeout": 15}
    if cfg.get("sslmode"):
        args["sslmode"] = cfg["sslmode"]
    return create_engine(URL.create("postgresql+psycopg2", username=cfg["username"],
                                    password=cfg.get("password") or "", host=cfg["host"],
                                    port=int(cfg.get("port") or 5432), database=cfg["database"]),
                         pool_pre_ping=True, connect_args=args)


def _mysql(cfg, c):
    return create_engine(URL.create("mysql+mysqlconnector", username=_v(cfg, "username", c),
                                    password=cfg.get("password") or "", host=_v(cfg, "host", c),
                                    port=int(_v(cfg, "port", c)), database=_v(cfg, "database", c)),
                         pool_pre_ping=True, connect_args={"connect_timeout": 15})


def _oracle(cfg, c):
    return create_engine(URL.create("oracle+oracledb", username=_v(cfg, "username", c),
                                    password=cfg.get("password") or "", host=_v(cfg, "host", c),
                                    port=int(_v(cfg, "port", c)), query={"service_name": _v(cfg, "database", c)}),
                         pool_pre_ping=True)


def _sqlserver(cfg, c):
    return create_engine(URL.create("mssql+pymssql", username=_v(cfg, "username", c),
                                    password=cfg.get("password") or "", host=_v(cfg, "host", c),
                                    port=int(_v(cfg, "port", c)), database=_v(cfg, "database", c)),
                         pool_pre_ping=True, connect_args={"login_timeout": 15})


def _snowflake(cfg, c):
    from snowflake.sqlalchemy import URL as SnowflakeURL
    from app.modules.cfo_analytics.snowflake_live import sanitize_snowflake_account
    params = {k: _v(cfg, k, c) for k in ("warehouse", "role") if _v(cfg, k, c)}
    return create_engine(SnowflakeURL(
        account=sanitize_snowflake_account(_v(cfg, "account", c)), user=_v(cfg, "username", c),
        password=cfg.get("password") or "", database=_v(cfg, "database", c), schema=_v(cfg, "schema", c), **params,
    ), pool_pre_ping=True)


def _redshift(cfg, c):
    return create_engine(URL.create("redshift+redshift_connector", username=_v(cfg, "username", c),
                                    password=cfg.get("password") or "", host=_v(cfg, "host", c),
                                    port=int(_v(cfg, "port", c)), database=_v(cfg, "database", c)),
                         pool_pre_ping=True)


def _bigquery(cfg, c):
    raw = cfg.get("credentialsJson") or ""
    try:
        info = json.loads(raw) if raw.strip() else None
    except ValueError as e:
        raise ConnectorError(f"BigQuery service-account JSON is not valid JSON: {e}") from e
    kwargs: Dict[str, Any] = {}
    if info:
        kwargs["credentials_info"] = info
    if _v(cfg, "location", c):
        kwargs["location"] = _v(cfg, "location", c)
    return create_engine(f"bigquery://{_v(cfg, 'project', c)}/{_v(cfg, 'schema', c)}", **kwargs)


def _databricks(cfg, c):
    url = URL.create("databricks", username="token", password=cfg.get("token") or "",
                     host=_v(cfg, "host", c),
                     query={"http_path": _v(cfg, "httpPath", c), "catalog": _v(cfg, "catalog", c),
                            "schema": _v(cfg, "schema", c)})
    return create_engine(url, pool_pre_ping=True)


def _duckdb(cfg, c):
    return create_engine(f"duckdb:///{_v(cfg, 'path', c)}")


CONNECTORS: Dict[str, Dict[str, Any]] = {
    "postgresql": {
        "label": "PostgreSQL", "engine": _postgres, "defaultSchema": "public", "customValidation": True,
        "fields": [
            _f("url", "Connection string", "password", secret=True,
               placeholder="postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require",
               hint="Paste it as-is from Neon, Supabase, RDS, Azure or any PostgreSQL host"),
            _f("schema", "Schema", required=False, default="public"),
        ],
    },
    "mysql": {
        "label": "MySQL / MariaDB", "engine": _mysql, "defaultSchema": None,  # schema == database
        "fields": [f for f in HOST_DB_USER if f["key"] != "schema"],
    },
    "oracle": {
        "label": "Oracle", "engine": _oracle, "defaultSchema": None,  # schema == user
        "fields": [_f("host", "Host"), _f("port", "Port", "number"), _f("database", "Service name"),
                   _f("schema", "Schema", required=False, hint="Defaults to the user"),
                   _f("username", "Username"), _f("password", "Password", "password", secret=True)],
    },
    "sqlserver": {
        "label": "SQL Server / Azure SQL", "engine": _sqlserver, "defaultSchema": "dbo",
        "fields": [dict(f) for f in HOST_DB_USER],
    },
    "snowflake": {
        "label": "Snowflake", "engine": _snowflake, "defaultSchema": None,
        "fields": [_f("account", "Account", placeholder="xy12345.us-east-1"), _f("warehouse", "Warehouse", default="COMPUTE_WH"),
                   _f("role", "Role", required=False), _f("database", "Database"), _f("schema", "Schema"),
                   _f("username", "Username"), _f("password", "Password", "password", secret=True)],
    },
    "redshift": {
        "label": "Amazon Redshift", "engine": _redshift, "defaultSchema": "public",
        "fields": [dict(f) for f in HOST_DB_USER],
    },
    "bigquery": {
        "label": "Google BigQuery", "engine": _bigquery, "defaultSchema": None,
        "fields": [_f("project", "Project ID"), _f("schema", "Dataset"),
                   _f("location", "Location", required=False, placeholder="US"),
                   _f("credentialsJson", "Service account JSON", "textarea", required=False, secret=True,
                      hint="Leave blank to use the server's default Google credentials")],
    },
    "databricks": {
        "label": "Databricks", "engine": _databricks, "defaultSchema": "default",
        "fields": [_f("host", "Server hostname", placeholder="adb-123.azuredatabricks.net"),
                   _f("httpPath", "HTTP path", placeholder="/sql/1.0/warehouses/abc123"),
                   _f("catalog", "Catalog", default="hive_metastore"), _f("schema", "Schema"),
                   _f("token", "Access token", "password", secret=True)],
    },
    "duckdb": {
        "label": "DuckDB (file on the server)", "engine": _duckdb, "defaultSchema": "main",
        "fields": [_f("path", "Database file path", placeholder="/data/warehouse.duckdb"),
                   _f("schema", "Schema", required=False)],
    },
}

DEFAULT_PORTS = {"mysql": 3306, "oracle": 1521, "sqlserver": 1433, "redshift": 5439}
for _k, _port in DEFAULT_PORTS.items():
    for _field in CONNECTORS[_k]["fields"]:
        if _field["key"] == "port":
            _field["default"] = _port
        if _field["key"] == "schema" and CONNECTORS[_k]["defaultSchema"]:
            _field["default"] = CONNECTORS[_k]["defaultSchema"]
            _field["required"] = False


def connector_for(cfg: Dict[str, Any]) -> Dict[str, Any]:
    ctype = (cfg or {}).get("type") or "snowflake"  # pipelines saved before multi-target were Snowflake
    if ctype not in CONNECTORS:
        raise ConnectorError(f"Unsupported database type '{ctype}'. Supported: {', '.join(CONNECTORS)}.")
    return CONNECTORS[ctype]


def build_engine(cfg: Dict[str, Any]) -> Engine:
    connector = connector_for(cfg)
    if not connector.get("customValidation"):
        _require(cfg, connector)
    return connector["engine"](cfg, connector)


def schema_for(cfg: Dict[str, Any]) -> Optional[str]:
    ctype = (cfg or {}).get("type") or "snowflake"
    connector = connector_for(cfg)
    schema = str(cfg.get("schema") or "").strip()
    if schema:
        return schema
    if ctype == "mysql":
        return cfg.get("database") or None
    if ctype == "oracle":
        return (cfg.get("username") or "").upper() or None
    return connector["defaultSchema"]


def secret_keys(cfg: Dict[str, Any]) -> List[str]:
    try:
        connector = connector_for(cfg)
    except ConnectorError:
        return ["password"]
    keys = [f["key"] for f in connector["fields"] if f["secret"]]
    if "password" not in keys and cfg.get("password"):
        keys.append("password")  # older PostgreSQL pipelines saved a separate password
    return keys


def public_registry() -> List[Dict[str, Any]]:
    """What the UI needs to render a form for each database (no functions)."""
    return [{"type": k, "label": v["label"], "fields": v["fields"]} for k, v in CONNECTORS.items()]


# ── Dialect quirks: the only places generic SQL isn't generic enough ─────────────────────────

def add_column_sql(dialect: str, table_sql: str, column_sql: str, type_sql: str) -> str:
    if dialect in ("oracle", "mssql"):
        return f"ALTER TABLE {table_sql} ADD {column_sql} {type_sql}"
    if dialect == "databricks":
        return f"ALTER TABLE {table_sql} ADD COLUMNS ({column_sql} {type_sql})"
    return f"ALTER TABLE {table_sql} ADD COLUMN {column_sql} {type_sql}"


def replace_table_sql(dialect: str, side_sql: str, side_name_sql: str, target_sql: str,
                      target_name_sql: str, schema_sql: Optional[str]) -> List[str]:
    """Statements that put the fully-loaded side table in place of the target.
    Snowflake and MySQL can do it atomically; the others drop + rename (transactional on
    PostgreSQL/Redshift/DuckDB, a brief gap elsewhere)."""
    if dialect == "snowflake":
        return [f"CREATE TABLE IF NOT EXISTS {target_sql} LIKE {side_sql}",
                f"ALTER TABLE {side_sql} SWAP WITH {target_sql}",
                f"DROP TABLE IF EXISTS {side_sql}"]
    if dialect == "mysql":
        old = target_sql[:-1] + '__cdc_old`' if target_sql.endswith("`") else target_sql + "__cdc_old"
        return [f"DROP TABLE IF EXISTS {old}",
                f"CREATE TABLE IF NOT EXISTS {target_sql} LIKE {side_sql}",
                f"RENAME TABLE {target_sql} TO {old}, {side_sql} TO {target_sql}",
                f"DROP TABLE IF EXISTS {old}"]
    if dialect == "mssql":
        plain_side = side_sql.replace("[", "").replace("]", "")
        return [f"IF OBJECT_ID('{target_sql.replace('[', '').replace(']', '')}', 'U') IS NOT NULL DROP TABLE {target_sql}",
                f"EXEC sp_rename '{plain_side}', '{target_name_sql.strip('[]')}'"]
    if dialect == "databricks":
        # Databricks resolves an unqualified rename target against the current schema.
        return [f"DROP TABLE IF EXISTS {target_sql}", f"ALTER TABLE {side_sql} RENAME TO {target_sql}"]
    drop = f"DROP TABLE IF EXISTS {target_sql}" if dialect != "oracle" else (
        f"BEGIN EXECUTE IMMEDIATE 'DROP TABLE {target_sql}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;")
    return [drop, f"ALTER TABLE {side_sql} RENAME TO {target_name_sql}"]


TZ_UNAWARE_TARGETS = {"mysql", "mssql", "databricks", "bigquery"}
"""Targets whose timestamp type used here has no time zone: aware values are converted to UTC."""
