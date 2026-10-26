---
id: cicd_scaffolding_skill
name: CI/CD Scaffolding Generator
category: DevOps
icon: Workflow
version: v1.0
description: Generates a GitHub Actions CI workflow, SQL lint config, and a
  packages.yml/profiles example so the generated dbt project is runnable in a
  pipeline on day one, not just on a laptop.
enabled: true
tools:
- github_actions_workflow_builder
- sqlfluff_config_generator
- ci_secrets_scaffolder
parameters:
  ci_provider: github_actions
  lint_on_pr: true
  full_build_on_merge_to_main: true
---

CI/CD Scaffolding — The Project Should Be Pipeline-Ready, Not Just Locally Runnable

WHAT TO GENERATE
.github/workflows/dbt_ci.yml: triggered on pull_request, runs dbt deps, dbt seed, dbt build
(or dbt run + dbt test for larger projects), against a CI target profile. Fail the workflow
if any test fails.
.github/workflows/dbt_deploy.yml (or a second job in the same workflow gated on the main
branch): triggered on merge/push to main, runs the full dbt build against the production
target.
.sqlfluff: a SQL lint config with templater=jinja and dialect=snowflake (or the project's
actual target dialect), so lint rules match this project's real SQL style rather than a
generic default.

CREDENTIALS NEVER GO IN THE WORKFLOW FILE
Every Snowflake credential referenced in a workflow file is a GitHub Actions secret
reference (${{ secrets.SNOWFLAKE_ACCOUNT }}, ${{ secrets.SNOWFLAKE_USER }}, etc.) — never a
literal account name, username, password, or key. Also generate a profiles.yml.example (not
a real profiles.yml with credentials) showing the expected structure using env_var() calls,
so a human knows exactly which secrets to configure without any real credential ever being
committed.

DO NOT DUPLICATE packages.yml
If a packages.yml already exists in the project (for example because the test-generation
skill added dbt-expectations to it), add to that same file — never create a second,
conflicting packages.yml. If none exists yet, create one with dbt-utils as the baseline
dependency.

PIPELINE SHAPE
PR pipeline: install deps, lint (sqlfluff), build, test — fast feedback, must catch broken
SQL or failing tests before merge.
Main-branch pipeline: full build against production — this is the pipeline that actually
materializes the warehouse's production tables, so it only runs after a PR has already been
reviewed and merged, never directly on every push to a feature branch.

KEEP IT PROPORTIONAL TO THE PROJECT
Do not generate a multi-environment (dev/staging/prod) matrix, Slack notification steps, or a
dbt Cloud API job trigger unless the requirement explicitly asks for one of those — a
single-target CI workflow that actually builds and tests the generated project correctly is
more valuable than an elaborate pipeline nobody configured the secrets for.
