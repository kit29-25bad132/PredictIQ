"""Add an explicit provenance class for authenticated human measurements.

Revision ID: 011_manual_input_provenance
Revises: 010_manual_demo_source
Create Date: 2026-11-26

Manual browser input must not masquerade as ESP32/Wokwi telemetry.  This
backward-compatible migration extends the existing source and coherence checks;
it does not rewrite or delete any rows.
"""

import sqlalchemy as sa
from alembic import op


revision = "011_manual_input_provenance"
down_revision = "010_manual_demo_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_sensor_readings_demo_coherence", "sensor_readings", type_="check")
    op.drop_constraint("ck_sensor_readings_source", "sensor_readings", type_="check")
    op.create_check_constraint(
        "ck_sensor_readings_source",
        "sensor_readings",
        "source IN ('WOKWI', 'REAL_HARDWARE', 'MANUAL_DEMO', 'MANUAL_INPUT')",
    )
    op.create_check_constraint(
        "ck_sensor_readings_demo_coherence",
        "sensor_readings",
        "(source = 'MANUAL_DEMO' AND demo_session_id IS NOT NULL AND device_id IS NULL) "
        "OR (source = 'MANUAL_INPUT' AND demo_session_id IS NULL AND device_id IS NULL) "
        "OR (source IN ('WOKWI', 'REAL_HARDWARE') AND demo_session_id IS NULL AND device_id IS NOT NULL)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    remaining = bind.execute(
        sa.text("SELECT count(*) FROM sensor_readings WHERE source = 'MANUAL_INPUT'")
    ).scalar()
    if remaining:
        raise RuntimeError(
            "Refusing to downgrade 011 while MANUAL_INPUT readings exist. "
            "Export or explicitly remove those records under an approved retention procedure first."
        )
    op.drop_constraint("ck_sensor_readings_demo_coherence", "sensor_readings", type_="check")
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
