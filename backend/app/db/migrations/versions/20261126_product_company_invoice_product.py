"""add invoice_product_id to product_companies for per-MST invoice product mapping

Revision ID: 20261126_pc_inv_prod
Revises: 20261124_norm_vnm_cust
"""

import sqlalchemy as sa
from alembic import op


revision = "20261126_pc_inv_prod"
down_revision = "20261124_norm_vnm_cust"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "product_companies" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("product_companies")}
    if "invoice_product_id" not in cols:
        op.add_column(
            "product_companies",
            sa.Column("invoice_product_id", sa.Integer(), nullable=True),
        )

    existing_indexes = {ix["name"] for ix in inspector.get_indexes("product_companies")}
    if "ix_product_companies_invoice_product_id" not in existing_indexes:
        op.create_index(
            "ix_product_companies_invoice_product_id",
            "product_companies",
            ["invoice_product_id"],
        )
    if "ix_product_companies_company_ip" not in existing_indexes:
        op.create_index(
            "ix_product_companies_company_ip",
            "product_companies",
            ["company_id", "invoice_product_id"],
        )

    if bind.dialect.name == "postgresql":
        existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("product_companies")}
        if "fk_product_companies_invoice_product_id" not in existing_fks:
            op.create_foreign_key(
                "fk_product_companies_invoice_product_id",
                "product_companies",
                "invoice_products",
                ["invoice_product_id"],
                ["id"],
                ondelete="SET NULL",
            )

    # Backfill: kế thừa invoice_product_id từ bảng products sang các dòng product_companies hiện có
    if "products" in tables:
        prod_cols = {c["name"] for c in inspector.get_columns("products")}
        if "invoice_product_id" in prod_cols:
            bind.execute(
                sa.text(
                    """
                    UPDATE product_companies
                    SET invoice_product_id = (
                        SELECT p.invoice_product_id
                        FROM products p
                        WHERE p.id = product_companies.product_id
                    )
                    WHERE invoice_product_id IS NULL
                      AND EXISTS (
                        SELECT 1
                        FROM products p
                        WHERE p.id = product_companies.product_id
                          AND p.invoice_product_id IS NOT NULL
                      )
                    """
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "product_companies" not in tables:
        return

    if bind.dialect.name == "postgresql":
        existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("product_companies")}
        if "fk_product_companies_invoice_product_id" in existing_fks:
            op.drop_constraint(
                "fk_product_companies_invoice_product_id",
                "product_companies",
                type_="foreignkey",
            )

    existing_indexes = {ix["name"] for ix in inspector.get_indexes("product_companies")}
    if "ix_product_companies_company_ip" in existing_indexes:
        op.drop_index("ix_product_companies_company_ip", table_name="product_companies")
    if "ix_product_companies_invoice_product_id" in existing_indexes:
        op.drop_index("ix_product_companies_invoice_product_id", table_name="product_companies")

    cols = {c["name"] for c in inspector.get_columns("product_companies")}
    if "invoice_product_id" in cols:
        op.drop_column("product_companies", "invoice_product_id")
