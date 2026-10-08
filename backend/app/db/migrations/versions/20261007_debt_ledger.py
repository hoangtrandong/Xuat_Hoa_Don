"""add employee debt limit and debt ledger tables

Revision ID: 20261007_debt_ledger
Revises: 20261006_vnm_replacements
"""
from alembic import op
import sqlalchemy as sa


revision = "20261007_debt_ledger"
down_revision = "20261006_vnm_replacements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Update employees table
    op.add_column("employees", sa.Column("vinamilk_code", sa.String(50), nullable=True))
    op.create_index("ix_employees_vinamilk_code", "employees", ["vinamilk_code"])
    op.add_column(
        "employees",
        sa.Column("debt_limit", sa.Numeric(14, 2), server_default="50000000.00", nullable=False),
    )

    # 2. delivery_request_employee_summaries table
    op.create_table(
        "delivery_request_employee_summaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "delivery_request_id",
            sa.Integer(),
            sa.ForeignKey("delivery_requests.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("employee_code", sa.String(30), nullable=False),
        sa.Column("employee_name", sa.String(120), nullable=True),
        sa.Column("column_key", sa.String(20), nullable=True),
        sa.Column("weight_ton", sa.Numeric(12, 5), server_default="0", nullable=False),
        sa.Column("order_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )

    # 3. debt_ledger_entries table
    op.create_table(
        "debt_ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("party_type", sa.String(20), nullable=False, index=True),
        sa.Column("party_id", sa.Integer(), nullable=False, index=True),
        sa.Column("entry_type", sa.String(30), nullable=False, index=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("source_code", sa.String(50), nullable=True),
        sa.Column("document_date", sa.DateTime(), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.UniqueConstraint(
            "source_type", "source_id", "party_type", "party_id", "entry_type",
            name="uq_debt_ledger_source_party_entry",
        ),
    )

    # 4. debt_transfers table
    op.create_table(
        "debt_transfers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), unique=True, index=True, nullable=False),
        sa.Column("from_employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=False, index=True),
        sa.Column("to_store_id", sa.Integer(), sa.ForeignKey("stores.id"), nullable=False, index=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), server_default="PENDING", nullable=False, index=True),
        sa.Column("requested_by", sa.String(120), nullable=True),
        sa.Column("approved_by", sa.String(120), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )

    # 5. cash_receipts table
    op.create_table(
        "cash_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), unique=True, index=True, nullable=False),
        sa.Column("party_type", sa.String(20), nullable=False, index=True),
        sa.Column("party_id", sa.Integer(), nullable=False, index=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("receipt_date", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )

    # 6. delivery_returns table
    op.create_table(
        "delivery_returns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), unique=True, index=True, nullable=False),
        sa.Column("delivery_request_id", sa.Integer(), sa.ForeignKey("delivery_requests.id"), nullable=False, index=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=False, index=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("status", sa.String(20), server_default="PENDING", nullable=False, index=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("approved_by", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("delivery_returns")
    op.drop_table("cash_receipts")
    op.drop_table("debt_transfers")
    op.drop_table("debt_ledger_entries")
    op.drop_table("delivery_request_employee_summaries")
    op.drop_column("employees", "debt_limit")
    op.drop_index("ix_employees_vinamilk_code", "employees")
    op.drop_column("employees", "vinamilk_code")
