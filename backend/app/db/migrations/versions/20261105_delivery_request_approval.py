"""track delivery request approval

Revision ID: 20261105_delivery_request_approval
Revises: 20261104_customer_sales_staff
"""

from alembic import op
import sqlalchemy as sa


revision = "20261105_delivery_request_approval"
down_revision = "20261104_customer_sales_staff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("delivery_requests")}
    if "approved_by" not in columns:
        op.add_column("delivery_requests", sa.Column("approved_by", sa.String(length=120), nullable=True))
    if "approved_at" not in columns:
        op.add_column("delivery_requests", sa.Column("approved_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("delivery_requests")}
    if "approved_at" in columns:
        op.drop_column("delivery_requests", "approved_at")
    if "approved_by" in columns:
        op.drop_column("delivery_requests", "approved_by")
