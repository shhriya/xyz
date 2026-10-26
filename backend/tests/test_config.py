import pytest

from app.core.config import Settings
from app.db.session import DatabaseConfigError, _validated_url


def test_postgres_scheme_is_normalized(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@host:5432/db")
    assert Settings().database_url == "postgresql://u:p@host:5432/db"


def test_legacy_aiven_variable_is_accepted(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("AIVEN_DATABASE_URL", "postgresql://u:p@x.aivencloud.com:1/db")
    assert Settings(_env_file=None).database_url == "postgresql://u:p@x.aivencloud.com:1/db"


@pytest.mark.parametrize("url", ["", "sqlite:///modernization.db", "mysql://u:p@h/db"])
def test_non_postgres_urls_are_rejected(url):
    with pytest.raises(DatabaseConfigError):
        _validated_url(url)
