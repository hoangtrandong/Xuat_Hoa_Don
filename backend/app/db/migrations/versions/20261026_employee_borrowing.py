"""Add employee borrowed-goods ledger.

Revision ID: 20261026_employee_borrowing
Revises: 20261019_cash_receipt_allocation
"""

from alembic import op
import sqlalchemy as sa


revision = "20261026_employee_borrowing"
down_revision = "20261019_cash_receipt_allocation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employee_borrow_batches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("import_hash", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="PENDING"),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("posted_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("import_hash", name="uq_employee_borrow_batches_import_hash"),
    )
    op.create_index("ix_employee_borrow_batches_status", "employee_borrow_batches", ["status"])

    op.create_table(
        "employee_borrow_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("employee_borrow_batches.id", ondelete="CASCADE"), nullable=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("entry_type", sa.String(length=10), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("source_entry_id", sa.Integer(), sa.ForeignKey("employee_borrow_entries.id"), nullable=True),
        sa.Column("source_request_id", sa.Integer(), sa.ForeignKey("delivery_requests.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("quantity != 0", name="ck_employee_borrow_entry_quantity_nonzero"),
        sa.CheckConstraint(
            "(entry_type = 'BORROW' AND quantity < 0 AND amount <= 0) OR "
            "(entry_type = 'OFFSET' AND quantity > 0 AND amount >= 0)",
            name="ck_employee_borrow_entry_sign",
        ),
        sa.UniqueConstraint("source_entry_id", "source_request_id", name="uq_employee_borrow_request_offset"),
    )
    for column in ("batch_id", "employee_id", "product_id", "entry_type", "source_entry_id", "source_request_id", "created_at"):
        op.create_index(f"ix_employee_borrow_entries_{column}", "employee_borrow_entries", [column])


def downgrade() -> None:
    for column in ("created_at", "source_request_id", "source_entry_id", "entry_type", "product_id", "employee_id", "batch_id"):
        op.drop_index(f"ix_employee_borrow_entries_{column}", table_name="employee_borrow_entries")
    op.drop_table("employee_borrow_entries")
    op.drop_index("ix_employee_borrow_batches_status", table_name="employee_borrow_batches")
    op.drop_table("employee_borrow_batches")
