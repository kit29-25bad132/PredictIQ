"""
PostgreSQL migration tests for controlled MANUAL_DEMO sessions (revision 010).

Requirements
------------
Set ``MIGRATION_TEST_DATABASE_URL`` to a DISPOSABLE PostgreSQL database, e.g.::

    MIGRATION_TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/predictiq_migration_test

The module drops and recreates the ``public`` schema, so it refuses known
Supabase hosts outright and non-loopback hosts unless
``MIGRATION_TEST_ALLOW_REMOTE=1`` is set for a disposable CI service. When the
variable is absent the test skips (reported as skipped, never as passed).

Covered
-------
- clean upgrade 009 -> 010, including the regression that preflight must not
  read ``demo_session_id`` before the column exists
- existing rows, names, identifiers and row counts are unchanged
- expected columns, indexes, check constraints, unique keys and foreign keys
- MANUAL_DEMO coherence is rejected in both directions, valid provenance is
  accepted
- a demo session from another organization cannot be referenced
- demo data blocks downgrade (explicit refusal) until purged
- clean downgrade removes every artifact, then re-upgrade works
- a failed preflight leaves the schema at 009 with no partial changes
"""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest
import sqlalchemy as sa

DATABASE_URL = os.environ.get("MIGRATION_TEST_DATABASE_URL", "").strip()
BACKEND_DIR = Path(__file__).resolve().parents[1]

DISPOSABLE_HOSTS = {"localhost", "127.0.0.1", "::1"}
FORBIDDEN_HOST_SUFFIXES = (
    ".supabase.co",
    ".supabase.com",
    ".supabase.net",
    "pooler.supabase.com",
)


def _assert_disposable_database(url: str) -> None:
    """Refuse shared/production hosts before the first DROP SCHEMA."""
    host = (urlsplit(url).hostname or "").lower()
    if any(
        host == suffix.lstrip(".") or host.endswith(suffix)
        for suffix in FORBIDDEN_HOST_SUFFIXES
    ):
        raise RuntimeError(
            "Refusing to run migration tests against Supabase host "
            f"'{host}'. Use a disposable local PostgreSQL database."
        )
    if host not in DISPOSABLE_HOSTS and os.environ.get("MIGRATION_TEST_ALLOW_REMOTE") != "1":
        raise RuntimeError(
            "MIGRATION_TEST_DATABASE_URL points at non-loopback host "
            f"'{host}'. Set MIGRATION_TEST_ALLOW_REMOTE=1 only for a disposable "
            "CI database service."
        )


if DATABASE_URL:
    _assert_disposable_database(DATABASE_URL)
LEGACY = "00000000-0000-4000-8000-000000000001"
OTHER_ORG = "11111111-1111-4111-8111-111111111111"
DEMO_SESSION_ID = "22222222-2222-4222-8222-222222222222"
OTHER_SESSION_ID = "33333333-3333-4333-8333-333333333333"
REV_009 = "009_organizations_and_tenancy"
REV_010 = "010_manual_demo_source"

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

DEMO_TABLES = ("sensor_readings", "alerts", "predictions")


# ============================================================================
# Helpers
# ============================================================================

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


def _downgrade(revision: str) -> None:
    result = _run_alembic(revision, "downgrade")
    assert result.returncode == 0, f"alembic downgrade {revision} failed:\n{result.stdout}\n{result.stderr}"


def _scalar(conn, sql: str, **params):
    return conn.execute(sa.text(sql), params).scalar()


def _counts(conn) -> dict:
    return {
        table: _scalar(conn, f"SELECT count(*) FROM {table}")
        for table in SNAPSHOT_TABLES
    }


def _has_table(conn, name: str) -> bool:
    return sa.inspect(conn).has_table(name)


def _has_column(conn, table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(conn).get_columns(table))


def _column(conn, table: str, name: str) -> dict:
    return next(
        c for c in sa.inspect(conn).get_columns(table) if c["name"] == name
    )


def _index_names(conn, table: str) -> set:
    return {index["name"] for index in sa.inspect(conn).get_indexes(table)}


def _foreign_key(conn, table: str, name: str) -> dict:
    keys = {fk["name"]: fk for fk in sa.inspect(conn).get_foreign_keys(table)}
    assert name in keys, f"{table} foreign keys: {sorted(keys)}"
    return keys[name]


def _foreign_key_on(conn, table: str, columns: list) -> dict:
    for fk in sa.inspect(conn).get_foreign_keys(table):
        if fk["constrained_columns"] == columns:
            return fk
    raise AssertionError(f"{table} has no foreign key on {columns}")


def _check_constraints(conn, table: str) -> dict:
    return {
        check["name"]: (check.get("sqltext") or "")
        for check in sa.inspect(conn).get_check_constraints(table)
    }


