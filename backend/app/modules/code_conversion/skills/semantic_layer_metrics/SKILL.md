---
id: semantic_layer_skill
name: Semantic Layer & Metrics Definer
category: Analytics Engineering
icon: Calculator
version: v1.0
description: Defines dbt Semantic Layer semantic_models and metrics on top of the
  generated Gold facts/marts, so KPIs become governed, queryable metric definitions
  instead of one-off SQL scattered across marts.
enabled: true
tools:
- semantic_model_builder
- metric_definition_generator
- measure_dimension_mapper
parameters:
  semantic_models_path: models/semantic/semantic_models.yml
  metrics_path: models/semantic/metrics.yml
  require_time_dimension: true
---

Semantic Layer & Metrics — Turn KPIs Into Governed Metric Definitions, Not One-Off SQL

WHEN THIS APPLIES
Only generate semantic_models/metrics for domains where the requirement or the parsed KPI
list names actual business metrics (revenue, churn_rate, average_order_value, claim_ratio,
and similar). If no KPIs were requested, do not generate an empty or placeholder semantic
layer — skip it entirely rather than inventing metrics nobody asked for.

SEMANTIC MODEL DEFINITION
For each Gold fact or mart that backs a requested KPI, define one semantic model in
models/semantic/semantic_models.yml with:
- name: matching the underlying model's name.
- model: {{ ref('<the_fact_or_mart>') }}.
- entities: the primary key of the fact (type: primary) and every foreign key it carries
  (type: foreign), naming each entity after the dimension it joins to.
- dimensions: every categorical column usable for slicing (type: categorical) and at least
  one time-based column (type: time, with a real grain: day/week/month) — a semantic model
  backing a time-series metric without a time dimension cannot be queried by period, so this
  is mandatory whenever the underlying fact has any timestamp/date column at all.
- measures: every numeric column that should be aggregatable, each with an explicit agg
  (sum, average, count, count_distinct, min, or max) — never leave agg unset.

METRIC DEFINITION
For each KPI in the requirement, define one metric in models/semantic/metrics.yml:
- type: simple for a KPI that is a straightforward aggregation of one measure.
- type: ratio for a KPI expressed as one measure divided by another (e.g. conversion_rate),
  with numerator/denominator both referencing real measures defined above — never fabricate
  a ratio metric whose numerator or denominator measure doesn't exist.
- type: derived for a KPI computed from other already-defined metrics via an expression.
- type: cumulative only when the requirement explicitly describes a running/rolling total.
Every metric must reference a measure or metric that was actually defined — a metric
pointing at a column or measure name that doesn't exist anywhere in semantic_models.yml is a
broken metric, not a shortcut.

DO NOT DUPLICATE MART LOGIC
The semantic layer defines metrics on top of the Gold facts/marts that already exist — it
does not replace them, and it does not require rewriting the mart's own SQL. If a metric is
already fully computed as a column inside a mart, still expose it as a measure/metric here so
it becomes queryable through the semantic layer, rather than only being usable as a raw SQL
column.
