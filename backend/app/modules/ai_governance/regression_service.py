"""
Trend and regression detection across a selected period, at job, model and query level.

This replaces the leave-one-out baseline in dbt_bottleneck_service.detect_dbt_bottlenecks for the
new time-filtered UI. That baseline compared a run against the mean of the same node's *other*
runs among whatever was loaded — at most six — which answers "was this run unusual" but cannot
answer the actual question: "has this model got slower than it used to be". A mean that includes
the regression itself is dragged toward it, so a model that permanently doubled looks normal again
after a few runs.

Instead each entity's runs over the period are split in two: the most recent few are "current",
everything before them is the "baseline", and the two are compared. That yields the before/after
numbers directly — was 5 minutes, now 20 — rather than a ratio against a blended mean.

Duration and row count are compared independently, because they mean different things. A model that
doubled in time *and* in rows is tracking data growth; one that doubled in time while rows stayed
flat is a plan or skew problem, and is the more urgent of the two.
"""

from __future__ import annotations

import statistics
from typing import Any, Dict, List, Optional

from .drilldown_service import FAILURE_SQL, since_clause
from .snowflake_helpers import query_rows

# A "current" window of one run is enough to flag, but noisy; a few is steadier. Capped so a long
# period with hundreds of runs doesn't average the regression away.
CURRENT_WINDOW_MAX = 5
MIN_BASELINE_SAMPLES = 2

# Growth beyond this is a regression. 1.5 = "takes half again as long as it used to".
DEFAULT_REGRESSION_MULTIPLIER = 1.5
# Below this, proportional growth is timing noise — a 0.4s build becoming 1.2s is not a finding.
DEFAULT_MIN_CURRENT_SEC = 10.0
# Row-count growth is judged separately and more loosely: volume genuinely grows over time.
DEFAULT_ROW_GROWTH_MULTIPLIER = 1.5

MAX_FINDINGS_RETURNED = 50
SUCCESS_STATUSES = {"success", "pass"}

LEVELS = ("job", "model", "query")


def _safe_div(a: float, b: float) -> Optional[float]:
    return (a / b) if b else None


def _pct_change(before: float, after: float) -> Optional[float]:
    if not before:
        return None
    return round(100.0 * (after - before) / before, 1)


# ---------------------------------------------------------------------------
# Row fetching, one query per level
# ---------------------------------------------------------------------------

def _fetch_job_rows(conn, fq: str, source_id: str, period: str) -> List[Dict[str, Any]]:
    return query_rows(
        conn,
        f"""
        SELECT JOB_ID AS ENTITY_KEY, MAX(JOB_NAME) OVER (PARTITION BY JOB_ID) AS LABEL,
               RUN_ID, STARTED_AT, DURATION_SECS, NULL AS ROW_COUNT, STATUS,
               NULL AS PARENT, NULL AS QUERY_SEQ
        FROM {fq}.GOV_RUNS
        WHERE SOURCE_ID = %s AND DURATION_SECS IS NOT NULL AND STARTED_AT IS NOT NULL
          {since_clause("STARTED_AT", period)}
        ORDER BY JOB_ID, STARTED_AT
        """,
        (source_id,),
    )["rows"]


def _fetch_model_rows(conn, fq: str, source_id: str, period: str) -> List[Dict[str, Any]]:
    return query_rows(
        conn,
        f"""
        SELECT r.NAME AS ENTITY_KEY, r.NAME AS LABEL, r.RUN_ID, r.STARTED_AT, r.DURATION_SECS,
               r.ATTRIBUTES:rows_affected::NUMBER AS ROW_COUNT, r.STATUS,
               r.JOB_ID AS PARENT, NULL AS QUERY_SEQ,
               m.MATERIALIZATION, m.MODEL_LAYER,
               r.ATTRIBUTES:resource_type::VARCHAR AS RESOURCE_TYPE
        FROM {fq}.GOV_RUN_RESULTS r
        LEFT JOIN {fq}.DBT_MODELS m
               ON m.SOURCE_ID = r.SOURCE_ID AND UPPER(m.MODEL_NAME) = UPPER(r.NAME)
        WHERE r.SOURCE_ID = %s AND r.DURATION_SECS IS NOT NULL AND r.STARTED_AT IS NOT NULL
          {since_clause("r.STARTED_AT", period)}
        ORDER BY r.NAME, r.STARTED_AT
        """,
        (source_id,),
    )["rows"]


