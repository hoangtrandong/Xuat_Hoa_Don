"""store requested delivery location and expiry details

Revision ID: 20260914_delivery_planned_allocations
Revises: 20260914_location_transfers
"""
from alembic import op
import sqlalchemy as sa


revision = "20260914_delivery_planned_allocations"
down_revision = "20260914_location_transfers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("delivery_request_items", sa.Column("planned_allocations", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("delivery_request_items", "planned_allocations")
