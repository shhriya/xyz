"""CDC Pipeline, any source -> any target.

Real data movement is tested across two real engines — PostgreSQL (the throwaway test database)
and DuckDB (a local file) — in every direction, and the rows that land in the target are read
back and checked. Warehouses that can't be reached from a test run (Snowflake, BigQuery,
Redshift, Databricks, MySQL, SQL Server, Oracle) are covered by compiling the exact statements
the engine executes with each one's real SQLAlchemy dialect."""
import datetime as dt
import decimal
import time

import pytest
from sqlalchemy import MetaData, Table, create_engine, text
from sqlalchemy.dialects import registry
from sqlalchemy.schema import CreateTable

from app.db.session import engine as app_engine
from app.modules.cdc_pipeline import connectors, service

PID_TABLES = [{"table": "customers", "approach": "INCREMENTAL", "trackingColumn": "updated_at", "primaryKey": ["id"]},
              {"table": "audit_log", "approach": "SKIP"}]


def _pg_cfg(schema):
    """Exactly what a user pastes: the full connection string (the test database is on Neon)."""
    url = app_engine.url.set(drivername="postgresql").render_as_string(hide_password=False)
    return {"type": "postgresql", "url": url, "schema": schema}


def _seed(engine, schema, sql_prefix=""):
    with engine.begin() as conn:
        conn.execute(text(f"drop schema if exists {schema} cascade"))
        conn.execute(text(f"create schema {schema}"))
        conn.execute(text(f"create table {schema}.customers (id int primary key, name varchar(50), "
                          f"amount numeric(10,2), updated_at timestamp)"))
        conn.execute(text(f"create table {schema}.audit_log (id int, msg varchar(50))"))
        conn.execute(text(f"insert into {schema}.customers values "
                          f"(1, 'Alice', 10.50, '2026-09-01 10:00'), (2, 'Bob', 20.00, '2026-09-02 10:00')"))


@pytest.fixture
def pg_source(client):
    _seed(app_engine, "cdc_src")
    yield _pg_cfg("cdc_src")
    with app_engine.begin() as conn:
        conn.execute(text("drop schema if exists cdc_src cascade"))


@pytest.fixture
def pg_target(client):
    with app_engine.begin() as conn:
        conn.execute(text("drop schema if exists cdc_tgt cascade"))
    yield _pg_cfg("cdc_tgt")
    with app_engine.begin() as conn:
        conn.execute(text("drop schema if exists cdc_tgt cascade"))


@pytest.fixture
def duck_target(tmp_path):
    return {"type": "duckdb", "path": str(tmp_path / "target.duckdb"), "schema": "raw_cdc"}


def _pipeline(source, target, approach="INCREMENTAL", tracking="updated_at"):
    tables = [{**PID_TABLES[0], "approach": approach, "trackingColumn": tracking}, PID_TABLES[1]]
    return service.save_pipeline({"source": source, "target": target, "tables": tables})


def _load(pid, source, target, approach, tracking="updated_at"):
    src_eng, tgt_eng = service._engine(source), service._engine(target)
    tgt_schema = connectors.schema_for(target)
    service._ensure_schema(tgt_eng, tgt_schema)
    try:
        return service.load_table(pid, src_eng, connectors.schema_for(source), tgt_eng, tgt_schema,
                                  {"table": "customers", "approach": approach, "trackingColumn": tracking,
                                   "primaryKey": ["id"]})
    finally:
        src_eng.dispose()
        tgt_eng.dispose()


def _rows(target, sql):
    eng = service._engine(target)
    try:
        with eng.connect() as conn:
            return [tuple(r) for r in conn.execute(text(sql)).fetchall()]
    finally:
        eng.dispose()


def _change_source():
    with app_engine.begin() as conn:
        conn.execute(text("insert into cdc_src.customers values (3, 'Cara', 5, '2026-09-03 09:00')"))
        conn.execute(text("update cdc_src.customers set name = 'Alicia', updated_at = '2026-09-04 08:00' where id = 1"))


# ── Real data movement ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("target_fixture", ["pg_target", "duck_target"])
def test_incremental_upserts_and_only_moves_changes(pg_source, target_fixture, request):
    target = request.getfixturevalue(target_fixture)
    tbl = f"{connectors.schema_for(target)}.customers"
    pid = _pipeline(pg_source, target)["id"]

    assert _load(pid, pg_source, target, "INCREMENTAL") == (2, 0)
    assert _rows(target, f"select id, name from {tbl} order by id") == [(1, "Alice"), (2, "Bob")]

    _change_source()
    inserted, updated = _load(pid, pg_source, target, "INCREMENTAL")
    # Bob is re-read as the watermark boundary row (>=) and upserted to the same values
    assert (inserted, updated) == (1, 2)
    assert _rows(target, f"select id, name from {tbl} order by id") == [(1, "Alicia"), (2, "Bob"), (3, "Cara")]

    assert _load(pid, pg_source, target, "INCREMENTAL") == (0, 1)  # nothing new: only the boundary row
    assert _rows(target, f"select count(*) from {tbl}") == [(3,)]  # no duplicates, ever
    assert service.checkpoints(pid)["customers"]["value"].startswith("2026-09-04T08:00")


