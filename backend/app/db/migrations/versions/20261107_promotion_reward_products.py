"""allow multiple reward products per promotion rule

Revision ID: 20261107_promotion_reward_products
Revises: 20261107_promotion_rule_ranges
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_reward_products"
down_revision = "20261107_promotion_rule_ranges"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "promotion_rule_reward_products",
        sa.Column("promotion_rule_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["promotion_rule_id"], ["promotion_rules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("promotion_rule_id", "product_id"),
    )
    op.execute(
        "INSERT INTO promotion_rule_reward_products (promotion_rule_id, product_id) "
        "SELECT id, reward_product_id FROM promotion_rules WHERE reward_product_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_table("promotion_rule_reward_products")
