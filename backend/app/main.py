"""FastAPI application entry point. Run from backend/: uvicorn app.main:app --reload"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import database, ide, migration, project, prompts, settings as settings_api, skills, source
from app.core.config import settings
from app.db import repository as db_service
from app.modules import ai_governance, cdc_pipeline, cfo_analytics, cloud_modernization
from app.modules.costing.dbt import router as dbt_costing
from app.modules.costing.managed_airflow import router as managed_airflow_costing
from app.modules.costing.snowflake import router as snowflake_costing
from app.services.app_settings import load_llm_settings
from app.state import state

logger = logging.getLogger("uvicorn.error")


def _hydrate_state_from_db() -> None:
    """Create tables, seed the default project, and load persisted data into the in-memory state."""
    db_service.init_db()
    load_llm_settings()
    if settings.seed_demo_data:
        db_service.seed_initial_state_if_empty(state)
    else:
        db_service.ensure_project()
    saved = db_service.load_full_state()
    if not saved:
        return
    if saved.get("metadata") and saved["metadata"].get("tables"):
        state["metadata"] = saved["metadata"]
    if saved.get("uploaded_files"):
        # Preserve and attach content from in-memory state if empty
        for uf in saved["uploaded_files"]:
            if not uf.get("content"):
                matching = next((sf for sf in state.get("uploaded_files", []) if sf.get("id") == uf.get("id") or sf.get("filename") == uf.get("filename")), None)
                if matching and (matching.get("content") or matching.get("rawContent")):
                    uf["content"] = matching.get("content") or matching.get("rawContent")
                    uf["rawContent"] = uf["content"]
        state["uploaded_files"] = saved["uploaded_files"]
    if saved.get("source_connected") is not None:
        state["source_connected"] = saved["source_connected"]
        state["connection_type"] = saved.get("connection_type", state.get("connection_type"))


from app.core.scheduler import start_scheduler

@asynccontextmanager
async def lifespan(_: FastAPI):
    # The app cannot work without its database, so let connection/migration errors stop startup.
    _hydrate_state_from_db()
    start_scheduler()
    yield


app = FastAPI(
    title="R-Data — Prompt-Driven Data Modernization API",
    description="Enterprise API for AI-Powered ETL & SQL Modernization to dbt",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registration order is significant: earlier routers win when paths overlap.
for router in (
    # Feature modules
    prompts.router,
    cloud_modernization.router,
    cdc_pipeline.router,
    cfo_analytics.router,
    ai_governance.router,
    snowflake_costing.router,
    dbt_costing.router,
    managed_airflow_costing.router,
    # Code Conversion wizard (Steps 1-6) and shared platform endpoints
    database.router,
    source.router,
    skills.router,
    migration.router,
    project.router,
    settings_api.router,
    ide.router,
):
    app.include_router(router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
