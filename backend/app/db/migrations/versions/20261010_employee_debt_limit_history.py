"""record employee debt limit changes

Revision ID: 20261010_employee_debt_limit_history
Revises: 20261010_employee_debt_limit_500m
"""
from alembic import op
import sqlalchemy as sa


revision = "20261010_employee_debt_limit_history"
down_revision = "20261010_employee_debt_limit_500m"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employee_debt_limit_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("employee_code", sa.String(20), nullable=False),
        sa.Column("old_limit", sa.Numeric(14, 2), nullable=False),
        sa.Column("new_limit", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("changed_by", sa.String(120), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_employee_debt_limit_changes_employee_id",
        "employee_debt_limit_changes",
        ["employee_id"],
    )
    op.create_index(
        "ix_employee_debt_limit_changes_employee_code",
        "employee_debt_limit_changes",
        ["employee_code"],
    )
    op.create_index(
        "ix_employee_debt_limit_changes_changed_at",
        "employee_debt_limit_changes",
        ["changed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_employee_debt_limit_changes_changed_at", table_name="employee_debt_limit_changes")
    op.drop_index("ix_employee_debt_limit_changes_employee_code", table_name="employee_debt_limit_changes")
    op.drop_index("ix_employee_debt_limit_changes_employee_id", table_name="employee_debt_limit_changes")
    op.drop_table("employee_debt_limit_changes")