@pytest.mark.parametrize("target_fixture", ["pg_target", "duck_target"])
def test_scd2_keeps_history_on_the_target(pg_source, target_fixture, request):
    target = request.getfixturevalue(target_fixture)
    tbl = f"{connectors.schema_for(target)}.customers"
    pid = _pipeline(pg_source, target, approach="SCD_TYPE_2")["id"]

    assert _load(pid, pg_source, target, "SCD_TYPE_2") == (2, 0)
    _change_source()
    assert _load(pid, pg_source, target, "SCD_TYPE_2") == (1, 1)  # Cara new, Alice changed, Bob unchanged
    assert _rows(target, f"select id, name, _is_current from {tbl} order by id, _valid_from, _is_current") == [
        (1, "Alice", False), (1, "Alicia", True), (2, "Bob", True), (3, "Cara", True)]
    assert _load(pid, pg_source, target, "SCD_TYPE_2") == (0, 0)  # re-reading unchanged rows writes nothing
    assert _rows(target, f"select count(*) from {tbl}") == [(4,)]


@pytest.mark.parametrize("target_fixture", ["pg_target", "duck_target"])
def test_full_refresh_replaces_the_target_exactly(pg_source, target_fixture, request):
    target = request.getfixturevalue(target_fixture)
    tbl = f"{connectors.schema_for(target)}.customers"
    pid = _pipeline(pg_source, target, approach="FULL_REFRESH", tracking=None)["id"]
    _load(pid, pg_source, target, "FULL_REFRESH", tracking=None)
    with app_engine.begin() as conn:
        conn.execute(text("delete from cdc_src.customers where id = 2"))  # full refresh DOES reflect deletes
    _load(pid, pg_source, target, "FULL_REFRESH", tracking=None)
    assert _rows(target, f"select id, amount from {tbl} order by id") == [(1, decimal.Decimal("10.50"))]


def test_duckdb_source_into_postgres_target(tmp_path, pg_target):
    """The other direction: any engine can be the source too."""
    path = str(tmp_path / "src.duckdb")
    duck = create_engine(f"duckdb:///{path}")
    with duck.begin() as conn:
        conn.execute(text("create schema s"))
        conn.execute(text("create table s.customers (id integer primary key, name varchar, updated_at timestamp)"))
        conn.execute(text("insert into s.customers values (7, 'Dee', '2026-09-05 10:00')"))
    duck.dispose()
    source = {"type": "duckdb", "path": path, "schema": "s"}
    assert {t["name"] for t in service.describe_source(source)} == {"customers"}
    pid = _pipeline(source, pg_target)["id"]
    assert _load(pid, source, pg_target, "INCREMENTAL") == (1, 0)
    assert _rows(pg_target, "select id, name from cdc_tgt.customers") == [(7, "Dee")]


def test_background_run_end_to_end(pg_source, duck_target):
    pid = _pipeline(pg_source, duck_target)["id"]
    service.start_run(pid)
    for _ in range(900):  # remote test database: allow up to 90s
        if service.run_status(pid)["status"] != "running":
            break
        time.sleep(0.1)
    run = service.run_status(pid)
    assert run["status"] == "success", run
    by_table = {t["table"]: t for t in run["tables"]}
    assert by_table["customers"]["status"] == "done" and by_table["customers"]["rowsLoaded"] == 2
    assert by_table["audit_log"]["status"] == "skipped"
    hist = service.run_history(pid)[0]
    assert hist["status"] == "success" and hist["rowsLoaded"] == 2 and hist["tablesProcessed"] == 1
    assert _rows(duck_target, "select count(*) from raw_cdc.customers") == [(2,)]


# ── Every other target: the exact statements, compiled by that database's own dialect ─────────

DIALECTS = {
    "snowflake": "snowflake", "bigquery": "bigquery", "redshift": "redshift.redshift_connector",
    "databricks": "databricks", "mysql": "mysql.mysqlconnector", "sqlserver": "mssql.pymssql",
    "oracle": "oracle.oracledb", "postgresql": "postgresql.psycopg2", "duckdb": "duckdb",
}


