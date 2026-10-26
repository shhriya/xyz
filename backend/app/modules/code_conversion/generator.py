import logging
import shutil
from typing import Dict, Any, List, Optional

from app.db import repository as db_service
from app.modules.code_conversion.skills_engine import skill_engine, SkillPipelineEngine, SkillDefinition
from app.services.dbt_workspace import GIT_SKIP_DIRS, IDE_PROJECT_DIR

logger = logging.getLogger("uvicorn.error")


def generate_dbt_project_from_metadata(state: Dict[str, Any], api_key: Optional[str] = None) -> Dict[str, str]:
    """
    Generates a full, structured dbt project (Bronze, Silver, Gold, Snapshots, Macros, Docs, Schema YAML)
    using the AI Skill Engine pipeline.

    `api_key` (optional) enables the AI-based legacy-script transpiler inside the pipeline for
    Python-shaped source files — see SkillPipelineEngine.execute_skills_pipeline.
    """
    try:
        skills_data = state.get("skills")
        if skills_data and isinstance(skills_data, list):
            skills = [SkillDefinition(**s) if isinstance(s, dict) else s for s in skills_data]
            engine = SkillPipelineEngine(skills)
            return engine.execute_skills_pipeline(state, api_key=api_key)
        return skill_engine.execute_skills_pipeline(state, api_key=api_key)
    except Exception as e:
        logger.warning(f"Skill engine execution fallback: {e}")
        return skill_engine.execute_skills_pipeline(state, api_key=api_key)


def write_and_persist_dbt_project(generated_files: Dict[str, str], project_id: str = "default_project") -> List[str]:
    """
    Writes all generated files to:
      1. Local disk directory (dbt_output/) for Monaco Editor IDE file tree
      2. The application database (dbt_generated_files table)
    """
    written_paths = []
    IDE_PROJECT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Clean previous files from disk
    for item in IDE_PROJECT_DIR.iterdir():
        if item.name in GIT_SKIP_DIRS:
            continue
        try:
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
        except Exception:
            pass

    # 2. Clean previous files from the database
    try:
        db_service.clear_step5_dbt_files(project_id=project_id)
    except Exception as e:
        logger.warning(f"Could not clear previous dbt files from the database: {e}")

    # 3. Write new files to disk and DB
    for rel_path, content in generated_files.items():
        full_path = IDE_PROJECT_DIR / rel_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")
        written_paths.append(rel_path)

        try:
            db_service.save_step5_dbt_file(rel_path, content, project_id=project_id)
        except Exception as e:
            logger.warning(f"Could not persist {rel_path} to the database: {e}")

    logger.info(f"Generated and persisted {len(written_paths)} dbt files to disk and the database.")
    return written_paths
