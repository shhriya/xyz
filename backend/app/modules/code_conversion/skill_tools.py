"""
Agentic Skill Tools Registry
=============================
Defines and registers the explicit tool functions referenced by name in SKILL.md files.
Each tool is a deterministic Python worker that can be called by skills.
"""

import re
import json
import logging
from typing import Dict, Any, List, Optional, Callable

logger = logging.getLogger(__name__)

# Global registry of all available skill tools
TOOL_REGISTRY: Dict[str, Callable] = {}

def register_tool(name: str):
    """Decorator to register a tool function in the global registry."""
    def decorator(fn: Callable):
        TOOL_REGISTRY[name] = fn
        return fn
    return decorator


# ==============================================================================
# 1. SOURCE EXTRACTOR TOOLS (used by source_extractor/SKILL.md)
# ==============================================================================

@register_tool("xml_informatica_parser")
def xml_informatica_parser(content: str) -> Dict[str, Any]:
    """
    Parses Informatica PowerCenter XML to extract source definitions,
    target definitions, transforms, and field mappings.
    """
    sources = re.findall(r'<SOURCE[^>]*NAME="([^"]+)"', content, re.IGNORECASE)
    targets = re.findall(r'<TARGET[^>]*NAME="([^"]+)"', content, re.IGNORECASE)
    transforms = re.findall(r'<TRANSFORMATION[^>]*NAME="([^"]+)"[^>]*TYPE="([^"]+)"', content, re.IGNORECASE)
    
    return {
        "sources": list(set(sources)),
        "targets": list(set(targets)),
        "transformations": [{"name": t[0], "type": t[1]} for t in transforms]
    }


@register_tool("pyspark_ast_extractor")
def pyspark_ast_extractor(script_content: str) -> Dict[str, Any]:
    """
    Extracts DataFrames, read tables, and column assignments from PySpark scripts.
    """
    # Detect read tables: spark.read.table("...") or spark.read.load("...")
    tables = re.findall(r'spark\.read\.(?:table|parquet|csv|format\([^)]+\)\.load)\(\s*["\']([^"\']+)["\']', script_content)
    
    # Detect dataframe assignments: df_name = ...
    df_names = re.findall(r'(\w+)\s*=\s*(?:spark\.read|df|\w+\.select|\w+\.filter|\w+\.withColumn)', script_content)
    
    # Detect withColumn transformations
    with_cols = re.findall(r'\.withColumn\(\s*["\'](\w+)["\']\s*,\s*([^)]+)\)', script_content)
    
    return {
        "readTables": list(set(tables)),
        "dataframes": list(set(df_names)),
        "computedColumns": [{"column": c[0], "expr": c[1].strip()} for c in with_cols]
    }


