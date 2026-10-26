"""Central application settings, read from environment variables and backend/.env."""
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
ENV_FILE = BACKEND_DIR / ".env"
# Written by `neon link` / `neon deploy` in the repo root (DATABASE_URL, DATABASE_URL_UNPOOLED)
NEON_ENV_FILE = PROJECT_ROOT / ".env.local"

# Many modules still read os.getenv() directly, so expose .env values as real env vars too.
# Priority: real environment > backend/.env > Neon's .env.local
load_dotenv(ENV_FILE, override=False)
load_dotenv(NEON_ENV_FILE, override=False)


class Settings(BaseSettings):
    # Later files win in pydantic-settings, so backend/.env overrides Neon's .env.local
    model_config = SettingsConfigDict(env_file=(NEON_ENV_FILE, ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    # Application database (PostgreSQL only). AIVEN_DATABASE_URL is accepted for older .env files.
    database_url: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL", "AIVEN_DATABASE_URL"))
    # Direct (non-pooled) connection used for migrations; falls back to DATABASE_URL
    database_url_unpooled: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL_UNPOOLED", "DIRECT_DATABASE_URL"))

    # LLM providers
    llm_provider: str = "gemini"
    llm_model: str = Field(default="gemini-2.5-pro", validation_alias=AliasChoices("GEMINI_MODEL", "LLM_MODEL"))
    gemini_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"

    # Working directories for generated dbt projects
    dbt_project_dir: Path = PROJECT_ROOT / "dbt_output"
    cloud_mod_project_dir: Path = PROJECT_ROOT / "dbt_cloud_modernization"

    # Snowflake key-pair auth fallback (path to a .p8 file outside the repo)
    snowflake_private_key_path: str = ""

    # Comma-separated list of allowed browser origins ("*" = any; restrict this in production)
    cors_origins: str = "*"

    # Fernet key used to encrypt saved credentials at rest
    app_encryption_key: str = ""

    # Seed the demo project (sample Informatica/PySpark metadata) into an empty database
    seed_demo_data: bool = True

    @field_validator("database_url", "database_url_unpooled")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        v = (v or "").strip()
        # Heroku/Aiven style URLs use postgres://, which SQLAlchemy does not accept
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        return v

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
