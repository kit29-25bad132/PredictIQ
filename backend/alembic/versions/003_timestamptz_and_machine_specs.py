"""Normalize timestamps and persist machine specifications.

Revision ID: 003_timestamptz_and_machine_specs
Revises: 002_device_source
"""

from alembic import op
import sqlalchemy as sa

revision = "003_timestamptz_and_machine_specs"
down_revision = "002_device_source"
branch_labels = None
depends_on = None

_TIMESTAMP_COLUMNS = (
    ("machines", "created_at"),
    ("devices", "last_seen"),
    ("devices", "created_at"),
    ("sensor_readings", "timestamp"),
    ("sensor_readings", "created_at"),
    ("maintenance_records", "failure_date"),
    ("maintenance_records", "maintenance_date"),
    ("maintenance_records", "created_at"),
    ("predictions", "timestamp"),
    ("predictions", "created_at"),
    ("alerts", "created_at"),
    ("alerts", "resolved_at"),
)


def upgrade() -> None:
    for table, column in _TIMESTAMP_COLUMNS:
        nullable = column in {"last_seen", "failure_date", "resolved_at"}
        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(),
            type_=sa.DateTime(timezone=True),
            existing_nullable=nullable,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )

    op.add_column("machines", sa.Column("rated_rpm", sa.Float(), nullable=True))
    op.add_column("machines", sa.Column("rated_current", sa.Float(), nullable=True))
    op.add_column("machines", sa.Column("max_temp", sa.Float(), nullable=True))
    op.add_column("machines", sa.Column("max_vibration", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("machines", "max_vibration")
    op.drop_column("machines", "max_temp")
    op.drop_column("machines", "rated_current")
    op.drop_column("machines", "rated_rpm")

    for table, column in reversed(_TIMESTAMP_COLUMNS):
        nullable = column in {"last_seen", "failure_date", "resolved_at"}
        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(timezone=True),
            type_=sa.DateTime(),
            existing_nullable=nullable,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )
