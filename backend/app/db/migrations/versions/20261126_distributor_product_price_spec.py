"""add unit_price and boxes_per_carton to distributor_products

Revision ID: 20261126_dp_price_spec
Revises: 20261126_pc_inv_prod
"""

import sqlalchemy as sa
from alembic import op


revision = "20261126_dp_price_spec"
down_revision = "20261126_pc_inv_prod"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "distributor_products" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("distributor_products")}
    if "unit_price" not in cols:
        op.add_column(
            "distributor_products",
            sa.Column("unit_price", sa.Float(), nullable=False, server_default="0"),
        )
    if "boxes_per_carton" not in cols:
        op.add_column(
            "distributor_products",
            sa.Column("boxes_per_carton", sa.Integer(), nullable=False, server_default="1"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "distributor_products" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("distributor_products")}
    if "boxes_per_carton" in cols:
        op.drop_column("distributor_products", "boxes_per_carton")
    if "unit_price" in cols:
        op.drop_column("distributor_products", "unit_price")
