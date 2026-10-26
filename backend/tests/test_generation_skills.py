"""Data Modernization generation must follow the six-prompt dbt generation spec, via the skills."""
import importlib

cm = importlib.import_module("app.modules.cloud_modernization.router")


def test_all_six_prompt_skills_are_loaded_in_order():
    assert cm.CLOUD_MOD_RELEVANT_SKILL_IDS == [
        "source_extractor_skill", "medallion_architect_skill", "pyspark_to_dbt_skill",
        "data_safety_keys_skill", "jinja_test_validator_skill", "docs_lineage_skill",
    ]
    ctx = cm._load_cloud_mod_skill_context()
    headers = [f"# Prompt {n} —" for n in range(1, 7)]
    positions = [ctx.index(h) for h in headers]          # every prompt present...
    assert positions == sorted(positions)                 # ...and in spec order
    for must in ("INFORMATION_SCHEMA.TABLES", "Snapshots must reference Silver models directly",
                 "Silver      → EPHEMERAL, or VIEW if reused", "strategy='timestamp'",
                 "seq_<model>.NEXTVAL AS surrogate_key", "models/validation/schema.yml",
                 "docs/implementation_guide.md"):
        assert must in ctx, must


def test_inventory_section_reports_detected_tables_or_the_assumption():
    assert "not available" in cm._build_inventory_section(None)
    inv = {"targetDatabase": "RETAIL", "databases": ["RETAIL"], "tables": [
        {"database": "RETAIL", "schema": "RAW", "table": "ORDERS", "type": "BASE TABLE"}]}
    section = cm._build_inventory_section(inv)
    assert "RETAIL.RAW.ORDERS (BASE TABLE)" in section and "target.database = RETAIL" in section
    assert "failed" in cm._build_inventory_section({**inv, "tables": [], "error": "auth"})


def test_inventory_skipped_without_a_complete_target_connection():
    assert cm._fetch_table_inventory(None) is None
    assert cm._fetch_table_inventory({"account": "a", "user": "u"}) is None


def test_normalizer_places_spec_folders():
    out = cm.normalize_dbt_project_structure({
        "src_orders.sql": "select 1",
        "validation_row_diff_dim_customer.sql": "select 2",
        "setup/bronze_source_tables.sql": "create table x (id int)",
        "packages.yml": "packages: []",
    })
    assert set(out) == {
        "models/bronze/src_orders.sql", "models/validation/validation_row_diff_dim_customer.sql",
        "setup/bronze_source_tables.sql", "packages.yml",
    }


def test_coverage_accepts_src_and_int_naming():
    files = {"models/bronze/src_customers.sql": "select 1", "models/silver/int_orders.sql": "select 1"}
    assert cm._uncovered_entities(files, ["raw_customers", "orders", "returns"]) == ["returns"]


def test_no_analysis_layer_and_tests_come_from_prompt5():
    ctx = cm._load_cloud_mod_skill_context()
    assert "analysis/table_detection.sql" not in ctx and "snapshot_one_active_record_per_customer" not in ctx
    for must in ("SOURCE TESTS", "BRONZE TESTS", "SILVER TESTS", "GOLD TESTS", "SNAPSHOT TESTS",
                 "one schema.yml per folder", "expect_column_values_to_be_between", "compare_row_counts"):
        assert must in ctx, must
    out = cm.normalize_dbt_project_structure({"analysis/x.sql": "select 1", "tests/t.sql": "select 1"})
    assert "tests/t.sql" in out
