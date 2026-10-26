---
id: pyspark_to_dbt_skill
name: Model Generation & Load Logic
category: Code Transpiler
icon: Zap
version: v4.0
description: Prompt 3 — builds Bronze models, derives load type (full / incremental / SCD Type 2)
  from the configuration inputs, selects snapshot strategy, and decides Gold materialization.
enabled: true
tools:
- pyspark_ast_transpiler
- sqlglot_snowflake_dialect
- cte_modularizer
parameters:
  cte_style: explicit_readable
  target_dialect: snowflake
  vectorize_joins: true
  coalesce_nulls: true
---

# Prompt 3 — Model Generation + Load Logic

## MODEL GENERATION

### 3) BUILD BRONZE MODELS

- Create Bronze models for every source table
- Reference sources using `{{ source() }}`
- Apply column renaming
- Apply datatype casting
- No business logic allowed

Materialization: VIEW

### 4) IDENTIFY LOAD TYPE FROM CONFIGURATION INPUTS

Determine load behavior from the configuration inputs.

a) FULL LOAD
- Create Gold models as TABLE.

b) INCREMENTAL LOAD — use dbt incremental models with:
- unique_key from the configuration inputs
- a watermark column
- MERGE incremental strategy

Models must be idempotent and re-runnable.

c) SCD TYPE 2
- Create a dbt SNAPSHOT using a strategy derived from configuration input behavior.

## STRATEGY SELECTION RULES

1) TIMESTAMP STRATEGY
If the configuration inputs contain an explicit update timestamp column (e.g. last_update_date,
updated_at, row_modified_ts) → use `strategy='timestamp'` and set `updated_at` = that column.

2) CHECK STRATEGY — EFFECTIVE DATE COLUMNS PRESENT
If the configuration inputs contain only effective_start_date / effective_end_date columns
(e.g. eff_start_dt, eff_end_dt) but no update timestamp → use `strategy='check'` and generate
`check_cols` dynamically from the mapped attributes.

3) CHECK STRATEGY — CHANGE DETECTION COLUMNS PRESENT
If the configuration inputs explicitly define change-detection columns → use `strategy='check'`
and use those columns as `check_cols`.

4) MERGE / UPDATE FLAGS WITHOUT HISTORY TRACKING
If the configuration inputs contain merge/update indicators but no history tracking →
DO NOT create a snapshot; use an incremental model instead.

5) MULTIPLE INDICATORS PRESENT
If multiple indicators exist → prioritize an explicit timestamp column over the check strategy.

Snapshots must track historical changes using configuration derived only from the configuration
inputs. Gold models derived from snapshots must represent the current-state dataset exposed for
downstream analytics or reporting. Snapshots represent historical state only and are not
reporting endpoints.

## SNAPSHOT STRATEGY RESOLUTION RULE

Snapshot strategy must NEVER be hardcoded. Always infer the strategy from configuration input
mapping behavior:
- timestamp column present → timestamp strategy
- column comparison logic present → check strategy
- no change tracking logic → no snapshot

Final dimension models must be built from the snapshot.

## SCD TYPE 2 REQUIREMENT

Snapshots are never final reporting artifacts. A downstream Gold model MUST always be generated
from the snapshot. The Gold model must:
- filter for `dbt_valid_to IS NULL`
- expose current active records only
- alias dbt metadata columns back to legacy equivalents if required
- serve as the reporting-ready dimension layer

## GOLD MATERIALIZATION DECISION

Materialization must be determined from configuration input semantics. Rules priority:
1. If the configuration inputs explicitly specify materialization → use it
2. If incremental behavior is detected → use INCREMENTAL
3. If SCD Type 2 behavior exists → create a snapshot
4. If the model feeds BI/reporting → use VIEW
5. If batch processing large datasets → use TABLE

If there is insufficient information → default to TABLE.
