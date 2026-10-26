"""
Guards for LLM-authored SQL (KPI definitions during Setup, ad-hoc queries in the chatbot).

A statement is accepted only if it is a single SELECT/WITH query, contains no DDL/DML keywords,
is scoped to the requested SOURCE_ID, and Snowflake's own query plan (EXPLAIN) shows it reads
nothing but the allowed monitoring objects.
"""

from __future__ import annotations

import re
from typing import Iterable, List, Optional, Tuple

_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CALL|COPY|PUT|"
    r"UNDROP|USE|EXECUTE|BEGIN|COMMIT|ROLLBACK|SHOW|DESCRIBE)\b",
    re.IGNORECASE,
)


def _strip_literals_and_comments(sql: str) -> str:
    no_comments = re.sub(r"--[^\n]*|/\*[\s\S]*?\*/", " ", sql)
    return re.sub(r"'(?:[^']|'')*'", "''", no_comments)


def normalize_sql(sql: str) -> str:
    return (sql or "").strip().rstrip(";").strip()


def static_check(sql: str, source_id: str) -> Optional[str]:
    """Returns an error message, or None if the statement passes the static checks."""
    if not sql:
        return "Empty SQL."
    skeleton = _strip_literals_and_comments(sql)
    if ";" in skeleton:
        return "Only a single statement is allowed."
    if not re.match(r"^\s*(SELECT|WITH)\b", skeleton, re.IGNORECASE):
        return "SQL must be a SELECT (or WITH ... SELECT) query."
    forbidden = _FORBIDDEN.search(skeleton)
    if forbidden:
        return f"Forbidden keyword '{forbidden.group(1).upper()}' in SQL."
    if f"'{source_id}'" not in sql:
        return f"SQL must filter every table on SOURCE_ID = '{source_id}'."
    return None


def static_check_generic(sql: str) -> Optional[str]:
    """Same static checks as static_check() but without the SOURCE_ID-scoping requirement, for
    use cases with no per-source filtering concept (e.g. a KPI dashboard generated from a whole
    schema rather than one governance source)."""
    if not sql:
        return "Empty SQL."
    skeleton = _strip_literals_and_comments(sql)
    if ";" in skeleton:
        return "Only a single statement is allowed."
    if not re.match(r"^\s*(SELECT|WITH)\b", skeleton, re.IGNORECASE):
        return "SQL must be a SELECT (or WITH ... SELECT) query."
    forbidden = _FORBIDDEN.search(skeleton)
    if forbidden:
        return f"Forbidden keyword '{forbidden.group(1).upper()}' in SQL."
    return None


def referenced_objects(conn, sql: str, timeout: int = 60) -> List[str]:
    """Fully-qualified objects Snowflake will read, taken from the EXPLAIN plan."""
    cur = conn.cursor()
    try:
        cur.execute(f"EXPLAIN USING TABULAR {sql}", timeout=timeout)
        cols = [d[0].lower() for d in cur.description]
        if "objects" not in cols:
            # Fail closed: without the plan's object list we cannot prove the query stays in scope.
            raise RuntimeError("EXPLAIN output has no 'objects' column; cannot verify referenced objects.")
        idx = cols.index("objects")
        objects = set()
        for row in cur.fetchall():
            if row[idx]:
                for obj in str(row[idx]).split(","):
                    if obj.strip():
                        objects.add(obj.strip().replace('"', "").upper())
        return sorted(objects)
    finally:
        cur.close()


def check_objects(objects: Iterable[str], target_db: str, target_schema: str, allowed_names: Iterable[str]) -> Optional[str]:
    allowed = {f"{target_db}.{target_schema}.{n}".upper() for n in allowed_names}
    disallowed = [o for o in objects if o not in allowed]
    if disallowed:
        return f"SQL reads objects outside the allowed monitoring tables: {', '.join(disallowed)}"
    return None


def validate_readonly_query(
    conn, sql: str, source_id: str, target_db: str, target_schema: str, allowed_names: Iterable[str],
) -> Tuple[Optional[str], str]:
    """Runs all checks. Returns (error_message_or_None, normalized_sql)."""
    normalized = normalize_sql(sql)
    error = static_check(normalized, source_id)
    if error:
        return error, normalized
    try:
        objects = referenced_objects(conn, normalized)
    except Exception as e:
        return f"SQL does not compile: {e}", normalized
    return check_objects(objects, target_db, target_schema, allowed_names), normalized


def validate_readonly_query_generic(
    conn, sql: str, target_db: str, target_schema: str, allowed_names: Iterable[str],
) -> Tuple[Optional[str], str]:
    """Like validate_readonly_query but without the SOURCE_ID-scoping requirement."""
    normalized = normalize_sql(sql)
    error = static_check_generic(normalized)
    if error:
        return error, normalized
    try:
        objects = referenced_objects(conn, normalized)
    except Exception as e:
        return f"SQL does not compile: {e}", normalized
    return check_objects(objects, target_db, target_schema, allowed_names), normalized
