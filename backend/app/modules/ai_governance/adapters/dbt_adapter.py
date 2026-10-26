"""
dbt Cloud source adapter.

Wraps the dbt-specific API + extension-table logic in dbt_sync_service.py behind the common
SourceAdapter interface. dbt is the only source type that ships KPI seed hints: they encode the
proven dbt dashboard and are handed to the LLM as a starting point (it still validates/extends them).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base_adapter import SourceAdapter
from ..dbt_sync_service import (
    DBT_EXTENSION_TABLES,
    _parse_duration,
    create_dbt_extension_ddls,
    dbt_get_artifact,
    dbt_get_data,
    load_columns_to_snowflake,
    load_exposures_to_snowflake,
    load_models_to_snowflake,
    load_sources_to_snowflake,
    load_tests_to_snowflake,
)

DEFAULT_DBT_BASE_URL = "https://pt733.us1.dbt.com"

# How many runs to pull per sync. The core tables are MERGEd rather than replaced, so each refresh
# only has to cover the runs since the last one — but a generous window lets a first sync backfill
# real history for the 7/15/30-day and all-time filters instead of starting empty. dbt Cloud pages
# at 100, which dbt_get_data now handles.
RUN_FETCH_LIMIT = 500

# How many recent runs' run_results.json to pull. Bottleneck and regression detection need each
# model's *own* build-duration history to baseline against, so a single run's results aren't enough.
# Each run is a separate artifact download, so this is the slowest part of a sync and is deliberately
# far smaller than RUN_FETCH_LIMIT; merging means earlier syncs' results stay in the table.
RUN_RESULTS_HISTORY_LIMIT = 40


def _scalar_fields(record: Dict[str, Any]) -> Dict[str, Any]:
    """Keeps top-level non-null scalar/list-of-scalar fields; nested objects are summarized explicitly by callers.
    Nulls are dropped so fields that are sometimes an object and sometimes null don't flip the schema signature."""
    out = {}
    for k, v in (record or {}).items():
        if v is None or isinstance(v, dict):
            continue
        if isinstance(v, list) and any(isinstance(i, (dict, list)) for i in v):
            continue
        out[k] = v
    return out


