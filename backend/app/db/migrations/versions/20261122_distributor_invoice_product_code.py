"""add invoice_product_code and allow multiple companies per distributor_sku

Revision ID: 20261122_dist_inv_code
Revises: 20261121_distributor_invoice_name, 20261122_tax_opening_balance_and_tchat
"""

import sqlalchemy as sa
from alembic import op


revision = "20261122_dist_inv_code"
down_revision = ("20261121_distributor_invoice_name", "20261122_tax_opening_balance_and_tchat")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "distributor_products" not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns("distributor_products")}
    if "invoice_product_code" not in columns:
        op.add_column(
            "distributor_products",
            sa.Column("invoice_product_code", sa.String(length=60), nullable=True),
        )

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE distributor_products DROP CONSTRAINT IF EXISTS distributor_products_distributor_sku_key")
        op.execute("DROP INDEX IF EXISTS ix_distributor_products_distributor_sku")
        op.execute("CREATE INDEX IF NOT EXISTS ix_distributor_products_distributor_sku ON distributor_products(distributor_sku)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_distributor_products_invoice_code ON distributor_products(invoice_product_code)")
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_distributor_products_sku_company_notnull "
            "ON distributor_products(distributor_sku, company_id) WHERE company_id IS NOT NULL"
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "distributor_products" not in set(inspector.get_table_names()):
        return
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS uq_distributor_products_sku_company_notnull")
        op.execute("DROP INDEX IF EXISTS ix_distributor_products_invoice_code")
    columns = {column["name"] for column in inspector.get_columns("distributor_products")}
    if "invoice_product_code" in columns:
        op.drop_column("distributor_products", "invoice_product_code")
