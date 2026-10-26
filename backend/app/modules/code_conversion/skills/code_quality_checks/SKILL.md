---
id: code_quality_skill
name: dbt Code Quality & Style Enforcer
category: Code Quality
icon: CheckCircle2
version: v1.0
description: Enforces dbt naming conventions, SQL style, anti-pattern avoidance, and
  documentation-as-a-gate rules so generated projects need fewer post-hoc fixes.
enabled: true
tools:
- naming_convention_linter
- sql_style_formatter
- anti_pattern_detector
parameters:
  enforce_snake_case: true
  disallow_select_star_outside_bronze: true
  require_model_descriptions: true
  max_nested_subquery_depth: 2
---

Code Quality & Static Style Enforcement — Cross-Cutting Quality Gate
This skill is preventive, not corrective: it shapes what gets generated in the first place,
so the project needs fewer fixes later rather than relying on a separate pass to catch them.

NAMING CONVENTIONS
All identifiers are snake_case — no camelCase, no PascalCase, no spaces, no abbreviations
that aren't already standard in the domain.
Bronze staging models are named stg_<entity>.
Silver intermediate models are named int_<entity>_cleaned.
Gold dimensions are named dim_<entity>. Gold facts are named fct_<entity>. Gold marts are
named mart_<name>.
CTE names describe what they contain (e.g. deduplicated_orders, enriched_transactions),
never generic placeholders like cte1, temp, t1, data2.
A column keeps the same name from Bronze through Gold unless it is explicitly being renamed
for business meaning — never rename a column just because it moved to a new layer.

SQL STYLE
SQL keywords (select, from, where, join, as, case, when, and, or) are lowercase.
Use 4-space indentation. One column per line in any select list with more than 3 columns.
Trailing-comma style: every column except the last ends its line with a comma. Never leading
commas.
Do not leave commented-out SQL in a finished model. A comment explains WHY something
non-obvious is done — never restates WHAT the SQL already shows.

SELECT * DISCIPLINE
select * is allowed ONLY in a Bronze model's initial extraction directly from source(),
before any casting or renaming happens.
Every other model — Silver, Gold, snapshots, marts — selects explicit, named columns.
Never select * from a ref().

ANTI-PATTERNS TO AVOID
Never hardcode a database, schema, or table name inside a model's SQL body — use ref()/
source() for every table reference, never a literal three-part identifier.
Never duplicate the same transformation logic (the same CASE WHEN block, the same currency
conversion formula, the same dedup pattern) across multiple models — extract it into a macro
under macros/ and call that macro from every model that needs it.
Never nest subqueries more than two levels deep — restructure as sequential, named CTEs
instead.
Never use a non-deterministic function (RANDOM(), or current_timestamp() used to filter the
business result set) in a way that makes a model produce different results on every re-run.
current_timestamp() is only acceptable for audit/load-timestamp columns, never for filtering.

COLUMN ORDERING CONVENTION
Within a model's final select list, order columns as: primary/surrogate key(s) first, then
foreign keys, then business attributes, then computed/derived columns, then audit metadata
(_loaded_at, dbt_updated_at, etc.) last.

MATERIALIZATION DISCIPLINE
Bronze models are views. Silver models are views unless a specific performance reason
requires a table — state that reason in a comment when overriding. Gold dimensions are
tables. Gold facts are incremental with an explicit unique_key and incremental_strategy.
Marts are tables.
Only add an explicit {{ config(...) }} block to a model when its needs differ from what
dbt_project.yml already declares as the default for that layer — do not repeat the layer's
default materialized/schema/tags on every single model file.

DOCUMENTATION AS A QUALITY GATE
A model without at least a one-line description in its schema.yml is not "done." The docs
skill generates the documentation content itself — this skill is the gate requiring every
model the project outputs to have one before generation counts as complete.

IDEMPOTENCY
A model, run twice in a row with no source data change, produces identical output. Never use
LIMIT without an explicit, deterministic ORDER BY. Never rely on row order from the database
for anything meaningful.
