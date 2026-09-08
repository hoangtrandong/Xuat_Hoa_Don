"""add inventory lots, warehouse locations, and FEFO allocations

Revision ID: 20260908_inventory_lots_fefo
Revises: 20260908_delivery_requests
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260908_inventory_lots_fefo"
down_revision: Union[str, None] = "20260908_delivery_requests"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "warehouse_locations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(120)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("warehouse_id", "code", name="uq_warehouse_location_code"),
    )
    op.create_index("ix_warehouse_locations_warehouse_id", "warehouse_locations", ["warehouse_id"])
    op.create_table(
        "inventory_lots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer()),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("lot_number", sa.String(80), nullable=True),
        sa.Column("expiry_date", sa.DateTime()),
        sa.Column("quantity_on_hand", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unit_cost", sa.Float()),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["warehouse_locations.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.CheckConstraint("quantity_on_hand >= 0", name="ck_inventory_lot_qty_nonnegative"),
        sa.UniqueConstraint("warehouse_id", "location_id", "product_id", "lot_number", "expiry_date", name="uq_inventory_position"),
    )
    op.create_index("ix_inventory_lots_warehouse_id", "inventory_lots", ["warehouse_id"])
    op.create_index("ix_inventory_lots_product_id", "inventory_lots", ["product_id"])
    op.create_index("ix_inventory_lots_expiry_date", "inventory_lots", ["expiry_date"])
    with op.batch_alter_table("inventory_transactions") as batch:
        batch.add_column(sa.Column("lot_id", sa.Integer()))
        batch.add_column(sa.Column("location_id", sa.Integer()))
        batch.add_column(sa.Column("expiry_date", sa.DateTime()))
        batch.create_foreign_key("fk_txn_lot", "inventory_lots", ["lot_id"], ["id"])
        batch.create_foreign_key("fk_txn_location", "warehouse_locations", ["location_id"], ["id"])
    with op.batch_alter_table("delivery_allocations") as batch:
        # PostgreSQL assigns this name because the original migration used
        # an unnamed UNIQUE constraint on item_id.
        batch.drop_constraint("delivery_allocations_item_id_key", type_="unique")
        batch.drop_column("lot_id")
        batch.drop_column("location_id")
        batch.add_column(sa.Column("lot_id", sa.Integer()))
        batch.add_column(sa.Column("location_id", sa.Integer()))
        batch.create_foreign_key("fk_allocation_lot", "inventory_lots", ["lot_id"], ["id"])
        batch.create_foreign_key("fk_allocation_location", "warehouse_locations", ["location_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("delivery_allocations") as batch:
        batch.drop_constraint("fk_allocation_location", type_="foreignkey")
        batch.drop_constraint("fk_allocation_lot", type_="foreignkey")
        batch.drop_column("location_id")
        batch.drop_column("lot_id")
        batch.create_unique_constraint("uq_delivery_allocations_item_id", ["item_id"])
    with op.batch_alter_table("inventory_transactions") as batch:
        batch.drop_constraint("fk_txn_location", type_="foreignkey")
        batch.drop_constraint("fk_txn_lot", type_="foreignkey")
        batch.drop_column("expiry_date")
        batch.drop_column("location_id")
        batch.drop_column("lot_id")
    op.drop_table("inventory_lots")
    op.drop_index("ix_warehouse_locations_warehouse_id", table_name="warehouse_locations")
    op.drop_table("warehouse_locations")
