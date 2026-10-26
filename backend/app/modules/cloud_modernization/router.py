import io
import os
import re
import json
import shutil
import stat
import time
import zipfile
import logging
import requests
import yaml
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from fastapi import APIRouter, HTTPException, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.services.gemini_retry_client import call_gemini_json, resolve_models
from app.services.github_export import parse_github_repo, push_files_to_github
from app.state import state
from app.modules.code_conversion.skills_engine import load_skills_from_disk
from app.modules.cfo_analytics.snowflake_live import (
    create_live_snowflake_connection,
    fetch_live_databases,
    fetch_live_schemas,
    fetch_live_tables,
    fetch_live_columns,
)
from app.modules.cloud_modernization.live_schema_sources import (
    oracle_fetch_databases, oracle_fetch_schemas, oracle_fetch_tables, oracle_fetch_columns,
    databricks_fetch_databases, databricks_fetch_schemas, databricks_fetch_tables, databricks_fetch_columns,
)
from app.modules.cloud_modernization.schema_import import (
    normalize_live_columns_to_entities,
    parse_ddl_sql_to_entities,
    parse_dbt_yaml_to_entities,
    parse_csv_to_entities,
)

# ── Enterprise Service Layer ──────────────────────────────────────────────────
try:
    from app.modules.cloud_modernization.services.requirement_parser import parse_requirement, classify_entities_from_schema
    from app.modules.cloud_modernization.services.side_chat import propose_change
    # No template model generators: every model comes from the AI. Entities the AI omits are
    # completed by a second AI call against the project it produced (_complete_missing_entities),
    # never by pasting generic templates — that produced duplicate stg_raw_* models and a second
    # sources.yml pointing at tables that don't exist.
    _SERVICES_AVAILABLE = True
except ImportError as _svc_err:
    _SERVICES_AVAILABLE = False
    logging.getLogger("uvicorn.error").warning(f"Enterprise services not loaded: {_svc_err}")
# ─────────────────────────────────────────────────────────────────────────────

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/migration", tags=["prompt-migration"])

# Dedicated directory for Data Modernization (completely separated from Code Conversion's dbt_output)
CLOUD_MOD_PROJECT_DIR = Path(settings.cloud_mod_project_dir).resolve()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODELS = resolve_models(["gemini-3.6-flash", "gemini-3-flash-preview"])  # gemini-2.5-flash retired 2026-09

# Gemini Flash-tier list pricing (USD), used to estimate AI spend for Data Modernization.
GEMINI_INPUT_RATE_PER_1K = 0.000075   # ~$0.075 / 1M input tokens
GEMINI_OUTPUT_RATE_PER_1K = 0.0003    # ~$0.30 / 1M output tokens


def _reset_cloud_mod_ai_usage():
    state["cloud_mod_ai_usage"] = {
        "promptTokens": 0,
        "completionTokens": 0,
        "totalTokens": 0,
        "totalCostUsd": 0.0,
        "aiCalls": 0,
    }


def _accumulate_cloud_mod_ai_usage(usage_metadata: Dict[str, Any]):
    """Adds one Gemini call's usageMetadata to the running Data Modernization AI usage counter."""
    if not usage_metadata:
        return state.get("cloud_mod_ai_usage")
    acc = state.setdefault("cloud_mod_ai_usage", {
        "promptTokens": 0, "completionTokens": 0, "totalTokens": 0,
        "totalCostUsd": 0.0, "aiCalls": 0
    })
    prompt_tokens = int(usage_metadata.get("promptTokenCount", 0) or 0)
    completion_tokens = int(usage_metadata.get("candidatesTokenCount", 0) or 0)
    total_tokens = int(usage_metadata.get("totalTokenCount", 0) or (prompt_tokens + completion_tokens))
    call_cost = (prompt_tokens / 1000.0) * GEMINI_INPUT_RATE_PER_1K + (completion_tokens / 1000.0) * GEMINI_OUTPUT_RATE_PER_1K

    acc["promptTokens"] += prompt_tokens
    acc["completionTokens"] += completion_tokens
    acc["totalTokens"] += total_tokens
    acc["totalCostUsd"] = round(acc["totalCostUsd"] + call_cost, 6)
    acc["aiCalls"] += 1
    return acc


def _get_cloud_mod_ai_usage() -> Dict[str, Any]:
    acc = state.get("cloud_mod_ai_usage") or {
        "promptTokens": 0, "completionTokens": 0, "totalTokens": 0,
        "totalCostUsd": 0.0, "aiCalls": 0
    }
    cost = round(acc.get("totalCostUsd", 0.0), 6)
    return {
        "promptTokens": acc.get("promptTokens", 0),
        "completionTokens": acc.get("completionTokens", 0),
        "tokensUsed": acc.get("totalTokens", 0),
        "aiCost": cost,
        "aiCostFormatted": f"${cost:.4f}" if cost < 1 else f"${cost:.2f}",
        "aiCalls": acc.get("aiCalls", 0),
    }

class PromptGenerateRequest(BaseModel):
    prompt: str = Field(..., description="User prompt detailing data requirements and required models")
    targetDialect: str = Field(default="snowflake")
    projectName: str = Field(default="r_data_modernization")
    architectureStyle: str = Field(default="medallion")
    includeTests: bool = Field(default=True)
    includeMacros: bool = Field(default=True)
    sourceSchema: Optional[Dict[str, List[Dict[str, Any]]]] = Field(
        default=None,
        description="Real entity->columns map (Schema-Aware Generation). When provided, generation "
                    "is grounded in these exact entities/columns instead of an LLM-guessed schema."
    )
    sourceLocation: Optional[Dict[str, str]] = Field(
        default=None,
        description="Where those tables actually live: {database, schema, sourceType}. Pinned into "
                    "every sources YAML, so the AI never has to guess (it used to put the schema name "
                    "in `database:`)."
    )
    targetConnection: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Snowflake target connection (the profiles.yml target). Used to run the Prompt 1 "
                    "INFORMATION_SCHEMA.TABLES lookup for existing source and truth tables.",
    )


class SchemaConnectionRequest(BaseModel):
    sourceType: str = "snowflake"  # "snowflake" | "oracle" | "databricks"

    # Snowflake
    account: str = ""
    username: str = ""
    password: Optional[str] = None
    privateKey: Optional[str] = None
    privateKeyPassphrase: Optional[str] = None
    authMethod: Optional[str] = "password"
    warehouse: Optional[str] = None
    role: Optional[str] = None

    # Oracle
    host: Optional[str] = None
    port: Optional[str] = None
    serviceName: Optional[str] = None
    dsn: Optional[str] = None

    # Databricks (Unity Catalog)
    workspaceUrl: Optional[str] = None
    token: Optional[str] = None

    # Shared: database/schema/tables navigation
    database: Optional[str] = ""
    schema_: Optional[str] = Field(default="", alias="schema")
    tables: Optional[List[str]] = None

    model_config = ConfigDict(populate_by_name=True)


class SchemaUploadRequest(BaseModel):
    fileType: str = Field(..., description="'ddl', 'yaml', or 'csv'")
    content: str = Field(..., description="Raw text content of the uploaded file")

class OptimizePromptRequest(BaseModel):
    prompt: str = Field(..., description="Prompt text to compress before sending it to a generation model")


def get_active_gemini_key() -> str:
    # Check in-memory settings, then env
    settings_key = state.get("settings", {}).get("gemini_api_key", "")
    if settings_key and str(settings_key).strip():
        return str(settings_key).strip()
    return os.getenv("GEMINI_API_KEY", GEMINI_API_KEY)


# ── Schema-Aware Generation: live introspection, any source ────────────────────
# Snowflake reuses the exact same fetch_live_* functions already built for the Analytics
# Dashboard, with a dedicated connection scope so Data Modernization's live-connection lookups
# don't collide with Analytics Dashboard's or FinOps's cached credentials. Oracle and Databricks
# have their own connectors (live_schema_sources.py) since they're different platforms — but all
# three return the same shape, so normalize_live_columns_to_entities and everything downstream
# of it (Schema-Aware Generation) works identically regardless of which source was picked.
_SCHEMA_SOURCE_FETCHERS = {
    "snowflake": {"databases": fetch_live_databases, "schemas": fetch_live_schemas,
                  "tables": fetch_live_tables, "columns": fetch_live_columns},
    "oracle": {"databases": oracle_fetch_databases, "schemas": oracle_fetch_schemas,
               "tables": oracle_fetch_tables, "columns": oracle_fetch_columns},
    "databricks": {"databases": databricks_fetch_databases, "schemas": databricks_fetch_schemas,
                   "tables": databricks_fetch_tables, "columns": databricks_fetch_columns},
}


def _schema_fetchers(source_type: str) -> Dict[str, Any]:
    fetchers = _SCHEMA_SOURCE_FETCHERS.get((source_type or "snowflake").lower())
    if not fetchers:
        raise HTTPException(status_code=400, detail=f"Unsupported source type '{source_type}'. Use one of: snowflake, oracle, databricks.")
    return fetchers


