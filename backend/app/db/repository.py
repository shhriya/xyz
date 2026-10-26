import logging
from app.db.migrations import upgrade_database
from app.db.session import SessionLocal, is_connection_dropped, retry_on_disconnect
from app.db.models import (
    ProjectModel,
    UploadedFileModel,
    MetadataModel,
    PromptConfigModel,
    MigrationRunModel,
    DbtGeneratedFileModel
)

logger = logging.getLogger("uvicorn.error")

def init_db():
    """Bring the database schema up to date. Raises if the database is unreachable."""
    upgrade_database()

@retry_on_disconnect
def ensure_project(project_id: str = "default_project"):
    """Create the project row if missing (all other tables reference it by foreign key)."""
    with SessionLocal() as db:
        if not db.get(ProjectModel, project_id):
            db.add(ProjectModel(id=project_id))
            db.commit()

@retry_on_disconnect
def seed_initial_state_if_empty(initial_state: dict, project_id: str = "default_project"):
    """Seeds the initial/default project state into the database if not present, and updates missing file content."""
    db = SessionLocal()
    try:
        project = db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project:
            logger.info(f"Seeding project '{project_id}' into database...")
            project = ProjectModel(
                id=project_id,
                name="r_data_modernization",
                source_type=initial_state.get("connection_type", "Snowflake SQL"),
                connection_details=initial_state.get("connection_details", {}),
                source_connected=initial_state.get("source_connected", False)
            )
            db.add(project)
            db.flush()

            # Seed Step 1: Uploaded files
            for f in initial_state.get("uploaded_files", []):
                file_content = f.get("content") or f.get("rawContent") or f.get("raw_content") or ""
                uf = UploadedFileModel(
                    id=f.get("id", f"file-{f.get('filename')}"),
                    project_id=project_id,
                    filename=f.get("filename", "unknown"),
                    source_type=f.get("sourceType", "Informatica PowerCenter"),
                    file_size=f.get("fileSize", "0 KB"),
                    upload_time=f.get("uploadTime", ""),
                    parse_status=f.get("parseStatus", "Parsed"),
                    raw_content=file_content
                )
                db.add(uf)

            # Seed Step 2: Metadata
            meta = initial_state.get("metadata", {})
            db_meta = MetadataModel(
                project_id=project_id,
                summary=meta.get("summary", {}),
                workflows=meta.get("workflows", []),
                mappings=meta.get("mappings", []),
                tables=meta.get("tables", [])
            )
            db.add(db_meta)

            # Seed Step 3: Prompts
            db_prompts = PromptConfigModel(
                project_id=project_id,
                system_prompt=initial_state.get("system_prompt", ""),
                prompts=initial_state.get("prompts", []),
                rules=initial_state.get("prompt_rules", {})
            )
            db.add(db_prompts)

            # Seed Step 5: Default dbt files (if any in store)
            dbt_files = initial_state.get("dbt_files", {})
            for path, content in dbt_files.items():
                layer = path.split("/")[1] if path.startswith("models/") and "/" in path[7:] else "models"
                df = DbtGeneratedFileModel(
                    project_id=project_id,
                    file_path=path,
                    layer=layer,
                    content=content
                )
                db.add(df)

            db.commit()
            logger.info(" Database seeded successfully.")
        else:
            # Sync any missing or empty file contents from initial_state
            for f in initial_state.get("uploaded_files", []):
                fid = f.get("id", f"file-{f.get('filename')}")
                fname = f.get("filename", "unknown")
                file_content = f.get("content") or f.get("rawContent") or f.get("raw_content") or ""
                if not file_content:
                    continue
                db_file = db.query(UploadedFileModel).filter(
                    (UploadedFileModel.project_id == project_id) & 
                    ((UploadedFileModel.id == fid) | (UploadedFileModel.filename == fname))
                ).first()
                if db_file:
                    if not db_file.raw_content:
                        db_file.raw_content = file_content
                else:
                    new_uf = UploadedFileModel(
                        id=fid,
                        project_id=project_id,
                        filename=fname,
                        source_type=f.get("sourceType", "Apache Spark / PySpark"),
                        file_size=f.get("fileSize", "10 KB"),
                        upload_time=f.get("uploadTime", ""),
                        parse_status=f.get("parseStatus", "Parsed"),
                        raw_content=file_content
                    )
                    db.add(new_uf)
            db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error seeding database: {e}")
    finally:
        db.close()

