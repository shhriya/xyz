"""
dbt model build bottleneck detection (Level 2) and AI-assisted query optimization (Level 3).

dbt-specific, not part of the generic source pipeline: it reads GOV_RUN_RESULTS (which
adapters/dbt_adapter.py populates with the last several runs' node results, specifically so a
baseline exists here) joined with DBT_MODELS for each node's compiled SQL, materialization and layer.

Level 2 — detect_dbt_bottlenecks(): plain SQL + Python thresholding, no LLM. Safe to call on every
dashboard load / refresh. Each dbt node name (a model, test, snapshot, ...) is already a stable
"query shape" — no literal-stripping/normalization needed, unlike raw ad-hoc SQL. For each node it
compares each run's duration against that same node's own history (leave-one-out baseline) across
whatever runs are currently loaded, and flags:
  - absolute: duration alone exceeds a fixed ceiling (default 1 minute)
  - relative: duration is a large multiple of / std-deviations above what this node normally takes
              (default: >= 3x baseline mean, and >= mean + 3*stddev)
Builds shorter than a minimum duration (default 30 seconds) are skipped entirely.

Level 3 — optimize_dbt_bottleneck_query(): only called when a user clicks "Optimize with AI" on one
flagged model. Never runs automatically. Uses the shared LLM client to propose a rewritten SELECT,
grounded with the model's own compiled SQL and (best-effort) real column names for tables it
references. The proposed SQL is never executed — at most EXPLAIN-verified to confirm it compiles.
"""

from __future__ import annotations

import logging
import re
import statistics
from typing import Any, Dict, List, Optional, Tuple

from . import source_store
from .llm_client import complete_json
from .snowflake_helpers import get_snowflake_conn_from_user_input, query_rows, safe_identifier

logger = logging.getLogger("dbt_bottleneck_service")

DEFAULT_ABSOLUTE_THRESHOLD_SEC = 60.0  # 1 minute
DEFAULT_RELATIVE_MULTIPLIER = 3.0
# Builds shorter than this are never flagged: a 2-second build being "3x its usual 0.6s" is timing
# noise, not a bottleneck worth anyone's attention.
DEFAULT_MIN_FLAG_ELAPSED_SEC = 30.0
MIN_BASELINE_SAMPLES = 2
MAX_BOTTLENECKS_RETURNED = 25
SUCCESS_STATUSES = {"success", "pass"}

_FORBIDDEN_SQL = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CALL|COPY|PUT|GET|REMOVE|"
    r"UNDROP|USE|BEGIN|COMMIT|ROLLBACK)\b",
    re.IGNORECASE,
)
_TABLE_REF_RE = re.compile(r"\b(?:FROM|JOIN)\s+([A-Za-z_][\w.\"]*)", re.IGNORECASE)


def _safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


