"""
Source registry, identity & change detection, and the source-agnostic GOV_* core tables.
Plain code only: nothing in this module calls an LLM.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from .adapters.base_adapter import SourceAdapter
from .snowflake_helpers import execute, execute_many, execute_rowcount, json_dumps_safe

CORE_TABLES = ["GOV_JOBS", "GOV_RUNS", "GOV_RUN_RESULTS"]
GOVERNANCE_TABLES = ["GOV_SOURCE_REGISTRY", *CORE_TABLES, "GOV_RUN_QUERIES", "GOV_KPI_DEFINITIONS"]

# Natural keys the core tables are MERGEd on. A sync used to DELETE every row for the source and
# re-insert, so nothing older than the adapter's fetch window ever survived and the time-filtered
# views had no history to read. Merging on these keys lets each refresh add newly-seen runs and
# correct in-flight ones (Queued -> Running -> Success) while leaving older rows in place.
CORE_TABLE_KEYS = {
    "GOV_JOBS": ["SOURCE_ID", "JOB_ID"],
    "GOV_RUNS": ["SOURCE_ID", "RUN_ID"],
    "GOV_RUN_RESULTS": ["SOURCE_ID", "RUN_ID", "RESULT_ID"],
}

# Bounds "all-time" now that rows accumulate. Jobs are current-state, so only the time-series
# tables are pruned.
RETENTION_DAYS = 400
PRUNABLE_TABLES = {
    "GOV_RUNS": "STARTED_AT",
    "GOV_RUN_RESULTS": "STARTED_AT",
    "GOV_RUN_QUERIES": "STARTED_AT",
}


# ---------------------------------------------------------------------------
# DDL
# ---------------------------------------------------------------------------

def ensure_governance_tables(conn, target_db: str, target_schema: str) -> None:
    fq = f"{target_db}.{target_schema}"
    ddls = [
        f"CREATE DATABASE IF NOT EXISTS {target_db}",
        f"CREATE SCHEMA IF NOT EXISTS {fq}",
        f"""
        CREATE TABLE IF NOT EXISTS {fq}.GOV_SOURCE_REGISTRY (
            SOURCE_ID            VARCHAR(100) PRIMARY KEY,
            SOURCE_TYPE          VARCHAR(50),
            DISPLAY_NAME         VARCHAR(500),
            CONNECTION_IDENTITY  VARCHAR(2000),
            SCHEMA_SIGNATURE     VARCHAR(128),
            SIGNATURE_DETAIL     VARCHAR(100000),
            DASHBOARD_LAYOUT     VARCHAR(20000),
            LAST_SYNCED_AT       TIMESTAMP_NTZ,
            LAST_SETUP_AT        TIMESTAMP_NTZ,
            CREATED_AT           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {fq}.GOV_JOBS (
            SOURCE_ID       VARCHAR(100),
            SOURCE_TYPE     VARCHAR(50),
            JOB_ID          VARCHAR(500),
            JOB_NAME        VARCHAR(1000),
            ATTRIBUTES      VARIANT,
            ATTRIBUTES_RAW  VARCHAR(16777216),
            SYNC_TIMESTAMP  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {fq}.GOV_RUNS (
            SOURCE_ID       VARCHAR(100),
            SOURCE_TYPE     VARCHAR(50),
            RUN_ID          VARCHAR(1000),
            JOB_ID          VARCHAR(500),
            JOB_NAME        VARCHAR(1000),
            STATUS          VARCHAR(100),
            STARTED_AT      TIMESTAMP_NTZ,
            FINISHED_AT     TIMESTAMP_NTZ,
            DURATION_SECS   FLOAT,
            ATTRIBUTES      VARIANT,
            ATTRIBUTES_RAW  VARCHAR(16777216),
            SYNC_TIMESTAMP  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {fq}.GOV_RUN_RESULTS (
            SOURCE_ID       VARCHAR(100),
            SOURCE_TYPE     VARCHAR(50),
            RESULT_ID       VARCHAR(2000),
            RUN_ID          VARCHAR(1000),
            JOB_ID          VARCHAR(500),
            NAME            VARCHAR(1000),
            STATUS          VARCHAR(100),
            STARTED_AT      TIMESTAMP_NTZ,
            FINISHED_AT     TIMESTAMP_NTZ,
            DURATION_SECS   FLOAT,
            ATTRIBUTES      VARIANT,
            ATTRIBUTES_RAW  VARCHAR(16777216),
            SYNC_TIMESTAMP  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {fq}.GOV_RUN_QUERIES (
            SOURCE_ID            VARCHAR(100),
            SOURCE_TYPE          VARCHAR(50),
            RUN_ID               VARCHAR(1000),
            RESULT_ID            VARCHAR(2000),
            MODEL_NAME           VARCHAR(1000),
            QUERY_ID             VARCHAR(100),
            QUERY_SEQ            INTEGER,
            QUERY_TEXT           VARCHAR(16777216),
            QUERY_TYPE           VARCHAR(100),
            STATUS               VARCHAR(100),
            STARTED_AT           TIMESTAMP_NTZ,
            DURATION_SECS        FLOAT,
            ROWS_PRODUCED        NUMBER,
            BYTES_SCANNED        NUMBER,
            PARTITIONS_SCANNED   NUMBER,
            PARTITIONS_TOTAL     NUMBER,
            BYTES_SPILLED_LOCAL  NUMBER,
            BYTES_SPILLED_REMOTE NUMBER,
            WAREHOUSE_NAME       VARCHAR(300),
            IS_PRIMARY           BOOLEAN,
            ENRICHED_AT          TIMESTAMP_NTZ,
            SYNC_TIMESTAMP       TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {fq}.GOV_KPI_DEFINITIONS (
            SOURCE_ID           VARCHAR(100),
            KPI_NAME            VARCHAR(100),
            LABEL               VARCHAR(500),
            DESCRIPTION         VARCHAR(2000),
            SQL_DEFINITION      VARCHAR(100000),
            CHART_TYPE          VARCHAR(30),
            SECTION             VARCHAR(30),
            DISPLAY_ORDER       INTEGER,
            UNIT                VARCHAR(20),
            DISPLAY_CONFIG      VARCHAR(4000),
            VIEW_NAME           VARCHAR(300),
            GENERATED_BY        VARCHAR(30),
            VALIDATION_MESSAGE  VARCHAR(4000),
            GENERATED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            IS_ACTIVE           BOOLEAN
        )
        """,
    ]
    for ddl in ddls:
        execute(conn, ddl.strip())


# ---------------------------------------------------------------------------
# Identity & schema signature
# ---------------------------------------------------------------------------

def make_source_id(source_type: str, connection_identity: str) -> str:
    digest = hashlib.sha1(f"{source_type}|{connection_identity}".encode("utf-8")).hexdigest()[:10].upper()
    return f"{source_type.upper()}_{digest}"


def _attribute_keys(records: List[Dict[str, Any]]) -> List[str]:
    keys = set()
    for rec in records:
        for k, v in (rec.get("attributes") or {}).items():
            if v is not None:
                keys.add(k)
    return sorted(keys)


def compute_schema_signature(
    adapter: SourceAdapter,
    jobs: List[Dict[str, Any]],
    runs: List[Dict[str, Any]],
    run_results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Hash of the source's metadata *structure* (entity attribute keys + extension shape), never its row values."""
    detail = {
        "source_type": adapter.source_type,
        "GOV_JOBS": _attribute_keys(jobs),
        "GOV_RUNS": _attribute_keys(runs),
        "GOV_RUN_RESULTS": _attribute_keys(run_results),
        "extension_tables": sorted(adapter.extension_tables()),
        "extension_structure": sorted(adapter.extension_signature_parts()),
    }
    canonical = json.dumps(detail, sort_keys=True)
    return {"signature": hashlib.sha256(canonical.encode("utf-8")).hexdigest(), "detail": detail}


# ---------------------------------------------------------------------------
# Registry CRUD
# ---------------------------------------------------------------------------

def get_registry_entry(conn, fq: str, source_id: str) -> Optional[Dict[str, Any]]:
    cur = conn.cursor()
    try:
        cur.execute(
            f"SELECT SOURCE_ID, SOURCE_TYPE, DISPLAY_NAME, CONNECTION_IDENTITY, SCHEMA_SIGNATURE, DASHBOARD_LAYOUT, "
            f"LAST_SYNCED_AT, LAST_SETUP_AT, CREATED_AT FROM {fq}.GOV_SOURCE_REGISTRY WHERE SOURCE_ID = %s",
            (source_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        cols = [d[0].lower() for d in cur.description]
        return dict(zip(cols, row))
    finally:
        cur.close()


def upsert_registry_after_setup(
    conn, fq: str, source_id: str, source_type: str, display_name: str, identity: str,
    signature: Dict[str, Any], layout: Dict[str, Any],
) -> None:
    execute(
        conn,
        f"""
        MERGE INTO {fq}.GOV_SOURCE_REGISTRY t
        USING (SELECT %s AS SOURCE_ID, %s AS SOURCE_TYPE, %s AS DISPLAY_NAME, %s AS CONNECTION_IDENTITY,
                      %s AS SCHEMA_SIGNATURE, %s AS SIGNATURE_DETAIL, %s AS DASHBOARD_LAYOUT) s
        ON t.SOURCE_ID = s.SOURCE_ID
        WHEN MATCHED THEN UPDATE SET
            SOURCE_TYPE = s.SOURCE_TYPE, DISPLAY_NAME = s.DISPLAY_NAME, CONNECTION_IDENTITY = s.CONNECTION_IDENTITY,
            SCHEMA_SIGNATURE = s.SCHEMA_SIGNATURE, SIGNATURE_DETAIL = s.SIGNATURE_DETAIL,
            DASHBOARD_LAYOUT = s.DASHBOARD_LAYOUT,
            LAST_SYNCED_AT = CURRENT_TIMESTAMP(), LAST_SETUP_AT = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT
            (SOURCE_ID, SOURCE_TYPE, DISPLAY_NAME, CONNECTION_IDENTITY, SCHEMA_SIGNATURE, SIGNATURE_DETAIL,
             DASHBOARD_LAYOUT, LAST_SYNCED_AT, LAST_SETUP_AT, CREATED_AT)
        VALUES (s.SOURCE_ID, s.SOURCE_TYPE, s.DISPLAY_NAME, s.CONNECTION_IDENTITY, s.SCHEMA_SIGNATURE,
                s.SIGNATURE_DETAIL, s.DASHBOARD_LAYOUT, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        (source_id, source_type, display_name, identity, signature["signature"],
         json.dumps(signature["detail"]), json.dumps(layout)),
    )


def touch_registry_after_refresh(conn, fq: str, source_id: str) -> None:
    execute(conn, f"UPDATE {fq}.GOV_SOURCE_REGISTRY SET LAST_SYNCED_AT = CURRENT_TIMESTAMP() WHERE SOURCE_ID = %s", (source_id,))


# ---------------------------------------------------------------------------
# Core record loading (GOV_JOBS / GOV_RUNS / GOV_RUN_RESULTS)
# ---------------------------------------------------------------------------

def _str_or_none(v: Any) -> Optional[str]:
    return None if v is None else str(v)


def load_core_records(
    conn, fq: str, source_id: str, source_type: str,
    jobs: List[Dict[str, Any]], runs: List[Dict[str, Any]], run_results: List[Dict[str, Any]],
) -> Dict[str, int]:
    specs = {
        "GOV_JOBS": (
            ["JOB_ID", "JOB_NAME"],
            lambda r: (_str_or_none(r.get("job_id")), _str_or_none(r.get("job_name"))),
            jobs,
        ),
        "GOV_RUNS": (
            ["RUN_ID", "JOB_ID", "JOB_NAME", "STATUS", "STARTED_AT", "FINISHED_AT", "DURATION_SECS"],
            lambda r: (_str_or_none(r.get("run_id")), _str_or_none(r.get("job_id")), _str_or_none(r.get("job_name")),
                       _str_or_none(r.get("status")), r.get("started_at"), r.get("finished_at"), r.get("duration_secs")),
            runs,
        ),
        "GOV_RUN_RESULTS": (
            ["RESULT_ID", "RUN_ID", "JOB_ID", "NAME", "STATUS", "STARTED_AT", "FINISHED_AT", "DURATION_SECS"],
            lambda r: (_str_or_none(r.get("result_id")), _str_or_none(r.get("run_id")), _str_or_none(r.get("job_id")),
                       _str_or_none(r.get("name")), _str_or_none(r.get("status")), r.get("started_at"),
                       r.get("finished_at"), r.get("duration_secs")),
            run_results,
        ),
    }
    counts = {}
    for table, (columns, to_row, records) in specs.items():
        rows = [
            (source_id, source_type, *to_row(rec), json_dumps_safe(rec.get("attributes") or {}))
            for rec in records
        ]
        counts[table] = len(rows)
        if not rows:
            # Nothing fetched this cycle (e.g. artifacts expired) — leave the stored history alone.
            continue
        _merge_core_table(conn, fq, table, source_id, columns, rows)
    return counts


def _merge_core_table(
    conn, fq: str, table: str, source_id: str, columns: List[str], rows: List[tuple],
) -> None:
    """Stages the batch, parses its VARIANT server-side, then MERGEs it into the core table.

    The staging hop exists because VARIANT cannot be bound in a batched VALUES clause, so ATTRIBUTES
    has to be loaded as text and parsed with TRY_PARSE_JSON afterwards — the same two-step the direct
    insert used to do, just against a scratch table so the merge sees finished rows.
    """
    data_cols = ["SOURCE_ID", "SOURCE_TYPE", *columns, "ATTRIBUTES"]
    insert_cols = [*data_cols, "SYNC_TIMESTAMP"]
    key_cols = CORE_TABLE_KEYS[table]
    update_cols = [c for c in data_cols if c not in key_cols]

    stg = f"{fq}.STG_{table}_{source_id}"
    execute(conn, f"CREATE OR REPLACE TEMPORARY TABLE {stg} LIKE {fq}.{table}")
    try:
        load_cols = ["SOURCE_ID", "SOURCE_TYPE", *columns, "ATTRIBUTES_RAW"]
        placeholders = ",".join(["%s"] * len(load_cols))
        execute_many(conn, f"INSERT INTO {stg} ({', '.join(load_cols)}) VALUES ({placeholders})", rows)
        execute(
            conn,
            f"UPDATE {stg} SET ATTRIBUTES = TRY_PARSE_JSON(ATTRIBUTES_RAW), ATTRIBUTES_RAW = NULL "
            f"WHERE ATTRIBUTES_RAW IS NOT NULL",
        )

        on_clause = " AND ".join(f"t.{c} = s.{c}" for c in key_cols)
        set_clause = ", ".join(f"t.{c} = s.{c}" for c in update_cols)
        execute(
            conn,
            f"""
            MERGE INTO {fq}.{table} t
            USING (
                SELECT {', '.join(data_cols)} FROM {stg}
                -- A duplicate natural key in the source aborts a Snowflake MERGE outright, so keep
                -- one row per key rather than letting one malformed payload fail the whole sync.
                QUALIFY ROW_NUMBER() OVER (PARTITION BY {', '.join(key_cols)} ORDER BY 1) = 1
            ) s
            ON {on_clause}
            WHEN MATCHED THEN UPDATE SET {set_clause}, t.SYNC_TIMESTAMP = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT ({', '.join(insert_cols)})
                VALUES ({', '.join(f's.{c}' for c in data_cols)}, CURRENT_TIMESTAMP())
            """,
        )
    finally:
        execute(conn, f"DROP TABLE IF EXISTS {stg}")


def prune_core_history(conn, fq: str, source_id: str, retention_days: int = RETENTION_DAYS) -> Dict[str, int]:
    """Drops run history older than the retention window so "all-time" stays bounded.

    Rows with a NULL timestamp are kept: a run that never started has no age to judge, and deleting
    it would quietly lose the only record that it was queued.
    """
    removed: Dict[str, int] = {}
    for table, ts_col in PRUNABLE_TABLES.items():
        try:
            removed[table] = execute_rowcount(
                conn,
                f"DELETE FROM {fq}.{table} WHERE SOURCE_ID = %s AND {ts_col} IS NOT NULL "
                f"AND {ts_col} < DATEADD(day, -{int(retention_days)}, CURRENT_TIMESTAMP())",
                (source_id,),
            )
        except Exception as e:
            print(f"[retention] prune of {table} skipped: {e}")
            removed[table] = -1
    return removed
