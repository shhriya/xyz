---
id: incremental_strategy_skill
name: Incremental Strategy & Performance Advisor
category: Performance
icon: TrendingUp
version: v1.0
description: Chooses the right materialization and incremental strategy per model,
  enforces a real lookback-filtered incremental predicate, and adds Snowflake
  performance config where the data volume justifies it.
enabled: true
tools:
- incremental_strategy_selector
- lookback_predicate_builder
- clustering_key_advisor
parameters:
  default_incremental_strategy: merge
  default_lookback_days: 3
  full_refresh_safe: true
---

Incremental Strategy & Performance — Materialization Decisions Are Not One-Size-Fits-All

MATERIALIZATION DECISION RULE
A model is a view when it is cheap to recompute and read infrequently (Bronze staging,
most Silver intermediates).
A model is a table when it is small/slow-changing reference or dimension data, or when
downstream models query it repeatedly enough that recomputing a view every time is wasteful
(Gold dimensions, marts).
A model is incremental only when it is a large, append-heavy or slowly-updated fact table
where reprocessing the full history on every run would be wasteful or too slow. Never make a
small or fully-overwritten table incremental just because it is in the Gold layer — that adds
complexity with no benefit.

INCREMENTAL STRATEGY SELECTION (SNOWFLAKE)
Use incremental_strategy='merge' with an explicit unique_key when a row can be updated after
it was first loaded (the common case for transactional facts). The unique_key must be a real
business or composite key — never a surrogate key generated fresh on every run, since that
would prevent matching to the existing row.
Use incremental_strategy='append' only when the source is a true immutable event/log stream
where a row is never updated after insert — appending duplicates on reprocessing must be
prevented by the source system's own dedup guarantee, or don't use append.
Do not use 'insert_overwrite' on Snowflake — it is a BigQuery-specific partition strategy;
Snowflake's merge or delete+insert achieve the same outcome here.

THE INCREMENTAL PREDICATE IS MANDATORY
Every model with materialized='incremental' must have a real {% if is_incremental() %}
block that filters the source data using a real lookback window against the model's own
already-loaded max timestamp, e.g.:
where source_timestamp_column >= (select dateadd(day, -3, max(source_timestamp_column)) from {{ this }})
Never leave the is_incremental() block empty or commented out — a fact model without a real
filter inside it silently reprocesses the entire source table on every run, which defeats the
entire purpose of marking it incremental and is a correctness+cost bug, not just a style
issue.
The lookback window (default 3 days, configurable per the domain's late-arriving-data
pattern) exists specifically to catch rows that arrived after their own event timestamp —
never filter with an exact equality or a zero-day window, since that silently drops
late-arriving data forever.

FULL-REFRESH SAFETY
Every incremental model must produce correct results when run with --full-refresh, meaning
the non-incremental branch of the model's logic (the part that runs when is_incremental() is
false) must be complete and correct on its own — never assume the incremental branch is the
only one that ever executes.

SNOWFLAKE PERFORMANCE CONFIG
For a Gold fact or mart expected to hold a large row count (transactional, event-level, or
high-cardinality data), add cluster_by on the column(s) most frequently used to filter or
join that table (typically the date/timestamp partition column, or a high-cardinality foreign
key) inside the model's {{ config(...) }} block.
For a model expected to be unusually expensive to build (a full historical backfill, a
wide multi-way join across large facts), set an explicit snowflake_warehouse in its config
so it runs on an appropriately sized warehouse instead of inheriting the default connection's
warehouse, and note the reason in a comment.
Do not add clustering or a dedicated warehouse to small dimension tables or Bronze/Silver
models — that config only pays for itself on genuinely large, frequently-scanned tables.
