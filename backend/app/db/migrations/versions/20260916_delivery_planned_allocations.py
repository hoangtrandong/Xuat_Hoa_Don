"""store admin delivery location and expiry plan

Revision ID: 20260916_delivery_planned_allocations
Revises: 20260914_location_transfers
"""
from alembic import op
import sqlalchemy as sa


revision = "20260916_delivery_planned_allocations"
down_revision = "20260914_location_transfers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS makes retries and concurrent startup attempts harmless.
    if op.get_bind().dialect.name == "postgresql":
        op.execute(sa.text(
            "ALTER TABLE delivery_request_items "
            "ADD COLUMN IF NOT EXISTS planned_allocations JSON"
        ))
    else:
        op.add_column("delivery_request_items", sa.Column("planned_allocations", sa.JSON(), nullable=True))


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(sa.text(
            "ALTER TABLE delivery_request_items "
            "DROP COLUMN IF EXISTS planned_allocations"
        ))
    else:
        op.drop_column("delivery_request_items", "planned_allocations")
