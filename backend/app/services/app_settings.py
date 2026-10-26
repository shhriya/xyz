"""LLM settings saved from the UI, persisted in the app_settings table.

Environment variables provide the defaults; values saved from the Settings dialog override them.
Saved values are also exported to os.environ because several modules read os.getenv() at call time.
"""
import logging
import os
from typing import Any, Dict

from app.db.document_store import DocumentStore
from app.db.models import AppSettingModel
from app.state import state

logger = logging.getLogger("uvicorn.error")

_STORE = DocumentStore(AppSettingModel)
_KEY = "llm"

# state["settings"] key -> environment variable
_ENV_NAMES = {
    "provider": "LLM_PROVIDER",
    "model": "LLM_MODEL",
    "gemini_api_key": "GEMINI_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
    "anthropic_api_key": "ANTHROPIC_API_KEY",
    "ollama_url": "OLLAMA_BASE_URL",
}


def _apply(values: Dict[str, Any]) -> None:
    for key, env_name in _ENV_NAMES.items():
        if values.get(key) is not None:
            state["settings"][key] = values[key]
            os.environ[env_name] = str(values[key])


def load_llm_settings() -> None:
    saved = _STORE.get(_KEY)
    if saved:
        _apply(saved)
        logger.info("Loaded saved LLM settings from the database.")


def save_llm_settings() -> None:
    current = {key: state["settings"].get(key) for key in _ENV_NAMES}
    _STORE.put(_KEY, current)
    _apply(current)