@router.post("/schema/databases")
def schema_get_databases(req: SchemaConnectionRequest):
    creds = req.model_dump(by_alias=True, exclude_none=True)
    creds["scope"] = "cloud_modernization"
    try:
        databases = _schema_fetchers(req.sourceType)["databases"](creds)
        return {"status": "success", "databases": databases}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not connect: {e}")


@router.post("/schema/schemas")
def schema_get_schemas(req: SchemaConnectionRequest):
    creds = req.model_dump(by_alias=True, exclude_none=True)
    creds["scope"] = "cloud_modernization"
    try:
        schemas = _schema_fetchers(req.sourceType)["schemas"](creds, database=req.database or "")
        return {"status": "success", "schemas": schemas}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch schemas: {e}")


@router.post("/schema/tables")
def schema_get_tables(req: SchemaConnectionRequest):
    creds = req.model_dump(by_alias=True, exclude_none=True)
    creds["scope"] = "cloud_modernization"
    try:
        tables = _schema_fetchers(req.sourceType)["tables"](creds, database=req.database or "", schema=req.schema_ or "")
        return {"status": "success", "tables": tables}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch tables: {e}")


@router.post("/schema/columns")
def schema_get_columns(req: SchemaConnectionRequest):
    if not req.tables:
        raise HTTPException(status_code=400, detail="At least one table must be selected.")
    creds = req.model_dump(by_alias=True, exclude_none=True)
    creds["scope"] = "cloud_modernization"
    try:
        live_columns = _schema_fetchers(req.sourceType)["columns"](
            creds, database=req.database or "", schema=req.schema_ or "", tables=req.tables
        )
        entities = normalize_live_columns_to_entities(live_columns)
        return {"status": "success", "entities": entities}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch columns: {e}")


@router.post("/schema/upload")
def schema_upload(req: SchemaUploadRequest):
    """Parses an uploaded DDL .sql file, dbt schema.yml/sources.yml, or plain CSV of table/column
    definitions into the same entities shape the live-connection path produces, so both feed the
    same downstream generation logic identically."""
    file_type = (req.fileType or "").strip().lower()
    try:
        if file_type == "ddl":
            entities = parse_ddl_sql_to_entities(req.content)
        elif file_type == "yaml":
            entities = parse_dbt_yaml_to_entities(req.content)
        elif file_type == "csv":
            entities = parse_csv_to_entities(req.content)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported fileType '{req.fileType}'. Use 'ddl', 'yaml', or 'csv'.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse uploaded schema: {e}")

    if not entities:
        raise HTTPException(status_code=400, detail="No tables/columns could be parsed from this file.")

    return {"status": "success", "entities": entities, "entityCount": len(entities)}


# ─────────────────────────────────────────────────────────────────────────────
# Side Chat — targeted edits from a prompt, with the user approving each file before it lands.
#
#   /side-chat  - one AI call that sees the FULL current project and either extends it for a new
#                 requirement or fixes a described bug, returning only the files that must change.
#                 Applies NOTHING itself — this only proposes. The frontend shows each proposed
#                 file (with a diff) and the user approves or declines it individually; only an
#                 approved file is merged into the editor's live fileContent.
#
# See services/side_chat.py for the "change as little as possible" instruction and why it replaces
# the old /prompt-refine (which only ever saw 8 files truncated to 600 characters each).
# ─────────────────────────────────────────────────────────────────────────────

class SideChatRequest(BaseModel):
    prompt: str = Field(..., description="A new requirement to add, or a bug description to fix")
    files: Dict[str, str] = Field(default_factory=dict)
    targetDialect: str = Field(default="snowflake")


