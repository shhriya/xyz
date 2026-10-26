import logging
from typing import Any, Dict, Optional

from app.modules.cfo_analytics.snowflake_live import get_shared_live_snowflake_connection
from .shared import get_session_identity, is_permission_error, resolve_credit_rate, resolve_time_range, run_query
from .cortex_ai import get_cortex_ai_summary

logger = logging.getLogger("uvicorn.error")


def get_org_overview(credentials: Dict[str, Any]) -> Dict[str, Any]:
    """Level 0: organization-wide spend overview (Dashboard_layout 1.docx section 1.2).

    Primary path reads SNOWFLAKE.ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY, which needs ORGADMIN
    or a role explicitly granted access to it. Most connected roles won't have that, so on a
    permission error this degrades to the same response shape computed from this account's own
    ACCOUNT_USAGE.METERING_HISTORY instead of failing the whole tab.
    """
    time_range = credentials.get("timeRange", "monthly")
    window = resolve_time_range(time_range)

    try:
        conn, _ = get_shared_live_snowflake_connection(credentials, scope="costing")
        cur = conn.cursor()
        identity = get_session_identity(cur)
        credit_rate = resolve_credit_rate(cur, identity["edition"])

        try:
            live_cortex = get_cortex_ai_summary(credentials)
            live_cortex_usd = live_cortex.get("totalCostUsd", 0.0) if live_cortex.get("status") == "success" else None
        except:
            live_cortex_usd = None

        org_result = _try_org_overview(cur, window["date_filter_date"])
        if org_result is not None:
            if live_cortex_usd is not None:
                old_cortex = org_result["kpis"]["cortexSpendUsd"]
                platform = round(org_result["kpis"]["totalSpendUsd"] - old_cortex, 2)
                new_total = round(platform + live_cortex_usd, 2)
                new_share = round((live_cortex_usd / new_total * 100), 1) if new_total > 0 else 0.0
                
                org_result["kpis"]["cortexSpendUsd"] = live_cortex_usd
                org_result["kpis"]["platformSpendUsd"] = platform
                org_result["kpis"]["totalSpendUsd"] = new_total
                org_result["kpis"]["cortexSharePct"] = new_share
                
                for cat in org_result["spendByCategory"]:
                    if cat["category"] == "AI_COMPUTE":
                        cat["amountUsd"] = live_cortex_usd
                for cat in org_result["spendByCategory"]:
                    cat["sharePct"] = round((cat["amountUsd"] / new_total * 100), 1) if new_total > 0 else 0.0

            return {
                "status": "success",
                "scope": "organization",
                "message": "",
                "creditRate": credit_rate,
                "billingPeriod": window["period_str"],
                **identity,
                **org_result,
            }

        fallback = _account_fallback_overview(cur, window["date_filter_au"], credit_rate)
        if live_cortex_usd is not None:
            old_cortex = fallback["kpis"]["cortexSpendUsd"]
            platform = round(fallback["kpis"]["totalSpendUsd"] - old_cortex, 2)
            new_total = round(platform + live_cortex_usd, 2)
            new_share = round((live_cortex_usd / new_total * 100), 1) if new_total > 0 else 0.0
            
            fallback["kpis"]["cortexSpendUsd"] = live_cortex_usd
            fallback["kpis"]["platformSpendUsd"] = platform
            fallback["kpis"]["totalSpendUsd"] = new_total
            fallback["kpis"]["cortexSharePct"] = new_share
            
            for cat in fallback["spendByCategory"]:
                if cat["category"] == "AI_COMPUTE":
                    cat["amountUsd"] = live_cortex_usd
            for cat in fallback["spendByCategory"]:
                cat["sharePct"] = round((cat["amountUsd"] / new_total * 100), 1) if new_total > 0 else 0.0

        return {
            "status": "success",
            "scope": "account_fallback",
            "message": (
                "Showing this account only — org-wide spend needs a role with "
                "SNOWFLAKE.ORGANIZATION_USAGE access (ORGADMIN, or a role explicitly granted it)."
            ),
            "creditRate": credit_rate,
            "billingPeriod": window["period_str"],
            **identity,
            **fallback,
        }
    except Exception as ex:
        logger.error(f"[Overview Level0 Error]: {ex}")
        return {"status": "error", "message": str(ex)}


