"""
Shared LLM access for the governance module (Gemini first, then OpenAI), following the provider
order already used by the monitoring chatbot.

Only two call sites may use this module:
  * kpi_discovery_service.py  (Setup flow)
  * chat_service.py           (chatbot)
The Refresh flow and dashboard page loads must never import it.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import requests

import app.core.config  # noqa: F401  (loads backend/.env into os.environ)
from app.services.gemini_retry_client import resolve_models
from app.state import state

logger = logging.getLogger("governance_llm")

# gemini-2.5-flash retired 2026-09 (Google now 404s it for new users)
GEMINI_MODELS = resolve_models(["gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-3.1-pro-preview"])

#: Counts real outbound LLM calls; used by tests/diagnostics to prove Refresh makes none.
LLM_CALL_COUNTER = {"count": 0}


def _settings() -> Dict[str, Any]:
    return (state or {}).get("settings", {}) if isinstance(state, dict) else {}


def _gemini_key() -> Optional[str]:
    return _settings().get("gemini_api_key") or os.getenv("GEMINI_API_KEY")


def _call_gemini(system: str, turns: List[Dict[str, str]], json_mode: bool, temperature: float,
                 max_tokens: int, timeout: int) -> Optional[str]:
    api_key = _gemini_key()
    if not api_key:
        return None
    contents = [
        {"role": "user" if t["role"] == "user" else "model", "parts": [{"text": t["content"]}]}
        for t in turns if t.get("content")
    ]
    generation_config: Dict[str, Any] = {"temperature": temperature, "maxOutputTokens": max_tokens, "topP": 0.95}
    if json_mode:
        generation_config["responseMimeType"] = "application/json"
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": generation_config,
    }
    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        try:
            LLM_CALL_COUNTER["count"] += 1
            r = requests.post(url, params={"key": api_key}, json=payload, timeout=timeout)
            if r.status_code != 200:
                logger.info("Gemini %s returned %s: %s", model_name, r.status_code, r.text[:200])
                continue
            candidates = r.json().get("candidates", [])
            parts = (candidates[0].get("content") or {}).get("parts") if candidates else None
            if parts:
                text = "".join(p.get("text", "") for p in parts).strip()
                if text:
                    return text
        except Exception as e:
            logger.info("Gemini %s request failed: %s", model_name, e)
    return None


def _call_openai(system: str, turns: List[Dict[str, str]], json_mode: bool, temperature: float,
                 max_tokens: int, timeout: int) -> Optional[str]:
    key = _settings().get("openai_api_key") or os.getenv("OPENAI_API_KEY")
    if not key or key.startswith("sk-dummy"):
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key, timeout=float(timeout))
        kwargs: Dict[str, Any] = {}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        LLM_CALL_COUNTER["count"] += 1
        resp = client.chat.completions.create(
            model=_settings().get("model", "gpt-4o"),
            messages=[{"role": "system", "content": system}, *[t for t in turns if t.get("content")]],
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs,
        )
        if resp and resp.choices and resp.choices[0].message.content:
            return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.info("OpenAI call failed: %s", e)
    return None


def complete(system: str, turns: List[Dict[str, str]], *, json_mode: bool = False, temperature: float = 0.2,
             max_tokens: int = 4000, timeout: int = 60) -> Optional[str]:
    """turns: [{"role": "user"|"assistant", "content": str}, ...]. Returns None when no provider answers."""
    return (
        _call_gemini(system, turns, json_mode, temperature, max_tokens, timeout)
        or _call_openai(system, turns, json_mode, temperature, max_tokens, timeout)
    )


def complete_json(system: str, turns: List[Dict[str, str]], **kwargs: Any) -> Optional[Dict[str, Any]]:
    text = complete(system, turns, json_mode=True, **kwargs)
    return parse_json_response(text) if text else None


def parse_json_response(text: str) -> Optional[Dict[str, Any]]:
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(cleaned[start:end + 1])
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None
    return None