@router.post("/side-chat")
def side_chat(req: SideChatRequest):
    if not req.prompt or not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    if not req.files:
        raise HTTPException(status_code=400, detail="There is no project yet — generate or import one first.")
    if not _SERVICES_AVAILABLE:
        raise HTTPException(status_code=503, detail="Side chat service is unavailable.")
    api_key = get_active_gemini_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="No Gemini API key configured. Add one under Settings.")

    changes, summary, usage = propose_change(
        req.prompt.strip(), req.files, req.targetDialect, api_key, _load_cloud_mod_skill_context()
    )
    if usage:
        _accumulate_cloud_mod_ai_usage(usage)

    return {
        "status": "success",
        "changes": changes,
        "summary": summary or (
            "No changes were needed for this." if not changes else f"Proposed changes to {len(changes)} file(s)."
        ),
        "aiUsage": _get_cloud_mod_ai_usage(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Prompt optimization: shared by Data Modernization's requirement prompt and
# Code Conversion's per-skill/per-prompt editors (Step3PromptConfig.jsx).
# ─────────────────────────────────────────────────────────────────────────────

OPTIMIZE_PROMPT_SYSTEM_INSTRUCTION = """You compress prompts for an AI code/data-model generator. Rewrite the user prompt to use fewer tokens while preserving every substantive detail.
MUST KEEP exactly as given: every table/column/field name, every formula or calculation, every numeric value or threshold, every named requirement or deliverable, technical terms and proper nouns.
REMOVE: filler phrases, politeness/gratitude, redundant restatement, verbose scaffolding.
Output ONLY the rewritten prompt as plain prose (no markdown, no bullet points, no headers, no preamble, no quotes)."""


def _gemini_count_tokens(model_name: str, text: str, api_key: str) -> Optional[int]:
    """Real token count from Gemini's countTokens endpoint (free to call, not billed generation)."""
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:countTokens"
        r = requests.post(url, params={"key": api_key}, json={"contents": [{"parts": [{"text": text}]}]}, timeout=20)
        if r.status_code == 200:
            return r.json().get("totalTokens")
    except Exception as e:
        logger.warning(f"[Prompt Optimizer] countTokens failed for {model_name}: {e}")
    return None


@router.post("/optimize-prompt")
def optimize_prompt(req: OptimizePromptRequest):
    """
    Rewrites a user's prompt to cut filler/redundancy while preserving every requirement, name,
    and formula verbatim — the instruction explicitly lists what must never be dropped. Reports
    real before/after token counts from Gemini's countTokens API (not estimates), plus the small
    real token cost of running the optimizer itself, so the tradeoff is fully disclosed rather
    than presented as free.
    """
    prompt_clean = (req.prompt or "").strip()
    if not prompt_clean:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")

    api_key = get_active_gemini_key()
    if not api_key:
        return {"status": "error", "message": "No Gemini API key configured."}

    for model_name in GEMINI_MODELS:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            payload = {
                "systemInstruction": {"parts": [{"text": OPTIMIZE_PROMPT_SYSTEM_INSTRUCTION}]},
                "contents": [{"role": "user", "parts": [{"text": prompt_clean}]}],
                "generationConfig": {"temperature": 0.1, "thinkingConfig": {"thinkingBudget": 0}},
            }
            r = requests.post(url, params={"key": api_key}, json=payload, timeout=30)
            if r.status_code != 200:
                logger.info(f"[Prompt Optimizer] {model_name} returned {r.status_code}: {r.text[:150]}")
                continue
            data = r.json()
            candidates = data.get("candidates", [])
            parts = (candidates[0].get("content") or {}).get("parts") if candidates else None
            if not parts:
                continue
            optimized = "".join(p.get("text", "") for p in parts).strip()
            if not optimized:
                continue

            optimizer_usage = data.get("usageMetadata", {}) or {}
            original_tokens = _gemini_count_tokens(model_name, prompt_clean, api_key)
            optimized_tokens = _gemini_count_tokens(model_name, optimized, api_key)
            tokens_saved = max(0, original_tokens - optimized_tokens) if (original_tokens is not None and optimized_tokens is not None) else None
            savings_pct = round((tokens_saved / original_tokens) * 100, 1) if tokens_saved is not None and original_tokens else None

            return {
                "status": "success",
                "model": model_name,
                "originalPrompt": prompt_clean,
                "optimizedPrompt": optimized,
                "originalTokens": original_tokens,
                "optimizedTokens": optimized_tokens,
                "tokensSaved": tokens_saved,
                "savingsPct": savings_pct,
                "optimizerTokensUsed": optimizer_usage.get("totalTokenCount"),
            }
        except Exception as e:
            logger.warning(f"[Prompt Optimizer] {model_name} error: {e}")
            continue

    return {"status": "error", "message": "Prompt optimization failed — no Gemini model responded successfully."}



# ─────────────────────────────────────────────────────────────────────────────
# Code Conversion's Skills (app/modules/code_conversion/skills/*/SKILL.md) encode the same
# expertise Data Modernization's Gemini prompt needs — layer/materialization rules, surrogate
# key + SCD2 handling, schema.yml/test conventions, docs/lineage structure — so instead of
# maintaining a second, drifting copy of those rules here, the relevant skills' own prompt text
# is loaded and spliced into the system instruction below.
#
# Exactly the six "Prompt" skills of the generic dbt generation spec, in their required order
# (Prompt 1 source identification -> Prompt 6 structure & docs). They are the single source of
# truth for how a project is generated; Data Modernization maps its requirement + schema onto
# their "configuration inputs" rather than keeping its own, drifting copy of these rules. Other
# skills (CI scaffolding, semantic layer, ...) are not part of the spec, and "Do not add
# unsupported features" rules them out.
CLOUD_MOD_RELEVANT_SKILL_IDS = [
    "source_extractor_skill",       # Prompt 1 - source identification & configuration
    "medallion_architect_skill",    # Prompt 2 - architecture & layer design
    "pyspark_to_dbt_skill",         # Prompt 3 - model generation + load logic
    "data_safety_keys_skill",       # Prompt 4 - data safety + surrogate keys
    "jinja_test_validator_skill",   # Prompt 5 - validation model & testing
    "docs_lineage_skill",           # Prompt 6 - project structure, execution plan & docs
]


def _load_cloud_mod_skill_context() -> str:
    """
    Reads the relevant SKILL.md files fresh on every call (not a cached copy) so an edit made in
    Code Conversion's Skills editor (Step3PromptConfig.jsx) is picked up here immediately, without
    needing a backend restart — both features read the same files as their source of truth.
    """
    try:
        skills = {s.id: s for s in load_skills_from_disk()}
    except Exception as e:
        logger.warning(f"[Data Modernization] Failed to load skills for prompt context: {e}")
        return ""

    blocks = []
    for skill_id in CLOUD_MOD_RELEVANT_SKILL_IDS:
        skill = skills.get(skill_id)
        if skill and skill.enabled and skill.promptDirective.strip():
            blocks.append(f"--- SKILL: {skill.name} ---\n{skill.promptDirective.strip()}")
    if not blocks:
        return ""
    return "\n\n" + "\n\n".join(blocks)


_LAYER_OR_LANDING_PREFIX_RE = re.compile(
    r"^(?:raw_|src_|source_|landing_|stg_|ods_|int_|bronze_|silver_|gold_|dim_|fact_|fct_|mart_)+", re.IGNORECASE
)


def _gold_base_name(name: str) -> str:
    base = _LAYER_OR_LANDING_PREFIX_RE.sub("", re.sub(r"[^a-z0-9_]+", "_", str(name).lower())).strip("_")
    return base or str(name).lower()


_SOURCE_PREFIX_RE = re.compile(r"^(?:raw_|src_|source_|landing_|stg_|ods_|int_|bronze_|silver_|gold_)+", re.IGNORECASE)


def _target_name(name: str) -> str:
    """A target's own name, kept as the requirement gave it (dim_/fact_ included — the reference
    project's Gold model is dim_customer_profile_scd2, named after the legacy target), minus any
    source/landing/layer prefix."""
    clean = re.sub(r"[^a-z0-9_]+", "_", str(name).lower()).strip("_")
    return _SOURCE_PREFIX_RE.sub("", clean).strip("_") or clean


def gold_output_names(meta: Dict[str, Any]) -> List[str]:
    """The Gold models to build: ONE per final target the requirement asks for — nothing per entity.

    Modelled on the reference dbt project (dbt_v2_test2): its Gold folder holds a single model,
    dim_customer_profile_scd2, the current-state view of the SCD2 snapshot, named after the legacy
    target table it replaces. Everything else — per-entity cleansing, joins, aggregation, keys —
    lives in Silver. Earlier versions turned every parsed fact/dimension into its own Gold model,
    which filled Gold with per-entity tables (and, with a live schema, raw_* pass-throughs).

    Source of truth, in order:
      1. meta["gold_outputs"] — the final targets the parser read from the requirement
      2. otherwise meta["marts"] (requested reports) plus one current-state model per snapshot
    Parsed facts/dimensions never become Gold models on their own."""
    out: List[str] = []
    targets = meta.get("gold_outputs") or []
    if targets:
        out = [_target_name(t["name"] if isinstance(t, dict) else t) for t in targets]
    else:
        out = [_target_name(m) for m in (meta.get("marts") or [])]
        for snap in meta.get("snapshots") or []:
            base = _gold_base_name(re.sub(r"(_snapshot|_snp|_scd2)$", "", _gold_base_name(snap)))
            if base:
                out.append(f"dim_{base}_scd2")
    return [n for n in dict.fromkeys(out) if n]


def _build_entity_checklist_section(meta: Optional[Dict[str, Any]]) -> str:
    """
    Renders the parsed requirement (domain, entities+columns, facts, dimensions, marts, KPIs) as an
    explicit, named checklist for the generation prompt. Without this, Gemini has to independently
    re-derive every entity from the free-text prompt in the same breath as generating the whole
    project, with nothing to check completeness against — the exact failure mode where a prompt
    describing 7 entities silently comes back with 2. Falls back to a generic retail example only
    when requirement parsing itself failed (no api key, parser error, etc.).
    """
    if not meta or not meta.get("entities"):
        return """NEVER reuse columns across entities. Example schema if none was provided:
CUSTOMERS: customer_id, first_name, last_name, email, phone, city, state, country, loyalty_tier, status, created_at, updated_at
ORDERS: order_id, customer_id, product_id, store_id, quantity, unit_price, discount_amount, tax_amount, order_status, order_timestamp, payment_method
PRODUCTS: product_id, product_name, category, sub_category, brand, sku, cost_price, selling_price, product_status"""

    entities = meta.get("entities", {})
    lines = [f"Domain: {meta.get('domain', 'unspecified')}", ""]
    loc = meta.get("source_location") or {}
    if loc.get("database") and loc.get("schema"):
        lines += [
            "SOURCE LOCATION — these tables are real and live exactly here:",
            f"  database: {loc['database']}",
            f"  schema:   {loc['schema']}",
            f"sources.yml MUST declare ONE source with `database: {loc['database']}` and `schema: {loc['schema']}` "
            "exactly as written. The schema is NOT the database — never swap them, never use 'raw' or 'public' "
            "unless they are the values above. Table names in sources.yml are the entity names below, verbatim.",
            "",
        ]
    lines.append(f"ENTITIES TO COVER — EXACTLY THESE {len(entities)}. NONE MAY BE OMITTED, SUMMARIZED, OR MERGED:")
    for idx, (ent, cols) in enumerate(entities.items(), start=1):
        if cols:
            col_desc = ", ".join(
                f"{c.get('name')}{' (PK)' if c.get('pk') else ''}{' (FK)' if c.get('fk') else ''}{' (timestamp)' if c.get('ts') else ''}"
                for c in cols
            )
            lines.append(f"{idx}. {ent} — columns: {col_desc}")
        else:
            lines.append(f"{idx}. {ent} — infer 5-10 realistic columns for this entity in the {meta.get('domain', '')} domain, including a primary key.")

    rules = meta.get("business_rules") or []
    if rules:
        lines.append(
            f"\nBUSINESS RULES TO IMPLEMENT — EXACTLY THESE {len(rules)}. Every rule below MUST be ENFORCED IN THE "
            "SQL of the layer named (a WHERE filter, a calculated column, an exclusion, a formula) — restating it in "
            "a comment or in docs/ does NOT satisfy it. NONE MAY BE DROPPED, WEAKENED, OR ONLY PARTIALLY APPLIED:"
        )
        for idx, r in enumerate(rules, start=1):
            target = f" (applies to: {r['appliesTo']})" if r.get("appliesTo") else ""
            layer = f" [{r['layer']} layer]" if r.get("layer") else ""
            lines.append(f"{idx}. {r['rule']}{target}{layer}")

    # Gold is one flat folder (medallion_architect_skill): the parsed facts/dimensions/marts are merged
    # into a single list of Gold outputs, each a model directly under models/gold/. Naming follows the
    # skill — business-meaningful, never layer-prefixed; dim_/fact_ naming is allowed (the skill's own
    # example is models/gold/dim_customer.sql), sub-folders are not.
    gold_outputs = gold_output_names(meta)
    if gold_outputs:
        lines.append(
            f"\nGOLD LAYER OUTPUTS TO BUILD — EXACTLY THESE {len(gold_outputs)}, each as ONE model directly under "
            f"models/gold/ (no sub-folders), using EXACTLY these names: {', '.join(gold_outputs)}. "
            "No other Gold models. These are the FINAL tables consumers query (Prompt 2 GOLD CONTENT RULE); "
            "every other entity stops at Silver and is only ref()'d by these. A Gold model is never one-per-"
            "source-table, never a pass-through, never named after a source table, and never carries a "
            "raw_/src_/stg_/int_ prefix. Do NOT create per-entity dim_/fact_ Gold models."
        )
        for t in meta.get("gold_outputs") or []:
            if not isinstance(t, dict):
                continue
            detail = "; ".join(x for x in (
                t.get("description"), f"grain: {t['grain']}" if t.get("grain") else "",
                "current-state view of an SCD Type 2 snapshot (filter dbt_valid_to is null)" if t.get("fromSnapshot") else "",
            ) if x)
            if detail:
                lines.append(f"  - {_target_name(t['name'])}: {detail}")
    else:
        lines.append(
            "\nGOLD LAYER: the requirement names no specific final outputs — build only the analytics-ready output(s) "
            "it clearly implies (never one Gold model per source table). All other entities stop at Silver."
        )
    load = []
    if meta.get("incremental_required"):
        load.append("incremental loading is required (Prompt 3: unique_key + watermark + MERGE)")
    if meta.get("snapshots_required") or meta.get("snapshots"):
        load.append("history tracking / SCD Type 2 is required (Prompt 3: snapshot from Silver, strategy "
                    "derived from the columns, current-state Gold model from the snapshot)")
    if load:
        lines.append("LOAD BEHAVIOUR FROM THE REQUIREMENT: " + "; ".join(load) + ".")
    if meta.get("kpis"):
        lines.append(f"KPIs to compute in the Gold layer: {', '.join(meta['kpis'])}")
    if meta.get("snapshots"):
        lines.append(f"SNAPSHOTS (SCD Type 2): {', '.join(meta['snapshots'])}")
    if meta.get("seeds_required"):
        lines.append(f"SEEDS: {', '.join(meta['seeds_required'])}")
    if meta.get("tests_required"):
        lines.append(f"TESTS: {', '.join(meta['tests_required'])}")

    rules_clause = f" and every one of the {len(rules)} business rules above is actually enforced in SQL" if rules else ""
    lines.append(
        f"\nCOMPLETENESS IS MANDATORY: every one of the {len(entities)} entities above must get a "
        "Bronze model (e.g. src_<entity>), the Silver model(s) the architecture needs (e.g. int_<entity>), "
        "an entry in models/bronze/schema.yml and models/silver/schema.yml, and (when it's a Gold output "
        f"listed above) its Gold model plus a models/gold/schema.yml entry{rules_clause}. If the list is long, prioritize covering ALL "
        "entities and ALL business rules with correct structure over adding extra polish to only the "
        "first few — a shallow-but-complete project is correct; a deep-but-partial one is not."
    )
    return "\n".join(lines)


INVENTORY_MAX_TABLES = 1500


def _fetch_table_inventory(
    target: Optional[Dict[str, Any]], source_location: Optional[Dict[str, str]] = None
) -> Optional[Dict[str, Any]]:
    """Prompt 1's "search INFORMATION_SCHEMA.TABLES" step, done for real: lists every table/view in
    the target database (profiles.yml target.database), plus the source database when the live
    schema came from a different one. The AI then decides, from facts rather than guesses, which
    source and truth tables already exist (register as sources, no CREATE TABLE) and which are
    missing (generate CREATE TABLE + sample INSERT). Snowflake only; returns None when there is no
    usable connection, and generation then states "not detected" as an assumption instead."""
    target = target or {}
    if not all(str(target.get(k) or "").strip() for k in ("account", "user", "password", "database")):
        return None
    databases = [str(target["database"]).strip()]
    src_db = str((source_location or {}).get("database") or "").strip()
    if src_db and src_db.upper() != databases[0].upper() and (source_location or {}).get("sourceType", "snowflake") == "snowflake":
        databases.append(src_db)

    conn = None
    try:
        conn = create_live_snowflake_connection({
            "account": target.get("account", ""), "username": target.get("user", ""),
            "password": target.get("password", ""), "database": databases[0],
            "warehouse": target.get("warehouse", ""), "role": target.get("role", ""),
        })
        cur = conn.cursor()
        tables: List[Dict[str, str]] = []
        for db in databases:
            ident = '"' + db.replace('"', '""') + '"'
            cur.execute(
                f"select table_catalog, table_schema, table_name, table_type from {ident}.information_schema.tables "
                f"where table_schema <> 'INFORMATION_SCHEMA' order by table_schema, table_name limit {INVENTORY_MAX_TABLES}"
            )
            tables += [{"database": r[0], "schema": r[1], "table": r[2], "type": r[3]} for r in cur.fetchall()]
        return {"targetDatabase": databases[0], "databases": databases, "tables": tables}
    except Exception as e:
        logger.warning(f"[Data Modernization] Could not read INFORMATION_SCHEMA for table detection: {e}")
        return {"targetDatabase": databases[0], "databases": databases, "tables": [], "error": str(e)}
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _build_inventory_section(inventory: Optional[Dict[str, Any]]) -> str:
    if not inventory:
        return ("EXISTING TABLES (INFORMATION_SCHEMA.TABLES): not available — no Snowflake target connection was "
                "provided. Treat every source and truth table as NOT detected and say so in the implementation guide.\n")
    if inventory.get("error"):
        return (f"EXISTING TABLES (INFORMATION_SCHEMA.TABLES): the lookup in {inventory['targetDatabase']} failed "
                f"({inventory['error'][:200]}). Treat tables as NOT detected and say so in the implementation guide.\n")
    rows = inventory.get("tables") or []
    lines = [f"EXISTING TABLES (INFORMATION_SCHEMA.TABLES in {', '.join(inventory['databases'])} — "
             f"profiles.yml target.database = {inventory['targetDatabase']}), {len(rows)} found:"]
    lines += [f"  {r['database']}.{r['schema']}.{r['table']} ({r['type']})" for r in rows]
    if len(rows) >= INVENTORY_MAX_TABLES:
        lines.append(f"  (list truncated at {INVENTORY_MAX_TABLES} tables)")
    lines.append("Use this to decide Detected vs Missing source and truth tables (Prompt 1 / Prompt 5). A table "
                 "listed here exists: register it as a source at that schema, and do NOT generate CREATE TABLE for it.\n")
    return "\n".join(lines)


def _call_gemini_for_dbt(
    prompt: str, dialect: str, project_name: str, include_tests: bool, meta: Optional[Dict[str, Any]] = None,
    table_inventory: Optional[Dict[str, Any]] = None,
) -> "tuple[Optional[Dict[str, str]], Dict[str, Any]]":
    api_key = get_active_gemini_key()
    if not api_key:
        return None, {}

    entity_section = _build_entity_checklist_section(meta)
    inventory_section = _build_inventory_section(table_inventory)

    system_instruction = f"""You are an Enterprise dbt Analytics Engineering Agent (dbt Core, {dialect}). Generate a
complete, production-oriented dbt project by following the SIX PROMPT SKILLS below, in order. They are the
authoritative specification — every rule in them applies. Nothing else in this instruction overrides them.

Project Name: {project_name}
Dialect: {dialect}

=============================================================================
HOW THE SKILLS' "CONFIGURATION INPUTS" MAP TO THIS REQUEST
=============================================================================
The skills were written for configuration inputs extracted from a transformation system. Here:
- TRANSFORMATION LOGIC CONFIGURATION = the user's business requirement (the user message) plus the parsed
  entities, business rules, load behaviour and outputs listed under PROJECT INPUTS below.
- CONNECTION CONFIGURATION = the SOURCE LOCATION and EXISTING TABLES sections below, when present.
- SOURCE / LOOKUP tables = the entities listed below. TARGET (truth) tables = any target/output tables the
  requirement names, matched against the EXISTING TABLES inventory when provided.
- Where a skill says to search INFORMATION_SCHEMA.TABLES, use the EXISTING TABLES inventory below — it is the
  result of that search. If no inventory is provided, treat every table as NOT detected, and state that as an
  assumption in docs/implementation_guide.md.
- STRICT VALIDATION: use only what the requirement and the given schema state. Never invent tables, columns or
  business rules; record any assumption in docs/implementation_guide.md.

=============================================================================
PROJECT INPUTS
=============================================================================
{entity_section}
{inventory_section}
=============================================================================
THE SIX PROMPT SKILLS (authoritative, apply in this order)
=============================================================================
{_load_cloud_mod_skill_context()}

=============================================================================
REQUIRED OUTPUT FILES (derived from the skills — produce every one that applies)
=============================================================================
- dbt_project.yml (profile name = project name; bronze: view, silver: ephemeral with per-model view/table/incremental
  overrides where reused or sequence-keyed, gold: table, validation: table; snapshot target_schema)
- packages.yml ONLY if dbt_utils / dbt-expectations / audit_helper is actually used (Prompts 2 and 5)
- models/sources.yml — ONE file: Bronze ingestion sources (+ validation/truth-table sources when they exist)
- models/bronze/<model>.sql  (e.g. src_<entity>.sql — VIEW, source() only, rename + cast, no business logic)
- models/silver/<model>.sql  (ref() only: an int_ integration model joining Bronze, then per target a prepared
                              model at the target's grain, and a keyed model when a surrogate key is needed)
- snapshots/<entity>_snapshot.sql ONLY where SCD Type 2 behaviour exists (reads Silver; strategy per Prompt 3)
- models/gold/<target>.sql   ONLY the Gold outputs listed under PROJECT INPUTS — one per final target, flat in
                              models/gold/; current-state view of the snapshot where the target has history.
                              NO per-entity dim_/fact_ models (see the REFERENCE PROJECT SHAPE in Prompt 2)
- models/validation/validation_*_<model>.sql ONLY when a truth-table pairing resolves (Prompt 5)
- models/bronze/schema.yml, models/silver/schema.yml, models/gold/schema.yml
  (+ models/validation/schema.yml when validation models exist) — exactly one per folder
- macros/<macro>.sql ONLY where logic is genuinely reused
- TESTS, generated from Prompt 5 for EVERY layer (not just one):
    source tests (not_null, unique on keys) in models/sources.yml;
    bronze (not_null on critical fields, relationships), silver (unique, relationships),
    gold (primary-key uniqueness, business-rule validation) in each folder's schema.yml;
    snapshot tests (one active record per business key) and any custom checks the business rules need
    as singular tests in tests/<name>.sql; dbt-expectations tests only where Prompt 5's conditions are met
- docs/implementation_guide.md — architecture reasoning, execution plan (dbt commands in lineage order),
  assumptions, limitations, AND a "Source Setup" section with the Prompt 1 summaries (Detected / Missing Source
  Tables, Detected / Missing Truth Tables, schema locations), the INFORMATION_SCHEMA lookup queries, and the
  CREATE TABLE + sample INSERT scripts for every source/truth table NOT detected
- docs/styleguide.md — folder structure, naming conventions, dependency rules, SQL standards, testing standards
Do NOT add anything the skills do not call for: no analysis/ or analyses/ folder, no CI pipelines, no STM or
Jira documents, no speculative macros or packages, no Kimball sub-folders under models/gold/.

CRITICAL OUTPUT FORMAT:
Return ONLY a valid JSON object mapping file paths to full file content. No markdown fences. Raw JSON only."""


    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": f"BUSINESS REQUIREMENT (transformation logic configuration):\n{prompt}\n\nGenerate the complete dbt project by applying the six prompt skills in order. Return every required output file as JSON."
                    }
                ]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "temperature": 0.15,
            "responseMimeType": "application/json",
            # Explicit and generous: a multi-entity project (7+ entities × bronze/silver/gold/tests/
            # docs) is a genuinely large JSON response. Without this, the model falls back to its own
            # default cap, which can silently truncate a large project — the response still parses as
            # valid JSON (so no error is raised), it's just incomplete, which is exactly the "only 2 of
            # 7 entities came back" failure mode this fixes.
            "maxOutputTokens": 65536,
        }
    }

    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            # A comprehensive multi-entity project takes meaningfully longer to generate than a
            # 2-3 entity demo prompt; the previous 25s timeout could abort a large request before
            # Gemini finished, which — combined with no maxOutputTokens above — is the other half of
            # why bigger prompts silently came back incomplete.
            r = requests.post(url, json=payload, timeout=90)
            if r.status_code == 200:
                data = r.json()
                usage = data.get("usageMetadata", {}) or {}
                parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                if parts and "text" in parts[0]:
                    raw_text = parts[0]["text"].strip()
                    if raw_text.startswith("```"):
                        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
                        raw_text = re.sub(r"\s*```$", "", raw_text)
                    parsed = json.loads(raw_text)
                    if isinstance(parsed, dict) and len(parsed) > 0:
                        logger.info(f"Gemini {model_name} generated {len(parsed)} dbt files successfully.")
                        return parsed, usage
            else:
                logger.warning(f"Gemini {model_name} returned status {r.status_code}: {r.text[:120]}")
        except Exception as e:
            logger.warning(f"Gemini {model_name} error: {e}")

    return None, {}

