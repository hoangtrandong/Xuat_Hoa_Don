from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.sqlalchemy_database_uri,
    echo=settings.DEBUG,
    future=True,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=20,
    max_overflow=20,
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401
    from sqlalchemy import text
    from app.crud import product as product_crud
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text("SET LOCAL lock_timeout = '3s'"))
            conn.execute(text("SET LOCAL statement_timeout = '15s'"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS sync_source VARCHAR(30) DEFAULT 'MANUAL';"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_name VARCHAR(255);"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_unit VARCHAR(50);"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_rate DOUBLE PRECISION;"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_rate_source VARCHAR(20) DEFAULT 'MANUAL';"))
        conn.execute(text("ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS seller_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;"))
        conn.execute(text("ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS seller_tax_code VARCHAR(40);"))
        conn.execute(text("ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(20) DEFAULT 'ORIGINAL';"))
        conn.execute(text("ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS parent_invoice_id INTEGER REFERENCES issued_invoices(id) ON DELETE SET NULL;"))
        conn.execute(text("ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS adjustment_reason VARCHAR(500);"))
        conn.execute(text("ALTER TABLE issued_invoices ADD COLUMN IF NOT EXISTS return_reference VARCHAR(120);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_issued_invoices_seller_tax ON issued_invoices(seller_tax_code);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_issued_invoices_parent_id ON issued_invoices(parent_invoice_id);"))
        conn.execute(text("ALTER TABLE distributors ADD COLUMN IF NOT EXISTS company_allocation_mode VARCHAR(30) DEFAULT 'BY_CUSTOMER';"))
        conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS short_name VARCHAR(120);"))
        conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_item_mode VARCHAR(20) DEFAULT 'TAX_INPUT';"))
        conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS sync_source VARCHAR(20) DEFAULT 'MANUAL';"))
        conn.execute(text("ALTER TABLE distributor_products ADD COLUMN IF NOT EXISTS distributor_id INTEGER REFERENCES distributors(id) ON DELETE CASCADE;"))
        conn.execute(text("ALTER TABLE distributor_products ADD COLUMN IF NOT EXISTS invoice_product_code VARCHAR(60);"))
        conn.execute(text("ALTER TABLE distributor_products ADD COLUMN IF NOT EXISTS invoice_product_name VARCHAR(255);"))
        if engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE distributor_products DROP CONSTRAINT IF EXISTS distributor_products_distributor_sku_key;"))
            conn.execute(text("ALTER TABLE distributor_products DROP CONSTRAINT IF EXISTS uq_distributor_products_sku_company;"))
            conn.execute(text("DROP INDEX IF EXISTS ix_distributor_products_distributor_sku;"))
            conn.execute(text("DROP INDEX IF EXISTS uq_distributor_products_sku_company_notnull;"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_distributor_products_distributor_id ON distributor_products(distributor_id);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_distributor_products_distributor_sku ON distributor_products(distributor_sku);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_distributor_products_invoice_code ON distributor_products(invoice_product_code);"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_distributor_products_dist_sku_company_notnull ON distributor_products(distributor_id, distributor_sku, company_id) WHERE distributor_id IS NOT NULL AND company_id IS NOT NULL;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS invoice_name_override VARCHAR(255);"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS invoice_unit_name VARCHAR(50);"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS conversion_num INTEGER DEFAULT 1;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS conversion_den INTEGER DEFAULT 1;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS source VARCHAR(25) DEFAULT 'MANUAL';"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS last_purchased_at TIMESTAMP;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS total_purchased_qty DOUBLE PRECISION DEFAULT 0;"))
        # Thêm cột npp_code theo từng (SKU, MST) và backfill 1 lần từ products.npp_code nếu cột mới tạo
        from sqlalchemy import inspect as sa_inspect
        pc_cols = {col["name"] for col in sa_inspect(conn).get_columns("product_companies")}
        if "npp_code" not in pc_cols:
            conn.execute(text("ALTER TABLE product_companies ADD COLUMN npp_code VARCHAR(50);"))
            if engine.dialect.name == "postgresql":
                conn.execute(text("""
                    UPDATE product_companies pc
                    SET npp_code = UPPER(TRIM(p.npp_code))
                    FROM products p
                    WHERE pc.product_id = p.id
                      AND pc.npp_code IS NULL
                      AND p.npp_code IS NOT NULL
                      AND TRIM(p.npp_code) <> ''
                """))
            else:
                conn.execute(text("""
                    UPDATE product_companies
                    SET npp_code = (
                        SELECT UPPER(TRIM(p.npp_code))
                        FROM products p
                        WHERE p.id = product_companies.product_id
                          AND p.npp_code IS NOT NULL
                          AND TRIM(p.npp_code) <> ''
                    )
                    WHERE npp_code IS NULL
                """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_companies_npp_code_upper ON product_companies (UPPER(npp_code));"))
        # Thêm cột invoice_product_id theo từng (SKU, MST) và backfill 1 lần từ products.invoice_product_id nếu cột mới tạo
        if "invoice_product_id" not in pc_cols:
            if engine.dialect.name == "postgresql":
                conn.execute(
                    text(
                        "ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS invoice_product_id INTEGER "
                        "REFERENCES invoice_products(id) ON DELETE SET NULL;"
                    )
                )
                conn.execute(
                    text(
                        """
                        UPDATE product_companies pc
                        SET invoice_product_id = p.invoice_product_id
                        FROM products p
                        WHERE pc.product_id = p.id
                          AND pc.invoice_product_id IS NULL
                          AND p.invoice_product_id IS NOT NULL
                        """
                    )
                )
            else:
                conn.execute(text("ALTER TABLE product_companies ADD COLUMN invoice_product_id INTEGER;"))
                conn.execute(
                    text(
                        """
                        UPDATE product_companies
                        SET invoice_product_id = (
                            SELECT p.invoice_product_id
                            FROM products p
                            WHERE p.id = product_companies.product_id
                              AND p.invoice_product_id IS NOT NULL
                        )
                        WHERE invoice_product_id IS NULL
                        """
                    )
                )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_companies_invoice_product_id ON product_companies (invoice_product_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_companies_company_ip ON product_companies (company_id, invoice_product_id);"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS source_sku VARCHAR(80);"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS source_quantity DOUBLE PRECISION;"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS source_unit VARCHAR(50);"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS conversion_ratio VARCHAR(30);"))
        conn.execute(text("ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS item_nature INTEGER DEFAULT 1;"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_sync_source ON products(sync_source);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_companies_dist_tax ON companies(distributor_id, tax_code);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_companies_lookup ON product_companies(product_id, is_primary DESC, last_purchased_at DESC);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vnm_snapshots_product_code_upper ON vinamilk_order_snapshots (UPPER(product_code));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_purchase_items_product_code_upper ON purchase_invoice_items (UPPER(product_code));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_issued_items_product_code_upper ON issued_invoice_items (UPPER(product_code));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_sku_upper ON products (UPPER(sku));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_npp_code_upper ON products (UPPER(npp_code));"))
        # Backfill liên kết N-N khách hàng <-> công ty quản lý từ customers.company_id hiện có
        conn.execute(text("""
            INSERT INTO customer_companies (customer_id, company_id, is_primary, created_at)
            SELECT c.id, c.company_id, TRUE, CURRENT_TIMESTAMP
            FROM customers c
            WHERE c.company_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM customer_companies cc
                  WHERE cc.customer_id = c.id AND cc.company_id = c.company_id
              )
        """))
    with SessionLocal() as db:
        try:
            product_crud.ensure_default_categories_and_units(db, commit=True)
        except Exception:
            db.rollback()
        try:
            from app.services.vinamilk_customer_code import migrate_vinamilk_customer_codes_to_3_chars

            migrate_vinamilk_customer_codes_to_3_chars(db, commit=True)
        except Exception:
            db.rollback()