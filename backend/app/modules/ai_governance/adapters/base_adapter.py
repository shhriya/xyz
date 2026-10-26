"""
Common interface for governance source adapters.

Adding a new scheduler (Tivoli, Tidal, Control-M, ...) means writing ONE new adapter file that
subclasses SourceAdapter and registering it in adapters/__init__.py. Nothing else in the pipeline,
the KPI discovery service, the dashboard or the chatbot needs to know about it.

Every adapter maps its native metadata into three thin, source-agnostic record shapes that land in
GOV_JOBS / GOV_RUNS / GOV_RUN_RESULTS. The envelope fields (ids, name, raw status string, timestamps)
are only what is needed to join records together; everything the source actually knows about a job,
run or result goes into `attributes` verbatim, and kpi_discovery_service.py decides what matters.

    job:        {"job_id", "job_name", "attributes"}
    run:        {"run_id", "job_id", "job_name", "status", "started_at", "finished_at",
                 "duration_secs", "attributes"}
    run_result: {"result_id", "run_id", "job_id", "name", "status", "started_at", "finished_at",
                 "duration_secs", "attributes"}

`status` is the source's own raw status value; adapters must NOT normalize it into a shared vocabulary.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class SourceAdapter(ABC):
    #: Registry key used in URLs (/api/monitoring/{source_type}/...)
    source_type: str = ""
    #: Human label for the Source Type dropdown
    display_label: str = ""
    #: Credential form fields rendered by the Sync modal:
    #: [{"key", "label", "type": "text"|"password"|"checkbox", "required", "placeholder", "help", "default"}]
    credential_fields: List[Dict[str, Any]] = []
    default_target_db: str = "GOV_MONITORING"
    default_target_schema: str = "METADATA"

    def __init__(self, config: Dict[str, Any]):
        self.config = config or {}

    # ------------------------------------------------------------------ required
    @abstractmethod
    def authenticate(self) -> Dict[str, Any]:
        """Verify credentials against the source. Returns source info; raises on failure."""

    @abstractmethod
    def fetch_jobs(self) -> List[Dict[str, Any]]:
        """Job definitions (dbt jobs, Airflow DAGs, Tivoli job streams, ...)."""

    @abstractmethod
    def fetch_runs(self) -> List[Dict[str, Any]]:
        """Executions of jobs."""

    @abstractmethod
    def fetch_run_results(self) -> List[Dict[str, Any]]:
        """Per-step / per-node / per-task outcomes within runs."""

    @abstractmethod
    def connection_identity(self) -> str:
        """Stable identity of the connected source (valid after authenticate())."""

    # ------------------------------------------------------------------ optional hooks
    def display_name(self) -> str:
        return f"{self.display_label} ({self.connection_identity()})"

    def test_connection(self) -> Dict[str, Any]:
        info = self.authenticate()
        return {"status": "success", "message": info.get("message") or f"Connected to {self.display_label}.", "info": info}

    def extension_tables(self) -> List[str]:
        """Source-specific tables (beyond GOV_*) that this adapter populates."""
        return []

    def create_extension_ddls(self, conn, target_db: str, target_schema: str) -> None:
        return None

    def load_extensions(self, conn, target_db: str, target_schema: str, source_id: str) -> Dict[str, int]:
        return {}

    def extension_signature_parts(self) -> List[str]:
        """Structural facts about extension data that should trigger re-setup when they change."""
        return []

    def kpi_seed_hints(self) -> Optional[Dict[str, Any]]:
        """Known-good {"tabs": [...], "kpis": [...]} to seed the discovery prompt with. Only dbt provides these;
        every other adapter must return None so its dashboard is derived purely from its own metadata."""
        return None

    def sanitized_config(self) -> Dict[str, Any]:
        """Config with secret fields removed, for logs / API responses."""
        secret_keys = {f["key"] for f in self.credential_fields if f.get("type") == "password"}
        return {k: v for k, v in self.config.items() if k not in secret_keys}
