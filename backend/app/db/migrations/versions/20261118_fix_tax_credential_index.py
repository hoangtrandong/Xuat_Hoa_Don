"""remove the legacy one-account-per-distributor unique index

Revision ID: 20261118_fix_tax_index
Revises: 20261118_multiple_tax_accounts
"""

import sqlalchemy as sa
from alembic import op


revision = "20261118_fix_tax_index"
down_revision = "20261118_multiple_tax_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "tax_authority_credentials" not in set(inspector.get_table_names()):
        return

    for index in inspector.get_indexes("tax_authority_credentials"):
        if index.get("unique") and index.get("column_names") == ["distributor_id"]:
            op.drop_index(index["name"], table_name="tax_authority_credentials")
            op.create_index(
                index["name"],
                "tax_authority_credentials",
                ["distributor_id"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "tax_authority_credentials" not in set(inspector.get_table_names()):
        return

    for index in inspector.get_indexes("tax_authority_credentials"):
        if (
            not index.get("unique")
            and index.get("column_names") == ["distributor_id"]
        ):
            op.drop_index(index["name"], table_name="tax_authority_credentials")
            op.create_index(
                index["name"],
                "tax_authority_credentials",
                ["distributor_id"],
                unique=True,
            )
