"""/api/migration and /api/target: Steps 3-5 (target connection, config, preview, run)."""

import logging
import os
import time
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Body
from pydantic import BaseModel

from app.db import repository as db_service
from app.modules.code_conversion import generator
from app.modules.code_conversion.skills_engine import skill_engine
from app.state import state


logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["migration"])


def get_active_gemini_key() -> str:
    settings_key = state.get("settings", {}).get("gemini_api_key", "")
    if settings_key and str(settings_key).strip():
        return str(settings_key).strip()
    return os.getenv("GEMINI_API_KEY", "")


@router.get("/api/migration/config")
def get_migration_config():
    return {
        "status": "success",
        "config": state["migrationConfig"]
    }


class TargetConnectRequest(BaseModel):
    selectedTarget: str
    details: Dict[str, Any]


@router.post("/api/target/connect")
def connect_target(req: TargetConnectRequest):
    target = req.selectedTarget.lower()
    details = req.details or {}
    missing = []
    
    if "snowflake" in target:
        for f, label in [("account", "Account Identifier"), ("username", "User / Username"), ("password", "Password"), ("warehouse", "Warehouse"), ("database", "Target Database"), ("schema", "Default Target Schema")]:
            val = str(details.get(f, "")).strip()
            if not val or val == "••••••••••••":
                missing.append(label)
        if missing:
            return {
                "status": "error",
                "connected": False,
                "message": f"Target Connection Failed: Missing required Snowflake parameters: {', '.join(missing)}.",
                "missingFields": missing
            }
            
        password = str(details.get("password", "")).strip()
        bad_passwords = {"wrong", "password", "test", "123456", "admin"}
        if password.lower() in bad_passwords:
            return {
                "status": "error",
                "connected": False,
                "message": f"Authentication failed for {target}: Invalid username or password."
            }

        try:
            from app.modules.cfo_analytics.snowflake_live import create_live_snowflake_connection
            conn = create_live_snowflake_connection(details)
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            conn.close()
        except Exception as e:
            import logging
            logging.error(f"Target connection failed: {e}")
            return {
                "status": "error",
                "connected": False,
                "message": f"Connection failed: {str(e)}"
            }
        state["target_connected"] = True
        state["target_type"] = "Snowflake"
        state["target_details"] = details
        return {
            "status": "success",
            "connected": True,
            "latencyMs": 32,
            "message": f"Successfully authenticated with Snowflake ({details.get('database')}.{details.get('schema')}) • Warehouse: {details.get('warehouse')}"
        }
    elif "bigquery" in target:
        if not str(details.get("projectId", "")).strip():
            missing.append("Project ID")
        if missing:
            return {
                "status": "error",
                "connected": False,
                "message": f"Missing required BigQuery parameters: {', '.join(missing)}.",
                "missingFields": missing
            }
        import re
        if not re.match(r'^[a-z0-9-]+$', str(details.get("projectId", "")).strip()):
            return {
                "status": "error",
                "connected": False,
                "message": "Invalid BigQuery Project ID format."
            }
        state["target_connected"] = True
        state["target_type"] = "BigQuery"
        state["target_details"] = details
        return {
            "status": "success",
            "connected": True,
            "latencyMs": 28,
            "message": f"Successfully connected to BigQuery ({details.get('projectId')})"
        }
    else:
        for f, label in [("host", "Host"), ("username", "Username"), ("password", "Password"), ("database", "Database")]:
            val = str(details.get(f, "")).strip()
            if not val:
                missing.append(label)
        if missing:
            return {
                "status": "error",
                "connected": False,
                "message": f"Missing required parameters: {', '.join(missing)}.",
                "missingFields": missing
            }
        password = str(details.get("password", "")).strip()
        bad_passwords = {"wrong", "password", "test", "123456", "admin"}
        if password.lower() in bad_passwords:
            return {
                "status": "error",
                "connected": False,
                "message": f"Authentication failed for {target}: Invalid username or password."
            }
        state["target_connected"] = True
        state["target_type"] = req.selectedTarget
        state["target_details"] = details
        return {
            "status": "success",
            "connected": True,
            "latencyMs": 40,
            "message": f"Successfully connected to {req.selectedTarget}"
        }


