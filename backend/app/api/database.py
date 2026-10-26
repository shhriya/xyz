"""/api/health and /api/database: liveness and application database status."""

import logging

from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import engine, safe_database_url

logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["database"])


def _database_reachable() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.warning(f"Database health check failed: {e}")
        return False


@router.get("/api/health")
def health():
    """Liveness/readiness probe for load balancers and container platforms."""
    db_ok = _database_reachable()
    return {"status": "ok" if db_ok else "degraded", "database": "up" if db_ok else "down"}


@router.get("/api/database/status")
def get_database_status():
    """Return the application database connection info."""
    connected = _database_reachable()
    return {
        "status": "connected" if connected else "error",
        "provider": "PostgreSQL",
        "isCloud": engine.url.host not in ("localhost", "127.0.0.1", "postgres"),
        "databaseUrl": safe_database_url(),
        "syncedSteps": ["Step 1: Source", "Step 2: Metadata", "Step 3: Prompts", "Step 4: Migration Runs", "Step 5: dbt Files"]
    }
