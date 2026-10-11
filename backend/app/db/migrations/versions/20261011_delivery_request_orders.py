"""add delivery_request_orders table

Revision ID: 20261011_delivery_request_orders
Revises: 20261010_employee_debt_limit_history
"""
from alembic import op
import sqlalchemy as sa


revision = "20261011_delivery_request_orders"
down_revision = "20261010_employee_debt_limit_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "delivery_request_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "delivery_request_id",
            sa.Integer(),
            sa.ForeignKey("delivery_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("order_date", sa.Date(), nullable=True),
        sa.Column("order_number", sa.String(120), nullable=False),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("employee_code", sa.String(30), nullable=False),
        sa.Column("employee_name", sa.String(120), nullable=True),
        sa.Column("customer_code", sa.String(120), nullable=True),
        sa.Column("customer_name", sa.String(255), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), server_default="0", nullable=False),
        sa.Column("payment_status", sa.String(30), server_default="UNPAID", nullable=False),
        sa.Column("payment_method", sa.String(30), nullable=True),
        sa.Column("bank_ref", sa.String(120), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_delivery_request_orders_delivery_request_id",
        "delivery_request_orders",
        ["delivery_request_id"],
    )
    op.create_index(
        "ix_delivery_request_orders_order_number",
        "delivery_request_orders",
        ["order_number"],
    )
    op.create_index(
        "ix_delivery_request_orders_employee_id",
        "delivery_request_orders",
        ["employee_id"],
    )
    op.create_index(
        "ix_delivery_request_orders_employee_code",
        "delivery_request_orders",
        ["employee_code"],
    )
    op.create_index(
        "ix_delivery_request_orders_customer_code",
        "delivery_request_orders",
        ["customer_code"],
    )
    op.create_index(
        "ix_delivery_request_orders_payment_status",
        "delivery_request_orders",
        ["payment_status"],
    )


def downgrade() -> None:
    op.drop_table("delivery_request_orders")
