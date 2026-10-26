"""
Apache Airflow source adapter (stable REST API, Airflow 2.x `/api/v1` by default).

Maps DAGs -> jobs, DAG runs -> runs, task instances -> run results. Every native Airflow field is
passed through in `attributes`; this adapter provides NO KPI hints, so the Airflow dashboard is
derived entirely by kpi_discovery_service.py from whatever metadata lands in Snowflake.

`useSampleData` is an explicit demo mode for environments without a reachable Airflow server. It is
never used as a silent fallback: if a real server is configured and unreachable, sync fails loudly.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

from .base_adapter import SourceAdapter

PAGE_LIMIT = 100
MAX_DAGS = 500
MAX_RUNS = 500
MAX_TASK_INSTANCES = 2000


def _truthy(value: Any) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _duration_between(start: Optional[str], end: Optional[str]) -> Optional[float]:
    if not start or not end:
        return None
    try:
        s = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        e = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
        return round((e - s).total_seconds(), 3)
    except ValueError:
        return None


class AirflowAdapter(SourceAdapter):
    source_type = "airflow"
    display_label = "Apache Airflow"
    default_target_db = "AIRFLOW_MONITORING"
    default_target_schema = "METADATA"
    credential_fields = [
        {"key": "airflowBaseUrl", "label": "Airflow Base URL", "type": "text", "required": True,
         "placeholder": "http://localhost:8080", "default": "http://localhost:8080"},
        {"key": "airflowApiPath", "label": "REST API Path", "type": "text", "required": False,
         "placeholder": "/api/v1", "default": "/api/v1", "help": "Stable REST API prefix of your Airflow deployment"},
        {"key": "airflowAuthToken", "label": "Bearer Token", "type": "password", "required": False,
         "placeholder": "Optional – use instead of username/password"},
        {"key": "airflowUsername", "label": "Username", "type": "text", "required": False, "placeholder": "admin"},
        {"key": "airflowPassword", "label": "Password", "type": "password", "required": False, "placeholder": "••••••••"},
        {"key": "useSampleData", "label": "Demo mode: use built-in sample DAG metadata (no Airflow server needed)",
         "type": "checkbox", "required": False, "default": False},
    ]

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = (self.config.get("airflowBaseUrl") or "http://localhost:8080").strip().rstrip("/")
        api_path = (self.config.get("airflowApiPath") or "/api/v1").strip()
        self.api_root = f"{self.base_url}/{api_path.strip('/')}"
        self.sample_mode = _truthy(self.config.get("useSampleData"))
        self.headers = {"Accept": "application/json"}
        self.auth = None
        token = (self.config.get("airflowAuthToken") or "").strip()
        if token:
            self.headers["Authorization"] = token if token.lower().startswith("bearer ") else f"Bearer {token}"
        elif self.config.get("airflowUsername") and self.config.get("airflowPassword"):
            self.auth = (self.config["airflowUsername"], self.config["airflowPassword"])
        self._dags: Optional[List[Dict[str, Any]]] = None
        self._runs: Optional[List[Dict[str, Any]]] = None
        self._tis: Optional[List[Dict[str, Any]]] = None
        self._health: Dict[str, Any] = {}

    # ------------------------------------------------------------------ interface
    def authenticate(self) -> Dict[str, Any]:
        if self.sample_mode:
            return {"message": "Airflow demo mode: using built-in sample DAG metadata.", "sample_mode": True}
        try:
            health = requests.get(f"{self.api_root}/health", headers=self.headers, auth=self.auth, timeout=10)
            if health.status_code == 200:
                self._health = health.json()
            # /health is unauthenticated on most deployments, so verify credentials on a protected endpoint.
            probe = requests.get(f"{self.api_root}/dags", headers=self.headers, auth=self.auth,
                                 params={"limit": 1}, timeout=15)
        except requests.RequestException as e:
            raise ValueError(f"Could not reach Airflow at {self.api_root}: {e}") from e
        if probe.status_code in (401, 403):
            raise ValueError(f"Airflow rejected the credentials (HTTP {probe.status_code}).")
        if probe.status_code != 200:
            raise ValueError(f"Airflow API returned HTTP {probe.status_code} for {self.api_root}/dags.")
        scheduler = (self._health.get("scheduler") or {}).get("status", "unknown")
        metadb = (self._health.get("metadatabase") or {}).get("status", "unknown")
        return {
            "message": f"Connected to Airflow at {self.base_url} (MetaDB: {metadb}, Scheduler: {scheduler})",
            "health": self._health,
        }

    def fetch_jobs(self) -> List[Dict[str, Any]]:
        records = []
        for d in self._get_dags():
            attrs = dict(d)
            attrs["tags"] = [t.get("name") if isinstance(t, dict) else t for t in (d.get("tags") or [])]
            records.append({
                "job_id": d.get("dag_id"),
                "job_name": d.get("dag_display_name") or d.get("dag_id"),
                "attributes": attrs,
            })
        return records

    def fetch_runs(self) -> List[Dict[str, Any]]:
        records = []
        for r in self._get_runs():
            records.append({
                "run_id": f"{r.get('dag_id')}::{r.get('dag_run_id')}",
                "job_id": r.get("dag_id"),
                "job_name": r.get("dag_id"),
                "status": r.get("state"),
                "started_at": r.get("start_date"),
                "finished_at": r.get("end_date"),
                "duration_secs": _duration_between(r.get("start_date"), r.get("end_date")),
                "attributes": dict(r),
            })
        return records

    def fetch_run_results(self) -> List[Dict[str, Any]]:
        records = []
        for ti in self._get_task_instances():
            map_index = ti.get("map_index", -1)
            records.append({
                "result_id": f"{ti.get('dag_id')}::{ti.get('dag_run_id')}::{ti.get('task_id')}::{map_index}",
                "run_id": f"{ti.get('dag_id')}::{ti.get('dag_run_id')}",
                "job_id": ti.get("dag_id"),
                "name": ti.get("task_id"),
                "status": ti.get("state"),
                "started_at": ti.get("start_date"),
                "finished_at": ti.get("end_date"),
                "duration_secs": ti.get("duration"),
                "attributes": dict(ti),
            })
        return records

    def connection_identity(self) -> str:
        prefix = "sample" if self.sample_mode else "live"
        return f"{prefix}|{self.api_root.lower()}"

    def display_name(self) -> str:
        return f"Airflow · {self.base_url}{' (demo)' if self.sample_mode else ''}"

    # ------------------------------------------------------------------ REST fetchers
    def _paged(self, path: str, key: str, max_items: int, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        offset = 0
        while len(items) < max_items:
            query = {"limit": PAGE_LIMIT, "offset": offset, **(params or {})}
            r = requests.get(f"{self.api_root}/{path}", headers=self.headers, auth=self.auth, params=query, timeout=30)
            r.raise_for_status()
            body = r.json()
            page = body.get(key, [])
            items.extend(page)
            total = body.get("total_entries")
            offset += len(page)
            if not page or len(page) < PAGE_LIMIT or (total is not None and offset >= total):
                break
        return items[:max_items]

    def _get_dags(self) -> List[Dict[str, Any]]:
        if self._dags is None:
            self._dags = _sample_dags() if self.sample_mode else self._paged("dags", "dags", MAX_DAGS)
        return self._dags

    def _get_runs(self) -> List[Dict[str, Any]]:
        if self._runs is None:
            if self.sample_mode:
                self._runs = _sample_dag_runs(self._get_dags())
            else:
                # `~` lists runs across all DAGs in one paged call.
                self._runs = self._paged("dags/~/dagRuns", "dag_runs", MAX_RUNS, {"order_by": "-start_date"})
        return self._runs

    def _get_task_instances(self) -> List[Dict[str, Any]]:
        if self._tis is None:
            if self.sample_mode:
                self._tis = _sample_task_instances(self._get_runs())
            else:
                tis: List[Dict[str, Any]] = []
                for run in self._get_runs():
                    if len(tis) >= MAX_TASK_INSTANCES:
                        break
                    path = f"dags/{run.get('dag_id')}/dagRuns/{run.get('dag_run_id')}/taskInstances"
                    try:
                        tis.extend(self._paged(path, "task_instances", MAX_TASK_INSTANCES - len(tis)))
                    except requests.RequestException as e:
                        print(f"[airflow adapter] task instances unavailable for {run.get('dag_run_id')}: {e}")
                self._tis = tis
        return self._tis


# ---------------------------------------------------------------------------
# Demo-mode sample metadata (shape mirrors the Airflow 2.x REST API responses)
# ---------------------------------------------------------------------------

_SAMPLE_DAGS = [
    ("dag_snowflake_dbt_orchestration", "Data_Engineering", "0 */4 * * *", False,
     "Orchestrates dbt transformations, tests, and dimensional marts in Snowflake.", ["dbt", "snowflake", "production"],
     [("dbt_run_staging", "DbtRunOperator"), ("dbt_test_quality", "DbtTestOperator"), ("dbt_run_marts", "DbtRunOperator")]),
    ("dag_crm_fivetran_ingestion", "Data_Ops", "0 * * * *", False,
     "Hourly sync of raw Salesforce & HubSpot CDC tables into Snowflake landing schema.", ["ingestion", "fivetran", "bronze"],
     [("trigger_fivetran_sync", "FivetranOperator"), ("extract_crm_delta", "SnowflakeOperator")]),
    ("dag_finance_reconciliation_audit", "Finance_Analytics", "0 6 * * *", False,
     "Daily automated GL account balance reconciliation and anomaly auditing.", ["finance", "audit", "reporting"],
     [("reconcile_ledger", "PythonOperator"), ("publish_audit_report", "EmailOperator")]),
    ("dag_marketing_attribution_ml", "ML_Ops", "0 2 * * *", True,
     "Multi-touch attribution ML model training and Snowflake feature store publishing.", ["ml", "attribution"],
     [("build_features", "SparkSubmitOperator"), ("train_model", "PythonOperator")]),
    ("dag_customer_360_daily_rollup", "Data_Engineering", "30 3 * * *", False,
     "Aggregates omni-channel customer touchpoints into Gold Star Schema.", ["gold", "customer360"],
     [("merge_touchpoints", "SnowflakeOperator"), ("publish_bi_metrics", "SnowflakeOperator")]),
]


def _sample_dags() -> List[Dict[str, Any]]:
    return [
        {
            "dag_id": dag_id, "dag_display_name": dag_id, "owners": [owner],
            "schedule_interval": {"__type": "CronExpression", "value": cron}, "timetable_description": cron,
            "is_paused": paused, "is_active": not paused, "is_subdag": False, "description": desc,
            "fileloc": f"/opt/airflow/dags/{dag_id}.py", "tags": [{"name": t} for t in tags],
            "max_active_tasks": 16, "max_active_runs": 1, "has_import_errors": False,
            "next_dagrun": None, "last_parsed_time": None,
        }
        for dag_id, owner, cron, paused, desc, tags, _ in _SAMPLE_DAGS
    ]


def _sample_dag_runs(dags: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rng = random.Random(42)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    runs = []
    for d_idx, dag in enumerate(dags):
        for i in range(12):
            start = now - timedelta(hours=4 * i + d_idx)
            state = "failed" if rng.random() < 0.12 else ("running" if i == 0 and d_idx == 0 else "success")
            duration = rng.uniform(60, 600)
            end = None if state == "running" else start + timedelta(seconds=duration)
            runs.append({
                "dag_id": dag["dag_id"],
                "dag_run_id": f"scheduled__{start.isoformat()}",
                "logical_date": start.isoformat(), "execution_date": start.isoformat(),
                "start_date": start.isoformat(), "end_date": end.isoformat() if end else None,
                "data_interval_start": (start - timedelta(hours=4)).isoformat(), "data_interval_end": start.isoformat(),
                "state": state, "run_type": "manual" if rng.random() < 0.15 else "scheduled",
                "external_trigger": False, "conf": {}, "note": None,
            })
    return runs


def _sample_task_instances(runs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rng = random.Random(7)
    tasks_by_dag = {dag_id: tasks for dag_id, *_rest, tasks in _SAMPLE_DAGS}
    tis = []
    for run in runs:
        cursor = datetime.fromisoformat(run["start_date"])
        failed_at = rng.randrange(len(tasks_by_dag[run["dag_id"]])) if run["state"] == "failed" else None
        for idx, (task_id, operator) in enumerate(tasks_by_dag[run["dag_id"]]):
            if failed_at is not None and idx > failed_at:
                state, duration = "upstream_failed", None
            elif failed_at is not None and idx == failed_at:
                state, duration = "failed", rng.uniform(5, 120)
            elif run["state"] == "running" and idx == len(tasks_by_dag[run["dag_id"]]) - 1:
                state, duration = "running", None
            else:
                state, duration = "success", rng.uniform(20, 200)
            end = cursor + timedelta(seconds=duration) if duration else None
            tis.append({
                "task_id": task_id, "dag_id": run["dag_id"], "dag_run_id": run["dag_run_id"],
                "execution_date": run["execution_date"], "start_date": cursor.isoformat() if duration else None,
                "end_date": end.isoformat() if end else None, "duration": round(duration, 3) if duration else None,
                "state": state, "try_number": 2 if state == "failed" else 1, "max_tries": 2, "map_index": -1,
                "hostname": f"celery-worker-{rng.randint(1, 4)}", "pool": "default_pool", "pool_slots": 1,
                "queue": "default", "priority_weight": 1, "operator": operator, "queued_when": None,
            })
            if end:
                cursor = end
    return tis