def _fetch_query_rows(conn, fq: str, source_id: str, period: str) -> List[Dict[str, Any]]:
    """Query-level history.

    Grouped by (model, statement position) rather than QUERY_ID, because a query id is unique to one
    execution — the same statement has a different id every run. The Nth statement a model issues is
    the stable identity across runs.
    """
    return query_rows(
        conn,
        f"""
        SELECT MODEL_NAME || ' #' || QUERY_SEQ AS ENTITY_KEY,
               MODEL_NAME AS LABEL, RUN_ID, STARTED_AT, DURATION_SECS,
               ROWS_PRODUCED AS ROW_COUNT, STATUS, MODEL_NAME AS PARENT, QUERY_SEQ,
               QUERY_ID, QUERY_TEXT, QUERY_TYPE, BYTES_SCANNED,
               PARTITIONS_SCANNED, PARTITIONS_TOTAL,
               BYTES_SPILLED_LOCAL, BYTES_SPILLED_REMOTE, WAREHOUSE_NAME
        FROM {fq}.GOV_RUN_QUERIES
        WHERE SOURCE_ID = %s AND DURATION_SECS IS NOT NULL AND STARTED_AT IS NOT NULL
          {since_clause("STARTED_AT", period)}
        ORDER BY MODEL_NAME, QUERY_SEQ, STARTED_AT
        """,
        (source_id,),
    )["rows"]


_FETCHERS = {"job": _fetch_job_rows, "model": _fetch_model_rows, "query": _fetch_query_rows}


# ---------------------------------------------------------------------------
# Diagnosis
# ---------------------------------------------------------------------------

def _fmt_bytes(n: Optional[float]) -> str:
    if not n:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    v, i = float(n), 0
    while v >= 1024 and i < len(units) - 1:
        v, i = v / 1024, i + 1
    return f"{v:,.1f} {units[i]}"


