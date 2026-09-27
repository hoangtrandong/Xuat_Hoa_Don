"""user security hardening: forced password change, login lockout, audit log

Revision ID: 20260929_user_security
Revises: 20260928_supplier_discrepancies
"""
from alembic import op
import sqlalchemy as sa


revision = "20260929_user_security"
down_revision = "20260928_supplier_discrepancies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default=false để KHÔNG khóa buộc đổi mật khẩu các tài khoản đang hoạt động sẵn có
    # (kể cả admin đã đăng nhập từ trước migration này). Tài khoản MỚI tạo sau này sẽ có
    # must_change_password=True do giá trị mặc định phía Python trong model User.
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("failed_login_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("locked_until", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_username", sa.String(length=50), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("resource", sa.String(length=40), nullable=False),
        sa.Column("resource_id", sa.String(length=40), nullable=True),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audit_logs_resource", "audit_logs", ["resource", "resource_id"])
    op.create_index("ix_audit_logs_actor", "audit_logs", ["actor_user_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor", table_name="audit_logs")
    op.drop_index("ix_audit_logs_resource", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_attempts")
    op.drop_column("users", "must_change_password")
