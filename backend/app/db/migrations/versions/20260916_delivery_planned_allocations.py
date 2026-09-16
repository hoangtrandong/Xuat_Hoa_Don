"""store admin delivery location and expiry plan

Revision ID: 20260916_delivery_planned_allocations
Revises: 20260914_location_transfers
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260916_delivery_planned_allocations"
down_revision = "20260914_location_transfers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("delivery_request_items")}
    if "planned_allocations" not in columns:
        op.add_column("delivery_request_items", sa.Column("planned_allocations", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("delivery_request_items")}
    if "planned_allocations" in columns:
        op.drop_column("delivery_request_items", "planned_allocations")