def _identifiers(conn) -> dict:
    """Rows and identifiers that must survive the migration unchanged."""
    return {
        "machines": [
            tuple(row)
            for row in conn.execute(
                sa.text("SELECT id, machine_id, name, status FROM machines ORDER BY id")
            )
        ],
        "sensor_readings": [
            tuple(row)
            for row in conn.execute(
                sa.text("SELECT id, machine_id, device_id, source FROM sensor_readings ORDER BY id")
            )
        ],
        "alerts": [
            tuple(row)
            for row in conn.execute(
                sa.text("SELECT id, machine_id, alert_type, status FROM alerts ORDER BY id")
            )
        ],
        "predictions": [
            tuple(row)
            for row in conn.execute(
                sa.text("SELECT id, machine_id, component FROM predictions ORDER BY id")
            )
        ],
        "feedback_records": [
            tuple(row)
            for row in conn.execute(
                sa.text("SELECT id, machine_id, outcome FROM feedback_records ORDER BY id")
            )
        ],
    }


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


def _seed_demo(
    conn,
    *,
    org: str = LEGACY,
    machine_id: str = "DEMO-A",
    session_id: str = DEMO_SESSION_ID,
    with_children: bool = True,
) -> None:
    """Create a demo machine + session (and optionally reading/alert/prediction)."""
    conn.execute(
        sa.text(
            "INSERT INTO machines (organization_id, machine_id, name, type, location, status, is_demo, created_at) "
            "VALUES (:org, :machine, 'Demo', 'Demo', 'Demo Session', 'Healthy', true, now())"
        ),
        {"org": org, "machine": machine_id},
    )
    conn.execute(
        sa.text(
            "INSERT INTO demo_sessions (id, organization_id, machine_id, name, status, created_at) "
            "VALUES (:sid, :org, :machine, 'Demo session', 'ACTIVE', now())"
        ),
        {"sid": session_id, "org": org, "machine": machine_id},
    )
    if not with_children:
        return

    conn.execute(
        sa.text(
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
            "VALUES (:org, :machine, NULL, :sid, now(), 40.0, 1.0, 5.0, 1450.0, 'MANUAL_DEMO', now())"
        ),
        {"org": org, "machine": machine_id, "sid": session_id},
    )
    conn.execute(
        sa.text(
            "INSERT INTO alerts (organization_id, machine_id, demo_session_id, alert_type, severity, message, status, created_at) "
            "VALUES (:org, :machine, :sid, 'demo_alert', 'Info', 'Demo alert', 'ACTIVE', now())"
        ),
        {"org": org, "machine": machine_id, "sid": session_id},
    )
    conn.execute(
        sa.text(
            "INSERT INTO predictions (organization_id, machine_id, demo_session_id, timestamp, failure_probability, component, is_prototype, created_at) "
            "VALUES (:org, :machine, :sid, now(), 0.4, 'Bearing', true, now())"
        ),
        {"org": org, "machine": machine_id, "sid": session_id},
    )


def _purge_demo(conn) -> None:
    conn.execute(
        sa.text(
            "DELETE FROM sensor_readings "
            "WHERE demo_session_id IS NOT NULL OR source = 'MANUAL_DEMO'"
        )
    )
    for table in ("alerts", "predictions"):
        conn.execute(sa.text(f"DELETE FROM {table} WHERE demo_session_id IS NOT NULL"))
    conn.execute(sa.text("DELETE FROM demo_sessions"))
    conn.execute(sa.text("DELETE FROM machines WHERE is_demo = true"))


def _assert_demo_schema_absent(conn) -> None:
    assert not _has_table(conn, "demo_sessions")
    assert not _has_column(conn, "machines", "is_demo")
    for table in DEMO_TABLES:
        assert not _has_column(conn, table, "demo_session_id"), table
    assert "MANUAL_DEMO" not in _check_constraints(conn, "sensor_readings")[
        "ck_sensor_readings_source"
    ]


# ============================================================================
# 1. Regression: clean 009 -> 010 must not read a column it has not added yet
# ============================================================================

def test_upgrade_from_clean_009_does_not_reference_missing_column():
    _reset_schema()
    _upgrade(REV_009)

    with _engine().connect() as conn:
        # This is the exact state in which the original preflight failed: the
        # column does not exist until upgrade() adds it.
        assert not _has_column(conn, "sensor_readings", "demo_session_id")
        assert _scalar(conn, "SELECT version_num FROM alembic_version") == REV_009

    _upgrade(REV_010)

    with _engine().connect() as conn:
        assert _scalar(conn, "SELECT version_num FROM alembic_version") == REV_010
        assert _has_table(conn, "demo_sessions")
        assert _has_column(conn, "sensor_readings", "demo_session_id")


# ============================================================================
# 2. Full lifecycle on real PostgreSQL
# ============================================================================

