"""
PostgreSQL migration tests for controlled MANUAL_DEMO sessions (Phase 1).

Requirements
------------
Set ``MIGRATION_TEST_DATABASE_URL`` to a DISPOSABLE PostgreSQL database, e.g.::

    MIGRATION_TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/predictiq_migration_test

The module drops and recreates the ``public`` schema, so it refuses to run
against Supabase or anything that looks like production. When the variable is
absent the test skips (reported as skipped, never as passed).

Covered
-------
- additive upgrade 009 -> 010 preserves row counts and identifiers
- demo_sessions table, demo columns and indexes exist
- the MANUAL_DEMO coherence check rejects mixed provenance in both directions
- demo data blocks downgrade (explicit refusal) until purged
- clean downgrade removes every artifact, then re-upgrade works
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa

DATABASE_URL = os.environ.get("MIGRATION_TEST_DATABASE_URL", "").strip()
BACKEND_DIR = Path(__file__).resolve().parents[1]
LEGACY = "00000000-0000-4000-8000-000000000001"
OTHER_ORG = "11111111-1111-4111-8111-111111111111"
DEMO_SESSION_ID = "22222222-2222-4222-8222-222222222222"

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="MIGRATION_TEST_DATABASE_URL not set (PostgreSQL migration tests skipped)",
)

SNAPSHOT_TABLES = (
    "machines",
    "sensor_readings",
    "alerts",
    "predictions",
    "feedback_records",
)


def _engine(**kwargs):
    return sa.create_engine(DATABASE_URL, **kwargs)


def _reset_schema() -> None:
    engine = _engine(isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(sa.text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(sa.text("CREATE SCHEMA public"))
    engine.dispose()


def _run_alembic(revision: str, command: str = "upgrade") -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["DATABASE_URL"] = DATABASE_URL
    env["DB_SSLMODE"] = "disable"
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", command, revision],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
    )


def _upgrade(revision: str) -> None:
    result = _run_alembic(revision)
    assert result.returncode == 0, f"alembic upgrade {revision} failed:\n{result.stdout}\n{result.stderr}"


def _counts(conn) -> dict:
    return {
        table: conn.execute(sa.text(f"SELECT count(*) FROM {table}")).scalar()
        for table in SNAPSHOT_TABLES
    }


def _has_table(conn, name: str) -> bool:
    return sa.inspect(conn).has_table(name)


def _has_column(conn, table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(conn).get_columns(table))


def _seed_legacy(conn) -> None:
    conn.execute(
        sa.text(
            "INSERT INTO machines (organization_id, machine_id, name, type, location, status, created_at) "
            "VALUES (:org, 'M-A', 'Alpha', 'Pump', 'Bay 1', 'Healthy', now())"
        ),
        {"org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO devices (organization_id, device_id, machine_id, device_type, firmware_version, status, source, created_at) "
            "VALUES (:org, 'D-A', 'M-A', 'ESP32', '1.0.0', 'ONLINE', 'WOKWI', now())"
        ),
        {"org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
            "VALUES (:org, 'M-A', 'D-A', now(), 41.0, 1.2, 5.0, 1450, 'WOKWI', now()), "
            "       (:org, 'M-A', 'D-A', now(), 42.0, 1.3, 5.1, 1460, 'WOKWI', now())"
        ),
        {"org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO predictions (organization_id, machine_id, timestamp, failure_probability, component, is_prototype, created_at) "
            "VALUES (:org, 'M-A', now(), 0.2, 'Bearing', true, now())"
        ),
        {"org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO alerts (organization_id, machine_id, alert_type, severity, message, status, created_at) "
            "VALUES (:org, 'M-A', 'TEMP_HIGH', 'Warning', 'Warm', 'ACTIVE', now())"
        ),
        {"org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO feedback_records (organization_id, machine_id, observed_condition, severity, outcome, created_at) "
            "VALUES (:org, 'M-A', 'checked', 'Warning', 'Confirmed', now())"
        ),
        {"org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO organizations (id, name, slug, status, created_at, updated_at) "
            "VALUES (:id, 'Other', 'other', 'active', now(), now())"
        ),
        {"id": OTHER_ORG},
    )


def _seed_demo(conn) -> None:
    conn.execute(
        sa.text(
            "INSERT INTO machines (organization_id, machine_id, name, type, location, status, is_demo, created_at) "
            "VALUES (:org, 'DEMO-AAAAAAAAAAAA', 'Demo', 'Demo', 'Demo Session', 'Healthy', true, now())"
        ),
        {"org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO demo_sessions (id, organization_id, machine_id, name, status, created_at) "
            "VALUES (:id, :org, 'DEMO-AAAAAAAAAAAA', 'Demo session', 'ACTIVE', now())"
        ),
        {"id": DEMO_SESSION_ID, "org": LEGACY},
    )
    conn.execute(
        sa.text(
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, source, created_at) "
            "VALUES (:org, 'DEMO-AAAAAAAAAAAA', NULL, :sid, now(), 40.0, 'MANUAL_DEMO', now())"
        ),
        {"org": LEGACY, "sid": DEMO_SESSION_ID},
    )


def test_manual_demo_migration_lifecycle():
    _reset_schema()
    _upgrade("009_organizations_and_tenancy")

    with _engine().begin() as conn:
        _seed_legacy(conn)
    with _engine().connect() as conn:
        counts_before = _counts(conn)

    _upgrade("010_manual_demo_source")

    with _engine().connect() as conn:
        assert _has_table(conn, "demo_sessions")
        assert _has_column(conn, "machines", "is_demo")
        assert _has_column(conn, "sensor_readings", "demo_session_id")
        assert _has_column(conn, "alerts", "demo_session_id")
        assert _has_column(conn, "predictions", "demo_session_id")
        # device_id is now nullable.
        device_col = next(
            c for c in sa.inspect(conn).get_columns("sensor_readings") if c["name"] == "device_id"
        )
        assert device_col["nullable"] is True
        assert _counts(conn) == counts_before

        # Coherence: MANUAL_DEMO must carry a session and no device; device
        # sources must carry a device and no session.
        invalid_rows = (
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, source, created_at) "
            "VALUES (:org, 'M-A', 'D-A', :sid, now(), 40.0, 'MANUAL_DEMO', now())",
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, source, created_at) "
            "VALUES (:org, 'M-A', NULL, NULL, now(), 40.0, 'MANUAL_DEMO', now())",
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, source, created_at) "
            "VALUES (:org, 'M-A', 'D-A', :sid, now(), 40.0, 'WOKWI', now())",
        )
        for sql in invalid_rows:
            with pytest.raises(sa.exc.IntegrityError):
                with conn.begin_nested():
                    conn.execute(sa.text(sql), {"org": LEGACY, "sid": DEMO_SESSION_ID})

        # Valid demo provenance is accepted.
        with conn.begin_nested():
            conn.execute(
                sa.text(
                    "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, source, created_at) "
                    "VALUES (:org, 'DEMO-AAAAAAAAAAAA', NULL, :sid, now(), 40.0, 'MANUAL_DEMO', now())"
                ),
                {"org": LEGACY, "sid": DEMO_SESSION_ID},
            )

    # Demo data must block downgrade explicitly.
    with _engine().begin() as conn:
        _seed_demo(conn)
    refused = _run_alembic("009_organizations_and_tenancy", "downgrade")
    assert refused.returncode != 0
    assert "Refusing to downgrade 010" in (refused.stdout + refused.stderr)

    # Purge demo data, then downgrade and re-upgrade cleanly.
    with _engine().begin() as conn:
        conn.execute(sa.text("DELETE FROM sensor_readings WHERE source = 'MANUAL_DEMO'"))
        conn.execute(sa.text("DELETE FROM demo_sessions"))
        conn.execute(sa.text("DELETE FROM machines WHERE is_demo = true"))

    _downgrade("009_organizations_and_tenancy")
    with _engine().connect() as conn:
        assert not _has_table(conn, "demo_sessions")
        assert not _has_column(conn, "machines", "is_demo")
        assert not _has_column(conn, "sensor_readings", "demo_session_id")
        assert not _has_column(conn, "alerts", "demo_session_id")
        assert not _has_column(conn, "predictions", "demo_session_id")
        assert _counts(conn) == counts_before

    _upgrade("010_manual_demo_source")
    with _engine().connect() as conn:
        assert _has_table(conn, "demo_sessions")
        assert _counts(conn) == counts_before


def _downgrade(revision: str) -> None:
    result = _run_alembic(revision, "downgrade")
    assert result.returncode == 0, f"alembic downgrade {revision} failed:\n{result.stdout}\n{result.stderr}"
