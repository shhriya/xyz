---
id: medallion_architect_skill
name: Medallion Architecture Designer
category: Data Modeling
icon: Grid
version: v3.0
description: Prompt 2 — selects the architecture from transformation complexity and assigns
  Bronze (views), Silver (ephemeral/views), Gold (configuration-driven) responsibilities,
  schemas, materializations, naming, freshness, macros and conditional dbt_utils usage.
enabled: true
tools:
- dag_dependency_builder
- layer_classifier
- snowflake_schema_mapper
parameters:
  bronze_materialization: view
  silver_materialization: ephemeral
  gold_materialization: table
  generate_snapshots: true
---

# Prompt 2 — Architecture & Layer Design

## ARCHITECTURE SELECTION (CONFIG-DRIVEN)

Analyze the **configuration inputs** to determine transformation complexity.
Choose the architecture accordingly.

SIMPLE LOGIC — example flow:
```
Source → Bronze → Silver → Gold
```

MODERATE COMPLEXITY — example flow:
```
Source → Bronze → Silver (join layer) → Silver (refinement layer) → Gold
```

HIGH COMPLEXITY — example flow:
```
Source → Bronze → Silver (standardization) → Silver (integration)
       → Silver (business-rule preparation) → Gold
```

## LAYER RESPONSIBILITIES

BRONZE
- Clean and standardize raw data
- Rename columns
- Apply datatype casting
- Minimal transformations only — preserve the original source schema structure

SILVER
- Apply transformation logic
- Join Bronze tables
- Create derived columns
- Prepare reusable, transformation-ready datasets for Gold layer consumption

GOLD
- Apply business logic and produce analytics-ready, domain-level outputs
- Generate analytics-ready tables
- Produce final domain outputs

GOLD CONTENT RULE — Gold contains ONLY final outputs:
- A Gold model exists only for a final table that consumers query: an output the configuration
  inputs explicitly ask for (a report, KPI/metric table, mart, or reporting dimension/fact), or the
  current-state dimension required on top of an SCD Type 2 snapshot (Prompt 3).
- Do NOT create one Gold model per source table or per entity. An entity that only feeds other
  outputs stops at Silver — its Silver model is referenced by the Gold outputs that need it.
- Never pass a source/Bronze/Silver table through to Gold unchanged, and never name a Gold model
  after a source table (no raw_/src_/stg_/int_ prefixes in Gold).
- Intermediate joins, cleansing and business-rule preparation belong in Silver, not in Gold.
- Name each Gold model after the TARGET it delivers (the legacy target / truth table name when one
  exists), so validation pairs Gold ↔ truth table by name.

## REFERENCE PROJECT SHAPE

This is what a correctly generated project looks like (one SCD Type 2 target built from five source
tables). Follow this shape — note how little is in Gold:

```
models/sources.yml                      bronze_ingestion (5 physical tables) + truth_validation (1 target)
models/bronze/src_customer.sql          one per source table: rename + TRY_ cast, no business logic
models/bronze/src_orders.sql
models/bronze/src_lineitem.sql
models/bronze/src_nation.sql
models/bronze/src_region.sql
models/bronze/schema.yml
models/silver/int_customer_order_region.sql   integration: joins Bronze, aggregates child rows to the
                                              join grain first to avoid row multiplication (VIEW — reused)
models/silver/customer_profile_prepared.sql   business-rule preparation: the target's grain and measures
models/silver/customer_profile_keyed.sql      surrogate key via Snowflake sequence pre-hook, incremental
                                              MERGE on the business key, reuses existing keys
models/silver/schema.yml
snapshots/snp_customer_profile_scd2.sql       SCD2 on the keyed Silver model (strategy from the inputs)
models/gold/dim_customer_profile_scd2.sql     THE ONLY GOLD MODEL: current state of the snapshot
                                              (dbt_valid_to is null), metadata aliased to legacy names
models/gold/schema.yml
models/validation/validation_{row,rowcount,schema,column,value}_diff_dim_customer_profile_scd2.sql
models/validation/schema.yml
macros/                                 only genuinely reused helpers (e.g. SCD change expression)
docs/implementation_guide.md            incl. detection summaries + CREATE TABLE/INSERT setup scripts
docs/styleguide.md
dbt_project.yml                         bronze: view, silver: ephemeral (override to view/table per
                                        model where reused / sequence-keyed), gold: table, validation: table
packages.yml                            audit_helper (+ dbt_expectations only if used)
```

