"""support multiple tax authority accounts per distributor

Revision ID: 20261118_multiple_tax_accounts
Revises: 20261114_multi_tenant_einvoice
"""

import sqlalchemy as sa
from alembic import op


revision = "20261118_multiple_tax_accounts"
down_revision = "20261114_multi_tenant_einvoice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "tax_authority_credentials" not in table_names or "purchase_invoices" not in table_names:
        return

    for constraint in inspector.get_unique_constraints("tax_authority_credentials"):
        if constraint.get("column_names") == ["distributor_id"]:
            op.drop_constraint(constraint["name"], "tax_authority_credentials", type_="unique")

    credential_columns = inspector.get_unique_constraints("tax_authority_credentials")
    if not any(
        constraint.get("column_names") == ["distributor_id", "username"]
        for constraint in credential_columns
    ):
        op.create_unique_constraint(
            "uq_tax_credential_distributor_username",
            "tax_authority_credentials",
            ["distributor_id", "username"],
        )

    purchase_columns = {column["name"] for column in inspector.get_columns("purchase_invoices")}
    if "tax_credential_id" not in purchase_columns:
        op.add_column(
            "purchase_invoices",
            sa.Column("tax_credential_id", sa.Integer(), nullable=True),
        )
        op.execute(
            """
            UPDATE purchase_invoices AS pi
            SET tax_credential_id = tac.id
            FROM tax_authority_credentials AS tac
            WHERE pi.tax_credential_id IS NULL
              AND pi.distributor_id = tac.distributor_id
            """
        )
        op.create_foreign_key(
            "fk_purchase_invoice_tax_credential",
            "purchase_invoices",
            "tax_authority_credentials",
            ["tax_credential_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(
            "ix_purchase_invoices_tax_credential_id",
            "purchase_invoices",
            ["tax_credential_id"],
        )

    for constraint in inspector.get_unique_constraints("purchase_invoices"):
        columns = constraint.get("column_names") or []
        if columns == [
            "distributor_id",
            "seller_tax_code",
            "invoice_template",
            "invoice_symbol",
            "invoice_number",
        ]:
            op.drop_constraint(constraint["name"], "purchase_invoices", type_="unique")

    updated_constraints = sa.inspect(bind).get_unique_constraints("purchase_invoices")
    if not any(
        constraint.get("column_names")
        == [
            "distributor_id",
            "tax_credential_id",
            "seller_tax_code",
            "invoice_template",
            "invoice_symbol",
            "invoice_number",
        ]
        for constraint in updated_constraints
    ):
        op.create_unique_constraint(
            "uq_purchase_invoice_identity",
            "purchase_invoices",
            [
                "distributor_id",
                "tax_credential_id",
                "seller_tax_code",
                "invoice_template",
                "invoice_symbol",
                "invoice_number",
            ],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "purchase_invoices" not in set(inspector.get_table_names()):
        return

    op.drop_constraint("uq_purchase_invoice_identity", "purchase_invoices", type_="unique")
    op.create_unique_constraint(
        "uq_purchase_invoice_identity",
        "purchase_invoices",
        [
            "distributor_id",
            "seller_tax_code",
            "invoice_template",
            "invoice_symbol",
            "invoice_number",
        ],
    )
    op.drop_constraint(
        "fk_purchase_invoice_tax_credential", "purchase_invoices", type_="foreignkey"
    )
    op.drop_index(
        "ix_purchase_invoices_tax_credential_id", table_name="purchase_invoices"
    )
    op.drop_column("purchase_invoices", "tax_credential_id")
    op.drop_constraint(
        "uq_tax_credential_distributor_username",
        "tax_authority_credentials",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_tax_credential_distributor",
        "tax_authority_credentials",
        ["distributor_id"],
    )
