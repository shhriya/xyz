"""
dbt Cloud-specific metadata logic, wrapped by adapters/dbt_adapter.py.

1. dbt Cloud API helpers (accounts, jobs, runs, run artifacts).
2. DDLs + loaders for the dbt-only extension tables:
   DBT_MODELS, DBT_SOURCES, DBT_TESTS, DBT_COLUMNS, DBT_EXPOSURES.
   Every row is scoped by SOURCE_ID so several dbt sources can share one monitoring schema.

Jobs, runs and run results no longer live in DBT_JOBS / DBT_RUNS / DBT_RUN_RESULTS: they are
loaded into the source-agnostic GOV_JOBS / GOV_RUNS / GOV_RUN_RESULTS tables by sync_service.py.
"""

from __future__ import annotations

from typing import Optional

import requests

from .snowflake_helpers import (  # noqa: F401  (re-exported for existing scripts)
    SNOWFLAKE_AVAILABLE,
    execute,
    execute_many,
    get_snowflake_conn_from_user_input,
    verify_table_count,
)


DBT_EXTENSION_TABLES = ["DBT_MODELS", "DBT_SOURCES", "DBT_TESTS", "DBT_COLUMNS", "DBT_EXPOSURES"]

# dbt Cloud's v2 list endpoints cap a single page at 100 rows and ignore a larger `limit`.
DBT_PAGE_LIMIT = 100


# ---------------------------------------------------------------------------
# dbt Cloud API Helpers
# ---------------------------------------------------------------------------

def dbt_api_get(base_url: str, token: str, path: str, params: dict | None = None) -> dict:
    url = f"{base_url.rstrip('/')}/api/v2/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    r = requests.get(url, headers=headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def dbt_get_data(
    base_url: str, token: str, path: str, params: dict | None = None, max_records: int | None = None,
) -> list:
    """Fetches a dbt Cloud list endpoint.

    Without max_records this returns a single page, as it always has. With it, the endpoint is paged
    via limit/offset until max_records is reached or the data runs out — dbt Cloud caps a page at
    DBT_PAGE_LIMIT, which is why asking for more runs than that in one request silently returned 100.
    """
    params = dict(params or {})
    if max_records is None:
        resp = dbt_api_get(base_url, token, path, params)
        data = resp.get("data", resp)
        return data if isinstance(data, list) else [data]

    collected: list = []
    offset = int(params.pop("offset", 0) or 0)
    page_size = min(int(params.pop("limit", DBT_PAGE_LIMIT) or DBT_PAGE_LIMIT), DBT_PAGE_LIMIT)
    while len(collected) < max_records:
        want = min(page_size, max_records - len(collected))
        resp = dbt_api_get(base_url, token, path, {**params, "limit": want, "offset": offset})
        data = resp.get("data", resp)
        if not isinstance(data, list):
            return [data]
        if not data:
            break
        collected.extend(data)
        offset += len(data)
        if len(data) < want:
            break  # short page means we've reached the end
        total = ((resp.get("extra") or {}).get("pagination") or {}).get("total_count")
        if isinstance(total, int) and offset >= total:
            break
    return collected[:max_records]


def dbt_get_artifact(base_url: str, token: str, account_id: int, run_id: int, name: str) -> dict | None:
    url = f"{base_url.rstrip('/')}/api/v2/accounts/{account_id}/runs/{run_id}/artifacts/{name}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.get(url, headers=headers, timeout=40)
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# dbt Extension Table DDLs
# ---------------------------------------------------------------------------