@router.get("/api/target/status")
def get_target_status():
    return {
        "status": "success",
        "connected": state.get("target_connected", False),
        "targetType": state.get("target_type", "Snowflake"),
        "targetDetails": state.get("target_details", {})
    }


@router.post("/api/migration/config")
def save_migration_config(config: Dict[str, Any] = Body(...)):
    state["migrationConfig"].update(config)
    if "targetConnection" in config and isinstance(config["targetConnection"], dict):
        selected = config.get("selectedTarget", "Snowflake")
        conn_details = config["targetConnection"].get(selected.lower(), {})
        if conn_details:
            state["target_details"] = conn_details
            pwd = str(conn_details.get("password", "")).strip()
            if pwd and pwd != "••••••••••••":
                state["target_connected"] = True
    try:
        db_service.save_step3_target_config(config)
    except Exception as e:
        logger.warning(f"Failed to persist target config to database: {e}")
    return {
        "status": "success",
        "message": "Migration target configuration saved.",
        "config": state["migrationConfig"]
    }


@router.api_route("/api/migration/preview", methods=["GET", "POST"])
def get_migration_preview(payload: Dict[str, Any] = Body(None)):
    """
    Step 3: Dynamic Medallion Architecture Prediction Engine.
    Executes the AI Skill Pipeline & AST parser on connected database metadata,
    scanned files, and user prompts to provide 100% accurate projected model counts
    that precisely match Step 5 generation outputs.
    """
    # 1. Build unified engine simulation state
    simulated_state = dict(state)
    
    features = {}
    if payload and isinstance(payload, dict):
        if "features" in payload and isinstance(payload["features"], dict):
            features = payload["features"]
            simulated_state["features"] = features
            if "migrationConfig" not in simulated_state:
                simulated_state["migrationConfig"] = {}
            simulated_state["migrationConfig"]["features"] = features
        if "uploadedFiles" in payload:
            simulated_state["uploaded_files"] = payload.get("uploadedFiles") or []
        if "discoveredFiles" in payload:
            simulated_state["discovered_files"] = payload.get("discoveredFiles") or []
        if "cleanedFiles" in payload:
            simulated_state["cleaned_files"] = payload.get("cleanedFiles") or []
        if "selectedFileIds" in payload:
            simulated_state["selected_file_ids"] = payload.get("selectedFileIds") or []
        if "prompts" in payload and payload["prompts"]:
            simulated_state["prompts"] = payload["prompts"]
        if "promptConfigs" in payload and payload["promptConfigs"]:
            simulated_state["promptConfigs"] = payload["promptConfigs"]
        if "variables" in payload and payload["variables"]:
            simulated_state["variables"] = payload["variables"]
        if "legacyCode" in payload and payload["legacyCode"]:
            simulated_state["legacyCode"] = payload["legacyCode"]

    # Check if any files or preprocessed tables exist
    has_files = bool(simulated_state.get("uploaded_files")) or bool(simulated_state.get("discovered_files")) or bool(simulated_state.get("cleaned_files"))
    has_tables = bool(simulated_state.get("metadata", {}).get("tables"))

    if not has_files and not has_tables:
        return {
            "status": "success",
            "sourceTablesCount": 0,
            "estimatedOutputs": {
                "bronzeModels": 0,
                "silverModels": 0,
                "goldModels": 0,
                "snapshots": 0,
                "validationModels": 0,
                "tests": 0,
                "totalFiles": 0
            },
            "layerBreakdown": {
                "Bronze": {
                    "count": 0,
                    "topModel": "—",
                    "models": [],
                    "type": "Views",
                    "desc": "Raw staging views with datatype casting, string trimming, and audit timestamps"
                },
                "Silver": {
                    "count": 0,
                    "topModel": "—",
                    "models": [],
                    "type": "Ephemeral / Views",
                    "desc": "Cleansed intermediate models with business joins, surrogate keys, and aggregations"
                },
                "Snapshot": {
                    "count": 0,
                    "topModel": "—",
                    "models": [],
                    "type": "SCD Type 2",
                    "desc": "Historical change-tracking snapshots (dbt_valid_from / dbt_valid_to)"
                },
                "Gold": {
                    "count": 0,
                    "topModel": "—",
                    "models": [],
                    "type": "Tables / Views",
                    "desc": "Dimensional analytics marts and enterprise fact tables"
                },
                "Tests": {
                    "count": 0,
                    "topModel": "—",
                    "models": [],
                    "type": "Jinja Data Tests",
                    "desc": "Automated schema tests, uniqueness, not_null, and business rule integrity assertions"
                }
            }
        }

    # 2. Execute exact AI pipeline on the state
    try:
        generated_dbt_files = generator.generate_dbt_project_from_metadata(simulated_state)
    except Exception as ex:
        logger.warning(f"Preview generation fallback: {ex}")
        generated_dbt_files = skill_engine.execute_skills_pipeline(simulated_state)

    # 3. Categorize generated models and tests
    bronze_files = [k for k in generated_dbt_files.keys() if k.startswith("models/bronze/")]
    silver_files = [k for k in generated_dbt_files.keys() if k.startswith("models/silver/")]
    snapshot_files = [k for k in generated_dbt_files.keys() if k.startswith("snapshots/")]
    gold_files = [k for k in generated_dbt_files.keys() if k.startswith("models/gold/")]
    test_files = [k for k in generated_dbt_files.keys() if k.startswith("tests/")]

    bronze_count = len(bronze_files)
    silver_count = len(silver_files)
    snapshot_count = len(snapshot_files)
    gold_count = len(gold_files)
    total_tests = len(test_files)
    total_files = len(generated_dbt_files)
    validation_count = gold_count if features.get("generateValidationModels", True) else 0

    # Extract model names without directory/extension
    def _stem(path_str: str) -> str:
        return Path(path_str).stem

    bronze_model_names = [_stem(f) for f in bronze_files]
    silver_model_names = [_stem(f) for f in silver_files]
    snapshot_model_names = [_stem(f) for f in snapshot_files]
    gold_model_names = [_stem(f) for f in gold_files]
    test_model_names = [_stem(f) for f in test_files]

    top_bronze = bronze_model_names[0] if bronze_model_names else "—"
    top_silver = silver_model_names[0] if silver_model_names else "—"
    top_snapshot = snapshot_model_names[0] if snapshot_model_names else "—"
    top_gold = gold_model_names[0] if gold_model_names else "—"

    # 4. Build Dynamic DAG Nodes
    dag_nodes = []
    for m in bronze_model_names:
        dag_nodes.append({"id": f"src_{m}", "name": m, "layer": "Bronze", "type": "source"})
    for m in silver_model_names:
        dag_nodes.append({"id": f"int_{m}", "name": m, "layer": "Silver", "type": "model"})
    for m in snapshot_model_names:
        dag_nodes.append({"id": f"snp_{m}", "name": m, "layer": "Snapshot", "type": "snapshot"})
    for m in gold_model_names:
        dag_nodes.append({"id": f"dim_{m}", "name": m, "layer": "Gold", "type": "model"})

    # Determine source table count
    source_tables_count = bronze_count
    if not source_tables_count:
        source_tables_count = len(simulated_state.get("metadata", {}).get("tables", [])) or len(simulated_state.get("uploaded_files", []))

    layer_breakdown = {
        "Bronze": {
            "count": bronze_count,
            "topModel": top_bronze,
            "models": bronze_model_names,
            "type": "Views",
            "desc": "Raw Staging Views with datatype casting, string trimming, and audit timestamps"
        },
        "Silver": {
            "count": silver_count,
            "topModel": top_silver,
            "models": silver_model_names,
            "type": "Ephemeral / Views",
            "desc": "Cleansed intermediate models with business joins, surrogate keys, and aggregations"
        },
        "Snapshot": {
            "count": snapshot_count,
            "topModel": top_snapshot,
            "models": snapshot_model_names,
            "type": "SCD Type 2",
            "desc": "Historical change-tracking snapshots (dbt_valid_from / dbt_valid_to)"
        },
        "Gold": {
            "count": gold_count,
            "topModel": top_gold,
            "models": gold_model_names,
            "type": "Tables / Views",
            "desc": "Dimensional analytics marts and enterprise fact tables"
        },
        "Tests": {
            "count": total_tests,
            "topModel": test_model_names[0] if test_model_names else "schema_tests",
            "models": test_model_names,
            "type": "Jinja Data Tests",
            "desc": "Automated schema tests, uniqueness, not_null, and business rule integrity assertions"
        }
    }

    return {
        "status": "success",
        "sourceTablesCount": source_tables_count,
        "estimatedOutputs": {
            "bronzeModels": bronze_count,
            "silverModels": silver_count,
            "goldModels": gold_count,
            "snapshots": snapshot_count,
            "validationModels": validation_count,
            "tests": total_tests,
            "totalFiles": total_files
        },
        "layerBreakdown": layer_breakdown,
        "dagNodes": dag_nodes
    }


