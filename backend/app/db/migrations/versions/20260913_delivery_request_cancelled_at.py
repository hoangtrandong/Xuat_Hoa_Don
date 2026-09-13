"""add cancelled_at to delivery requests

Revision ID: 20260913_cancelled
Revises: 20260912_stores_companies
Create Date: 2026-09-13 18:58:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260913_cancelled'
down_revision = '20260912_stores_companies'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('delivery_requests', sa.Column('cancelled_at', sa.DateTime(), nullable=True))

def downgrade() -> None:
    op.drop_column('delivery_requests', 'cancelled_at')
