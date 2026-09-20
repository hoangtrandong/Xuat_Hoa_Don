"""add equivalent SKU groups and product company links

Revision ID: 20260920_product_groups
Revises: 20260916_delivery_plan
"""
from alembic import op
import sqlalchemy as sa


revision = "20260920_product_groups"
down_revision = "20260916_delivery_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("representative_product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("status", sa.String(length=15), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "product_group_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_group_id", sa.Integer(), sa.ForeignKey("product_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversion_factor", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("product_id", name="uq_product_group_items_product"),
    )
    op.create_table(
        "product_companies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="MANAGER"),
        sa.Column("company_product_code", sa.String(length=50), nullable=True),
        sa.Column("status", sa.String(length=15), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("product_id", "company_id", name="uq_product_companies_product_company"),
    )
    op.create_table(
        "product_group_companies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_group_id", sa.Integer(), sa.ForeignKey("product_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="MANAGER"),
        sa.Column("status", sa.String(length=15), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("product_group_id", "company_id", name="uq_product_group_companies_group_company"),
    )


def downgrade() -> None:
    op.drop_table("product_group_companies")
    op.drop_table("product_companies")
    op.drop_table("product_group_items")
    op.drop_table("product_groups")
