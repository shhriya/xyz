import logging
from typing import Any, Dict, List

from app.modules.cfo_analytics.snowflake_live import get_shared_live_snowflake_connection
from .shared import get_session_identity, resolve_credit_rate, resolve_time_range, run_query

logger = logging.getLogger("uvicorn.error")

WH_SIZE_CREDITS = {
    "X-Small": 1, "Small": 2, "Medium": 4, "Large": 8,
    "X-Large": 16, "2X-Large": 32, "3X-Large": 64, "4X-Large": 128,
    "5X-Large": 256, "6X-Large": 512
}


def get_platform_summary(credentials: Dict[str, Any]) -> Dict[str, Any]:
    """Level 1 Platform (Dashboard_layout 1.docx section 1.3): warehouses, top queries, cloud
    services, storage, data transfer, and the long tail of serverless features as one unified
    table instead of nine bespoke panels (auto-clustering, search optimization, materialized
    views, serverless tasks/alerts, data quality monitoring, replication, Snowpipe, SPCS,
    notebooks) — the blueprint's own "one query" approach for that long tail."""
    time_range = credentials.get("timeRange", "monthly")
    window = resolve_time_range(time_range)
    date_filter = window["date_filter_au"]

    try:
        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        identity = get_session_identity(cur)
        credit_rate = resolve_credit_rate(cur, identity["edition"])

        wh_sizes = _get_warehouse_sizes(cur)
        warehouses = _get_warehouse_costs(cur, date_filter, credit_rate, wh_sizes)
        warehouses_by_team = _get_warehouses_by_team(cur, date_filter, credit_rate)
        top_queries = _get_top_queries(cur, date_filter, credit_rate, wh_sizes)
        users = _get_user_attribution(cur, date_filter, credit_rate, wh_sizes)
        cloud_services = _get_cloud_services_usage(cur, window["date_filter_date"])
        other_serverless = _get_other_serverless_features(cur, date_filter, credit_rate)
        storage = _get_storage_breakdown(cur, window["date_filter_date"])
        data_transfer = _get_data_transfer(cur, date_filter)

        return {
            "status": "success",
            "creditRate": credit_rate,
            "billingPeriod": window["period_str"],
            **identity,
            "warehouses": warehouses,
            "warehousesByTeam": warehouses_by_team,
            "topQueries": top_queries,
            "users": users,
            "cloudServices": cloud_services,
            "otherServerless": other_serverless,
            "storage": storage,
            "dataTransfer": data_transfer,
        }
    except Exception as ex:
        logger.error(f"[Platform Level1 Error]: {ex}")
        return {"status": "error", "message": str(ex)}


def _get_warehouse_sizes(cur) -> Dict[str, Dict[str, Any]]:
    """SHOW WAREHOUSES config (size, auto-suspend, clusters) keyed by name — used both to annotate
    the warehouse cards and as the credits-per-hour lookup query/user attribution estimates fall
    back to when QUERY_ATTRIBUTION_HISTORY isn't available."""
    out: Dict[str, Dict[str, Any]] = {}
    try:
        cur.execute("SHOW WAREHOUSES")
        for row in cur.fetchall():
            name = str(row[0])
            size = str(row[3]) if len(row) > 3 and row[3] else "X-Small"
            auto_suspend = int(row[11]) if len(row) > 11 and row[11] is not None else 300
            clusters = int(row[6]) if len(row) > 6 and row[6] is not None else 1
            out[name] = {
                "size": size,
                "creditsPerHour": WH_SIZE_CREDITS.get(size, 1),
                "autoSuspendSec": auto_suspend,
                "activeClusters": clusters,
            }
    except Exception as e:
        logger.info(f"SHOW WAREHOUSES failed: {e}")
    return out