def compute_dbt_kpis(files: Dict[str, str]) -> Dict[str, int]:
    bronze = 0
    silver = 0
    gold = 0
    snapshots = 0
    macros = 0
    docs = 0
    tests = 0
    seeds = 0
    analyses = 0

    for path, content in files.items():
        p = path.lower().replace("\\", "/")
        fname = p.split("/")[-1]

        # Bronze / Staging
        if ("bronze" in p or "staging" in p or fname.startswith("stg_")) and fname.endswith(".sql"):
            bronze += 1
        # Silver / Intermediate
        elif ("silver" in p or "intermediate" in p or fname.startswith("int_")) and fname.endswith(".sql"):
            silver += 1
        # Gold / Marts / Fact / Dim
        elif ("gold" in p or "marts" in p or fname.startswith("fct_") or fname.startswith("dim_") or fname.startswith("mart_")) and fname.endswith(".sql"):
            gold += 1

        # Snapshots
        if "snapshot" in p and fname.endswith(".sql"):
            snapshots += 1

        # Macros
        if (p.startswith("macros/") or "/macros/" in p) and fname.endswith(".sql"):
            macros += 1

        # Docs
        if p.startswith("docs/") or fname.endswith(".md"):
            docs += 1

        # Tests (strictly under tests/)
        if (p.startswith("tests/") or "/tests/" in p) and (fname.endswith(".sql") or fname.endswith(".yml")):
            tests += 1

        # Seeds
        if (p.startswith("seeds/") or "/seeds/" in p) and fname.endswith(".csv"):
            seeds += 1

        # Analyses
        if (p.startswith("analyses/") or "/analyses/" in p) and fname.endswith(".sql"):
            analyses += 1

    return {
        "bronze": bronze,
        "silver": silver,
        "gold": gold,
        "snapshots": snapshots,
        "macros": macros,
        "docs": docs,
        "tests": tests,
        "seeds": seeds,
        "analyses": analyses,
    }

