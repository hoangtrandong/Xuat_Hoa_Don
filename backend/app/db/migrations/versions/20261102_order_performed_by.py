"""add performed_by column to vinamilk order snapshots and replacements

Revision ID: 20261102_order_performed_by
Revises: 20261101_order_split_merge
"""

from alembic import op
import sqlalchemy as sa


revision = "20261102_order_performed_by"
down_revision = "20261101_order_split_merge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vinamilk_order_snapshots",
        sa.Column("performed_by", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "vinamilk_order_replacements",
        sa.Column("performed_by", sa.String(length=120), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE vinamilk_order_snapshots SET performed_by = 'Hệ thống' "
            "WHERE is_synthetic = false AND performed_by IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_column("vinamilk_order_replacements", "performed_by")
    op.drop_column("vinamilk_order_snapshots", "performed_by")
