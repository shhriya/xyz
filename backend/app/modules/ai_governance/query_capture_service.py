"""
Query-level capture for the monitoring drill-down (job -> model -> query).

dbt's API does not expose the SQL a model ran. What it does expose, per node in run_results.json,
is `adapter_response`, and for dbt-snowflake that dict carries the Snowflake `query_id`. The adapter
has always stored it (adapters/dbt_adapter.py), buried in GOV_RUN_RESULTS.ATTRIBUTES — this module
is what finally reads it.

Two stages, because they have different privilege requirements and different freshness:

  seed    Project adapter_response:query_id out of the VARIANT into GOV_RUN_QUERIES. One row per
          model per run, needs no grants beyond what the sync already has. This alone satisfies
          "show me the query this model ran", but only the final statement of each model.

  enrich  Hop through SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY: resolve the seeded query ids to their
          SESSION_IDs, then pull every statement those sessions ran inside the run's window. An
          incremental model issues several (create temp table, merge, drop), and only this stage
          sees them. It also brings the execution statistics the optimiser needs to reason from
          bytes scanned, partition pruning, spill.

Enrichment is best-effort by design. ACCOUNT_USAGE needs IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE
and lags 45 minutes to 3 hours, so an account without the grant, or a run from ten minutes ago,
degrades to seed-only rather than failing the sync.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .snowflake_helpers import execute, execute_rowcount, query_rows

QUERIES_TABLE = "GOV_RUN_QUERIES"

# ACCOUNT_USAGE.QUERY_HISTORY is not real-time. Runs younger than this are left un-enriched so the
# next refresh retries them, instead of recording "no queries found" as though it were final.
ACCOUNT_USAGE_LAG_HOURS = 3

# How far back a single enrichment pass will look. Bounds the ACCOUNT_USAGE scan, which is the
# expensive part — older runs keep whatever they were enriched with last time.
ENRICH_LOOKBACK_DAYS = 45

# Slack on each end of a node's execute window, used only by the time-window fallback below.
NODE_WINDOW_TOLERANCE_SEC = 2

# dbt stamps a JSON comment on every statement it sends, and by default that comment carries the
# node id — the same value dbt reports as a run result's unique_id, which is what we store in
# RESULT_ID. So a statement can be tied to its model exactly, by reading dbt's own marker:
#
#   /* {"app": "dbt", "dbt_version": "1.x", "node_id": "model.my_project.dim_date"} */
#   create or replace table ... as (select ...)
#
# This matters because the obvious alternative does not work. Attributing by session plus a time
# window fails on any real project: models take a second or two each and run back-to-back on the
# same thread, so a window wide enough to contain one model's statements also contains its
# neighbours'. That produced every model reporting the whole run's statements.
#
# The marker is only absent if a project overrides query_comment to drop node_id, so the window
# approach is kept as a fallback and the mode is probed once per enrichment.
_NODE_ID_MARKER = '"node_id"'

# Statements dbt issues for bookkeeping or cleanup rather than to build the model. DROP is here
# because dbt drops its own temp/backup relations, and a cleanup statement is not something anyone
# wants listed as one of a model's queries, let alone handed to the optimiser.
_NOISE_QUERY_TYPES = (
    "USE", "SHOW", "DESCRIBE", "ALTER_SESSION", "SET", "UNSET",
    "BEGIN_TRANSACTION", "COMMIT", "ROLLBACK", "DROP", "GET_FILES", "PUT_FILES",
)


def seed_from_run_results(conn, fq: str, source_id: str, source_type: str) -> int:
    """Writes one GOV_RUN_QUERIES row per model per run from the already-synced adapter_response.

    Idempotent: MERGEd on (SOURCE_ID, RUN_ID, RESULT_ID, QUERY_ID), so re-running after a refresh
    adds the new runs and leaves enriched rows untouched.
    """
    try:
        return execute_rowcount(
            conn,
            f"""
            MERGE INTO {fq}.{QUERIES_TABLE} t
            USING (
                SELECT
                    r.SOURCE_ID,
                    %s                                              AS SOURCE_TYPE,
                    r.RUN_ID,
                    r.RESULT_ID,
                    r.NAME                                          AS MODEL_NAME,
                    r.ATTRIBUTES:adapter_response:query_id::VARCHAR AS QUERY_ID,
                    1                                               AS QUERY_SEQ,
                    r.STATUS,
                    r.STARTED_AT,
                    r.DURATION_SECS,
                    r.ATTRIBUTES:rows_affected::NUMBER              AS ROWS_PRODUCED
                FROM {fq}.GOV_RUN_RESULTS r
                WHERE r.SOURCE_ID = %s
                  AND r.ATTRIBUTES:adapter_response:query_id IS NOT NULL
                -- The partition repeats the full expression rather than the QUERY_ID alias: alias
                -- visibility in QUALIFY varies, and a silent failure here would abort the sync.
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY r.SOURCE_ID, r.RUN_ID, r.RESULT_ID,
                                 r.ATTRIBUTES:adapter_response:query_id::VARCHAR
                    ORDER BY r.STARTED_AT DESC
                ) = 1
            ) s
            ON  t.SOURCE_ID = s.SOURCE_ID AND t.RUN_ID = s.RUN_ID
            AND t.RESULT_ID = s.RESULT_ID AND t.QUERY_ID = s.QUERY_ID
            WHEN NOT MATCHED THEN INSERT
                (SOURCE_ID, SOURCE_TYPE, RUN_ID, RESULT_ID, MODEL_NAME, QUERY_ID, QUERY_SEQ,
                 STATUS, STARTED_AT, DURATION_SECS, ROWS_PRODUCED, IS_PRIMARY, SYNC_TIMESTAMP)
            VALUES
                (s.SOURCE_ID, s.SOURCE_TYPE, s.RUN_ID, s.RESULT_ID, s.MODEL_NAME, s.QUERY_ID, s.QUERY_SEQ,
                 s.STATUS, s.STARTED_AT, s.DURATION_SECS, s.ROWS_PRODUCED, TRUE, CURRENT_TIMESTAMP())
            """,
            (source_type, source_id),
        )
    except Exception as e:
        print(f"[query capture] seed skipped: {e}")
        return -1


def account_usage_available(conn) -> bool:
    """One cheap probe, so a missing grant is reported once instead of as a failed enrichment."""
    try:
        query_rows(conn, "SELECT 1 FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY LIMIT 1")
        return True
    except Exception as e:
        print(f"[query capture] ACCOUNT_USAGE.QUERY_HISTORY not readable ({e}); "
              f"drill-down will show the primary query per model only.")
        return False


def node_id_matching_available(conn, fq: str, source_id: str) -> bool:
    """Probes whether dbt's statements carry the node_id marker, choosing exact or fallback matching.

    Scoped to the sessions our own seeded queries ran in, so this reads this project's dbt traffic
    rather than scanning the account's whole query history.
    """
    try:
        rows = query_rows(
            conn,
            f"""
            SELECT 1
            FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY h
            JOIN {fq}.{QUERIES_TABLE} q
              ON q.QUERY_ID = h.QUERY_ID AND q.SOURCE_ID = %s AND q.IS_PRIMARY = TRUE
            WHERE h.START_TIME > DATEADD(day, -{ENRICH_LOOKBACK_DAYS}, CURRENT_TIMESTAMP())
              AND h.QUERY_TEXT ILIKE '%%{_NODE_ID_MARKER}%%'
            LIMIT 1
            """,
            (source_id,),
        )["rows"]
        available = bool(rows)
    except Exception as e:
        print(f"[query capture] node_id probe failed, using time-window matching: {e}")
        return False

    print(f"[query capture] attribution mode: {'node_id (exact)' if available else 'time window (approximate)'}")
    return available


def enrich_from_query_history(
    conn, fq: str, source_id: str, source_type: str, exact: Optional[bool] = None,
) -> Dict[str, Any]:
    """Expands each seeded primary query into the other statements that same model ran.

    Attribution is session AND the model's own execution window, and it needs both:

      - Session alone is wrong. dbt runs models on a thread pool, and each thread holds ONE
        Snowflake session that it reuses for many models in sequence. Matching on session alone
        hands every model its whole thread's statements, i.e. every other model's work too.
      - Time window alone is wrong. Threads run concurrently, so several models are executing in
        the same instant on different sessions.

    Together they are precise: a statement belongs to this model if it ran on this model's session
    between this model's start and finish. The primary query is always included regardless, since
    dbt reported it directly.
    """
    if not account_usage_available(conn):
        return {"status": "unavailable", "inserted": 0}

    noise = ", ".join(f"'{t}'" for t in _NOISE_QUERY_TYPES)
    if exact is None:
        exact = node_id_matching_available(conn, fq, source_id)
    # Exact: dbt's own node marker in the statement text. Session still scopes it to this run,
    # because the same node id appears in every run the model has ever had.
    # Fallback: the node's execute window, which cannot separate models that run back-to-back.
    # Requires both the marker and this node's id, rather than a single literal like
    # '"node_id": "<id>"' — dbt's JSON spacing differs between versions, and matching on the exact
    # punctuation would silently fall through to matching nothing.
    match_sql = (
        f"(h.QUERY_TEXT ILIKE '%%{_NODE_ID_MARKER}%%' "
        f"AND h.QUERY_TEXT ILIKE '%%' || a.RESULT_ID || '%%')"
        if exact else
        "h.START_TIME BETWEEN a.WINDOW_START AND a.WINDOW_END"
    )
    try:
        inserted = execute_rowcount(
            conn,
            f"""
            MERGE INTO {fq}.{QUERIES_TABLE} t
            USING (
                WITH seeds AS (
                    -- The node's DURATION comes from GOV_RUN_RESULTS, not from GOV_RUN_QUERIES.
                    -- This MERGE overwrites the primary row's STARTED_AT/DURATION_SECS with the
                    -- statement's own values, so reading the window back off that row meant the
                    -- window shrank to one statement on the second pass and drifted every pass
                    -- after. GOV_RUN_RESULTS is the source of truth and is never written here.
                    SELECT q.SOURCE_ID, q.RUN_ID, q.RESULT_ID, q.MODEL_NAME, q.QUERY_ID,
                           COALESCE(rr.DURATION_SECS, 0) AS NODE_DURATION_SECS
                    FROM {fq}.{QUERIES_TABLE} q
                    JOIN {fq}.GOV_RUN_RESULTS rr
                      ON rr.SOURCE_ID = q.SOURCE_ID
                     AND rr.RUN_ID    = q.RUN_ID
                     AND rr.RESULT_ID = q.RESULT_ID
                    WHERE q.SOURCE_ID = %s
                      AND q.IS_PRIMARY = TRUE
                      AND q.ENRICHED_AT IS NULL
                      AND q.STARTED_AT IS NOT NULL
                      -- Younger than the ACCOUNT_USAGE lag: skip now, retry on the next refresh.
                      AND q.STARTED_AT < DATEADD(hour, -{ACCOUNT_USAGE_LAG_HOURS}, CURRENT_TIMESTAMP())
                      AND q.STARTED_AT > DATEADD(day, -{ENRICH_LOOKBACK_DAYS}, CURRENT_TIMESTAMP())
                ),
                anchors AS (
                    -- The window is built entirely from QUERY_HISTORY's own clock: the primary
                    -- statement's START_TIME, widened backwards by the node's duration. dbt's
                    -- timestamps are only ever used as a LENGTH, never as an absolute instant, so
                    -- a timezone difference between dbt and Snowflake cannot shift the window.
                    SELECT s.RUN_ID, s.RESULT_ID, s.MODEL_NAME, s.QUERY_ID AS PRIMARY_QUERY_ID,
                           h.SESSION_ID,
                           DATEADD(millisecond,
                                   -CAST((s.NODE_DURATION_SECS + {NODE_WINDOW_TOLERANCE_SEC}) * 1000 AS INT),
                                   h.START_TIME) AS WINDOW_START,
                           DATEADD(millisecond,
                                   CAST(COALESCE(h.TOTAL_ELAPSED_TIME, 0) AS INT)
                                   + {NODE_WINDOW_TOLERANCE_SEC} * 1000,
                                   h.START_TIME) AS WINDOW_END
                    FROM seeds s
                    JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY h ON h.QUERY_ID = s.QUERY_ID
                    WHERE h.START_TIME > DATEADD(day, -{ENRICH_LOOKBACK_DAYS}, CURRENT_TIMESTAMP())
                )
                SELECT
                    %s                                   AS SOURCE_ID,
                    %s                                   AS SOURCE_TYPE,
                    a.RUN_ID,
                    a.RESULT_ID,
                    a.MODEL_NAME,
                    h.QUERY_ID,
                    ROW_NUMBER() OVER (PARTITION BY a.RESULT_ID, a.RUN_ID ORDER BY h.START_TIME) AS QUERY_SEQ,
                    h.QUERY_TEXT,
                    h.QUERY_TYPE,
                    h.EXECUTION_STATUS                   AS STATUS,
                    -- Stored as NTZ-in-UTC to match the dbt-sourced rows. Letting the LTZ value
                    -- land in the NTZ column implicitly would record it in the session's timezone,
                    -- so the same statement would read hours apart depending on who synced.
                    CONVERT_TIMEZONE('UTC', h.START_TIME)::TIMESTAMP_NTZ AS STARTED_AT,
                    h.TOTAL_ELAPSED_TIME / 1000.0        AS DURATION_SECS,
                    h.ROWS_PRODUCED,
                    h.BYTES_SCANNED,
                    h.PARTITIONS_SCANNED,
                    h.PARTITIONS_TOTAL,
                    h.BYTES_SPILLED_TO_LOCAL_STORAGE     AS BYTES_SPILLED_LOCAL,
                    h.BYTES_SPILLED_TO_REMOTE_STORAGE    AS BYTES_SPILLED_REMOTE,
                    h.WAREHOUSE_NAME,
                    (h.QUERY_ID = a.PRIMARY_QUERY_ID)    AS IS_PRIMARY
                FROM anchors a
                JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY h
                  ON h.SESSION_ID = a.SESSION_ID
                 AND (
                      -- The statement dbt itself named for this node, always kept.
                      h.QUERY_ID = a.PRIMARY_QUERY_ID
                      -- ...or a statement this node is responsible for, by whichever rule applies.
                      OR {match_sql}
                 )
                WHERE h.QUERY_TYPE NOT IN ({noise})
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY a.RUN_ID, a.RESULT_ID, h.QUERY_ID ORDER BY h.START_TIME
                ) = 1
            ) s
            ON  t.SOURCE_ID = s.SOURCE_ID AND t.RUN_ID = s.RUN_ID
            AND t.RESULT_ID = s.RESULT_ID AND t.QUERY_ID = s.QUERY_ID
            WHEN MATCHED THEN UPDATE SET
                t.QUERY_SEQ = s.QUERY_SEQ, t.QUERY_TEXT = s.QUERY_TEXT, t.QUERY_TYPE = s.QUERY_TYPE,
                t.STATUS = s.STATUS, t.STARTED_AT = s.STARTED_AT, t.DURATION_SECS = s.DURATION_SECS,
                t.ROWS_PRODUCED = s.ROWS_PRODUCED, t.BYTES_SCANNED = s.BYTES_SCANNED,
                t.PARTITIONS_SCANNED = s.PARTITIONS_SCANNED, t.PARTITIONS_TOTAL = s.PARTITIONS_TOTAL,
                t.BYTES_SPILLED_LOCAL = s.BYTES_SPILLED_LOCAL,
                t.BYTES_SPILLED_REMOTE = s.BYTES_SPILLED_REMOTE,
                t.WAREHOUSE_NAME = s.WAREHOUSE_NAME, t.ENRICHED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT
                (SOURCE_ID, SOURCE_TYPE, RUN_ID, RESULT_ID, MODEL_NAME, QUERY_ID, QUERY_SEQ, QUERY_TEXT,
                 QUERY_TYPE, STATUS, STARTED_AT, DURATION_SECS, ROWS_PRODUCED, BYTES_SCANNED,
                 PARTITIONS_SCANNED, PARTITIONS_TOTAL, BYTES_SPILLED_LOCAL, BYTES_SPILLED_REMOTE,
                 WAREHOUSE_NAME, IS_PRIMARY, ENRICHED_AT, SYNC_TIMESTAMP)
            VALUES
                (s.SOURCE_ID, s.SOURCE_TYPE, s.RUN_ID, s.RESULT_ID, s.MODEL_NAME, s.QUERY_ID, s.QUERY_SEQ,
                 s.QUERY_TEXT, s.QUERY_TYPE, s.STATUS, s.STARTED_AT, s.DURATION_SECS, s.ROWS_PRODUCED,
                 s.BYTES_SCANNED, s.PARTITIONS_SCANNED, s.PARTITIONS_TOTAL, s.BYTES_SPILLED_LOCAL,
                 s.BYTES_SPILLED_REMOTE, s.WAREHOUSE_NAME, s.IS_PRIMARY, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """,
            (source_id, source_id, source_type),
        )
    except Exception as e:
        print(f"[query capture] enrichment failed: {e}")
        return {"status": "error", "inserted": 0, "error": str(e)[:300]}

    # Mark the anchors we processed, so a run with genuinely no sibling statements isn't retried
    # forever. Rows still inside the ACCOUNT_USAGE lag keep ENRICHED_AT NULL and come back next time.
    try:
        execute(
            conn,
            f"""
            UPDATE {fq}.{QUERIES_TABLE}
            SET ENRICHED_AT = CURRENT_TIMESTAMP()
            WHERE SOURCE_ID = %s AND IS_PRIMARY = TRUE AND ENRICHED_AT IS NULL
              AND STARTED_AT < DATEADD(hour, -{ACCOUNT_USAGE_LAG_HOURS}, CURRENT_TIMESTAMP())
              AND STARTED_AT > DATEADD(day, -{ENRICH_LOOKBACK_DAYS}, CURRENT_TIMESTAMP())
            """,
            (source_id,),
        )
    except Exception as e:
        print(f"[query capture] could not mark rows enriched: {e}")

    return {"status": "ok", "inserted": inserted}


def prune_misattributed_queries(conn, fq: str, source_id: str, exact: bool = False) -> int:
    """Deletes captured statements that the current attribution rule would not have claimed.

    States the rule as an invariant and enforces it, rather than trusting that whatever wrote the
    rows got it right. It has to exist because enrichment MERGEs: rows written by an earlier, wrong
    rule are never removed by simply fixing the rule, and this module has already had two of those
    (session-only matching, then a self-overwriting time window).

    Mirrors whichever rule enrichment is using, so the two agree — otherwise this would delete rows
    enrichment immediately re-adds, on every sync. Idempotent: once the data is right it deletes
    nothing. Primary rows are never touched; dbt named those directly.
    """
    if exact:
        # dbt's own marker: a statement belongs to the node whose id it carries.
        keeps = (
            f"t.QUERY_TEXT ILIKE '%%{_NODE_ID_MARKER}%%' "
            f"AND t.QUERY_TEXT ILIKE '%%' || t.RESULT_ID || '%%'"
        )
        where = f"""
            DELETE FROM {fq}.{QUERIES_TABLE} t
            WHERE t.SOURCE_ID = %s
              AND COALESCE(t.IS_PRIMARY, FALSE) = FALSE
              AND t.QUERY_TEXT IS NOT NULL
              AND NOT ({keeps})
        """
    else:
        where = f"""
            DELETE FROM {fq}.{QUERIES_TABLE} t
            WHERE t.SOURCE_ID = %s
              AND COALESCE(t.IS_PRIMARY, FALSE) = FALSE
              AND NOT EXISTS (
                  SELECT 1
                  FROM {fq}.{QUERIES_TABLE} p
                  JOIN {fq}.GOV_RUN_RESULTS rr
                    ON rr.SOURCE_ID = p.SOURCE_ID
                   AND rr.RUN_ID    = p.RUN_ID
                   AND rr.RESULT_ID = p.RESULT_ID
                  WHERE p.SOURCE_ID = t.SOURCE_ID
                    AND p.RUN_ID    = t.RUN_ID
                    AND p.RESULT_ID = t.RESULT_ID
                    AND p.IS_PRIMARY = TRUE
                    AND p.STARTED_AT IS NOT NULL
                    -- Same window as the enrichment fallback: the primary statement's start,
                    -- widened back by the node's duration from GOV_RUN_RESULTS (never overwritten
                    -- here). Both sides are statement clock, so no timezone skew.
                    AND t.STARTED_AT BETWEEN
                          DATEADD(millisecond,
                                  -CAST((COALESCE(rr.DURATION_SECS, 0)
                                         + {NODE_WINDOW_TOLERANCE_SEC}) * 1000 AS INT),
                                  p.STARTED_AT)
                      AND DATEADD(millisecond,
                                  CAST(COALESCE(p.DURATION_SECS, 0) * 1000 AS INT)
                                  + {NODE_WINDOW_TOLERANCE_SEC} * 1000,
                                  p.STARTED_AT)
              )
        """

    try:
        bad = execute_rowcount(conn, where, (source_id,))
    except Exception as e:
        print(f"[query capture] attribution check skipped: {e}")
        return -1

    if bad and bad > 0:
        print(f"[query capture] removed {bad} misattributed statement(s); re-enriching affected runs.")
        try:
            # Those models were marked enriched off the bad pass, so clear the marker to let the
            # corrected query re-collect their real statements on this sync.
            execute(
                conn,
                f"UPDATE {fq}.{QUERIES_TABLE} SET ENRICHED_AT = NULL "
                f"WHERE SOURCE_ID = %s AND IS_PRIMARY = TRUE",
                (source_id,),
            )
        except Exception as e:
            print(f"[query capture] could not reset enrichment markers: {e}")
    return bad


def capture_queries(conn, fq: str, source_id: str, source_type: str) -> Dict[str, Any]:
    """Seed, repair any bad attribution, then enrich. Called from the sync pipeline; never raises."""
    seeded = seed_from_run_results(conn, fq, source_id, source_type)
    # Probed once and shared, so the repair and the enrichment cannot disagree about which rule is
    # in force — if they did, each sync would delete rows the other immediately re-adds.
    exact = account_usage_available(conn) and node_id_matching_available(conn, fq, source_id)
    pruned = prune_misattributed_queries(conn, fq, source_id, exact=exact)
    enriched = enrich_from_query_history(conn, fq, source_id, source_type, exact=exact)
    return {
        "seeded": seeded,
        "attribution": "node_id" if exact else "time_window",
        "misattributed_removed": pruned,
        "enrichment": enriched,
    }


_QUERY_COLUMNS = """RUN_ID, RESULT_ID, MODEL_NAME, QUERY_ID, QUERY_SEQ, QUERY_TEXT, QUERY_TYPE, STATUS,
               STARTED_AT, DURATION_SECS, ROWS_PRODUCED, BYTES_SCANNED, PARTITIONS_SCANNED,
               PARTITIONS_TOTAL, BYTES_SPILLED_LOCAL, BYTES_SPILLED_REMOTE, WAREHOUSE_NAME,
               IS_PRIMARY, ENRICHED_AT"""


def fetch_model_queries(
    conn, fq: str, source_id: str, model_name: str, since_sql: str,
    run_id: Optional[str] = None, latest_only: bool = True,
) -> List[Dict[str, Any]]:
    """Level 3 of the drill-down: the statements one model ran.

    Defaults to the model's most recent run. A model issues only one or a few statements per run, so
    listing every run in the period stacks the same two statements hundreds of times and buries the
    thing the user opened the model to look at. `latest_only=False` gives the full history.

    Returns an empty list rather than raising when the table isn't there yet — it is only created by
    a sync run after query capture was added, and the caller's fallback (the model's compiled SQL)
    is a better answer than an error page.
    """
    params: List[Any] = [source_id, model_name]
    run_filter = ""
    if run_id:
        run_filter = "AND RUN_ID = %s"
        params.append(str(run_id))

    inner = f"""
        SELECT {_QUERY_COLUMNS},
               FIRST_VALUE(RUN_ID) OVER (ORDER BY STARTED_AT DESC NULLS LAST) AS LATEST_RUN_ID
        FROM {fq}.{QUERIES_TABLE}
        WHERE SOURCE_ID = %s AND UPPER(MODEL_NAME) = UPPER(%s) {run_filter} {since_sql}
    """
    # An explicit run_id already pins one run, so the latest-run filter would be redundant.
    outer_filter = "WHERE RUN_ID = LATEST_RUN_ID" if (latest_only and not run_id) else ""

    try:
        result = query_rows(
            conn,
            f"""
            SELECT {_QUERY_COLUMNS}
            FROM ({inner})
            {outer_filter}
            ORDER BY STARTED_AT DESC NULLS LAST, QUERY_SEQ
            LIMIT 500
            """,
            tuple(params),
        )
        return result["rows"]
    except Exception as e:
        print(f"[query capture] no captured queries readable for '{model_name}': {e}")
        return []
