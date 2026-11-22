"""Add distributor_id tenant isolation to distributor_products

Revision ID: 20261123_step1_tenant
Revises: 20261122_dist_inv_code
Create Date: 2026-11-23 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20261123_step1_tenant"
down_revision = "20261122_dist_inv_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "distributor_products" not in inspector.get_table_names():
        return

    cols = {c["name"] for c in inspector.get_columns("distributor_products")}
    if "distributor_id" not in cols:
        op.add_column(
            "distributor_products",
            sa.Column(
                "distributor_id",
                sa.Integer(),
                sa.ForeignKey("distributors.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_distributor_products_distributor_id",
            "distributor_products",
            ["distributor_id"],
            unique=False,
        )

    if bind.dialect.name == "postgresql":
        op.execute(
            "ALTER TABLE distributor_products DROP CONSTRAINT IF EXISTS uq_distributor_products_sku_company"
        )
        op.execute(
            "DROP INDEX IF EXISTS uq_distributor_products_sku_company_notnull"
        )
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_distributor_products_dist_sku_company_notnull "
            "ON distributor_products (distributor_id, distributor_sku, company_id) "
            "WHERE distributor_id IS NOT NULL AND company_id IS NOT NULL"
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "distributor_products" not in inspector.get_table_names():
        return
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS uq_distributor_products_dist_sku_company_notnull")
    cols = {c["name"] for c in inspector.get_columns("distributor_products")}
    if "distributor_id" in cols:
        op.drop_index("ix_distributor_products_distributor_id", table_name="distributor_products")
        op.drop_column("distributor_products", "distributor_id")
