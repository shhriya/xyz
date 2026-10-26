"""Business-user KPI editing on the shared dashboard: AI-proposed KPIs are previewed without
saving, re-validated on add, and every change can be undone. Snowflake, the LLM and the store
are all faked — these tests exercise the service logic only."""
import pytest

from app.modules.cfo_analytics import kpi_dashboard_service as kds

SCHEMA_ID = "SHOP_GOLD"
MODEL = {
    "database": "SHOP", "schema": "GOLD",
    "views": [{"status": "created", "fq_name": "SHOP.GOLD.SV", "view_name": "SV", "description": "",
               "tables": [{"name": "FCT_ORDERS", "role": "fact", "measures": [], "dimensions": [], "time_dimensions": []}]}],
}
GOOD_SQL = "SELECT SUM(AMOUNT) AS VALUE FROM SHOP.GOLD.FCT_ORDERS"


class FakeCursor:
    def __init__(self, conn):
        self.conn, self.description, self._rows = conn, None, []

    def execute(self, sql, timeout=None):
        if "BROKEN" in sql:
            raise RuntimeError("invalid identifier BROKEN")
        if "BY_MONTH" in sql:
            self.description, self._rows = [("X",), ("VALUE",)], [("2026-01", 10), ("2026-02", 12)]
        else:
            self.description, self._rows = [("VALUE",)], [(1234.5,)]

    def fetchall(self):
        return self._rows

    def close(self):
        pass


class FakeConn:
    def cursor(self):
        return FakeCursor(self)


def _kpi(name, chart="kpi_card", sql=GOOD_SQL, section="OVERVIEW"):
    return {"kpi_name": name, "label": name.title(), "description": "", "section": section, "chart_type": chart,
            "unit": "$", "sql_definition": sql, "display_order": 0, "view_name": kds.view_name_for(SCHEMA_ID, name)}


@pytest.fixture
def env(monkeypatch):
    store = {SCHEMA_ID: {"schema_id": SCHEMA_ID, "database": "SHOP", "schema": "GOLD", "sections": [],
                         "kpis": [_kpi("REVENUE"), {**_kpi("ORDERS"), "display_order": 1}]}}
    ddl, llm_replies = [], []
    monkeypatch.setattr(kds, "_load_store", lambda: store)
    monkeypatch.setattr(kds, "_save_store", lambda s: None)
    monkeypatch.setattr(kds, "execute", lambda conn, sql: ddl.append(sql))
    allowed_seen = []

    def fake_guard(conn, sql, db, sch, allowed):
        allowed_seen.append(set(allowed))
        return None, sql

    monkeypatch.setattr(kds, "validate_readonly_query_generic", fake_guard)
    monkeypatch.setattr(kds, "_schema_catalog", lambda conn, db, sch: {
        "FCT_ORDERS": [("ORDER_DATE", "DATE"), ("AMOUNT", "NUMBER")],
        "DIM_CUSTOMERS": [("CUSTOMER_ID", "NUMBER"), ("REGION", "TEXT")],
    })
    prompts = []
    real = lambda *a, **k: (prompts.append(a), llm_replies.pop(0) if llm_replies else None)[1]
    monkeypatch.setattr(kds.llm_client, "complete_json", real)
    return {"store": store, "ddl": ddl, "llm": llm_replies, "conn": FakeConn(), "allowed": allowed_seen, "prompts": prompts}


def _dash(env):
    return env["store"][SCHEMA_ID]


def test_propose_returns_preview_and_saves_nothing(env):
    env["llm"].append({"kpi": {"kpi_name": "AOV", "label": "Average order value", "chart_type": "kpi_card",
                               "section": "OVERVIEW", "sql_definition": GOOD_SQL}})
    out = kds.propose_kpi(env["conn"], MODEL, "average order value", _dash(env)["kpis"])
    assert out["kpi"]["kpi_name"] == "AOV"
    assert out["data"] == [{"VALUE": 1234.5}]
    assert len(_dash(env)["kpis"]) == 2 and env["ddl"] == []


def test_propose_plain_language_error_after_refusing_twice(env):
    env["llm"] += [{"error": "No weather data."}, {"error": "This project has no weather information."}]
    with pytest.raises(kds.KpiEditError, match="no weather"):
        kds.propose_kpi(env["conn"], MODEL, "revenue by weather", _dash(env)["kpis"])


def test_first_refusal_is_challenged_and_answered(env):
    env["llm"] += [
        {"error": "Quarterly time dimensions are not available."},
        {"kpi": {"kpi_name": "REVENUE_BY_QUARTER", "chart_type": "line", "section": "TRENDS",
                 "sql_definition": "SELECT DATE_TRUNC('QUARTER', ORDER_DATE) AS X, SUM(AMOUNT) AS VALUE "
                                   "FROM SHOP.GOLD.FCT_ORDERS GROUP BY 1 ORDER BY 1 BY_MONTH"}},
    ]
    out = kds.propose_kpi(env["conn"], MODEL, "total revenue by quarter", _dash(env)["kpis"])
    assert out["kpi"]["kpi_name"] == "REVENUE_BY_QUARTER" and len(out["data"]) == 2


