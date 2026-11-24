"""create invoice_products hub and link products + distributor_products

Revision ID: 20261124_inv_prod_hub
Revises: 20261123_step3_jobs_snap, 20261124_pc_npp_code
"""

from datetime import datetime
import sqlalchemy as sa
from alembic import op


revision = "20261124_inv_prod_hub"
down_revision = ("20261123_step3_jobs_snap", "20261124_pc_npp_code")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. Tạo bảng invoice_products
    if "invoice_products" not in tables:
        op.create_table(
            "invoice_products",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "distributor_id",
                sa.Integer(),
                sa.ForeignKey("distributors.id", ondelete="CASCADE"),
                nullable=True,
                index=True,
            ),
            sa.Column("code", sa.String(length=60), nullable=False, index=True),
            sa.Column("name", sa.String(length=255), nullable=False, index=True),
            sa.Column("unit_name", sa.String(length=50), nullable=False, server_default="Hộp"),
            sa.Column("vat_rate", sa.Float(), nullable=True),
            sa.Column("supplier", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("note", sa.String(length=300), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("distributor_id", "code", name="uq_invoice_products_dist_code"),
        )

    # 2. Thêm invoice_product_id vào products
    if "products" in tables:
        prod_cols = {c["name"] for c in inspector.get_columns("products")}
        if "invoice_product_id" not in prod_cols:
            op.add_column(
                "products",
                sa.Column("invoice_product_id", sa.Integer(), nullable=True),
            )
            op.create_index("ix_products_invoice_product_id", "products", ["invoice_product_id"])
            if bind.dialect.name == "postgresql":
                op.create_foreign_key(
                    "fk_products_invoice_product_id",
                    "products",
                    "invoice_products",
                    ["invoice_product_id"],
                    ["id"],
                    ondelete="SET NULL",
                )

    # 3. Thêm invoice_product_id, conversion_num, conversion_den vào distributor_products
    if "distributor_products" in tables:
        dp_cols = {c["name"] for c in inspector.get_columns("distributor_products")}
        if "invoice_product_id" not in dp_cols:
            op.add_column(
                "distributor_products",
                sa.Column("invoice_product_id", sa.Integer(), nullable=True),
            )
            op.create_index(
                "ix_distributor_products_invoice_product_id",
                "distributor_products",
                ["invoice_product_id"],
            )
            if bind.dialect.name == "postgresql":
                op.create_foreign_key(
                    "fk_distributor_products_invoice_product_id",
                    "distributor_products",
                    "invoice_products",
                    ["invoice_product_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
        if "conversion_num" not in dp_cols:
            op.add_column(
                "distributor_products",
                sa.Column("conversion_num", sa.Integer(), nullable=False, server_default="1"),
            )
        if "conversion_den" not in dp_cols:
            op.add_column(
                "distributor_products",
                sa.Column("conversion_den", sa.Integer(), nullable=False, server_default="1"),
            )

    # 4. Data migration: trích xuất SP xuất hóa đơn từ distributor_products & nối link tự động
    if "distributor_products" in tables:
        now = datetime.utcnow()
        # Lấy danh sách hiện có trong invoice_products để idempotent
        existing_ip = {}
        ip_rows = bind.execute(
            sa.text("SELECT id, distributor_id, UPPER(TRIM(code)) FROM invoice_products")
        ).fetchall()
        for ip_id, ip_dist, ip_code in ip_rows:
            existing_ip[(ip_dist, ip_code)] = ip_id

        # Quét distributor_products có invoice_product_code (hoặc distributor_sku)
        dp_rows = bind.execute(
            sa.text(
                """
                SELECT id, distributor_id, distributor_sku, distributor_product_name,
                       invoice_product_code, invoice_product_name, supplier, unit
                FROM distributor_products
                ORDER BY id ASC
                """
            )
        ).fetchall()

        dms_sku_to_ip_id = {}
        code_to_ip_id_any = {}

        for (
            dp_id,
            dist_id,
            dms_sku,
            dms_name,
            inv_code,
            inv_name,
            supplier,
            unit,
        ) in dp_rows:
            clean_inv_code = (inv_code or "").strip().upper()
            clean_dms_sku = (dms_sku or "").strip().upper()
            if not clean_inv_code:
                continue

            clean_inv_name = (inv_name or dms_name or clean_inv_code).strip()
            clean_unit = (unit or "Hộp").strip() or "Hộp"
            clean_supplier = (supplier or "").strip()

            key = (dist_id, clean_inv_code)
            ip_id = existing_ip.get(key)
            if ip_id is None:
                res = bind.execute(
                    sa.text(
                        """
                        INSERT INTO invoice_products
                            (distributor_id, code, name, unit_name, supplier, status, created_at, updated_at)
                        VALUES
                            (:dist_id, :code, :name, :unit_name, :supplier, 'active', :created_at, :updated_at)
                        """
                    ),
                    {
                        "dist_id": dist_id,
                        "code": clean_inv_code,
                        "name": clean_inv_name,
                        "unit_name": clean_unit,
                        "supplier": clean_supplier,
                        "created_at": now,
                        "updated_at": now,
                    },
                )
                # Lấy lại id vừa insert (tương thích cả SQLite & PostgreSQL)
                if dist_id is None:
                    ip_id = bind.execute(
                        sa.text(
                            "SELECT id FROM invoice_products WHERE distributor_id IS NULL AND code = :code ORDER BY id DESC LIMIT 1"
                        ),
                        {"code": clean_inv_code},
                    ).scalar()
                else:
                    ip_id = bind.execute(
                        sa.text(
                            "SELECT id FROM invoice_products WHERE distributor_id = :dist_id AND code = :code ORDER BY id DESC LIMIT 1"
                        ),
                        {"dist_id": dist_id, "code": clean_inv_code},
                    ).scalar()
                if ip_id is not None:
                    existing_ip[key] = ip_id

            if ip_id is not None:
                bind.execute(
                    sa.text(
                        "UPDATE distributor_products SET invoice_product_id = :ip_id WHERE id = :dp_id AND invoice_product_id IS NULL"
                    ),
                    {"ip_id": ip_id, "dp_id": dp_id},
                )
                if clean_dms_sku and clean_dms_sku not in dms_sku_to_ip_id:
                    dms_sku_to_ip_id[clean_dms_sku] = ip_id
                if clean_inv_code not in code_to_ip_id_any:
                    code_to_ip_id_any[clean_inv_code] = ip_id

        # 5. Tự động nối products.invoice_product_id dựa trên products.npp_code
        if "products" in tables:
            prod_rows = bind.execute(
                sa.text(
                    "SELECT id, UPPER(TRIM(sku)), UPPER(TRIM(COALESCE(npp_code, ''))) FROM products WHERE invoice_product_id IS NULL"
                )
            ).fetchall()
            for p_id, p_sku, p_npp in prod_rows:
                target_ip_id = None
                if p_npp:
                    target_ip_id = code_to_ip_id_any.get(p_npp) or dms_sku_to_ip_id.get(p_npp)
                if target_ip_id is None and p_sku:
                    target_ip_id = code_to_ip_id_any.get(p_sku)
                if target_ip_id is not None:
                    bind.execute(
                        sa.text(
                            "UPDATE products SET invoice_product_id = :ip_id WHERE id = :p_id"
                        ),
                        {"ip_id": target_ip_id, "p_id": p_id},
                    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "distributor_products" in tables:
        dp_cols = {c["name"] for c in inspector.get_columns("distributor_products")}
        if "conversion_den" in dp_cols:
            op.drop_column("distributor_products", "conversion_den")
        if "conversion_num" in dp_cols:
            op.drop_column("distributor_products", "conversion_num")
        if "invoice_product_id" in dp_cols:
            op.drop_column("distributor_products", "invoice_product_id")

    if "products" in tables:
        prod_cols = {c["name"] for c in inspector.get_columns("products")}
        if "invoice_product_id" in prod_cols:
            op.drop_column("products", "invoice_product_id")

    if "invoice_products" in tables:
        op.drop_table("invoice_products")
