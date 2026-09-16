"""Persist prototype prediction metadata and structured explanations.

Revision ID: 005_prediction_prototype_fields
Revises: 004_enum_check_constraints
"""

from alembic import op
import sqlalchemy as sa

revision = "005_prediction_prototype_fields"
down_revision = "004_enum_check_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("predictions", "remaining_life_days", existing_type=sa.Integer(), nullable=True)
    op.alter_column("predictions", "confidence", existing_type=sa.Float(), nullable=True)
    op.add_column("predictions", sa.Column("is_prototype", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.alter_column("predictions", "is_prototype", server_default=None)
    op.add_column("predictions", sa.Column("explanation_data", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("predictions", "explanation_data")
    op.drop_column("predictions", "is_prototype")
    op.alter_column("predictions", "confidence", existing_type=sa.Float(), nullable=False)
    op.alter_column("predictions", "remaining_life_days", existing_type=sa.Integer(), nullable=False)