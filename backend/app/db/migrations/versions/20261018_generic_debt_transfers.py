"""Support immediate debt transfers between employees and stores.

Revision ID: 20261018_generic_debt_transfers
Revises: 20261017_employee_day_bank_allocations
"""

from alembic import op
import sqlalchemy as sa


revision = "20261018_generic_debt_transfers"
down_revision = "20261017_employee_day_bank_allocations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("debt_transfers", sa.Column("from_party_type", sa.String(20), nullable=True))
    op.add_column("debt_transfers", sa.Column("from_party_id", sa.Integer(), nullable=True))
    op.add_column("debt_transfers", sa.Column("to_party_type", sa.String(20), nullable=True))
    op.add_column("debt_transfers", sa.Column("to_party_id", sa.Integer(), nullable=True))

    op.execute(
        sa.text(
            "UPDATE debt_transfers "
            "SET from_party_type = 'EMPLOYEE', from_party_id = from_employee_id, "
            "to_party_type = 'STORE', to_party_id = to_store_id"
        )
    )
    op.execute(
        sa.text("UPDATE debt_transfers SET status = 'COMPLETED' WHERE status = 'APPROVED'")
    )

    with op.batch_alter_table("debt_transfers") as batch_op:
        batch_op.alter_column("from_party_type", existing_type=sa.String(20), nullable=False)
        batch_op.alter_column("from_party_id", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("to_party_type", existing_type=sa.String(20), nullable=False)
        batch_op.alter_column("to_party_id", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("from_employee_id", existing_type=sa.Integer(), nullable=True)
        batch_op.alter_column("to_store_id", existing_type=sa.Integer(), nullable=True)
        batch_op.create_index("ix_debt_transfers_from_party_type", ["from_party_type"])
        batch_op.create_index("ix_debt_transfers_from_party_id", ["from_party_id"])
        batch_op.create_index("ix_debt_transfers_to_party_type", ["to_party_type"])
        batch_op.create_index("ix_debt_transfers_to_party_id", ["to_party_id"])


def downgrade() -> None:
    with op.batch_alter_table("debt_transfers") as batch_op:
        batch_op.drop_index("ix_debt_transfers_to_party_id")
        batch_op.drop_index("ix_debt_transfers_to_party_type")
        batch_op.drop_index("ix_debt_transfers_from_party_id")
        batch_op.drop_index("ix_debt_transfers_from_party_type")
        batch_op.alter_column("from_employee_id", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("to_store_id", existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column("to_party_id")
        batch_op.drop_column("to_party_type")
        batch_op.drop_column("from_party_id")
        batch_op.drop_column("from_party_type")
