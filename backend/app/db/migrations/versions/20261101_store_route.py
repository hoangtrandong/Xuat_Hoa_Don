"""add route column to stores

Revision ID: 20261101_store_route
Revises: 20261101_dms_borrow_return_identity
"""

from alembic import op
import sqlalchemy as sa


revision = "20261101_store_route"
down_revision = "20261101_dms_borrow_return_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column("route", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("stores", "route")
