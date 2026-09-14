"""add document date to inventory transactions

Revision ID: 20260914_document_date
Revises: 20260913_cancelled
Create Date: 2026-09-14 23:35:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "20260914_document_date"
down_revision = "20260913_cancelled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_transactions", sa.Column("document_date", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("inventory_transactions", "document_date")
