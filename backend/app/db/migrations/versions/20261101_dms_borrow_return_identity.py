"""Use DMS identities for borrowed goods and persist return offsets.

Revision ID: 20261101_dms_borrow_return_identity
Revises: 20261026_employee_borrowing
"""

from alembic import op
import sqlalchemy as sa


revision = "20261101_dms_borrow_return_identity"
down_revision = "20261026_employee_borrowing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "employee_borrow_entries",
        "employee_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.add_column(
        "employee_borrow_entries",
        sa.Column("external_employee_code", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "employee_borrow_entries",
        sa.Column("external_employee_name", sa.String(length=120), nullable=True),
    )
    op.create_index(
        "ix_employee_borrow_entries_external_employee_code",
        "employee_borrow_entries",
        ["external_employee_code"],
    )
    op.create_check_constraint(
        "ck_employee_borrow_entry_employee_identity",
        "employee_borrow_entries",
        "employee_id IS NOT NULL OR external_employee_code IS NOT NULL",
    )
    op.add_column(
        "delivery_request_items",
        sa.Column("borrowed_employee_offsets", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("delivery_request_items", "borrowed_employee_offsets")
    op.drop_constraint(
        "ck_employee_borrow_entry_employee_identity",
        "employee_borrow_entries",
        type_="check",
    )
    op.drop_index(
        "ix_employee_borrow_entries_external_employee_code",
        table_name="employee_borrow_entries",
    )
    op.drop_column("employee_borrow_entries", "external_employee_name")
    op.drop_column("employee_borrow_entries", "external_employee_code")
    op.alter_column(
        "employee_borrow_entries",
        "employee_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
