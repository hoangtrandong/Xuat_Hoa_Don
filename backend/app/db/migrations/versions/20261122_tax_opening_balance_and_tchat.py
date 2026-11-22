"""add tax_inventory_opening_balances table and purchase_invoice_items.item_nature

Revision ID: 20261122_tax_opening_balance_and_tchat
Revises: 20261121_vat_tax_ledger_adjustment
"""

import sqlalchemy as sa
from alembic import op


revision = "20261122_tax_opening_balance_and_tchat"
down_revision = "20261121_vat_tax_ledger_adjustment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "purchase_invoice_items" in tables:
        cols = {c["name"] for c in inspector.get_columns("purchase_invoice_items")}
        if "item_nature" not in cols:
            op.add_column(
                "purchase_invoice_items",
                sa.Column("item_nature", sa.Integer(), nullable=True, server_default="1"),
            )

    if "tax_inventory_opening_balances" not in tables:
        op.create_table(
            "tax_inventory_opening_balances",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("distributor_id", sa.Integer(), sa.ForeignKey("distributors.id", ondelete="CASCADE"), nullable=True),
            sa.Column("tax_code", sa.String(40), nullable=False),
            sa.Column("sku", sa.String(100), nullable=False),
            sa.Column("product_name", sa.String(500), nullable=True),
            sa.Column("unit_name", sa.String(60), nullable=True),
            sa.Column("as_of_date", sa.Date(), nullable=False),
            sa.Column("opening_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("opening_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
            sa.Column("note", sa.String(300), nullable=True),
            sa.Column("updated_by", sa.String(120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint(
                "distributor_id",
                "tax_code",
                "sku",
                "as_of_date",
                name="uq_tax_opening_balance_key",
            ),
        )
        op.create_index("ix_tax_opening_dist", "tax_inventory_opening_balances", ["distributor_id"])
        op.create_index("ix_tax_opening_tax_sku", "tax_inventory_opening_balances", ["tax_code", "sku"])
        op.create_index("ix_tax_opening_date", "tax_inventory_opening_balances", ["as_of_date"])


def downgrade() -> None:
    op.drop_table("tax_inventory_opening_balances")
    try:
        op.drop_column("purchase_invoice_items", "item_nature")
    except Exception:
        pass
