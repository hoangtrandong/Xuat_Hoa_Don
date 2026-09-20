"""store distributor codes per product group and company

Revision ID: 20260920_group_company_codes
Revises: 20260920_vinamilk_orders
"""
from alembic import op
import sqlalchemy as sa

revision = "20260920_group_company_codes"
down_revision = "20260920_vinamilk_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product_group_companies", sa.Column("distributor_sku", sa.String(length=50)))
    op.add_column("product_group_companies", sa.Column("distributor_name", sa.String(length=200)))
    op.execute(sa.text("""
        INSERT INTO product_groups (name, representative_product_id, status, created_at)
        SELECT 'Nhóm ' || p.sku, p.id, 'active', NOW()
        FROM products p
        WHERE NOT EXISTS (
            SELECT 1 FROM product_group_items i WHERE i.product_id = p.id
        )
    """))
    op.execute(sa.text("""
        INSERT INTO product_group_items (product_group_id, product_id, conversion_factor, created_at)
        SELECT g.id, g.representative_product_id, 1, NOW()
        FROM product_groups g
        WHERE NOT EXISTS (
            SELECT 1 FROM product_group_items i WHERE i.product_id = g.representative_product_id
        )
    """))


def downgrade() -> None:
    op.drop_column("product_group_companies", "distributor_name")
    op.drop_column("product_group_companies", "distributor_sku")