class DbtAdapter(SourceAdapter):
    source_type = "dbt"
    display_label = "dbt Cloud"
    default_target_db = "DBT_MONITORING"
    default_target_schema = "METADATA"
    credential_fields = [
        {"key": "dbtServiceToken", "label": "dbt Cloud Service Token", "type": "password", "required": True,
         "placeholder": "dbtc_xxxxxxxxxxxxxxxxxxxx", "help": "Service token from dbt Cloud → Account Settings → API Tokens"},
        {"key": "dbtBaseUrl", "label": "dbt Cloud Base URL", "type": "text", "required": False,
         "placeholder": DEFAULT_DBT_BASE_URL, "default": DEFAULT_DBT_BASE_URL},
    ]

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.token = (self.config.get("dbtServiceToken") or "").strip()
        self.base_url = (self.config.get("dbtBaseUrl") or DEFAULT_DBT_BASE_URL).strip().rstrip("/")
        self.account: Optional[Dict[str, Any]] = None
        self._jobs_raw: Optional[List[Dict[str, Any]]] = None
        self._runs_raw: Optional[List[Dict[str, Any]]] = None
        self._artifacts_loaded = False
        self.manifest: Optional[dict] = None
        self.catalog: Optional[dict] = None
        self.run_results: Optional[dict] = None
        self.latest_run_id = 0

    # ------------------------------------------------------------------ interface
    def authenticate(self) -> Dict[str, Any]:
        if not self.token:
            raise ValueError("dbt Cloud Service Token is required.")
        accounts = dbt_get_data(self.base_url, self.token, "accounts/")
        if not accounts:
            raise ValueError("No dbt Cloud accounts accessible with provided token.")
        self.account = accounts[0]
        return {
            "account_id": self.account.get("id"),
            "account_name": self.account.get("name"),
            "message": f"Connected to dbt Cloud: {self.account.get('name', 'Account')} (ID: {self.account.get('id')})",
        }

    def test_connection(self) -> Dict[str, Any]:
        info = self.authenticate()
        runs = dbt_get_data(self.base_url, self.token, f"accounts/{self._account_id()}/runs/", {"limit": 1})
        return {
            "status": "success",
            "message": info["message"],
            "account": self.account,
            "hasRuns": len(runs) > 0,
            "latestRunId": runs[0]["id"] if runs else None,
        }

    def fetch_jobs(self) -> List[Dict[str, Any]]:
        jobs = self._get_jobs_raw()
        records = []
        for j in jobs:
            settings = j.get("settings") or {}
            schedule = j.get("schedule") or {}
            attrs = _scalar_fields(j)
            attrs.update({
                "is_active": not j.get("deactivated", False),
                "schedule_cron": schedule.get("cron", ""),
                "schedule_humanized": j.get("cron_humanized", ""),
                "threads": settings.get("threads"),
                "target_name": settings.get("target_name"),
                "environment_name": (j.get("environment") or {}).get("name") or j.get("environment_name"),
            })
            records.append({"job_id": j.get("id"), "job_name": j.get("name", ""), "attributes": attrs})
        return records

    def fetch_runs(self) -> List[Dict[str, Any]]:
        runs = self._get_runs_raw()
        jobs_map = {str(j.get("id")): j.get("name") for j in self._get_jobs_raw() if isinstance(j, dict) and j.get("id")}
        status_map = {1: "Queued", 2: "Starting", 3: "Running", 10: "Success", 20: "Error", 30: "Cancelled"}

        records = []
        for r in runs:
            job_id = (
                r.get("job_definition_id")
                or r.get("job_id")
                or (r.get("job") or {}).get("id")
                or (r.get("job_definition") or {}).get("id")
            )
            job_name = (
                r.get("job_definition_name")
                or (r.get("job") or {}).get("name")
                or (r.get("job_definition") or {}).get("name")
                or jobs_map.get(str(job_id))
                or r.get("job_name")
                or (f"Job #{job_id}" if job_id else "dbt Cloud Run")
            )
            trigger_info = r.get("trigger") or {}
            attrs = _scalar_fields(r)
            attrs.update({
                "status_humanized": r.get("status_humanized", status_map.get(r.get("status"), str(r.get("status")))),
                "trigger_cause": trigger_info.get("cause") or trigger_info.get("type") or r.get("trigger_type") or "Scheduled",
                "queued_duration_secs": _parse_duration(str(r.get("queued_duration", "0"))),
            })
            records.append({
                "run_id": r.get("id"),
                "job_id": job_id,
                "job_name": job_name,
                "status": attrs["status_humanized"],
                "started_at": r.get("started_at"),
                "finished_at": r.get("finished_at"),
                "duration_secs": _parse_duration(str(r.get("duration", "0"))),
                "attributes": attrs,
            })
        return records

    def _run_results_to_records(self, run_results_json: dict, run_id: int, job_id) -> List[Dict[str, Any]]:
        records = []
        for r in run_results_json.get("results", []):
            uid = r.get("unique_id", "")
            adapter = r.get("adapter_response", {})
            started, completed = None, None
            for t in r.get("timing", []):
                if t.get("name") == "execute":
                    started, completed = t.get("started_at"), t.get("completed_at")
            records.append({
                "result_id": uid,
                "run_id": run_id,
                "job_id": job_id,
                "name": uid.split(".")[-1] if uid else "",
                "status": r.get("status", "unknown"),
                "started_at": started,
                "finished_at": completed,
                "duration_secs": round(r.get("execution_time", 0) or 0, 3),
                "attributes": {
                    "unique_id": uid,
                    "resource_type": uid.split(".")[0] if "." in uid else "unknown",
                    "rows_affected": adapter.get("rows_affected", 0) if isinstance(adapter, dict) else 0,
                    "adapter_response": adapter if isinstance(adapter, dict) else str(adapter),
                    "failures": r.get("failures") or 0,
                    "message": (r.get("message") or "")[:5000],
                    "thread_id": r.get("thread_id"),
                },
            })
        return records

    def _resolve_job_id(self, r: Dict[str, Any]):
        """Resolves job_id from a raw dbt Cloud run dict using the same multi-field fallback as fetch_runs.

        dbt Cloud v2 API returns job id in different fields depending on account plan and API version:
        - Multi-tenant/enterprise: job_definition_id (top-level integer)
        - Trial/newer:             job.id or job_definition.id (nested dict)
        - Legacy:                  job_id (top-level)
        Using the same chain as fetch_runs ensures GOV_RUN_RESULTS.JOB_ID always matches GOV_RUNS.JOB_ID.
        """
        return (
            r.get("job_definition_id")
            or r.get("job_id")
            or (r.get("job") or {}).get("id")
            or (r.get("job_definition") or {}).get("id")
        )

    def fetch_run_results(self) -> List[Dict[str, Any]]:
        """Pulls run_results.json for the last RUN_RESULTS_HISTORY_LIMIT runs (not just the latest) so
        GOV_RUN_RESULTS holds enough per-model history for dbt_bottleneck_service.py to baseline against.
        Still plain data loading — no LLM call — so this runs on both Setup and Refresh."""
        self._load_artifacts()
        runs = self._get_runs_raw()[:RUN_RESULTS_HISTORY_LIMIT]
        records: List[Dict[str, Any]] = []
        missing = 0
        for r in runs:
            run_id = r.get("id")
            if not run_id:
                continue
            run_id = int(run_id)
            job_id = self._resolve_job_id(r)
            if run_id == self.latest_run_id and self.run_results is not None:
                run_results_json = self.run_results
            else:
                run_results_json = dbt_get_artifact(self.base_url, self.token, self._account_id(), run_id, "run_results.json")
            if not run_results_json:
                # dbt Cloud expires artifacts, and a cancelled or still-running run never wrote one.
                # Older runs are the usual case, so this is expected, not an error — skip and keep
                # going rather than letting one gap end the backfill.
                missing += 1
                continue
            records.extend(self._run_results_to_records(run_results_json, run_id, job_id))
        if missing:
            print(f"[dbt adapter] run_results.json unavailable for {missing}/{len(runs)} run(s); "
                  f"model-level history starts where artifacts still exist.")
        return records

    def connection_identity(self) -> str:
        project_ids = sorted({
            str(p) for p in
            [j.get("project_id") for j in (self._jobs_raw or [])] + [r.get("project_id") for r in (self._runs_raw or [])]
            if p
        })
        return f"{self.base_url.lower()}|account={self._account_id()}|projects={','.join(project_ids) or 'none'}"

    def display_name(self) -> str:
        name = (self.account or {}).get("name") or "dbt Cloud"
        return f"dbt Cloud · {name}"

    # ------------------------------------------------------------------ extensions
    def extension_tables(self) -> List[str]:
        return list(DBT_EXTENSION_TABLES)

    def create_extension_ddls(self, conn, target_db: str, target_schema: str) -> None:
        create_dbt_extension_ddls(conn, target_db, target_schema)

    def load_extensions(self, conn, target_db: str, target_schema: str, source_id: str) -> Dict[str, int]:
        self._load_artifacts()
        counts: Dict[str, int] = {}
        if self.manifest:
            counts["DBT_MODELS"] = load_models_to_snowflake(conn, self.manifest, target_db, target_schema, source_id)
            counts["DBT_SOURCES"] = load_sources_to_snowflake(conn, self.manifest, target_db, target_schema, source_id)
            counts["DBT_TESTS"] = load_tests_to_snowflake(conn, self.manifest, target_db, target_schema, source_id)
            counts["DBT_EXPOSURES"] = load_exposures_to_snowflake(conn, self.manifest, target_db, target_schema, source_id)
        else:
            print("[dbt adapter] WARNING: manifest.json unavailable; model/source/test/exposure tables not refreshed.")
        counts["DBT_COLUMNS"] = load_columns_to_snowflake(conn, self.catalog, self.manifest, target_db, target_schema, source_id)
        return counts

    def extension_signature_parts(self) -> List[str]:
        self._load_artifacts()
        if not self.manifest:
            return ["manifest:absent"]
        node_types = sorted({n.get("resource_type", "") for n in self.manifest.get("nodes", {}).values()})
        parts = [f"manifest.node_types={','.join(node_types)}"]
        for section in ("sources", "exposures"):
            parts.append(f"manifest.{section}={'present' if self.manifest.get(section) else 'absent'}")
        return parts

    def kpi_seed_hints(self) -> Optional[Dict[str, Any]]:
        return DBT_KPI_SEED_HINTS

    # ------------------------------------------------------------------ internals
    def _account_id(self) -> int:
        if not self.account:
            self.authenticate()
        return int(self.account["id"])

    def _get_jobs_raw(self) -> List[Dict[str, Any]]:
        if self._jobs_raw is None:
            self._jobs_raw = dbt_get_data(self.base_url, self.token, f"accounts/{self._account_id()}/jobs/")
        return self._jobs_raw

    def _get_runs_raw(self) -> List[Dict[str, Any]]:
        if self._runs_raw is None:
            self._runs_raw = dbt_get_data(
                self.base_url, self.token, f"accounts/{self._account_id()}/runs/",
                {"order_by": "-created_at"}, max_records=RUN_FETCH_LIMIT,
            )
            self.latest_run_id = int(self._runs_raw[0]["id"]) if self._runs_raw else 0
        return self._runs_raw

    def _load_artifacts(self) -> None:
        if self._artifacts_loaded:
            return
        self._get_runs_raw()
        if self.latest_run_id > 0:
            print(f"[dbt adapter] Downloading artifacts from latest run #{self.latest_run_id}...")
            acc = self._account_id()
            self.manifest = dbt_get_artifact(self.base_url, self.token, acc, self.latest_run_id, "manifest.json")
            self.catalog = dbt_get_artifact(self.base_url, self.token, acc, self.latest_run_id, "catalog.json")
            self.run_results = dbt_get_artifact(self.base_url, self.token, acc, self.latest_run_id, "run_results.json")
        self._artifacts_loaded = True


