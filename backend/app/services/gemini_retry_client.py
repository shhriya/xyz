"""
Shared retry-capable Gemini caller. Every module that calls Gemini (Cloud Modernization's
bug reviewer, Code Conversion's AI transpiler, ...) declares its own model fallback list —
that list stays each module's own choice — but the retry/timeout/backoff mechanics around
"one of these models is probably flaky right now" are identical everywhere, so they live here
once instead of being copy-pasted into every new caller.
"""
import json
import os
import re
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

CALL_TIMEOUT_SECS = 25   # short enough that trying the whole fallback list still feels like one click
TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}


def resolve_models(fallbacks: List[str]) -> List[str]:
    """Puts GEMINI_MODEL (backend/.env) first in a caller's fallback list, if set — so a
    deployment can pin/override which model is actually tried first without every caller
    re-implementing env handling. Falls back to the caller's own list if unset.
    Read once at import time like the rest of this app's env config: changing .env needs a
    backend restart to take effect."""
    configured = os.getenv("GEMINI_MODEL", "").strip()
    if not configured:
        return fallbacks
    return [configured] + [m for m in fallbacks if m != configured]


def extract_json(raw_text: str) -> Optional[Any]:
    raw_text = raw_text.strip()
    if raw_text.startswith("```"):
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)
    try:
        return json.loads(raw_text)
    except Exception:
        return None


def call_gemini_json(
    system_prompt: str, user_text: str, api_key: str, models: List[str], temperature: float = 0.1,
    max_output_tokens: Optional[int] = None, timeout: Optional[int] = None,
) -> Tuple[Optional[Any], Dict[str, Any]]:
    """Tries each model in `models` in order; a model that fails for a TRANSIENT reason (rate
    limit, overload, timeout) gets one immediate retry before moving to the next model — those
    errors often clear within a second or two, so a single click still has a real chance of
    succeeding instead of failing outright on the first busy model it hits. Returns the parsed
    JSON response body and the call's usageMetadata (empty dict if every model failed)."""
    generation_config = {"temperature": temperature, "responseMimeType": "application/json"}
    if max_output_tokens:
        generation_config["maxOutputTokens"] = max_output_tokens
    payload = {
        "contents": [{"parts": [{"text": user_text}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": generation_config,
    }
    call_timeout = timeout or CALL_TIMEOUT_SECS
    for model_name in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        for attempt in range(2):
            try:
                r = requests.post(url, json=payload, timeout=call_timeout)
                if r.status_code == 200:
                    data = r.json()
                    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                    usage = data.get("usageMetadata", {})
                    if parts and "text" in parts[0]:
                        parsed = extract_json(parts[0]["text"])
                        if parsed is not None:
                            return parsed, usage
                    break  # 200 but no usable content — retrying the same model won't help
                if r.status_code in TRANSIENT_STATUS_CODES and attempt == 0:
                    time.sleep(1.5)
                    continue
                logger.warning(f"Gemini {model_name} returned status {r.status_code}: {r.text[:200]}")
                break
            except requests.exceptions.Timeout:
                if attempt == 0:
                    continue
                logger.warning(f"Gemini {model_name} timed out twice (>{call_timeout}s each) — moving on.")
            except Exception as e:
                logger.warning(f"Gemini {model_name} error: {e}")
                break
    return None, {}
