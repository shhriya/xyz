---
id: data_safety_keys_skill
name: Data Safety & Surrogate Keys
category: Data Integrity
icon: ShieldCheck
version: v3.0
description: Prompt 4 — implements configured transformations safely (TRY_ casts, NULL handling,
  deterministic dedup, join-safe) and generates surrogate keys with Snowflake sequences.
enabled: true
tools:
- surrogate_key_generator
- scd2_snapshot_builder
- hash_diff_detector
parameters:
  surrogate_key_macro: snowflake_sequence
  scd2_strategy: derived_from_inputs
  track_hash_diff: false
  timestamp_column: derived_from_inputs
---

# Prompt 4 — Data Safety + Surrogate Keys

## TRANSFORMATION IMPLEMENTATION

Implement the transformations defined in the **configuration inputs**.

Rules:
- Models must exist only in the target schema
- The Bronze ingestion schema must not contain dbt models
- Use Silver models when complexity requires
- If transformation logic is unsupported in dbt or Snowflake, automatically generate an equivalent
  SQL-based alternative implementation
- Never skip transformations due to framework limitations
- Preserve transformation intent using native Snowflake SQL where required

## DATA EXCEPTION HANDLING

Ensure models do not fail due to bad data. Use Snowflake-safe SQL patterns:
- `TRY_CAST`
- `TRY_TO_NUMBER`
- `TRY_TO_DATE`

Handle NULL values using COALESCE where appropriate.
Prevent duplicate records using deterministic deduplication logic.
Ensure joins do not cause row multiplication.
Handle late-arriving data safely.
Do not introduce new business rules.

## SURROGATE KEY HANDLING

Use the surrogate key defined in the transformation logic.

Rules:
- Do not delete required surrogate key columns
- If the key already exists upstream → carry it forward
- Generate a new surrogate key only if required

Generation method:
- Create a Snowflake sequence via a dbt model pre-hook.
- Populate using: `seq_<model>.NEXTVAL AS surrogate_key`

Surrogate keys must NOT be used as incremental MERGE keys. Use stable business identifiers instead.

If surrogate keys are required for snapshot-based dimensions, generate them in the Silver layer
before snapshot execution, unless explicitly defined otherwise in the configuration inputs.

If a Snowflake sequence (`.NEXTVAL`) is used to generate a surrogate key, the model MUST be
materialized as TABLE. This overrides the default Silver materialization rules.

Snapshots must not generate surrogate keys. Snapshots track historical state changes only and must
reuse keys generated upstream.
