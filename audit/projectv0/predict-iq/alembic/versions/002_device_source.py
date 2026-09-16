"""Store the source of each registered device.

Revision ID: 002_device_source
Revises: 001_initial_schema
"""

from alembic import op
import sqlalchemy as sa

revision = "002_device_source"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("source", sa.String(length=30), nullable=False, server_default="REAL_HARDWARE"),
    )
    op.alter_column("devices", "source", server_default=None)


def downgrade() -> None:
    op.drop_column("devices", "source")