def _try_org_overview(cur, date_filter_date: str) -> Optional[Dict[str, Any]]:
    try:
        cur.execute(f"""
            WITH u AS (
                SELECT usage_date, rating_type, service_type, account_name, usage_in_currency
                FROM SNOWFLAKE.ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY
                WHERE usage_date >= {date_filter_date}
            ),
            tot AS (SELECT SUM(usage_in_currency) AS total_usd FROM u)
            SELECT 'KPI' AS section, 1 AS sort_order, NULL::DATE AS usage_date, 'Total spend' AS label,
                   ROUND(SUM(usage_in_currency), 2) AS value, NULL::NUMBER(10,1) AS share_pct
            FROM u
            UNION ALL
            SELECT 'KPI', 2, NULL, 'Platform spend',
                   ROUND(SUM(IFF(rating_type <> 'AI_COMPUTE', usage_in_currency, 0)), 2), NULL FROM u
            UNION ALL
            SELECT 'KPI', 3, NULL, 'Cortex AI spend',
                   ROUND(SUM(IFF(rating_type = 'AI_COMPUTE', usage_in_currency, 0)), 2), NULL FROM u
            UNION ALL
            SELECT 'KPI', 4, NULL, 'Cortex share %',
                   ROUND(100 * SUM(IFF(rating_type = 'AI_COMPUTE', usage_in_currency, 0))
                         / NULLIF(SUM(usage_in_currency), 0), 1), NULL FROM u
            UNION ALL
            SELECT 'SPEND_BY_CATEGORY', 5, NULL, rating_type,
                   ROUND(SUM(usage_in_currency), 2),
                   ROUND(100 * SUM(usage_in_currency) / NULLIF(ANY_VALUE(tot.total_usd), 0), 1)
            FROM u CROSS JOIN tot GROUP BY rating_type
            UNION ALL
            SELECT 'DAILY_TREND', 6, usage_date, rating_type, ROUND(SUM(usage_in_currency), 2), NULL
            FROM u GROUP BY usage_date, rating_type
            UNION ALL
            SELECT 'TOP_SERVICES', 7, NULL, service_type, ROUND(SUM(usage_in_currency), 2),
                   ROUND(100 * SUM(usage_in_currency) / NULLIF(ANY_VALUE(tot.total_usd), 0), 1)
            FROM u CROSS JOIN tot GROUP BY service_type
            QUALIFY RANK() OVER (ORDER BY SUM(usage_in_currency) DESC) <= 10
            UNION ALL
            SELECT 'TOP_ACCOUNTS', 8, NULL, account_name, ROUND(SUM(usage_in_currency), 2),
                   ROUND(100 * SUM(usage_in_currency) / NULLIF(ANY_VALUE(tot.total_usd), 0), 1)
            FROM u CROSS JOIN tot GROUP BY account_name
            QUALIFY RANK() OVER (ORDER BY SUM(usage_in_currency) DESC) <= 10
            ORDER BY sort_order, usage_date, value DESC
        """)
        rows = cur.fetchall()
    except Exception as e:
        if is_permission_error(e):
            return None
        raise

    kpis: Dict[str, float] = {}
    spend_by_category = []
    daily_trend_map: Dict[str, Dict[str, Any]] = {}
    top_services = []
    top_accounts = []

    for section, _sort, usage_date, label, value, share_pct in rows:
        value = float(value or 0)
        if section == 'KPI':
            kpis[label] = value
        elif section == 'SPEND_BY_CATEGORY':
            spend_by_category.append({"category": label, "amountUsd": value, "sharePct": float(share_pct or 0)})
        elif section == 'DAILY_TREND':
            day = str(usage_date)
            entry = daily_trend_map.setdefault(day, {"day": day})
            entry[label or "OTHER"] = value
        elif section == 'TOP_SERVICES':
            top_services.append({"service": label, "amountUsd": value, "sharePct": float(share_pct or 0)})
        elif section == 'TOP_ACCOUNTS':
            top_accounts.append({"account": label, "amountUsd": value, "sharePct": float(share_pct or 0)})

    daily_trend = sorted(daily_trend_map.values(), key=lambda d: d["day"])

    return {
        "kpis": {
            "totalSpendUsd": kpis.get("Total spend", 0.0),
            "platformSpendUsd": kpis.get("Platform spend", 0.0),
            "cortexSpendUsd": kpis.get("Cortex AI spend", 0.0),
            "cortexSharePct": kpis.get("Cortex share %", 0.0),
        },
        "spendByCategory": spend_by_category,
        "dailyTrend": daily_trend,
        "topServices": top_services,
        "topAccounts": top_accounts,
    }


