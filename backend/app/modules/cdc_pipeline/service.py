"""
CDC Pipeline engine: any SQLAlchemy-supported database -> any SQLAlchemy-supported database, with
AI-recommended load approaches and persistent checkpoints so each run only moves what changed.

Sources and targets come from connectors.py (PostgreSQL, MySQL/MariaDB, Oracle, SQL Server,
Snowflake, Redshift, BigQuery, Databricks, DuckDB). The load logic below is written ONCE against
SQLAlchemy Core — the target's dialect renders the DDL, types, quoting and parameter binding —
so every approach works for every target without per-database SQL (the few genuine
exceptions live in connectors.add_column_sql / replace_table_sql).

Change capture is QUERY-BASED (a watermark on a timestamp / increasing column), not log-based:
nothing is installed on the source and a read-only user is enough. The trade-off is that hard
deletes on the source are not detected — see DELETES below.

Approaches (per table), all using a staging table in the target's schema:
  FULL_REFRESH  load everything into a side table, then replace the target with it (an atomic
                swap on Snowflake/MySQL, transactional drop+rename on PostgreSQL/Redshift/DuckDB).
  INCREMENTAL   read rows where tracking_column >= last checkpoint; upsert on the primary key
                (delete the matching keys, insert the new versions — portable to every target,
                unlike MERGE / ON CONFLICT whose syntax differs per database). No primary key:
                append only.
  SCD_TYPE_2    keep full history: a changed row closes the current version (_valid_to,
                _is_current = false) and inserts a new one. Change detection is a hash of the
                row computed here in Python, so it is identical on every target. Needs a key.
  SKIP          not loaded.

Checkpoints are written only after a table loads successfully, so a failed table re-reads from
its previous checkpoint next run; the key-based upsert and the hash comparison make re-loading
the same rows idempotent.

DELETES: rows deleted on the source are not propagated (a query cannot see a row that no longer
exists). FULL_REFRESH tables are always exact; for the others, total_rows_deleted stays 0.
"""
from __future__ import annotations

import datetime as dt
import decimal
import hashlib
import json
import logging
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import (
    Boolean, Column, DateTime, MetaData, String, Table, Text, and_, exists, func, inspect, literal, select, text,
)
from sqlalchemy import types as satypes
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateSchema

from app.db.models import CdcCheckpointModel, CdcPipelineModel, CdcRunHistoryModel
from app.db.session import SessionLocal
from app.services.gemini_retry_client import call_gemini_json, resolve_models

from . import connectors
from .connectors import ConnectorError

logger = logging.getLogger("uvicorn.error")

BATCH_SIZE = 5000
APPROACHES = ("INCREMENTAL", "FULL_REFRESH", "SCD_TYPE_2", "SKIP")
GEMINI_MODELS = resolve_models(["gemini-3.6-flash", "gemini-3-flash-preview"])
LOADED_AT = "_cdc_loaded_at"
SCD_COLUMNS = ("_valid_from", "_valid_to", "_is_current", "_row_hash")


class CdcError(RuntimeError):
    """User-facing failure (bad credentials, missing table...) — shown as-is."""


def _engine(cfg: Dict[str, Any]) -> Engine:
    try:
        return connectors.build_engine(cfg)
    except ConnectorError as e:
        raise CdcError(str(e)) from e
    except ImportError as e:
        raise CdcError(f"The driver for {cfg.get('type')} is not installed on the server: {e}") from e


def _label(cfg: Dict[str, Any]) -> str:
    try:
        return connectors.connector_for(cfg)["label"]
    except ConnectorError:
        return str(cfg.get("type") or "database")


# ── Source ────────────────────────────────────────────────────────────────────────────────────

_ROW_ESTIMATES = {
    "postgresql": ("select c.relname, c.reltuples::bigint from pg_class c join pg_namespace n "
                   "on n.oid = c.relnamespace where n.nspname = :schema and c.relkind = 'r'"),
    "redshift": 'select "table", tbl_rows from svv_table_info where "schema" = :schema',
    "mysql": "select table_name, table_rows from information_schema.tables where table_schema = :schema",
    "oracle": "select table_name, num_rows from all_tables where owner = :schema",
    "sqlserver": ("select t.name, sum(p.rows) from sys.tables t join sys.schemas s on s.schema_id = t.schema_id "
                  "join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1) "
                  "where s.name = :schema group by t.name"),
    "snowflake": "select table_name, row_count from information_schema.tables where table_schema = upper(:schema)",
}