def _get_warehouse_costs(cur, date_filter: str, credit_rate: float, wh_sizes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    try:
        rows = run_query(cur, f"""
            SELECT warehouse_name,
                   SUM(credits_used) AS total_credits,
                   SUM(credits_used_compute) AS compute_credits,
                   SUM(credits_attributed_compute_queries) AS query_credits,
                   SUM(credits_used_compute) - SUM(credits_attributed_compute_queries) AS idle_credits,
                   ROUND(100 * (1 - SUM(credits_attributed_compute_queries)
                                / NULLIF(SUM(credits_used_compute), 0)), 1) AS idle_pct
            FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
            WHERE start_time >= {date_filter}
            GROUP BY warehouse_name
            ORDER BY total_credits DESC
        """)
    except Exception as e:
        logger.warning(f"Warehouse costs query failed: {e}")
        return []
    out = []
    for r in rows:
        total_credits = float(r["total_credits"] or 0)
        name = r["warehouse_name"]
        cfg = wh_sizes.get(name, {})
        auto_suspend = cfg.get("autoSuspendSec", 300)
        idle_pct = float(r["idle_pct"] or 0)
        optimization = "Optimal" if auto_suspend <= 300 and idle_pct < 40 else "Warning"
        recommendation = (
            f"Auto-suspend set to {auto_suspend}s." if auto_suspend <= 300
            else f"Auto-suspend is {auto_suspend}s. Reduce to 60s to avoid idle credit burn."
        )
        if idle_pct >= 40:
            recommendation = f"{idle_pct}% of compute credits are idle (not attributed to any query)."
        out.append({
            "name": name,
            "size": cfg.get("size", "Unknown"),
            "activeClusters": cfg.get("activeClusters", 1),
            "autoSuspendSec": auto_suspend,
            "optimization": optimization,
            "recommendation": recommendation,
            # creditsConsumed/costUsd are what WarehouseCostGrid renders; totalCredits/idle* are
            # the blueprint's own richer breakdown, kept alongside for a future detail view.
            "creditsConsumed": round(total_credits, 2),
            "costUsd": round(total_credits * credit_rate, 2),
            "totalCredits": round(total_credits, 2),
            "computeCredits": round(float(r["compute_credits"] or 0), 2),
            "queryCredits": round(float(r["query_credits"] or 0), 2),
            "idleCredits": round(float(r["idle_credits"] or 0), 2),
            "idlePct": idle_pct,
        })
    return out


def _get_warehouses_by_team(cur, date_filter: str, credit_rate: float) -> List[Dict[str, Any]]:
    try:
        rows = run_query(cur, f"""
            WITH wh_team AS (
                SELECT object_name AS warehouse_name, tag_value AS team
                FROM SNOWFLAKE.ACCOUNT_USAGE.TAG_REFERENCES
                WHERE domain = 'WAREHOUSE' AND tag_name = 'COST_CENTER' AND object_deleted IS NULL
            )
            SELECT COALESCE(t.team, 'UNTAGGED') AS team, m.warehouse_name,
                   SUM(m.credits_used) AS credits
            FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY m
            LEFT JOIN wh_team t ON t.warehouse_name = m.warehouse_name
            WHERE m.start_time >= {date_filter}
            GROUP BY ALL ORDER BY credits DESC
        """)
    except Exception as e:
        logger.info(f"Warehouses-by-team query not available: {e}")
        return []
    return [
        {"team": r["team"], "warehouse": r["warehouse_name"], "credits": round(float(r["credits"] or 0), 2),
         "costUsd": round(float(r["credits"] or 0) * credit_rate, 2)}
        for r in rows
    ]


def _get_top_queries(cur, date_filter: str, credit_rate: float, wh_sizes: Dict[str, Dict[str, Any]], limit: int = 50) -> List[Dict[str, Any]]:
    try:
        rows = run_query(cur, f"""
            SELECT a.query_id, a.user_name, q.role_name, a.warehouse_name, a.query_tag,
                   a.credits_attributed_compute AS credits,
                   q.execution_time / 1000.0 AS exec_secs,
                   LEFT(q.query_text, 2000) AS query_text,
                   q.start_time, q.database_name, q.query_type, q.rows_produced, q.execution_status
            FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY a
            JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY q ON q.query_id = a.query_id
            WHERE a.start_time >= {date_filter}
            ORDER BY a.credits_attributed_compute DESC
            LIMIT {int(limit)}
        """)
    except Exception as e:
        logger.info(f"QUERY_ATTRIBUTION_HISTORY join not available, falling back to elapsed-time estimate: {e}")
        return _get_top_queries_fallback(cur, date_filter, credit_rate, wh_sizes, limit)

    out = []
    for r in rows:
        credits = float(r["credits"] or 0)
        out.append({
            "queryId": r["query_id"],
            "userName": r["user_name"] or "UNKNOWN",
            "roleName": r["role_name"] or "UNKNOWN",
            "warehouseName": r["warehouse_name"] or "UNKNOWN",
            "queryTag": r["query_tag"] or "",
            "queryType": r["query_type"] or "UNKNOWN",
            "estimatedCredits": round(credits, 5),
            "estimatedCostUsd": round(credits * credit_rate, 4),
            "elapsedSec": round(float(r["exec_secs"] or 0), 2),
            "queryText": (r["query_text"] or "").strip(),
            "startTime": str(r["start_time"]) if r["start_time"] else "",
            "databaseName": r["database_name"] or "",
            "rowsProduced": int(r["rows_produced"] or 0),
            "status": "SUCCESS" if (r["execution_status"] or "SUCCESS") == "SUCCESS" else "FAIL",
            "source": "QUERY_ATTRIBUTION_HISTORY",
        })
    return out


def _get_top_queries_fallback(cur, date_filter: str, credit_rate: float, wh_sizes: Dict[str, Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    """QUERY_ATTRIBUTION_HISTORY is a newer view some accounts/editions don't expose yet. Falls
    back to the same warehouse-size-based elapsed-time estimate cost_service.py already used."""
    try:
        rows = run_query(cur, f"""
            SELECT query_id, user_name, role_name, warehouse_name, database_name, query_type,
                   rows_produced, execution_status,
                   LEFT(query_text, 2000) AS query_text,
                   total_elapsed_time / 1000.0 AS elapsed_sec, start_time
            FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
            WHERE start_time >= {date_filter} AND total_elapsed_time > 0
              AND user_name != 'SYSTEM' AND role_name != 'SNOWFLAKE' AND query_text IS NOT NULL
            ORDER BY total_elapsed_time DESC
            LIMIT {int(limit) * 3}
        """)
    except Exception as e:
        logger.warning(f"Fallback query history lookup failed: {e}")
        return []
    out = []
    for r in rows:
        elapsed = float(r["elapsed_sec"] or 0)
        credits_per_hour = wh_sizes.get(r["warehouse_name"], {}).get("creditsPerHour", 1)
        est_credits = round((elapsed / 3600.0) * credits_per_hour, 5)
        out.append({
            "queryId": r["query_id"],
            "userName": r["user_name"] or "UNKNOWN",
            "roleName": r["role_name"] or "UNKNOWN",
            "warehouseName": r["warehouse_name"] or "UNKNOWN",
            "queryTag": "",
            "queryType": r["query_type"] or "UNKNOWN",
            "estimatedCredits": est_credits,
            "estimatedCostUsd": round(est_credits * credit_rate, 4),
            "elapsedSec": round(elapsed, 2),
            "queryText": (r["query_text"] or "").strip(),
            "startTime": str(r["start_time"]) if r["start_time"] else "",
            "databaseName": r["database_name"] or "",
            "rowsProduced": int(r["rows_produced"] or 0),
            "status": "SUCCESS" if (r["execution_status"] or "SUCCESS") == "SUCCESS" else "FAIL",
            "source": "ACCOUNT_USAGE_ESTIMATE",
        })
    out.sort(key=lambda q: -q["estimatedCredits"])
    return out[:limit]


def _get_user_attribution(cur, date_filter: str, credit_rate: float, wh_sizes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Per-user rollup feeding UserCostTable's drill-down (Level 3: warehouse -> query ->
    user/role/tag -> query text). Caps at the 30 most recent queries per user, same as
    cost_service.py's original ACCOUNT_USAGE pass, to keep the payload bounded."""
    try:
        rows = run_query(cur, f"""
            SELECT query_id, user_name, role_name, warehouse_name, query_type,
                   LEFT(query_text, 2000) AS query_text, total_elapsed_time / 1000.0 AS elapsed_sec,
                   execution_status, start_time, rows_produced, database_name
            FROM (
                SELECT query_id, user_name, role_name, warehouse_name, query_type, query_text,
                       total_elapsed_time, execution_status, start_time, rows_produced, database_name,
                       ROW_NUMBER() OVER (PARTITION BY user_name ORDER BY start_time DESC) AS rn
                FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
                WHERE start_time >= {date_filter} AND total_elapsed_time > 0
                  AND user_name != 'SYSTEM' AND role_name != 'SNOWFLAKE' AND query_text IS NOT NULL
            )
            WHERE rn <= 30
            ORDER BY start_time DESC
        """)
    except Exception as e:
        logger.info(f"User attribution query failed: {e}")
        return []

    users_map: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        uname = r["user_name"] or "UNKNOWN"
        elapsed = float(r["elapsed_sec"] or 0)
        credits_per_hour = wh_sizes.get(r["warehouse_name"], {}).get("creditsPerHour", 1)
        est_credits = round((elapsed / 3600.0) * credits_per_hour, 5)
        q_obj = {
            "queryId": r["query_id"],
            "queryType": r["query_type"] or "UNKNOWN",
            "warehouseName": r["warehouse_name"] or "UNKNOWN",
            "queryText": (r["query_text"] or "").strip(),
            "elapsedSec": round(elapsed, 2),
            "estimatedCredits": est_credits,
            "status": "SUCCESS" if (r["execution_status"] or "SUCCESS") == "SUCCESS" else "FAIL",
            "startTime": str(r["start_time"]) if r["start_time"] else "",
            "rowsProduced": int(r["rows_produced"] or 0),
            "databaseName": r["database_name"] or "",
        }
        u = users_map.setdefault(uname, {
            "userId": uname, "username": uname, "email": uname, "role": r["role_name"] or "UNKNOWN",
            "queriesRun": 0, "creditsConsumed": 0.0, "estimatedCostUsd": 0.0,
            "topWarehouse": r["warehouse_name"] or "UNKNOWN", "avgQueryTimeSec": 0.0,
            "_totalElapsed": 0.0, "queries": [],
        })
        u["queriesRun"] += 1
        u["creditsConsumed"] = round(u["creditsConsumed"] + est_credits, 4)
        u["estimatedCostUsd"] = round(u["creditsConsumed"] * credit_rate, 2)
        u["_totalElapsed"] += elapsed
        u["queries"].append(q_obj)

    if users_map:
        try:
            user_list_str = ",".join(f"'{u}'" for u in users_map.keys())
            cur.execute(f"""
                SELECT NAME, DEFAULT_ROLE, EMAIL FROM SNOWFLAKE.ACCOUNT_USAGE.USERS
                WHERE NAME IN ({user_list_str})
            """)
            for un, role, email in cur.fetchall():
                if un in users_map:
                    users_map[un]["role"] = role or users_map[un]["role"]
                    users_map[un]["email"] = email or un
        except Exception:
            pass

    users = list(users_map.values())
    for u in users:
        if u["queriesRun"] > 0:
            u["avgQueryTimeSec"] = round(u["_totalElapsed"] / u["queriesRun"], 1)
        del u["_totalElapsed"]
    return sorted(users, key=lambda u: -u["creditsConsumed"])


def _get_cloud_services_usage(cur, date_filter_date: str) -> List[Dict[str, Any]]:
    try:
        rows = run_query(cur, f"""
            SELECT usage_date,
                   SUM(credits_used_cloud_services) AS cloud_services_used,
                   SUM(credits_adjustment_cloud_services) AS free_10pct_adjustment,
                   SUM(credits_used_cloud_services) + SUM(credits_adjustment_cloud_services) AS cloud_services_billed
            FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_DAILY_HISTORY
            WHERE usage_date >= {date_filter_date}
            GROUP BY usage_date ORDER BY usage_date DESC
        """)
    except Exception as e:
        logger.info(f"Cloud services usage query not available: {e}")
        return []
    return [
        {
            "date": str(r["usage_date"]),
            "used": round(float(r["cloud_services_used"] or 0), 4),
            "freeAdjustment": round(float(r["free_10pct_adjustment"] or 0), 4),
            "billed": round(float(r["cloud_services_billed"] or 0), 4),
        }
        for r in rows
    ]


def _get_other_serverless_features(cur, date_filter: str, credit_rate: float) -> List[Dict[str, Any]]:
    """Auto-clustering, search optimization, materialized views, serverless tasks/alerts, data
    quality monitoring, replication, Snowpipe, SPCS and notebooks — covered as one flat table
    grouped by SERVICE_TYPE/ENTITY_TYPE/NAME, per the blueprint's own "one query" approach."""
    try:
        rows = run_query(cur, f"""
            SELECT service_type, entity_type, name AS object_name, database_name, schema_name,
                   SUM(credits_used_compute) AS compute_credits,
                   SUM(credits_used_cloud_services) AS cloud_services_credits,
                   SUM(credits_used) AS credits,
                   SUM(bytes) AS bytes, SUM(files) AS files
            FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
            WHERE start_time >= {date_filter}
              AND service_type <> 'WAREHOUSE_METERING'
              AND service_type NOT ILIKE '%CORTEX%' AND service_type NOT ILIKE 'AI_%'
              AND service_type NOT ILIKE 'SNOWFLAKE_CO%'
            GROUP BY ALL ORDER BY credits DESC
        """)
    except Exception as e:
        logger.info(f"Other-serverless-features query failed: {e}")
        return []
    return [
        {
            "serviceType": r["service_type"],
            "entityType": r["entity_type"] or "",
            "objectName": r["object_name"] or "",
            "databaseName": r["database_name"] or "",
            "schemaName": r["schema_name"] or "",
            "credits": round(float(r["credits"] or 0), 4),
            "costUsd": round(float(r["credits"] or 0) * credit_rate, 2),
            "bytes": int(r["bytes"] or 0),
            "files": int(r["files"] or 0),
        }
        for r in rows
    ]


def _get_storage_breakdown(cur, date_filter_date: str) -> Dict[str, Any]:
    by_database = []
    try:
        rows = run_query(cur, f"""
            SELECT database_name,
                   AVG(average_database_bytes) / POWER(1024, 4) AS database_tb,
                   AVG(average_failsafe_bytes) / POWER(1024, 4) AS failsafe_tb,
                   (AVG(average_database_bytes) + AVG(average_failsafe_bytes)) / POWER(1024, 4) * 23 AS est_monthly_usd
            FROM SNOWFLAKE.ACCOUNT_USAGE.DATABASE_STORAGE_USAGE_HISTORY
            WHERE usage_date >= {date_filter_date} AND deleted IS NULL
            GROUP BY database_name ORDER BY est_monthly_usd DESC
        """)
        by_database = [
            {"database": r["database_name"], "databaseTb": round(float(r["database_tb"] or 0), 4),
             "failsafeTb": round(float(r["failsafe_tb"] or 0), 4), "estMonthlyUsd": round(float(r["est_monthly_usd"] or 0), 2)}
            for r in rows
        ]
    except Exception as e:
        logger.info(f"Storage-by-database query failed: {e}")

    by_table = []
    try:
        rows = run_query(cur, """
            SELECT table_catalog || '.' || table_schema || '.' || table_name AS table_fqn,
                   active_bytes / POWER(1024, 3) AS active_gb,
                   time_travel_bytes / POWER(1024, 3) AS time_travel_gb,
                   failsafe_bytes / POWER(1024, 3) AS failsafe_gb,
                   retained_for_clone_bytes / POWER(1024, 3) AS clone_gb
            FROM SNOWFLAKE.ACCOUNT_USAGE.TABLE_STORAGE_METRICS
            WHERE deleted = FALSE
            ORDER BY active_bytes + time_travel_bytes + failsafe_bytes DESC
            LIMIT 50
        """)
        by_table = [
            {"table": r["table_fqn"], "activeGb": round(float(r["active_gb"] or 0), 3),
             "timeTravelGb": round(float(r["time_travel_gb"] or 0), 3),
             "failsafeGb": round(float(r["failsafe_gb"] or 0), 3),
             "cloneGb": round(float(r["clone_gb"] or 0), 3)}
            for r in rows
        ]
    except Exception as e:
        logger.info(f"Storage-by-table query failed: {e}")

    return {"byDatabase": by_database, "byTable": by_table}


def _get_data_transfer(cur, date_filter: str) -> List[Dict[str, Any]]:
    try:
        rows = run_query(cur, f"""
            SELECT source_cloud, source_region, target_cloud, target_region, transfer_type,
                   SUM(bytes_transferred) / POWER(1024, 4) AS tb
            FROM SNOWFLAKE.ACCOUNT_USAGE.DATA_TRANSFER_HISTORY
            WHERE start_time >= {date_filter}
            GROUP BY ALL ORDER BY tb DESC
        """)
    except Exception as e:
        logger.info(f"Data transfer query failed: {e}")
        return []
    return [
        {
            "sourceCloud": r["source_cloud"], "sourceRegion": r["source_region"],
            "targetCloud": r["target_cloud"], "targetRegion": r["target_region"],
            "transferType": r["transfer_type"], "tb": round(float(r["tb"] or 0), 4),
        }
        for r in rows
    ]