@pytest.mark.parametrize("ctype", list(DIALECTS))
def test_load_statements_compile_for_every_target(ctype):
    dialect = registry.load(DIALECTS[ctype])()
    from sqlalchemy import Column, Integer, Numeric, String, DateTime, Boolean
    src = Table("customers", MetaData(), Column("id", Integer, primary_key=True), Column("name", String(50)),
                Column("amount", Numeric(10, 2)), Column("updated_at", DateTime))
    names = [c.name for c in src.columns]
    types = [service.target_type(c.type, dialect.name) for c in src.columns]
    meta = MetaData()
    data = lambda: [Column(n, t) for n, t in zip(names, types)]
    tgt = Table("customers", meta, *data(), Column(service.LOADED_AT, DateTime()), Column("_valid_from", DateTime()),
                Column("_valid_to", DateTime()), Column("_is_current", Boolean()), Column("_row_hash", String(64)),
                schema="raw_cdc")
    stage = Table("customers__cdc_stage", meta, *data(), Column("_row_hash", String(64)), schema="raw_cdc")
    now = dt.datetime(2026, 9, 22)

    statements = [CreateTable(tgt), CreateTable(stage), stage.delete(), stage.insert()]
    if dialect.supports_multivalues_insert:  # what _insert_rows uses there; Oracle uses array binding instead
        statements.append(stage.insert().values([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]))
    statements += [s for s in service.upsert_statements(tgt, stage, names, ["id"], now) if s is not None]
    statements += list(service.scd2_statements(tgt, stage, names, ["id"], now))
    for stmt in statements:
        sql = str(stmt.compile(dialect=dialect))
        assert sql.strip(), f"{ctype}: empty SQL for {type(stmt).__name__}"
    # the SCD2 insert must read from the stage and exclude keys that already have a current row
    assert "NOT (EXISTS" in str(statements[-1].compile(dialect=dialect)).upper()


def test_every_connector_builds_an_engine_without_connecting():
    samples = {
        "postgresql": {"url": "postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require&channel_binding=require"},
        "mysql": {"password": "p", "host": "h", "database": "d", "username": "u"},
        "oracle": {"password": "p", "host": "h", "database": "svc", "username": "u"},
        "sqlserver": {"password": "p", "host": "h", "database": "d", "username": "u"},
        "snowflake": {"account": "xy12345", "database": "d", "schema": "s", "username": "u", "password": "p"},
        "redshift": {"password": "p", "host": "h", "database": "d", "username": "u"},
        "bigquery": {"project": "p", "schema": "ds"},
        "databricks": {"host": "adb.net", "httpPath": "/sql/1", "schema": "s", "token": "t"},
        "duckdb": {"path": ":memory:"},
    }
    assert set(samples) == set(connectors.CONNECTORS)
    for ctype, cfg in samples.items():
        if ctype == "bigquery":
            continue  # creating a BigQuery engine resolves Google credentials, which a test machine lacks
        engine = connectors.build_engine({"type": ctype, **cfg})
        assert engine.dialect.name, ctype
        engine.dispose()
    with pytest.raises(connectors.ConnectorError, match="missing"):
        connectors.build_engine({"type": "snowflake", "account": "x"})


# ── Config, checkpoints, AI ──────────────────────────────────────────────────────────────────

def test_saved_config_never_returns_secrets_and_keeps_them(pg_source):
    target = {"type": "databricks", "host": "adb.net", "httpPath": "/sql/1", "schema": "s", "token": "tok"}
    saved = _pipeline(pg_source, target)
    assert saved["source"]["url"] == "" and saved["source"]["savedSecrets"] == ["url"]
    assert saved["target"]["token"] == "" and saved["target"]["savedSecrets"] == ["token"]
    again = service.save_pipeline({"id": saved["id"], "source": saved["source"], "target": saved["target"],
                                   "tables": saved["tables"]})
    full = service.get_pipeline(again["id"], masked=False)
    assert full["source"]["url"] == pg_source["url"] and full["target"]["token"] == "tok"
    assert full["name"] == "PostgreSQL → Databricks"


def test_changing_a_tables_approach_resets_its_checkpoint(pg_source, duck_target):
    saved = _pipeline(pg_source, duck_target)
    service._save_checkpoint(saved["id"], "customers", "updated_at", dt.datetime(2026, 9, 1), 5)
    tables = [{**t, "approach": "FULL_REFRESH", "trackingColumn": None} if t["table"] == "customers" else t
              for t in saved["tables"]]
    service.save_pipeline({"id": saved["id"], "source": saved["source"], "target": saved["target"], "tables": tables})
    assert "customers" not in service.checkpoints(saved["id"])


def test_checkpoint_values_round_trip_with_their_type():
    for v in (dt.datetime(2026, 9, 1, 10, 30), dt.date(2026, 9, 1), 42, decimal.Decimal("1.50"), "abc"):
        assert service.decode_checkpoint(service.encode_checkpoint(v)) == v