def test_manual_demo_migration_lifecycle():
    _reset_schema()
    _upgrade(REV_009)

    with _engine().begin() as conn:
        _seed_legacy(conn)
    with _engine().connect() as conn:
        counts_before = _counts(conn)
        identifiers_before = _identifiers(conn)

    _upgrade(REV_010)

    with _engine().connect() as conn:
        # --- columns -----------------------------------------------------
        assert _has_table(conn, "demo_sessions")
        assert _column(conn, "machines", "is_demo")["nullable"] is False
        assert _column(conn, "sensor_readings", "demo_session_id")["nullable"] is True
        for table in ("alerts", "predictions"):
            assert _column(conn, table, "demo_session_id")["nullable"] is True
        # Making device_id nullable is the only relaxation, and it is needed
        # for MANUAL_DEMO rows (enforced by the coherence check below).
        assert _column(conn, "sensor_readings", "device_id")["nullable"] is True

        # --- existing rows unchanged -------------------------------------
        assert _counts(conn) == counts_before
        assert _identifiers(conn) == identifiers_before
        assert _scalar(conn, "SELECT count(*) FROM machines WHERE is_demo") == 0
        for table in DEMO_TABLES:
            assert (
                _scalar(conn, f"SELECT count(*) FROM {table} WHERE demo_session_id IS NOT NULL")
                == 0
            )

        # --- indexes -----------------------------------------------------
        assert "ix_machines_is_demo" in _index_names(conn, "machines")
        assert "ix_sensor_readings_demo_session_id" in _index_names(conn, "sensor_readings")
        assert "ix_alerts_demo_session_id" in _index_names(conn, "alerts")
        assert "ix_predictions_demo_session_id" in _index_names(conn, "predictions")
        assert {
            "ix_demo_sessions_organization_id",
            "ix_demo_sessions_machine_id",
            "ix_demo_sessions_organization_status",
        } <= _index_names(conn, "demo_sessions")

        # --- check constraints -------------------------------------------
        checks = _check_constraints(conn, "sensor_readings")
        assert "MANUAL_DEMO" in checks["ck_sensor_readings_source"]
        assert "ck_sensor_readings_demo_coherence" in checks
        assert "ck_demo_sessions_status" in _check_constraints(conn, "demo_sessions")

        # --- foreign keys -------------------------------------------------
        for table in DEMO_TABLES:
            single = _foreign_key(conn, table, f"fk_{table}_demo_session")
            assert single["referred_table"] == "demo_sessions"
            assert single["constrained_columns"] == ["demo_session_id"]
            assert single["options"].get("ondelete") == "SET NULL"

            composite = _foreign_key(conn, table, f"fk_{table}_demo_session_organization")
            assert composite["referred_table"] == "demo_sessions"
            assert composite["constrained_columns"] == ["organization_id", "demo_session_id"]
            assert composite["referred_columns"] == ["organization_id", "id"]

        assert _foreign_key_on(conn, "demo_sessions", ["organization_id"])[
            "referred_table"
        ] == "organizations"
        assert _foreign_key_on(conn, "demo_sessions", ["machine_id"])[
            "referred_table"
        ] == "machines"

    # Demo machine + session + valid MANUAL_DEMO provenance.
    with _engine().begin() as conn:
        _seed_demo(conn)

    with _engine().connect() as conn:
        # Invalid provenance is rejected in both directions.
        invalid_rows = (
            # MANUAL_DEMO must not carry a device.
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
            "VALUES (:org, 'DEMO-A', 'D-A', :sid, now(), 40.0, 1.0, 5.0, 1450.0, 'MANUAL_DEMO', now())",
            # MANUAL_DEMO must carry a session.
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
            "VALUES (:org, 'DEMO-A', NULL, NULL, now(), 40.0, 1.0, 5.0, 1450.0, 'MANUAL_DEMO', now())",
            # Device provenance must not carry a session.
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
            "VALUES (:org, 'M-A', 'D-A', :sid, now(), 40.0, 1.0, 5.0, 1450.0, 'WOKWI', now())",
        )
        for sql in invalid_rows:
            with pytest.raises(sa.exc.IntegrityError):
                with conn.begin_nested():
                    conn.execute(sa.text(sql), {"org": LEGACY, "sid": DEMO_SESSION_ID})


    # A valid MANUAL_DEMO reading (no device, real session) is accepted.
    with _engine().begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
                "VALUES (:org, 'DEMO-A', NULL, :sid, now(), 40.0, 1.0, 5.0, 1450.0, 'MANUAL_DEMO', now())"
            ),
            {"org": LEGACY, "sid": DEMO_SESSION_ID},
        )

    # --- cross-organization demo session reference ----------------------
    with _engine().begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO organizations (id, name, slug, status, created_at, updated_at) "
                "VALUES (:org, 'Other', 'other', 'active', now(), now())"
            ),
            {"org": OTHER_ORG},
        )
        _seed_demo(
            conn,
            org=OTHER_ORG,
            machine_id="DEMO-OTHER",
            session_id=OTHER_SESSION_ID,
            with_children=False,
        )

    with _engine().connect() as conn:
        transaction = conn.begin()
        # organization_id/machine_id are consistent with the legacy org; only
        # the session belongs to another organization. The composite tenancy
        # FK is deferred, so force constraint checking.
        conn.execute(
            sa.text(
                "INSERT INTO sensor_readings (organization_id, machine_id, device_id, demo_session_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
                "VALUES (:org, 'M-A', NULL, :sid, now(), 40.0, 1.0, 5.0, 1450.0, 'MANUAL_DEMO', now())"
            ),
            {"org": LEGACY, "sid": OTHER_SESSION_ID},
        )
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
        transaction.rollback()

    # --- downgrade refusal ----------------------------------------------
    refused = _run_alembic(REV_009, "downgrade")
    assert refused.returncode != 0
    assert "Refusing to downgrade 010" in (refused.stdout + refused.stderr)

    with _engine().connect() as conn:
        assert _scalar(conn, "SELECT version_num FROM alembic_version") == REV_010
        assert _has_table(conn, "demo_sessions")
        # The refusal must not have dropped anything.
        assert _scalar(conn, "SELECT count(*) FROM demo_sessions") == 2
        assert _scalar(
            conn,
            "SELECT count(*) FROM sensor_readings WHERE source = 'MANUAL_DEMO'",
        ) >= 2

    # --- clean downgrade -------------------------------------------------
    with _engine().begin() as conn:
        _purge_demo(conn)
    with _engine().connect() as conn:
        counts_before_downgrade = _counts(conn)

    _downgrade(REV_009)

    with _engine().connect() as conn:
        _assert_demo_schema_absent(conn)
        assert _scalar(conn, "SELECT version_num FROM alembic_version") == REV_009
        assert _counts(conn) == counts_before_downgrade
        assert _column(conn, "sensor_readings", "device_id")["nullable"] is False
        # Real records and identifiers survive.
        assert _scalar(conn, "SELECT name FROM machines WHERE machine_id = 'M-A'") == "Alpha"
        assert _scalar(conn, "SELECT count(*) FROM sensor_readings WHERE machine_id = 'M-A'") == 2
        assert _scalar(conn, "SELECT count(*) FROM alerts WHERE machine_id = 'M-A'") == 1
        assert _scalar(conn, "SELECT count(*) FROM predictions WHERE machine_id = 'M-A'") == 1
        assert _scalar(conn, "SELECT count(*) FROM feedback_records WHERE machine_id = 'M-A'") == 1

    # --- re-upgrade ------------------------------------------------------
    _upgrade(REV_010)
    with _engine().connect() as conn:
        assert _scalar(conn, "SELECT version_num FROM alembic_version") == REV_010
        assert _has_table(conn, "demo_sessions")
        assert _counts(conn) == counts_before_downgrade
        assert _scalar(conn, "SELECT count(*) FROM machines WHERE is_demo") == 0
        assert _scalar(conn, "SELECT name FROM machines WHERE machine_id = 'M-A'") == "Alpha"


