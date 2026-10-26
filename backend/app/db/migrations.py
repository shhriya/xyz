"""Apply Alembic migrations programmatically (used at app startup)."""
import logging

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.core.config import BACKEND_DIR
from app.db.session import migration_engine

logger = logging.getLogger("uvicorn.error")

# Arbitrary constant: serializes migrations when several developers start the app at once
_MIGRATION_LOCK_ID = 7_314_159

# Revision that matches the schema the pre-Alembic code created with Base.metadata.create_all()
INITIAL_REVISION = "e26842abf290"


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["configure_logger"] = False
    return cfg


def upgrade_database() -> None:
    cfg = _alembic_config()
    with migration_engine.connect() as lock_conn:
        # Session-level advisory lock, held until this connection closes
        lock_conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _MIGRATION_LOCK_ID})
        try:
            inspector = inspect(migration_engine)
            if inspector.has_table("projects") and not inspector.has_table("alembic_version"):
                logger.info("Existing pre-Alembic schema found; marking it as the initial revision.")
                command.stamp(cfg, INITIAL_REVISION)
            command.upgrade(cfg, "head")
        finally:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": _MIGRATION_LOCK_ID})
            lock_conn.commit()
    logger.info("Database schema is up to date.")
