"""store Vinamilk order snapshots and sync runs

Revision ID: 20260920_vinamilk_orders
Revises: 20260920_product_groups
"""
from alembic import op
import sqlalchemy as sa


revision = "20260920_vinamilk_orders"
down_revision = "20260920_product_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vinamilk_order_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("remote_key", sa.String(length=300), nullable=False),
        sa.Column("order_number", sa.String(length=120)),
        sa.Column("original_order_number", sa.String(length=120)),
        sa.Column("customer_code", sa.String(length=120)),
        sa.Column("customer_name", sa.String(length=255)),
        sa.Column("product_code", sa.String(length=120)),
        sa.Column("product_name", sa.String(length=255)),
        sa.Column("status", sa.String(length=80)),
        sa.Column("order_created_date", sa.Date()),
        sa.Column("delivery_date", sa.Date()),
        sa.Column("synced_from", sa.Date(), nullable=False),
        sa.Column("synced_to", sa.Date(), nullable=False),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.UniqueConstraint("remote_key", name="uq_vnm_snapshot_remote_key"),
    )
    op.create_index("ix_vnm_snapshot_order_number", "vinamilk_order_snapshots", ["order_number"])
    op.create_index("ix_vnm_snapshot_customer", "vinamilk_order_snapshots", ["customer_code", "customer_name"])
    op.create_index("ix_vnm_snapshot_product", "vinamilk_order_snapshots", ["product_code", "product_name"])
    op.create_index("ix_vnm_snapshot_created_date", "vinamilk_order_snapshots", ["order_created_date"])
    op.create_index("ix_vnm_snapshot_delivery_date", "vinamilk_order_snapshots", ["delivery_date"])
    op.create_index("ix_vnm_snapshot_status", "vinamilk_order_snapshots", ["status"])
    op.create_table(
        "vinamilk_sync_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime()),
    )


def downgrade() -> None:
    op.drop_table("vinamilk_sync_runs")
    for index in ("ix_vnm_snapshot_status", "ix_vnm_snapshot_delivery_date", "ix_vnm_snapshot_created_date", "ix_vnm_snapshot_product", "ix_vnm_snapshot_customer", "ix_vnm_snapshot_order_number"):
        op.drop_index(index, table_name="vinamilk_order_snapshots")
    op.drop_table("vinamilk_order_snapshots")