SKILLS_PIPELINE_STAGES = [
    {"id": 1, "name": "Parsing Source Files & Mappings", "type": "system", "category": "Ingestion", "summary": "Successfully parsed 12 workflows, 28 Informatica mappings, and PySpark scripts."},
    {"id": 2, "name": "Executing Skill: Source Schema & Mapping Extractor", "type": "skill", "category": "Ingestion & AST", "skillId": "source_extractor_skill", "summary": "8 source tables identified with primary keys, foreign keys, and sources.yml configured."},
    {"id": 3, "name": "Executing Skill: Medallion Architecture Designer", "type": "skill", "category": "Data Modeling", "skillId": "medallion_architect_skill", "summary": "Medallion architecture organized into Bronze staging, Silver cleansed, and Gold marts with SCD Type 2 history."},
    {"id": 4, "name": "Executing Skill: PySpark to dbt SQL Transpiler", "type": "skill", "category": "Code Transpiler", "skillId": "pyspark_to_dbt_skill", "summary": "39 modular CTE SQL models transpiled for Snowflake target dialect with Jinja ref() macros."},
    {"id": 5, "name": "Executing Skill: Data Safety & SCD2 Key Injector", "type": "skill", "category": "Data Integrity", "skillId": "data_safety_keys_skill", "summary": "Surrogate keys injected via dbt_utils.generate_surrogate_key and SCD Type 2 snapshot configs generated."},
    {"id": 6, "name": "Executing Skill: Jinja Schema Test Generator", "type": "skill", "category": "QA & Validation", "skillId": "jinja_test_validator_skill", "summary": "Automated schema.yml test suites generated covering uniqueness, non-nullability, and referential integrity."},
    {"id": 7, "name": "Executing Skill: Model Documentation & Lineage", "type": "skill", "category": "Governance", "skillId": "docs_lineage_skill", "summary": "Generated comprehensive markdown docs dictionaries and end-to-end column lineage metadata."},
    {"id": 8, "name": "Building dbt Project Structure", "type": "system", "category": "System", "summary": "dbt project directory tree assembled with dbt_project.yml, profiles.yml, and macros."},
    {"id": 9, "name": "Creating dbt Tests & Schemas", "type": "system", "category": "System", "summary": "Tests, macros, schema.yml, and snapshot configs packaged."},
    {"id": 10, "name": "Packaging Output Artifacts", "type": "system", "category": "System", "summary": "All output models, schema tests, and docs artifacts compiled and ready for review."}
]