def _account_fallback_overview(cur, date_filter_au: str, credit_rate: float) -> Dict[str, Any]:
    """No ORGANIZATION_USAGE access: approximate the same response shape from this account's own
    ACCOUNT_USAGE.METERING_HISTORY. RATING_TYPE doesn't exist at account scope, so the AI_SERVICES
    service type stands in for the Cortex/Platform split the org-wide query uses."""
    total_credits = 0.0
    ai_credits = 0.0
    by_service: Dict[str, float] = {}
    daily_map: Dict[str, Dict[str, Any]] = {}

    try:
        rows = run_query(cur, f"""
            SELECT SERVICE_TYPE, START_TIME::DATE AS usage_date, SUM(CREDITS_USED) AS credits
            FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
            WHERE START_TIME >= {date_filter_au}
            GROUP BY SERVICE_TYPE, usage_date
        """)
        for r in rows:
            credits = float(r["credits"] or 0)
            total_credits += credits
            svc = r["service_type"] or "OTHER"
            is_ai = svc == "AI_SERVICES"
            if is_ai:
                ai_credits += credits
            by_service[svc] = by_service.get(svc, 0.0) + credits
            day = str(r["usage_date"])
            entry = daily_map.setdefault(day, {"day": day, "AI_COMPUTE": 0.0, "PLATFORM": 0.0})
            entry["AI_COMPUTE" if is_ai else "PLATFORM"] += round(credits * credit_rate, 2)
    except Exception as e:
        logger.warning(f"Account-fallback overview query failed: {e}")

    total_usd = round(total_credits * credit_rate, 2)
    ai_usd = round(ai_credits * credit_rate, 2)
    platform_usd = round(total_usd - ai_usd, 2)
    cortex_share = round((ai_credits / total_credits * 100), 1) if total_credits > 0 else 0.0

    top_services = sorted(
        [{"service": k, "amountUsd": round(v * credit_rate, 2)} for k, v in by_service.items()],
        key=lambda s: -s["amountUsd"]
    )[:10]

    spend_by_category = [
        {"category": "PLATFORM", "amountUsd": platform_usd, "sharePct": round(100 - cortex_share, 1)},
        {"category": "AI_COMPUTE", "amountUsd": ai_usd, "sharePct": cortex_share},
    ]

    daily_trend = sorted(daily_map.values(), key=lambda d: d["day"])

    return {
        "kpis": {
            "totalSpendUsd": total_usd,
            "platformSpendUsd": platform_usd,
            "cortexSpendUsd": ai_usd,
            "cortexSharePct": cortex_share,
        },
        "spendByCategory": spend_by_category,
        "dailyTrend": daily_trend,
        "topServices": top_services,
        "topAccounts": [],
    }