def test_ai_sees_and_may_query_every_gold_table(env):
    env["llm"].append({"kpi": {"kpi_name": "CUSTOMERS_BY_REGION", "chart_type": "kpi_card", "sql_definition": GOOD_SQL}})
    kds.propose_kpi(env["conn"], MODEL, "customers by region", _dash(env)["kpis"])
    system_prompt = env["prompts"][0][0]
    assert "DIM_CUSTOMERS: CUSTOMER_ID NUMBER, REGION TEXT" in system_prompt and "ORDER_DATE DATE" in system_prompt
    assert {"DIM_CUSTOMERS", "FCT_ORDERS"} <= env["allowed"][0]


def test_propose_repairs_broken_sql_once(env):
    env["llm"] += [
        {"kpi": {"kpi_name": "TREND", "chart_type": "line", "sql_definition": "SELECT BROKEN"}},
        {"kpi": {"kpi_name": "TREND", "chart_type": "line", "section": "TRENDS",
                 "sql_definition": "SELECT MONTH AS X, SUM(A) AS VALUE FROM SHOP.GOLD.FCT_ORDERS BY_MONTH"}},
    ]
    out = kds.propose_kpi(env["conn"], MODEL, "revenue by month", _dash(env)["kpis"])
    assert out["kpi"]["section"] == "TRENDS" and len(out["data"]) == 2


def test_propose_gives_up_after_failed_repair(env):
    bad = {"kpi": {"kpi_name": "X", "chart_type": "kpi_card", "sql_definition": "SELECT BROKEN"}}
    env["llm"] += [bad, bad]
    with pytest.raises(kds.KpiEditError, match="couldn't build"):
        kds.propose_kpi(env["conn"], MODEL, "something", _dash(env)["kpis"])


def test_propose_renames_duplicate_names(env):
    env["llm"].append({"kpi": {"kpi_name": "REVENUE", "chart_type": "kpi_card", "sql_definition": GOOD_SQL}})
    out = kds.propose_kpi(env["conn"], MODEL, "net revenue", _dash(env)["kpis"])
    assert out["kpi"]["kpi_name"] == "REVENUE_2"


def test_add_creates_view_appends_and_snapshots(env):
    dash = kds.add_kpi(env["conn"], MODEL, SCHEMA_ID, {**_kpi("AOV"), "display_order": 99})
    assert [k["kpi_name"] for k in dash["kpis"]] == ["REVENUE", "ORDERS", "AOV"]
    assert dash["kpis"][-1]["display_order"] == 2
    assert "CREATE OR REPLACE VIEW" in env["ddl"][0] and len(dash["versions"]) == 1


def test_add_rejects_sql_that_no_longer_validates(env):
    with pytest.raises(kds.KpiEditError):
        kds.add_kpi(env["conn"], MODEL, SCHEMA_ID, _kpi("AOV", sql="SELECT BROKEN"))
    assert len(_dash(env)["kpis"]) == 2 and env["ddl"] == []


def test_add_enforces_max(env, monkeypatch):
    monkeypatch.setattr(kds, "MAX_KPIS", 2)
    with pytest.raises(kds.KpiEditError, match="at most 2"):
        kds.add_kpi(env["conn"], MODEL, SCHEMA_ID, _kpi("AOV"))


def test_add_same_name_replaces_in_place(env):
    dash = kds.add_kpi(env["conn"], MODEL, SCHEMA_ID, {**_kpi("REVENUE"), "label": "Net revenue"})
    assert [k["kpi_name"] for k in dash["kpis"]] == ["REVENUE", "ORDERS"]
    assert dash["kpis"][0]["label"] == "Net revenue"


def test_update_meta_and_chart_compatibility(env):
    dash = kds.update_kpi_meta(SCHEMA_ID, "REVENUE", {"label": "Sales", "section": "detail"})
    assert dash["kpis"][0]["label"] == "Sales" and dash["kpis"][0]["section"] == "DETAIL"
    with pytest.raises(kds.KpiEditError, match="Change with AI"):
        kds.update_kpi_meta(SCHEMA_ID, "REVENUE", {"chart_type": "line"})


def test_delete_reorder_and_undo(env):
    kds.delete_kpi(env["conn"], SCHEMA_ID, "REVENUE")
    assert [k["kpi_name"] for k in _dash(env)["kpis"]] == ["ORDERS"]
    dash = kds.restore_version(env["conn"], SCHEMA_ID)
    assert [k["kpi_name"] for k in dash["kpis"]] == ["REVENUE", "ORDERS"]
    assert dash["versions"] == []

    dash = kds.reorder_kpis(SCHEMA_ID, ["ORDERS", "REVENUE"])
    assert [k["kpi_name"] for k in dash["kpis"]] == ["ORDERS", "REVENUE"]
    assert [v["kpi_count"] for v in kds.list_versions(SCHEMA_ID)] == [2]


def test_undo_of_add_drops_the_new_view(env):
    kds.add_kpi(env["conn"], MODEL, SCHEMA_ID, _kpi("AOV"))
    env["ddl"].clear()
    kds.restore_version(env["conn"], SCHEMA_ID)
    assert any("DROP VIEW" in d and "AOV" in d for d in env["ddl"])


def test_undo_with_no_history(env):
    with pytest.raises(kds.KpiEditError, match="nothing to undo"):
        kds.restore_version(env["conn"], SCHEMA_ID)
