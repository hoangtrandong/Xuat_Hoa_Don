"""add sku vat_rate, issued_invoice seller_tax_code and adjustment/replacement columns

Revision ID: 20261121_vat_tax_ledger_adjustment
Revises: 20261121_company_sku_invoice_rules
"""

import sqlalchemy as sa
from alembic import op


revision = "20261121_vat_tax_ledger_adjustment"
down_revision = "20261121_company_sku_invoice_rules"
branch_labels = None
depends_on = None


def _add_column_if_missing(inspector, table_name: str, column: sa.Column) -> None:
    if table_name not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns(table_name)}
    if column.name not in cols:
        op.add_column(table_name, column)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _add_column_if_missing(inspector, "products", sa.Column("vat_rate", sa.Float(), nullable=True))
    _add_column_if_missing(
        inspector,
        "products",
        sa.Column("vat_rate_source", sa.String(20), nullable=True, server_default="MANUAL"),
    )

    _add_column_if_missing(inspector, "issued_invoices", sa.Column("seller_company_id", sa.Integer(), nullable=True))
    _add_column_if_missing(inspector, "issued_invoices", sa.Column("seller_tax_code", sa.String(40), nullable=True))
    _add_column_if_missing(
        inspector,
        "issued_invoices",
        sa.Column("invoice_type", sa.String(20), nullable=False, server_default="ORIGINAL"),
    )
    _add_column_if_missing(inspector, "issued_invoices", sa.Column("parent_invoice_id", sa.Integer(), nullable=True))
    _add_column_if_missing(inspector, "issued_invoices", sa.Column("adjustment_reason", sa.String(500), nullable=True))
    _add_column_if_missing(inspector, "issued_invoices", sa.Column("return_reference", sa.String(120), nullable=True))

    op.execute("CREATE INDEX IF NOT EXISTS ix_issued_invoices_seller_tax ON issued_invoices(seller_tax_code)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_issued_invoices_parent_id ON issued_invoices(parent_invoice_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_issued_invoices_parent_id")
    op.execute("DROP INDEX IF EXISTS ix_issued_invoices_seller_tax")
    for table, col in [
        ("issued_invoices", "return_reference"),
        ("issued_invoices", "adjustment_reason"),
        ("issued_invoices", "parent_invoice_id"),
        ("issued_invoices", "invoice_type"),
        ("issued_invoices", "seller_tax_code"),
        ("issued_invoices", "seller_company_id"),
        ("products", "vat_rate_source"),
        ("products", "vat_rate"),
    ]:
        try:
            op.drop_column(table, col)
        except Exception:
            pass
