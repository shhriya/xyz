"""
Side Chat — targeted, minimal-footprint edits to an existing dbt project, with the user in the
loop before anything is applied.

Replaces Run & Validate (removed): rather than executing the project and reporting failures, this
is a plain conversation. The same box handles two kinds of message, distinguished only by what the
user writes, not by a separate mode:
  - "add this new requirement" -> the AI extends the project to deliver it
  - "this is giving the wrong output, fix it" -> the AI reads the bug description and corrects it

Either way, the AI sees the FULL current project (not a truncated summary — that was the previous
/prompt-refine endpoint's failure mode, which only ever saw 8 files at 600 characters each and so
had no way to preserve what it couldn't see) and is instructed to return ONLY the files that must
actually change. Nothing here writes to disk or state: this only proposes; the router endpoint and
the frontend keep changes pending until the user approves or declines each file individually.
"""
import logging
import re
from typing import Any, Dict, List, Tuple

from app.services.gemini_retry_client import call_gemini_json, resolve_models

logger = logging.getLogger(__name__)

GEMINI_MODELS = resolve_models(["gemini-3.6-flash", "gemini-3-flash-preview"])
MAX_CONTEXT_CHARS = 150000
TIMEOUT_SECS = 120
MAX_OUTPUT_TOKENS = 32768

SYSTEM_PROMPT = """You are a Senior Analytics Engineer making a SINGLE, TARGETED edit to an existing, working dbt
project. You are given the full content of every file in the project and a message from the user, which is either:
  (a) a NEW REQUIREMENT to add — extend the project to deliver it, or
  (b) a BUG REPORT — a description of wrong output or incorrect behaviour the user observed, to be fixed.
You decide which of these it is from the wording; there is no separate flag for it.

THE ONE RULE THAT MATTERS MOST: change as little as possible. Read every file first. Identify the smallest set of
files that must change to satisfy the request, and touch NOTHING else.
  - Do NOT return a file whose content does not actually need to change.
  - Do NOT rewrite, reformat, rename, or "clean up" a file as a side effect — even one you are already touching:
    inside a file you do change, preserve every line, comment, and piece of formatting that isn't part of the fix.
  - Do NOT regenerate the whole project. Do NOT restructure folders. Do NOT invent new architecture.
  - Follow the medallion architecture and naming conventions ALREADY used in this project — Bronze/Silver/Gold,
    the same layer folders, the same naming style — never introduce a Kimball fact/dimension/mart split if the
    project doesn't already have one.
  - If the request genuinely requires a new file (a new model, a new test, a new macro), create it consistent
    with the project's existing conventions — but still touch no existing file that doesn't need it.
  - If the request is a bug report, first work out the likely root cause in the given files before touching
    anything, and fix that cause — not just its symptom.
  - If the request cannot be done with the given project/files (e.g. it needs a source table that doesn't exist),
    return no changes and explain why in "summary" instead of guessing.

Dialect: {dialect}.
{skill_context}

Return ONLY strict JSON (no markdown fences, no prose outside the JSON):
{{"summary": "one or two plain-English sentences: what you changed and why, for a human to review before approving",
  "changes": [{{"path": "exact file path", "content": "the FULL new file content", "reason": "one short sentence: why this specific file needed to change"}}]}}
If nothing needs to change, return {{"summary": "...", "changes": []}}."""


def _project_context(files: Dict[str, str]) -> Tuple[str, bool]:
    """Full content of every real project file, in a stable order, within a generous budget.
    Returns (context_text, truncated)."""
    skip_dirs = (".git/", "target/", "dbt_packages/", "logs/", "__pycache__/")
    out, used, truncated = [], 0, False
    for path in sorted(files):
        norm = path.replace("\\", "/")
        if any(norm.startswith(d) or f"/{d}" in norm for d in skip_dirs):
            continue
        content = files[path] or ""
        chunk = f"\n--- FILE: {path} ---\n{content}\n"
        if used + len(chunk) > MAX_CONTEXT_CHARS:
            truncated = True
            continue
        out.append(chunk)
        used += len(chunk)
    return "".join(out), truncated


def propose_change(
    prompt: str, files: Dict[str, str], dialect: str, api_key: str, skill_context: str = "",
) -> Tuple[List[Dict[str, Any]], str, Dict[str, Any]]:
    """Returns ([{path, content, isNew, reason}], summary, usage). Proposes only — applies nothing."""
    if not api_key or not files:
        return [], "", {}

    context, truncated = _project_context(files)
    system_prompt = SYSTEM_PROMPT.format(dialect=dialect or "snowflake", skill_context=skill_context or "")
    user_text = (
        ("NOTE: the project is large enough that some files were left out of what you were shown — if this request "
         "needs one of them, say so in \"summary\" rather than guessing its content.\n\n" if truncated else "")
        + f"USER MESSAGE:\n{prompt.strip()}\n\nCURRENT PROJECT FILES:\n{context}"
    )
    parsed, usage = call_gemini_json(
        system_prompt, user_text, api_key, GEMINI_MODELS,
        max_output_tokens=MAX_OUTPUT_TOKENS, timeout=TIMEOUT_SECS,
    )
    if not isinstance(parsed, dict):
        return [], "", usage or {}

    changes = []
    for entry in parsed.get("changes") or []:
        if not isinstance(entry, dict):
            continue
        path = re.sub(r"^[/\\]+", "", str(entry.get("path") or "").replace("\\", "/")).strip()
        content = entry.get("content")
        if not path or not isinstance(content, str) or ".." in path.split("/"):
            continue
        if files.get(path) == content:
            continue  # no-op guard: the AI returned a file but nothing in it actually changed
        changes.append({
            "path": path,
            "content": content,
            "isNew": path not in files,
            "reason": str(entry.get("reason") or "").strip(),
        })
    summary = str(parsed.get("summary") or "").strip()
    return changes, summary, usage or {}
