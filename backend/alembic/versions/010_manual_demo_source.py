"""Controlled MANUAL_DEMO source + organization-scoped demo sessions.

Revision ID: 010_manual_demo_source
Revises: 009_organizations_and_tenancy
Create Date: 2026-11-11

Safety model
------------
Upgrade is additive only: new ``demo_sessions`` table, ``machines.is_demo``,
nullable ``demo_session_id`` columns and relaxed/extended check constraints.
Existing rows are never rewritten, and the migration verifies that:

* every existing reading already has a ``device_id`` (so making it nullable
  cannot hide corrupt legacy data);
* no reading uses an unknown ``source``;
* no ``demo_session_id`` is already populated;
* row counts of machines/sensor_readings/alerts/predictions/feedback_records
  are identical before and after.

Downgrade REFUSES when any demo data exists (any ``demo_sessions`` row or any
``MANUAL_DEMO`` reading) instead of silently destroying it. The operator must
explicitly reset/purge demo sessions first. Recovery options are documented in
``docs/DEMO-SESSIONS.md`` (``pg_dump``/PITR, or reset-before-downgrade).
"""

from __future__ import annotations

from typing import Any, Dict

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "010_manual_demo_source"
down_revision = "009_organizations_and_tenancy"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)

SNAPSHOT_TABLES = (
    "machines",
    "sensor_readings",
    "alerts",
    "predictions",
    "feedback_records",
)

VALID_SOURCES = ("WOKWI", "REAL_HARDWARE")

DEMO_FK_TABLES = ("sensor_readings", "alerts", "predictions")


def _rows(bind, sql: str, **params) -> int:
    return int(bind.execute(sa.text(sql), params).scalar() or 0)


def _snapshot_counts(bind) -> Dict[str, int]:
    return {table: _rows(bind, f"SELECT count(*) FROM {table}") for table in SNAPSHOT_TABLES}


def _preflight(bind) -> Dict[str, int]:
    unknown = bind.execute(
        sa.text(
            "SELECT DISTINCT source FROM sensor_readings "
            "WHERE source IS NULL OR source NOT IN ('WOKWI', 'REAL_HARDWARE')"
        )
    ).scalars().all()
    if unknown:
        raise RuntimeError(
            "Refusing migration 010: unknown sensor_readings.source values "
            f"{sorted(str(value) for value in unknown)}."
        )

    null_devices = _rows(bind, "SELECT count(*) FROM sensor_readings WHERE device_id IS NULL")
    if null_devices:
        raise RuntimeError(
            "Refusing migration 010: "
            f"{null_devices} sensor_readings row(s) already have a NULL device_id."
        )

    existing_session_ids = _rows(
        bind, "SELECT count(*) FROM sensor_readings WHERE demo_session_id IS NOT NULL"
    )
    if existing_session_ids:
        raise RuntimeError(
            "Refusing migration 010: demo_session_id already populated on "
            f"{existing_session_ids} sensor_readings row(s)."
        )

    return _snapshot_counts(bind)


