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
        conn.execute(text("ALTER TABLE distributor_products ADD COLUMN IF NOT EXISTS invoice_product_name VARCHAR(255);"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS invoice_name_override VARCHAR(255);"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS invoice_unit_name VARCHAR(50);"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS conversion_num INTEGER DEFAULT 1;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS conversion_den INTEGER DEFAULT 1;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS source VARCHAR(25) DEFAULT 'MANUAL';"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS last_purchased_at TIMESTAMP;"))
        conn.execute(text("ALTER TABLE product_companies ADD COLUMN IF NOT EXISTS total_purchased_qty DOUBLE PRECISION DEFAULT 0;"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS source_sku VARCHAR(80);"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS source_quantity DOUBLE PRECISION;"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS source_unit VARCHAR(50);"))
        conn.execute(text("ALTER TABLE issued_invoice_items ADD COLUMN IF NOT EXISTS conversion_ratio VARCHAR(30);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_sync_source ON products(sync_source);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_companies_dist_tax ON companies(distributor_id, tax_code);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_companies_lookup ON product_companies(product_id, is_primary DESC, last_purchased_at DESC);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vnm_snapshots_product_code_upper ON vinamilk_order_snapshots (UPPER(product_code));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_purchase_items_product_code_upper ON purchase_invoice_items (UPPER(product_code));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_issued_items_product_code_upper ON issued_invoice_items (UPPER(product_code));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_sku_upper ON products (UPPER(sku));"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_npp_code_upper ON products (UPPER(npp_code));"))
    with SessionLocal() as db:
        try:
            product_crud.ensure_default_categories_and_units(db, commit=True)
        except Exception:
            db.rollback()