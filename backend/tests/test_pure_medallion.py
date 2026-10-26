"""Data Modernization generates PURE medallion (Bronze/Silver/Gold, 3 layers) per
medallion_architect_skill — no Kimball fact/dimension/mart sub-layer under Gold."""
import importlib

cm = importlib.import_module("app.modules.cloud_modernization.router")


def test_leftover_kimball_subfolders_are_flattened_into_gold():
    files = {
        "models/gold/dimensions/dim_customers.sql": "select 1",
        "models/gold/facts/fct_orders.sql": "select 2",
        "models/gold/marts/mart_sales_kpis.sql": "select 3",
        "models/bronze/stg_customers.sql": "select 4",
    }
    out = cm.normalize_dbt_project_structure(files)
    assert set(out) == {
        "models/gold/dim_customers.sql",
        "models/gold/fct_orders.sql",
        "models/gold/mart_sales_kpis.sql",
        "models/bronze/stg_customers.sql",
    }


def test_orphaned_prefixed_gold_files_land_flat_not_in_subfolders():
    out = cm.normalize_dbt_project_structure({"dim_products.sql": "select 1", "fct_sales.sql": "select 2"})
    assert set(out) == {"models/gold/dim_products.sql", "models/gold/fct_sales.sql"}


def test_facts_and_dimensions_never_become_gold_models():
    meta = {
        "domain": "retail",
        "entities": {"orders": [{"name": "order_id", "pk": True}]},
        "facts": ["sales_summary"],
        "dimensions": ["customers"],
        "marts": ["regional_performance"],
        "business_rules": [],
    }
    section = cm._build_entity_checklist_section(meta)
    assert "GOLD LAYER OUTPUTS TO BUILD — EXACTLY THESE 1" in section
    assert "using EXACTLY these names: regional_performance." in section
    assert "FACTS (" not in section and "DIMENSIONS (" not in section and "\nMARTS:" not in section


def test_no_gold_outputs_line_when_nothing_to_build():
    section = cm._build_entity_checklist_section({"domain": "retail", "entities": {"x": []}})
    assert "GOLD LAYER OUTPUTS TO BUILD" not in section


def test_gold_names_never_reuse_source_table_names():
    # With a live schema the parser named Gold outputs after raw_* source tables, so the AI
    # generated models/gold/raw_customers.sql. Source/landing prefixes are always stripped.
    meta = {"dimensions": ["raw_customers"], "facts": ["raw_orders"],
            "marts": ["raw_sales_performance", "stg_inventory_visibility"]}
    assert cm.gold_output_names(meta) == ["sales_performance", "inventory_visibility"]


def test_gold_is_one_model_per_target_like_the_reference_project():
    # Reference project (dbt_v2_test2): five source tables, ONE Gold model named after the target.
    meta = {
        "entities": {e: [] for e in ("customer", "orders", "lineitem", "nation", "region")},
        "dimensions": ["customer", "nation", "region"], "facts": ["orders", "lineitem"],
        "gold_outputs": [{"name": "DIM_CUSTOMER_PROFILE_SCD2", "grain": "one row per customer",
                          "fromSnapshot": True, "description": "customer profile with history"}],
    }
    assert cm.gold_output_names(meta) == ["dim_customer_profile_scd2"]
    section = cm._build_entity_checklist_section(meta)
    assert "EXACTLY THESE 1" in section and "Do NOT create per-entity dim_/fact_ Gold models" in section
    assert "dim_customer_profile_scd2: customer profile with history; grain: one row per customer; "            "current-state view of an SCD Type 2 snapshot" in section


def test_without_targets_snapshots_get_one_current_state_model():
    meta = {"marts": ["sales_performance"], "snapshots": ["customers_snapshot"]}
    assert cm.gold_output_names(meta) == ["sales_performance", "dim_customers_scd2"]


def test_skill_states_gold_content_rule_and_reference_shape():
    ctx = cm._load_cloud_mod_skill_context()
    assert "Gold contains ONLY final outputs" in ctx
    assert "THE ONLY GOLD MODEL" in ctx and "analysis/bronze_missing_tables.sql" not in ctx