def _fetch_node_runs(conn, target_db: str, target_schema: str, source_id: str) -> List[Dict[str, Any]]:
    fq = f"{target_db}.{target_schema}"

    # Primary query — joins GOV_RUNS for JOB_NAME
    primary_sql = f"""
        SELECT
            r.NAME, r.RUN_ID, r.JOB_ID,
            COALESCE(g.JOB_NAME, r.JOB_ID) AS JOB_NAME,
            r.STATUS, r.STARTED_AT, r.FINISHED_AT, r.DURATION_SECS,
            r.ATTRIBUTES:resource_type::STRING AS RESOURCE_TYPE,
            r.ATTRIBUTES:rows_affected::NUMBER AS ROWS_AFFECTED,
            r.ATTRIBUTES:message::STRING AS MESSAGE,
            m.MODEL_LAYER, m.MATERIALIZATION,
            COALESCE(NULLIF(m.COMPILED_SQL, ''), NULLIF(m.RAW_SQL, '')) AS QUERY_SQL
        FROM {fq}.GOV_RUN_RESULTS r
        LEFT JOIN {fq}.GOV_RUNS g ON g.SOURCE_ID = r.SOURCE_ID AND g.RUN_ID = r.RUN_ID
        LEFT JOIN {fq}.DBT_MODELS m ON m.SOURCE_ID = r.SOURCE_ID AND m.MODEL_NAME = r.NAME
        WHERE r.SOURCE_ID = %s AND r.DURATION_SECS IS NOT NULL
        ORDER BY r.NAME, r.STARTED_AT DESC NULLS LAST
    """

    # Fallback query — no GOV_RUNS join (handles missing JOB_NAME column)
    fallback_sql = f"""
        SELECT
            r.NAME, r.RUN_ID, r.JOB_ID,
            r.JOB_ID AS JOB_NAME,
            r.STATUS, r.STARTED_AT, r.FINISHED_AT, r.DURATION_SECS,
            r.ATTRIBUTES:resource_type::STRING AS RESOURCE_TYPE,
            r.ATTRIBUTES:rows_affected::NUMBER AS ROWS_AFFECTED,
            r.ATTRIBUTES:message::STRING AS MESSAGE,
            m.MODEL_LAYER, m.MATERIALIZATION,
            COALESCE(NULLIF(m.COMPILED_SQL, ''), NULLIF(m.RAW_SQL, '')) AS QUERY_SQL
        FROM {fq}.GOV_RUN_RESULTS r
        LEFT JOIN {fq}.DBT_MODELS m ON m.SOURCE_ID = r.SOURCE_ID AND m.MODEL_NAME = r.NAME
        WHERE r.SOURCE_ID = %s AND r.DURATION_SECS IS NOT NULL
        ORDER BY r.NAME, r.STARTED_AT DESC NULLS LAST
    """

    try:
        result = query_rows(conn, primary_sql, (source_id,))
        return result["rows"]
    except Exception as e:
        logger.warning(f"Primary bottleneck query failed ({e}), using fallback without GOV_RUNS.JOB_NAME")
        result = query_rows(conn, fallback_sql, (source_id,))
        return result["rows"]


def _diagnose(row: Dict[str, Any], baseline: Optional[Dict[str, float]]) -> Dict[str, Any]:
    rows_affected = row.get("ROWS_AFFECTED")
    materialization = row.get("MATERIALIZATION") or "unknown"
    factors: List[str] = []
    primary_cause = None

    baseline_rows = (baseline or {}).get("avg_rows_affected")
    if rows_affected is not None and baseline_rows and rows_affected > baseline_rows * 1.5:
        primary_cause = "Data Volume Spike"
        factors.append(f"Produced {int(rows_affected):,} rows, {round(_safe_div(rows_affected, baseline_rows), 1)}x this model's usual {int(baseline_rows):,} rows.")

    if primary_cause is None and materialization in ("table", "incremental"):
        primary_cause = "Full Rebuild / Materialization Cost"
        factors.append(f"Materialized as '{materialization}' — a growing source table increases build time even without a code change.")

    if primary_cause is None:
        primary_cause = "Elevated Build Duration"
        factors.append("No specific cause isolated from available telemetry — likely upstream data growth or warehouse contention during this run.")

    if rows_affected is not None:
        factors.append(f"Rows affected this run: {int(rows_affected):,}.")

    return {
        "primaryCause": primary_cause,
        "factors": factors,
        "metrics": {
            "rowsAffected": int(rows_affected) if rows_affected is not None else None,
            "materialization": materialization,
            "modelLayer": row.get("MODEL_LAYER"),
        },
    }


