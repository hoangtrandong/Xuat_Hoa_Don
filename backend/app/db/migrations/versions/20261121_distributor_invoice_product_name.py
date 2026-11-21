"""add invoice product name to distributor products

Revision ID: 20261121_distributor_invoice_name
Revises: 20261121_vat_tax_ledger_adjustment
"""

import sqlalchemy as sa
from alembic import op


revision = "20261121_distributor_invoice_name"
down_revision = "20261121_vat_tax_ledger_adjustment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "distributor_products" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("distributor_products")}
    if "invoice_product_name" not in columns:
        op.add_column(
            "distributor_products",
            sa.Column("invoice_product_name", sa.String(length=255), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "distributor_products" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("distributor_products")}
    if "invoice_product_name" in columns:
        op.drop_column("distributor_products", "invoice_product_name")
