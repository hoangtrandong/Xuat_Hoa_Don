"""store quantity and unit for each reward product

Revision ID: 20261107_promotion_reward_product_quantity
Revises: 20261107_promotion_reward_groups
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_reward_product_quantity"
down_revision = "20261107_promotion_reward_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "promotion_rule_reward_products",
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "promotion_rule_reward_products",
        sa.Column("unit", sa.String(length=10), nullable=False, server_default="BOX"),
    )
    op.execute(
        sa.text(
            """
            UPDATE promotion_rule_reward_products
            SET quantity = COALESCE(
                    (
                        SELECT CAST(CASE
                            WHEN promotion_rules.reward_value >= 1
                            THEN promotion_rules.reward_value
                            ELSE promotion_rules.free_quantity
                        END AS INTEGER)
                        FROM promotion_rules
                        WHERE promotion_rules.id = promotion_rule_reward_products.promotion_rule_id
                    ),
                    1
                ),
                unit = COALESCE(
                    (
                        SELECT promotion_rules.reward_unit
                        FROM promotion_rules
                        WHERE promotion_rules.id = promotion_rule_reward_products.promotion_rule_id
                    ),
                    'BOX'
                )
            """
        )
    )


def downgrade() -> None:
    op.drop_column("promotion_rule_reward_products", "unit")
    op.drop_column("promotion_rule_reward_products", "quantity")
