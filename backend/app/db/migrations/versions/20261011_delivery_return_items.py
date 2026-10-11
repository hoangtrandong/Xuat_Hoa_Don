"""Add delivery_return_items table and order_id to delivery_returns

Revision ID: 20261011_delivery_return_items
Revises: 20261011_delivery_request_orders
Create Date: 2026-10-11 15:47:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20261011_delivery_return_items"
down_revision = "20261011_delivery_request_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add order_id column to delivery_returns
    op.add_column(
        "delivery_returns",
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("delivery_request_orders.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_delivery_returns_order_id", "delivery_returns", ["order_id"])

    # 2. Create delivery_return_items table
    op.create_table(
        "delivery_return_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("delivery_return_id", sa.Integer(), sa.ForeignKey("delivery_returns.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False, index=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("cartons", sa.Integer(), server_default="0", nullable=False),
        sa.Column("loose_boxes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("unit_price", sa.Numeric(14, 2), server_default="0", nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), server_default="0", nullable=False),
        sa.Column("reason", sa.String(255), nullable=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("warehouse_locations.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("delivery_return_items")
    op.drop_index("ix_delivery_returns_order_id", table_name="delivery_returns")
    op.drop_column("delivery_returns", "order_id")
