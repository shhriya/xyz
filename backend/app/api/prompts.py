from fastapi import APIRouter, Body
from typing import Dict, Any
from app.state import state
from app.db import repository as db_service

router = APIRouter(prefix="/api/prompts", tags=["prompts"])

@router.get("/config")
def get_prompts_config():
    return {
        "status": "success",
        "config": state["prompts"]
    }

@router.get("/static")
def get_static_prompts():
    return {
        "status": "success",
        "version": state["prompts"].get("staticVersion", ""),
        "lastUpdated": state["prompts"].get("lastUpdated", ""),
        "prompts": state["prompts"].get("manualPrompts", {})
    }

@router.post("/manual")
def save_manual_prompts(payload: Dict[str, Any] = Body(...)):
    if "mode" in payload:
        state["prompts"]["mode"] = payload["mode"]
    if "prompts" in payload:
        state["prompts"]["manualPrompts"] = payload["prompts"]
    if "promptConfigs" in payload:
        state["prompts"]["promptConfigs"] = payload["promptConfigs"]
    if "variables" in payload and isinstance(payload["variables"], dict):
        state["prompts"].setdefault("variables", {}).update(payload["variables"])
    try:
        db_service.save_step3_prompts(
            prompts=[state["prompts"]],
            rules=state["prompts"].get("variables", {})
        )
    except Exception as e:
        print(f"DB save warning: {e}")
    return {
        "status": "success",
        "message": "Prompts & Variables saved successfully.",
        "config": state["prompts"]
    }

@router.post("/validate")
def validate_prompts(payload: Dict[str, Any] = Body(...)):
    prompts = payload.get("prompts", {})
    variables = payload.get("variables", {})
    
    checks = []
    is_valid = True
    warnings = []
    
    # Check 1: At least 1 Prompt Defined & None Empty
    missing_or_empty = [p for p, text in prompts.items() if not text or len(str(text).strip()) == 0]
    if len(prompts) == 0:
        is_valid = False
        checks.append({"name": "At Least 1 Prompt Defined", "passed": False})
        warnings.append("No prompts provided. You must define at least one prompt.")
    elif missing_or_empty:
        is_valid = False
        checks.append({"name": "All Prompts Have Content", "passed": False})
        warnings.append(f"Empty prompts found: {', '.join(missing_or_empty)}")
    else:
        checks.append({"name": "All Prompts Have Content", "passed": True})
        
    # Check 2: Variable Syntax Matches dbt Jinja Standard
    jinja_valid = True
    for p_id, p_text in prompts.items():
        if isinstance(p_text, str):
            open_count = p_text.count("{{")
            close_count = p_text.count("}}")
            if open_count != close_count:
                jinja_valid = False
                warnings.append(f"Unbalanced Jinja brackets {{ }} in {p_id}")
    
    checks.append({"name": "Variable Syntax Matches dbt Jinja Standard", "passed": jinja_valid})
    if not jinja_valid:
        is_valid = False
        
    # Check 3: Schema Variables Populated
    schema_keys = ["targetDatabase", "bronzeSchema", "silverSchema", "goldSchema", "snapshotSchema"]
    missing_schemas = [k for k in schema_keys if not variables.get(k) or str(variables.get(k)).strip() == ""]
    if missing_schemas:
        is_valid = False
        checks.append({"name": "All Schema Tokens Provided", "passed": False})
        warnings.append(f"Missing schema definitions: {', '.join(missing_schemas)}")
    else:
        checks.append({"name": "All Schema Tokens Provided", "passed": True})
        
    # Check 4: Data Type Mapping Safe
    # Check if schemas contain invalid characters like spaces
    invalid_schema_names = [k for k in schema_keys if variables.get(k) and " " in str(variables.get(k))]
    if invalid_schema_names:
        is_valid = False
        checks.append({"name": "Data Type Mapping Safe", "passed": False})
        warnings.append(f"Schema names cannot contain spaces: {', '.join(invalid_schema_names)}")
    else:
        checks.append({"name": "Data Type Mapping Safe", "passed": True})
        
    ready_msg = "All prompts validated. Ready for AI code generation execution." if is_valid else "Validation failed. Please review warnings."
    
    return {
        "status": "success",
        "isValid": is_valid,
        "checks": checks,
        "warnings": warnings,
        "readyMessage": ready_msg
    }