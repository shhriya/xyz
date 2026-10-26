"""
AI Governance & Pipeline Monitoring API Router (multi-source).

  GET  /api/monitoring/source-types               available adapters + their credential fields
  GET  /api/monitoring/sources                    registered sources (no secrets)
  GET  /api/monitoring/{source_type}/config       credential fields & defaults for one source type
  POST /api/monitoring/{source_type}/test-connection
  POST /api/monitoring/{source_type}/sync         registry-routed Setup (LLM) or Refresh; ?stream=true for NDJSON progress
  POST /api/monitoring/{source_id}/refresh        plain refresh of a set-up source (never calls the LLM)
  GET  /api/monitoring/{source_id}/dashboard      KPI view results for a source (never calls the LLM)
  POST /api/monitoring/{source_type}/chat         source-aware copilot; body carries sourceId
  GET  /api/monitoring/{source_id}/bottlenecks    dbt-only: flagged slow-build models (Level 2, never calls the LLM)
  POST /api/monitoring/{source_id}/optimize-query dbt-only: AI-rewritten SQL for one flagged model (Level 3, on demand)

Time-filtered drill-down and trend detection (all plain SQL/statistics, never the LLM). Every one
takes ?period=7|15|30|all:
  GET  /api/monitoring/{source_id}/summary                      headline KPIs + history coverage
  GET  /api/monitoring/{source_id}/jobs                         level 1
  GET  /api/monitoring/{source_id}/jobs/{job_id}/models          level 2
  GET  /api/monitoring/{source_id}/models/{model_name}/queries   level 3
  GET  /api/monitoring/{source_id}/regressions                  ?level=job|model|query
"""

from __future__ import annotations

import json
import queue
import threading
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import drilldown_service as drilldown
from . import regression_service as regression
from . import source_store
from .adapters import describe_source_types, get_adapter_class
from .chat_service import process_chat_message
from .drilldown_service import DEFAULT_PERIOD, describe_period, resolve_period
from .regression_service import (
    DEFAULT_MIN_CURRENT_SEC,
    DEFAULT_REGRESSION_MULTIPLIER,
    DEFAULT_ROW_GROWTH_MULTIPLIER,
)
from .dbt_bottleneck_service import (
    DEFAULT_ABSOLUTE_THRESHOLD_SEC,
    DEFAULT_MIN_FLAG_ELAPSED_SEC,
    DEFAULT_RELATIVE_MULTIPLIER,
    detect_dbt_bottlenecks_for_source,
    optimize_dbt_bottleneck_for_source,
)
from .sync_service import load_dashboard, refresh_source, sync_source, test_source_connection

router = APIRouter(prefix="/api/monitoring", tags=["ai_governance"])

_RESERVED_SYNC_KEYS = {"credentials", "snowflakeCredentials", "targetDatabase", "targetSchema", "snowflakeConnectionId"}


class ChatRequest(BaseModel):
    sourceId: str
    message: str
    history: Optional[List[Dict[str, str]]] = []


class OptimizeQueryRequest(BaseModel):
    modelName: str
    querySql: str
    diagnosis: Optional[Dict[str, Any]] = None
    # When present, the backend prefers the captured statement and its real execution statistics
    # over the model's compiled SQL — set by the query level of the drill-down.
    queryId: Optional[str] = None


