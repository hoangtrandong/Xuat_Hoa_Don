"""O2C Phase 1 foundation: vehicles, order items, FEFO 2-step returns, 2-step debt transfers, store credit limit.

Revision ID: 20261128_o2c_phase1
Revises: 20261127_dp_sales_mgrs
"""

import sqlalchemy as sa
from alembic import op


revision = "20261128_o2c_phase1"
down_revision = "20261127_dp_sales_mgrs"
branch_labels = None
depends_on = None


def _add_column_if_missing(inspector, table_name: str, column: sa.Column) -> None:
    cols = {c["name"] for c in inspector.get_columns(table_name)}
    if column.name not in cols:
        op.add_column(table_name, column)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. vehicles master table
    if "vehicles" not in tables:
        op.create_table(
            "vehicles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(30), nullable=False, unique=True),
            sa.Column("plate_number", sa.String(30), nullable=False, unique=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("vehicle_type", sa.String(20), nullable=False, server_default="STANDARD"),
            sa.Column("max_weight_kg", sa.Numeric(12, 2), nullable=False, server_default="0"),
            sa.Column("max_volume_m3", sa.Numeric(10, 3), nullable=True),
            sa.Column("default_driver_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("note", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_vehicles_code", "vehicles", ["code"], unique=True)
        op.create_index("ix_vehicles_plate_number", "vehicles", ["plate_number"], unique=True)
        op.create_index("ix_vehicles_default_driver_id", "vehicles", ["default_driver_id"])
        op.create_index("ix_vehicles_is_active", "vehicles", ["is_active"])

    # 2. stores.credit_limit
    if "stores" in tables:
        _add_column_if_missing(inspector, "stores", sa.Column("credit_limit", sa.Float(), nullable=True))

    # 3. delivery_requests vehicle/driver/route/weight/settled_at
    if "delivery_requests" in tables:
        _add_column_if_missing(inspector, "delivery_requests", sa.Column("vehicle_id", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "delivery_requests", sa.Column("driver_id", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "delivery_requests", sa.Column("route_code", sa.String(60), nullable=True))
        _add_column_if_missing(inspector, "delivery_requests", sa.Column("planned_weight_kg", sa.Numeric(12, 2), nullable=False, server_default="0"))
        _add_column_if_missing(inspector, "delivery_requests", sa.Column("settled_at", sa.DateTime(), nullable=True))

    # 4. delivery_request_orders source linking, partial delivery, POD, einvoice status
    if "delivery_request_orders" in tables:
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("source_type", sa.String(30), nullable=True))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("source_order_id", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("store_id", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("returned_amount", sa.Numeric(14, 2), nullable=False, server_default="0"))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("net_amount", sa.Numeric(14, 2), nullable=True))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("delivery_status", sa.String(30), nullable=False, server_default="PENDING"))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("delivered_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("pod_image_url", sa.String(500), nullable=True))
        _add_column_if_missing(inspector, "delivery_request_orders", sa.Column("einvoice_status", sa.String(30), nullable=False, server_default="NOT_ISSUED"))

    # 5. delivery_request_order_items
    if "delivery_request_order_items" not in tables and "delivery_request_orders" in tables:
        op.create_table(
            "delivery_request_order_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("delivery_request_order_id", sa.Integer(), sa.ForeignKey("delivery_request_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("ordered_qty", sa.Integer(), nullable=False),
            sa.Column("delivered_qty", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("returned_qty", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("unit_price", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("discount", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("vat_rate", sa.Numeric(5, 2), nullable=False, server_default="0"),
            sa.Column("line_total", sa.Numeric(14, 2), nullable=False, server_default="0"),
        )
        op.create_index("ix_droi_order_id", "delivery_request_order_items", ["delivery_request_order_id"])
        op.create_index("ix_droi_product_id", "delivery_request_order_items", ["product_id"])

    # 6. debt_transfers 2-step POD approval + limit override
    if "debt_transfers" in tables:
        _add_column_if_missing(inspector, "debt_transfers", sa.Column("delivery_request_order_id", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "debt_transfers", sa.Column("pod_image_url", sa.String(500), nullable=True))
        _add_column_if_missing(inspector, "debt_transfers", sa.Column("rejected_by", sa.String(120), nullable=True))
        _add_column_if_missing(inspector, "debt_transfers", sa.Column("rejected_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(inspector, "debt_transfers", sa.Column("reject_reason", sa.String(255), nullable=True))
        _add_column_if_missing(inspector, "debt_transfers", sa.Column("override_limit_by", sa.String(120), nullable=True))
        _add_column_if_missing(inspector, "debt_transfers", sa.Column("override_limit_reason", sa.String(255), nullable=True))

    # 7. delivery_returns 2-step warehouse receipt
    if "delivery_returns" in tables:
        _add_column_if_missing(inspector, "delivery_returns", sa.Column("settlement_party_type", sa.String(20), nullable=False, server_default="EMPLOYEE"))
        _add_column_if_missing(inspector, "delivery_returns", sa.Column("settlement_party_id", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "delivery_returns", sa.Column("warehouse_received_by", sa.String(120), nullable=True))
        _add_column_if_missing(inspector, "delivery_returns", sa.Column("warehouse_received_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(inspector, "delivery_returns", sa.Column("rejected_by", sa.String(120), nullable=True))
        _add_column_if_missing(inspector, "delivery_returns", sa.Column("rejected_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(inspector, "delivery_returns", sa.Column("reject_reason", sa.String(255), nullable=True))

    # 8. delivery_return_items FEFO lot_id/expiry_date + damaged handling
    if "delivery_return_items" in tables:
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("actual_received_qty", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("lot_id", sa.Integer(), nullable=True))
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("expiry_date", sa.DateTime(), nullable=True))
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("item_condition", sa.String(20), nullable=False, server_default="GOOD"))
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("damage_resolution", sa.String(30), nullable=True))
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("resolved_by", sa.String(120), nullable=True))
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("resolved_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(inspector, "delivery_return_items", sa.Column("resolution_note", sa.String(255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "delivery_request_order_items" in tables:
        op.drop_table("delivery_request_order_items")
    if "vehicles" in tables:
        op.drop_table("vehicles")
