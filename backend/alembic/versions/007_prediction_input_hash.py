"""Add dedicated input_hash column for deterministic prediction idempotency.

Revision ID: 007_prediction_input_hash
Revises: 006_feedback_ground_truth
"""

from alembic import op
import sqlalchemy as sa


revision = "007_prediction_input_hash"
down_revision = "006_feedback_ground_truth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("predictions", sa.Column("input_hash", sa.String(64), nullable=True))

    op.execute(
        """
        UPDATE predictions
        SET input_hash = (
            SELECT json_extract_path_text(
                predictions.explanation_data::json, 'inference_input_hash'
            )
        )
        WHERE explanation_data IS NOT NULL
          AND explanation_data LIKE '%"inference_input_hash"%'
        """
    )

    op.create_index(
        "uq_predictions_idempotency",
        "predictions",
        ["machine_id", "model_version", "input_hash"],
        unique=True,
        postgresql_where=sa.text("input_hash IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_predictions_idempotency", table_name="predictions")
    op.drop_column("predictions", "input_hash")