def _diagnose(latest: Dict[str, Any], duration: Dict[str, Any], rows: Dict[str, Any]) -> Dict[str, Any]:
    """Names the most likely cause, preferring explanations backed by a measured number.

    Order matters: data growth is checked first because when it holds it is almost always the real
    answer, and reporting a plan problem over it would send someone looking for a bug that isn't there.
    """
    factors: List[str] = []
    cause: Optional[str] = None

    before_s, after_s = duration["baselineAvgSec"], duration["currentAvgSec"]
    factors.append(f"Duration went from {before_s:,.1f}s to {after_s:,.1f}s "
                   f"({duration['pctChange']:+.0f}%)." if duration.get("pctChange") is not None
                   else f"Duration now {after_s:,.1f}s (was {before_s:,.1f}s).")

    row_ratio = rows.get("ratio")
    if row_ratio and row_ratio >= DEFAULT_ROW_GROWTH_MULTIPLIER:
        cause = "Data Volume Growth"
        factors.append(f"Row count grew from {rows['baselineAvgRows']:,.0f} to "
                       f"{rows['currentAvgRows']:,.0f} ({row_ratio:.1f}x) over the same period.")
    elif row_ratio is not None and row_ratio < 1.2 and duration["ratio"] and duration["ratio"] >= 1.5:
        # The important case: same work, more time.
        cause = "Slower With No Volume Change"
        factors.append(f"Row count is effectively flat ({row_ratio:.2f}x) while duration rose "
                       f"{duration['ratio']:.1f}x — points at data skew, a changed join, or a plan regression "
                       f"rather than growth.")

    spill = (latest.get("BYTES_SPILLED_REMOTE") or 0) + (latest.get("BYTES_SPILLED_LOCAL") or 0)
    if spill:
        remote = latest.get("BYTES_SPILLED_REMOTE") or 0
        factors.append(f"Spilled {_fmt_bytes(spill)} to {'remote' if remote else 'local'} storage — "
                       f"the warehouse ran out of memory for this query.")
        if cause is None or remote:
            cause = "Memory Spill"

    scanned, total = latest.get("PARTITIONS_SCANNED"), latest.get("PARTITIONS_TOTAL")
    if scanned and total and total > 0:
        pruned_pct = 100.0 * (1 - (scanned / total))
        factors.append(f"Scanned {int(scanned):,} of {int(total):,} micro-partitions "
                       f"({pruned_pct:.0f}% pruned).")
        if pruned_pct < 10 and total > 50:
            factors.append("Almost no partition pruning — the filter isn't matching the table's "
                           "clustering, so this is close to a full scan.")
            if cause in (None, "Slower With No Volume Change"):
                cause = "No Partition Pruning"

    if latest.get("BYTES_SCANNED"):
        factors.append(f"Scanned {_fmt_bytes(latest['BYTES_SCANNED'])} on the most recent run.")

    materialization = latest.get("MATERIALIZATION")
    if cause is None and materialization in ("table", "incremental"):
        cause = "Full Rebuild / Materialization Cost"
        factors.append(f"Materialized as '{materialization}' — a growing source table raises build "
                       f"time with no code change.")

    if cause is None:
        cause = "Elevated Duration"
        factors.append("No single cause isolated from the available telemetry — likely upstream "
                       "growth or warehouse contention.")

    return {
        "primaryCause": cause,
        "factors": factors,
        "metrics": {
            "materialization": materialization,
            "modelLayer": latest.get("MODEL_LAYER"),
            "warehouse": latest.get("WAREHOUSE_NAME"),
            "bytesScanned": latest.get("BYTES_SCANNED"),
            "partitionsScanned": latest.get("PARTITIONS_SCANNED"),
            "partitionsTotal": latest.get("PARTITIONS_TOTAL"),
            "bytesSpilledLocal": latest.get("BYTES_SPILLED_LOCAL"),
            "bytesSpilledRemote": latest.get("BYTES_SPILLED_REMOTE"),
        },
    }


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def detect_regressions(
    conn,
    fq: str,
    source_id: str,
    period: str = "30",
    level: str = "model",
    regression_multiplier: float = DEFAULT_REGRESSION_MULTIPLIER,
    min_current_sec: float = DEFAULT_MIN_CURRENT_SEC,
    row_growth_multiplier: float = DEFAULT_ROW_GROWTH_MULTIPLIER,
) -> Dict[str, Any]:
    """Compares each entity's recent runs against its earlier runs in the same period."""
    if level not in LEVELS:
        level = "model"
    try:
        rows = _FETCHERS[level](conn, fq, source_id, period)
    except Exception as e:
        return {"level": level, "period": period, "findings": [], "error": str(e)[:300],
                "message": "Could not read history for this level."}

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        # Only successful executions are comparable: a failure isn't slow, it's broken, and a run
        # that died early would read as a speed-up.
        if (row.get("STATUS") or "").strip().lower() not in SUCCESS_STATUSES:
            continue
        key = row.get("ENTITY_KEY")
        if key:
            groups.setdefault(str(key), []).append(row)

    findings: List[Dict[str, Any]] = []
    skipped_insufficient = 0

    for key, entity_rows in groups.items():
        entity_rows.sort(key=lambda r: str(r.get("STARTED_AT") or ""))
        if len(entity_rows) < MIN_BASELINE_SAMPLES + 1:
            skipped_insufficient += 1
            continue

        # Most recent quarter of the runs is "now", capped — the rest is "before".
        n_current = max(1, min(CURRENT_WINDOW_MAX, len(entity_rows) // 4))
        baseline_rows, current_rows = entity_rows[:-n_current], entity_rows[-n_current:]
        if len(baseline_rows) < MIN_BASELINE_SAMPLES:
            skipped_insufficient += 1
            continue

        base_durs = [float(r["DURATION_SECS"] or 0) for r in baseline_rows]
        curr_durs = [float(r["DURATION_SECS"] or 0) for r in current_rows]
        base_avg, curr_avg = statistics.mean(base_durs), statistics.mean(curr_durs)
        dur_ratio = _safe_div(curr_avg, base_avg)

        base_rows_vals = [float(r["ROW_COUNT"]) for r in baseline_rows if r.get("ROW_COUNT") is not None]
        curr_rows_vals = [float(r["ROW_COUNT"]) for r in current_rows if r.get("ROW_COUNT") is not None]
        base_rows_avg = statistics.mean(base_rows_vals) if base_rows_vals else None
        curr_rows_avg = statistics.mean(curr_rows_vals) if curr_rows_vals else None
        row_ratio = (_safe_div(curr_rows_avg, base_rows_avg)
                     if base_rows_avg is not None and curr_rows_avg is not None else None)

        slower = bool(dur_ratio and dur_ratio >= regression_multiplier and curr_avg >= min_current_sec)
        grew = bool(row_ratio and row_ratio >= row_growth_multiplier)
        if not slower and not grew:
            continue

        latest = current_rows[-1]
        duration_block = {
            "baselineAvgSec": round(base_avg, 2),
            "currentAvgSec": round(curr_avg, 2),
            "ratio": round(dur_ratio, 2) if dur_ratio else None,
            "pctChange": _pct_change(base_avg, curr_avg),
            "worstSec": round(max(curr_durs), 2),
        }
        rows_block = {
            "baselineAvgRows": base_rows_avg,
            "currentAvgRows": curr_rows_avg,
            "ratio": round(row_ratio, 2) if row_ratio else None,
            "pctChange": (_pct_change(base_rows_avg, curr_rows_avg)
                          if base_rows_avg is not None and curr_rows_avg is not None else None),
        }

        severity = "HIGH" if (dur_ratio and dur_ratio >= 3) or (row_ratio and row_ratio >= 3) else "MEDIUM"
        findings.append({
            "level": level,
            "entityKey": key,
            "label": latest.get("LABEL") or key,
            "parent": latest.get("PARENT"),
            "resourceType": latest.get("RESOURCE_TYPE"),
            "modelLayer": latest.get("MODEL_LAYER"),
            "materialization": latest.get("MATERIALIZATION"),
            "querySeq": latest.get("QUERY_SEQ"),
            "queryId": latest.get("QUERY_ID"),
            "querySql": latest.get("QUERY_TEXT"),
            "latestRunId": latest.get("RUN_ID"),
            "latestRunAt": latest.get("STARTED_AT"),
            "baselineSampleSize": len(baseline_rows),
            "currentSampleSize": len(current_rows),
            "firstSeenAt": entity_rows[0].get("STARTED_AT"),
            "duration": duration_block,
            "rows": rows_block,
            "flags": [f for f, on in (("slower", slower), ("row_growth", grew)) if on],
            "severity": severity,
            "diagnosis": _diagnose(latest, duration_block, rows_block),
        })

    findings.sort(key=lambda f: (
        f["severity"] != "HIGH",
        -(f["duration"]["ratio"] or 0),
        -(f["duration"]["currentAvgSec"] or 0),
    ))

    return {
        "level": level,
        "period": period,
        "findings": findings[:MAX_FINDINGS_RETURNED],
        "totalFindings": len(findings),
        "entitiesCompared": len(groups) - skipped_insufficient,
        "entitiesSkippedForHistory": skipped_insufficient,
        "thresholds": {
            "regressionMultiplier": regression_multiplier,
            "minCurrentSec": min_current_sec,
            "rowGrowthMultiplier": row_growth_multiplier,
        },
    }


def count_flagged(conn, fq: str, source_id: str, period: str) -> Dict[str, int]:
    """Flagged counts for the summary strip. Failures come from GOV_RUNS directly."""
    out = {"modelsFlagged": 0, "queriesFlagged": 0}
    for level, key in (("model", "modelsFlagged"), ("query", "queriesFlagged")):
        try:
            out[key] = detect_regressions(conn, fq, source_id, period=period, level=level)["totalFindings"]
        except Exception:
            out[key] = 0
    return out


def failures_in_period(conn, fq: str, source_id: str, period: str) -> int:
    try:
        rows = query_rows(
            conn,
            f"SELECT COUNT_IF({FAILURE_SQL}) AS FAILED FROM {fq}.GOV_RUNS "
            f"WHERE SOURCE_ID = %s {since_clause('STARTED_AT', period)}",
            (source_id,),
        )["rows"]
        return int((rows[0] if rows else {}).get("FAILED") or 0)
    except Exception:
        return 0
