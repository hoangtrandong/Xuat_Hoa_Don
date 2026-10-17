"""Allow bank receipt allocations by employee and settlement day.

Revision ID: 20261017_employee_day_bank_allocations
Revises: 20261015_daily_cash_remittances
"""

from alembic import op
import sqlalchemy as sa


revision = "20261017_employee_day_bank_allocations"
down_revision = "20261015_daily_cash_remittances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payment_allocations",
        sa.Column("settlement_date", sa.Date(), nullable=True),
    )
    op.create_index(
        "ix_payment_allocations_settlement_date",
        "payment_allocations",
        ["settlement_date"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_payment_allocations_settlement_date",
        table_name="payment_allocations",
    )
    op.drop_column("payment_allocations", "settlement_date")
