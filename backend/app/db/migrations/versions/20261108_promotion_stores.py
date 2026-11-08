"""Add store targeting to promotions.

Revision ID: 20261108_promotion_stores
Revises: 20261107_promotion_reward_product_quantity
"""

from alembic import op
import sqlalchemy as sa

revision = "20261108_promotion_stores"
down_revision = "20261107_promotion_reward_product_quantity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "promotion_stores",
        sa.Column("promotion_id", sa.Integer(), sa.ForeignKey("promotions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("store_id", sa.Integer(), sa.ForeignKey("stores.id", ondelete="RESTRICT"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("promotion_stores")