# ============================================================================
# 3. Preflight failure is transactional (no partial schema)
# ============================================================================

def test_preflight_failure_leaves_no_partial_schema():
    _reset_schema()
    _upgrade(REV_009)

    with _engine().begin() as conn:
        _seed_legacy(conn)
        # Reproduce corrupt legacy telemetry: a reading without a device.
        # (009 makes device_id NOT NULL, so relax it first.)
        conn.execute(sa.text("ALTER TABLE sensor_readings ALTER COLUMN device_id DROP NOT NULL"))
        conn.execute(
            sa.text(
                "INSERT INTO sensor_readings (organization_id, machine_id, device_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
                "VALUES (:org, 'M-A', NULL, now(), 40.0, 1.0, 5.0, 1450.0, 'WOKWI', now())"
            ),
            {"org": LEGACY},
        )

    with _engine().connect() as conn:
        counts_before = _counts(conn)

    result = _run_alembic(REV_010)
    assert result.returncode != 0, "preflight must abort the migration"
    combined = (result.stdout or "") + (result.stderr or "")
    assert "NULL device_id" in combined

    with _engine().connect() as conn:
        # Still at 009, and the failed revision applied no DDL.
        assert _scalar(conn, "SELECT version_num FROM alembic_version") == REV_009
        _assert_demo_schema_absent(conn)
        assert _counts(conn) == counts_before
        assert _scalar(conn, "SELECT count(*) FROM machines WHERE machine_id = 'M-A'") == 1
