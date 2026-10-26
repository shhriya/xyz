"""
Oracle Scheduler (DBMS_SCHEDULER) source adapter.

Maps Oracle's own job scheduler onto the same Job/Run/RunResult contract as dbt and Airflow:
  - job        <- one row per *_SCHEDULER_JOBS (a defined scheduled job)
  - run        <- one row per *_SCHEDULER_JOB_RUN_DETAILS where JOB_SUBNAME IS NULL (a single
                   execution of that job)
  - run_result <- each run mirrored as its own one-step result. Oracle job *chains* additionally
                   log a JOB_SUBNAME row per chain step, but correlating those steps back to a
                   specific parent run reliably (across Oracle versions) needs a real chain-based
                   job to verify against, which wasn't available while building this — so chain
                   step detail is a known gap for v1, not silently guessed at.

Reads via *_SCHEDULER_JOBS / *_SCHEDULER_JOB_RUN_DETAILS, trying DBA_ first, then ALL_, then
USER_ — falls back automatically on ORA-00942 ("table or view does not exist", Oracle's standard
error for missing SELECT privilege on a DBA_* view), so this works whether the connecting user
has instance-wide visibility or only sees its own jobs.

Uses `oracledb` in its default "thin" mode (pure Python — no separate Oracle Instant Client
install needed).

NOT YET LIVE-TESTED — no Oracle instance was available while building this. Written directly
against Oracle's documented DBA_SCHEDULER_JOBS / DBA_SCHEDULER_JOB_RUN_DETAILS column set (stable
since 11g); the privilege-fallback behavior and CLOB/interval type handling should be confirmed
against a real instance before relying on this.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from .base_adapter import SourceAdapter

try:
    import oracledb
    ORACLEDB_AVAILABLE = True
except ImportError:
    ORACLEDB_AVAILABLE = False

VIEW_SCOPES = ["DBA", "ALL", "USER"]
MAX_JOBS = 1000
MAX_RUNS = 2000

JOB_COLUMNS = [
    "OWNER", "JOB_NAME", "JOB_TYPE", "JOB_ACTION", "JOB_CLASS", "SCHEDULE_TYPE",
    "REPEAT_INTERVAL", "START_DATE", "END_DATE", "ENABLED", "STATE", "RUN_COUNT",
    "FAILURE_COUNT", "RETRY_COUNT", "LAST_START_DATE", "LAST_RUN_DURATION",
    "NEXT_RUN_DATE", "COMMENTS",
]
RUN_DETAIL_COLUMNS = [
    "LOG_ID", "LOG_DATE", "OWNER", "JOB_NAME", "JOB_SUBNAME", "STATUS", "ERROR#",
    "ACTUAL_START_DATE", "RUN_DURATION", "CPU_USED", "ADDITIONAL_INFO",
]


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, timedelta):
        return round(value.total_seconds(), 3)
    if isinstance(value, Decimal):
        return float(value)
    return value


def _row_to_dict(columns: List[str], row: tuple) -> Dict[str, Any]:
    return {col: _json_safe(val) for col, val in zip(columns, row)}


def _output_type_handler(cursor, metadata):
    """Auto-converts CLOB columns (e.g. ADDITIONAL_INFO on some Oracle versions) to plain strings
    during fetch, instead of returning LOB objects that need a separate .read() call."""
    if not ORACLEDB_AVAILABLE:
        return None
    if metadata.type_code is oracledb.DB_TYPE_CLOB:
        return cursor.var(oracledb.DB_TYPE_LONG, arraysize=cursor.arraysize)
    if metadata.type_code is oracledb.DB_TYPE_BLOB:
        return cursor.var(oracledb.DB_TYPE_LONG_RAW, arraysize=cursor.arraysize)
    return None


class OracleSchedulerAdapter(SourceAdapter):
    source_type = "oracle_scheduler"
    display_label = "Oracle Scheduler"
    default_target_db = "ORACLE_MONITORING"
    default_target_schema = "METADATA"
    credential_fields = [
        {"key": "oracleHost", "label": "Oracle Host", "type": "text", "required": True, "placeholder": "db.example.com"},
        {"key": "oraclePort", "label": "Port", "type": "text", "required": False, "default": "1521", "placeholder": "1521"},
        {"key": "oracleServiceName", "label": "Service Name / SID", "type": "text", "required": True, "placeholder": "ORCLPDB1"},
        {"key": "oracleUsername", "label": "Username", "type": "text", "required": True},
        {"key": "oraclePassword", "label": "Password", "type": "password", "required": True},
    ]

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.host = (self.config.get("oracleHost") or "").strip()
        self.port = (self.config.get("oraclePort") or "1521").strip()
        self.service_name = (self.config.get("oracleServiceName") or "").strip()
        self.username = (self.config.get("oracleUsername") or "").strip()
        self.password = self.config.get("oraclePassword") or ""
        self._conn = None
        self._jobs_raw: Optional[List[Dict[str, Any]]] = None
        self._runs_raw: Optional[List[Dict[str, Any]]] = None
        self._job_scope: Optional[str] = None
        self._run_scope: Optional[str] = None

    # ------------------------------------------------------------------ interface
    def authenticate(self) -> Dict[str, Any]:
        if not ORACLEDB_AVAILABLE:
            raise ValueError("the `oracledb` package is not installed on the backend.")
        if not self.host or not self.service_name or not self.username:
            raise ValueError("Oracle Host, Service Name, and Username are required.")
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("SELECT banner FROM v$version WHERE ROWNUM = 1")
        row = cur.fetchone()
        cur.close()
        version = row[0] if row else "Unknown"
        return {"message": f"Connected to Oracle at {self.host}:{self.port}/{self.service_name} ({version}).", "version": version}

    def fetch_jobs(self) -> List[Dict[str, Any]]:
        records = []
        for j in self._get_jobs_raw():
            job_id = f"{j.get('OWNER')}.{j.get('JOB_NAME')}"
            records.append({
                "job_id": job_id,
                "job_name": j.get("JOB_NAME"),
                "attributes": {**j, "is_active": (j.get("ENABLED") == "TRUE")},
            })
        return records

    def fetch_runs(self) -> List[Dict[str, Any]]:
        records = []
        for r in self._get_runs_raw():
            job_id = f"{r.get('OWNER')}.{r.get('JOB_NAME')}"
            started_at = r.get("ACTUAL_START_DATE")
            duration_secs = r.get("RUN_DURATION")
            finished_at = None
            if started_at and duration_secs is not None:
                try:
                    finished_at = (datetime.fromisoformat(started_at) + timedelta(seconds=duration_secs)).isoformat()
                except ValueError:
                    finished_at = None
            records.append({
                "run_id": str(r.get("LOG_ID")),
                "job_id": job_id,
                "job_name": r.get("JOB_NAME"),
                "status": r.get("STATUS"),
                "started_at": started_at,
                "finished_at": finished_at,
                "duration_secs": duration_secs,
                "attributes": dict(r),
            })
        return records

    def fetch_run_results(self) -> List[Dict[str, Any]]:
        """Each run mirrored as its own one-step result (see module docstring re: chain steps)."""
        records = []
        for r in self._get_runs_raw():
            job_id = f"{r.get('OWNER')}.{r.get('JOB_NAME')}"
            records.append({
                "result_id": f"{r.get('LOG_ID')}::{job_id}",
                "run_id": str(r.get("LOG_ID")),
                "job_id": job_id,
                "name": r.get("JOB_NAME"),
                "status": r.get("STATUS"),
                "started_at": r.get("ACTUAL_START_DATE"),
                "finished_at": None,
                "duration_secs": r.get("RUN_DURATION"),
                "attributes": {
                    "error_code": r.get("ERROR#"),
                    "cpu_used_secs": r.get("CPU_USED"),
                    "additional_info": (r.get("ADDITIONAL_INFO") or "")[:5000],
                },
            })
        return records

    def connection_identity(self) -> str:
        return f"{self.host.lower()}:{self.port}/{self.service_name.lower()}|user={self.username.lower()}"

    def display_name(self) -> str:
        return f"Oracle Scheduler · {self.host}/{self.service_name}"

    # ------------------------------------------------------------------ internals
    def _connect(self):
        if self._conn is not None:
            return self._conn
        dsn = f"{self.host}:{self.port}/{self.service_name}"
        conn = oracledb.connect(user=self.username, password=self.password, dsn=dsn)
        conn.outputtypehandler = _output_type_handler
        self._conn = conn
        return conn

    def _query_with_scope_fallback(
        self, view_suffix: str, columns: List[str], where: str = "", order_by: str = "", limit: Optional[int] = None
    ) -> Tuple[List[Dict[str, Any]], str]:
        """Builds `SELECT ... FROM view WHERE ... ORDER BY ...` and, if `limit` is given, wraps it in
        a subquery before applying ROWNUM. Oracle evaluates ROWNUM before ORDER BY within the same
        query block, so filtering with ROWNUM directly alongside an ORDER BY silently returns an
        arbitrary N rows (then sorts just those) instead of the top-N by that order — this wrapping
        is what avoids that."""
        conn = self._connect()
        columns_sql = ", ".join(columns)
        inner = f"SELECT {columns_sql} FROM {{view}} {where} {order_by}".strip()
        query_template = f"SELECT * FROM ({inner}) WHERE ROWNUM <= {int(limit)}" if limit else inner

        last_err: Optional[Exception] = None
        for scope in VIEW_SCOPES:
            view = f"{scope}_{view_suffix}"
            try:
                cur = conn.cursor()
                cur.execute(query_template.format(view=view))
                rows = [_row_to_dict(columns, row) for row in cur.fetchall()]
                cur.close()
                return rows, scope
            except oracledb.DatabaseError as e:
                last_err = e
                continue
        raise ValueError(
            f"Could not read {view_suffix} from any of {', '.join(f'{s}_{view_suffix}' for s in VIEW_SCOPES)} "
            f"— check the account has SELECT privilege on at least USER_{view_suffix}. Last error: {last_err}"
        )

    def _get_jobs_raw(self) -> List[Dict[str, Any]]:
        if self._jobs_raw is None:
            rows, scope = self._query_with_scope_fallback("SCHEDULER_JOBS", JOB_COLUMNS, limit=MAX_JOBS)
            self._jobs_raw, self._job_scope = rows, scope
        return self._jobs_raw

    def _get_runs_raw(self) -> List[Dict[str, Any]]:
        if self._runs_raw is None:
            rows, scope = self._query_with_scope_fallback(
                "SCHEDULER_JOB_RUN_DETAILS", RUN_DETAIL_COLUMNS,
                where="WHERE JOB_SUBNAME IS NULL", order_by="ORDER BY LOG_DATE DESC", limit=MAX_RUNS,
            )
            self._runs_raw, self._run_scope = rows, scope
        return self._runs_raw