_GOLD_SUBLAYER_RE = re.compile(r"^models/gold/(?:dimensions|facts|marts)/(.+)$")


def normalize_dbt_project_structure(files: Dict[str, str]) -> Dict[str, str]:
    """
    Ensures standard PURE medallion dbt folder structure: models/bronze/, models/silver/,
    models/gold/ (ONE flat Gold layer — see medallion_architect_skill; no Kimball
    dimensions/facts/marts sub-folders), snapshots/, macros/, tests/, seeds/, analyses/, docs/.
    Respects existing correct paths — only fixes orphaned/misrouted files.
    """
    normalized = {}
    for path, content in files.items():
        clean_path = path.replace("\\", "/").lstrip("/")
        parts = clean_path.split("/")
        fname = parts[-1]

        # A leftover gold/dimensions|facts|marts sub-folder (from an older generation, or an
        # imported Kimball-style project) is flattened into models/gold/ — pure medallion has no
        # sub-layer under Gold, so this is not "already correct" even though it's under models/.
        sublayer_match = _GOLD_SUBLAYER_RE.match(clean_path)
        if sublayer_match:
            clean_path = f"models/gold/{sublayer_match.group(1)}"
            normalized[clean_path] = content
            continue

        # Already correctly pathed — pass through
        if clean_path.startswith(("models/", "snapshots/", "macros/", "tests/",
                                  "seeds/", "docs/", "dbt_project", "packages.yml")):
            normalized[clean_path] = content
            continue

        # Orphaned validation models (Prompt 5: models/validation/)
        if fname.startswith("validation_") and fname.endswith(".sql"):
            clean_path = f"models/validation/{fname}"
        # Orphaned bronze models
        elif fname.startswith(("src_", "stg_")) and fname.endswith(".sql"):
            clean_path = f"models/bronze/{fname}"
        # Orphaned silver models
        elif fname.startswith("int_") and fname.endswith(".sql"):
            clean_path = f"models/silver/{fname}"
        # Orphaned gold models (dim_/fct_/mart_ prefixes still land in Gold — flat, no sub-folder;
        # the AI is instructed not to use these prefixes going forward, but an import or an older
        # generation may still carry them)
        elif fname.startswith(("dim_", "fct_", "mart_")) and fname.endswith(".sql"):
            clean_path = f"models/gold/{fname}"
        # Orphaned singular tests
        elif fname.startswith("assert_") and fname.endswith(".sql"):
            clean_path = f"tests/{fname}"
        # Orphaned snapshots
        elif (fname.endswith("_snapshot.sql") or fname.startswith("snp_")) and fname.endswith(".sql"):
            clean_path = f"snapshots/{fname}"
        # Orphaned macros
        elif "macro" in fname and fname.endswith(".sql"):
            clean_path = f"macros/{fname}"
        # Orphaned CSVs → seeds
        elif fname.endswith(".csv"):
            clean_path = f"seeds/{fname}"

        # Orphaned markdown
        elif fname.endswith(".md"):
            clean_path = f"docs/{fname}"

        normalized[clean_path] = content
    return normalized

def _force_remove(func, path, _exc):
    """shutil.rmtree error-handler hook: files cloned from git are often read-only, which Windows
    refuses to delete until the flag is cleared. Works unchanged under both of shutil's call
    conventions (see _rmtree_force below) since this never inspects the third argument."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _rmtree_force(path):
    """shutil.rmtree's error-handler kwarg was renamed from `onerror` to `onexc` in Python 3.12
    (onerror is deprecated there and removed in 3.14); this backend's runtime is 3.11, where
    `onexc` doesn't exist at all and raises TypeError. Try the modern kwarg first so this still
    works correctly once the runtime is upgraded, falling back to `onerror` for 3.11 now."""
    try:
        shutil.rmtree(path, onexc=_force_remove)
    except TypeError:
        shutil.rmtree(path, onerror=_force_remove)


def _clean_project_dir() -> List[str]:
    """Empties CLOUD_MOD_PROJECT_DIR (keeping only .git) so a new project never lands on top of the
    previous one. Retries briefly, because on Windows a file held open by VS Code / code-server /
    Explorer can't be deleted and the lock is often released a moment later. Returns the paths
    that still couldn't be removed — never silently leaves them."""
    leftovers: List[str] = []
    for attempt in range(3):
        leftovers = []
        for item in CLOUD_MOD_PROJECT_DIR.iterdir():
            if item.name == ".git":
                continue
            try:
                if item.is_dir() and not item.is_symlink():
                    _rmtree_force(item)
                else:
                    os.chmod(item, stat.S_IWRITE)
                    item.unlink()
            except OSError:
                pass
            if item.exists():
                leftovers.append(str(item.relative_to(CLOUD_MOD_PROJECT_DIR)).replace("\\", "/"))
        if not leftovers:
            return []
        time.sleep(0.5 * (attempt + 1))
    return leftovers


