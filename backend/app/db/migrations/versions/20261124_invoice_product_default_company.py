"""add default_company_id to invoice_products for BY_PRODUCT company routing

Revision ID: 20261124_inv_prod_company
Revises: 20261124_inv_prod_hub
"""

import sqlalchemy as sa
from alembic import op


revision = "20261124_inv_prod_company"
down_revision = "20261124_inv_prod_hub"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "invoice_products" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("invoice_products")}
    if "default_company_id" not in cols:
        op.add_column(
            "invoice_products",
            sa.Column("default_company_id", sa.Integer(), nullable=True),
        )
        op.create_index(
            "ix_invoice_products_default_company_id",
            "invoice_products",
            ["default_company_id"],
        )
        if bind.dialect.name == "postgresql":
            op.create_foreign_key(
                "fk_invoice_products_default_company_id",
                "invoice_products",
                "companies",
                ["default_company_id"],
                ["id"],
                ondelete="SET NULL",
            )

        # Backfill default_company_id từ distributor_products hoặc product_companies nếu có
        if "distributor_products" in tables:
            op.execute(
                """
                UPDATE invoice_products
                SET default_company_id = (
                    SELECT dp.company_id
                    FROM distributor_products dp
                    WHERE dp.invoice_product_id = invoice_products.id
                      AND dp.company_id IS NOT NULL
                    ORDER BY dp.id ASC
                    LIMIT 1
                )
                WHERE default_company_id IS NULL
                """
            )
        if "products" in tables and "product_companies" in tables:
            op.execute(
                """
                UPDATE invoice_products
                SET default_company_id = (
                    SELECT pc.company_id
                    FROM products p
                    JOIN product_companies pc ON pc.product_id = p.id
                    WHERE p.invoice_product_id = invoice_products.id
                    ORDER BY pc.is_primary DESC, pc.total_purchased_qty DESC, pc.id ASC
                    LIMIT 1
                )
                WHERE default_company_id IS NULL
                """
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "invoice_products" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("invoice_products")}
    if "default_company_id" in cols:
        op.drop_column("invoice_products", "default_company_id")
