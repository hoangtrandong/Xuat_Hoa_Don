"""set employee debt limit to 500 million

Revision ID: 20261010_employee_debt_limit_500m
Revises: 20261007_debt_ledger
"""
from alembic import op
import sqlalchemy as sa


revision = "20261010_employee_debt_limit_500m"
down_revision = "20261007_debt_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "employees",
        "debt_limit",
        existing_type=sa.Numeric(14, 2),
        server_default="500000000.00",
    )
    op.execute("UPDATE employees SET debt_limit = 500000000.00")


def downgrade() -> None:
    op.alter_column(
        "employees",
        "debt_limit",
        existing_type=sa.Numeric(14, 2),
        server_default="50000000.00",
    )
