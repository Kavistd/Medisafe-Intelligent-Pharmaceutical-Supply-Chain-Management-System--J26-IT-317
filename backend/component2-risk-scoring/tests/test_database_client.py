"""Database configuration and health tests without external connections."""
from __future__ import annotations

import pytest

from database.client import database_url


def test_database_url_accepts_postgresql_urls() -> None:
    url = "postgresql://user:password@localhost:5432/medisafe"
    assert database_url({"DATABASE_URL": url}) == url


@pytest.mark.parametrize("env", [{}, {"DATABASE_URL": ""}])
def test_database_url_requires_configuration(env: dict[str, str]) -> None:
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        database_url(env)


def test_database_url_rejects_non_postgresql_protocols() -> None:
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        database_url({"DATABASE_URL": "https://example.invalid"})
