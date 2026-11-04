"""add staff_code and staff_name to customers

Revision ID: 20261104_customer_sales_staff
Revises: 20261103_split_order_requests
"""

from alembic import op
import sqlalchemy as sa


revision = "20261104_customer_sales_staff"
down_revision = "20261103_split_order_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = [col["name"] for col in inspector.get_columns("customers")]

    if "staff_code" not in existing_columns:
        op.add_column("customers", sa.Column("staff_code", sa.String(length=50), nullable=True))
        op.create_index("ix_customers_staff_code", "customers", ["staff_code"])

    if "staff_name" not in existing_columns:
        op.add_column("customers", sa.Column("staff_name", sa.String(length=160), nullable=True))


def downgrade() -> None:
    op.drop_index("ix_customers_staff_code", table_name="customers")
    op.drop_column("customers", "staff_name")
    op.drop_column("customers", "staff_code")