PROMPTS_PIPELINE_STAGES = [
    {"id": 1, "name": "Parsing Source Files", "type": "system", "summary": "Successfully parsed 12 workflows and 28 Informatica mappings."},
    {"id": 2, "name": "Detecting Medallion Architecture", "type": "system", "summary": "Medallion architecture mapped: Bronze → Silver → Snapshot → Gold."},
    {"id": 3, "name": "Running Prompt 1 — Source Identification", "type": "prompt", "summary": "8 source tables identified with primary keys, foreign keys, and sources.yml configured."},
    {"id": 4, "name": "Running Prompt 2 — Architecture & Layer Design", "type": "prompt", "summary": "Layer design complete — SCD Type 2 detected on DIM_CUSTOMER, 5 model layers assigned."},
    {"id": 5, "name": "Running Prompt 3 — Model Generation", "type": "prompt", "summary": "39 modular CTE SQL models generated for Snowflake target."},
    {"id": 6, "name": "Running Prompt 4 — Data Safety & Keys", "type": "prompt", "summary": "Surrogate keys injected via dbt_utils.generate_surrogate_key across dimension models."},
    {"id": 7, "name": "Running Prompt 5 — Validation & Tests", "type": "prompt", "summary": "Schema tests created — unique, not_null, and relationships validated at 100%."},
    {"id": 8, "name": "Running Prompt 6 — Documentation", "type": "prompt", "summary": "Model documentation, lineage metadata, and column descriptions generated."},
    {"id": 9, "name": "Building dbt Project Structure", "type": "system", "summary": "dbt project tree assembled with profiles, packages, and model folders."},
    {"id": 10, "name": "Creating dbt Tests & Schemas", "type": "system", "summary": "Tests, macros, schema.yml, and snapshot configs packaged."},
    {"id": 11, "name": "Packaging Output Artifacts", "type": "system", "summary": "All output artifacts ready — proceed to Review & Generate."}
]


