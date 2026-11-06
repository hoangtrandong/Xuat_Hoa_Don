"""expand promotions for order entry and management

Revision ID: 20261107_promotion_management
Revises: 20261106_customer_manager_assignment
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_management"
down_revision = "20261106_customer_manager_assignment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("promotions", sa.Column("code", sa.String(length=40), nullable=True))
    op.add_column(
        "promotions",
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE promotions SET code = 'KM-OLD-' || id WHERE code IS NULL")
    op.alter_column("promotions", "code", nullable=False)
    op.create_index("ix_promotions_code", "promotions", ["code"], unique=True)

    op.add_column(
        "promotion_rules",
        sa.Column("trigger_type", sa.String(length=20), nullable=False, server_default="CARTON"),
    )
    op.add_column("promotion_rules", sa.Column("min_cartons", sa.Integer(), nullable=True))
    op.add_column("promotion_rules", sa.Column("min_amount", sa.Float(), nullable=True))
    op.add_column(
        "promotion_rules",
        sa.Column("free_quantity", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "promotion_rules",
        sa.Column("reward_type", sa.String(length=30), nullable=False, server_default="DISCOUNT_AMOUNT"),
    )
    op.add_column(
        "promotion_rules",
        sa.Column("reward_value", sa.Float(), nullable=False, server_default="0"),
    )
    op.execute(
        "UPDATE promotion_rules SET min_cartons = CASE WHEN min_qty > 0 THEN min_qty ELSE 1 END"
    )
    op.execute(
        "UPDATE promotion_rules SET reward_type = CASE "
        "WHEN discount_percent > 0 THEN 'DISCOUNT_PERCENT' ELSE 'DISCOUNT_AMOUNT' END, "
        "reward_value = CASE WHEN discount_percent > 0 THEN discount_percent ELSE discount_amount END"
    )


def downgrade() -> None:
    op.drop_column("promotion_rules", "reward_value")
    op.drop_column("promotion_rules", "reward_type")
    op.drop_column("promotion_rules", "free_quantity")
    op.drop_column("promotion_rules", "min_amount")
    op.drop_column("promotion_rules", "min_cartons")
    op.drop_column("promotion_rules", "trigger_type")
    op.drop_index("ix_promotions_code", table_name="promotions")
    op.drop_column("promotions", "is_locked")
    op.drop_column("promotions", "code")
