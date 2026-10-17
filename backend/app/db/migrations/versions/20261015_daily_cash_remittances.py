"""link employee cash remittances to daily settlements

Revision ID: 20261015_daily_cash_remittances
Revises: 20261015_link_cash_receipts_to_delivery
"""
from alembic import op
import sqlalchemy as sa


revision = "20261015_daily_cash_remittances"
down_revision = "20261015_link_cash_receipts_to_delivery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cash_receipts", sa.Column("settlement_date", sa.Date(), nullable=True))
    op.create_index(
        "ix_cash_receipts_settlement_date",
        "cash_receipts",
        ["settlement_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_cash_receipts_settlement_date", table_name="cash_receipts")
    op.drop_column("cash_receipts", "settlement_date")
