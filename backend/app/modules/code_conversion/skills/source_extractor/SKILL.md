---
id: source_extractor_skill
name: Source Identification & Configuration
category: Ingestion & AST
icon: Layers
version: v3.0
description: Prompt 1 — identifies source, lookup and truth (target) tables from the configuration
  inputs, detects which already exist in the target database, and defines source configuration
  and strict layer-by-layer lineage.
enabled: true
tools:
- xml_informatica_parser
- pyspark_ast_extractor
- table_relationship_detector
parameters:
  multi_workflow_support: true
  infer_foreign_keys: true
  strip_runtime_boilerplate: true
---

# Prompt 1 — Source Identification & Configuration

Use the previously loaded **source configuration inputs** to determine transformation complexity
and select the appropriate dbt architecture.

IMPORTANT:
- Follow instructions strictly in the given order.
- Do not omit any required section.
- Do not add unsupported features.

PRIORITY RULE:
When input data contains explicit runtime behavior (e.g. load mode, update strategy, keys, merge
logic), it OVERRIDES any default rule defined in this prompt.
Input data is always more specific than prompt defaults.

## MULTI-WORKFLOW SUPPORT

In real enterprise projects a pipeline may consist of multiple workflows. Projects may contain
tens or even hundreds of workflows. Multiple workflows may collectively represent one logical
pipeline.

The system must therefore:
- Support processing multiple workflows together
- Correctly understand dependencies between workflows
- Maintain relationships between upstream and downstream workflows
- Avoid generating isolated pipelines when workflows are logically connected
- Detect reusable logic across workflows
- Generate reusable dbt macros when similar logic appears across multiple workflows
- Ensure models generated from different workflows reference each other correctly using ref()

Example scenario: if multiple workflows share similar transformation logic, detect the pattern and
generate a reusable macro instead of duplicating SQL across models.

The solution must support multi-workflow processing while preserving lineage and dependencies.

## GOAL

Convert the provided configuration inputs into a complete dbt project for Snowflake.
The solution must be fully configuration-driven and production-oriented.

## INPUTS

- Connection configuration
- Transformation logic configuration

The configuration inputs represent workflow mappings extracted from a transformation system.
Use these configurations as the **authoritative workflow logic input**.

## STRICT VALIDATION RULES

- Use only information present in the provided configuration inputs
- Do NOT invent source tables, columns, or business rules
- If required details are missing, explicitly state assumptions

## TASKS

### 1) IDENTIFY SOURCE TABLES

- Extract all source tables from the configuration inputs
- Use the configuration inputs to determine the database and Bronze layer schema
- Provide Snowflake SQL CREATE TABLE scripts in the Bronze ingestion schema
- Use appropriate Snowflake datatypes
- Include sample INSERT statements for dummy data

### SOURCE TABLE EXISTENCE DETECTION

Before generating CREATE TABLE scripts for any SOURCE or LOOKUP table:
1. Extract all SOURCE and LOOKUP table names from the configuration inputs.
2. Use the database defined in profiles.yml `target.database`.
3. Search for these tables inside the database using `INFORMATION_SCHEMA.TABLES`.
4. If a table exists:
   - Capture its schema location
   - Register it as a dbt source table
   - Do NOT generate CREATE TABLE scripts
5. If a table does NOT exist:
   - Generate CREATE TABLE scripts in the Bronze ingestion schema
6. Produce a summary listing:
   - Detected Source Tables
   - Missing Source Tables
   - Schema locations of detected tables

File placement: do NOT create an analysis/ or analyses/ folder. The detection summaries, the
INFORMATION_SCHEMA lookup queries, and the CREATE TABLE + sample INSERT scripts for missing source
and truth tables all go in `docs/implementation_guide.md` (as SQL code blocks under a "Source Setup"
section). Name the Bronze ingestion source `bronze_ingestion` and the truth
tables' source `truth_validation` in models/sources.yml.

### TRUTH TABLE DETECTION FOR VALIDATION

Truth tables represent legacy ETL outputs defined as TARGET tables in the configuration inputs.

Before generating validation models:
1. Extract all TARGET table names from the configuration inputs.
2. Use the database defined in profiles.yml `target.database`.
3. Search for these tables inside the database using `INFORMATION_SCHEMA.TABLES`.
4. If a table exists:
   - Capture its schema location
   - Register it as a validation source table in sources.yml
   - Use it for dbt-audit-helper validation models
5. If a table does NOT exist:
   - Generate CREATE TABLE scripts using TARGET field definitions
   - Generate INSERT statements with sample validation data
   - Register the created table as a validation source
6. Produce a summary listing:
   - Detected Truth Tables
   - Missing Truth Tables
   - Schema locations of detected tables

### 2) CREATE DBT SOURCE CONFIGURATION

Generate sources.yml referencing the Bronze ingestion schema.

Rules:
- Database and schema must come from the connection configuration
- The Bronze ingestion schema must contain only physical source tables
- Bronze ingestion tables must only be accessed via dbt source()

The Bronze ingestion schema is read-only.

## MODEL BUILD ORDER AND DEPENDENCY RULES

Dependency implementation rules:
- Use `{{ source() }}` for Bronze ingestion tables only
- Use `{{ ref() }}` for dbt model dependencies
- Do not hardcode database.schema.table names

Enforce strict layer-by-layer lineage. Layers must follow:

```
SOURCE TABLES
→ BRONZE
→ SILVER
→ SNAPSHOT (if SCD Type 2)
→ GOLD
```

Snapshots must reference Silver models directly.
Do NOT create GOLD models solely for snapshot input preparation.
