"""One-time import of pre-PostgreSQL local data into the database in DATABASE_URL.

Copies:
  * backend/modernization.db (the old SQLite fallback database)
  * the old JSON stores: saved connections, Snowflake scope credentials, governance sources,
    KPI dashboards and semantic models (looked up in both the old routers/ and new app/modules/ folders)

Safe to re-run: rows are upserted by primary key.

Usage (from backend/):
    python -m scripts.migrate_legacy_data                 # import everything found
    python -m scripts.migrate_legacy_data --dry-run       # only report what would be imported
    python -m scripts.migrate_legacy_data --delete-json   # delete the JSON files after a successful import
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import JSON, Integer, create_engine, inspect, text

from app.core.config import BACKEND_DIR
from app.db.document_store import DocumentStore
from app.db.migrations import upgrade_database
from app.db.models import (
    DbtGeneratedFileModel,
    GovernanceSourceModel,
    KpiDashboardModel,
    MetadataModel,
    MigrationRunModel,
    ProjectModel,
    PromptConfigModel,
    SavedConnectionModel,
    SemanticModelModel,
    SnowflakeScopeCredentialModel,
    UploadedFileModel,
)
from app.db.session import SessionLocal, safe_database_url
from app.db.types import EncryptedJSON

# Parent tables first so foreign keys resolve
SQLITE_TABLES = [
    ProjectModel,
    UploadedFileModel,
    MetadataModel,
    PromptConfigModel,
    MigrationRunModel,
    DbtGeneratedFileModel,
]

MODULE_DIRS = [BACKEND_DIR / "app" / "modules", BACKEND_DIR / "routers"]


def _find(relative: str) -> list:
    return [d / relative for d in MODULE_DIRS if (d / relative).exists()]


def import_sqlite(db_path: Path, dry_run: bool) -> None:
    if not db_path.exists():
        print(f"- SQLite: {db_path} not found, skipping")
        return
    src = create_engine(f"sqlite:///{db_path}")
    existing = set(inspect(src).get_table_names())
    with src.connect() as conn, SessionLocal() as db:
        for model in SQLITE_TABLES:
            table = model.__table__
            if table.name not in existing:
                continue
            rows = conn.execute(text(f'SELECT * FROM "{table.name}"')).mappings().all()
            print(f"- SQLite {table.name}: {len(rows)} row(s)")
            if dry_run:
                continue
            for row in rows:
                values = {}
                for col in table.columns:
                    if col.name not in row:
                        continue
                    value = row[col.name]
                    if isinstance(col.type, (JSON, EncryptedJSON)) and isinstance(value, str):
                        value = json.loads(value)
                    if col.name.endswith("_at") and isinstance(value, str):
                        value = datetime.fromisoformat(value)
                    values[col.name] = value
                db.merge(model(**values))
            db.flush()
        if not dry_run:
            db.commit()
            # Explicit ids were inserted, so move SERIAL sequences past them
            for model in SQLITE_TABLES:
                table = model.__table__
                pk = list(table.primary_key.columns)[0]
                if isinstance(pk.type, Integer):
                    db.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', '{pk.name}'), "
                        f"COALESCE((SELECT MAX({pk.name}) FROM {table.name}), 0) + 1, false)"
                    ))
            db.commit()


def _load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def import_json_stores(dry_run: bool) -> list:
    imported = []

    def dict_store(relative: str, model):
        for path in _find(relative):
            data = _load_json(path)
            if not isinstance(data, dict):
                continue
            print(f"- {path.relative_to(BACKEND_DIR)}: {len(data)} document(s)")
            if not dry_run:
                store = DocumentStore(model)
                for key, value in data.items():
                    store.put(key, value)
            imported.append(path)

    dict_store("ai_governance/gov_source_store.json", GovernanceSourceModel)
    dict_store("cfo_analytics/kpi_dashboard_store.json", KpiDashboardModel)
    dict_store("cfo_analytics/semantic_model_store.json", SemanticModelModel)

    for path in _find("cfo_analytics/saved_connections_store.json"):
        conns = _load_json(path)
        if not isinstance(conns, list):
            continue
        print(f"- {path.relative_to(BACKEND_DIR)}: {len(conns)} connection(s)")
        if not dry_run:
            store = DocumentStore(SavedConnectionModel)
            merged = {c["id"]: c for c in conns if c.get("id")}
            for key, value in store.load_dict().items():
                merged.setdefault(key, value)
            store.save_dict(merged)
        imported.append(path)

    for module_dir in MODULE_DIRS:
        for path in sorted((module_dir / "cfo_analytics").glob("snowflake_scope_*.json")):
            scope = path.stem[len("snowflake_scope_"):]
            print(f"- {path.relative_to(BACKEND_DIR)}: scope '{scope}'")
            if not dry_run:
                DocumentStore(SnowflakeScopeCredentialModel).put(scope, _load_json(path))
            imported.append(path)
    return imported


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sqlite", type=Path, default=BACKEND_DIR / "modernization.db")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--delete-json", action="store_true", help="delete imported JSON files afterwards")
    args = parser.parse_args()

    print(f"Target database: {safe_database_url()}")
    if not args.dry_run:
        upgrade_database()
    import_sqlite(args.sqlite, args.dry_run)
    imported = import_json_stores(args.dry_run)

    if args.delete_json and not args.dry_run:
        for path in imported:
            path.unlink()
            print(f"  deleted {path.relative_to(BACKEND_DIR)}")
    print("Dry run complete." if args.dry_run else "Import complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