@retry_on_disconnect
def save_step1_source(source_type: str, connection_details: dict, uploaded_files: list, project_id: str = "default_project"):
    """Step 1: Save source connection & uploaded file records."""
    db = SessionLocal()
    try:
        project = db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project:
            project = ProjectModel(id=project_id)
            db.add(project)
        
        project.source_type = source_type
        project.connection_details = connection_details
        project.source_connected = True

        # Clear and re-add uploaded files
        db.query(UploadedFileModel).filter(UploadedFileModel.project_id == project_id).delete()
        for f in uploaded_files:
            file_content = f.get("content") or f.get("rawContent") or f.get("raw_content") or ""
            uf = UploadedFileModel(
                id=f.get("id", f"file-{f.get('filename')}"),
                project_id=project_id,
                filename=f.get("filename", f.get("name", "unknown")),
                source_type=f.get("sourceType", source_type),
                file_size=f.get("fileSize", f.get("size", "0 KB")),
                upload_time=f.get("uploadTime", ""),
                parse_status=f.get("parseStatus", "Parsed"),
                raw_content=file_content
            )
            db.add(uf)
        db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error saving Step 1 source data: {e}")
    finally:
        db.close()

@retry_on_disconnect
def save_step2_metadata(summary: dict, workflows: list, mappings: list, tables: list, project_id: str = "default_project"):
    """Step 2: Save parsed metadata, schemas, mappings, and tables."""
    db = SessionLocal()
    try:
        meta = db.query(MetadataModel).filter(MetadataModel.project_id == project_id).first()
        if not meta:
            meta = MetadataModel(project_id=project_id)
            db.add(meta)
        meta.summary = summary
        meta.workflows = workflows
        meta.mappings = mappings
        meta.tables = tables
        db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error saving Step 2 metadata: {e}")
    finally:
        db.close()

@retry_on_disconnect
def save_step3_prompts(prompts: list, rules: dict = None, system_prompt: str = None, project_id: str = "default_project"):
    """Step 2/3: Save prompt configuration and transformation rules."""
    db = SessionLocal()
    try:
        p_cfg = db.query(PromptConfigModel).filter(PromptConfigModel.project_id == project_id).first()
        if not p_cfg:
            p_cfg = PromptConfigModel(project_id=project_id)
            db.add(p_cfg)
        p_cfg.prompts = prompts
        if rules is not None:
            p_cfg.rules = rules
        if system_prompt is not None:
            p_cfg.system_prompt = system_prompt
        db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error saving Step 3 prompts: {e}")
    finally:
        db.close()

@retry_on_disconnect
def save_step3_target_config(config: dict, project_id: str = "default_project"):
    """Step 3: Persist target warehouse credentials, feature flags, variables and predictions."""
    db = SessionLocal()
    try:
        p_cfg = db.query(PromptConfigModel).filter(PromptConfigModel.project_id == project_id).first()
        if not p_cfg:
            p_cfg = PromptConfigModel(project_id=project_id)
            db.add(p_cfg)
        
        current_rules = p_cfg.rules or {}
        if isinstance(current_rules, dict):
            current_rules["migrationConfig"] = config
        else:
            current_rules = {"migrationConfig": config}
        
        p_cfg.rules = current_rules
        db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error saving Step 3 target config: {e}")
    finally:
        db.close()

@retry_on_disconnect
def get_step3_target_config(project_id: str = "default_project") -> dict:
    """Step 3: Retrieve saved target config from database."""
    db = SessionLocal()
    try:
        p_cfg = db.query(PromptConfigModel).filter(PromptConfigModel.project_id == project_id).first()
        if p_cfg and p_cfg.rules and isinstance(p_cfg.rules, dict):
            return p_cfg.rules.get("migrationConfig", {})
        return {}
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        logger.error(f"Error retrieving Step 3 target config: {e}")
        return {}
    finally:
        db.close()

