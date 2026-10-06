"""track Vinamilk order replacements and supported order states

Revision ID: 20261006_vnm_replacements
Revises: 20260929_user_security
"""
from alembic import op
import sqlalchemy as sa


revision = "20261006_vnm_replacements"
down_revision = "20260929_user_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vinamilk_order_snapshots",
        sa.Column("warehouse_updated", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "vinamilk_order_snapshots",
        sa.Column("returned", sa.Boolean(), nullable=True),
    )
    op.create_table(
        "vinamilk_order_replacements",
        sa.Column("new_order_number", sa.String(length=120), primary_key=True),
        sa.Column("replaced_order_number", sa.String(length=120), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_vinamilk_order_replacements_replaced_order_number",
        "vinamilk_order_replacements",
        ["replaced_order_number"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_vinamilk_order_replacements_replaced_order_number",
        table_name="vinamilk_order_replacements",
    )
    op.drop_table("vinamilk_order_replacements")
    op.drop_column("vinamilk_order_snapshots", "returned")
    op.drop_column("vinamilk_order_snapshots", "warehouse_updated")