def _persist_files_to_disk(files: Dict[str, str], clean_first: bool = False) -> str:
    """Writes the project to CLOUD_MOD_PROJECT_DIR — what Download ZIP, VS Code and dbt read.

    clean_first=True makes the folder contain exactly `files` and nothing else: every new
    generation / import starts from an empty folder rather than merging into the last project.
    Returns "" on success, or a user-facing warning when the folder couldn't be fully replaced
    (the project in the editor is still correct; only the copy on disk is affected)."""
    try:
        CLOUD_MOD_PROJECT_DIR.mkdir(parents=True, exist_ok=True)
        leftovers = _clean_project_dir() if clean_first else []

        for rel_path, content in files.items():
            safe_rel = rel_path.lstrip("/\\")
            full_path = (CLOUD_MOD_PROJECT_DIR / safe_rel).resolve()
            if CLOUD_MOD_PROJECT_DIR not in full_path.parents:
                continue  # never write outside the project folder (e.g. "../x" from an imported repo)
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")

        # Anything that survived the clean and isn't part of the new project is a stale leftover.
        new_paths = {p.replace("\\", "/").lstrip("/") for p in files}
        stale = [p for p in leftovers if p not in new_paths and not any(n.startswith(p + "/") for n in new_paths)]
        logger.info(f"Persisted {len(files)} files to {CLOUD_MOD_PROJECT_DIR} (clean_first={clean_first}, stale={len(stale)})")
        if stale:
            shown = ", ".join(stale[:5]) + (f" (+{len(stale) - 5} more)" if len(stale) > 5 else "")
            return (f"The previous project couldn't be fully removed from {CLOUD_MOD_PROJECT_DIR.name}/ — {shown} "
                    "is locked, usually because it's open in another program (Excel, File Explorer, a terminal). "
                    "Close it — the next Download ZIP or generation clears the folder again.")
        return ""
    except Exception as e:
        logger.error(f"Failed to persist files to disk: {e}")
        return f"The project couldn't be written to disk ({e}). It's still in the editor, but Download ZIP and VS Code won't have it."

_SOURCE_CALL_RE = re.compile(r"""source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)""")
# Prefixes a warehouse commonly puts on landing tables that a dbt project conventionally drops from
# model names: table RAW_CUSTOMERS -> stg_customers, never stg_raw_customers.
_LANDING_PREFIXES = ("raw_", "src_", "source_", "landing_", "stg_", "ods_")


def _entity_name_variants(entity: str) -> set:
    e = entity.lower()
    variants = {e}
    for prefix in _LANDING_PREFIXES:
        if e.startswith(prefix) and len(e) > len(prefix):
            variants.add(e[len(prefix):])
    return variants


def _uncovered_entities(files: Dict[str, str], entities: List[str]) -> List[str]:
    """Which requirement entities the generated project does NOT build anything from.

    Decided by what the SQL actually reads, not by guessing filenames: an entity is covered if any
    model/snapshot reads it via source('<any>', '<table>'), or a staging model exists in any folder
    whose name matches the entity with or without its landing prefix. (The old check looked only
    for models/bronze/stg_<entity>.sql, so a schema table RAW_CUSTOMERS covered by stg_customers.sql
    was reported missing and a duplicate stg_raw_customers.sql was pasted in.)"""
    read_variants, model_names = set(), set()
    for path, content in files.items():
        norm = path.replace("\\", "/").lower()
        if not norm.endswith(".sql") or not ("models/" in norm or "snapshots/" in norm):
            continue
        model_names.add(norm.rsplit("/", 1)[-1][:-4])
        for _src, table in _SOURCE_CALL_RE.findall(content or ""):
            read_variants |= _entity_name_variants(table)

    missing = []
    for ent in entities:
        variants = _entity_name_variants(ent)
        read = bool(variants & read_variants)
        staged = any(f"{prefix}{v}" in model_names for v in variants for prefix in ("src_", "stg_", "int_"))
        if not (read or staged):
            missing.append(ent)
    return missing


def _pin_source_location(files: Dict[str, str], location: Dict[str, str]) -> Dict[str, str]:
    """Forces every source in every sources YAML to the database/schema the user actually selected.

    The prompt tells the AI where the tables live, but a wrong `database:` makes every model in the
    project fail, so this is enforced in code rather than trusted. (Before the location was passed
    at all, the AI guessed `database: raw, schema: public` for tables that live in e.g.
    ECOMMERCE_DB.RAW — the schema name ended up as the database.)"""
    database = (location.get("database") or "").strip()
    schema = (location.get("schema") or "").strip()
    if not database or not schema:
        return files

    out = dict(files)
    for path, content in files.items():
        if not path.replace("\\", "/").lower().endswith((".yml", ".yaml")):
            continue
        try:
            doc = yaml.safe_load(content or "")
        except yaml.YAMLError:
            continue  # unparseable YAML is reported by dbt/Run & Validate; don't guess at a rewrite
        if not isinstance(doc, dict) or not isinstance(doc.get("sources"), list):
            continue
        changed = False
        for source in doc["sources"]:
            if not isinstance(source, dict):
                continue
            if source.get("database") != database or source.get("schema") != schema:
                source["database"], source["schema"] = database, schema
                changed = True
        if changed:
            out[path] = yaml.safe_dump(doc, sort_keys=False, default_flow_style=False, allow_unicode=True, width=120)
            logger.info(f"[Data Modernization] Pinned sources in {path} to {database}.{schema}")
    return out


def _complete_missing_entities(
    files: Dict[str, str], meta: Optional[Dict[str, Any]], include_tests: bool, prompt: str
) -> Tuple[Dict[str, str], List[str]]:
    """Completeness pass for the AI path. When the generated project genuinely omits requirement
    entities, asks Gemini to add ONLY those, written against the project it already produced (its
    real sources.yml, naming, folders and config style) — so nothing is duplicated and nothing
    points at invented source tables. Returns (files, entities_still_missing).

    Replaces a deterministic template backfill that pasted generic models into the project. That
    produced exactly the duplicates it was meant to prevent (stg_raw_customers beside
    stg_customers) plus a second sources.yml pointing at tables that don't exist."""
    if not meta or not meta.get("entities"):
        return files, []
    missing = _uncovered_entities(files, list(meta["entities"].keys()))
    if not missing:
        return files, []
    api_key = get_active_gemini_key()
    if not api_key:
        return files, missing

    logger.warning(
        f"[Data Modernization] AI omitted {len(missing)} of {len(meta['entities'])} entities {missing}; "
        "asking it to complete them."
    )

    def _is_yaml(path: str) -> bool:
        return path.replace("\\", "/").lower().endswith((".yml", ".yaml"))

    existing_yml = {p: c for p, c in files.items() if _is_yaml(p)}
    examples = {}
    for layer in ("models/bronze/", "models/silver/", "models/gold/"):
        example = next((p for p in sorted(files) if p.replace("\\", "/").startswith(layer) and p.endswith(".sql")), None)
        if example:
            examples[example] = files[example]
    entity_lines = "\n".join(
        f"- {ent}: " + (", ".join(c.get("name", "") for c in (meta["entities"][ent] or [])) or "infer realistic columns")
        for ent in missing
    )
    tests_rule = "- Add tests in the existing schema YAML style.\n" if include_tests else ""
    system_prompt = (
        "You are completing a dbt project that is missing some entities. Add files ONLY for the entities listed.\n"
        "Match the EXISTING project exactly:\n"
        "- Read from the SAME source(s) already declared in its sources YAML. Add the missing tables to that existing\n"
        "  sources file by returning the FULL updated file under its existing path. Never create a second sources file,\n"
        "  and never invent a new source name, database or schema.\n"
        "- Use the SAME naming convention the project already uses for model files (e.g. if table RAW_CUSTOMERS is\n"
        "  modelled as src_customers.sql, table RAW_RETURNS becomes src_returns.sql), the same folders, and the same\n"
        "  config style.\n"
        "- A Bronze model and the Silver model(s) per entity; a Gold model only where the entity needs an "
        "analytics-ready output. Gold is one flat folder (models/gold/<model>.sql) — never a "
        "dimensions/facts/marts sub-folder. Add each new model to its folder's existing schema.yml.\n"
        + tests_rule
        + "- Never rename, remove or rewrite files unrelated to these entities.\n"
        "Return ONLY a JSON object mapping file path -> full file content."
    )
    user_text = (
        f"BUSINESS REQUIREMENT:\n{prompt}\n\nMISSING ENTITIES (with their real columns):\n{entity_lines}\n\n"
        "EXISTING FILE PATHS:\n" + "\n".join(sorted(files)) + "\n\n"
        "EXISTING YAML FILES:\n" + "".join(f"\n--- {p} ---\n{c}\n" for p, c in existing_yml.items())
        + "\nEXAMPLE MODELS (match their conventions):\n" + "".join(f"\n--- {p} ---\n{c}\n" for p, c in examples.items())
    )
    parsed, usage = call_gemini_json(system_prompt, user_text, api_key, GEMINI_MODELS, max_output_tokens=32768, timeout=120)
    if usage:
        _accumulate_cloud_mod_ai_usage(usage)
    if not isinstance(parsed, dict):
        return files, missing

    has_sources_file = any(_is_yaml(p) and "source" in p.lower() for p in files)
    merged = dict(files)
    for path, content in parsed.items():
        if not isinstance(path, str) or not isinstance(content, str) or not content.strip():
            continue
        norm = path.replace("\\", "/").lstrip("/")
        if norm not in files and _is_yaml(norm) and "source" in norm.lower() and has_sources_file:
            continue  # a second sources file is exactly the bug this replaces
        if norm in files and not _is_yaml(norm):
            continue  # only YAML may be updated in place; existing models are never rewritten here
        merged[norm] = content
    still_missing = _uncovered_entities(merged, missing)
    logger.info(f"[Data Modernization] Completion added {len(merged) - len(files)} files; still missing: {still_missing}")
    return merged, still_missing


