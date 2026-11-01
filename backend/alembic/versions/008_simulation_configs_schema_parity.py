"""Create ``simulation_configs`` under Alembic ownership (schema parity).

Revision ID: 008_simulation_configs_schema_parity
Revises: 007_prediction_input_hash

Why this exists
---------------
Revisions 001-007 never created ``simulation_configs``. The table only ever
existed because ``backend/app/main.py`` calls ``Base.metadata.create_all`` at
startup, so every real database has it while a database built purely from
migrations does not. That drift blocks the tenancy migration (revision 009),
which must add ``organization_id`` to all eight tenant tables.

This revision is intentionally idempotent: if the table already exists (the
normal production case), nothing is changed. No existing row is touched.

Downgrade
---------
Deliberately a no-op. The table may predate this revision (created by
``create_all``); dropping it on downgrade could destroy real telemetry
configuration data. Only the tenancy artifacts from revision 009 are removed.
"""

from alembic import op
import sqlalchemy as sa

revision = "008_simulation_configs_schema_parity"
down_revision = "007_prediction_input_hash"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("simulation_configs"):
        # Already created at runtime by Base.metadata.create_all.
        return

    op.create_table(
        "simulation_configs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "machine_id",
            sa.String(50),
            sa.ForeignKey("machines.machine_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("motor_powered", sa.Boolean(), nullable=False),
        sa.Column("simulation_mode", sa.String(50), nullable=False),
        sa.Column("update_interval_ms", sa.Integer(), nullable=False),
        sa.Column("temp_min", sa.Float(), nullable=False),
        sa.Column("temp_max", sa.Float(), nullable=False),
        sa.Column("temp_target", sa.Float(), nullable=False),
        sa.Column("temp_step", sa.Float(), nullable=False),
        sa.Column("temp_warning", sa.Float(), nullable=False),
        sa.Column("temp_critical", sa.Float(), nullable=False),
        sa.Column("current_min", sa.Float(), nullable=False),
        sa.Column("current_max", sa.Float(), nullable=False),
        sa.Column("current_target", sa.Float(), nullable=False),
        sa.Column("current_step", sa.Float(), nullable=False),
        sa.Column("current_warning", sa.Float(), nullable=False),
        sa.Column("current_critical", sa.Float(), nullable=False),
        sa.Column("rpm_min", sa.Float(), nullable=False),
        sa.Column("rpm_max", sa.Float(), nullable=False),
        sa.Column("rpm_target", sa.Float(), nullable=False),
        sa.Column("rpm_step", sa.Float(), nullable=False),
        sa.Column("rpm_rated", sa.Float(), nullable=False),
        sa.Column("rpm_warning", sa.Float(), nullable=False),
        sa.Column("rpm_critical", sa.Float(), nullable=False),
        sa.Column("vib_min", sa.Float(), nullable=False),
        sa.Column("vib_max", sa.Float(), nullable=False),
        sa.Column("vib_target", sa.Float(), nullable=False),
        sa.Column("vib_step", sa.Float(), nullable=False),
        sa.Column("vib_warning", sa.Float(), nullable=False),
        sa.Column("vib_critical", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("machine_id", name="uq_simulation_configs_machine_id"),
    )


def downgrade() -> None:
    # See module docstring: intentionally does not drop a pre-existing table.
    pass
