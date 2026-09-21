"""store manual company allocations for Vinamilk order lines

Revision ID: 20260921_vinamilk_allocations
Revises: 20260920_group_company_codes
"""
from alembic import op
import sqlalchemy as sa

revision = "20260921_vinamilk_allocations"
down_revision = "20260920_group_company_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vinamilk_order_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("snapshot_id", sa.Integer(), sa.ForeignKey("vinamilk_order_snapshots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_number", sa.String(length=120), nullable=False),
        sa.Column("line_key", sa.String(length=120)),
        sa.Column("product_code", sa.String(length=120), nullable=False),
        sa.Column("allocated_quantity", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("company_code", sa.String(length=40), nullable=False),
        sa.Column("company_name", sa.String(length=200), nullable=False),
        sa.Column("distributor_sku", sa.String(length=50)),
        sa.Column("allocation_method", sa.String(length=30), nullable=False, server_default="MANUAL_UPLOAD"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="CONFIRMED"),
        sa.Column("source_file", sa.String(length=255)),
        sa.Column("uploaded_by", sa.String(length=120)),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.UniqueConstraint("snapshot_id", "company_id", name="uq_vnm_allocation_snapshot_company"),
    )
    op.create_index("ix_vnm_allocation_company", "vinamilk_order_allocations", ["company_id"])
    op.create_index("ix_vnm_allocation_status", "vinamilk_order_allocations", ["status"])


def downgrade() -> None:
    op.drop_index("ix_vnm_allocation_status", table_name="vinamilk_order_allocations")
    op.drop_index("ix_vnm_allocation_company", table_name="vinamilk_order_allocations")
    op.drop_table("vinamilk_order_allocations")