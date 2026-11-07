"""store reward products in AND columns and OR alternatives

Revision ID: 20261107_promotion_reward_groups
Revises: 20261107_promotion_reward_operator
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_reward_groups"
down_revision = "20261107_promotion_reward_operator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "promotion_rule_reward_products",
        sa.Column("group_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        sa.text(
            """
            UPDATE promotion_rule_reward_products
            SET group_index = CASE
                WHEN (
                    SELECT reward_product_operator
                    FROM promotion_rules
                    WHERE promotion_rules.id = promotion_rule_reward_products.promotion_rule_id
                ) = 'OR' THEN 0
                ELSE (
                    SELECT COUNT(*)
                    FROM promotion_rule_reward_products AS previous
                    WHERE previous.promotion_rule_id = promotion_rule_reward_products.promotion_rule_id
                      AND previous.product_id < promotion_rule_reward_products.product_id
                )
            END
            """
        )
    )


def downgrade() -> None:
    op.drop_column("promotion_rule_reward_products", "group_index")