Tests are not shown here — generate them per Prompt 5 for every layer. No analysis/ or analyses/
folder. Gold holds one model per target. Customers, orders, line items, nations and regions each get a
Bronze model and feed Silver — none of them gets its own Gold model.

## DATABASE AND SCHEMA RULES

TARGET RESOLUTION RULES
- dbt models must be created in the database and schema defined in the profiles.yml target
- Do not override database or schema unless explicitly required

DATABASE
- Use the database from the configuration inputs.

SCHEMAS
- BRONZE INGESTION LAYER: contains only physical source tables. No dbt models allowed.
- TARGET SCHEMA: contains Bronze, Silver, and Gold models.
- SNAPSHOT SCHEMA: used for SCD Type 2 snapshots.

## MATERIALIZATION BY LAYER

```
Bronze      → VIEW
Silver      → EPHEMERAL, or VIEW if reused
Gold        → determined by configuration input behavior
SCD Type 2  → SNAPSHOT
```

Materialization priority hierarchy:
1. If the model generates sequence-based surrogate keys → TABLE
2. If the model is reused across multiple downstream models → VIEW
3. Otherwise → EPHEMERAL

## MODEL NAMING RULES

Model filenames must NOT be prefixed with layer names such as `bronze_`, `silver_`, `gold_`.
The folder structure already represents the layer.

Correct example:
```
models/bronze/src_customer.sql
models/silver/int_customer.sql
models/gold/dim_customer.sql
```

Incorrect example:
```
models/bronze/bronze_src_customer.sql
models/silver/silver_int_customer.sql
models/gold/gold_dim_customer.sql
```

Use business-meaningful model names derived from transformation logic instead of layer-prefixed
filenames.

## SOURCE FRESHNESS

Configure freshness for each source. Use the timestamp column from the configuration inputs if
available. Defaults if not provided:
```
warn_after:  24 hours
error_after: 48 hours
```

## MACRO GENERATION

Generate reusable macros when common logic exists across models. Examples:
- Incremental filtering logic
- Audit columns
- Transformation logic reused across workflows
- SCD helper logic

Create macros only when beneficial.

## DBT_UTILS PACKAGE — CONDITIONAL FUNCTION GENERATION

CRITICAL RULE: do NOT add dbt_utils functions by default or speculatively. Each function below
must only be generated when the pattern it addresses is explicitly present in the configuration
inputs. Scan the configuration inputs before deciding which functions to use.

- `dbt_utils.star()` — USE WHEN the mapping selects all columns from a source table with no
  explicit column-level renaming or filtering. Generates a dynamic column selector instead of a
  hardcoded column list.
- `dbt_utils.generate_surrogate_key()` — USE WHEN the mapping defines a surrogate key derived from
  multiple source columns and the key must be deterministic and reproducible. Do NOT use this
  alongside Snowflake sequences — choose one approach based on the configuration inputs.
- `dbt_utils.deduplicate()` — USE WHEN the mapping contains DISTINCT logic, a row_number
  deduplication pattern, or a transformation explicitly designed to eliminate duplicate records.
  Retains the latest row per key.
- `dbt_utils.union_relations()` — USE WHEN the mapping contains a Union transformation that
  combines two or more datasets. Replaces manually written UNION ALL SQL blocks.
- `dbt_utils.safe_add / safe_divide / safe_subtract` — USE WHEN the mapping contains arithmetic
  expressions on nullable columns, or any division operation. Prevents NULL propagation and
  divide-by-zero errors at runtime.
- `dbt_utils.expression_is_true()` — USE WHEN the mapping contains a Filter or Constraint
  transformation enforcing a business rule (e.g. amount > 0, status IN allowed values).
  Generate as a dbt test, not as inline SQL.
- `dbt_utils.equal_rowcount()` — USE WHEN the mapping has a one-to-one source-to-target
  relationship and row count parity must be validated. Generate as a dbt test in the validation
  layer alongside dbt-audit-helper checks.
- `dbt_utils.equality()` — USE WHEN full column-level equivalence between the source target table
  and the generated dbt model must be confirmed. Generate as a dbt test in the validation layer
  when complete data parity is required.

Add dbt_utils to packages.yml only when at least one of the above functions is required.
Do not include it otherwise.