def _row_estimates(engine: Engine, ctype: str, schema: Optional[str]) -> Dict[str, int]:
    """Catalog row estimates — cheap, unlike COUNT(*) on a 50M-row table. Databases without a
    catalog estimate simply show no row count."""
    query = _ROW_ESTIMATES.get(ctype)
    if not query:
        return {}
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(query), {"schema": schema}).fetchall()
        return {str(r[0]).lower(): max(int(r[1] or 0), 0) for r in rows}
    except Exception as e:
        logger.warning(f"[CDC] row estimates unavailable: {e}")
        return {}


def test_connection(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Connects and reports how many tables the schema has, and whether the schema exists yet."""
    engine = _engine(cfg)
    schema = connectors.schema_for(cfg)
    try:
        insp = inspect(engine)
        try:
            schemas = {s.lower() for s in insp.get_schema_names()}
            schema_exists = schema is None or schema.lower() in schemas
        except Exception:
            schema_exists = True  # some dialects can't list schemas; the table listing below still tells us
        tables = insp.get_table_names(schema=schema) if schema_exists else []
        return {"tableCount": len(tables), "schemaExists": schema_exists, "label": _label(cfg)}
    except CdcError:
        raise
    except Exception as e:
        raise CdcError(f"Could not connect to {_label(cfg)}: {e}") from e
    finally:
        engine.dispose()


test_source = test_connection
test_target = test_connection


def describe_source(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every table with its columns, primary key and a row estimate."""
    engine = _engine(cfg)
    schema = connectors.schema_for(cfg)
    try:
        insp = inspect(engine)
        names = insp.get_table_names(schema=schema)
        estimates = _row_estimates(engine, cfg.get("type"), schema)
        tables = []
        for name in sorted(names):
            cols = insp.get_columns(name, schema=schema)
            try:
                pk = (insp.get_pk_constraint(name, schema=schema) or {}).get("constrained_columns") or []
            except NotImplementedError:
                pk = []  # e.g. BigQuery has no enforced primary keys
            tables.append({
                "name": name,
                "rows": estimates.get(name.lower()),
                "primaryKey": pk,
                "columns": [{"name": c["name"], "type": str(c["type"]), "nullable": bool(c.get("nullable", True))}
                            for c in cols],
            })
        return tables
    except CdcError:
        raise
    except Exception as e:
        raise CdcError(f"Could not read the source tables: {e}") from e
    finally:
        engine.dispose()


# ── AI analysis ──────────────────────────────────────────────────────────────────────────────

ANALYZE_PROMPT = """You are a senior data engineer designing change-data-capture from a {source_type} database into
{target_type}. For EVERY table given, recommend exactly one approach:
  INCREMENTAL  — the table has a column that reliably increases when a row is inserted or updated (updated_at,
                 modified_date, last_changed_ts, or an ever-increasing id for insert-only tables). Name it in
                 "trackingColumn". Preferred for large tables.
  FULL_REFRESH — small tables (reference/lookup data), or no reliable change-tracking column.
  SCD_TYPE_2   — the business needs history of how rows changed (dimensions like customers/products whose
                 attributes change, or tables with effective/valid-from/valid-to dates). Needs a primary key.
                 Give "trackingColumn" if one exists, else null.
  SKIP         — system, audit, log, migration, temp or staging tables not useful for analytics.
Rules: "trackingColumn" must be an exact column name from that table, or null. Never invent columns.
Return ONLY JSON:
{{"summary": "2-3 sentences explaining the overall reasoning for a business reader",
  "tables": [{{"name": "exact table name", "approach": "INCREMENTAL|FULL_REFRESH|SCD_TYPE_2|SKIP",
              "trackingColumn": "column or null", "reason": "one short sentence"}}]}}"""


def analyze_tables(source_type: str, tables: List[Dict[str, Any]], api_key: str,
                   target_type: str = "the target warehouse") -> Dict[str, Any]:
    if not api_key:
        raise CdcError("No Gemini API key is configured. Add one under Settings.")
    if not tables:
        raise CdcError("The source has no tables to analyze.")
    compact = [{
        "name": t["name"], "rows": t.get("rows"), "primaryKey": t.get("primaryKey") or [],
        "columns": [f"{c['name']} {c['type']}" for c in t["columns"]],
    } for t in tables]
    parsed, _usage = call_gemini_json(
        ANALYZE_PROMPT.format(source_type=source_type, target_type=target_type), json.dumps(compact), api_key, GEMINI_MODELS,
        max_output_tokens=16384, timeout=90,
    )
    if not isinstance(parsed, dict) or not isinstance(parsed.get("tables"), list):
        raise CdcError("The AI did not return a usable analysis. Please try again.")

    by_name = {str(r.get("name", "")).lower(): r for r in parsed["tables"] if isinstance(r, dict)}
    results = []
    for t in tables:
        rec = by_name.get(t["name"].lower())
        results.append(_validated_recommendation(t, rec))
    return {"summary": str(parsed.get("summary") or "").strip(), "tables": results}


def _validated_recommendation(table: Dict[str, Any], rec: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The AI recommends; this enforces what the engine can actually do, and says so when it
    overrides — the user always sees why."""
    columns = {c["name"].lower(): c["name"] for c in table["columns"]}
    pk = table.get("primaryKey") or []
    base = {"table": table["name"], "rows": table.get("rows"), "primaryKey": pk,
            "columns": [c["name"] for c in table["columns"]]}
    if not rec:
        return {**base, "approach": "SKIP", "trackingColumn": None, "aiApproach": None,
                "reason": "The AI returned no recommendation for this table — choose an approach."}

    approach = str(rec.get("approach") or "").upper().replace(" ", "_")
    if approach not in APPROACHES:
        approach = "FULL_REFRESH"
    tracking = columns.get(str(rec.get("trackingColumn") or "").lower())
    reason = str(rec.get("reason") or "").strip()
    ai_approach = approach

    if approach == "INCREMENTAL" and not tracking:
        approach, reason = "FULL_REFRESH", reason + " (Switched to Full Refresh: no valid tracking column.)"
    if approach == "SCD_TYPE_2" and not pk:
        approach, reason = "FULL_REFRESH", reason + " (Switched to Full Refresh: SCD Type 2 needs a primary key.)"
    if approach == "INCREMENTAL" and not pk:
        reason += " No primary key, so changed rows are appended rather than updated."
    return {**base, "approach": approach, "trackingColumn": tracking, "aiApproach": ai_approach,
            "reason": reason.strip()}


# ── Pipeline config persistence ─────────────────────────────────────────────────────────────

def _mask(conn: Dict[str, Any]) -> Dict[str, Any]:
    """Secrets (passwords, tokens, service-account JSON) never go back to the browser; the UI
    just learns which ones are saved."""
    secrets = connectors.secret_keys(conn)
    masked = {k: ("" if k in secrets else v) for k, v in conn.items()}
    masked["savedSecrets"] = [k for k in secrets if conn.get(k)]
    masked["hasPassword"] = bool(conn.get("password"))
    return masked


def merge_stored_secrets(new: Dict[str, Any], stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """A blank secret means "unchanged" — fill it from the saved connection of the same type."""
    out = {k: v for k, v in (new or {}).items() if k not in ("savedSecrets", "hasPassword")}
    if stored and (stored.get("type") or "snowflake") == (out.get("type") or "snowflake"):
        for k in connectors.secret_keys(out):
            if not out.get(k):
                out[k] = stored.get(k, "")
    return out


def save_pipeline(payload: Dict[str, Any]) -> Dict[str, Any]:
    source = dict(payload.get("source") or {})
    target = dict(payload.get("target") or {})
    tables = payload.get("tables") or []
    for t in tables:
        if t.get("approach") not in APPROACHES:
            raise CdcError(f"Invalid approach for table {t.get('table')}: {t.get('approach')}")
    with SessionLocal() as db:
        row = db.get(CdcPipelineModel, payload.get("id")) if payload.get("id") else None
        # A blank secret means "unchanged" — the UI never receives the stored one back.
        if row:
            source = merge_stored_secrets(source, row.source_connection)
            target = merge_stored_secrets(target, row.target_connection)
        else:
            row = CdcPipelineModel(id=payload.get("id") or uuid.uuid4().hex[:16])
            db.add(row)
        previous = {t["table"]: t for t in (row.tables_config or [])}
        for t in tables:
            old = previous.get(t["table"])
            if old and (old.get("approach") != t["approach"] or old.get("trackingColumn") != t.get("trackingColumn")):
                db.query(CdcCheckpointModel).filter_by(pipeline_id=row.id, table_name=t["table"]).delete()
        source = merge_stored_secrets(source, None)
        target = merge_stored_secrets(target, None)
        target.setdefault("type", "snowflake")
        row.name = payload.get("name") or f"{_label(source)} → {_label(target)}"
        row.source_type = source.get("type", "postgresql")
        row.source_connection = source
        row.target_connection = target
        row.schedule = payload.get("schedule")
        row.schedule_enabled = payload.get("scheduleEnabled", False)
        row.tables_config = [{
            "table": t["table"], "approach": t["approach"], "trackingColumn": t.get("trackingColumn"),
            "primaryKey": t.get("primaryKey") or [], "reason": t.get("reason", ""), "rows": t.get("rows"),
            "aiApproach": t.get("aiApproach"), "columns": t.get("columns") or [],
        } for t in tables]
        db.commit()
        return pipeline_dict(row)


def pipeline_dict(row: CdcPipelineModel, masked: bool = True) -> Dict[str, Any]:
    src, tgt = row.source_connection or {}, row.target_connection or {}
    return {
        "id": row.id, "name": row.name, "sourceType": row.source_type,
        "source": _mask(src) if masked else src, "target": _mask(tgt) if masked else tgt,
        "schedule": row.schedule, "scheduleEnabled": row.schedule_enabled,
        "tables": row.tables_config or [],
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def get_pipeline(pipeline_id: Optional[str] = None, masked: bool = True) -> Optional[Dict[str, Any]]:
    with SessionLocal() as db:
        if pipeline_id:
            row = db.get(CdcPipelineModel, pipeline_id)
        else:
            row = db.query(CdcPipelineModel).order_by(CdcPipelineModel.updated_at.desc()).first()
        return pipeline_dict(row, masked) if row else None


def run_history(pipeline_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    with SessionLocal() as db:
        rows = (db.query(CdcRunHistoryModel).filter_by(pipeline_id=pipeline_id)
                .order_by(CdcRunHistoryModel.id.desc()).limit(limit).all())
        return [{
            "id": r.id, "status": r.status,
            "startedAt": r.started_at.isoformat() + "Z" if r.started_at else None,
            "completedAt": r.completed_at.isoformat() + "Z" if r.completed_at else None,
            "durationSecs": round((r.completed_at - r.started_at).total_seconds(), 1) if r.completed_at and r.started_at else None,
            "tablesProcessed": r.tables_processed, "rowsLoaded": r.total_rows_loaded,
            "rowsUpdated": r.total_rows_updated, "rowsDeleted": r.total_rows_deleted,
            "error": r.error_message, "details": r.details or [],
        } for r in rows]


# ── Checkpoints ───────────────────────────────────────────────────────────────────────────────

def encode_checkpoint(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        kind = "datetime"
    elif isinstance(value, dt.date):
        kind = "date"
    elif isinstance(value, bool):
        kind = "str"
    elif isinstance(value, int):
        kind = "int"
    elif isinstance(value, decimal.Decimal):
        kind = "decimal"
    elif isinstance(value, float):
        kind = "float"
    else:
        kind = "str"
    raw = value.isoformat() if kind in ("datetime", "date") else str(value)
    return json.dumps({"type": kind, "value": raw})


def decode_checkpoint(raw: Optional[str]) -> Any:
    """Back to a native value so the source driver binds it with the right type (comparing a
    timestamp column against a string works in PostgreSQL but not in Oracle)."""
    if not raw:
        return None
    data = json.loads(raw)
    kind, value = data.get("type"), data.get("value")
    return {
        "datetime": dt.datetime.fromisoformat, "date": dt.date.fromisoformat, "int": int,
        "decimal": decimal.Decimal, "float": float,
    }.get(kind, str)(value)


def _load_checkpoint(pipeline_id: str, table: str) -> Tuple[Optional[str], Any]:
    with SessionLocal() as db:
        row = db.query(CdcCheckpointModel).filter_by(pipeline_id=pipeline_id, table_name=table).first()
        return (row.last_loaded_column, decode_checkpoint(row.last_loaded_value)) if row else (None, None)


def _save_checkpoint(pipeline_id: str, table: str, column: Optional[str], value: Any, rows: int) -> None:
    with SessionLocal() as db:
        row = db.query(CdcCheckpointModel).filter_by(pipeline_id=pipeline_id, table_name=table).first()
        if not row:
            row = CdcCheckpointModel(pipeline_id=pipeline_id, table_name=table, row_count=0)
            db.add(row)
        if column and value is not None:
            row.last_loaded_column, row.last_loaded_value = column, encode_checkpoint(value)
        row.row_count = (row.row_count or 0) + rows
        db.commit()


def reset_checkpoints(pipeline_id: str, table: Optional[str] = None) -> int:
    with SessionLocal() as db:
        q = db.query(CdcCheckpointModel).filter_by(pipeline_id=pipeline_id)
        if table:
            q = q.filter_by(table_name=table)
        n = q.delete()
        db.commit()
        return n


def checkpoints(pipeline_id: str) -> Dict[str, Any]:
    with SessionLocal() as db:
        rows = db.query(CdcCheckpointModel).filter_by(pipeline_id=pipeline_id).all()
        return {r.table_name: {
            "column": r.last_loaded_column,
            "value": json.loads(r.last_loaded_value)["value"] if r.last_loaded_value else None,
            "rowsLoaded": r.row_count,
            "updatedAt": r.updated_at.isoformat() + "Z" if r.updated_at else None,
        } for r in rows}


# ── Type mapping: portable SQLAlchemy types; the TARGET dialect renders the DDL ────────────────

def target_type(src_type: Any, dialect: str) -> Any:
    """Every source column becomes one of a small set of portable types, which each target's
    dialect then renders as its own native DDL (e.g. Numeric(38,10) -> NUMBER(38,10) on
    Snowflake, BIGNUMERIC on BigQuery, DECIMAL on MySQL). Anything without a portable
    equivalent (JSON, arrays, UUID, enums, intervals...) is stored as text, and its value is
    serialised to a string on the way in."""
    try:
        t = src_type.as_generic()
    except Exception:
        t = src_type
    if isinstance(t, satypes.Boolean):
        return satypes.Boolean()
    if isinstance(t, satypes.Integer):
        return satypes.BigInteger()
    if isinstance(t, satypes.Numeric) and not isinstance(t, satypes.Float):
        p, s = getattr(t, "precision", None), getattr(t, "scale", None)
        return satypes.Numeric(min(p, 38), min(s or 0, 37)) if p else satypes.Numeric(38, 10)
    if isinstance(t, satypes.Float):
        return satypes.Float()
    if isinstance(t, satypes.DateTime):
        return satypes.DateTime(timezone=bool(getattr(t, "timezone", False)) and dialect not in connectors.TZ_UNAWARE_TARGETS)
    if isinstance(t, satypes.Date):
        return satypes.Date()
    if isinstance(t, satypes.Time):
        return satypes.Time()
    if isinstance(t, satypes.LargeBinary):
        return satypes.LargeBinary()
    if isinstance(t, satypes.String) and not isinstance(t, satypes.Enum):
        length = getattr(t, "length", None)
        if length and length <= 4000:
            return satypes.String(length)
    return _long_text(dialect)


def _long_text(dialect: str) -> Any:
    if dialect == "redshift":
        return satypes.String(65535)  # Redshift's TEXT is VARCHAR(256) — would silently truncate
    if dialect == "mysql":
        from sqlalchemy.dialects.mysql import LONGTEXT
        return LONGTEXT()
    return Text()


def _to_target_value(v: Any, tz_unaware: bool) -> Any:
    if isinstance(v, dt.datetime):
        if v.tzinfo and tz_unaware:
            return v.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return v
    if v is None or isinstance(v, (str, int, float, bool, decimal.Decimal, dt.date, dt.time)):
        return v
    if isinstance(v, (dict, list, tuple)):
        return json.dumps(v, default=str)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return bytes(v)
    return str(v)


def _row_hash(values: List[Any]) -> str:
    """Change detection for SCD2, computed here rather than in SQL so it is byte-identical on
    every target database."""
    return hashlib.sha256(json.dumps(values, default=str, sort_keys=False).encode()).hexdigest()


# ── Run engine ────────────────────────────────────────────────────────────────────────────────

_RUNS: Dict[str, Dict[str, Any]] = {}
_RUNS_LOCK = threading.Lock()


def run_status(pipeline_id: str) -> Optional[Dict[str, Any]]:
    with _RUNS_LOCK:
        run = _RUNS.get(pipeline_id)
        return json.loads(json.dumps(run, default=str)) if run else None


def start_run(pipeline_id: str) -> Dict[str, Any]:
    pipeline = get_pipeline(pipeline_id, masked=False)
    if not pipeline:
        raise CdcError("Pipeline not found. Save the configuration first.")
    active = [t for t in pipeline["tables"] if t["approach"] != "SKIP"]
    if not active:
        raise CdcError("Every table is set to Skip — nothing to load.")
    with _RUNS_LOCK:
        if (_RUNS.get(pipeline_id) or {}).get("status") == "running":
            raise CdcError("A run is already in progress for this pipeline.")
        with SessionLocal() as db:
            hist = CdcRunHistoryModel(pipeline_id=pipeline_id, status="running", details=[])
            db.add(hist)
            db.commit()
            run_id = hist.id
        _RUNS[pipeline_id] = {
            "runId": run_id, "status": "running", "startedAt": dt.datetime.utcnow().isoformat() + "Z",
            "tables": [{"table": t["table"], "approach": t["approach"],
                        "status": "skipped" if t["approach"] == "SKIP" else "waiting",
                        "rowsLoaded": 0, "rowsUpdated": 0, "seconds": None, "error": None}
                       for t in pipeline["tables"]],
        }
    threading.Thread(target=_run, args=(pipeline, run_id), daemon=True, name=f"cdc-{pipeline_id}").start()
    return run_status(pipeline_id)


def _set_table(pipeline_id: str, table: str, **fields) -> None:
    with _RUNS_LOCK:
        for t in (_RUNS.get(pipeline_id) or {}).get("tables", []):
            if t["table"] == table:
                t.update(fields)


def _ensure_schema(engine: Engine, schema: Optional[str]) -> None:
    if not schema:
        return
    try:
        existing = {s.lower() for s in inspect(engine).get_schema_names()}
    except Exception:
        return  # can't list schemas on this dialect — table creation will say if it's missing
    if schema.lower() in existing:
        return
    try:
        with engine.begin() as conn:
            conn.execute(CreateSchema(schema, if_not_exists=True))
    except Exception as e:
        raise CdcError(f"Target schema '{schema}' does not exist and could not be created: {e}") from e


def _run(pipeline: Dict[str, Any], run_id: int) -> None:
    pid = pipeline["id"]
    source_cfg, target_cfg = pipeline["source"], pipeline["target"]
    fatal = None
    src_engine = tgt_engine = None
    try:
        src_engine = _engine(source_cfg)
        tgt_engine = _engine(target_cfg)
        tgt_schema = connectors.schema_for(target_cfg)
        _ensure_schema(tgt_engine, tgt_schema)
        src_schema = connectors.schema_for(source_cfg)
        for cfg in pipeline["tables"]:
            if cfg["approach"] == "SKIP":
                continue
            started = time.time()
            _set_table(pid, cfg["table"], status="reading")
            try:
                loaded, updated = load_table(pid, src_engine, src_schema, tgt_engine, tgt_schema, cfg)
                _set_table(pid, cfg["table"], status="done", rowsLoaded=loaded, rowsUpdated=updated,
                           seconds=round(time.time() - started, 1))
            except Exception as e:
                logger.warning(f"[CDC] {cfg['table']} failed: {e}")
                _set_table(pid, cfg["table"], status="failed", error=str(e)[:1000],
                           seconds=round(time.time() - started, 1))
    except Exception as e:
        fatal = str(e)
        logger.warning(f"[CDC] run {run_id} failed: {e}")
    finally:
        for eng in (src_engine, tgt_engine):
            if eng is not None:
                eng.dispose()
        _finish(pid, run_id, fatal)


def _finish(pid: str, run_id: int, fatal: Optional[str]) -> None:
    with _RUNS_LOCK:
        run = _RUNS[pid]
        tables = run["tables"]
        if fatal:
            for t in tables:
                if t["status"] in ("waiting", "reading", "loading"):
                    t.update(status="failed", error=t.get("error") or "Run stopped: " + fatal[:300])
        done = [t for t in tables if t["status"] == "done"]
        failed = [t for t in tables if t["status"] == "failed"]
        status = "failed" if fatal or (failed and not done) else "partial" if failed else "success"
        run.update(status=status, completedAt=dt.datetime.utcnow().isoformat() + "Z", error=fatal)
        details = json.loads(json.dumps(tables, default=str))
    with SessionLocal() as db:
        hist = db.get(CdcRunHistoryModel, run_id)
        hist.status = status
        hist.completed_at = dt.datetime.utcnow()
        hist.tables_processed = len(done)
        hist.total_rows_loaded = sum(t["rowsLoaded"] or 0 for t in tables)
        hist.total_rows_updated = sum(t["rowsUpdated"] or 0 for t in tables)
        hist.total_rows_deleted = 0  # query-based CDC cannot observe hard deletes (see module docstring)
        hist.error_message = fatal or ("; ".join(f"{t['table']}: {t['error']}" for t in failed)[:4000] or None)
        hist.details = details
        db.commit()


def _sync_columns(engine: Engine, table: Table) -> None:
    """Schema drift: a column added on the source is added to the target before loading."""
    existing = {c["name"].lower() for c in inspect(engine).get_columns(table.name, schema=table.schema)}
    dialect = engine.dialect
    prep = dialect.identifier_preparer
    for col in table.columns:
        if col.name.lower() not in existing:
            sql = connectors.add_column_sql(dialect.name, prep.format_table(table), prep.format_column(col),
                                            col.type.compile(dialect=dialect))
            with engine.begin() as conn:
                conn.execute(text(sql))


def _recreate(engine: Engine, table: Table) -> None:
    table.drop(engine, checkfirst=True)
    table.create(engine)


def _insert_rows(conn, table: Table, rows: List[Dict[str, Any]]) -> None:
    """Multi-row INSERT ... VALUES where the dialect supports it (one statement per chunk —
    essential on BigQuery/Snowflake/Databricks, where each statement is a round trip), otherwise
    executemany (Oracle's array binding). Chunked so no statement exceeds parameter limits
    (SQL Server allows ~2100)."""
    if not rows:
        return
    if conn.dialect.supports_multivalues_insert:
        per_stmt = max(1, min(500, 2000 // max(len(rows[0]), 1)))
        for i in range(0, len(rows), per_stmt):
            conn.execute(table.insert().values(rows[i:i + per_stmt]))
    else:
        conn.execute(table.insert(), rows)


def load_table(pid: str, src_engine: Engine, src_schema: Optional[str], tgt_engine: Engine,
               tgt_schema: Optional[str], cfg: Dict[str, Any]) -> Tuple[int, int]:
    """Loads one table source -> target with its configured approach. Returns (inserted, updated)."""
    approach, name = cfg["approach"], cfg["table"]
    src = Table(name, MetaData(), schema=src_schema, autoload_with=src_engine)
    dialect = tgt_engine.dialect.name
    tz_unaware = dialect in connectors.TZ_UNAWARE_TARGETS

    src_cols = list(src.columns)
    names = [c.name.lower() for c in src_cols]          # lower-case = unquoted = portable identifiers
    types = [target_type(c.type, dialect) for c in src_cols]
    pk = [n.lower() for n in ([c.name for c in src.primary_key.columns] or list(cfg.get("primaryKey") or []))]
    tracking = cfg.get("trackingColumn") or None
    if tracking and tracking not in src.c:
        raise CdcError(f"Tracking column '{tracking}' no longer exists on {name}.")
    if approach == "SCD_TYPE_2" and not pk:
        raise CdcError("SCD Type 2 needs a primary key; this table has none.")

    tname = name.lower()
    meta = MetaData()

    def data_cols():
        return [Column(n, t) for n, t in zip(names, types)]

    if approach == "FULL_REFRESH":
        load = Table(f"{tname}__cdc_load", meta, *data_cols(), Column(LOADED_AT, DateTime()), schema=tgt_schema)
        _recreate(tgt_engine, load)
    elif approach == "INCREMENTAL":
        tgt = Table(tname, meta, *data_cols(), Column(LOADED_AT, DateTime()), schema=tgt_schema)
        tgt.create(tgt_engine, checkfirst=True)
        _sync_columns(tgt_engine, tgt)
        stage = Table(f"{tname}__cdc_stage", meta, *data_cols(), schema=tgt_schema)
        _recreate(tgt_engine, stage)
    else:
        tgt = Table(tname, meta, *data_cols(), Column(LOADED_AT, DateTime()),
                    Column("_valid_from", DateTime()), Column("_valid_to", DateTime()),
                    Column("_is_current", Boolean()), Column("_row_hash", String(64)), schema=tgt_schema)
        tgt.create(tgt_engine, checkfirst=True)
        _sync_columns(tgt_engine, tgt)
        stage = Table(f"{tname}__cdc_stage", meta, *data_cols(), Column("_row_hash", String(64)), schema=tgt_schema)
        _recreate(tgt_engine, stage)

    ckpt_col, ckpt_value = _load_checkpoint(pid, name)
    if ckpt_col and ckpt_col != tracking:
        ckpt_value = None  # tracking column changed since the last run: start over

    query = select(src)
    if approach in ("INCREMENTAL", "SCD_TYPE_2") and tracking:
        if ckpt_value is not None:
            # >= with a key (re-reading the boundary rows is harmless under the key-based upsert /
            # hash comparison, and it catches rows sharing the last timestamp); > without one.
            col = src.c[tracking]
            query = query.where(col >= ckpt_value if pk else col > ckpt_value)
        query = query.order_by(src.c[tracking])

    inserted = updated = 0
    max_tracking = ckpt_value
    tracking_idx = [c.name for c in src_cols].index(tracking) if tracking else None
    now = dt.datetime.utcnow().replace(microsecond=0)
    _set_table(pid, name, status="loading")

    try:
        with src_engine.connect() as sconn:
            result = sconn.execution_options(stream_results=True).execute(query)
            while True:
                raw = result.fetchmany(BATCH_SIZE)
                if not raw:
                    break
                batch = []
                for r in raw:
                    values = [_to_target_value(v, tz_unaware) for v in r]
                    batch.append(dict(zip(names, values)))
                    if tracking_idx is not None:
                        v = r[tracking_idx]
                        if v is not None and (max_tracking is None or v > max_tracking):
                            max_tracking = v

                if approach == "FULL_REFRESH":
                    with tgt_engine.begin() as conn:
                        _insert_rows(conn, load, [{**row, LOADED_AT: now} for row in batch])
                    inserted += len(batch)
                else:
                    if pk:  # a batch can carry several versions of one key: keep the latest (rows are ordered)
                        batch = list({tuple(row[k] for k in pk): row for row in batch}.values())
                    if approach == "INCREMENTAL":
                        i, u = _upsert(tgt_engine, tgt, stage, names, pk, batch, now)
                    else:
                        for row in batch:
                            row["_row_hash"] = _row_hash([row[n] for n in names])
                        i, u = _scd2(tgt_engine, tgt, stage, names, pk, batch, now)
                    inserted += i
                    updated += u
                _set_table(pid, name, rowsLoaded=inserted, rowsUpdated=updated)

        if approach == "FULL_REFRESH":
            _replace_with(tgt_engine, load, tname, tgt_schema)
    finally:
        if approach != "FULL_REFRESH":
            try:
                stage.drop(tgt_engine, checkfirst=True)
            except Exception as e:
                logger.warning(f"[CDC] could not drop staging table for {name}: {e}")

    _save_checkpoint(pid, name, tracking, max_tracking if tracking else None, inserted)
    return inserted, updated


def _keys_match(a: Table, b: Table, pk: List[str]):
    return and_(*[a.c[k] == b.c[k] for k in pk])


def upsert_statements(tgt: Table, stage: Table, names: List[str], pk: List[str], now: dt.datetime):
    """(count of target rows being replaced, delete them, insert the batch) — the same result as
    MERGE, in SQL every target understands. Without a key: only the insert (append)."""
    insert = tgt.insert().from_select(
        [*names, LOADED_AT], select(*[stage.c[n] for n in names], literal(now, DateTime())))
    if not pk:
        return None, None, insert
    in_batch = exists(select(literal(1)).select_from(stage).where(_keys_match(stage, tgt, pk)))
    return select(func.count()).select_from(tgt).where(in_batch), tgt.delete().where(in_batch), insert


def scd2_statements(tgt: Table, stage: Table, names: List[str], pk: List[str], now: dt.datetime):
    """(count changed, close changed current versions, count keys needing a new version, insert them)."""
    is_current = tgt.c._is_current == literal(True, Boolean())
    changed = exists(select(literal(1)).select_from(stage).where(
        and_(_keys_match(stage, tgt, pk), stage.c._row_hash != tgt.c._row_hash)))
    count_changed = select(func.count()).select_from(tgt).where(and_(is_current, changed))
    close = tgt.update().where(and_(is_current, changed)).values(_valid_to=now, _is_current=False)
    cur_t = tgt.alias("cur")
    no_current = ~exists(select(literal(1)).select_from(cur_t).where(
        and_(_keys_match(cur_t, stage, pk), cur_t.c._is_current == literal(True, Boolean()))))
    count_new = select(func.count()).select_from(stage).where(no_current)
    insert = tgt.insert().from_select(
        [*names, LOADED_AT, "_valid_from", "_valid_to", "_is_current", "_row_hash"],
        select(*[stage.c[n] for n in names], literal(now, DateTime()), literal(now, DateTime()),
               literal(None, DateTime()), literal(True, Boolean()), stage.c._row_hash).where(no_current),
    )
    return count_changed, close, count_new, insert


def _upsert(engine: Engine, tgt: Table, stage: Table, names: List[str], pk: List[str],
            batch: List[Dict[str, Any]], now: dt.datetime) -> Tuple[int, int]:
    count, delete, insert = upsert_statements(tgt, stage, names, pk, now)
    with engine.begin() as conn:
        conn.execute(stage.delete())
        _insert_rows(conn, stage, batch)
        updated = conn.execute(count).scalar() or 0 if count is not None else 0
        if updated:
            conn.execute(delete)
        conn.execute(insert)
    return len(batch) - updated, updated


def _scd2(engine: Engine, tgt: Table, stage: Table, names: List[str], pk: List[str],
          batch: List[Dict[str, Any]], now: dt.datetime) -> Tuple[int, int]:
    count_changed, close, count_new, insert = scd2_statements(tgt, stage, names, pk, now)
    with engine.begin() as conn:
        conn.execute(stage.delete())
        _insert_rows(conn, stage, batch)
        # 1) close the current version of every key whose content changed
        closed = conn.execute(count_changed).scalar() or 0
        if closed:
            conn.execute(close)
        # 2) insert a current version for every key that has none (new keys + the ones just closed)
        to_insert = conn.execute(count_new).scalar() or 0
        if to_insert:
            conn.execute(insert)
    return to_insert - closed, closed  # (brand-new keys, keys that got a new version)


def _replace_with(engine: Engine, load: Table, tname: str, schema: Optional[str]) -> None:
    prep = engine.dialect.identifier_preparer
    target = Table(tname, MetaData(), schema=schema)
    stmts = connectors.replace_table_sql(
        engine.dialect.name, prep.format_table(load), prep.quote(load.name),
        prep.format_table(target), prep.quote(tname), prep.quote_schema(schema) if schema else None,
    )
    with engine.begin() as conn:
        for sql in stmts:
            conn.execute(text(sql))
