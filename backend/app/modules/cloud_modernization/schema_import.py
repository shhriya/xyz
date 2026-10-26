"""
Schema-Aware Generation: normalizers that turn a real source schema — live Snowflake
introspection, an uploaded DDL .sql file, a dbt schema.yml/sources.yml, or a plain CSV of
table/column definitions — into the exact `meta["entities"]` shape the generation pipeline
already expects:

    {entity_name: [{"name": str, "type": str, "desc": str, "pk": bool, "fk": bool,
                    "nullable": bool, "ts": bool}, ...]}

None of these invent columns or entities — they only reformat what's really there, which is
the entire point of Schema-Aware Generation (grounding generation in truth instead of an LLM
guess).
"""
import csv
import io
import re
from typing import Any, Dict, List

_TS_HINTS = ("_at", "_date", "_time", "timestamp", "created", "updated", "modified")
_FK_HINTS = ("_id", "_code", "_key")


def _infer_flags(col_name: str, is_pk: bool) -> Dict[str, bool]:
    name_lower = col_name.lower()
    is_ts = any(h in name_lower for h in _TS_HINTS)
    is_fk = (not is_pk) and any(name_lower.endswith(h) for h in _FK_HINTS) and name_lower not in ("id",)
    return {"fk": is_fk, "ts": is_ts}


def normalize_live_columns_to_entities(live_columns: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    """Converts the output of cfo_analytics.snowflake_live.fetch_live_columns() (keyed by
    real table name, Snowflake casing) into meta["entities"] shape (lowercase entity names)."""
    entities: Dict[str, List[Dict[str, Any]]] = {}
    for table_name, columns in live_columns.items():
        entity_name = table_name.lower()
        cols_out = []
        for col in columns:
            flags = _infer_flags(col["name"], col.get("pk", False))
            cols_out.append({
                "name": col["name"],
                "type": col["type"],
                "desc": "",
                "pk": bool(col.get("pk", False)),
                "fk": flags["fk"],
                "nullable": bool(col.get("nullable", True)),
                "ts": flags["ts"],
            })
        entities[entity_name] = cols_out
    return entities


_CREATE_TABLE_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"\[]?([\w.]+)[\"\]]?\s*\((.*?)\)\s*;",
    re.IGNORECASE | re.DOTALL,
)
_COLUMN_LINE_RE = re.compile(
    r'^\s*[\"\[]?(\w+)[\"\]]?\s+([\w]+(?:\s*\([^)]*\))?)',
)


def parse_ddl_sql_to_entities(ddl_text: str) -> Dict[str, List[Dict[str, Any]]]:
    """Regex-based CREATE TABLE parser — good enough for standard Snowflake/ANSI DDL exports.
    Does not attempt to be a full SQL parser; unrecognized lines (constraints spanning multiple
    lines, computed columns, etc.) are skipped rather than guessed at."""
    entities: Dict[str, List[Dict[str, Any]]] = {}

    for match in _CREATE_TABLE_RE.finditer(ddl_text):
        full_table_name = match.group(1)
        entity_name = full_table_name.split(".")[-1].strip('"[]').lower()
        body = match.group(2)

        pk_columns = set()
        inline_pk_match = re.search(r"PRIMARY\s+KEY\s*\(([^)]+)\)", body, re.IGNORECASE)
        if inline_pk_match:
            for c in inline_pk_match.group(1).split(","):
                pk_columns.add(c.strip().strip('"[]').lower())

        columns: List[Dict[str, Any]] = []
        depth = 0
        current = ""
        raw_lines = []
        for ch in body:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if ch == "," and depth == 0:
                raw_lines.append(current)
                current = ""
            else:
                current += ch
        if current.strip():
            raw_lines.append(current)

        for line in raw_lines:
            line = line.strip()
            if not line:
                continue
            upper = line.upper()
            if upper.startswith(("PRIMARY KEY", "FOREIGN KEY", "CONSTRAINT", "UNIQUE", "CHECK")):
                if upper.startswith("PRIMARY KEY"):
                    inner = re.search(r"\(([^)]+)\)", line)
                    if inner:
                        for c in inner.group(1).split(","):
                            pk_columns.add(c.strip().strip('"[]').lower())
                continue
            col_match = _COLUMN_LINE_RE.match(line)
            if not col_match:
                continue
            col_name = col_match.group(1)
            col_type = col_match.group(2).upper().replace(" ", "")
            is_pk = "PRIMARY KEY" in upper
            if is_pk:
                pk_columns.add(col_name.lower())
            is_nullable = "NOT NULL" not in upper
            flags = _infer_flags(col_name, is_pk)
            columns.append({
                "name": col_name.lower(),
                "type": col_type,
                "desc": "",
                "pk": is_pk,
                "fk": flags["fk"],
                "nullable": is_nullable,
                "ts": flags["ts"],
            })

        for col in columns:
            if col["name"] in pk_columns:
                col["pk"] = True

        if columns:
            entities[entity_name] = columns

    return entities


