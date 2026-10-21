"""Small, explicit PostgreSQL client used by Component 2 health checks."""
from __future__ import annotations

import os
from typing import Any

import psycopg


def database_url(env: dict[str, str] | None = None) -> str:
    values = os.environ if env is None else env
    value = values.get("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required for database access.")
    if not value.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection URL.")
    return value


def connection_status(env: dict[str, str] | None = None) -> dict[str, Any]:
    """Open a short TLS-capable connection without exposing credentials."""
    try:
        with psycopg.connect(database_url(env), connect_timeout=10) as connection:
            database, user, server_version = connection.execute(
                "select current_database(), current_user, current_setting('server_version')"
            ).fetchone()
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("Unable to connect to the configured PostgreSQL database.") from exc
    return {
        "connected": True,
        "database": database,
        "user": user,
        "server_version": server_version,
    }
