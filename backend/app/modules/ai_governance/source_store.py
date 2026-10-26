"""
Local store of connection details per registered governance source.

GOV_SOURCE_REGISTRY in Snowflake is the system of record for identity and schema signatures, but
Refresh must be able to reconnect (to the source API and to Snowflake itself) by source_id alone,
without the user re-entering credentials. Those details are kept in the `governance_sources`
table (encrypted at rest when APP_ENCRYPTION_KEY is set).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.db.document_store import DocumentStore
from app.db.models import GovernanceSourceModel

_STORE = DocumentStore(GovernanceSourceModel)
_LOCK = _STORE.lock


def _load() -> Dict[str, Dict[str, Any]]:
    return _STORE.load_dict()


def _save(data: Dict[str, Dict[str, Any]]) -> None:
    _STORE.save_dict(data)


def upsert_source(entry: Dict[str, Any]) -> Dict[str, Any]:
    with _LOCK:
        data = _load()
        existing = data.get(entry["source_id"], {})
        merged = {**existing, **entry}
        merged.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        data[entry["source_id"]] = merged
        _save(data)
        return merged


def get_source(source_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        return _load().get(source_id)


def update_source(source_id: str, **fields: Any) -> None:
    with _LOCK:
        data = _load()
        if source_id in data:
            data[source_id].update(fields)
            _save(data)


def list_sources_public() -> List[Dict[str, Any]]:
    """Registered sources without any credential material."""
    with _LOCK:
        data = _load()
    public_keys = (
        "source_id", "source_type", "display_name", "connection_identity", "target_db", "target_schema",
        "created_at", "last_synced_at", "last_setup_at", "last_mode",
    )
    rows = [{k: v.get(k) for k in public_keys} for v in data.values()]
    return sorted(rows, key=lambda r: r.get("created_at") or "")
