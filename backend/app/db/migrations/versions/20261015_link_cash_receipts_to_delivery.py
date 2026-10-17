"""link employee cash remittances to delivery requests

Revision ID: 20261015_link_cash_receipts_to_delivery
Revises: 20261014_bank_receipts_allocations
"""
from alembic import op
import sqlalchemy as sa


revision = "20261015_link_cash_receipts_to_delivery"
down_revision = "20261014_bank_receipts_allocations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cash_receipts",
        sa.Column("delivery_request_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_cash_receipts_delivery_request_id",
        "cash_receipts",
        "delivery_requests",
        ["delivery_request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_cash_receipts_delivery_request_id",
        "cash_receipts",
        ["delivery_request_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_cash_receipts_delivery_request_id", table_name="cash_receipts")
    op.drop_constraint(
        "fk_cash_receipts_delivery_request_id",
        "cash_receipts",
        type_="foreignkey",
    )
    op.drop_column("cash_receipts", "delivery_request_id")