def detect_dbt_bottlenecks(
    conn,
    target_db: str,
    target_schema: str,
    source_id: str,
    absolute_threshold_sec: float = DEFAULT_ABSOLUTE_THRESHOLD_SEC,
    relative_multiplier: float = DEFAULT_RELATIVE_MULTIPLIER,
    min_elapsed_sec: float = DEFAULT_MIN_FLAG_ELAPSED_SEC,
) -> List[Dict[str, Any]]:
    """Level 2: plain thresholding over GOV_RUN_RESULTS (joined with DBT_MODELS). No LLM call."""
    rows = _fetch_node_runs(conn, target_db, target_schema, source_id)
    if not rows:
        return []

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        if (row.get("STATUS") or "").lower() not in SUCCESS_STATUSES:
            continue  # only compare successful builds; failures aren't "slow", they're broken
        groups.setdefault(row["NAME"], []).append(row)

    bottlenecks: List[Dict[str, Any]] = []
    for name, node_rows in groups.items():
        for row in node_rows:
            elapsed_sec = float(row["DURATION_SECS"] or 0)
            if elapsed_sec < min_elapsed_sec:
                continue

            others = [r for r in node_rows if r["RUN_ID"] != row["RUN_ID"]]
            baseline: Optional[Dict[str, float]] = None
            threshold_types: List[str] = []

            if len(others) >= MIN_BASELINE_SAMPLES:
                other_durations = [float(r["DURATION_SECS"] or 0) for r in others]
                mean = statistics.mean(other_durations)
                stdev = statistics.pstdev(other_durations) if len(other_durations) > 1 else 0.0
                rows_vals = [float(r["ROWS_AFFECTED"]) for r in others if r.get("ROWS_AFFECTED") is not None]
                baseline = {
                    "avg_elapsed_sec": round(mean, 2),
                    "sample_size": len(other_durations),
                    "avg_rows_affected": statistics.mean(rows_vals) if rows_vals else None,
                }
                if elapsed_sec >= max(mean * relative_multiplier, mean + 3 * stdev) and elapsed_sec >= mean * 1.5:
                    threshold_types.append("relative")

            if elapsed_sec >= absolute_threshold_sec:
                threshold_types.append("absolute")

            if not threshold_types:
                continue

            diagnosis = _diagnose(row, baseline)
            ratio_to_baseline = round(_safe_div(elapsed_sec, baseline["avg_elapsed_sec"]), 1) if baseline else None
            severity = "HIGH" if (
                elapsed_sec >= absolute_threshold_sec * 1.5
                or (ratio_to_baseline is not None and ratio_to_baseline >= 5)
            ) else "MEDIUM"

            bottlenecks.append({
                "modelName": name,
                "resourceType": row.get("RESOURCE_TYPE"),
                "modelLayer": row.get("MODEL_LAYER"),
                "materialization": row.get("MATERIALIZATION"),
                "runId": row["RUN_ID"],
                "jobName": row.get("JOB_NAME"),
                "startedAt": str(row["STARTED_AT"]) if row.get("STARTED_AT") else None,
                "elapsedSec": round(elapsed_sec, 1),
                "baselineAvgSec": baseline["avg_elapsed_sec"] if baseline else None,
                "baselineSampleSize": baseline["sample_size"] if baseline else 0,
                "ratioToBaseline": ratio_to_baseline,
                "thresholdType": "both" if len(threshold_types) == 2 else threshold_types[0],
                "severity": severity,
                "diagnosis": diagnosis,
                "querySql": row.get("QUERY_SQL"),
            })

    bottlenecks.sort(key=lambda b: (b["severity"] != "HIGH", -b["elapsedSec"]))
    return bottlenecks[:MAX_BOTTLENECKS_RETURNED]


