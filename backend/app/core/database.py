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
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_sync_source ON products(sync_source);"))
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