"""Test setup: point the app at a throwaway PostgreSQL database before anything imports it.

Uses TEST_DATABASE_URL as-is if set (a dedicated, disposable database), otherwise DATABASE_URL (from the environment or backend/.env)
with "_test_<your username>" appended to the database name, so teammates sharing one server
never touch each other's test data. The test database is dropped and recreated per run, which
needs permission to create databases on that server.
"""
import getpass
import os
import re
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_env_files = {**dotenv_values(BACKEND_DIR.parent / ".env.local"), **dotenv_values(BACKEND_DIR / ".env")}
_base_url = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL") or _env_files.get("DATABASE_URL")
_direct_url = os.getenv("DATABASE_URL_UNPOOLED") or _env_files.get("DATABASE_URL_UNPOOLED")
if not _base_url:
    raise RuntimeError("Set TEST_DATABASE_URL or DATABASE_URL (PostgreSQL) to run the tests.")

_base = make_url(_base_url.replace("postgres://", "postgresql://", 1))
_url = _base
if not os.getenv("TEST_DATABASE_URL"):
    _user = re.sub(r"[^a-z0-9_]", "_", getpass.getuser().lower())
    _url = _base.set(database=f"{_base.database}_test_{_user}")
    # Connect through the configured database (hosted providers may not expose a "postgres" database)
    _admin = create_engine(make_url(_direct_url) if _direct_url else _base, isolation_level="AUTOCOMMIT")
    with _admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{_url.database}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{_url.database}"'))
    _admin.dispose()

os.environ["DATABASE_URL"] = _url.render_as_string(hide_password=False)
if _direct_url and not os.getenv("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL_UNPOOLED"] = make_url(_direct_url).set(database=_url.database).render_as_string(hide_password=False)
else:
    os.environ["DATABASE_URL_UNPOOLED"] = ""
os.environ["APP_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["SEED_DEMO_DATA"] = "true"


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
