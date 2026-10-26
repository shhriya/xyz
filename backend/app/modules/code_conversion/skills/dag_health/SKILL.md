---
id: dag_health_skill
name: DAG Health & Dependency Shape Advisor
category: Architecture
icon: GitBranch
version: v1.0
description: Keeps the generated dependency graph shallow, correctly layered, tagged
  for selective builds, and free of hidden or excessive fan-out — the shape of the
  DAG, not the SQL inside any one model.
enabled: true
tools:
- dag_shape_analyzer
- fanout_detector
- tag_assigner
parameters:
  max_sequential_layers_before_gold: 3
  require_layer_tags: true
  max_direct_downstream_refs_per_staging_model: 6
---

DAG Health — The Shape of the Dependency Graph Is Its Own Quality Dimension

NO HIDDEN DEPENDENCIES
Every model's real upstream dependency is expressed through an explicit ref() or source()
call — never through a macro, a variable, or a hardcoded table name that hides the true
dependency from dbt's dependency graph. A hidden dependency breaks build ordering and testing
sequence even when the SQL happens to still run.

NO LAYER-SKIPPING, NO BACKWARD REFS
Gold models ref() Silver, never Bronze directly. Silver models ref() Bronze, never Gold —
a Silver model referencing a Gold model is a backward reference and is never correct
regardless of what the SQL is trying to do; restructure instead of forcing it.

FAN-OUT DISCIPLINE
A single Bronze staging model should not be ref()'d directly by more than a handful of
downstream models — when many Gold models need the same staging output, that is exactly what
the Silver intermediate layer is for: consolidate shared cleaning/dedup logic once in Silver,
then have Gold fan out from there instead of every Gold model repeating the same upstream
staging reference and its own copy of the cleaning logic.

DEPTH DISCIPLINE
Keep the chain from a Bronze source to a Gold output reasonably shallow — Bronze to Silver to
Gold is the expected depth. If a domain genuinely needs deeper sequential transformation,
introduce a clearly-named intermediate mart rather than letting an unnamed chain of models
grow past what a reader can trace by eye.

TAGGING FOR SELECTIVE BUILDS
Every model gets a tags list identifying its layer and role, e.g. ['bronze'], ['silver'],
['gold', 'dimension'], ['gold', 'fact'], ['mart'] — this is what makes `dbt build
--select tag:gold` and similar selective runs possible; a project where tags are missing or
inconsistent cannot be built or tested incrementally by layer.

NO ORPHANS, NO DEAD ENDS BY ACCIDENT
Bronze and Silver models exist to feed something downstream — a Bronze or Silver model with
no downstream ref() anywhere in the project is either missing its consumer or was generated
unnecessarily; only Gold dimensions, facts, marts, and snapshots are expected to be terminal
nodes in the graph.

NO ACCIDENTAL CYCLES
Before finishing generation, trace every model's ref() chain and confirm it never loops back
on itself, directly or through an intermediate model — a cycle makes the project impossible
to compile, so this check overrides any other convenience in how a model was written.
