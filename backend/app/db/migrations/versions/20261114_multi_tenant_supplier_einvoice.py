"""add multi-tenant distributors, supplier connectors, dynamic field mappings, and e-invoice gateway tables

Revision ID: 20261114_multi_tenant_einvoice
Revises: 20261111_vinamilk_credentials
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_multi_tenant_einvoice"
down_revision = "20261111_vinamilk_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "distributors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("tax_code", sa.String(length=30), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("email", sa.String(length=120), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("representative_name", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("code", name="uq_distributors_code"),
    )
    op.create_index("ix_distributors_code", "distributors", ["code"])
    op.create_index("ix_distributors_name", "distributors", ["name"])
    op.create_index("ix_distributors_tax_code", "distributors", ["tax_code"])

    op.create_table(
        "distributor_supplier_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("distributor_id", sa.Integer(), sa.ForeignKey("distributors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("supplier_code", sa.String(length=50), nullable=False),
        sa.Column("supplier_name", sa.String(length=200), nullable=False),
        sa.Column("connector_type", sa.String(length=40), nullable=False, server_default="REST_API"),
        sa.Column("api_endpoint_url", sa.String(length=500), nullable=True),
        sa.Column("auth_type", sa.String(length=30), nullable=False, server_default="BEARER_TOKEN"),
        sa.Column("username", sa.String(length=120), nullable=True),
        sa.Column("encrypted_secret", sa.Text(), nullable=True),
        sa.Column("session_cookie", sa.Text(), nullable=True),
        sa.Column("field_mapping", sa.JSON(), nullable=False),
        sa.Column("request_config", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("distributor_id", "supplier_code", name="uq_dist_supplier_code"),
    )
    op.create_index("ix_dist_supp_distributor_id", "distributor_supplier_configs", ["distributor_id"])
    op.create_index("ix_dist_supp_supplier_code", "distributor_supplier_configs", ["supplier_code"])

    op.create_table(
        "distributor_invoice_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("distributor_id", sa.Integer(), sa.ForeignKey("distributors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("config_name", sa.String(length=160), nullable=False, server_default="Cấu hình mặc định"),
        sa.Column("provider", sa.String(length=40), nullable=False, server_default="MISA"),
        sa.Column("api_url", sa.String(length=500), nullable=True),
        sa.Column("app_id", sa.String(length=120), nullable=True),
        sa.Column("username", sa.String(length=120), nullable=True),
        sa.Column("encrypted_secret", sa.Text(), nullable=True),
        sa.Column("invoice_template_code", sa.String(length=40), nullable=False, server_default="1/001"),
        sa.Column("invoice_series", sa.String(length=40), nullable=False, server_default="1C26TDD"),
        sa.Column("default_vat_rate", sa.Float(), nullable=False, server_default="8"),
        sa.Column("combine_orders", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("promo_handling", sa.String(length=30), nullable=False, server_default="ZERO_PRICE"),
        sa.Column("discount_display", sa.String(length=30), nullable=False, server_default="BY_LINE"),
        sa.Column("product_code_source", sa.String(length=30), nullable=False, server_default="SUPPLIER_SKU"),
        sa.Column("default_payment_method", sa.String(length=30), nullable=False, server_default="TM/CK"),
        sa.Column("seller_bank_account", sa.String(length=60), nullable=True),
        sa.Column("seller_bank_name", sa.String(length=160), nullable=True),
        sa.Column("form_layout_config", sa.JSON(), nullable=False),
        sa.Column("auto_sign", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_dist_inv_distributor_id", "distributor_invoice_configs", ["distributor_id"])

    op.create_table(
        "issued_invoices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("distributor_id", sa.Integer(), sa.ForeignKey("distributors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_config_id", sa.Integer(), sa.ForeignKey("distributor_invoice_configs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("invoice_template_code", sa.String(length=40), nullable=False),
        sa.Column("invoice_series", sa.String(length=40), nullable=False),
        sa.Column("invoice_number", sa.String(length=40), nullable=True),
        sa.Column("tax_authority_code", sa.String(length=100), nullable=True),
        sa.Column("transaction_id", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=25), nullable=False, server_default="DRAFT"),
        sa.Column("supplier_code", sa.String(length=50), nullable=True),
        sa.Column("source_order_numbers", sa.JSON(), nullable=False),
        sa.Column("buyer_code", sa.String(length=80), nullable=True),
        sa.Column("buyer_name", sa.String(length=255), nullable=False),
        sa.Column("buyer_legal_name", sa.String(length=255), nullable=True),
        sa.Column("buyer_tax_code", sa.String(length=40), nullable=True),
        sa.Column("buyer_address", sa.String(length=255), nullable=True),
        sa.Column("buyer_email", sa.String(length=120), nullable=True),
        sa.Column("payment_method", sa.String(length=30), nullable=False, server_default="TM/CK"),
        sa.Column("subtotal_before_tax", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("vat_rate", sa.Float(), nullable=False, server_default="8"),
        sa.Column("vat_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("total_payment", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("amount_in_words", sa.String(length=500), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("provider_payload", sa.JSON(), nullable=False),
        sa.Column("provider_response", sa.JSON(), nullable=False),
        sa.Column("issued_by", sa.String(length=120), nullable=True),
        sa.Column("issued_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_issued_inv_distributor_id", "issued_invoices", ["distributor_id"])
    op.create_index("ix_issued_inv_number", "issued_invoices", ["invoice_number"])
    op.create_index("ix_issued_inv_status", "issued_invoices", ["status"])

    op.create_table(
        "issued_invoice_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("invoice_id", sa.Integer(), sa.ForeignKey("issued_invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("item_type", sa.String(length=25), nullable=False, server_default="NORMAL"),
        sa.Column("product_code", sa.String(length=80), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("unit_name", sa.String(length=50), nullable=False, server_default="Hộp"),
        sa.Column("quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("unit_price", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("discount_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("amount_before_tax", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("vat_rate", sa.Float(), nullable=False, server_default="8"),
        sa.Column("vat_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("source_order_number", sa.String(length=120), nullable=True),
    )
    op.create_index("ix_issued_inv_items_invoice_id", "issued_invoice_items", ["invoice_id"])


def downgrade() -> None:
    op.drop_table("issued_invoice_items")
    op.drop_table("issued_invoices")
    op.drop_table("distributor_invoice_configs")
    op.drop_table("distributor_supplier_configs")
    op.drop_table("distributors")
