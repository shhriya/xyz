"""SQLAlchemy engine and session for the application database (PostgreSQL only)."""
import functools
import logging
import time

from sqlalchemy import create_engine
from sqlalchemy.exc import DBAPIError
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")


class DatabaseConfigError(RuntimeError):
    """Raised when DATABASE_URL is missing or does not point at PostgreSQL."""


def _validated_url(raw: str) -> str:
    if not raw:
        raise DatabaseConfigError(
            "DATABASE_URL is not set. Run `neon link --project-id calm-rain-17606721 --branch production -y` "
            "in the repo root, or put the team's Neon URLs in backend/.env (see 'Team database (Neon)' in the README)."
        )
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        raise DatabaseConfigError(
            f"DATABASE_URL must be a PostgreSQL URL (postgresql://...), got '{url.get_backend_name()}://'."
        )
    return raw


DATABASE_URL = _validated_url(settings.database_url)

# libpq options: fail fast when the server is unreachable, and send TCP keepalives so idle
# connections are not silently dropped by NAT/VPN/proxies while long jobs (e.g. a governance sync) run.
_CONNECT_ARGS = {
    "connect_timeout": 15,
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 3,
}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # hosted databases close idle connections; test before use
    pool_recycle=240,  # replace connections before Neon's ~5 minute idle suspend
    # Free cloud tiers allow few connections and are shared by the whole team
    pool_size=3,
    max_overflow=5,
    connect_args=_CONNECT_ARGS,
)


def _same_database(pooled: str, direct: str) -> bool:
    a, b = make_url(pooled), make_url(direct)
    return (a.host or "").replace("-pooler.", ".") == (b.host or "") and a.database == b.database


def _create_migration_engine():
    """Migrations need a real session (advisory locks, DDL), which poolers like Neon's PgBouncer don't guarantee."""
    direct = settings.database_url_unpooled
    if not direct:
        return engine
    if not _same_database(DATABASE_URL, direct):
        logger.warning("DATABASE_URL_UNPOOLED points at a different database than DATABASE_URL; ignoring it.")
        return engine
    return create_engine(_validated_url(direct), pool_pre_ping=True, poolclass=NullPool, connect_args=_CONNECT_ARGS)


migration_engine = _create_migration_engine()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def safe_database_url() -> str:
    """DATABASE_URL with the password hidden, for logs and status endpoints."""
    return make_url(DATABASE_URL).render_as_string(hide_password=True)


def is_connection_dropped(exc: BaseException) -> bool:
    return isinstance(exc, DBAPIError) and exc.connection_invalidated


def retry_on_disconnect(fn):
    """Run a short database operation again if the connection was dropped mid-query.

    pool_pre_ping catches connections that died while idle in the pool, but a hosted database
    can still close a connection between the ping and the query (e.g. compute suspend/restart).
    SQLAlchemy invalidates such connections, so a single retry gets a fresh one.
    """

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except DBAPIError as e:
            if not is_connection_dropped(e):
                raise
            logger.warning(f"Database connection dropped during {fn.__qualname__}; retrying once.")
            time.sleep(1)
            return fn(*args, **kwargs)

    return wrapper
