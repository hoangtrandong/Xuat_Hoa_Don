"""add vinamilk credentials table for admin-managed DMS login

Revision ID: 20261111_vinamilk_credentials
Revises: 20261108_promotion_stores
"""

from alembic import op
import sqlalchemy as sa


revision = "20261111_vinamilk_credentials"
down_revision = "20261108_promotion_stores"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vinamilk_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(length=120), nullable=False),
        sa.Column("encrypted_password", sa.Text(), nullable=False),
        sa.Column("session_cookie", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.String(length=120), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("vinamilk_credentials")
