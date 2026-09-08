"""add delivery request workflow

Revision ID: 20260908_delivery_requests
Revises: 4aed3cb6b875
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260908_delivery_requests"
down_revision: Union[str, None] = "4aed3cb6b875"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "delivery_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(15), nullable=False, server_default="DRAFT"),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_delivery_requests_code", "delivery_requests", ["code"])
    op.create_index("ix_delivery_requests_status", "delivery_requests", ["status"])
    op.create_table(
        "delivery_request_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["delivery_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.CheckConstraint("quantity > 0", name="ck_delivery_item_qty_positive"),
    )
    op.create_table(
        "delivery_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("allocated_quantity", sa.Integer(), nullable=False),
        sa.Column("allocation_sequence", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("allocation_strategy", sa.String(30), nullable=False, server_default="DETERMINISTIC_STOCK"),
        sa.Column("lot_id", sa.String(80), nullable=True),
        sa.Column("location_id", sa.String(80), nullable=True),
        sa.Column("expiry_date", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["item_id"], ["delivery_request_items.id"], ondelete="CASCADE"),
        sa.CheckConstraint("allocated_quantity > 0", name="ck_delivery_allocation_qty_positive"),
        sa.UniqueConstraint("item_id"),
    )


def downgrade() -> None:
    op.drop_table("delivery_allocations")
    op.drop_table("delivery_request_items")
    op.drop_index("ix_delivery_requests_status", table_name="delivery_requests")
    op.drop_index("ix_delivery_requests_code", table_name="delivery_requests")
    op.drop_table("delivery_requests")