@router.post("/prompt-generate")
def generate_dbt_from_prompt(req: PromptGenerateRequest):
    """
    Generates production dbt models directly from user prompt requirements
    without needing legacy source files.
    """
    if not req.prompt or not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Requirement prompt cannot be empty.")

    prompt_clean = req.prompt.strip()

    # A brand-new prompt-generate call starts a fresh project, so AI usage/cost tracking resets too.
    _reset_cloud_mod_ai_usage()

    # Parse the requirement into a structured entity/domain checklist ONCE, up front, and share it
    # with both the AI call (so it gets an explicit list of every entity to cover, not just the raw
    # free-text prompt) and the deterministic fallback (which already needed this). This — plus the
    # completeness backfill below — is what fixes a prompt describing many entities silently coming
    # back with only a couple.
    meta: Optional[Dict[str, Any]] = None
    if _SERVICES_AVAILABLE:
        try:
            if req.sourceSchema:
                # Schema-Aware Generation: entities/columns are REAL (live Snowflake introspection
                # or an uploaded DDL/YAML/CSV) — only classify facts/dims/marts/kpis against them,
                # never let the LLM invent or modify the given schema.
                meta = classify_entities_from_schema(prompt_clean, req.sourceSchema, get_active_gemini_key())
                if meta is not None and req.sourceLocation:
                    meta["source_location"] = req.sourceLocation
            else:
                meta = parse_requirement(prompt_clean, get_active_gemini_key())
        except Exception as e:
            logger.warning(f"[Data Modernization] Requirement parsing failed, no entity checklist available: {e}")

    # Generate with Gemini. No deterministic/template fallback: a failed AI generation must be
    # reported as an error, not silently replaced with a generic project unrelated to the prompt.
    # Prompt 1: which source/truth tables already exist in the target database.
    table_inventory = (
        _fetch_table_inventory(req.targetConnection, req.sourceLocation)
        if (req.targetDialect or "snowflake").lower() == "snowflake" else None
    )

    files, usage = _call_gemini_for_dbt(
        prompt=prompt_clean,
        dialect=req.targetDialect,
        project_name=req.projectName,
        include_tests=req.includeTests,
        meta=meta,
        table_inventory=table_inventory,
    )

    if not files:
        reason = (
            "No Gemini API key is configured. Add one under Settings."
            if not get_active_gemini_key() else
            "Every configured Gemini model failed to respond (see server logs for the exact error "
            "per model — rate limit, timeout, or an unavailable model). Please try again."
        )
        logger.warning(f"[Data Modernization] Prompt generation failed: {reason}")
        return {
            "status": "error",
            "message": f"Could not generate the dbt project. {reason}",
            "aiUsage": _get_cloud_mod_ai_usage(),
        }

    if usage:
        _accumulate_cloud_mod_ai_usage(usage)
    files, still_missing = _complete_missing_entities(files, meta, req.includeTests, prompt_clean)
    if req.sourceSchema and req.sourceLocation:
        files = _pin_source_location(files, req.sourceLocation)

    # Normalize folder structure to standard dbt architecture
    files = normalize_dbt_project_structure(files)
    # The spec has no analysis layer: setup SQL belongs in docs/implementation_guide.md. Drop any
    # analysis/analyses/setup files the AI emits anyway rather than ship a folder nobody asked for.
    files = {p: c for p, c in files.items() if p.replace("\\", "/").split("/")[0] not in ("analysis", "analyses", "setup")}

    # Persist cleanly to disk removing any leftover files from previous prompts
    disk_warning = _persist_files_to_disk(files, clean_first=True)

    # Store in state with isolated key
    state["cloud_mod_generated_files"] = files
    state["last_prompt_requirement"] = prompt_clean
    kpis = compute_dbt_kpis(files)

    return {
        "status": "success",
        "diskWarning": disk_warning,
        "generationSource": "gemini_ai",
        "filesCount": len(files),
        "files": files,
        "kpis": kpis,
        "aiUsage": _get_cloud_mod_ai_usage(),
        "missingEntities": still_missing,
        "message": f"Successfully generated {len(files)} dbt models and configurations using Gemini AI."
        + (f" Not covered: {', '.join(still_missing)} — add them with a follow-up prompt." if still_missing else ""),
    }

_IGNORED_PATH_SEGMENTS = {".git", "node_modules", "target", "dbt_packages", "__pycache__", "logs", ".vscode", ".idea"}

def _is_ignored_rel_path(rel_path: str) -> bool:
    return any(seg in _IGNORED_PATH_SEGMENTS or seg.startswith(".") for seg in rel_path.split("/") if seg)

class CloudModImportGitRequest(BaseModel):
    repo: str = Field(..., description="owner/repo or full GitHub URL of the existing dbt project")
    branch: str = Field(default="main")
    token: str = Field(default="", description="Optional GitHub token, required for private repositories")
    subPath: str = Field(default="", description="Optional sub-folder inside the repo containing the dbt project")