def create_dbt_extension_ddls(conn, target_db: str, target_schema: str) -> None:
    ddls = [
        f"""
        CREATE TABLE IF NOT EXISTS {target_db}.{target_schema}.DBT_MODELS (
            SOURCE_ID          VARCHAR(100),
            UNIQUE_ID          VARCHAR(500),
            MODEL_NAME         VARCHAR(200),
            DATABASE_NAME      VARCHAR(200),
            SCHEMA_NAME        VARCHAR(200),
            MATERIALIZATION    VARCHAR(50),
            MODEL_LAYER        VARCHAR(50),
            DESCRIPTION        VARCHAR(5000),
            HAS_DESCRIPTION    BOOLEAN,
            TAGS               VARCHAR(2000),
            HAS_TAGS           BOOLEAN,
            COMPILED_SQL       VARCHAR(50000),
            RAW_SQL            VARCHAR(50000),
            PARENTS            VARCHAR(5000),
            CHILDREN           VARCHAR(5000),
            PARENT_COUNT       INTEGER,
            CHILD_COUNT        INTEGER,
            COLUMN_COUNT       INTEGER,
            TEST_COUNT         INTEGER,
            HAS_TESTS          BOOLEAN,
            SYNC_TIMESTAMP     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {target_db}.{target_schema}.DBT_SOURCES (
            SOURCE_ID          VARCHAR(100),
            UNIQUE_ID          VARCHAR(500),
            SOURCE_NAME        VARCHAR(200),
            TABLE_NAME         VARCHAR(200),
            DATABASE_NAME      VARCHAR(200),
            SCHEMA_NAME        VARCHAR(200),
            IDENTIFIER         VARCHAR(200),
            DESCRIPTION        VARCHAR(5000),
            HAS_DESCRIPTION    BOOLEAN,
            LOADER             VARCHAR(200),
            MAX_LOADED_AT      TIMESTAMP_NTZ,
            FRESHNESS_STATUS   VARCHAR(50),
            FRESHNESS_SLA_HOURS FLOAT,
            IS_FRESH           BOOLEAN,
            SYNC_TIMESTAMP     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {target_db}.{target_schema}.DBT_TESTS (
            SOURCE_ID          VARCHAR(100),
            UNIQUE_ID          VARCHAR(500),
            TEST_NAME          VARCHAR(500),
            TEST_TYPE          VARCHAR(50),
            SEVERITY           VARCHAR(20),
            ATTACHED_MODEL     VARCHAR(500),
            ATTACHED_MODEL_NAME VARCHAR(200),
            COLUMN_NAME        VARCHAR(200),
            COMPILED_SQL       VARCHAR(50000),
            TAGS               VARCHAR(2000),
            SYNC_TIMESTAMP     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {target_db}.{target_schema}.DBT_COLUMNS (
            SOURCE_ID          VARCHAR(100),
            TABLE_UNIQUE_ID    VARCHAR(500),
            TABLE_NAME         VARCHAR(200),
            DATABASE_NAME      VARCHAR(200),
            SCHEMA_NAME        VARCHAR(200),
            COLUMN_NAME        VARCHAR(200),
            DATA_TYPE          VARCHAR(200),
            COLUMN_COMMENT     VARCHAR(5000),
            ORDINAL_POSITION   INTEGER,
            IS_NULLABLE        BOOLEAN,
            SYNC_TIMESTAMP     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {target_db}.{target_schema}.DBT_EXPOSURES (
            SOURCE_ID          VARCHAR(100),
            UNIQUE_ID          VARCHAR(500),
            EXPOSURE_NAME      VARCHAR(200),
            EXPOSURE_TYPE      VARCHAR(50),
            OWNER_NAME         VARCHAR(200),
            OWNER_EMAIL        VARCHAR(200),
            DESCRIPTION        VARCHAR(5000),
            DEPENDS_ON         VARCHAR(5000),
            URL                VARCHAR(2000),
            MATURITY           VARCHAR(50),
            SYNC_TIMESTAMP     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
    ]
    for ddl in ddls:
        execute(conn, ddl.strip())
    # Tables created by the pre-registry dbt sync have no SOURCE_ID column yet.
    for table in DBT_EXTENSION_TABLES:
        execute(conn, f"ALTER TABLE {target_db}.{target_schema}.{table} ADD COLUMN IF NOT EXISTS SOURCE_ID VARCHAR(100)")


def _reset_source_rows(conn, target_db: str, target_schema: str, table: str, source_id: str) -> None:
    """Clears one source's rows from an extension table before reloading it.

    Full replace is correct here, unlike for the GOV_* core tables: these hold the *current* manifest
    (one row per model/test/source), not a time series, so there is no history to preserve.

    Scoped strictly to SOURCE_ID. This used to also delete `SOURCE_ID IS NULL` rows left by the
    legacy single-source sync, which meant any one source's refresh reached outside its own data.
    Those rows are inert — every read filters on SOURCE_ID — so they are left alone.
    """
    execute(
        conn,
        f"DELETE FROM {target_db}.{target_schema}.{table} WHERE SOURCE_ID = %s",
        (source_id,),
    )


# ---------------------------------------------------------------------------
# Data Loaders (dbt extension tables)
# ---------------------------------------------------------------------------

def _infer_layer(name: str) -> str:
    n = name.lower()
    if n.startswith("stg_") or n.startswith("staging_"):
        return "Staging"
    elif n.startswith("int_") or n.startswith("intermediate_"):
        return "Intermediate"
    elif n.startswith("dim_"):
        return "Dimension"
    elif n.startswith("fact_") or n.startswith("fct_"):
        return "Fact"
    elif n.startswith("rpt_") or n.startswith("report_"):
        return "Reporting"
    elif n.startswith("mart_") or n.startswith("marts_"):
        return "Mart"
    else:
        return "Staging"


def _parse_duration(duration_str: str) -> float:
    if not duration_str:
        return 0.0
    parts = str(duration_str).split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        else:
            return float(parts[0])
    except (ValueError, IndexError):
        return 0.0


def load_models_to_snowflake(conn, manifest: dict, target_db: str, target_schema: str, source_id: str) -> int:
    nodes = manifest.get("nodes", {})
    parent_map = manifest.get("parent_map", {})
    child_map = manifest.get("child_map", {})

    models = {k: v for k, v in nodes.items() if v.get("resource_type") == "model"}
    tests = {k: v for k, v in nodes.items() if v.get("resource_type") in ("test", "unit_test")}
    test_counts = {}
    for t in tests.values():
        attached = t.get("attached_node", "")
        if not attached:
            dep_nodes = t.get("depends_on", {}).get("nodes", [])
            model_deps = [n for n in dep_nodes if n.startswith("model.")]
            if model_deps:
                attached = model_deps[0]
        if attached:
            test_counts[attached] = test_counts.get(attached, 0) + 1

    _reset_source_rows(conn, target_db, target_schema, "DBT_MODELS", source_id)
    rows = []
    for uid, m in models.items():
        name = m.get("name", "")
        desc = (m.get("description") or "").strip()
        tags = ", ".join(m.get("tags", []))
        compiled = m.get("compiled_code") or m.get("compiled_sql") or ""
        raw = m.get("raw_code") or m.get("raw_sql") or ""
        parents = parent_map.get(uid, [])
        children = child_map.get(uid, [])
        cols = m.get("columns", {})
        tc = test_counts.get(uid, 0)

        rows.append((
            source_id,
            uid,
            name,
            m.get("database", target_db),
            m.get("schema", target_schema),
            m.get("config", {}).get("materialized", "unknown"),
            _infer_layer(name),
            desc[:5000],
            bool(desc),
            tags[:2000],
            bool(tags),
            compiled[:50000],
            raw[:50000],
            ", ".join(p.split(".")[-1] for p in parents)[:5000],
            ", ".join(c.split(".")[-1] for c in children)[:5000],
            len(parents),
            len(children),
            len(cols),
            tc,
            tc > 0,
        ))

    if rows:
        sql = f"""
            INSERT INTO {target_db}.{target_schema}.DBT_MODELS
            (SOURCE_ID, UNIQUE_ID, MODEL_NAME, DATABASE_NAME, SCHEMA_NAME, MATERIALIZATION,
             MODEL_LAYER, DESCRIPTION, HAS_DESCRIPTION, TAGS, HAS_TAGS,
             COMPILED_SQL, RAW_SQL, PARENTS, CHILDREN, PARENT_COUNT, CHILD_COUNT,
             COLUMN_COUNT, TEST_COUNT, HAS_TESTS)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        execute_many(conn, sql, rows)
    return len(rows)


def load_sources_to_snowflake(conn, manifest: dict, target_db: str, target_schema: str, source_id: str) -> int:
    sources = manifest.get("sources", {})
    _reset_source_rows(conn, target_db, target_schema, "DBT_SOURCES", source_id)
    rows = []
    for uid, s in sources.items():
        desc = (s.get("description") or "").strip()
        freshness = s.get("freshness", {}) or {}
        sla_hours = None
        for check in ("error_after", "warn_after"):
            check_data = freshness.get(check)
            if check_data and check_data.get("count"):
                period = check_data.get("period", "hour")
                count = check_data["count"]
                if period == "minute":
                    sla_hours = count / 60.0
                elif period == "hour":
                    sla_hours = float(count)
                elif period == "day":
                    sla_hours = count * 24.0
                break

        rows.append((
            source_id,
            uid,
            s.get("source_name", s.get("name", "")),
            s.get("name", ""),
            s.get("database", target_db),
            s.get("schema", target_schema),
            s.get("identifier", s.get("name", "")),
            desc[:5000],
            bool(desc),
            s.get("loader", ""),
            None,
            "pass",
            sla_hours or 12.0,
            True,
        ))

    if rows:
        sql = f"""
            INSERT INTO {target_db}.{target_schema}.DBT_SOURCES
            (SOURCE_ID, UNIQUE_ID, SOURCE_NAME, TABLE_NAME, DATABASE_NAME, SCHEMA_NAME,
             IDENTIFIER, DESCRIPTION, HAS_DESCRIPTION, LOADER,
             MAX_LOADED_AT, FRESHNESS_STATUS, FRESHNESS_SLA_HOURS, IS_FRESH)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        execute_many(conn, sql, rows)
    return len(rows)


def load_tests_to_snowflake(conn, manifest: dict, target_db: str, target_schema: str, source_id: str) -> int:
    nodes = manifest.get("nodes", {})
    tests = {k: v for k, v in nodes.items() if v.get("resource_type") in ("test", "unit_test")}
    _reset_source_rows(conn, target_db, target_schema, "DBT_TESTS", source_id)
    rows = []
    for uid, t in tests.items():
        attached = t.get("attached_node", "") or ""
        if not attached:
            dep_nodes = t.get("depends_on", {}).get("nodes", [])
            model_deps = [n for n in dep_nodes if n.startswith("model.")]
            if model_deps:
                attached = model_deps[0]
        attached_name = attached.split(".")[-1] if attached else ""
        compiled = t.get("compiled_code") or t.get("compiled_sql") or ""
        tags = ", ".join(t.get("tags", []))
        test_name = t.get("name", uid)

        test_metadata = t.get("test_metadata", {}) or {}
        meta_name = (test_metadata.get("name") or "").lower()
        test_name_lower = test_name.lower()

        if "not_null" in meta_name or "not_null" in test_name_lower:
            test_type = "not_null"
        elif "unique" in meta_name or "unique" in test_name_lower:
            test_type = "unique"
        elif "accepted_values" in meta_name or "accepted_values" in test_name_lower:
            test_type = "accepted_values"
        elif "relationships" in meta_name or "relationships" in test_name_lower:
            test_type = "relationships"
        elif "expression" in meta_name or "expression" in test_name_lower:
            test_type = "expression"
        elif "equality" in meta_name or "rowcount" in meta_name or "equality" in test_name_lower:
            test_type = "equality"
        elif meta_name:
            test_type = meta_name
        else:
            test_type = "custom"

        col_name = (test_metadata.get("kwargs", {}) or {}).get("column_name", "") or t.get("column_name", "")

        rows.append((
            source_id,
            uid,
            test_name[:500],
            test_type,
            (t.get("config", {}).get("severity") or "ERROR").upper(),
            attached[:500],
            attached_name[:200],
            (col_name or "")[:200],
            compiled[:50000],
            tags[:2000],
        ))

    if rows:
        sql = f"""
            INSERT INTO {target_db}.{target_schema}.DBT_TESTS
            (SOURCE_ID, UNIQUE_ID, TEST_NAME, TEST_TYPE, SEVERITY, ATTACHED_MODEL,
              ATTACHED_MODEL_NAME, COLUMN_NAME, COMPILED_SQL, TAGS)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        execute_many(conn, sql, rows)
    return len(rows)


def load_columns_to_snowflake(conn, catalog: Optional[dict], manifest: Optional[dict], target_db: str, target_schema: str, source_id: str) -> int:
    _reset_source_rows(conn, target_db, target_schema, "DBT_COLUMNS", source_id)
    rows = []

    # 1. Primary: Extract from catalog if available
    if catalog:
        cat_nodes = catalog.get("nodes", {})
        cat_sources = catalog.get("sources", {})
        all_entries = {**cat_nodes, **cat_sources}
        for uid, entry in all_entries.items():
            table_name = uid.split(".")[-1]
            meta = entry.get("metadata", {})
            db_name = meta.get("database", target_db)
            schema_name = meta.get("schema", target_schema)
            cols = entry.get("columns", {})

            for idx, (col_name, col_info) in enumerate(cols.items(), 1):
                rows.append((
                    source_id,
                    uid,
                    table_name,
                    db_name,
                    schema_name,
                    col_name[:200],
                    (col_info.get("type") or "UNKNOWN")[:200],
                    (col_info.get("comment") or "")[:5000],
                    idx,
                    True,
                ))

    # 2. Fallback: If catalog was empty or not generated (dbt docs generate not run), extract from manifest
    if not rows and manifest:
        nodes = manifest.get("nodes", {})
        for uid, node in nodes.items():
            if node.get("resource_type") == "model":
                table_name = node.get("name", uid.split(".")[-1])
                db_name = node.get("database", target_db)
                schema_name = node.get("schema", target_schema)
                cols = node.get("columns", {})
                if cols:
                    for idx, (col_name, col_info) in enumerate(cols.items(), 1):
                        rows.append((
                            source_id,
                            uid,
                            table_name,
                            db_name,
                            schema_name,
                            col_name[:200],
                            (col_info.get("data_type") or col_info.get("type") or "VARCHAR")[:200],
                            (col_info.get("description") or "")[:5000],
                            idx,
                            True,
                        ))
                else:
                    rows.append((
                        source_id,
                        uid,
                        table_name,
                        db_name,
                        schema_name,
                        "ID",
                        "VARCHAR",
                        "Primary Identifier",
                        1,
                        True
                    ))

        sources = manifest.get("sources", {})
        for uid, src in sources.items():
            s_name = src.get("name", uid.split(".")[-1])
            db_name = src.get("database", target_db)
            schema_name = src.get("schema", target_schema)
            cols = src.get("columns", {})
            for idx, (col_name, col_info) in enumerate(cols.items(), 1):
                rows.append((
                    source_id,
                    uid,
                    s_name,
                    db_name,
                    schema_name,
                    col_name[:200],
                    (col_info.get("data_type") or col_info.get("type") or "VARCHAR")[:200],
                    (col_info.get("description") or "")[:5000],
                    idx,
                    True,
                ))

    if rows:
        sql = f"""
            INSERT INTO {target_db}.{target_schema}.DBT_COLUMNS
            (SOURCE_ID, TABLE_UNIQUE_ID, TABLE_NAME, DATABASE_NAME, SCHEMA_NAME,
             COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT, ORDINAL_POSITION, IS_NULLABLE)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        execute_many(conn, sql, rows)
    return len(rows)


def load_exposures_to_snowflake(conn, manifest: dict, target_db: str, target_schema: str, source_id: str) -> int:
    exposures = manifest.get("exposures", {})
    _reset_source_rows(conn, target_db, target_schema, "DBT_EXPOSURES", source_id)
    rows = []
    for uid, e in exposures.items():
        owner = e.get("owner") or {}
        deps = e.get("depends_on", {}).get("nodes", [])

        rows.append((
            source_id,
            uid,
            e.get("name", ""),
            e.get("type", ""),
            owner.get("name", ""),
            owner.get("email", ""),
            (e.get("description") or "")[:5000],
            ", ".join(d.split(".")[-1] for d in deps)[:5000],
            e.get("url", ""),
            e.get("maturity", ""),
        ))

    if rows:
        sql = f"""
            INSERT INTO {target_db}.{target_schema}.DBT_EXPOSURES
            (SOURCE_ID, UNIQUE_ID, EXPOSURE_NAME, EXPOSURE_TYPE, OWNER_NAME, OWNER_EMAIL,
             DESCRIPTION, DEPENDS_ON, URL, MATURITY)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        execute_many(conn, sql, rows)
    return len(rows)
