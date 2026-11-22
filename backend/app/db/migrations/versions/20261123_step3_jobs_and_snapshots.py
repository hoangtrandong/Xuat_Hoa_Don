"""Create background_jobs and tax_inventory_monthly_snapshots tables

Revision ID: 20261123_step3_jobs_snap
Revises: 20261123_step1_tenant
Create Date: 2026-11-23 00:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20261123_step3_jobs_snap"
down_revision = "20261123_step1_tenant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "background_jobs" not in existing_tables:
        op.create_table(
            "background_jobs",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("job_type", sa.String(60), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
            sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("current_step", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_steps", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("items_json", sa.JSON(), nullable=False),
            sa.Column("logs_json", sa.JSON(), nullable=False),
            sa.Column("result_summary_json", sa.JSON(), nullable=True),
            sa.Column("error_detail", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_background_jobs_status", "background_jobs", ["status"])
        op.create_index("ix_background_jobs_updated_at", "background_jobs", ["updated_at"])

    if "tax_inventory_monthly_snapshots" not in existing_tables:
        op.create_table(
            "tax_inventory_monthly_snapshots",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "distributor_id",
                sa.Integer(),
                sa.ForeignKey("distributors.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("tax_code", sa.String(40), nullable=False),
            sa.Column("company_name", sa.String(255), nullable=False, server_default=""),
            sa.Column("sku", sa.String(100), nullable=False),
            sa.Column("product_name", sa.String(500), nullable=False, server_default=""),
            sa.Column("unit_name", sa.String(60), nullable=False, server_default=""),
            sa.Column("year_month", sa.String(7), nullable=False),
            sa.Column("opening_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("opening_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
            sa.Column("input_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("input_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
            sa.Column("output_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("output_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
            sa.Column("promo_in_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("promo_out_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("avg_unit_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
            sa.Column("cogs_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
            sa.Column("closing_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("closing_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
            sa.Column("computed_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "distributor_id",
                "tax_code",
                "sku",
                "year_month",
                name="uq_tax_inv_monthly_snapshot_key",
            ),
        )
        op.create_index("ix_tax_inv_monthly_dist_ym", "tax_inventory_monthly_snapshots", ["distributor_id", "year_month"])
        op.create_index("ix_tax_inv_monthly_tax_code", "tax_inventory_monthly_snapshots", ["tax_code"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "tax_inventory_monthly_snapshots" in existing_tables:
        op.drop_table("tax_inventory_monthly_snapshots")
    if "background_jobs" in existing_tables:
        op.drop_table("background_jobs")
