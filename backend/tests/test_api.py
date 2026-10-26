from pathlib import Path

from app.core.config import ENV_FILE

ROUTES_FILE = Path(__file__).with_name("api_routes.txt")


def test_api_routes_unchanged(client):
    """The frontend depends on  these exact paths; update api_routes.txt only on purpose."""
    current = sorted(
        f"{method.upper()} {path}"
        for path, ops in client.app.openapi()["paths"].items()
        for method in ops
    )
    expected = [line.strip() for line in ROUTES_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert current == expected


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "database": "up"}


def test_database_status_reports_postgres(client):
    body = client.get("/api/database/status").json()
    assert body["status"] == "connected"
    assert body["provider"] == "PostgreSQL"
    assert "***" in body["databaseUrl"] or "@" not in body["databaseUrl"]


def test_demo_project_seeded(client):
    body = client.get("/api/source/metadata").json()
    assert body["status"] == "success"
    assert body["data"]["workflows"], "demo workflows should be seeded"


def test_settings_saved_to_database_not_env_file(client):
    env_before = ENV_FILE.read_bytes() if ENV_FILE.exists() else None

    resp = client.post("/api/settings", json={"provider": "openai", "model": "gpt-4o", "openaiApiKey": "sk-test-123456789"})
    assert resp.json()["status"] == "success"

    assert (ENV_FILE.read_bytes() if ENV_FILE.exists() else None) == env_before

    from app.services.app_settings import _KEY, _STORE
    saved = _STORE.get(_KEY)
    assert saved["provider"] == "openai"
    assert saved["openai_api_key"] == "sk-test-123456789"

    settings = client.get("/api/settings").json()["settings"]
    assert settings["provider"] == "openai"
    assert settings["openaiApiKeyMasked"].startswith("sk-tes")


def test_cfo_connections_listing(client):
    body = client.get("/api/cfo/connections").json()
    assert body == {"status": "success", "connections": []}


def test_saving_prompts_after_a_migration_run(client, monkeypatch):
    """Regression: /api/migration/run used to replace the prompt config, breaking /api/prompts/manual."""
    from app.api import migration

    monkeypatch.setattr(migration.generator, "generate_dbt_project_from_metadata", lambda state: {})
    monkeypatch.setattr(migration.generator, "write_and_persist_dbt_project", lambda files: [])

    run = client.post("/api/migration/run", json={"prompts": {"p1": "text one"}, "promptMode": "prompts"})
    assert run.json()["status"] == "success"

    config = client.get("/api/prompts/config").json()["config"]
    assert config["manualPrompts"] == {"p1": "text one"}
    assert "variables" in config

    saved = client.post("/api/prompts/manual", json={"prompts": {"p1": "edited"}, "variables": {"goldSchema": "GOLD"}})
    assert saved.status_code == 200
    assert saved.json()["config"]["variables"]["goldSchema"] == "GOLD"
    assert client.get("/api/prompts/static").status_code == 200
