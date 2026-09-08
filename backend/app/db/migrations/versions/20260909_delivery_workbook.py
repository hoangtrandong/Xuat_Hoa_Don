"""add delivery workbook packaging and employee metadata

Revision ID: 20260909_delivery_workbook
Revises: 20260908_inventory_lots_fefo
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260909_delivery_workbook"
down_revision: Union[str, None] = "20260908_inventory_lots_fefo"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("boxes_per_carton", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("delivery_request_items", sa.Column("employee_allocations", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("delivery_request_items", "employee_allocations")
    op.drop_column("products", "boxes_per_carton")
