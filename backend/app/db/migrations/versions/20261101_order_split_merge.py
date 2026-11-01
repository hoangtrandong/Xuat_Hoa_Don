"""add split and merge order support to vinamilk snapshots and replacements

Revision ID: 20261101_order_split_merge
Revises: 20261101_store_route
"""

from alembic import op
import sqlalchemy as sa


revision = "20261101_order_split_merge"
down_revision = "20261101_store_route"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vinamilk_order_snapshots",
        sa.Column("processing_status", sa.String(length=40), nullable=True),
    )
    op.add_column(
        "vinamilk_order_snapshots",
        sa.Column("is_synthetic", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "vinamilk_order_replacements",
        sa.Column("replacement_type", sa.String(length=20), nullable=False, server_default="MANUAL"),
    )
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("vinamilk_order_replacements") as batch_op:
            batch_op.alter_column(
                "replaced_order_number",
                existing_type=sa.String(length=120),
                type_=sa.String(length=1000),
                existing_nullable=False,
            )
    else:
        op.alter_column(
            "vinamilk_order_replacements",
            "replaced_order_number",
            existing_type=sa.String(length=120),
            type_=sa.String(length=1000),
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("vinamilk_order_replacements") as batch_op:
            batch_op.alter_column(
                "replaced_order_number",
                existing_type=sa.String(length=1000),
                type_=sa.String(length=120),
                existing_nullable=False,
            )
    else:
        op.alter_column(
            "vinamilk_order_replacements",
            "replaced_order_number",
            existing_type=sa.String(length=1000),
            type_=sa.String(length=120),
            existing_nullable=False,
        )
    op.drop_column("vinamilk_order_replacements", "replacement_type")
    op.drop_column("vinamilk_order_snapshots", "is_synthetic")
    op.drop_column("vinamilk_order_snapshots", "processing_status")
