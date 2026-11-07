"""support carton/box quantities in promotion rules

Revision ID: 20261107_promotion_quantity_units
Revises: 20261107_promotion_management
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_quantity_units"
down_revision = "20261107_promotion_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("promotion_rules", sa.Column("min_quantity", sa.Integer(), nullable=True))
    op.add_column(
        "promotion_rules",
        sa.Column("quantity_unit", sa.String(length=10), nullable=False, server_default="CARTON"),
    )
    op.add_column(
        "promotion_rules",
        sa.Column("reward_unit", sa.String(length=10), nullable=False, server_default="BOX"),
    )
    op.execute(
        "UPDATE promotion_rules "
        "SET min_quantity = COALESCE(min_cartons, min_qty, 1) "
        "WHERE trigger_type = 'CARTON'"
    )
    op.execute(
        "UPDATE promotion_rules SET trigger_type = 'QUANTITY' WHERE trigger_type = 'CARTON'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE promotion_rules SET trigger_type = 'CARTON' WHERE trigger_type = 'QUANTITY'"
    )
    op.drop_column("promotion_rules", "reward_unit")
    op.drop_column("promotion_rules", "quantity_unit")
    op.drop_column("promotion_rules", "min_quantity")
