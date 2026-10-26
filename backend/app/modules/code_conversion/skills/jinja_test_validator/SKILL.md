---
id: jinja_test_validator_skill
name: Validation Model & Testing
category: QA & Validation
icon: CheckSquare
version: v3.0
description: Prompt 5 — per-layer dbt tests, one schema.yml per folder, conditional
  dbt-expectations tests, and dbt-audit-helper validation models against truth tables.
enabled: true
tools:
- schema_yaml_generator
- jinja_syntax_checker
- integrity_test_builder
parameters:
  test_primary_keys: true
  test_foreign_keys: true
  test_not_null_critical: true
  generate_source_yaml: true
---

# Prompt 5 — Validation Model & Testing

## TEST GENERATION

Implement all tests based on the **configuration inputs**.
Generate dbt tests appropriate for each layer.

SOURCE TESTS
- not_null
- uniqueness

BRONZE TESTS
- not_null on critical fields
- relationship tests

SILVER TESTS
- uniqueness checks
- relationship validation

GOLD TESTS
- primary key uniqueness
- business rule validation

SNAPSHOT TESTS
- one active record per business key

Create custom tests when transformation logic requires validation.

## SCHEMA YAML RULE

Generate exactly **one schema.yml per folder**:
```
models/bronze/schema.yml
models/silver/schema.yml
models/gold/schema.yml
models/validation/schema.yml
```

Each schema.yml must contain all models in that folder.
Do NOT create one YAML per model.
Do NOT create bronze_models.yml / silver_models.yml / gold_models.yml.
sources.yml remains separate at `models/sources.yml`.

## DBT-EXPECTATIONS — CONDITIONAL TEST GENERATION

CRITICAL RULE: do NOT add dbt-expectations tests by default. Each test below must only be
generated when the specific pattern is detected in the configuration inputs. Inspect the
configuration inputs before generating any test.

TABLE STRUCTURE TESTS
- `expect_table_columns_to_contain_set` — USE WHEN the configuration inputs define mandatory
  columns that must always exist (e.g. ID, DATE).
- `expect_table_column_count_to_equal` — USE WHEN the mapping outputs a fixed known number of
  columns and schema drift must be detected.
- `expect_table_columns_to_match_ordered_list` — USE WHEN column order is explicitly enforced or
  significant for downstream consumers.

INTEGRITY & QUALITY TESTS
- `expect_column_values_to_be_unique` — USE WHEN the configuration inputs designate a column as a
  primary or business key.
- `expect_column_values_to_not_be_null` — USE WHEN the configuration inputs mark a field as NOT
  NULL, or the column is used as a join or filter key.
- `expect_column_values_to_be_of_type` — USE WHEN the mapping applies an explicit datatype cast.
- `expect_compound_columns_to_be_unique` — USE WHEN the configuration inputs define a composite
  unique key across multiple columns.

BUSINESS LOGIC TESTS
- `expect_column_values_to_be_in_set` — USE WHEN the mapping restricts a column to an enumerated
  set of allowed values.
- `expect_column_values_to_be_between` — USE WHEN the mapping defines numeric or date range
  constraints (e.g. price ≥ 0, priority 0–9).
- `expect_column_values_to_match_regex` — USE WHEN the mapping enforces a text pattern on a column
  (e.g. phone number, postal code).
- `expect_column_pair_values_A_to_be_greater_than_B` — USE WHEN the mapping defines comparison
  logic between two numeric or date columns (e.g. end_date > start_date).

MONITORING & FRESHNESS TESTS
- `expect_table_aggregation_to_equal_other_table` — USE WHEN validation requires aggregate totals
  to match between source and generated model.
- `expect_row_values_to_have_recent_data` — USE WHEN the configuration inputs define a timestamp
  column and freshness enforcement is required. Default threshold: 2 days, unless specified
  otherwise in the configuration inputs.
- `expect_column_values_to_have_consistent_casing` — USE WHEN the mapping processes categorical
  text fields where inconsistent casing would affect downstream usage.

Add dbt-expectations to packages.yml **only when at least one test above is required**.
Do not include it otherwise.

## AUTOMATIC VALIDATION MODEL GENERATION USING DBT-AUDIT-HELPER

### TRUTH TABLE EXISTENCE DETECTION RULE

Truth tables represent legacy ETL outputs defined as TARGET tables in the configuration inputs.
Extract TARGET tables from the configuration inputs. Search these tables inside the profiles.yml
`target.database` using `INFORMATION_SCHEMA.TABLES`.

If truth tables exist:
- capture the schema location
- register them as validation sources in sources.yml
- use them for dbt-audit-helper validation models

If truth tables do NOT exist:
- generate CREATE TABLE scripts using TARGET field definitions
- generate INSERT sample validation records
- register them as validation sources after creation

Do NOT assume a fixed validation schema. Truth table schema must always be detected dynamically.

### VALIDATION PARITY RULE FOR SCD TYPE 2

When comparing a Gold SCD Type 2 model to a Truth Table, exclude:
- dbt_valid_from
- dbt_valid_to
- dbt_scd_id
- any dbt snapshot metadata columns

unless those columns explicitly exist in the Truth Table schema. Validation comparisons must
operate only on business columns shared between both relations.

### EACH VALIDATION PAIR MUST GENERATE

- compare_row_counts
- compare_relation_columns
- compare_and_classify_relation_rows
- compare_all_columns
- compare_column_values

### VALIDATION MODEL RULES

Validation models must:
- reference Gold outputs using ref()
- reference truth tables using source()
- execute after Gold model creation
- materialize as TABLE by default
- allow optional VIEW materialization

Validation models must compare reference or truth tables only with Gold-layer outputs. Silver and
Snapshot layers must not be used as validation comparison targets unless explicitly specified in
the configuration inputs.

EXAMPLE OUTPUT FILES (in `models/validation/`):
```
validation_row_diff_<model>.sql
validation_schema_diff_<model>.sql
validation_column_diff_<model>.sql
validation_rowcount_diff_<model>.sql
validation_value_diff_<model>.sql
```

### VALIDATION PAIR DETECTION STRATEGY

Validation table pairing must follow this priority order:
1. configuration inputs target definition
2. workflow lineage relationships
3. naming convention matching
4. If the configuration inputs define TARGET tables but they are not found inside the profiles.yml
   `target.database` using `INFORMATION_SCHEMA.TABLES`: attempt matching using the naming
   conventions `dim_<entity>`, `fact_<entity>`, `gold_<entity>`, searching candidate tables with
   `INFORMATION_SCHEMA.TABLES` inside `target.database`. If still unresolved: skip validation model
   generation and log the missing validation mapping.

NAMING CONVENTION EXAMPLE
```
SRC_<ENTITY>_SOURCE ↔ dim_<entity>
SRC_<ENTITY>_SOURCE ↔ fact_<entity>
SRC_<ENTITY>_SOURCE ↔ gold_<entity>
```
