"""add promotion form and reward product fields

Revision ID: 20261107_promotion_layout_fields
Revises: 20261107_promotion_eligibility
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_layout_fields"
down_revision = "20261107_promotion_eligibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "promotions",
        sa.Column("promotion_kind", sa.String(length=30), nullable=False, server_default="GENERAL"),
    )
    op.add_column(
        "promotions",
        sa.Column("applied_quantity_unit", sa.String(length=20), nullable=False, server_default="STANDARD"),
    )
    op.add_column(
        "promotions",
        sa.Column("minimum_product_quantity", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "promotion_items",
        sa.Column("min_quantity", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "promotion_rules",
        sa.Column("reward_product_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_promotion_rules_reward_product_id_products",
        "promotion_rules",
        "products",
        ["reward_product_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_promotion_rules_reward_product_id_products",
        "promotion_rules",
        type_="foreignkey",
    )
    op.drop_column("promotion_rules", "reward_product_id")
    op.drop_column("promotion_items", "min_quantity")
    op.drop_column("promotions", "minimum_product_quantity")
    op.drop_column("promotions", "applied_quantity_unit")
    op.drop_column("promotions", "promotion_kind")
