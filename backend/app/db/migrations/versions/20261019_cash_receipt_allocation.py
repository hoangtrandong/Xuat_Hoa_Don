"""Add cash receipt metadata columns.

Revision ID: 20261019_cash_receipt_allocation
Revises: 20261018_generic_debt_transfers
"""

from alembic import op
import sqlalchemy as sa


revision = "20261019_cash_receipt_allocation"
down_revision = "20261018_generic_debt_transfers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bank_receipts",
        sa.Column("payment_method", sa.String(20), server_default="BANK", nullable=False),
    )
    op.add_column(
        "bank_receipts",
        sa.Column("received_by", sa.String(120), nullable=True),
    )
    op.create_index(
        "ix_bank_receipts_payment_method",
        "bank_receipts",
        ["payment_method"],
    )


def downgrade() -> None:
    op.drop_index("ix_bank_receipts_payment_method", table_name="bank_receipts")
    op.drop_column("bank_receipts", "received_by")
    op.drop_column("bank_receipts", "payment_method")
