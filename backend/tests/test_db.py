import pytest
from sqlalchemy import text

from app.db.document_store import DocumentStore
from app.db.models import KpiDashboardModel, ProjectModel, SavedConnectionModel
from app.db.session import SessionLocal


@pytest.fixture
def connections_store(client):
    store = DocumentStore(SavedConnectionModel)
    yield store
    store.save_dict({})


def test_document_store_keeps_order_and_replaces(connections_store):
    connections_store.save_list([{"id": "b", "n": 1}, {"id": "a", "n": 2}], key=lambda c: c["id"])
    assert [c["id"] for c in connections_store.load_list()] == ["b", "a"]

    connections_store.save_list([{"id": "a", "n": 3}], key=lambda c: c["id"])
    assert connections_store.load_dict() == {"a": {"id": "a", "n": 3}}


def test_document_store_put_appends(client):
    store = DocumentStore(KpiDashboardModel)
    store.put("first", {"x": 1})
    store.put("second", {"x": 2})
    store.put("first", {"x": 10})
    assert store.load_dict() == {"first": {"x": 10}, "second": {"x": 2}}
    store.save_dict({})


def test_credentials_are_encrypted_at_rest(connections_store):
    connections_store.put("conn_1", {"id": "conn_1", "password": "hunter2"})
    with SessionLocal() as db:
        raw = db.execute(text("SELECT data FROM saved_connections WHERE key = 'conn_1'")).scalar()
    assert raw.startswith("fernet:")
    assert "hunter2" not in raw
    assert connections_store.get("conn_1")["password"] == "hunter2"


def test_plain_json_rows_remain_readable(client):
    """Rows written before APP_ENCRYPTION_KEY was set are plain JSON text."""
    with SessionLocal() as db:
        db.execute(text("UPDATE projects SET connection_details = '{\"user\": \"legacy\"}' WHERE id = 'default_project'"))
        db.commit()
        db.expire_all()
        assert db.get(ProjectModel, "default_project").connection_details == {"user": "legacy"}


def test_saved_connections_module_roundtrip(client):
    from app.modules.cfo_analytics import connections

    created = connections.add_saved_connection({"account": "abc-123", "username": "me", "password": "pw", "name": "Test"})
    assert [c["id"] for c in connections.get_saved_connections()] == [created["id"]]

    connections.update_saved_connection_schema(created["id"], database="DB1", schema="S1")
    reloaded = DocumentStore(SavedConnectionModel).get(created["id"])
    assert (reloaded["database"], reloaded["schema"]) == ("DB1", "S1")

    DocumentStore(SavedConnectionModel).save_dict({})


def test_wrong_encryption_key_gives_clear_error(connections_store, monkeypatch):
    from cryptography.fernet import Fernet

    from app.db import types

    connections_store.put("conn_k", {"id": "conn_k", "password": "x"})
    monkeypatch.setattr(types, "_fernet", lambda: Fernet(Fernet.generate_key()))
    with pytest.raises(RuntimeError, match="same key"):
        connections_store.get("conn_k")


def test_retry_on_disconnect_retries_once_then_succeeds(monkeypatch):
    from sqlalchemy.exc import OperationalError

    from app.db import session

    monkeypatch.setattr(session.time, "sleep", lambda s: None)
    calls = []

    @session.retry_on_disconnect
    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise OperationalError("SELECT 1", {}, Exception("SSL connection has been closed unexpectedly"),
                                   connection_invalidated=True)
        return "ok"

    assert flaky() == "ok"
    assert len(calls) == 2


def test_retry_on_disconnect_does_not_retry_other_errors():
    from sqlalchemy.exc import IntegrityError

    from app.db import session

    calls = []

    @session.retry_on_disconnect
    def broken():
        calls.append(1)
        raise IntegrityError("INSERT", {}, Exception("duplicate key"))

    with pytest.raises(IntegrityError):
        broken()
    assert len(calls) == 1


def test_repository_write_survives_dropped_connection(client, monkeypatch):
    """A connection that dies mid-write is retried instead of the write being silently lost."""
    from sqlalchemy.exc import OperationalError

    from app.db import repository, session

    monkeypatch.setattr(session.time, "sleep", lambda s: None)
    real_session = repository.SessionLocal
    attempts = []

    def dropping_session():
        db = real_session()
        attempts.append(1)
        if len(attempts) == 1:
            def boom(*a, **k):
                raise OperationalError("COMMIT", {}, Exception("SSL connection has been closed unexpectedly"),
                                       connection_invalidated=True)
            db.commit = boom
        return db

    monkeypatch.setattr(repository, "SessionLocal", dropping_session)
    repository.save_step5_dbt_file("models/retry_check.sql", "select 42")
    monkeypatch.setattr(repository, "SessionLocal", real_session)

    assert len(attempts) == 2
    assert repository.get_step5_dbt_files()["models/retry_check.sql"] == "select 42"
