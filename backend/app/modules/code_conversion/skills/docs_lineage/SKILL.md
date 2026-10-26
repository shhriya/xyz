---
id: docs_lineage_skill
name: Project Structure, Execution Plan & Documentation
category: Governance
icon: BookOpen
version: v3.0
description: Prompt 6 — standard dbt project layout, lineage-derived execution plan, and the
  implementation guide and style guide Markdown documents.
enabled: true
tools:
- markdown_doc_builder
- column_lineage_tracker
parameters:
  generate_overview_md: true
  include_source_provenance: true
  include_transformation_notes: true
---

# Prompt 6 — Project Structure, Execution Plan & Documentation

## DBT PROJECT STRUCTURE

Generate the project using the standard dbt layout:
```
models/
  sources.yml
  bronze/
  silver/
  gold/
snapshots/
macros/
tests/
docs/
```

## EXECUTION PLAN GENERATION

Analyze dbt lineage and determine the execution order. Example dependency order:
```
Bronze → Silver → Snapshot → Gold → Tests
```

Generate dbt commands based on the actual architecture. Example:
```
dbt run --select bronze
dbt snapshot
dbt run --select gold
dbt test
```

Provide `dbt build` only if safe.

## DOCUMENTATION FILES

Create the following files:
```
docs/implementation_guide.md
docs/styleguide.md
```

IMPLEMENTATION GUIDE REQUIREMENTS — the implementation guide must include:
- architecture reasoning
- execution plan
- assumptions
- limitations

STYLE GUIDE REQUIREMENTS — the style guide must include:
- folder structure
- naming conventions
- dependency rules
- SQL standards
- testing standards

All documentation must be written as Markdown files.
