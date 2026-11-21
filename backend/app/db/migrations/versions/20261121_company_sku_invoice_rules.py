"""add company invoice item mode, product internal identity, and product_company uom conversion

Revision ID: 20261121_company_sku_invoice_rules
Revises: 20261118_fix_tax_index
"""

import sqlalchemy as sa
from alembic import op


revision = "20261121_company_sku_invoice_rules"
down_revision = "20261118_fix_tax_index"
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

    _add_column_if_missing(
        inspector,
        "distributors",
        sa.Column("company_allocation_mode", sa.String(30), nullable=False, server_default="BY_CUSTOMER"),
    )

    _add_column_if_missing(inspector, "companies", sa.Column("short_name", sa.String(120), nullable=True))
    _add_column_if_missing(
        inspector,
        "companies",
        sa.Column("invoice_item_mode", sa.String(20), nullable=False, server_default="TAX_INPUT"),
    )
    _add_column_if_missing(
        inspector,
        "companies",
        sa.Column("sync_source", sa.String(20), nullable=False, server_default="MANUAL"),
    )

    _add_column_if_missing(inspector, "products", sa.Column("internal_name", sa.String(255), nullable=True))
    _add_column_if_missing(inspector, "products", sa.Column("internal_unit", sa.String(50), nullable=True))

    _add_column_if_missing(inspector, "product_companies", sa.Column("invoice_name_override", sa.String(255), nullable=True))
    _add_column_if_missing(inspector, "product_companies", sa.Column("invoice_unit_name", sa.String(50), nullable=True))
    _add_column_if_missing(
        inspector,
        "product_companies",
        sa.Column("conversion_num", sa.Integer(), nullable=False, server_default="1"),
    )
    _add_column_if_missing(
        inspector,
        "product_companies",
        sa.Column("conversion_den", sa.Integer(), nullable=False, server_default="1"),
    )
    _add_column_if_missing(
        inspector,
        "product_companies",
        sa.Column("source", sa.String(25), nullable=False, server_default="MANUAL"),
    )
    _add_column_if_missing(
        inspector,
        "product_companies",
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    _add_column_if_missing(inspector, "product_companies", sa.Column("last_purchased_at", sa.DateTime(), nullable=True))
    _add_column_if_missing(
        inspector,
        "product_companies",
        sa.Column("total_purchased_qty", sa.Float(), nullable=False, server_default="0"),
    )

    _add_column_if_missing(inspector, "issued_invoice_items", sa.Column("source_sku", sa.String(80), nullable=True))
    _add_column_if_missing(inspector, "issued_invoice_items", sa.Column("source_quantity", sa.Float(), nullable=True))
    _add_column_if_missing(inspector, "issued_invoice_items", sa.Column("source_unit", sa.String(50), nullable=True))
    _add_column_if_missing(inspector, "issued_invoice_items", sa.Column("conversion_ratio", sa.String(30), nullable=True))

    op.execute("CREATE INDEX IF NOT EXISTS ix_companies_dist_tax ON companies(distributor_id, tax_code)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_product_companies_lookup "
        "ON product_companies(product_id, is_primary DESC, last_purchased_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_product_companies_lookup")
    op.execute("DROP INDEX IF EXISTS ix_companies_dist_tax")
    for table, col in [
        ("issued_invoice_items", "conversion_ratio"),
        ("issued_invoice_items", "source_unit"),
        ("issued_invoice_items", "source_quantity"),
        ("issued_invoice_items", "source_sku"),
        ("product_companies", "total_purchased_qty"),
        ("product_companies", "last_purchased_at"),
        ("product_companies", "is_primary"),
        ("product_companies", "source"),
        ("product_companies", "conversion_den"),
        ("product_companies", "conversion_num"),
        ("product_companies", "invoice_unit_name"),
        ("product_companies", "invoice_name_override"),
        ("products", "internal_unit"),
        ("products", "internal_name"),
        ("companies", "sync_source"),
        ("companies", "invoice_item_mode"),
        ("companies", "short_name"),
        ("distributors", "company_allocation_mode"),
    ]:
        try:
            op.drop_column(table, col)
        except Exception:
            pass