@retry_on_disconnect
def save_step4_migration(status: str, progress: int, logs: list, summary: dict, run_id: str = "latest_run", project_id: str = "default_project"):
    """Step 4: Save migration execution logs and test validation scores."""
    db = SessionLocal()
    try:
        run = db.query(MigrationRunModel).filter(MigrationRunModel.id == run_id).first()
        if not run:
            run = MigrationRunModel(id=run_id, project_id=project_id)
            db.add(run)
        run.status = status
        run.progress = progress
        run.logs = logs
        run.summary = summary
        db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error saving Step 4 migration run: {e}")
    finally:
        db.close()

@retry_on_disconnect
def clear_step5_dbt_files(project_id: str = "default_project"):
    """Step 5: Remove all dbt generated files for fresh generation."""
    db = SessionLocal()
    try:
        db.query(DbtGeneratedFileModel).filter(DbtGeneratedFileModel.project_id == project_id).delete()
        db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error clearing Step 5 dbt files: {e}")
    finally:
        db.close()

@retry_on_disconnect
def save_step5_dbt_file(file_path: str, content: str, project_id: str = "default_project"):
    """Step 5: Save or update generated dbt SQL / YML files."""
    db = SessionLocal()
    try:
        df = db.query(DbtGeneratedFileModel).filter(
            DbtGeneratedFileModel.project_id == project_id,
            DbtGeneratedFileModel.file_path == file_path
        ).first()
        layer = file_path.split("/")[1] if file_path.startswith("models/") and "/" in file_path[7:] else "models"
        if not df:
            df = DbtGeneratedFileModel(project_id=project_id, file_path=file_path, layer=layer, content=content)
            db.add(df)
        else:
            df.content = content
            df.layer = layer
        db.commit()
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        db.rollback()
        logger.error(f"Error saving Step 5 dbt file {file_path}: {e}")
    finally:
        db.close()

@retry_on_disconnect
def get_step5_dbt_files(project_id: str = "default_project") -> dict:
    """Step 5: Retrieve all dbt files saved in database."""
    db = SessionLocal()
    try:
        files = db.query(DbtGeneratedFileModel).filter(DbtGeneratedFileModel.project_id == project_id).all()
        return {f.file_path: f.content for f in files}
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        logger.error(f"Error reading Step 5 dbt files: {e}")
        return {}
    finally:
        db.close()

@retry_on_disconnect
def load_full_state(project_id: str = "default_project") -> dict:
    """Load entire project state across Steps 1 to 5 from the database."""
    db = SessionLocal()
    try:
        project = db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project:
            return None
        
        uploaded_files = [
            {
                "id": uf.id,
                "filename": uf.filename,
                "name": uf.filename,
                "sourceType": uf.source_type,
                "fileSize": uf.file_size,
                "uploadTime": uf.upload_time,
                "parseStatus": uf.parse_status,
                "rawContent": uf.raw_content,
                "content": uf.raw_content
            }
            for uf in project.uploaded_files
        ]

        metadata = {}
        if project.metadata_record:
            metadata = {
                "summary": project.metadata_record.summary or {},
                "workflows": project.metadata_record.workflows or [],
                "mappings": project.metadata_record.mappings or [],
                "tables": project.metadata_record.tables or []
            }

        prompts = []
        rules = {}
        if project.prompt_config:
            prompts = project.prompt_config.prompts or []
            rules = project.prompt_config.rules or {}

        dbt_files = {f.file_path: f.content for f in project.dbt_files}

        return {
            "source_connected": project.source_connected,
            "connection_type": project.source_type,
            "connection_details": project.connection_details or {},
            "uploaded_files": uploaded_files,
            "metadata": metadata,
            "prompts": prompts,
            "prompt_rules": rules,
            "dbt_files": dbt_files
        }
    except Exception as e:
        if is_connection_dropped(e):
            raise  # let @retry_on_disconnect reconnect
        logger.error(f"Error loading full state from database: {e}")
        return None
    finally:
        db.close()
