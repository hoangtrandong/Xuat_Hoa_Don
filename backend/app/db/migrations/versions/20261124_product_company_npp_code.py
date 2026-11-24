"""add npp_code column to product_companies for per-MST internal NPP mapping

Revision ID: 20261124_pc_npp_code
Revises: 20261122_dist_inv_code
"""

import sqlalchemy as sa
from alembic import op


revision = "20261124_pc_npp_code"
down_revision = "20261122_dist_inv_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "product_companies" not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns("product_companies")}
    if "npp_code" not in columns:
        op.add_column(
            "product_companies",
            sa.Column("npp_code", sa.String(length=50), nullable=True),
        )
        if bind.dialect.name == "postgresql":
            op.execute(
                """
                UPDATE product_companies pc
                SET npp_code = UPPER(TRIM(p.npp_code))
                FROM products p
                WHERE pc.product_id = p.id
                  AND pc.npp_code IS NULL
                  AND p.npp_code IS NOT NULL
                  AND TRIM(p.npp_code) <> ''
                """
            )
            op.execute(
                "CREATE INDEX IF NOT EXISTS ix_product_companies_npp_code_upper "
                "ON product_companies (UPPER(npp_code))"
            )
        else:
            op.execute(
                """
                UPDATE product_companies
                SET npp_code = (
                    SELECT UPPER(TRIM(p.npp_code))
                    FROM products p
                    WHERE p.id = product_companies.product_id
                      AND p.npp_code IS NOT NULL
                      AND TRIM(p.npp_code) <> ''
                )
                WHERE npp_code IS NULL
                """
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "product_companies" not in set(inspector.get_table_names()):
        return
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_product_companies_npp_code_upper")
    columns = {column["name"] for column in inspector.get_columns("product_companies")}
    if "npp_code" in columns:
        op.drop_column("product_companies", "npp_code")