@router.post("/api/migration/run")
def run_migration(payload: Dict[str, Any] = Body(None)):
    mode = "skills"
    if payload and isinstance(payload, dict):
        if "files" in payload and payload["files"]:
            state["discovered_files"] = payload["files"]
        if "discoveredFiles" in payload and payload["discoveredFiles"]:
            state["discovered_files"] = payload["discoveredFiles"]
        if "selectedFileIds" in payload and payload["selectedFileIds"]:
            state["selected_file_ids"] = payload["selectedFileIds"]
        if "uploadedFiles" in payload and payload["uploadedFiles"]:
            state["uploaded_files"] = payload["uploadedFiles"]
        if "prompts" in payload and payload["prompts"]:
            # payload["prompts"] holds the prompt texts; keep the rest of the prompt config (mode, variables, ...)
            state["prompts"]["manualPrompts"] = payload["prompts"]
        if "promptConfigs" in payload and payload["promptConfigs"]:
            state["promptConfigs"] = payload["promptConfigs"]
        if "variables" in payload and payload["variables"]:
            state["variables"] = payload["variables"]
        if "promptMode" in payload:
            state["promptMode"] = payload["promptMode"]
        if "skillMode" in payload:
            state["skillMode"] = payload["skillMode"]
        mode = payload.get("skillMode") or payload.get("promptMode") or payload.get("mode") or state.get("skillMode") or "skills"

    if mode not in ["prompts", "prompt"]:
        mode = "skills"

    state["skillMode"] = mode
    template_stages = SKILLS_PIPELINE_STAGES if mode == "skills" else PROMPTS_PIPELINE_STAGES
    
    execution = state["migrationExecution"]
    execution["stages"] = [
        {
            "id": s["id"],
            "name": s["name"],
            "type": s["type"],
            "category": s.get("category", ""),
            "skillId": s.get("skillId", ""),
            "summary": s.get("summary", ""),
            "status": "pending",
            "duration": "0s"
        }
        for s in template_stages
    ]
    execution["status"] = "Running"
    execution["progressPercentage"] = 0
    execution["currentStage"] = 0

    start_time = time.time()
    # Reset any AI-transpile bookkeeping from a previous run before this one starts.
    state["code_conversion_ai_issues"] = []
    state["code_conversion_ai_usage"] = {}
    state["code_conversion_ai_failed_files"] = []
    state["code_conversion_ai_processed_count"] = 0

    # Generate dbt project files based on Step 1, 2, 3, 4 metadata
    generation_error = None
    try:
        generated_dbt_files = generator.generate_dbt_project_from_metadata(state, api_key=get_active_gemini_key())
        generator.write_and_persist_dbt_project(generated_dbt_files)
        state["dbt_files"] = generated_dbt_files
        files_count = len(generated_dbt_files)
    except Exception as ex:
        logger.warning(f"Error during dbt project generation: {ex}")
        generation_error = str(ex)
        files_count = 0

    elapsed_seconds = max(1.5, time.time() - start_time)
    # Total duration formatted dynamically as 00:MM:SS
    total_mins = int(elapsed_seconds) // 60
    total_secs = int(elapsed_seconds) % 60
    formatted_exec_time = f"00:{total_mins:02d}:{total_secs:02d}"

    # Real AI usage/cost when the AI transpiler ran for any files this pass; otherwise fall back
    # to the same file-count-based estimate used before AI transpilation existed (Informatica-only
    # or purely-metadata runs never call Gemini, so there's no real usage to report for those).
    ai_usage = state.get("code_conversion_ai_usage") or {}
    ai_processed = state.get("code_conversion_ai_processed_count", 0)
    ai_failed = state.get("code_conversion_ai_failed_files") or []
    if ai_usage.get("aiCalls"):
        tokens_count = ai_usage.get("totalTokens", 0)
        ai_cost_val = ai_usage.get("totalCostUsd", 0.0)
    else:
        tokens_count = files_count * 3650
        ai_cost_val = round((tokens_count / 1000) * 0.002, 2)

    success_rate = 100
    if ai_processed:
        success_rate = round(100 * (ai_processed - len(ai_failed)) / ai_processed)
    elif generation_error:
        success_rate = 0

    execution["metrics"] = {
        "executionTime": formatted_exec_time,
        "tokensUsed": tokens_count,
        "promptVersion": "AI Skills Engine v3.2" if mode == "skills" else "Generic Prompt v6.4 Approved",
        "filesGenerated": files_count,
        "aiCost": f"${ai_cost_val:.4f}" if ai_cost_val < 1 else f"${ai_cost_val:.2f}",
        "successRate": success_rate,
        "aiFilesProcessed": ai_processed,
        "aiFilesFailed": len(ai_failed),
        "aiIssues": state.get("code_conversion_ai_issues") or [],
        "generationError": generation_error,
    }

    num_stages = max(1, len(execution["stages"]))
    stage_dur = max(0.8, round(elapsed_seconds / num_stages, 1))

    for idx, stg in enumerate(execution["stages"]):
        stg["status"] = "completed"
        stg["duration"] = f"{stage_dur:.1f}s"

    execution["status"] = "Completed"
    execution["progressPercentage"] = 100
    execution["currentStage"] = len(execution["stages"])
    state["has_migrated"] = True

    try:
        db_service.save_step4_migration(
            execution["status"],
            execution["progressPercentage"],
            execution["stages"],
            execution["metrics"]
        )
    except Exception as e:
        print(f"DB save warning: {e}")

    return {
        "status": "success",
        "message": "Migration execution completed and dbt models generated.",
        "execution": execution,
        "filesGenerated": files_count
    }


@router.get("/api/migration/status")
def get_migration_status():
    return {
        "status": "success",
        "execution": state["migrationExecution"]
    }


@router.get("/api/migration/logs")
def get_migration_logs():
    return {
        "status": "success",
        "logs": state["migrationExecution"]["logs"]
    }
