import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base
from app.db.types import EncryptedJSON

class ProjectModel(Base):
    __tablename__ = "projects"

    id = Column(String(100), primary_key=True, default="default_project")
    name = Column(String(255), default="r_data_modernization")
    source_type = Column(String(100), default="Snowflake SQL")
    target_type = Column(String(100), default="Snowflake")
    connection_details = Column(EncryptedJSON, default=dict)  # holds source credentials
    source_connected = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    uploaded_files = relationship("UploadedFileModel", back_populates="project", cascade="all, delete-orphan")
    metadata_record = relationship("MetadataModel", back_populates="project", uselist=False, cascade="all, delete-orphan")
    prompt_config = relationship("PromptConfigModel", back_populates="project", uselist=False, cascade="all, delete-orphan")
    migration_runs = relationship("MigrationRunModel", back_populates="project", cascade="all, delete-orphan")
    dbt_files = relationship("DbtGeneratedFileModel", back_populates="project", cascade="all, delete-orphan")


class UploadedFileModel(Base):
    """Step 1: Uploaded legacy files (Informatica XML, PySpark, Oracle SQL)"""
    __tablename__ = "uploaded_files"

    id = Column(String(100), primary_key=True)
    project_id = Column(String(100), ForeignKey("projects.id"), default="default_project")
    filename = Column(String(255), nullable=False)
    source_type = Column(String(100), nullable=False)
    file_size = Column(String(50), default="0 KB")
    upload_time = Column(String(50), default="")
    parse_status = Column(String(50), default="Parsed")
    raw_content = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("ProjectModel", back_populates="uploaded_files")


class MetadataModel(Base):
    """Step 2: Parsed Workflows, Mappings, Tables, and Data Summaries"""
    __tablename__ = "project_metadata"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String(100), ForeignKey("projects.id"), unique=True, default="default_project")
    summary = Column(JSON, default=dict)
    workflows = Column(JSON, default=list)
    mappings = Column(JSON, default=list)
    tables = Column(JSON, default=list)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    project = relationship("ProjectModel", back_populates="metadata_record")


class PromptConfigModel(Base):
    """Step 3: Migration Prompts, LLM Rules, and Medallion Settings"""
    __tablename__ = "prompt_configurations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String(100), ForeignKey("projects.id"), unique=True, default="default_project")
    system_prompt = Column(Text, default="")
    prompts = Column(JSON, default=list)
    rules = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    project = relationship("ProjectModel", back_populates="prompt_config")


class MigrationRunModel(Base):
    """Step 4: Execute Migration Runs, Execution Logs, Validation Results"""
    __tablename__ = "migration_runs"

    id = Column(String(100), primary_key=True)
    project_id = Column(String(100), ForeignKey("projects.id"), default="default_project")
    status = Column(String(50), default="completed")
    progress = Column(Integer, default=100)
    logs = Column(JSON, default=list)
    summary = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("ProjectModel", back_populates="migration_runs")


class DbtGeneratedFileModel(Base):
    """Step 5: Review & Generate dbt SQL files, snapshots, macros, and schema YML"""
    __tablename__ = "dbt_generated_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String(100), ForeignKey("projects.id"), default="default_project")
    file_path = Column(String(500), nullable=False)
    layer = Column(String(50), default="models")
    content = Column(Text, default="")
    is_dirty = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    project = relationship("ProjectModel", back_populates="dbt_files")


# ---------------------------------------------------------------------------
# Document stores: small JSON documents keyed by id, kept in their original order.
# These replaced the *_store.json files that used to live next to the code.
# ---------------------------------------------------------------------------

class _DocumentMixin:
    key = Column(String(255), primary_key=True)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class SavedConnectionModel(_DocumentMixin, Base):
    """Saved Snowflake connections (CFO analytics, costing). Contains credentials."""
    __tablename__ = "saved_connections"
    data = Column(EncryptedJSON, nullable=False)


class SnowflakeScopeCredentialModel(_DocumentMixin, Base):
    """Last-used Snowflake credentials per UI scope (analytics / costing). Contains credentials."""
    __tablename__ = "snowflake_scope_credentials"
    data = Column(EncryptedJSON, nullable=False)


class GovernanceSourceModel(_DocumentMixin, Base):
    """Registered AI-governance sources (dbt Cloud, Airflow, ...). Contains credentials."""
    __tablename__ = "governance_sources"
    data = Column(EncryptedJSON, nullable=False)


class KpiDashboardModel(_DocumentMixin, Base):
    """Generated KPI dashboards per Snowflake schema."""
    __tablename__ = "kpi_dashboards"
    data = Column(JSON, nullable=False)


class SemanticModelModel(_DocumentMixin, Base):
    """Semantic view drafts / active models."""
    __tablename__ = "semantic_models"
    data = Column(JSON, nullable=False)


class AppSettingModel(_DocumentMixin, Base):
    """Application settings saved from the UI (LLM provider, model, API keys)."""
    __tablename__ = "app_settings"
    data = Column(EncryptedJSON, nullable=False)



# ---------------------------------------------------------------------------
# CDC Pipeline (app/modules/cdc_pipeline). Relational rather than document stores: checkpoints
# and run history are queried per pipeline/table, and connection details are encrypted at rest.
# ---------------------------------------------------------------------------

class CdcPipelineModel(Base):
    __tablename__ = "cdc_pipelines"
    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    source_type = Column(String(32), nullable=False)
    source_connection = Column(EncryptedJSON, nullable=False)   # host/port/db/user/password
    target_connection = Column(EncryptedJSON, nullable=False)   # Snowflake credentials
    tables_config = Column(JSON, nullable=False, default=list)  # [{table, approach, trackingColumn, ...}]
    schedule = Column(String(100), nullable=True)               # e.g., '15m' or '0 * * * *'
    schedule_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CdcCheckpointModel(Base):
    __tablename__ = "cdc_checkpoints"
    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(String(64), ForeignKey("cdc_pipelines.id", ondelete="CASCADE"), nullable=False, index=True)
    table_name = Column(String(255), nullable=False)
    last_loaded_column = Column(String(255))
    last_loaded_value = Column(Text)          # JSON-encoded {"type": ..., "value": ...}
    row_count = Column(Integer, default=0)    # rows loaded for this table, cumulative
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CdcRunHistoryModel(Base):
    __tablename__ = "cdc_run_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(String(64), ForeignKey("cdc_pipelines.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(32), nullable=False)   # running | success | partial | failed
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime)
    tables_processed = Column(Integer, default=0)
    total_rows_loaded = Column(Integer, default=0)
    total_rows_updated = Column(Integer, default=0)
    total_rows_deleted = Column(Integer, default=0)
    error_message = Column(Text)
    details = Column(JSON, default=list)          # per-table results