# ---------------------------------------------------------------------------
# Known-good dbt dashboard, expressed as KPI definitions over the generalized tables.
# {FQ} -> <DB>.<SCHEMA>, {SOURCE_ID} -> the registered source id. Used ONLY as an LLM prompt hint
# (and as the fallback when no LLM is reachable); every statement is still validated before activation.
# ---------------------------------------------------------------------------

_RUNS = "{FQ}.GOV_RUNS WHERE SOURCE_ID = '{SOURCE_ID}'"
_JOBS = "{FQ}.GOV_JOBS WHERE SOURCE_ID = '{SOURCE_ID}'"
_MODELS = "{FQ}.DBT_MODELS WHERE SOURCE_ID = '{SOURCE_ID}'"
_TESTS = "{FQ}.DBT_TESTS WHERE SOURCE_ID = '{SOURCE_ID}'"
_SOURCES = "{FQ}.DBT_SOURCES WHERE SOURCE_ID = '{SOURCE_ID}'"

DBT_KPI_SEED_HINTS: Dict[str, Any] = {
    "tabs": [
        {"id": "OVERVIEW", "label": "Executive Overview"},
        {"id": "PERFORMANCE", "label": "Build Performance"},
        {"id": "EXPLORER", "label": "Model Explorer"},
        {"id": "QUALITY", "label": "Quality & Coverage"},
        {"id": "FRESHNESS", "label": "Sources & Freshness"},
        {"id": "RECOMMENDATIONS", "label": "Analysis & Recommendations"},
    ],
    "kpis": [
        {"kpi_name": "TOTAL_JOBS", "label": "Total Jobs", "section": "OVERVIEW", "chart_type": "kpi_card",
         "display": {"icon": "Briefcase", "color": "#10338D"},
         "sql_definition": f"SELECT COUNT(*) AS VALUE FROM {_JOBS}"},
        {"kpi_name": "ACTIVE_JOBS", "label": "Active Jobs", "section": "OVERVIEW", "chart_type": "kpi_card",
         "display": {"icon": "Zap", "color": "#1C58F6"},
         "sql_definition": f"SELECT COUNT_IF(ATTRIBUTES:is_active::BOOLEAN) AS VALUE FROM {_JOBS}"},
        {"kpi_name": "TOTAL_RUNS", "label": "Total Runs", "section": "OVERVIEW", "chart_type": "kpi_card",
         "display": {"icon": "TrendingUp", "color": "#1C58F6"},
         "sql_definition": f"SELECT COUNT(*) AS VALUE FROM {_RUNS}"},
        {"kpi_name": "SUCCESS_RATE", "label": "Success Rate", "section": "OVERVIEW", "chart_type": "kpi_card", "unit": "%",
         "display": {"icon": "CheckCircle2", "color": "#16A34A"},
         "sql_definition": f"SELECT COALESCE(ROUND(COUNT_IF(STATUS = 'Success') * 100.0 / NULLIF(COUNT(*), 0), 2), 0) AS VALUE FROM {_RUNS}"},
        {"kpi_name": "AVG_DURATION", "label": "Avg Duration", "section": "OVERVIEW", "chart_type": "kpi_card", "unit": "s",
         "display": {"icon": "Clock", "color": "#1C58F6"},
         "sql_definition": f"SELECT COALESCE(ROUND(AVG(DURATION_SECS), 1), 0) AS VALUE FROM {_RUNS}"},
        {"kpi_name": "LONGEST_DURATION", "label": "Longest Duration", "section": "OVERVIEW", "chart_type": "kpi_card", "unit": "s",
         "display": {"icon": "Timer", "color": "#FF3C00"},
         "sql_definition": f"SELECT COALESCE(ROUND(MAX(DURATION_SECS), 1), 0) AS VALUE FROM {_RUNS}"},
        {"kpi_name": "TOTAL_MODELS", "label": "Total Models", "section": "OVERVIEW", "chart_type": "kpi_card",
         "display": {"icon": "Layers", "color": "#10338D"},
         "sql_definition": f"SELECT COUNT(*) AS VALUE FROM {_MODELS}"},
        {"kpi_name": "TOTAL_TESTS", "label": "Total Tests", "section": "OVERVIEW", "chart_type": "kpi_card",
         "display": {"icon": "ShieldCheck", "color": "#10338D"},
         "sql_definition": f"SELECT COUNT(*) AS VALUE FROM {_TESTS}"},
        {"kpi_name": "TEST_COVERAGE", "label": "Test Coverage", "section": "OVERVIEW", "chart_type": "kpi_card", "unit": "%",
         "display": {"icon": "ShieldCheck", "color": "#FF3C00"},
         "sql_definition": f"SELECT COALESCE(ROUND(COUNT_IF(HAS_TESTS) * 100.0 / NULLIF(COUNT(*), 0), 2), 0) AS VALUE FROM {_MODELS}"},
        {"kpi_name": "DOC_COVERAGE", "label": "Doc Coverage", "section": "OVERVIEW", "chart_type": "kpi_card", "unit": "%",
         "display": {"icon": "BookOpen", "color": "#10338D"},
         "sql_definition": f"SELECT COALESCE(ROUND(COUNT_IF(HAS_DESCRIPTION) * 100.0 / NULLIF(COUNT(*), 0), 2), 0) AS VALUE FROM {_MODELS}"},
        {"kpi_name": "TAG_COVERAGE", "label": "Tag Coverage", "section": "OVERVIEW", "chart_type": "kpi_card", "unit": "%",
         "display": {"icon": "Tag", "color": "#FF3C00"},
         "sql_definition": f"SELECT COALESCE(ROUND(COUNT_IF(HAS_TAGS) * 100.0 / NULLIF(COUNT(*), 0), 2), 0) AS VALUE FROM {_MODELS}"},
        {"kpi_name": "FRESH_SOURCES", "label": "Fresh Sources", "section": "OVERVIEW", "chart_type": "kpi_card",
         "display": {"icon": "Droplets", "color": "#1C58F6"},
         "sql_definition": f"SELECT TO_VARCHAR(COUNT_IF(IS_FRESH)) || '/' || TO_VARCHAR(COUNT(*)) AS VALUE FROM {_SOURCES}"},
        {"kpi_name": "BUILD_DURATION_TREND", "label": "Build Duration Trend", "section": "OVERVIEW", "chart_type": "line", "unit": "s",
         "description": "Last 50 runs, seconds per build", "display": {"span": 3, "accent": "#FF3C00"},
         "sql_definition": (
             "SELECT X, Y AS DURATION_SEC FROM ("
             "SELECT 'Run #' || TO_VARCHAR(RUN_ID) AS X, DURATION_SECS AS Y, "
             "COALESCE(STARTED_AT, TRY_TO_TIMESTAMP_NTZ(ATTRIBUTES:created_at::STRING)) AS TS "
             f"FROM {_RUNS} ORDER BY TS DESC NULLS LAST LIMIT 50) ORDER BY TS"
         )},
        {"kpi_name": "MODEL_LAYER_DISTRIBUTION", "label": "Model Layer Distribution", "section": "OVERVIEW", "chart_type": "donut",
         "description": "Models across the DAG", "display": {"span": 2},
         "sql_definition": f"SELECT MODEL_LAYER AS LABEL, COUNT(*) AS VALUE FROM {_MODELS} GROUP BY MODEL_LAYER ORDER BY VALUE DESC"},
        {"kpi_name": "BUILD_DURATION_HISTORY", "label": "Build Duration — Historical Runs", "section": "PERFORMANCE", "chart_type": "line", "unit": "s",
         "display": {"span": 3},
         "sql_definition": (
             "SELECT X, Y AS DURATION_SEC FROM ("
             "SELECT 'Run #' || TO_VARCHAR(RUN_ID) AS X, DURATION_SECS AS Y, "
             "COALESCE(STARTED_AT, TRY_TO_TIMESTAMP_NTZ(ATTRIBUTES:created_at::STRING)) AS TS "
             f"FROM {_RUNS} ORDER BY TS DESC NULLS LAST LIMIT 50) ORDER BY TS"
         )},
        {"kpi_name": "RUN_STATUS_BREAKDOWN", "label": "Run Status Breakdown", "section": "PERFORMANCE", "chart_type": "donut",
         "display": {"span": 2},
         "sql_definition": f"SELECT STATUS AS LABEL, COUNT(*) AS VALUE FROM {_RUNS} GROUP BY STATUS ORDER BY VALUE DESC"},
        {"kpi_name": "RECENT_RUNS", "label": "Recent Runs", "section": "PERFORMANCE", "chart_type": "table",
         "sql_definition": (
             "SELECT RUN_ID, JOB_NAME, STARTED_AT, ATTRIBUTES:trigger_cause::STRING AS TRIGGER, "
             "ATTRIBUTES:duration_humanized::STRING AS DURATION, STATUS "
             f"FROM {_RUNS} ORDER BY COALESCE(STARTED_AT, TRY_TO_TIMESTAMP_NTZ(ATTRIBUTES:created_at::STRING)) DESC NULLS LAST LIMIT 15"
         )},
        {"kpi_name": "MODEL_INVENTORY", "label": "Model Explorer", "section": "EXPLORER", "chart_type": "table",
         "description": "Search models by name or description",
         "sql_definition": (
             "SELECT MODEL_NAME, MODEL_LAYER, MATERIALIZATION, TEST_COUNT, PARENTS, DESCRIPTION, "
             # dbt only populates COMPILED_SQL after a full `dbt run`; fall back to RAW_SQL, then a
             # synthesized stub, so the "View SQL" modal never renders an empty (visually black) box.
             "COALESCE(NULLIF(COMPILED_SQL, ''), NULLIF(RAW_SQL, ''), 'SELECT * FROM ' || MODEL_NAME || ';') AS COMPILED_SQL "
             f"FROM {_MODELS} ORDER BY MODEL_LAYER, MODEL_NAME"
         )},
        {"kpi_name": "TEST_TYPE_DISTRIBUTION", "label": "Test Type Distribution", "section": "QUALITY", "chart_type": "bar",
         "description": "Breakdown of test assertions across models",
         "sql_definition": f"SELECT TEST_TYPE AS LABEL, COUNT(*) AS VALUE FROM {_TESTS} GROUP BY TEST_TYPE ORDER BY VALUE DESC"},
        {"kpi_name": "TESTS_PER_MODEL", "label": "Tests per Model", "section": "QUALITY", "chart_type": "bar",
         "description": "Top models with attached assertions", "display": {"orientation": "horizontal"},
         "sql_definition": (
             f"SELECT ATTACHED_MODEL_NAME AS LABEL, COUNT(*) AS VALUE FROM {_TESTS} "
             "AND ATTACHED_MODEL_NAME IS NOT NULL AND ATTACHED_MODEL_NAME <> '' "
             "GROUP BY ATTACHED_MODEL_NAME ORDER BY VALUE DESC LIMIT 10"
         )},
        {"kpi_name": "UNTESTED_MODELS", "label": "Models Lacking Data Tests", "section": "QUALITY", "chart_type": "table",
         "display": {"accent": "#FF3C00"},
         "sql_definition": f"SELECT MODEL_NAME, MODEL_LAYER, DESCRIPTION FROM {_MODELS} AND COALESCE(TEST_COUNT, 0) = 0 ORDER BY MODEL_NAME"},
        {"kpi_name": "QUALITY_TESTS", "label": "Synchronized Quality Tests", "section": "QUALITY", "chart_type": "table",
         "description": "Detailed assertions across columns and models",
         "sql_definition": (
             "SELECT TEST_NAME, TEST_TYPE, ATTACHED_MODEL_NAME AS MODEL, COLUMN_NAME, SEVERITY "
             f"FROM {_TESTS} ORDER BY ATTACHED_MODEL_NAME, TEST_NAME LIMIT 50"
         )},
        {"kpi_name": "SOURCE_FRESHNESS", "label": "Source Freshness & SLA Compliance", "section": "FRESHNESS", "chart_type": "table",
         "description": "SLA target thresholds vs actual raw data ingestion timestamps",
         "sql_definition": (
             "SELECT SOURCE_NAME, TABLE_NAME, DATABASE_NAME || '.' || SCHEMA_NAME AS SCHEMA, LOADER, "
             "FRESHNESS_SLA_HOURS AS SLA_TARGET_HOURS, MAX_LOADED_AT AS LAST_INGESTED, FRESHNESS_STATUS AS STATUS "
             f"FROM {_SOURCES} ORDER BY SOURCE_NAME, TABLE_NAME"
         )},
        {"kpi_name": "GOVERNANCE_RECOMMENDATIONS", "label": "Actionable Recommendations", "section": "RECOMMENDATIONS", "chart_type": "recommendation",
         "sql_definition": (
             "WITH m AS (SELECT COUNT(*) AS TOTAL, COUNT_IF(HAS_TESTS) AS TESTED, COUNT_IF(HAS_DESCRIPTION) AS DOCUMENTED "
             f"FROM {_MODELS}), "
             f"r AS (SELECT COUNT(*) AS TOTAL, COUNT_IF(STATUS = 'Error') AS FAILED FROM {_RUNS}) "
             "SELECT CASE WHEN m.TOTAL = 0 OR m.TESTED * 100.0 / m.TOTAL < 50 THEN 'HIGH' WHEN m.TESTED < m.TOTAL THEN 'MEDIUM' ELSE 'LOW' END AS PRIORITY, "
             "'Test Coverage at ' || TO_VARCHAR(COALESCE(ROUND(m.TESTED * 100.0 / NULLIF(m.TOTAL, 0), 1), 0)) || '%' AS TITLE, "
             "TO_VARCHAR(m.TOTAL - m.TESTED) || ' of ' || TO_VARCHAR(m.TOTAL) || ' models have no attached tests. Ensure all critical dimension and fact models have tests attached.' AS DESCRIPTION "
             "FROM m "
             "UNION ALL "
             "SELECT CASE WHEN m.TOTAL = 0 OR m.DOCUMENTED * 100.0 / m.TOTAL < 50 THEN 'MEDIUM' ELSE 'LOW' END, "
             "'Documentation Coverage at ' || TO_VARCHAR(COALESCE(ROUND(m.DOCUMENTED * 100.0 / NULLIF(m.TOTAL, 0), 1), 0)) || '%', "
             "TO_VARCHAR(m.TOTAL - m.DOCUMENTED) || ' models have no description. Document models in schema.yml so lineage stays understandable.' "
             "FROM m "
             "UNION ALL "
             "SELECT CASE WHEN r.FAILED > 0 THEN 'HIGH' ELSE 'LOW' END, "
             "TO_VARCHAR(r.FAILED) || ' failed of ' || TO_VARCHAR(r.TOTAL) || ' synced runs', "
             "CASE WHEN r.FAILED > 0 THEN 'Investigate failing jobs in Build Performance and add alerting on job errors.' "
             "ELSE 'All synced runs completed without errors. Schedule recurring refresh to keep metadata synchronized.' END "
             "FROM r"
         )},
    ],
}
