"""add sales_manager_codes to distributor_products

Revision ID: 20261127_dp_sales_mgrs
Revises: 20261126_dp_price_spec
"""

import sqlalchemy as sa
from alembic import op


revision = "20261127_dp_sales_mgrs"
down_revision = "20261126_dp_price_spec"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "distributor_products" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("distributor_products")}
    if "sales_manager_codes" not in cols:
        op.add_column(
            "distributor_products",
            sa.Column("sales_manager_codes", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "distributor_products" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("distributor_products")}
    if "sales_manager_codes" in cols:
        op.drop_column("distributor_products", "sales_manager_codes")
