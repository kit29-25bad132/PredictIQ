"""Capture maintenance feedback and prediction-vs-reality ground truth.

Revision ID: 006_feedback_ground_truth
Revises: 005_prediction_prototype_fields
"""

from alembic import op
import sqlalchemy as sa


revision = "006_feedback_ground_truth"
down_revision = "005_prediction_prototype_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feedback_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("machine_id", sa.String(50),
                  sa.ForeignKey("machines.machine_id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("prediction_id", sa.Integer(),
                  sa.ForeignKey("predictions.id", ondelete="SET NULL"),
                  nullable=True, index=True),
        sa.Column("alert_id", sa.Integer(),
                  sa.ForeignKey("alerts.id", ondelete="SET NULL"),
                  nullable=True, index=True),
        sa.Column("maintenance_record_id", sa.Integer(),
                  sa.ForeignKey("maintenance_records.id", ondelete="SET NULL"),
                  nullable=True, index=True),
        sa.Column("observed_condition", sa.Text(), nullable=False),
        sa.Column("actual_fault", sa.String(200), nullable=True),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("symptoms", sa.Text(), nullable=True),
        sa.Column("action_taken", sa.Text(), nullable=True),
        sa.Column("parts_replaced", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(50), nullable=False),
        sa.Column("outcome", sa.String(50), nullable=False),
        sa.Column("technician_notes", sa.Text(), nullable=True),
        sa.Column("prediction_correct", sa.Boolean(), nullable=True),
        sa.Column("feedback_source", sa.String(30), nullable=False,
                  server_default="MANUAL"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("severity IN ('Critical', 'Warning', 'Info')",
                           name="ck_feedback_records_severity"),
        sa.CheckConstraint("outcome IN ('Confirmed', 'Not Confirmed', 'Cancelled')",
                           name="ck_feedback_records_outcome"),
        sa.CheckConstraint("feedback_source IN ('MANUAL', 'INSPECTION')",
                           name="ck_feedback_records_source"),
    )


def downgrade() -> None:
    op.drop_constraint("ck_feedback_records_source", "feedback_records", type_="check")
    op.drop_constraint("ck_feedback_records_outcome", "feedback_records", type_="check")
    op.drop_constraint("ck_feedback_records_severity", "feedback_records", type_="check")
    op.drop_table("feedback_records")