def detect_dbt_bottlenecks_for_source(
    source_id: str, absolute_threshold_sec: float = DEFAULT_ABSOLUTE_THRESHOLD_SEC,
    relative_multiplier: float = DEFAULT_RELATIVE_MULTIPLIER,
    min_elapsed_sec: float = DEFAULT_MIN_FLAG_ELAPSED_SEC,
) -> List[Dict[str, Any]]:
    """Looks up the source's saved connection and runs Level 2 detection. No LLM call."""
    entry = source_store.get_source(source_id)
    if not entry:
        raise LookupError(f"Unknown source_id '{source_id}'.")
    if entry["source_type"] != "dbt":
        raise ValueError("Query bottleneck detection is only available for dbt sources.")
    conn = get_snowflake_conn_from_user_input(entry["snowflake_credentials"])
    try:
        return detect_dbt_bottlenecks(
            conn, entry["target_db"], entry["target_schema"], source_id,
            absolute_threshold_sec=absolute_threshold_sec, relative_multiplier=relative_multiplier,
            min_elapsed_sec=min_elapsed_sec,
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Level 3 — AI-assisted optimization (on-demand only)
# ---------------------------------------------------------------------------

def _extract_table_refs(query_text: str, limit: int = 5) -> List[str]:
    refs = []
    for m in _TABLE_REF_RE.finditer(query_text or ""):
        ref = m.group(1).strip('"').rstrip(",")
        if ref and ref.upper() not in ("LATERAL", "TABLE") and ref not in refs:
            refs.append(ref)
        if len(refs) >= limit:
            break
    return refs


def _best_effort_schema_context(conn, query_text: str) -> Dict[str, List[str]]:
    context: Dict[str, List[str]] = {}
    for ref in _extract_table_refs(query_text):
        parts = [p.strip('"') for p in ref.split(".")]
        if len(parts) != 3:
            continue
        db, schema, table = parts
        try:
            result = query_rows(
                conn,
                f"SELECT COLUMN_NAME, DATA_TYPE FROM {safe_identifier(db, 'database')}.INFORMATION_SCHEMA.COLUMNS "
                f"WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION LIMIT 60",
                (schema.upper(), table.upper()),
            )
            cols = [f"{r['COLUMN_NAME']} {r['DATA_TYPE']}" for r in result["rows"]]
            if cols:
                context[ref] = cols
        except Exception as e:
            logger.info(f"schema lookup skipped for {ref}: {e}")
    return context


def _is_safe_select(sql: str) -> Tuple[bool, Optional[str]]:
    stripped = (sql or "").strip().rstrip(";").strip()
    if not stripped:
        return False, "Empty SQL."
    if not re.match(r"^\s*(SELECT|WITH)\b", stripped, re.IGNORECASE):
        return False, "Optimized SQL must be a SELECT (or WITH ... SELECT) statement."
    forbidden = _FORBIDDEN_SQL.search(stripped)
    if forbidden:
        return False, f"Forbidden keyword '{forbidden.group(1).upper()}' in optimized SQL."
    return True, None


def _fmt_bytes(n: Optional[float]) -> str:
    if not n:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    v, i = float(n), 0
    while v >= 1024 and i < len(units) - 1:
        v, i = v / 1024, i + 1
    return f"{v:,.1f} {units[i]}"


def _execution_stats_block(stats: Optional[Dict[str, Any]]) -> str:
    """Renders Snowflake's own measurements of the query into the prompt.

    Without these the model can only guess from SQL text which part is expensive. Spill and a poor
    pruning ratio in particular point at specific, different fixes — more memory or a tighter
    predicate on the clustering key — so stating them changes what gets suggested.
    """
    if not stats:
        return ""
    lines: List[str] = []
    if stats.get("durationSecs") is not None:
        lines.append(f"- Elapsed: {float(stats['durationSecs']):,.1f}s")
    if stats.get("bytesScanned"):
        lines.append(f"- Bytes scanned: {_fmt_bytes(stats['bytesScanned'])}")
    if stats.get("rowsProduced") is not None:
        lines.append(f"- Rows produced: {int(stats['rowsProduced']):,}")
    scanned, total = stats.get("partitionsScanned"), stats.get("partitionsTotal")
    if scanned is not None and total:
        pruned = 100.0 * (1 - (float(scanned) / float(total)))
        lines.append(f"- Micro-partitions scanned: {int(scanned):,} of {int(total):,} ({pruned:.0f}% pruned)")
        if pruned < 10 and float(total) > 50:
            lines.append("  -> Almost no pruning: predicates are not matching the table's clustering. "
                         "Prioritise a filter that can prune.")
    spill_remote = stats.get("bytesSpilledRemote") or 0
    spill_local = stats.get("bytesSpilledLocal") or 0
    if spill_remote or spill_local:
        lines.append(f"- Spilled to storage: {_fmt_bytes(spill_local)} local, {_fmt_bytes(spill_remote)} remote")
        lines.append("  -> The query exceeded warehouse memory. Reducing intermediate row width or "
                     "cardinality before the heavy join/sort matters more than micro-optimisations.")
    if stats.get("warehouse"):
        lines.append(f"- Warehouse: {stats['warehouse']}")
    if not lines:
        return ""
    return ("\n\nMEASURED EXECUTION STATISTICS (from Snowflake QUERY_HISTORY for the most recent run — "
            "these are real measurements, not estimates):\n" + "\n".join(lines))


def _system_prompt(
    model_name: str,
    diagnosis: Optional[Dict[str, Any]],
    schema_context: Dict[str, List[str]],
    execution_stats: Optional[Dict[str, Any]] = None,
) -> str:
    diagnosis_block = (
        f"\nDIAGNOSED CAUSE: {diagnosis.get('primaryCause')}\nFACTORS: {'; '.join(diagnosis.get('factors', []))}\nMETRICS: {diagnosis.get('metrics')}"
        if diagnosis else ""
    )
    diagnosis_block += _execution_stats_block(execution_stats)
    schema_block = f"\nKNOWN TABLE SCHEMAS:\n{schema_context}" if schema_context else "\n(No live schema context available — do not invent column names beyond what appears in the original query.)"
    return f"""You are a Snowflake SQL performance tuning expert reviewing a dbt model that has been flagged as a
build-time bottleneck (running far longer than its own history, or over an absolute duration ceiling).
Model: {model_name}.{diagnosis_block}{schema_block}

This is the model's COMPILED SQL (the SELECT body dbt executes for this model; dbt's own materialization
wrapper — CREATE TABLE AS / MERGE / etc. — is applied around it separately, so focus on optimizing the
SELECT logic itself). Propose a rewritten version that returns the SAME result but runs faster: push
filters earlier, replace correlated subqueries with joins or QUALIFY, avoid SELECT *, reduce scanned data
(tighter predicates on clustering/date columns), or reduce unnecessary intermediate materialization. Do
NOT invent tables, columns, or ref()/source() calls that are not in the original query.

Return ONLY a JSON object:
{{
  "optimizedSql": "the rewritten SELECT statement",
  "explanation": "markdown explanation of what changed and why it should be faster",
  "keyChanges": ["short bullet", "short bullet", ...],
  "caution": "one sentence reminding the user to verify the rewritten query returns identical results, and that any change should be made in the dbt model source file, not run directly"
}}"""


def optimize_dbt_bottleneck_query(
    model_name: str, query_sql: str, diagnosis: Optional[Dict[str, Any]] = None, conn=None,
    execution_stats: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Level 3: on-demand AI rewrite of one flagged dbt model's compiled SQL. Never called
    automatically. Never executes the proposed SQL — at most EXPLAIN-verifies it compiles."""
    if not (query_sql or "").strip():
        return {"status": "error", "message": "No compiled SQL is available for this model yet — run `dbt run` so dbt Cloud records compiled_code, then re-sync."}

    schema_context: Dict[str, List[str]] = {}
    if conn is not None:
        try:
            schema_context = _best_effort_schema_context(conn, query_sql)
        except Exception as e:
            logger.info(f"schema context unavailable: {e}")

    system = _system_prompt(model_name, diagnosis, schema_context, execution_stats)
    turns = [{"role": "user", "content": f"COMPILED SQL FOR MODEL `{model_name}`:\n{query_sql}"}]
    proposal = complete_json(system, turns, temperature=0.2, max_tokens=3000, timeout=60)

    if not proposal or not proposal.get("optimizedSql"):
        return {"status": "error", "message": "AI optimization is not available right now. Please try again shortly."}

    optimized_sql = str(proposal["optimizedSql"]).strip()
    is_safe, safety_error = _is_safe_select(optimized_sql)

    verified, verification_error = False, None
    if is_safe and conn is not None:
        try:
            cur = conn.cursor()
            try:
                cur.execute(f"EXPLAIN {optimized_sql}")
                verified = True
            finally:
                cur.close()
        except Exception as e:
            verification_error = str(e)

    return {
        "status": "success",
        "optimizedSql": optimized_sql,
        "explanation": proposal.get("explanation") or "",
        "keyChanges": proposal.get("keyChanges") or [],
        "caution": proposal.get("caution") or "Verify the rewritten query returns identical results, and apply the change in the dbt model source, not by running this directly.",
        "isSafeSelect": is_safe,
        "safetyError": safety_error,
        "verified": verified,
        "verificationError": verification_error,
        "schemaContextUsed": list(schema_context.keys()),
        "executionStatsUsed": bool(execution_stats),
    }


def _load_captured_query(conn, fq: str, source_id: str, query_id: str) -> Dict[str, Any]:
    """Pulls one captured statement's text and execution statistics from GOV_RUN_QUERIES.

    Lets the drill-down optimise a specific statement rather than the model's whole compiled SQL,
    which matters for an incremental model where the slow part is the MERGE, not the SELECT.
    """
    rows = query_rows(
        conn,
        f"""
        SELECT QUERY_TEXT, DURATION_SECS, ROWS_PRODUCED, BYTES_SCANNED, PARTITIONS_SCANNED,
               PARTITIONS_TOTAL, BYTES_SPILLED_LOCAL, BYTES_SPILLED_REMOTE, WAREHOUSE_NAME
        FROM {fq}.GOV_RUN_QUERIES
        WHERE SOURCE_ID = %s AND QUERY_ID = %s
        LIMIT 1
        """,
        (source_id, query_id),
    )["rows"]
    if not rows:
        return {}
    r = rows[0]
    return {
        "querySql": r.get("QUERY_TEXT"),
        "stats": {
            "durationSecs": r.get("DURATION_SECS"),
            "rowsProduced": r.get("ROWS_PRODUCED"),
            "bytesScanned": r.get("BYTES_SCANNED"),
            "partitionsScanned": r.get("PARTITIONS_SCANNED"),
            "partitionsTotal": r.get("PARTITIONS_TOTAL"),
            "bytesSpilledLocal": r.get("BYTES_SPILLED_LOCAL"),
            "bytesSpilledRemote": r.get("BYTES_SPILLED_REMOTE"),
            "warehouse": r.get("WAREHOUSE_NAME"),
        },
    }


def optimize_dbt_bottleneck_for_source(
    source_id: str, model_name: str, query_sql: str, diagnosis: Optional[Dict[str, Any]] = None,
    query_id: Optional[str] = None,
) -> Dict[str, Any]:
    entry = source_store.get_source(source_id)
    if not entry:
        raise LookupError(f"Unknown source_id '{source_id}'.")
    if entry["source_type"] != "dbt":
        raise ValueError("Query optimization is only available for dbt sources.")
    conn = None
    try:
        conn = get_snowflake_conn_from_user_input(entry["snowflake_credentials"])
    except Exception as e:
        logger.info(f"optimize: proceeding without a live connection ({e})")

    execution_stats = None
    if conn is not None and query_id:
        try:
            captured = _load_captured_query(
                conn, f"{entry['target_db']}.{entry['target_schema']}", source_id, query_id
            )
            execution_stats = captured.get("stats")
            # Prefer the statement actually executed over the model's compiled body.
            if captured.get("querySql"):
                query_sql = captured["querySql"]
        except Exception as e:
            logger.info(f"optimize: no captured stats for query {query_id} ({e})")

    try:
        return optimize_dbt_bottleneck_query(
            model_name, query_sql, diagnosis, conn=conn, execution_stats=execution_stats
        )
    finally:
        if conn is not None:
            conn.close()
