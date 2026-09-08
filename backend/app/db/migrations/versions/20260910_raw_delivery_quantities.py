"""allow raw thung/hop quantities before conversion

Revision ID: 20260910_raw_delivery_quantities
Revises: 20260909_delivery_workbook
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260910_raw_delivery_quantities"
down_revision: Union[str, None] = "20260909_delivery_workbook"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("delivery_request_items", sa.Column("requested_quantity_raw", sa.String(40), nullable=True))
    with op.batch_alter_table("delivery_request_items") as batch:
        batch.drop_constraint("ck_delivery_item_qty_positive", type_="check")
        batch.create_check_constraint("ck_delivery_item_qty_nonnegative", "quantity >= 0")


def downgrade() -> None:
    with op.batch_alter_table("delivery_request_items") as batch:
        batch.drop_constraint("ck_delivery_item_qty_nonnegative", type_="check")
        batch.create_check_constraint("ck_delivery_item_qty_positive", "quantity > 0")
    op.drop_column("delivery_request_items", "requested_quantity_raw")
