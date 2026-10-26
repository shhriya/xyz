"""Side Chat: a targeted edit proposal from a prompt, minimal-footprint, applies nothing itself."""
import importlib

sc = importlib.import_module("app.modules.cloud_modernization.services.side_chat")

FILES = {
    "dbt_project.yml": "name: shop\n",
    "models/bronze/stg_orders.sql": "select * from {{ source('raw','orders') }}",
    "models/gold/orders_summary.sql": "select status, count(*) from {{ ref('stg_orders') }} group by status",
}


def test_no_api_key_or_no_project_proposes_nothing():
    assert sc.propose_change("add a filter", FILES, "snowflake", "") == ([], "", {})
    assert sc.propose_change("add a filter", {}, "snowflake", "k") == ([], "", {})


def test_only_genuinely_changed_files_are_returned(monkeypatch):
    reply = {
        "summary": "Excluded cancelled orders from the Gold summary.",
        "changes": [
            {"path": "models/gold/orders_summary.sql",
             "content": "select status, count(*) from {{ ref('stg_orders') }} where status != 'CANCELLED' group by status",
             "reason": "The summary counted cancelled orders; added the exclusion."},
            {"path": "models/bronze/stg_orders.sql", "content": FILES["models/bronze/stg_orders.sql"],
             "reason": "no-op the AI returned anyway"},   # identical content -> must be dropped
        ],
    }
    monkeypatch.setattr(sc, "call_gemini_json", lambda *a, **k: (reply, {"totalTokenCount": 42}))
    changes, summary, usage = sc.propose_change("exclude cancelled orders from the summary", FILES, "snowflake", "k")
    assert [c["path"] for c in changes] == ["models/gold/orders_summary.sql"]
    assert changes[0]["isNew"] is False
    assert "cancelled" in summary.lower()
    assert usage == {"totalTokenCount": 42}


def test_new_file_is_marked_new_and_path_traversal_is_rejected(monkeypatch):
    reply = {"summary": "Added a churn model.", "changes": [
        {"path": "models/gold/churn.sql", "content": "select 1", "reason": "new requirement"},
        {"path": "../../etc/passwd", "content": "nope", "reason": "malicious"},
        {"path": "", "content": "nope", "reason": "empty path"},
        {"path": "models/x.sql", "content": 123, "reason": "wrong type"},
    ]}
    monkeypatch.setattr(sc, "call_gemini_json", lambda *a, **k: (reply, {}))
    changes, _, _ = sc.propose_change("add churn model", FILES, "snowflake", "k")
    assert len(changes) == 1
    assert changes[0]["path"] == "models/gold/churn.sql" and changes[0]["isNew"] is True


def test_non_dict_ai_response_proposes_nothing(monkeypatch):
    monkeypatch.setattr(sc, "call_gemini_json", lambda *a, **k: (None, {}))
    assert sc.propose_change("do something", FILES, "snowflake", "k") == ([], "", {})
