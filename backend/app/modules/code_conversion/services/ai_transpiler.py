"""
AI-Based Legacy Script -> dbt Transpiler.

Replaces the regex/AST-heuristic path (PySparkTranspilerTool + the keyword-sniffing fallback
in SkillPipelineEngine.execute_skills_pipeline) for Python-shaped source files with a single
Gemini call per file. The point of moving to AI here specifically: the regex path's fragility
IS the "broken/legacy script" problem — a script that doesn't match `.withColumn`/`.filter`
patterns exactly falls through to guessing column names from stray keywords in the raw text,
silently, with no indication anything was uncertain. This module never does that: it either
gets a real, usable dbt project back from the model, or it fails clearly with a list of what
went wrong — it does not fabricate a plausible-looking empty project.

Scope: this only replaces the Python/pandas/psycopg2/pyspark script path. Informatica's
XML-based extraction in execute_skills_pipeline is untouched — that format is already
well-structured data, not "broken code," and isn't what this feature is about.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.services.gemini_retry_client import call_gemini_json, resolve_models
from app.modules.code_conversion.skills_engine import load_skills_from_disk

logger = logging.getLogger(__name__)

GEMINI_MODELS = resolve_models(["gemini-3.6-flash", "gemini-3-flash-preview"])  # gemini-2.5-flash retired 2026-09
MAX_SCRIPT_CHARS = 40000  # keeps one file's call (and cost) bounded; truncates with a disclosed warning past this

# Same quality-gate skills already proven for Cloud Modernization's generation prompt — reused
# here instead of re-authoring dbt best-practice rules a second time. Splicing these in is also
# what makes Code Conversion's own SKILL.md files functionally real for the first time: until
# this module existed, nothing in Code Conversion ever sent skill text to an LLM.
CODE_CONVERSION_RELEVANT_SKILL_IDS = [
    "medallion_architect_skill",
    "data_safety_keys_skill",
    "jinja_test_validator_skill",
    "docs_lineage_skill",
    "code_quality_skill",
    "incremental_strategy_skill",
    "semantic_layer_skill",
    "dag_health_skill",
    "cicd_scaffolding_skill",
]

GEMINI_INPUT_RATE_PER_1K = 0.000075
GEMINI_OUTPUT_RATE_PER_1K = 0.0003


def _load_code_conversion_skill_context() -> str:
    """Reads the shared SKILL.md files fresh on every call — same rationale as Cloud
    Modernization's equivalent: an edit made in the Skills editor should apply immediately,
    without a backend restart, since both features read the same files as source of truth."""
    try:
        skills = {s.id: s for s in load_skills_from_disk()}
    except Exception as e:
        logger.warning(f"[Code Conversion AI Transpiler] Failed to load skills for prompt context: {e}")
        return ""

    blocks = []
    for skill_id in CODE_CONVERSION_RELEVANT_SKILL_IDS:
        skill = skills.get(skill_id)
        if skill and skill.enabled and skill.promptDirective.strip():
            blocks.append(f"--- SKILL: {skill.name} ---\n{skill.promptDirective.strip()}")
    if not blocks:
        return ""
    return "\n\n" + "\n\n".join(blocks)


def _build_system_prompt(target_dialect: str) -> str:
    skill_context = _load_code_conversion_skill_context()
    return f"""You are a Principal Data Engineer converting a legacy ETL script into a production dbt project
for {target_dialect}. The script you are given may be clean, messy, partially broken, or incomplete — it may not
even be valid PySpark, or valid Python at all. Your job is to read it AS-IS and still produce a correct, complete
dbt project implementing the same intent, being explicit about any part you had to infer.

WHAT TO DO
1. Read the entire script and identify: what source table(s)/query results it reads, what transformations it
   applies (joins, filters, aggregations, renames, type casts, deduplication), and what target table(s) it writes.
   This applies whether the script is PySpark, plain pandas, raw SQL via psycopg2/sqlalchemy/pyodbc, or a mix.
2. Produce a complete Medallion-architecture dbt project (Bronze staging, Silver cleaning, and Gold
   dimensions/facts/marts only where the script's actual logic warrants them — do not invent layers the script
   gives no basis for).
3. Where the script is broken, incomplete, or ambiguous, use your best engineering judgment to infer the intended
   logic — but you MUST report every such inference as an entry in "issues" (severity "info" for a confident
   inference, "warning" for a genuinely uncertain one). Do not silently blend a guess in as if it were certain.
4. Where something is truly unrecoverable (e.g. a table is referenced but its name/columns appear nowhere in the
   script, even partially), do not invent a plausible-sounding name or schema to fill the gap. Emit a clearly
   labeled placeholder and report it as an "issues" entry with severity "error".