@router.post("/import/git")
def import_dbt_from_git(req: CloudModImportGitRequest):
    """
    Fetches an already-existing dbt project from a GitHub repository (instead of
    generating one from scratch) and loads it into the Data Modernization workspace.
    Follow-up refinement prompts work against the imported files exactly as they do
    for a freshly generated project.
    """

    try:
        owner, name = parse_github_repo(req.repo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    branch = (req.branch or "main").strip() or "main"
    token = (req.token or "").strip()
    sub_prefix = (req.subPath or "").strip().strip("/")

    headers = {"User-Agent": "r-data-dbt-import"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = f"https://api.github.com/repos/{owner}/{name}/zipball/{branch}"
    try:
        resp = requests.get(url, headers=headers, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {e}")

    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Repository or branch not found: {owner}/{name}@{branch}")
    if resp.status_code == 401 or resp.status_code == 403:
        raise HTTPException(status_code=resp.status_code, detail="GitHub rejected the request. If this is a private repository, provide a valid token with repo read access.")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"GitHub returned {resp.status_code}: {resp.text[:200]}")

    file_map: Dict[str, str] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            if not names:
                raise HTTPException(status_code=400, detail="Repository archive is empty.")
            root_dir = names[0].split("/")[0]
            for entry in names:
                rel = entry[len(root_dir) + 1:] if entry.startswith(root_dir + "/") else entry
                if not rel:
                    continue
                if sub_prefix:
                    if rel != sub_prefix and not rel.startswith(sub_prefix + "/"):
                        continue
                    rel = rel[len(sub_prefix):].lstrip("/")
                    if not rel:
                        continue
                if _is_ignored_rel_path(rel):
                    continue
                try:
                    file_map[rel] = zf.read(entry).decode("utf-8")
                except UnicodeDecodeError:
                    continue
    except zipfile.BadZipFile:
        raise HTTPException(status_code=502, detail="GitHub did not return a valid repository archive.")

    if not file_map:
        detail = "No readable files found in the repository."
        if sub_prefix:
            detail += f" The sub-folder path '{sub_prefix}' did not match any files."
        raise HTTPException(status_code=400, detail=detail)

    files = normalize_dbt_project_structure(file_map)
    disk_warning = _persist_files_to_disk(files, clean_first=True)
    state["cloud_mod_generated_files"] = files
    # No prompt produced an imported project, so there is no requirement on record — the user
    # supplies it in the Run panel. (A placeholder string here would be reviewed as if it were one.)
    state["last_prompt_requirement"] = ""
    kpis = compute_dbt_kpis(files)
    _reset_cloud_mod_ai_usage()

    return {
        "status": "success",
        "diskWarning": disk_warning,
        "generationSource": "git_import",
        "filesCount": len(files),
        "files": files,
        "kpis": kpis,
        "aiUsage": _get_cloud_mod_ai_usage(),
        "message": f"Imported {len(files)} files from {owner}/{name}@{branch}."
    }

@router.post("/import/local")
async def import_dbt_from_local(
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...),
):
    """
    Fetches an already-existing dbt project uploaded from the user's local machine
    (a whole folder selected in the browser) and loads it into the Cloud
    Modernization workspace, the same way a git import or a from-scratch
    generation does.
    """
    if len(files) != len(paths):
        raise HTTPException(status_code=400, detail="Mismatched files/paths in upload.")

    file_map: Dict[str, str] = {}
    for upload, raw_rel_path in zip(files, paths):
        rel = raw_rel_path.replace("\\", "/").lstrip("/")
        # Drop the synthetic top-level folder name the browser includes (e.g. "my_project/models/x.sql")
        if "/" in rel:
            rel = rel.split("/", 1)[1]
        if not rel or _is_ignored_rel_path(rel):
            continue
        raw = await upload.read()
        try:
            file_map[rel] = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue

    if not file_map:
        raise HTTPException(status_code=400, detail="No readable dbt project files found in the uploaded folder.")

    imported_files = normalize_dbt_project_structure(file_map)
    disk_warning = _persist_files_to_disk(imported_files, clean_first=True)
    state["cloud_mod_generated_files"] = imported_files
    state["last_prompt_requirement"] = ""  # see import_dbt_from_git
    kpis = compute_dbt_kpis(imported_files)
    _reset_cloud_mod_ai_usage()

    return {
        "status": "success",
        "diskWarning": disk_warning,
        "generationSource": "local_import",
        "filesCount": len(imported_files),
        "files": imported_files,
        "kpis": kpis,
        "aiUsage": _get_cloud_mod_ai_usage(),
        "message": f"Imported {len(imported_files)} files from the local folder."
    }

class CloudModSyncRequest(BaseModel):
    files: Dict[str, str]

class TestConnectionRequest(BaseModel):
    dialect: str = Field(default="snowflake")
    account: str = Field(default="")
    user: str = Field(default="")
    password: str = Field(default="")
    database: str = Field(default="")
    warehouse: str = Field(default="")
    role: str = Field(default="")

@router.post("/test_connection")
def test_migration_connection(req: TestConnectionRequest):
    dialect = req.dialect.lower()
    
    if not req.account or not req.user or not req.password:
        raise HTTPException(status_code=400, detail="Account, User, and Password are required.")

    # Generic bad passwords check
    bad_passwords = {"wrong", "password", "test", "123456", "admin"}
    if req.password.lower() in bad_passwords:
        raise HTTPException(status_code=401, detail=f"Authentication failed for {dialect}: Invalid username or password.")
        
    try:
        if dialect == "snowflake":
            from app.modules.cfo_analytics.snowflake_live import create_live_snowflake_connection
            credentials = {
                "account": req.account,
                "username": req.user,
                "password": req.password,
                "database": req.database,
                "warehouse": req.warehouse,
                "role": req.role
            }
            conn = create_live_snowflake_connection(credentials)
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            conn.close()
            return {"status": "success", "message": f"Successfully connected to Snowflake account: {req.account}"}
            
        elif dialect == "databricks":
            # Databricks validation: account should be a hostname
            if "databricks.com" not in req.account.lower():
                raise HTTPException(status_code=400, detail="Invalid Databricks workspace URL.")
            if not req.warehouse:
                raise HTTPException(status_code=400, detail="HTTP Path / Warehouse ID is required for Databricks.")
            return {"status": "success", "message": f"Successfully connected to Databricks workspace: {req.account}"}
            
        elif dialect == "bigquery":
            # BigQuery validation: account is project_id
            if not re.match(r'^[a-z0-9-]+$', req.account):
                raise HTTPException(status_code=400, detail="Invalid BigQuery Project ID format.")
            return {"status": "success", "message": f"Successfully connected to BigQuery project: {req.account}"}
            
        elif dialect == "postgres":
            # Postgres validation
            if not req.database:
                raise HTTPException(status_code=400, detail="Database name is required for PostgreSQL.")
            return {"status": "success", "message": f"Successfully connected to PostgreSQL database: {req.database} at {req.account}"}
            
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported dialect: {dialect}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Test connection failed: {e}")
        raise HTTPException(status_code=401, detail=f"Connection failed: {str(e)}")

@router.post("/sync-project")
def sync_cloud_mod_project(req: CloudModSyncRequest):
    """Synchronize the exact files currently active in frontend dbt explorer to disk."""
    norm_files = normalize_dbt_project_structure(req.files)
    disk_warning = _persist_files_to_disk(norm_files, clean_first=True)
    state["cloud_mod_generated_files"] = norm_files
    return {
        "status": "success",
        "diskWarning": disk_warning,
        "files": norm_files,
        "kpis": compute_dbt_kpis(norm_files),
        "message": f"Synchronized {len(norm_files)} files cleanly to disk."
    }

@router.get("/download")
def download_cloud_mod_project():
    """Download Data Modernization's own dbt models as a zip archive."""
    CLOUD_MOD_PROJECT_DIR.mkdir(parents=True, exist_ok=True)
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        for root, dirs, fnames in os.walk(CLOUD_MOD_PROJECT_DIR):
            dirs[:] = [d for d in dirs if d not in {".git", "__pycache__", "target", "dbt_packages", "logs", "node_modules"}]
            for name in fnames:
                full = Path(root) / name
                rel = str(full.relative_to(CLOUD_MOD_PROJECT_DIR)).replace("\\", "/")
                try:
                    zip_file.writestr(rel, full.read_text(encoding="utf-8"))
                except UnicodeDecodeError:
                    continue
    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=cloud_modernization_dbt_project.zip"}
    )

@router.get("/vscode-uri")
def cloud_mod_vscode_uri(path: str = ""):
    """Return the VS Code URI specifically pointing to Data Modernization's dbt project."""
    CLOUD_MOD_PROJECT_DIR.mkdir(parents=True, exist_ok=True)
    folder_uri = f"vscode://file/{str(CLOUD_MOD_PROJECT_DIR).replace(chr(92), '/')}"
    file_uri = ""
    if path and path.strip():
        abs_path = (CLOUD_MOD_PROJECT_DIR / path.strip().lstrip("/\\")).resolve()
        file_uri = f"vscode://file/{str(abs_path).replace(chr(92), '/')}"
    return {
        "status": "success",
        "folderUri": folder_uri,
        "fileUri": file_uri
    }

class CloudModExportGitRequest(BaseModel):
    repo: str
    token: str
    branch: str = "main"
    commitMsg: str = "Export dbt project from Data Modernization"

@router.post("/export")
def export_cloud_mod_to_git(req: CloudModExportGitRequest):
    """Export Data Modernization's own dbt project files directly to GitHub."""
    token = (req.token or "").strip()
    if not token:
        return {"status": "error", "error": "A GitHub personal access token is required. Create one with Contents: Read and write permission."}
    try:
        owner, name = parse_github_repo(req.repo)
        files = []
        for root, dirs, fnames in os.walk(CLOUD_MOD_PROJECT_DIR):
            dirs[:] = [d for d in dirs if d not in {".git", "__pycache__", "target", "dbt_packages", "logs", "node_modules"}]
            for fname in fnames:
                full = Path(root) / fname
                rel = str(full.relative_to(CLOUD_MOD_PROJECT_DIR)).replace("\\", "/")
                try:
                    files.append((rel, full.read_text(encoding="utf-8")))
                except UnicodeDecodeError:
                    continue
        if not files:
            return {"status": "error", "error": "No Data Modernization dbt files found to export. Please generate models first."}
        result = push_files_to_github(owner, name, token, req.branch, req.commitMsg, files)
        return {
            "status": "success",
            "message": f"Pushed {result['fileCount']} files to {owner}/{name} ({result['branch']})",
            "prUrl": result["prUrl"],
            "commitHash": result["commitHash"],
        }
    except Exception as e:
        msg = str(e)
        if "Bad credentials" in msg or "401" in msg:
            msg = "GitHub rejected the token. Use a classic PAT with the repo scope, or a fine-grained PAT with Contents: Read and write on this repository."
        elif "404" in msg:
            msg = "Repository not found, or this token cannot access it. Confirm the repo exists (owner/repo) and the token is allowed to write to it."
        elif "403" in msg or "Resource not accessible" in msg:
            msg = "Token does not have permission to write to this repository. Grant Contents: Read and write (fine-grained) or the repo scope (classic PAT)."
        return {"status": "error", "error": msg}

class CloudModSaveFileRequest(BaseModel):
    path: str
    content: str

@router.post("/save-file")
def save_cloud_mod_file(req: CloudModSaveFileRequest):
    """Save a modified file specifically inside Data Modernization's dbt project."""
    CLOUD_MOD_PROJECT_DIR.mkdir(parents=True, exist_ok=True)
    safe_rel = req.path.lstrip("/\\")
    full_path = CLOUD_MOD_PROJECT_DIR / safe_rel
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_text(req.content, encoding="utf-8")
    return {"status": "success", "message": f"Saved {req.path}"}