def parse_dbt_yaml_to_entities(yaml_text: str) -> Dict[str, List[Dict[str, Any]]]:
    """Parses a dbt schema.yml / sources.yml (sources: or models: block) into entities.
    Recognizes standard dbt_utils tests (unique, not_null) to infer pk/nullable when present."""
    import yaml as _yaml

    entities: Dict[str, List[Dict[str, Any]]] = {}
    try:
        parsed = _yaml.safe_load(yaml_text) or {}
    except Exception:
        return entities

    def _extract_tables(block_list, key):
        for block in block_list or []:
            for table in block.get(key, []) or []:
                table_name = table.get("name", "")
                if not table_name:
                    continue
                columns = []
                for col in table.get("columns", []) or []:
                    col_name = col.get("name", "")
                    if not col_name:
                        continue
                    tests = col.get("tests", []) or col.get("data_tests", []) or []
                    test_names = [t if isinstance(t, str) else next(iter(t.keys()), "") for t in tests]
                    is_pk = "unique" in test_names and "not_null" in test_names
                    is_nullable = "not_null" not in test_names
                    flags = _infer_flags(col_name, is_pk)
                    columns.append({
                        "name": col_name.lower(),
                        "type": col.get("data_type", "VARCHAR(255)").upper() if col.get("data_type") else "VARCHAR(255)",
                        "desc": col.get("description", ""),
                        "pk": is_pk,
                        "fk": flags["fk"],
                        "nullable": is_nullable,
                        "ts": flags["ts"],
                    })
                if columns:
                    entities[table_name.lower()] = columns

    if "sources" in parsed:
        _extract_tables(parsed["sources"], "tables")
    if "models" in parsed:
        entities_from_models: Dict[str, List[Dict[str, Any]]] = {}
        for model in parsed["models"] or []:
            model_name = model.get("name", "")
            if not model_name:
                continue
            columns = []
            for col in model.get("columns", []) or []:
                col_name = col.get("name", "")
                if not col_name:
                    continue
                tests = col.get("tests", []) or col.get("data_tests", []) or []
                test_names = [t if isinstance(t, str) else next(iter(t.keys()), "") for t in tests]
                is_pk = "unique" in test_names and "not_null" in test_names
                is_nullable = "not_null" not in test_names
                flags = _infer_flags(col_name, is_pk)
                columns.append({
                    "name": col_name.lower(),
                    "type": col.get("data_type", "VARCHAR(255)").upper() if col.get("data_type") else "VARCHAR(255)",
                    "desc": col.get("description", ""),
                    "pk": is_pk,
                    "fk": flags["fk"],
                    "nullable": is_nullable,
                    "ts": flags["ts"],
                })
            if columns:
                entities_from_models[model_name.lower()] = columns
        entities.update(entities_from_models)

    return entities


def parse_csv_to_entities(csv_text: str) -> Dict[str, List[Dict[str, Any]]]:
    """Parses a plain CSV of table/column definitions. Expected columns (case-insensitive,
    flexible order): table_name (or entity/table), column_name (or column/name), data_type
    (or type), is_primary_key (or pk), is_nullable (or nullable). Only table_name and
    column_name are required; the rest default sensibly when absent."""
    entities: Dict[str, List[Dict[str, Any]]] = {}
    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames:
        return entities

    field_map = {f.lower().strip(): f for f in reader.fieldnames}

    def _get(row, *keys, default=""):
        for k in keys:
            if k in field_map:
                val = row.get(field_map[k], default)
                if val not in (None, ""):
                    return val
        return default

    for row in reader:
        table_name = str(_get(row, "table_name", "entity", "table", "entity_name")).strip()
        col_name = str(_get(row, "column_name", "column", "name")).strip()
        if not table_name or not col_name:
            continue
        entity_name = table_name.lower()
        col_type = str(_get(row, "data_type", "type", default="VARCHAR(255)")).strip().upper()
        is_pk = str(_get(row, "is_primary_key", "pk", "primary_key", default="")).strip().lower() in ("true", "1", "yes", "y")
        nullable_raw = _get(row, "is_nullable", "nullable", default="")
        is_nullable = True if nullable_raw == "" else str(nullable_raw).strip().lower() in ("true", "1", "yes", "y")
        flags = _infer_flags(col_name, is_pk)
        entities.setdefault(entity_name, []).append({
            "name": col_name.lower(),
            "type": col_type,
            "desc": str(_get(row, "description", "desc", default="")),
            "pk": is_pk,
            "fk": flags["fk"],
            "nullable": is_nullable,
            "ts": flags["ts"],
        })

    return entities
