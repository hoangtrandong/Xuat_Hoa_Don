"""track supplier goods discrepancies and offset excess stock locks

Revision ID: 20260928_supplier_discrepancies
Revises: 20260927_drop_customer_route_visit
"""
from alembic import op
import sqlalchemy as sa


revision = "20260928_supplier_discrepancies"
down_revision = "20260927_drop_customer_route_visit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_lots",
        sa.Column("locked_quantity", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_inventory_lot_locked_qty",
        "inventory_lots",
        "locked_quantity >= 0 AND locked_quantity <= quantity_on_hand",
    )
    op.create_table(
        "supplier_goods_discrepancies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("warehouse_id", sa.Integer(), sa.ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("type", sa.String(length=10), nullable=False),
        sa.Column("document_quantity", sa.Integer(), nullable=False),
        sa.Column("actual_quantity", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("lot_number", sa.String(length=80)),
        sa.Column("expiry_date", sa.DateTime()),
        sa.Column("invoice_number", sa.String(length=120)),
        sa.Column("ref_code", sa.String(length=40)),
        sa.Column("document_date", sa.DateTime()),
        sa.Column("note", sa.Text()),
        sa.Column("created_by", sa.String(length=120)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=15), nullable=False, server_default="OPEN"),
        sa.CheckConstraint("document_quantity > 0", name="ck_supplier_discrepancy_document_qty"),
        sa.CheckConstraint("actual_quantity >= 0", name="ck_supplier_discrepancy_actual_qty"),
        sa.CheckConstraint("quantity > 0", name="ck_supplier_discrepancy_qty"),
        sa.CheckConstraint("type IN ('SHORTAGE', 'EXCESS')", name="ck_supplier_discrepancy_type"),
        sa.CheckConstraint(
            "(type = 'SHORTAGE' AND actual_quantity < document_quantity "
            "AND quantity = document_quantity - actual_quantity) OR "
            "(type = 'EXCESS' AND actual_quantity > document_quantity "
            "AND quantity = actual_quantity - document_quantity)",
            name="ck_supplier_discrepancy_difference",
        ),
    )
    op.create_index("ix_supplier_goods_discrepancies_warehouse_id", "supplier_goods_discrepancies", ["warehouse_id"])
    op.create_index("ix_supplier_goods_discrepancies_product_id", "supplier_goods_discrepancies", ["product_id"])
    op.create_index("ix_supplier_goods_discrepancies_type", "supplier_goods_discrepancies", ["type"])
    op.create_index("ix_supplier_goods_discrepancies_invoice_number", "supplier_goods_discrepancies", ["invoice_number"])
    op.create_index("ix_supplier_goods_discrepancies_status", "supplier_goods_discrepancies", ["status"])
    op.create_table(
        "supplier_goods_discrepancy_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("discrepancy_id", sa.Integer(), sa.ForeignKey("supplier_goods_discrepancies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lot_id", sa.Integer(), sa.ForeignKey("inventory_lots.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("released_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("quantity > 0", name="ck_supplier_discrepancy_source_qty"),
        sa.CheckConstraint("released_quantity >= 0 AND released_quantity <= quantity",
                           name="ck_supplier_discrepancy_source_released_qty"),
    )
    op.create_index("ix_supplier_goods_discrepancy_sources_discrepancy_id", "supplier_goods_discrepancy_sources", ["discrepancy_id"])
    op.create_table(
        "supplier_goods_discrepancy_offsets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shortage_id", sa.Integer(), sa.ForeignKey("supplier_goods_discrepancies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("excess_id", sa.Integer(), sa.ForeignKey("supplier_goods_discrepancies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("created_by", sa.String(length=120)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_supplier_discrepancy_offset_qty"),
        sa.CheckConstraint("shortage_id != excess_id", name="ck_supplier_discrepancy_offset_distinct"),
    )
    op.create_index("ix_supplier_goods_discrepancy_offsets_shortage_id", "supplier_goods_discrepancy_offsets", ["shortage_id"])
    op.create_index("ix_supplier_goods_discrepancy_offsets_excess_id", "supplier_goods_discrepancy_offsets", ["excess_id"])


def downgrade() -> None:
    op.drop_index("ix_supplier_goods_discrepancy_offsets_excess_id", table_name="supplier_goods_discrepancy_offsets")
    op.drop_index("ix_supplier_goods_discrepancy_offsets_shortage_id", table_name="supplier_goods_discrepancy_offsets")
    op.drop_table("supplier_goods_discrepancy_offsets")
    op.drop_index("ix_supplier_goods_discrepancy_sources_discrepancy_id", table_name="supplier_goods_discrepancy_sources")
    op.drop_table("supplier_goods_discrepancy_sources")
    op.drop_index("ix_supplier_goods_discrepancies_status", table_name="supplier_goods_discrepancies")
    op.drop_index("ix_supplier_goods_discrepancies_invoice_number", table_name="supplier_goods_discrepancies")
    op.drop_index("ix_supplier_goods_discrepancies_type", table_name="supplier_goods_discrepancies")
    op.drop_index("ix_supplier_goods_discrepancies_product_id", table_name="supplier_goods_discrepancies")
    op.drop_index("ix_supplier_goods_discrepancies_warehouse_id", table_name="supplier_goods_discrepancies")
    op.drop_table("supplier_goods_discrepancies")
    op.drop_constraint("ck_inventory_lot_locked_qty", "inventory_lots", type_="check")
    op.drop_column("inventory_lots", "locked_quantity")
