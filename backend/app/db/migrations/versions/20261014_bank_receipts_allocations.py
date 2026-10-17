"""Add bank_receipts and payment_allocations tables

Revision ID: 20261014_bank_receipts_allocations
Revises: 20261011_delivery_return_items
Create Date: 2026-10-14 22:20:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20261014_bank_receipts_allocations"
down_revision = "20261011_delivery_return_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create bank_receipts table
    op.create_table(
        "bank_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("bank_name", sa.String(50), nullable=True),
        sa.Column("account_number", sa.String(50), nullable=True),
        sa.Column("ref_number", sa.String(100), nullable=True),
        sa.Column("transaction_date", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("party_type", sa.String(20), server_default="STORE", nullable=False),
        sa.Column("store_id", sa.Integer(), sa.ForeignKey("stores.id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("allocated_amount", sa.Numeric(14, 2), server_default="0", nullable=False),
        sa.Column("unallocated_amount", sa.Numeric(14, 2), server_default="0", nullable=False),
        sa.Column("status", sa.String(20), server_default="UNALLOCATED", nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_bank_receipts_code", "bank_receipts", ["code"], unique=True)
    op.create_index("ix_bank_receipts_ref_number", "bank_receipts", ["ref_number"])
    op.create_index("ix_bank_receipts_party_type", "bank_receipts", ["party_type"])
    op.create_index("ix_bank_receipts_store_id", "bank_receipts", ["store_id"])
    op.create_index("ix_bank_receipts_customer_id", "bank_receipts", ["customer_id"])
    op.create_index("ix_bank_receipts_status", "bank_receipts", ["status"])

    # 2. Create payment_allocations table
    op.create_table(
        "payment_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("bank_receipt_id", sa.Integer(), sa.ForeignKey("bank_receipts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("delivery_request_orders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
        sa.Column("store_id", sa.Integer(), sa.ForeignKey("stores.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("allocation_date", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_payment_allocations_code", "payment_allocations", ["code"], unique=True)
    op.create_index("ix_payment_allocations_bank_receipt_id", "payment_allocations", ["bank_receipt_id"])
    op.create_index("ix_payment_allocations_order_id", "payment_allocations", ["order_id"])
    op.create_index("ix_payment_allocations_employee_id", "payment_allocations", ["employee_id"])
    op.create_index("ix_payment_allocations_store_id", "payment_allocations", ["store_id"])


def downgrade() -> None:
    op.drop_table("payment_allocations")
    op.drop_table("bank_receipts")