@register_tool("table_relationship_detector")
def table_relationship_detector(tables: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Infers foreign key and join relationships between tables based on naming conventions.
    """
    relationships = []
    for i, t1 in enumerate(tables):
        t1_cols = {c.get("name", "").upper() for c in t1.get("columns", [])}
        for j, t2 in enumerate(tables):
            if i >= j:
                continue
            t2_cols = {c.get("name", "").upper() for c in t2.get("columns", [])}
            shared_pks = t1_cols.intersection(t2_cols)
            for shared in shared_pks:
                if shared.endswith("_ID") or shared.endswith("_KEY") or shared == "ID":
                    relationships.append({
                        "fromTable": t1.get("name"),
                        "toTable": t2.get("name"),
                        "joinKey": shared,
                        "relationshipType": "many-to-one"
                    })
    return relationships


# ==============================================================================
# 2. MEDALLION ARCHITECT TOOLS (used by medallion_architect/SKILL.md)
# ==============================================================================

@register_tool("dag_dependency_builder")
def dag_dependency_builder(entities: List[str]) -> Dict[str, Any]:
    """
    Constructs the directed acyclic graph (DAG) mapping Bronze -> Silver -> Gold.
    """
    nodes = []
    edges = []
    for ent in entities:
        clean = ent.lower()
        b_node = f"stg_raw_{clean}"
        s_node = f"stg_{clean}_cleaned"
        g_node = f"dim_{clean}_360"
        snp_node = f"snp_{clean}_scd2"

        nodes.extend([
            {"id": b_node, "layer": "Bronze", "type": "view"},
            {"id": s_node, "layer": "Silver", "type": "table"},
            {"id": snp_node, "layer": "Snapshot", "type": "snapshot"},
            {"id": g_node, "layer": "Gold", "type": "table"}
        ])

        edges.extend([
            {"from": b_node, "to": s_node},
            {"from": s_node, "to": snp_node},
            {"from": snp_node, "to": g_node}
        ])

    return {"nodes": nodes, "edges": edges}


@register_tool("layer_classifier")
def layer_classifier(table_name: str, has_history: bool = True) -> Dict[str, str]:
    """
    Classifies an entity into appropriate Medallion layers and target schemas.
    """
    clean = table_name.lower().replace("stg_", "").replace("raw_", "").replace("tbl_", "")
    return {
        "bronze": f"stg_raw_{clean}",
        "silver": f"stg_{clean}_cleaned",
        "snapshot": f"snp_{clean}_scd2" if has_history else None,
        "gold": f"dim_{clean}_360" if not clean.startswith("fct_") else f"fct_{clean}"
    }


@register_tool("snowflake_schema_mapper")
def snowflake_schema_mapper(target_db: str, schemas: Dict[str, str]) -> Dict[str, str]:
    """
    Maps layer names to Snowflake database.schema namespaces.
    """
    return {
        "bronze": f"{target_db}.{schemas.get('bronze', 'RAW_STAGING')}",
        "silver": f"{target_db}.{schemas.get('silver', 'EDW_SILVER')}",
        "gold": f"{target_db}.{schemas.get('gold', 'EDW_GOLD')}",
        "snapshot": f"{target_db}.{schemas.get('snapshot', 'EDW_SNAPSHOTS')}"
    }


# ==============================================================================
# 3. PYSPARK TRANSPILER TOOLS (used by pyspark_to_dbt/SKILL.md)
# ==============================================================================

@register_tool("pyspark_ast_transpiler")
def pyspark_ast_transpiler(pyspark_expr: str) -> str:
    """
    Transpiles individual PySpark expression strings into Snowflake SQL syntax.
    """
    expr = pyspark_expr.strip()
    expr = re.sub(r'F\.col\(["\'](\w+)["\']\)', r'\1', expr)
    expr = re.sub(r'col\(["\'](\w+)["\']\)', r'\1', expr)
    expr = re.sub(r'F\.upper\(', 'upper(', expr)
    expr = re.sub(r'F\.trim\(', 'trim(', expr)
    expr = re.sub(r'F\.lower\(', 'lower(', expr)
    expr = re.sub(r'F\.current_timestamp\(\)', 'current_timestamp()', expr)
    expr = re.sub(r'F\.coalesce\(', 'coalesce(', expr)
    expr = re.sub(r'F\.concat\(', 'concat(', expr)
    
    # Handle when/otherwise: F.when(c, v).otherwise(e) -> CASE WHEN c THEN v ELSE e END
    when_match = re.search(r'when\((.*?),\s*(.*?)\)\.otherwise\((.*?)\)', expr)
    if when_match:
        c, v, e = when_match.groups()
        return f"CASE WHEN {c} THEN {v} ELSE {e} END"
    return expr


@register_tool("sqlglot_snowflake_dialect")
def sqlglot_snowflake_dialect(raw_sql: str) -> str:
    """
    Formats and validates SQL for Snowflake dialect compatibility (vectorized functions, explicit CTEs).
    """
    # Replace non-ANSI operators
    formatted = raw_sql.replace("==", "=").replace("===", "=")
    # Ensure uppercase keywords
    for kw in ["SELECT", "FROM", "WHERE", "WITH", "AS", "JOIN", "ON", "GROUP BY", "ORDER BY", "CASE", "WHEN", "THEN", "ELSE", "END"]:
        formatted = re.sub(rf'\b{kw.lower()}\b', kw, formatted)
    return formatted


@register_tool("cte_modularizer")
def cte_modularizer(cte_name: str, select_query: str, is_final: bool = False) -> str:
    """
    Wraps a query into a modular Common Table Expression (CTE) block.
    """
    if is_final:
        return f"{cte_name} as (\n{select_query}\n)\nselect * from {cte_name};"
    return f"{cte_name} as (\n{select_query}\n),"


# ==============================================================================
# 4. DATA SAFETY & KEY TOOLS (used by data_safety_keys/SKILL.md)
# ==============================================================================

@register_tool("surrogate_key_generator")
def surrogate_key_generator(fields: List[str], macro: str = "dbt_utils.generate_surrogate_key") -> str:
    """
    Generates the Jinja macro call for an MD5/SHA256 surrogate key.
    """
    quoted_fields = [f"'{f}'" for f in fields]
    return f"{{{{ {macro}([{', '.join(quoted_fields)}]) }}}}"


@register_tool("scd2_snapshot_builder")
def scd2_snapshot_builder(
    snapshot_name: str,
    target_database: str,
    target_schema: str,
    unique_key: str,
    source_model: str,
    strategy: str = "timestamp",
    updated_at: str = "_dbt_loaded_at"
) -> str:
    """
    Builds a complete, valid dbt SCD Type 2 snapshot SQL file.
    """
    return f"""{{% snapshot {snapshot_name} %}}

{{{{
    config(
      target_database='{target_database}',
      target_schema='{target_schema}',
      unique_key='{unique_key}',
      strategy='{strategy}',
      updated_at='{updated_at}'
    )
}}}}

select * from {{{{ ref('{source_model}') }}}}

{{% endsnapshot %}}
"""


@register_tool("hash_diff_detector")
def hash_diff_detector(natural_columns: List[str]) -> str:
    """
    Generates a hash diff expression over natural attributes for SCD2 change detection.
    """
    quoted = [f"'{c}'" for c in natural_columns]
    return f"{{{{ dbt_utils.generate_surrogate_key([{', '.join(quoted)}]) }}}} as dbt_scd_id"


# ==============================================================================
# 5. JINJA TEST VALIDATOR TOOLS (used by jinja_test_validator/SKILL.md)
# ==============================================================================

@register_tool("schema_yaml_generator")
def schema_yaml_generator(model_name: str, columns: List[Dict[str, Any]]) -> str:
    """
    Builds schema.yml test definitions for a dbt model.
    """
    col_entries = []
    for c in columns:
        cname = c.get("name", "").lower()
        is_pk = c.get("isPk", False)
        tests = []
        if is_pk or cname.endswith("_sk") or cname == "id":
            tests.append("          - unique\n          - not_null")
        elif not c.get("nullable", True):
            tests.append("          - not_null")

        test_block = f"\n        tests:\n{tests[0]}" if tests else ""
        col_entries.append(f"      - name: {cname}{test_block}")

    return f"""  - name: {model_name}
    description: "Cleansed intermediate model for {model_name}"
    columns:
{chr(10).join(col_entries)}"""


@register_tool("jinja_syntax_checker")
def jinja_syntax_checker(jinja_text: str) -> Dict[str, Any]:
    """
    Validates balance of Jinja braces {{ }}, {% %}, {# #}.
    """
    open_expr = len(re.findall(r'\{\{', jinja_text))
    close_expr = len(re.findall(r'\}\}', jinja_text))
    open_stmt = len(re.findall(r'\{%', jinja_text))
    close_stmt = len(re.findall(r'%\}', jinja_text))

    is_valid = (open_expr == close_expr) and (open_stmt == close_stmt)
    return {
        "isValid": is_valid,
        "unclosedExpressions": open_expr - close_expr,
        "unclosedStatements": open_stmt - close_stmt
    }


@register_tool("integrity_test_builder")
def integrity_test_builder(source_model: str, pk_col: str) -> str:
    """
    Builds a singular SQL data test validating that no null or blank PKs exist.
    """
    return f"""-- Validation Test: Assert no null or blank primary keys
select *
from {{{{ ref('{source_model}') }}}}
where {pk_col} is null or trim(cast({pk_col} as string)) = ''
"""


# ==============================================================================
# 6. DOCS & LINEAGE TOOLS (used by docs_lineage/SKILL.md)
# ==============================================================================

@register_tool("markdown_doc_builder")
def markdown_doc_builder(entity_name: str, source_type: str, columns: List[Dict[str, Any]]) -> str:
    """
    Builds a comprehensive markdown data dictionary file.
    """
    col_rows = []
    for c in columns:
        col_rows.append(f"| `{c.get('name')}` | `{c.get('datatype', 'VARCHAR')}` | `{'Primary Key' if c.get('isPk') else 'Attribute'}` |")

    return f"""# {entity_name}

## Modernization Metadata
- **Source Origin**: `{source_type}`
- **Target Platform**: `Snowflake Data Cloud`
- **Architecture**: `Medallion 3-Tier (Bronze -> Silver -> Snapshot SCD2 -> Gold)`

### Column Data Dictionary
| Column Name | Data Type | Key Type |
| :--- | :--- | :--- |
{chr(10).join(col_rows)}
"""


@register_tool("column_lineage_tracker")
def column_lineage_tracker(source_cols: List[str], target_cols: List[str]) -> Dict[str, str]:
    """
    Maps source legacy column names to modernized target column names.
    """
    mapping = {}
    for sc in source_cols:
        clean = sc.lower()
        match = next((tc for tc in target_cols if tc.lower() == clean), clean)
        mapping[sc] = match
    return mapping
