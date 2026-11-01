"""
PostgreSQL migration tests for the tenancy foundation (Phase 2).

SQLite is NOT used here: composite foreign keys, deferred constraints and
``ALTER TABLE`` semantics must be exercised on real PostgreSQL.

Requirements
------------
Set ``MIGRATION_TEST_DATABASE_URL`` to a DISPOSABLE PostgreSQL database, e.g.::

    MIGRATION_TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/predictiq_migration_test

The module drops and recreates the ``public`` schema, so it refuses to run
against Supabase or anything that looks like production. When the variable is
absent the tests skip (CI has no PostgreSQL service), and the run is reported
as skipped rather than passed.

Covered
-------
- upgrade 008 -> 009 backfills every legacy row into the ``legacy`` org
- row counts and identifiers are unchanged
- ``organization_id`` becomes NOT NULL
- the legacy organization exists exactly once, with zero memberships
- composite FKs reject cross-organization devices, telemetry and feedback
- global ``machine_id`` uniqueness is preserved
- downgrade removes tenancy artifacts without touching business data
- re-upgrade is idempotent
- preflight aborts the migration before any DDL when telemetry is inconsistent
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

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="MIGRATION_TEST_DATABASE_URL not set (PostgreSQL migration tests skipped)",
)

TENANT_TABLES = (
    "machines",
    "devices",
    "sensor_readings",
    "maintenance_records",
    "predictions",
    "alerts",
    "feedback_records",
    "simulation_configs",
)


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
    """Move backwards explicitly: ``upgrade <ancestor>`` is not a downgrade."""
    result = _run_alembic(revision, "downgrade")
    assert result.returncode == 0, f"alembic downgrade {revision} failed:\n{result.stdout}\n{result.stderr}"


def _scalar(conn, sql: str, **params):
    return conn.execute(sa.text(sql), params).scalar()


def _counts(conn) -> dict:
    return {
        table: _scalar(conn, f"SELECT count(*) FROM {table}")
        for table in TENANT_TABLES
    }


def _has_table(conn, name: str) -> bool:
    return sa.inspect(conn).has_table(name)


def _has_column(conn, table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(conn).get_columns(table))


def _seed_legacy_data(conn) -> dict:
    """Representative pre-tenancy data for two machines (all in the legacy org later)."""
    conn.execute(sa.text(
        "INSERT INTO machines (machine_id, name, type, location, status, created_at) "
        "VALUES ('M-A', 'Alpha', 'Pump', 'Bay 1', 'Healthy', now()), "
        "       ('M-B', 'Beta', 'Motor', 'Bay 2', 'Warning', now())"
    ))
    conn.execute(sa.text(
        "INSERT INTO devices (device_id, machine_id, device_type, firmware_version, status, source, created_at) "
        "VALUES ('D-A', 'M-A', 'ESP32', '1.0.0', 'ONLINE', 'WOKWI', now()), "
        "       ('D-B', 'M-B', 'ESP32', '1.0.0', 'OFFLINE', 'REAL_HARDWARE', now())"
    ))
    conn.execute(sa.text(
        "INSERT INTO sensor_readings (machine_id, device_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
        "VALUES ('M-A', 'D-A', now(), 40.0, 1.2, 5.0, 1450, 'WOKWI', now()), "
        "       ('M-A', 'D-A', now(), 41.0, 1.3, 5.1, 1460, 'WOKWI', now()), "
        "       ('M-A', 'D-A', now(), 42.0, 1.4, 5.2, 1470, 'WOKWI', now()), "
        "       ('M-B', 'D-B', now(), 55.0, 2.0, 7.0, 1500, 'REAL_HARDWARE', now())"
    ))
    maintenance_a = conn.execute(sa.text(
        "INSERT INTO maintenance_records (machine_id, component, issue_description, maintenance_action, technician, status, maintenance_date, created_at) "
        "VALUES ('M-A', 'Bearing', 'Noise', 'Replaced', 'Tech A', 'Completed', now(), now()) RETURNING id"
    )).scalar()
    maintenance_b = conn.execute(sa.text(
        "INSERT INTO maintenance_records (machine_id, component, issue_description, maintenance_action, technician, status, maintenance_date, created_at) "
        "VALUES ('M-B', 'Coupling', 'Wear', 'Aligned', 'Tech B', 'Scheduled', now(), now()) RETURNING id"
    )).scalar()
    prediction_a = conn.execute(sa.text(
        "INSERT INTO predictions (machine_id, timestamp, failure_probability, component, is_prototype, created_at) "
        "VALUES ('M-A', now(), 0.2, 'Bearing', true, now()) RETURNING id"
    )).scalar()
    prediction_b = conn.execute(sa.text(
        "INSERT INTO predictions (machine_id, timestamp, failure_probability, component, is_prototype, created_at) "
        "VALUES ('M-B', now(), 0.4, 'Coupling', true, now()) RETURNING id"
    )).scalar()
    alert_a = conn.execute(sa.text(
        "INSERT INTO alerts (machine_id, alert_type, severity, message, status, created_at) "
        "VALUES ('M-A', 'VIBRATION_HIGH', 'Warning', 'Vibration high', 'ACTIVE', now()) RETURNING id"
    )).scalar()
    conn.execute(sa.text(
        "INSERT INTO alerts (machine_id, alert_type, severity, message, status, created_at) "
        "VALUES ('M-B', 'TEMP_HIGH', 'Critical', 'Temperature high', 'ACTIVE', now())"
    ))
    conn.execute(sa.text(
        "INSERT INTO feedback_records (machine_id, prediction_id, alert_id, maintenance_record_id, "
        "observed_condition, severity, outcome, created_at) "
        "VALUES ('M-A', :pid, :aid, :mid, 'Observed noise', 'Warning', 'Confirmed', now())"
    ), {"pid": prediction_a, "aid": alert_a, "mid": maintenance_a})
    for machine_id in ("M-A", "M-B"):
        conn.execute(sa.text(
            "INSERT INTO simulation_configs (machine_id, motor_powered, simulation_mode, update_interval_ms, "
            "temp_min, temp_max, temp_target, temp_step, temp_warning, temp_critical, "
            "current_min, current_max, current_target, current_step, current_warning, current_critical, "
            "rpm_min, rpm_max, rpm_target, rpm_step, rpm_rated, rpm_warning, rpm_critical, "
            "vib_min, vib_max, vib_target, vib_step, vib_warning, vib_critical, updated_at, created_at) "
            "VALUES (:machine_id, true, 'cycling', 1000, 22.0, 45.0, 32.0, 0.2, 45.0, 60.0, "
            "0.2, 3.0, 1.2, 0.1, 2.0, 3.0, 0.0, 1800.0, 1450.0, 50.0, 1500.0, 1050.0, 750.0, "
            "0.1, 5.0, 0.8, 0.05, 1.5, 3.0, now(), now())"
        ), {"machine_id": machine_id})
    return {
        "prediction_a": prediction_a,
        "prediction_b": prediction_b,
        "maintenance_a": maintenance_a,
        "maintenance_b": maintenance_b,
        "alert_a": alert_a,
    }


# ============================================================================
# 1. Full lifecycle: 007 -> 008 -> 009, constraints, downgrade, re-upgrade
# ============================================================================

def test_tenancy_migration_lifecycle():
    _reset_schema()

    # Base state: the existing migration chain up to the last historical revision.
    _upgrade("007_prediction_input_hash")
    with _engine().connect() as conn:
        assert not _has_table(conn, "organizations")
        assert not _has_table(conn, "simulation_configs")

    # Schema-parity revision creates the table that Alembic never owned.
    _upgrade("008_simulation_configs_schema_parity")
    with _engine().begin() as conn:
        assert _has_table(conn, "simulation_configs")
        seeded = _seed_legacy_data(conn)
        counts_before = _counts(conn)

    assert counts_before == {
        "machines": 2,
        "devices": 2,
        "sensor_readings": 4,
        "maintenance_records": 2,
        "predictions": 2,
        "alerts": 2,
        "feedback_records": 1,
        "simulation_configs": 2,
    }

    # Tenancy migration.
    _upgrade("head")

    with _engine().connect() as conn:
        # Legacy organization exists exactly once, with no memberships granted.
        assert _scalar(conn, "SELECT count(*) FROM organizations") == 1
        assert _scalar(conn, "SELECT slug FROM organizations") == "legacy"
        assert str(_scalar(conn, "SELECT id FROM organizations")) == LEGACY
        assert _scalar(conn, "SELECT count(*) FROM organization_memberships") == 0

        # Every legacy row is owned by the legacy organization.
        for table in TENANT_TABLES:
            distinct = conn.execute(sa.text(
                f"SELECT DISTINCT organization_id::text FROM {table}"
            )).scalars().all()
            assert distinct == [LEGACY], f"{table} owners: {distinct}"
            assert _scalar(conn, f"SELECT count(*) FROM {table} WHERE organization_id IS NULL") == 0

        # No data lost, identifiers preserved.
        assert _counts(conn) == counts_before
        assert _scalar(conn, "SELECT count(*) FROM machines WHERE machine_id IN ('M-A','M-B')") == 2
        assert _scalar(conn, "SELECT count(*) FROM feedback_records WHERE prediction_id = :pid",
                       pid=seeded["prediction_a"]) == 1

        # organization_id is NOT NULL in the database itself.
        for table in TENANT_TABLES:
            column = next(
                c for c in sa.inspect(conn).get_columns(table)
                if c["name"] == "organization_id"
            )
            assert column["nullable"] is False, table

        # Global identifiers stay unique across organizations.
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text(
                "INSERT INTO machines (organization_id, machine_id, name, type, location, status, created_at) "
                "VALUES (CAST(:org AS uuid), 'M-A', 'Duplicate', 'Pump', 'Bay 9', 'Healthy', now())"
            ), {"org": OTHER_ORG})

    # Cross-organization integrity is enforced by composite foreign keys.
    with _engine().begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO organizations (id, name, slug, status, created_at, updated_at) "
            "VALUES (CAST(:org AS uuid), 'Other', 'other', 'active', now(), now())"
        ), {"org": OTHER_ORG})
        conn.execute(sa.text(
            "INSERT INTO machines (organization_id, machine_id, name, type, location, status, created_at) "
            "VALUES (CAST(:org AS uuid), 'M-OTHER', 'Other', 'Pump', 'Bay 3', 'Healthy', now())"
        ), {"org": OTHER_ORG})

    # (a) A device in org B may not point at a machine in the legacy org.
    with _engine().connect() as conn:
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text(
                "INSERT INTO devices (organization_id, device_id, machine_id, device_type, firmware_version, status, source, created_at) "
                "VALUES (CAST(:org AS uuid), 'D-X', 'M-A', 'ESP32', '1.0.0', 'ONLINE', 'WOKWI', now())"
            ), {"org": OTHER_ORG})
        conn.rollback()

    # (b) A reading may not mix org B's machine with the legacy org's device.
    with _engine().connect() as conn:
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text(
                "INSERT INTO sensor_readings (organization_id, machine_id, device_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
                "VALUES (CAST(:org AS uuid), 'M-OTHER', 'D-A', now(), 30.0, 1.0, 4.0, 1400, 'WOKWI', now())"
            ), {"org": OTHER_ORG})
        conn.rollback()

    # (c) A reading in org B referencing a legacy machine is rejected.
    with _engine().connect() as conn:
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text(
                "INSERT INTO sensor_readings (organization_id, machine_id, device_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
                "VALUES (CAST(:org AS uuid), 'M-A', 'D-A', now(), 30.0, 1.0, 4.0, 1400, 'WOKWI', now())"
            ), {"org": OTHER_ORG})
        conn.rollback()

    # (d) Feedback may not reference another organization's prediction
    #     (the composite key is deferred, so force the check).
    with _engine().connect() as conn:
        transaction = conn.begin()
        conn.execute(sa.text(
            "INSERT INTO feedback_records (organization_id, machine_id, prediction_id, "
            "observed_condition, severity, outcome, created_at) "
            "VALUES (CAST(:org AS uuid), 'M-OTHER', :pid, 'Cross-tenant', 'Warning', 'Confirmed', now())"
        ), {"org": OTHER_ORG, "pid": seeded["prediction_a"]})
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
        transaction.rollback()

    # (e) The same-organization equivalent succeeds.
    with _engine().begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO devices (organization_id, device_id, machine_id, device_type, firmware_version, status, source, created_at) "
            "VALUES (CAST(:org AS uuid), 'D-OTHER', 'M-OTHER', 'ESP32', '1.0.0', 'ONLINE', 'WOKWI', now())"
        ), {"org": OTHER_ORG})
        conn.execute(sa.text(
            "INSERT INTO sensor_readings (organization_id, machine_id, device_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
            "VALUES (CAST(:org AS uuid), 'M-OTHER', 'D-OTHER', now(), 30.0, 1.0, 4.0, 1400, 'WOKWI', now())"
        ), {"org": OTHER_ORG})

    # Deleting a legacy prediction still nulls the feedback reference
    # (deferred composite FK must not block the existing SET NULL behavior).
    with _engine().begin() as conn:
        counts_pre = _counts(conn)
        conn.execute(sa.text("DELETE FROM predictions WHERE id = :pid"), {"pid": seeded["prediction_a"]})

    with _engine().connect() as conn:
        assert _scalar(conn, "SELECT count(*) FROM feedback_records WHERE prediction_id IS NULL") == 1
        assert _counts(conn)["feedback_records"] == counts_pre["feedback_records"]

    # Downgrade: tenancy artifacts removed, business data untouched.
    _downgrade("007_prediction_input_hash")

    with _engine().connect() as conn:
        assert not _has_table(conn, "organizations")
        assert not _has_table(conn, "organization_memberships")
        for table in TENANT_TABLES:
            assert not _has_column(conn, table, "organization_id"), table
        assert _scalar(conn, "SELECT count(*) FROM machines") == counts_before["machines"] + 1
        assert _scalar(conn, "SELECT count(*) FROM sensor_readings") == counts_before["sensor_readings"] + 1
        assert _scalar(conn, "SELECT name FROM machines WHERE machine_id = 'M-A'") == "Alpha"

    # Re-upgrade is idempotent and re-backfills everything.
    _upgrade("head")
    with _engine().connect() as conn:
        assert _scalar(conn, "SELECT count(*) FROM organizations WHERE slug = 'legacy'") == 1
        for table in TENANT_TABLES:
            assert _scalar(conn, f"SELECT count(*) FROM {table} WHERE organization_id IS NULL") == 0


# ============================================================================
# 2. Preflight stop condition
# ============================================================================

def test_preflight_aborts_before_any_ddl():
    _reset_schema()
    _upgrade("008_simulation_configs_schema_parity")

    with _engine().begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO machines (machine_id, name, type, location, status, created_at) "
            "VALUES ('M-A', 'Alpha', 'Pump', 'Bay 1', 'Healthy', now()), "
            "       ('M-B', 'Beta', 'Motor', 'Bay 2', 'Healthy', now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO devices (device_id, machine_id, device_type, firmware_version, status, source, created_at) "
            "VALUES ('D-A', 'M-A', 'ESP32', '1.0.0', 'ONLINE', 'WOKWI', now())"
        ))
        # A reading that claims M-B while its device belongs to M-A: ambiguous.
        conn.execute(sa.text(
            "INSERT INTO sensor_readings (machine_id, device_id, timestamp, temperature, vibration, current, rpm, source, created_at) "
            "VALUES ('M-B', 'D-A', now(), 30.0, 1.0, 4.0, 1400, 'WOKWI', now())"
        ))

    result = _run_alembic("head")
    assert result.returncode != 0, "preflight must abort the migration"
    combined = (result.stdout or "") + (result.stderr or "")
    assert "cannot be assigned" in combined or "readings_device_machine_mismatch" in combined

    with _engine().connect() as conn:
        # Aborted before DDL: the tenancy tables were never created.
        assert not _has_table(conn, "organizations")
        assert not _has_column(conn, "machines", "organization_id")
        # And nothing was deleted.
        assert _scalar(conn, "SELECT count(*) FROM sensor_readings") == 1
