"""add vinamilk order split requests table for accountant approval

Revision ID: 20261103_split_order_requests
Revises: 20261102_order_performed_by
"""

from alembic import op
import sqlalchemy as sa


revision = "20261103_split_order_requests"
down_revision = "20261102_order_performed_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vinamilk_order_split_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_order_number", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("requested_by", sa.String(length=120), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_by", sa.String(length=120), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("request_payload", sa.JSON(), nullable=False),
        sa.Column("preview_data", sa.JSON(), nullable=False),
        sa.Column("result_order_numbers", sa.JSON(), nullable=True),
    )
    op.create_index(
        "ix_vnm_split_req_source_order",
        "vinamilk_order_split_requests",
        ["source_order_number"],
    )
    op.create_index(
        "ix_vnm_split_req_status",
        "vinamilk_order_split_requests",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_vnm_split_req_status", table_name="vinamilk_order_split_requests")
    op.drop_index("ix_vnm_split_req_source_order", table_name="vinamilk_order_split_requests")
    op.drop_table("vinamilk_order_split_requests")
