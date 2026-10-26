"""Copy all application data from another PostgreSQL database into the one in DATABASE_URL.

Use it to move to the team's shared database. Rows are copied as stored, so encrypted credentials
remain readable only with the same APP_ENCRYPTION_KEY that wrote them.

Usage (from backend/, with DATABASE_URL pointing at the destination):
    python -m scripts.copy_database --source-url postgresql://rdata:rdata@127.0.0.1:5433/rdata
    python -m scripts.copy_database --source-url ... --replace   # wipe destination tables first
"""
import argparse
import sys

from sqlalchemy import MetaData, create_engine, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import make_url

from app.db import models  # noqa: F401  (registers tables)
from app.db.migrations import upgrade_database
from app.db.session import Base, engine, safe_database_url


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--replace", action="store_true", help="delete existing destination rows first")
    args = parser.parse_args()

    source = create_engine(args.source_url)
    print(f"Source:      {make_url(args.source_url).render_as_string(hide_password=True)}")
    print(f"Destination: {safe_database_url()}")
    if make_url(args.source_url) == engine.url:
        print("Source and destination are the same database.")
        return 1

    upgrade_database()
    # Reflect raw column types so values (including encrypted text) are copied byte-for-byte
    names = [t.name for t in Base.metadata.sorted_tables]
    src_meta, dst_meta = MetaData(), MetaData()
    src_meta.reflect(source, only=names)
    dst_meta.reflect(engine, only=names)

    with source.connect() as src, engine.begin() as dst:
        if args.replace:
            for name in reversed(names):
                dst.execute(dst_meta.tables[name].delete())
        for name in names:
            rows = [dict(r) for r in src.execute(select(src_meta.tables[name])).mappings()]
            table = dst_meta.tables[name]
            if rows:
                # Skip rows that clash with existing ones (primary key or unique constraints)
                dst.execute(insert(table).values(rows).on_conflict_do_nothing())
            print(f"- {name}: {len(rows)} row(s)")
        # Keep SERIAL sequences ahead of the copied ids
        for name in names:
            table = dst_meta.tables[name]
            pk = list(table.primary_key.columns)[0]
            if pk.autoincrement and pk.type.python_type is int:
                max_id = dst.execute(select(func.max(pk))).scalar() or 0
                dst.execute(text(f"SELECT setval(pg_get_serial_sequence('{name}', '{pk.name}'), :v, false)"), {"v": max_id + 1})
    print("Copy complete. Existing destination rows with the same keys were left unchanged."
          if not args.replace else "Copy complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
