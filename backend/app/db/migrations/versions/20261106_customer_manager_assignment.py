"""add customer manager assignment

Revision ID: 20261106_customer_manager_assignment
Revises: 20261105_delivery_request_approval
"""

from alembic import op
import sqlalchemy as sa


revision = "20261106_customer_manager_assignment"
down_revision = "20261105_delivery_request_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("customers")}
    if "manager_code" not in columns:
        op.add_column("customers", sa.Column("manager_code", sa.String(length=50), nullable=True))
        op.create_index("ix_customers_manager_code", "customers", ["manager_code"])
    if "manager_name" not in columns:
        op.add_column("customers", sa.Column("manager_name", sa.String(length=160), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("customers")}
    if "manager_name" in columns:
        op.drop_column("customers", "manager_name")
    if "manager_code" in columns:
        op.drop_index("ix_customers_manager_code", table_name="customers")
        op.drop_column("customers", "manager_code")
