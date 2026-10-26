"""Generation must never add duplicate models for entities the AI already built under a different
(conventional) name — e.g. schema table RAW_CUSTOMERS modelled as stg_customers.sql."""
import importlib

cm = importlib.import_module("app.modules.cloud_modernization.router")

TABLES = ["raw_customers", "raw_inventory", "raw_order_items", "raw_orders", "raw_payments",
          "raw_products", "raw_promotions", "raw_returns", "raw_stores"]


def _ai_project(tables):
    files = {"models/bronze/sources.yml": "version: 2\nsources:\n  - name: raw_retail\n    tables: []\n"}
    for t in tables:
        e = t.removeprefix("raw_")
        files[f"models/bronze/stg_{e}.sql"] = f"select * from {{{{ source('raw_retail', '{t}') }}}}"
        files[f"models/silver/int_{e}_cleaned.sql"] = f"select * from {{{{ ref('stg_{e}') }}}}"
    return files


def test_raw_prefixed_tables_modelled_without_prefix_are_covered():
    # The exact case from the bug: every table was built, as stg_<name without raw_>.
    assert cm._uncovered_entities(_ai_project(TABLES), TABLES) == []


def test_coverage_by_filename_alone_and_in_any_folder():
    files = {"models/staging/stg_customers.sql": "select 1"}   # no source() call, non-bronze folder
    assert cm._uncovered_entities(files, ["raw_customers", "customers"]) == []


def test_genuinely_missing_entity_is_reported():
    assert cm._uncovered_entities(_ai_project(TABLES[:-1]), TABLES) == ["raw_stores"]


def test_nothing_generated_when_everything_is_covered(monkeypatch):
    monkeypatch.setattr(cm, "call_gemini_json", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no AI call expected")))
    files = _ai_project(TABLES)
    meta = {"entities": {t: [] for t in TABLES}}
    out, missing = cm._complete_missing_entities(files, meta, True, "req")
    assert out == files and missing == []


def test_completion_adds_only_the_missing_entity_and_never_a_second_sources_file(monkeypatch):
    files = _ai_project(TABLES[:-1])
    meta = {"entities": {t: [] for t in TABLES}}
    monkeypatch.setattr(cm, "get_active_gemini_key", lambda: "k")
    ai_reply = {
        "models/bronze/stg_stores.sql": "select * from {{ source('raw_retail', 'raw_stores') }}",
        "models/bronze/sources.yml": "version: 2\nsources:\n  - name: raw_retail\n    tables:\n      - name: raw_stores\n",
        "models/sources.yml": "version: 2\nsources:\n  - name: raw_landing\n",          # second sources file
        "models/bronze/stg_customers.sql": "select 'rewritten'",                           # unrelated rewrite
    }
    monkeypatch.setattr(cm, "call_gemini_json", lambda *a, **k: (ai_reply, {}))

    out, missing = cm._complete_missing_entities(files, meta, True, "req")

    assert missing == []
    assert "models/bronze/stg_stores.sql" in out
    assert "raw_stores" in out["models/bronze/sources.yml"]        # existing sources file updated in place
    assert "models/sources.yml" not in out                          # no second sources file
    assert out["models/bronze/stg_customers.sql"] == files["models/bronze/stg_customers.sql"]  # untouched
    assert not any("stg_raw_" in p for p in out)
