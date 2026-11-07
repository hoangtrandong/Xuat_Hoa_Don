"""add and-or operator for promotion reward products

Revision ID: 20261107_promotion_reward_operator
Revises: 20261107_promotion_reward_products
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_reward_operator"
down_revision = "20261107_promotion_reward_products"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "promotion_rules",
        sa.Column("reward_product_operator", sa.String(length=3), nullable=False, server_default="AND"),
    )


def downgrade() -> None:
    op.drop_column("promotion_rules", "reward_product_operator")
