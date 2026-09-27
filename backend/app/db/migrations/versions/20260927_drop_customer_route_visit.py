"""drop customer phone / route / assigned employee / visit tracking

Revision ID: 20260927_drop_customer_route_visit
Revises: 20260921_vinamilk_allocations

Ghi chú: chỉ áp dụng cho khách hàng (customers). Phone của cửa hàng, công ty
và nhân viên được giữ nguyên.
"""
from alembic import op
import sqlalchemy as sa

revision = "20260927_drop_customer_route_visit"
down_revision = "20260921_vinamilk_allocations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres tự xóa FK constraint nằm trên chính cột bị drop.
    op.drop_column("customers", "route_id")
    op.drop_column("customers", "assigned_employee_id")
    op.drop_column("customers", "visit_frequency")
    op.drop_column("customers", "phone")

    # visits tham chiếu routes -> phải xóa trước.
    op.drop_table("visits")
    op.drop_table("routes")


def downgrade() -> None:
    op.create_table(
        "routes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=10), nullable=False, unique=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("territory_id", sa.Integer(), sa.ForeignKey("sales_territories.id"), nullable=True),
        sa.Column("visit_target", sa.Integer(), nullable=False, server_default="15"),
    )
    op.create_table(
        "visits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id"), nullable=False),
        sa.Column("route_id", sa.Integer(), sa.ForeignKey("routes.id"), nullable=True),
        sa.Column("visit_date", sa.DateTime(), nullable=False),
        sa.Column("checkin_lat", sa.Float(), nullable=True),
        sa.Column("checkin_lng", sa.Float(), nullable=True),
        sa.Column("has_order", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("note", sa.String(length=255), nullable=True),
    )
    op.add_column("customers", sa.Column("phone", sa.String(length=20), nullable=False, server_default=""))
    op.add_column("customers", sa.Column("visit_frequency", sa.Integer(), nullable=False, server_default="2"))
    op.add_column("customers", sa.Column("route_id", sa.Integer(), sa.ForeignKey("routes.id"), nullable=True))
    op.add_column("customers", sa.Column("assigned_employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=True))