def upgrade() -> None:
    bind = op.get_bind()
    counts_before = _preflight(bind)

    # 1. Demo sessions (one dedicated machine per session).
    op.create_table(
        "demo_sessions",
        sa.Column("id", UUID, primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            UUID,
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            sa.String(50),
            sa.ForeignKey("machines.machine_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
        # Supabase auth.users.id. Intentionally no FK to the provider schema.
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "organization_id", "id", name="uq_demo_sessions_organization_id"
        ),
        sa.UniqueConstraint("machine_id", name="uq_demo_sessions_machine_id"),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'CLOSED')", name="ck_demo_sessions_status"
        ),
    )
    op.create_index(
        "ix_demo_sessions_organization_id", "demo_sessions", ["organization_id"]
    )
    op.create_index(
        "ix_demo_sessions_machine_id", "demo_sessions", ["machine_id"]
    )
    op.create_index(
        "ix_demo_sessions_organization_status",
        "demo_sessions",
        ["organization_id", "status"],
    )

    # 2. Demo machine flag (existing machines default to false).
    op.add_column(
        "machines",
        sa.Column(
            "is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.create_index("ix_machines_is_demo", "machines", ["is_demo"])

    # 3. Reading provenance: demo rows have no device and always a session.
    op.alter_column(
        "sensor_readings",
        "device_id",
        existing_type=sa.String(100),
        nullable=True,
    )
    op.add_column("sensor_readings", sa.Column("demo_session_id", UUID, nullable=True))
    op.create_index(
        "ix_sensor_readings_demo_session_id", "sensor_readings", ["demo_session_id"]
    )
    op.drop_constraint("ck_sensor_readings_source", "sensor_readings", type_="check")
    op.create_check_constraint(
        "ck_sensor_readings_source",
        "sensor_readings",
        "source IN ('WOKWI', 'REAL_HARDWARE', 'MANUAL_DEMO')",
    )
    op.create_check_constraint(
        "ck_sensor_readings_demo_coherence",
        "sensor_readings",
        "(source = 'MANUAL_DEMO' AND demo_session_id IS NOT NULL AND device_id IS NULL) "
        "OR (source IN ('WOKWI', 'REAL_HARDWARE') AND demo_session_id IS NULL AND device_id IS NOT NULL)",
    )

    # 4. Alerts / predictions can be stamped with their demo session.
    for table in ("alerts", "predictions"):
        op.add_column(table, sa.Column("demo_session_id", UUID, nullable=True))
        op.create_index(f"ix_{table}_demo_session_id", table, ["demo_session_id"])

    # 5. Single-column FKs (SET NULL) + composite tenancy FKs (deferrable).
    for table in DEMO_FK_TABLES:
        op.create_foreign_key(
            f"fk_{table}_demo_session",
            table,
            "demo_sessions",
            ["demo_session_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            f"fk_{table}_demo_session_organization",
            table,
            "demo_sessions",
            ["organization_id", "demo_session_id"],
            ["organization_id", "id"],
            deferrable=True,
            initially="DEFERRED",
        )

    # 6. Post-check: nothing lost, nothing silently backfilled.
    counts_after = _snapshot_counts(bind)
    if counts_after != counts_before:
        raise RuntimeError(
            "Row counts changed during migration 010: "
            f"before={counts_before} after={counts_after}"
        )
    for table in DEMO_FK_TABLES:
        populated = _rows(
            bind, f"SELECT count(*) FROM {table} WHERE demo_session_id IS NOT NULL"
        )
        if populated:
            raise RuntimeError(
                f"Migration 010 unexpectedly populated {table}.demo_session_id."
            )


def downgrade() -> None:
    bind = op.get_bind()

    sessions = _rows(bind, "SELECT count(*) FROM demo_sessions")
    demo_readings = _rows(
        bind, "SELECT count(*) FROM sensor_readings WHERE source = 'MANUAL_DEMO'"
    )
    if sessions or demo_readings:
        raise RuntimeError(
            "Refusing to downgrade 010 while demo data exists: "
            f"demo_sessions={sessions}, MANUAL_DEMO readings={demo_readings}. "
            "Reset/purge demo sessions (POST /api/demo-sessions/{id}/reset) or "
            "restore from a verified backup/PITR after explicit approval. "
            "See docs/DEMO-SESSIONS.md."
        )

    for table in DEMO_FK_TABLES:
        op.drop_constraint(
            f"fk_{table}_demo_session_organization", table, type_="foreignkey"
        )
        op.drop_constraint(f"fk_{table}_demo_session", table, type_="foreignkey")

    for table in ("alerts", "predictions"):
        op.drop_index(f"ix_{table}_demo_session_id", table_name=table)
        op.drop_column(table, "demo_session_id")

    op.drop_constraint(
        "ck_sensor_readings_demo_coherence", "sensor_readings", type_="check"
    )
    op.drop_constraint("ck_sensor_readings_source", "sensor_readings", type_="check")
    op.drop_index("ix_sensor_readings_demo_session_id", table_name="sensor_readings")
    op.drop_column("sensor_readings", "demo_session_id")
    op.alter_column(
        "sensor_readings",
        "device_id",
        existing_type=sa.String(100),
        nullable=False,
    )
    op.create_check_constraint(
        "ck_sensor_readings_source",
        "sensor_readings",
        "source IN ('WOKWI', 'REAL_HARDWARE')",
    )

    op.drop_index("ix_machines_is_demo", table_name="machines")
    op.drop_column("machines", "is_demo")

    op.drop_index("ix_demo_sessions_organization_status", table_name="demo_sessions")
    op.drop_index("ix_demo_sessions_machine_id", table_name="demo_sessions")
    op.drop_index("ix_demo_sessions_organization_id", table_name="demo_sessions")
    op.drop_table("demo_sessions")
