"""add promotion targeting and scope fields

Revision ID: 20261107_promotion_eligibility
Revises: 20261107_promotion_quantity_units
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_eligibility"
down_revision = "20261107_promotion_quantity_units"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "promotions",
        sa.Column("promotion_type", sa.String(length=20), nullable=False, server_default="ORDER"),
    )
    op.add_column(
        "promotions",
        sa.Column("target_scope", sa.String(length=20), nullable=False, server_default="ALL"),
    )
    op.add_column("promotions", sa.Column("customer_type", sa.String(length=20), nullable=True))
    op.add_column("promotions", sa.Column("employee_code", sa.String(length=20), nullable=True))
    op.create_index("ix_promotions_employee_code", "promotions", ["employee_code"])
    op.add_column(
        "promotions",
        sa.Column("vat_rate", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "promotions",
        sa.Column("product_scope", sa.String(length=20), nullable=False, server_default="SELECTED"),
    )
    op.add_column("promotions", sa.Column("supplier", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("promotions", "supplier")
    op.drop_column("promotions", "product_scope")
    op.drop_column("promotions", "vat_rate")
    op.drop_index("ix_promotions_employee_code", table_name="promotions")
    op.drop_column("promotions", "employee_code")
    op.drop_column("promotions", "customer_type")
    op.drop_column("promotions", "target_scope")
    op.drop_column("promotions", "promotion_type")
