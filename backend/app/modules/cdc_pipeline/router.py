"""CDC Pipeline API: source/target connection tests, AI table analysis, pipeline config, runs.

Long-running work (the data movement) happens in a background thread started by POST /run;
the UI polls GET /status for live per-table progress and GET /history for past runs.
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException, Query

from app.modules.cloud_modernization.router import get_active_gemini_key

from . import connectors, service
from .service import CdcError

router = APIRouter(prefix="/api/cdc", tags=["cdc_pipeline"])


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except CdcError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _source(payload: Dict[str, Any]) -> Dict[str, Any]:
    return payload.get("source") or payload


def _with_stored_passwords(payload: Dict[str, Any]) -> Dict[str, Any]:
    """The UI never gets stored secrets back, so a blank one means "use the saved one"."""
    stored = service.get_pipeline(payload.get("pipelineId"), masked=False) if payload.get("pipelineId") else None
    out = dict(payload)
    for side in ("source", "target"):
        out[side] = service.merge_stored_secrets(out.get(side) or {}, (stored or {}).get(side))
    return out


@router.get("/connectors")
def list_connectors():
    """Every database that can be a source or a target, with the form fields each one needs."""
    return {"status": "success", "connectors": connectors.public_registry()}


@router.post("/source/test")
def test_source(payload: Dict[str, Any] = Body(...)):
    p = _with_stored_passwords(payload)
    result = _call(service.test_source, p["source"])
    return {"status": "success", "message": f"Connected to {result['label']} — found {result['tableCount']} tables.", **result}


@router.post("/source/connect")
def connect_source(payload: Dict[str, Any] = Body(...)):
    p = _with_stored_passwords(payload)
    tables = _call(service.describe_source, p["source"])
    return {"status": "success", "tables": tables}


@router.post("/target/connect")
def connect_target(payload: Dict[str, Any] = Body(...)):
    p = _with_stored_passwords(payload)
    result = _call(service.test_target, p["target"])
    note = "" if result["schemaExists"] else " The target schema doesn't exist yet — it will be created on the first run."
    return {"status": "success", "message": f"Connected to {result['label']}.{note}", **result}


@router.post("/analyze")
def analyze(payload: Dict[str, Any] = Body(...)):
    p = _with_stored_passwords(payload)
    source = p["source"]
    tables = _call(service.describe_source, source)
    wanted = {t.lower() for t in (payload.get("tables") or [])}
    if wanted:
        tables = [t for t in tables if t["name"].lower() in wanted]
    result = _call(service.analyze_tables, service._label(source), tables, get_active_gemini_key(),
                   service._label(p.get("target") or {}) if (p.get("target") or {}).get("type") else "the target warehouse")
    return {"status": "success", **result}


from app.core.scheduler import schedule_pipeline, unschedule_pipeline

@router.post("/config")
def save_config(payload: Dict[str, Any] = Body(...)):
    pipeline = _call(service.save_pipeline, payload)
    
    if pipeline.get("scheduleEnabled") and pipeline.get("schedule"):
        schedule_pipeline(pipeline["id"], pipeline["schedule"])
    else:
        unschedule_pipeline(pipeline["id"])
        
    return {"status": "success", "pipeline": pipeline}


@router.get("/config")
def get_config(pipelineId: Optional[str] = Query(None)):
    pipeline = service.get_pipeline(pipelineId)
    return {"status": "success", "pipeline": pipeline,
            "checkpoints": service.checkpoints(pipeline["id"]) if pipeline else {}}


@router.post("/run")
def run(payload: Dict[str, Any] = Body(...)):
    pipeline_id = payload.get("pipelineId")
    if not pipeline_id:
        raise HTTPException(status_code=400, detail="pipelineId is required — save the configuration first.")
    try:
        status = service.start_run(pipeline_id)
    except CdcError as e:
        code = 409 if "already in progress" in str(e) else 400
        raise HTTPException(status_code=code, detail=str(e))
    return {"status": "success", "run": status}


@router.get("/status")
def status(pipelineId: str = Query(...)):
    return {"status": "success", "run": service.run_status(pipelineId)}


@router.get("/history")
def history(pipelineId: str = Query(...), limit: int = Query(20, ge=1, le=100)):
    return {"status": "success", "runs": service.run_history(pipelineId, limit),
            "checkpoints": service.checkpoints(pipelineId)}


@router.post("/checkpoints/reset")
def reset(payload: Dict[str, Any] = Body(...)):
    """Forget what was loaded (all tables, or one) so the next run reloads from the beginning."""
    if not payload.get("pipelineId"):
        raise HTTPException(status_code=400, detail="pipelineId is required.")
    n = service.reset_checkpoints(payload["pipelineId"], payload.get("table"))
    return {"status": "success", "reset": n}
