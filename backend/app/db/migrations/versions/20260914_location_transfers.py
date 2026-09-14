"""add location transfer documents

Revision ID: 20260914_location_transfers
Revises: 20260914_document_date
Create Date: 2026-09-14 23:46:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260914_location_transfers"
down_revision = "20260914_document_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("inventory_transactions", "type", type_=sa.String(30), existing_type=sa.String(10))
    op.alter_column("inventory_transactions", "ref_type", type_=sa.String(30), existing_type=sa.String(10))
    op.create_table(
        "inventory_transfers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), sa.ForeignKey("warehouses.id"), nullable=False),
        sa.Column("status", sa.String(15), nullable=False, server_default="DRAFT"),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_inventory_transfers_code", "inventory_transfers", ["code"])
    op.create_index("ix_inventory_transfers_status", "inventory_transfers", ["status"])
    op.create_table(
        "inventory_transfer_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transfer_id", sa.Integer(), sa.ForeignKey("inventory_transfers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("lot_id", sa.Integer(), sa.ForeignKey("inventory_lots.id"), nullable=False),
        sa.Column("source_location_id", sa.Integer(), sa.ForeignKey("warehouse_locations.id"), nullable=False),
        sa.Column("destination_location_id", sa.Integer(), sa.ForeignKey("warehouse_locations.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_transfer_item_qty_positive"),
    )


def downgrade() -> None:
    op.drop_table("inventory_transfer_items")
    op.drop_index("ix_inventory_transfers_status", table_name="inventory_transfers")
    op.drop_index("ix_inventory_transfers_code", table_name="inventory_transfers")
    op.drop_table("inventory_transfers")
    op.alter_column("inventory_transactions", "ref_type", type_=sa.String(10), existing_type=sa.String(30))
    op.alter_column("inventory_transactions", "type", type_=sa.String(10), existing_type=sa.String(30))
