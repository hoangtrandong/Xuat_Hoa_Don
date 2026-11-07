"""add upper bounds to promotion rules

Revision ID: 20261107_promotion_rule_ranges
Revises: 20261107_promotion_layout_fields
"""

from alembic import op
import sqlalchemy as sa


revision = "20261107_promotion_rule_ranges"
down_revision = "20261107_promotion_layout_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("promotion_rules", sa.Column("max_quantity", sa.Integer(), nullable=True))
    op.add_column("promotion_rules", sa.Column("max_amount", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("promotion_rules", "max_amount")
    op.drop_column("promotion_rules", "max_quantity")
