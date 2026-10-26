"""
Business Requirement Parser (Domain-Aware)
Uses Gemini to extract structured metadata (Domain, Entities, Facts, Dimensions, Snapshots, Marts) 
from the user prompt exactly in the JSON structure required.
"""
import json
import re
import requests
import logging
from typing import Dict, Any

from app.services.gemini_retry_client import resolve_models

logger = logging.getLogger(__name__)

GEMINI_MODELS = resolve_models(["gemini-3.6-flash", "gemini-3-flash-preview"])  # gemini-2.5-flash retired 2026-09

def parse_requirement(prompt: str, api_key: str = "") -> Dict[str, Any]:
    if not api_key:
        logger.warning("No API key for domain-aware parser. Falling back to default retail.")
        return _default_retail_meta()

    system_prompt = """You are a Principal Data Architect. Your job is to read a business requirement for a data warehouse / dbt project and extract the architectural metadata as strict JSON.
You must return ONLY a JSON object. No markdown, no conversational text.

Output JSON Schema:
{
  "domain": "string (e.g. healthcare, retail, finance, hr, crm, etc)",
  "entities": {
    "entity_name_1": [{"name": "col_1", "type": "VARCHAR(64)", "desc": "description", "pk": true, "fk": false, "nullable": false, "ts": false}, ...],
    "entity_name_2": [...]
  },
  "facts": ["transactional_output_name_1", ...],
  "dimensions": ["descriptive_output_name_1", ...],
  "snapshots": ["snapshot_name_1", ...],
  "marts": ["aggregated_output_name_1", ...],
  "kpis": ["revenue", "clv", "churn_rate", ...],
  "seeds_required": ["lookup_table_1", ...],
  "tests_required": ["test_positive_revenue", ...],
  "incremental_required": true/false,
  "snapshots_required": true/false,
  "gold_outputs": [{"name": "final target table name, e.g. dim_customer_profile_scd2 or sales_performance",
                     "description": "what consumers get from it", "grain": "one row per ...",
                     "fromSnapshot": true/false}],
  "business_rules": [{"rule": "exact business rule, in the prompt's own words", "appliesTo": "the fact/dim/mart it constrains, or entity name",
                       "layer": "silver|gold"}, ...]
}

RULES for Schema Extraction:
1. "entities": List the raw source entities (e.g. patients, claims, providers). Do not prefix them with stg_ or int_.
2. "entities" columns: Provide 5 to 10 standard columns for each entity, including a primary key ("pk": true), any foreign keys ("fk": true), and timestamp columns ("ts": true).
3-5. "facts", "dimensions", "marts" are the FINAL Gold tables only — what the requirement explicitly asks consumers
   to query (reports, KPI/metric tables, reporting dimensions/facts). They are NOT one-per-entity: an entity that only
   feeds other outputs goes in NONE of these lists (it stops at Silver). If the requirement only asks for, say, a
   sales performance report, marts = ["sales_performance"] and facts/dimensions may be empty.
3. "facts": final transactional/measurable Gold tables the requirement asks for (e.g. sales) — plain business
   names, no prefixes (they become fact_<name>).
4. "dimensions": final reporting dimensions the requirement asks for (e.g. customers) — plain business names,
   no prefixes (they become dim_<name>).
5. "marts": List aggregated Gold outputs built on top of facts/dimensions (e.g. hospital_performance) — business-meaningful name, no mart_ prefix.
6. "snapshots": List snapshots if historical tracking, SCD, or audit is mentioned.
7. DO NOT MIX DOMAINS. If the prompt is healthcare, DO NOT output retail entities (customers, orders) unless explicitly asked.
GOLD_OUTPUTS RULE (most important): "gold_outputs" lists the FINAL target tables the requirement asks the pipeline
to deliver — usually very few (often exactly one per requested report/target). Each becomes the ONLY Gold model(s).
  - Name it after the target the requirement names (e.g. "customer profile with history" -> dim_customer_profile_scd2;
    "sales performance report" -> sales_performance). Never a source table name, never raw_/src_/stg_/int_.
  - Do NOT add a Gold output per entity. Entities that only feed a target stop at Silver.
  - fromSnapshot = true when the target tracks history (SCD Type 2): it is the current-state view of a snapshot.
8. "business_rules": THIS IS MANDATORY, not optional. Read the ENTIRE prompt sentence by sentence and extract every
   filter, exclusion, formula, calculation, threshold, grain/breakdown requirement, and named metric definition as its
   own rule — even ones stated in passing. Quote the rule close to the prompt's own wording; do not summarize away a
   number, column name, or condition. A prompt with no such statements returns an empty list — never invent a rule.
"""

    payload = {
        "contents": [{"parts": [{"text": f"Business Requirement:\n{prompt}"}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
    }

    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            r = requests.post(url, json=payload, timeout=25)
            if r.status_code == 200:
                data = r.json()
                parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                if parts and "text" in parts[0]:
                    raw_text = parts[0]["text"].strip()
                    if raw_text.startswith("```"):
                        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
                        raw_text = re.sub(r"\s*```$", "", raw_text)
                    parsed = json.loads(raw_text)
                    
                    # Ensure minimum structure
                    parsed.setdefault("entities", {})
                    parsed.setdefault("facts", [])
                    parsed.setdefault("dimensions", [])
                    parsed.setdefault("marts", [])
                    parsed.setdefault("snapshots", [])
                    parsed.setdefault("kpis", [])
                    parsed.setdefault("seeds_required", [])
                    parsed.setdefault("tests_required", [])
                    parsed["business_rules"] = _clean_business_rules(parsed.get("business_rules"))
                    parsed["gold_outputs"] = _clean_gold_outputs(parsed.get("gold_outputs"))
                    return parsed
        except Exception as e:
            logger.warning(f"Gemini {model_name} error in parse_requirement: {e}")

    return _default_retail_meta()


def _clean_gold_outputs(raw: Any) -> list:
    out = []
    for entry in raw or []:
        if isinstance(entry, str) and entry.strip():
            entry = {"name": entry}
        if isinstance(entry, dict) and str(entry.get("name", "")).strip():
            out.append({
                "name": str(entry["name"]).strip(),
                "description": str(entry.get("description", "")).strip(),
                "grain": str(entry.get("grain", "")).strip(),
                "fromSnapshot": bool(entry.get("fromSnapshot")),
            })
    return out


def _clean_business_rules(raw: Any) -> list:
    """Normalizes the AI's business_rules field to a consistent shape and drops anything without
    real rule text, so a malformed entry can't silently disappear the whole list downstream."""
    out = []
    for entry in raw or []:
        if isinstance(entry, str) and entry.strip():
            out.append({"rule": entry.strip(), "appliesTo": "", "layer": ""})
        elif isinstance(entry, dict) and str(entry.get("rule", "")).strip():
            out.append({
                "rule": str(entry["rule"]).strip(),
                "appliesTo": str(entry.get("appliesTo", "")).strip(),
                "layer": str(entry.get("layer", "")).strip().lower(),
            })
    return out

def classify_entities_from_schema(prompt: str, real_entities: Dict[str, Any], api_key: str = "") -> Dict[str, Any]:
    """
    Schema-Aware variant of parse_requirement(). The caller already knows the REAL source
    entities/columns (introspected live from Snowflake, or parsed from an uploaded DDL/YAML/CSV
    file) — so this does NOT ask Gemini to invent entities or columns. It only classifies which
    of the given entities are facts/dimensions, what marts/kpis/tests the prompt implies, and
    whether snapshots/incremental loads are needed, constrained to the real entity names.

    Falls back to a deterministic classification (no AI) if no API key or the call fails, so
    Schema-Aware Generation never depends on Gemini being available.
    """
    entity_names = list(real_entities.keys())

    if not api_key:
        logger.warning("No API key for schema-aware classifier. Using deterministic classification.")
        return _default_schema_classification(entity_names, real_entities)

    system_prompt = """You are a Principal Data Architect. You are given the REAL source entities and columns of an
existing database (already introspected — do NOT invent, rename, or add columns to them) and a business requirement
prompt. Your job is to classify these entities into a medallion architecture and extract KPIs/tests as strict JSON.

Output JSON Schema:
{
  "domain": "string (e.g. healthcare, retail, finance, hr, crm, etc)",
  "facts": ["transactional_output_name_1", ...],
  "dimensions": ["descriptive_output_name_1", ...],
  "snapshots": ["snapshot_name_1", ...],
  "marts": ["aggregated_output_name_1", ...],
  "kpis": ["revenue", "clv", "churn_rate", ...],
  "seeds_required": ["lookup_table_1", ...],
  "tests_required": ["test_positive_revenue", ...],
  "incremental_required": true/false,
  "snapshots_required": true/false,
  "gold_outputs": [{"name": "final target table name, e.g. dim_customer_profile_scd2 or sales_performance",
                     "description": "what consumers get from it", "grain": "one row per ...",
                     "fromSnapshot": true/false}],
  "business_rules": [{"rule": "exact business rule, in the prompt's own words", "appliesTo": "the real entity/fact/mart it constrains",
                       "layer": "silver|gold"}, ...]
}

RULES:
1. Do NOT output an "entities" key — the entities and their columns are already fixed and provided separately.
2. "facts", "dimensions" and "marts" are the FINAL Gold tables only — what the requirement explicitly asks
   consumers to query. They are NOT one-per-entity: most source entities only feed those outputs and stop at
   Silver, so they appear in NONE of these lists. Use plain business names without any source/landing prefix
   (entity "raw_orders" -> fact "orders"); never return a physical source table name (raw_*, src_*, stg_*) —
   facts become fact_<name>, dimensions dim_<name>.
3. "marts" are the requested aggregated/report outputs (e.g. "sales_performance").
4. "snapshots": only list these if historical tracking, SCD, or audit is mentioned in the prompt.
5. Base your classification on both the real column names/types given AND the business requirement prompt.
GOLD_OUTPUTS RULE (most important): "gold_outputs" lists the FINAL target tables the requirement asks the pipeline
to deliver — usually very few (often exactly one per requested report/target). Each becomes the ONLY Gold model(s).
  - Name it after the target the requirement names (e.g. "customer profile with history" -> dim_customer_profile_scd2;
    "sales performance report" -> sales_performance). Never a source table name, never raw_/src_/stg_/int_.
  - Do NOT add a Gold output per entity. Entities that only feed a target stop at Silver.
  - fromSnapshot = true when the target tracks history (SCD Type 2): it is the current-state view of a snapshot.
6. "business_rules": THIS IS MANDATORY, not optional. Read the ENTIRE prompt sentence by sentence and extract every
   filter, exclusion, formula, calculation, threshold, grain/breakdown requirement, and named metric definition as its
   own rule, referencing the given real column names wherever the rule names a column. A prompt with no such
   statements returns an empty list — never invent a rule.
"""

    entity_summary = {
        ent: [{"name": c.get("name"), "type": c.get("type"), "pk": c.get("pk", False)} for c in cols]
        for ent, cols in real_entities.items()
    }

    user_text = (
        f"Real source entities and columns (fixed, do not modify):\n{json.dumps(entity_summary, indent=2)}\n\n"
        f"Business Requirement:\n{prompt}"
    )

    payload = {
        "contents": [{"parts": [{"text": user_text}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
    }

    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            r = requests.post(url, json=payload, timeout=25)
            if r.status_code == 200:
                data = r.json()
                parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                if parts and "text" in parts[0]:
                    raw_text = parts[0]["text"].strip()
                    if raw_text.startswith("```"):
                        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
                        raw_text = re.sub(r"\s*```$", "", raw_text)
                    parsed = json.loads(raw_text)

                    parsed["entities"] = real_entities
                    parsed.setdefault("facts", [])
                    parsed.setdefault("dimensions", [])
                    parsed.setdefault("marts", [])
                    parsed.setdefault("snapshots", [])
                    parsed.setdefault("kpis", [])
                    parsed.setdefault("seeds_required", [])
                    parsed.setdefault("tests_required", [])
                    parsed.setdefault("incremental_required", True)
                    parsed.setdefault("snapshots_required", bool(parsed["snapshots"]))
                    parsed["business_rules"] = _clean_business_rules(parsed.get("business_rules"))
                    parsed["gold_outputs"] = _clean_gold_outputs(parsed.get("gold_outputs"))
                    return parsed
        except Exception as e:
            logger.warning(f"Gemini {model_name} error in classify_entities_from_schema: {e}")

    return _default_schema_classification(entity_names, real_entities)


def _default_schema_classification(entity_names: list, real_entities: Dict[str, Any]) -> Dict[str, Any]:
    """No-AI fallback: every real entity becomes both a dimension and, if it looks transactional
    (has a numeric/amount-like column), a fact — so Schema-Aware Generation still produces a
    complete medallion project even without Gemini available. Names carry no fct_/dim_/mart_
    prefix: this project is pure medallion, and the router flattens these into one Gold layer."""
    facts, dimensions = [], []
    for ent, cols in real_entities.items():
        is_transactional = any(
            c.get("name", "").lower() in ("amount", "total", "quantity", "qty", "price", "value")
            or "amount" in c.get("name", "").lower()
            for c in cols
        )
        # Without AI there is no way to tell which entities the requirement wants as final outputs,
        # so only transactional entities become Gold facts; reference entities stay in Silver
        # instead of each getting a pass-through Gold dimension.
        if is_transactional:
            facts.append(ent)
    return {
        "domain": "general",
        "entities": real_entities,
        "facts": facts,
        "dimensions": dimensions,
        "marts": [f"{entity_names[0]}_summary"] if entity_names else [],
        "snapshots": [],
        "kpis": [],
        "seeds_required": [],
        "tests_required": [],
        "incremental_required": True,
        "snapshots_required": False,
        "business_rules": [],  # no AI available to extract these from the prompt text
    }


def _default_retail_meta() -> Dict[str, Any]:
    return {
        "domain": "retail",
        "entities": {
            "customers": [], "orders": [], "products": []
        },
        "facts": ["sales_summary"],
        "dimensions": ["customers", "products", "dates"],
        "marts": ["customer_kpis"],
        "snapshots": [],
        "kpis": ["revenue"],
        "seeds_required": ["order_status_lookup"],
        "tests_required": ["revenue_positive"],
        "incremental_required": True,
        "snapshots_required": False,
        "business_rules": [],  # no AI available to extract these from the prompt text
    }