def _adapter_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Accepts {"credentials": {...}} or the legacy flat body (e.g. dbtServiceToken at top level)."""
    if isinstance(payload.get("credentials"), dict):
        return payload["credentials"]
    return {k: v for k, v in payload.items() if k not in _RESERVED_SYNC_KEYS}


def _require_source_type(source_type: str):
    try:
        return get_adapter_class(source_type)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/source-types")
def list_source_types() -> Dict[str, Any]:
    return {"status": "success", "source_types": describe_source_types()}


@router.get("/sources")
def list_sources() -> Dict[str, Any]:
    return {"status": "success", "sources": source_store.list_sources_public()}


@router.get("/{source_type}/config")
def get_source_config(source_type: str) -> Dict[str, Any]:
    cls = _require_source_type(source_type)
    return {
        "status": "success",
        "source_type": cls.source_type,
        "display_label": cls.display_label,
        "credential_fields": cls.credential_fields,
        # snake_case to match /source-types, which is what the sync modal reads. The camelCase
        # aliases are kept so an older client doesn't break on the rename.
        "default_target_db": cls.default_target_db,
        "default_target_schema": cls.default_target_schema,
        "defaultTargetDb": cls.default_target_db,
        "defaultTargetSchema": cls.default_target_schema,
        "registered_sources": [s for s in source_store.list_sources_public() if s["source_type"] == cls.source_type],
    }


@router.post("/{source_type}/test-connection")
def test_connection(source_type: str, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    _require_source_type(source_type)
    try:
        return test_source_connection(source_type, _adapter_config(payload))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {e}")


@router.post("/{source_type}/sync")
def sync_monitoring_source(
    source_type: str,
    payload: Dict[str, Any] = Body(...),
    stream: bool = Query(False),
):
    """Routes to Setup (new/changed source, LLM KPI discovery) or Refresh (unchanged) via GOV_SOURCE_REGISTRY."""
    _require_source_type(source_type)
    kwargs = dict(
        source_type=source_type,
        adapter_config=_adapter_config(payload),
        snowflake_creds=payload.get("snowflakeCredentials") or {},
        target_db=payload.get("targetDatabase"),
        target_schema=payload.get("targetSchema"),
    )

    if not stream:
        try:
            return sync_source(**kwargs)
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    events: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue()

    def worker():
        try:
            result = sync_source(**kwargs, emit=events.put)
            events.put({"type": "result", "result": result})
        except Exception as e:
            events.put({"type": "error", "detail": str(e)})
        finally:
            events.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def event_stream():
        while True:
            event = events.get()
            if event is None:
                break
            yield json.dumps(event, default=str) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/{source_id}/refresh")
def refresh_monitoring_source(source_id: str) -> Dict[str, Any]:
    """Refresh button: plain data pull with saved connection details. No LLM call, no KPI discovery."""
    try:
        return refresh_source(source_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{source_id}/dashboard")
def get_source_dashboard(source_id: str) -> Dict[str, Any]:
    try:
        return load_dashboard(source_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{source_type}/chat")
def monitoring_chat(source_type: str, req: ChatRequest) -> Dict[str, Any]:
    entry = source_store.get_source(req.sourceId)
    if not entry or entry["source_type"] != source_type.lower():
        raise HTTPException(status_code=404, detail=f"No {source_type} source registered with id '{req.sourceId}'.")
    try:
        return process_chat_message(req.sourceId, req.message, req.history or [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{source_id}/bottlenecks")
def get_source_bottlenecks(
    source_id: str,
    absoluteThresholdSec: Optional[float] = Query(None),
    relativeMultiplier: Optional[float] = Query(None),
    minDurationSec: Optional[float] = Query(None),
) -> Dict[str, Any]:
    """
    dbt-only: flags dbt model builds running far longer than their own history or an absolute ceiling.
    Level 2 — plain thresholding over already-synced data. Never calls the LLM; safe on every page load.
    """
    thresholds = {
        "absoluteThresholdSec": absoluteThresholdSec if absoluteThresholdSec is not None else DEFAULT_ABSOLUTE_THRESHOLD_SEC,
        "relativeMultiplier": relativeMultiplier if relativeMultiplier is not None else DEFAULT_RELATIVE_MULTIPLIER,
        "minDurationSec": minDurationSec if minDurationSec is not None else DEFAULT_MIN_FLAG_ELAPSED_SEC,
    }
    try:
        bottlenecks = detect_dbt_bottlenecks_for_source(
            source_id,
            absolute_threshold_sec=thresholds["absoluteThresholdSec"],
            relative_multiplier=thresholds["relativeMultiplier"],
            min_elapsed_sec=thresholds["minDurationSec"],
        )
        # Echo the values actually applied so the UI can never silently disagree with the backend.
        return {"status": "success", "source_id": source_id, "bottlenecks": bottlenecks, "thresholds": thresholds}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{source_id}/optimize-query")
def optimize_source_query(source_id: str, req: OptimizeQueryRequest) -> Dict[str, Any]:
    """
    dbt-only: Level 3, on-demand AI rewrite of one flagged model's compiled SQL. Only called when the
    user explicitly clicks "Optimize with AI" — never automatic. Never executes the proposed SQL.
    """
    try:
        return optimize_dbt_bottleneck_for_source(
            source_id, req.modelName, req.querySql, req.diagnosis, query_id=req.queryId
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Drill-down (job -> model -> query), time-filtered. Plain SQL over already-synced data:
# never calls the LLM, so these are safe on every page load and on every filter change.
# ---------------------------------------------------------------------------

def _drilldown(source_id: str, fn, *args):
    """Opens the source's connection, runs one read, and always closes it."""
    try:
        conn, fq, entry = drilldown.open_source(source_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not connect to Snowflake for this source: {e}")
    try:
        return fn(conn, fq, source_id, *args), entry
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/{source_id}/summary")
def get_source_summary(source_id: str, period: str = Query(DEFAULT_PERIOD)) -> Dict[str, Any]:
    """Headline KPIs for the strip above the tabs, plus how much history actually exists."""
    p = resolve_period(period)

    def run(conn, fq, sid):
        summary = drilldown.fetch_summary(conn, fq, sid, p)
        summary["failuresInPeriod"] = regression.failures_in_period(conn, fq, sid, p)
        summary.update(regression.count_flagged(conn, fq, sid, p))
        summary["coverage"] = drilldown.data_coverage(conn, fq, sid)
        return summary

    summary, entry = _drilldown(source_id, run)
    return {"status": "success", "source_id": source_id, "source_type": entry["source_type"], **summary}


@router.get("/{source_id}/jobs")
def get_source_jobs(source_id: str, period: str = Query(DEFAULT_PERIOD)) -> Dict[str, Any]:
    """Level 1 of the drill-down."""
    p = resolve_period(period)
    jobs, entry = _drilldown(source_id, lambda c, f, s: drilldown.fetch_jobs(c, f, s, p))
    return {
        "status": "success", "source_id": source_id, "source_type": entry["source_type"],
        **describe_period(p), "jobs": jobs,
    }


@router.get("/{source_id}/jobs/{job_id}/models")
def get_job_models(source_id: str, job_id: str, period: str = Query(DEFAULT_PERIOD)) -> Dict[str, Any]:
    """Level 2. Called 'models' throughout; for a non-dbt source these are task instances."""
    p = resolve_period(period)
    models, entry = _drilldown(source_id, lambda c, f, s: drilldown.fetch_job_models(c, f, s, job_id, p))
    return {
        "status": "success", "source_id": source_id, "source_type": entry["source_type"],
        "job_id": job_id, **describe_period(p), "models": models,
    }


@router.get("/{source_id}/models/{model_name}/queries")
def get_model_queries(
    source_id: str,
    model_name: str,
    period: str = Query(DEFAULT_PERIOD),
    runId: Optional[str] = Query(None),
    scope: str = Query("latest"),
) -> Dict[str, Any]:
    """Level 3 — the statements one model ran.

    `scope=latest` (the default) shows the model's most recent run, which is what "the queries this
    model runs" means to a reader. `scope=all` shows every run in the period.

    dbt-only in practice: it needs a query id from the adapter's run results, which only dbt reports.
    When capture found nothing, falls back to the model's compiled SQL from the manifest and says so,
    rather than rendering an empty panel with no explanation.
    """
    p = resolve_period(period)
    latest_only = str(scope or "latest").lower() != "all"

    def run(conn, fq, sid):
        queries = drilldown.fetch_queries(
            conn, fq, sid, model_name, p, run_id=runId, latest_only=latest_only
        )
        compiled_sql = drilldown.fetch_model_compiled_sql(conn, fq, sid, model_name)
        if queries:
            enriched = sum(1 for q in queries if q.get("QUERY_TEXT"))
            for q in queries:
                if not q.get("QUERY_TEXT") and compiled_sql:
                    q["FALLBACK_SQL"] = compiled_sql
            return {
                "queries": queries,
                "compiledSql": compiled_sql,
                "scope": "latest" if latest_only and not runId else "all",
                "source": "query_history" if enriched else "adapter_response",
                "note": None if enriched else (
                    "Showing the query dbt reported for each run. Real-time manifest compiled SQL "
                    "is shown below while Snowflake's query history catches up."
                ),
            }
        return {
            "queries": [],
            "source": "compiled_sql",
            "compiledSql": compiled_sql,
            "note": (
                "No per-run queries have been captured for this model yet. Showing its current "
                "compiled SQL from the dbt manifest, which is the same for every run."
            ),
        }

    payload, entry = _drilldown(source_id, run)
    return {
        "status": "success", "source_id": source_id, "source_type": entry["source_type"],
        "model_name": model_name, **describe_period(p), **payload,
    }


@router.get("/{source_id}/regressions")
def get_source_regressions(
    source_id: str,
    period: str = Query(DEFAULT_PERIOD),
    level: str = Query("model"),
    multiplier: Optional[float] = Query(None),
    minDurationSec: Optional[float] = Query(None),
    rowGrowthMultiplier: Optional[float] = Query(None),
) -> Dict[str, Any]:
    """Trend/regression detection: compares each entity's recent runs against its earlier ones.

    Plain statistics over synced data — no LLM call, so it is safe to run on every filter change.
    """
    p = resolve_period(period)
    kwargs = {
        "regression_multiplier": multiplier if multiplier is not None else DEFAULT_REGRESSION_MULTIPLIER,
        "min_current_sec": minDurationSec if minDurationSec is not None else DEFAULT_MIN_CURRENT_SEC,
        "row_growth_multiplier": (
            rowGrowthMultiplier if rowGrowthMultiplier is not None else DEFAULT_ROW_GROWTH_MULTIPLIER
        ),
    }
    result, entry = _drilldown(
        source_id,
        lambda c, f, s: regression.detect_regressions(c, f, s, period=p, level=level, **kwargs),
    )
    return {
        "status": "success", "source_id": source_id, "source_type": entry["source_type"],
        **describe_period(p), **result,
    }