def test_ai_recommendations_are_validated(monkeypatch):
    tables = [
        {"name": "orders", "rows": 2_000_000, "primaryKey": ["id"],
         "columns": [{"name": "id", "type": "INTEGER"}, {"name": "order_date", "type": "DATE"}]},
        {"name": "events", "rows": 100, "primaryKey": [],
         "columns": [{"name": "id", "type": "INTEGER"}, {"name": "msg", "type": "TEXT"}]},
        {"name": "customers", "rows": 50, "primaryKey": [], "columns": [{"name": "name", "type": "TEXT"}]},
        {"name": "forgotten", "rows": 1, "primaryKey": [], "columns": [{"name": "x", "type": "TEXT"}]},
    ]
    reply = {"summary": "ok", "tables": [
        {"name": "orders", "approach": "INCREMENTAL", "trackingColumn": "ORDER_DATE", "reason": "large"},
        {"name": "events", "approach": "INCREMENTAL", "trackingColumn": "made_up_col", "reason": "x"},
        {"name": "customers", "approach": "SCD_TYPE_2", "trackingColumn": None, "reason": "history"},
    ]}
    seen = {}
    monkeypatch.setattr(service, "call_gemini_json", lambda system, *a, **k: (seen.setdefault("p", system), (reply, {}))[1])
    out = {t["table"]: t for t in service.analyze_tables("PostgreSQL", tables, "key", "Google BigQuery")["tables"]}
    assert "into\nGoogle BigQuery" in seen["p"]
    assert out["orders"]["approach"] == "INCREMENTAL" and out["orders"]["trackingColumn"] == "order_date"
    assert out["events"]["approach"] == "FULL_REFRESH" and "no valid tracking column" in out["events"]["reason"]
    assert out["customers"]["approach"] == "FULL_REFRESH" and "primary key" in out["customers"]["reason"]
    assert out["forgotten"]["approach"] == "SKIP" and out["forgotten"]["aiApproach"] is None


def test_type_mapping_is_rendered_by_each_target():
    from sqlalchemy import types as t
    sf, rs = registry.load("snowflake")(), registry.load("redshift.redshift_connector")()
    assert service.target_type(t.Numeric(10, 2), "snowflake").compile(dialect=sf) == "NUMERIC(10, 2)"
    assert service.target_type(t.JSON(), "redshift").compile(dialect=rs) == "VARCHAR(65535)"  # not TEXT = VARCHAR(256)
    assert service.target_type(t.DateTime(timezone=True), "mysql").timezone is False
    assert service.target_type(t.DateTime(timezone=True), "postgresql").timezone is True
    assert service._to_target_value({"a": 1}, False) == '{"a": 1}'
    aware = dt.datetime(2026, 9, 1, 12, tzinfo=dt.timezone(dt.timedelta(hours=5)))
    assert service._to_target_value(aware, True) == dt.datetime(2026, 9, 1, 7)


def test_postgres_connection_string_is_used_as_pasted():
    url = connectors.postgres_url("postgres://neon:s3cr%40t@ep-cool-1.us-east-2.aws.neon.tech/neondb"
                                  "?sslmode=require&channel_binding=require")
    assert url.drivername == "postgresql+psycopg2"
    assert url.host == "ep-cool-1.us-east-2.aws.neon.tech" and url.database == "neondb"
    assert url.password == "s3cr@t"  # URL-encoded characters survive
    assert dict(url.query) == {"sslmode": "require", "channel_binding": "require"}
    for bad, msg in (("mysql://u:p@h/d", "must start with"), ("postgresql://u:p@h", "host and a database"),
                     ("not a url", "doesn't look like")):
        with pytest.raises(connectors.ConnectorError, match=msg):
            connectors.postgres_url(bad)
    with pytest.raises(connectors.ConnectorError, match="Connection string"):
        connectors.build_engine({"type": "postgresql", "schema": "public"})


def test_postgres_pipelines_saved_with_separate_fields_still_connect():
    engine = connectors.build_engine({"type": "postgresql", "host": "h", "port": 5432, "database": "d",
                                      "username": "u", "password": "p"})
    assert engine.url.host == "h" and engine.url.password == "p"
    engine.dispose()


def test_pipeline_schedule_saved_and_loaded(pg_source, duck_target):
    # Test setting a schedule
    payload = {
        "source": pg_source, "target": duck_target, "tables": [],
        "schedule": "*/15 * * * *", "scheduleEnabled": True
    }
    saved = service.save_pipeline(payload)
    assert saved["schedule"] == "*/15 * * * *"
    assert saved["scheduleEnabled"] is True
    
    # Reload from DB to verify it persisted
    loaded = service.get_pipeline(saved["id"], masked=False)
    assert loaded["schedule"] == "*/15 * * * *"
    assert loaded["scheduleEnabled"] is True

