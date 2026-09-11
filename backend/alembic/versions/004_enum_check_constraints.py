"""Constrain persisted status, severity, and source values.

Revision ID: 004_enum_check_constraints
Revises: 003_timestamptz_and_machine_specs
"""

from alembic import op

revision = "004_enum_check_constraints"
down_revision = "003_timestamptz_and_machine_specs"
branch_labels = None
depends_on = None

_CONSTRAINTS = (
    ("machines", "ck_machines_status", "status IN ('Healthy', 'Warning', 'Critical', 'Maintenance')"),
    ("devices", "ck_devices_status", "status IN ('ONLINE', 'OFFLINE')"),
    ("devices", "ck_devices_source", "source IN ('WOKWI', 'REAL_HARDWARE')"),
    ("sensor_readings", "ck_sensor_readings_source", "source IN ('WOKWI', 'REAL_HARDWARE')"),
    ("maintenance_records", "ck_maintenance_records_status", "status IN ('Completed', 'In Progress', 'Scheduled')"),
    ("alerts", "ck_alerts_severity", "severity IN ('Critical', 'Warning', 'Info')"),
    ("alerts", "ck_alerts_status", "status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')"),
)


def upgrade() -> None:
    for table, name, condition in _CONSTRAINTS:
        op.create_check_constraint(name, table, condition)


def downgrade() -> None:
    for table, name, _ in reversed(_CONSTRAINTS):
        op.drop_constraint(name, table, type_="check")