OUTPUT FORMAT — return ONLY strict JSON, no markdown fences, no prose outside the JSON:
{{
  "files": {{"models/bronze/stg_x.sql": "...", "models/silver/int_x_cleaned.sql": "...", "...": "..."}},
  "issues": [{{"file": "path exactly as in files", "line": <int or null>, "severity": "error"|"warning"|"info",
               "message": "specific, concrete explanation of what was inferred/broken/unresolved and why"}}],
  "summary": "one or two sentences describing what this script does and what was converted"
}}
Every path in "files" must be a real dbt project path (models/bronze/..., models/silver/..., models/gold/...,
models/schema.yml, etc.) following standard dbt conventions. If the script's intent could not be determined
AT ALL — zero recognizable table/query/transformation signal anywhere in it — return {{"files": {{}}, "issues":
[{{"file": "<the given file path>", "line": 1, "severity": "error",
"message": "No recognizable ETL pattern found in this script."}}], "summary": "Unsupported input."}} rather than
fabricating a project with no basis in the source.
{skill_context}"""


def transpile_script_to_dbt(
    file_path: str, raw_content: str, target_dialect: str, api_key: str
) -> Tuple[Optional[Dict[str, str]], List[Dict[str, Any]], Dict[str, Any]]:
    """Converts ONE legacy script into dbt project files via a single Gemini call.

    Returns (files, issues, usage). `files` is None only when the call itself failed (no
    Gemini response at all, e.g. every model exhausted/quota/timeout) — that is distinct from
    a successful call that legitimately found nothing convertible (which returns `files={}`
    plus an explicit "no recognizable pattern" issue, per the system prompt's contract)."""
    if not api_key:
        return None, [{
            "file": file_path, "line": 1, "severity": "error",
            "message": "No Gemini API key configured — cannot run AI transpilation.",
        }], {}

    truncated = len(raw_content) > MAX_SCRIPT_CHARS
    content_for_prompt = raw_content[:MAX_SCRIPT_CHARS]
    user_text = (
        (f"NOTE: script truncated to {MAX_SCRIPT_CHARS} chars to fit budget — later parts were not seen.\n" if truncated else "")
        + f"File: {file_path}\nTarget dialect: {target_dialect}\n\nScript content:\n{content_for_prompt}"
    )

    parsed, usage = call_gemini_json(_build_system_prompt(target_dialect), user_text, api_key, GEMINI_MODELS)
    if not isinstance(parsed, dict):
        return None, [{
            "file": file_path, "line": 1, "severity": "error",
            "message": "AI transpilation failed — Gemini was unavailable or returned an unusable response after retrying every configured model.",
        }], usage

    files = parsed.get("files")
    if not isinstance(files, dict):
        files = {}
    issues_raw = parsed.get("issues")
    issues: List[Dict[str, Any]] = []
    if isinstance(issues_raw, list):
        for idx, item in enumerate(issues_raw):
            if not isinstance(item, dict) or not item.get("message"):
                continue
            issues.append({
                "id": f"ai_transpile_{idx}_{abs(hash(file_path)) % 10000}",
                "file": item.get("file") or file_path,
                "line": item.get("line") or 1,
                "severity": item.get("severity", "warning"),
                "category": "ai",
                "message": item["message"],
                "sourceScript": file_path,
            })
    return files, issues, usage


def accumulate_usage(acc: Dict[str, Any], usage_metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Folds one call's usageMetadata into a running total — same shape/formula as Cloud
    Modernization's AI usage tracker, kept local here rather than shared since each module
    owns its own running totals in `state` under a different key."""
    prompt_tokens = int(usage_metadata.get("promptTokenCount", 0) or 0)
    completion_tokens = int(usage_metadata.get("candidatesTokenCount", 0) or 0)
    total_tokens = int(usage_metadata.get("totalTokenCount", 0) or (prompt_tokens + completion_tokens))
    call_cost = (prompt_tokens / 1000.0) * GEMINI_INPUT_RATE_PER_1K + (completion_tokens / 1000.0) * GEMINI_OUTPUT_RATE_PER_1K

    acc["promptTokens"] = acc.get("promptTokens", 0) + prompt_tokens
    acc["completionTokens"] = acc.get("completionTokens", 0) + completion_tokens
    acc["totalTokens"] = acc.get("totalTokens", 0) + total_tokens
    acc["totalCostUsd"] = round(acc.get("totalCostUsd", 0.0) + call_cost, 6)
    acc["aiCalls"] = acc.get("aiCalls", 0) + 1
    return acc
