"""Dispatches to the right managed-Airflow cost provider by name. Each provider module exposes
the same two functions (test_connection, get_cost_summary) plus a CREDENTIAL_FIELDS list — see
providers/mwaa.py, providers/composer.py, providers/astronomer.py."""

from __future__ import annotations

from typing import Any, Dict

from .providers import astronomer, composer, mwaa

PROVIDERS = {
    "mwaa": mwaa,
    "composer": composer,
    "astronomer": astronomer,
}

PROVIDER_LABELS = {
    "mwaa": "AWS MWAA",
    "composer": "GCP Cloud Composer",
    "astronomer": "Astronomer (Astro)",
}


def list_providers() -> Dict[str, Any]:
    return {
        "status": "success",
        "providers": [
            {"id": pid, "label": PROVIDER_LABELS[pid], "credentialFields": mod.CREDENTIAL_FIELDS}
            for pid, mod in PROVIDERS.items()
        ],
    }


def _resolve(payload: Dict[str, Any]):
    provider = (payload.get("provider") or "").strip().lower()
    mod = PROVIDERS.get(provider)
    if not mod:
        return None, {"status": "error", "message": f"Unknown provider '{provider}'. Choose one of: {', '.join(PROVIDERS)}."}
    return mod, None


def test_connection(payload: Dict[str, Any]) -> Dict[str, Any]:
    mod, err = _resolve(payload)
    if err:
        return err
    try:
        return mod.test_connection(payload)
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_cost_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    mod, err = _resolve(payload)
    if err:
        return err
    try:
        return mod.get_cost_summary(payload)
    except Exception as e:
        return {"status": "error", "message": str(e)}
