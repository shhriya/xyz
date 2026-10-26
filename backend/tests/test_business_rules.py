"""Business rules stated in the prompt (filters, formulas, exclusions) must be extracted into the
generation checklist, not left to survive by chance inside the raw prompt text."""
import importlib

rp = importlib.import_module("app.modules.cloud_modernization.services.requirement_parser")
cm = importlib.import_module("app.modules.cloud_modernization.router")


def test_clean_business_rules_normalizes_strings_and_dicts_and_drops_junk():
    out = rp._clean_business_rules([
        "Exclude cancelled orders",
        {"rule": "Revenue is net of discounts", "appliesTo": "fct_sales", "layer": "Gold"},
        {"appliesTo": "no rule text"},   # dropped: no "rule"
        "",                              # dropped: empty
        123,                             # dropped: not a string/dict
    ])
    assert out == [
        {"rule": "Exclude cancelled orders", "appliesTo": "", "layer": ""},
        {"rule": "Revenue is net of discounts", "appliesTo": "fct_sales", "layer": "gold"},
    ]


def test_fallback_metas_always_have_business_rules_key():
    assert rp._default_retail_meta()["business_rules"] == []
    assert rp._default_schema_classification(["orders"], {"orders": []})["business_rules"] == []


def test_checklist_renders_business_rules_as_a_mandatory_numbered_section():
    meta = {
        "domain": "retail",
        "entities": {"orders": [{"name": "order_id", "pk": True}]},
        "business_rules": [
            {"rule": "Exclude cancelled orders", "appliesTo": "fct_orders", "layer": "gold"},
            {"rule": "Revenue is net of discounts and tax", "appliesTo": "", "layer": ""},
        ],
    }
    section = cm._build_entity_checklist_section(meta)
    assert "BUSINESS RULES TO IMPLEMENT — EXACTLY THESE 2" in section
    assert "1. Exclude cancelled orders (applies to: fct_orders) [gold layer]" in section
    assert "2. Revenue is net of discounts and tax" in section
    assert "every one of the 2 business rules above is actually enforced in SQL" in section


def test_checklist_omits_business_rules_section_when_none_extracted():
    section = cm._build_entity_checklist_section({"domain": "retail", "entities": {"orders": []}, "business_rules": []})
    assert "BUSINESS RULES" not in section
