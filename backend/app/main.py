import logging
import os
from pathlib import Path
import traceback
import asyncio
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
from app.core.config import settings
from app.core.auth import require_endpoint_permission
from app.core.audit import record_audit_log
from app.core.admin_bootstrap import bootstrap_administrator_from_environment, sync_default_roles
from app.api.v1.router import api_router
from app.api.v1.endpoints.auth import router as auth_router
from scripts.vinamilk_login import configure_playwright_browser_path

configure_playwright_browser_path()

logger = logging.getLogger(__name__)


def run_database_migrations() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    alembic_config = Config(str(backend_dir / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(backend_dir / "app" / "db" / "migrations"))
    alembic_config.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_uri)
    try:
        command.upgrade(alembic_config, "head")
        logger.info("Database migration completed successfully.")
    except Exception as exc:
        logger.warning("Database migration upgrade encountered an issue: %s. Attempting to stamp head...", exc)
        try:
            command.stamp(alembic_config, "head")
            logger.info("Database schema stamped to head successfully.")
        except Exception as stamp_exc:
            logger.error("Could not stamp alembic head: %s. Continuing startup.", stamp_exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("SKIP_LIFESPAN_MIGRATIONS", "").strip().lower() not in {"1", "true", "yes"}:
        run_database_migrations()
    try:
        from app.core.database import Base, engine, init_db
        import app.models.multi_tenant_invoice  # noqa: F401
        Base.metadata.create_all(bind=engine)
        init_db()
        from sqlalchemy import text
        with engine.connect() as conn:
            if engine.dialect.name == "postgresql":
                conn.execute(text("SET lock_timeout = '3s'"))
                conn.execute(text("SET statement_timeout = '15s'"))
            conn.execute(text("ALTER TABLE vinamilk_order_snapshots ADD COLUMN IF NOT EXISTS processing_status VARCHAR(40)"))
            conn.execute(text("ALTER TABLE vinamilk_order_snapshots ADD COLUMN IF NOT EXISTS performed_by VARCHAR(120)"))
            conn.execute(text("ALTER TABLE vinamilk_order_snapshots ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN DEFAULT FALSE NOT NULL"))
            conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS nickname VARCHAR(100)"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS distributor_id INTEGER REFERENCES distributors(id) ON DELETE SET NULL"))
            conn.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone VARCHAR(30)"))
            # Multi-tenant isolation cho Công ty quản lý, Khách hàng, Cửa hàng
            conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS distributor_id INTEGER REFERENCES distributors(id) ON DELETE SET NULL"))
            conn.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS distributor_id INTEGER REFERENCES distributors(id) ON DELETE SET NULL"))
            conn.execute(text("ALTER TABLE stores ADD COLUMN IF NOT EXISTS distributor_id INTEGER REFERENCES distributors(id) ON DELETE SET NULL"))
            # Chuyển unique(code) toàn cục sang composite unique (distributor_id, code) trên PostgreSQL
            if engine.dialect.name == "postgresql":
                conn.execute(text("ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_code_key"))
                conn.execute(text("DROP INDEX IF EXISTS ix_companies_code"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_companies_code ON companies (code)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_companies_distributor_id ON companies (distributor_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_companies_dist_status ON companies (distributor_id, status)"))
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_distributor_code_idx ON companies (distributor_id, code) WHERE distributor_id IS NOT NULL"))

                conn.execute(text("ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_code_key"))
                conn.execute(text("DROP INDEX IF EXISTS ix_customers_code"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_customers_code ON customers (code)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_customers_distributor_id ON customers (distributor_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_customers_dist_company ON customers (distributor_id, company_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_customers_dist_status ON customers (distributor_id, status)"))
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_distributor_code_idx ON customers (distributor_id, code) WHERE distributor_id IS NOT NULL"))

                conn.execute(text("ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_code_key"))
                conn.execute(text("DROP INDEX IF EXISTS ix_stores_code"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_stores_code ON stores (code)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_stores_distributor_id ON stores (distributor_id)"))
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_distributor_code_idx ON stores (distributor_id, code) WHERE distributor_id IS NOT NULL"))

            # Backfill dữ liệu cũ (chưa gán NPP) về Nhà Phân Phối Mai Gold (NPP-MAIGOLD)
            mg_id = conn.execute(
                text(
                    "SELECT id FROM distributors "
                    "WHERE UPPER(code) = 'NPP-MAIGOLD' OR LOWER(name) LIKE '%mai gold%' "
                    "ORDER BY CASE WHEN UPPER(code) = 'NPP-MAIGOLD' THEN 0 ELSE 1 END, id "
                    "LIMIT 1"
                )
            ).scalar()
            if mg_id is not None:
                conn.execute(
                    text(
                        "UPDATE companies SET distributor_id = :mg_id "
                        "WHERE distributor_id IS NULL "
                        "AND code NOT IN (SELECT code FROM companies WHERE distributor_id = :mg_id)"
                    ),
                    {"mg_id": mg_id},
                )
                conn.execute(
                    text(
                        "UPDATE customers SET distributor_id = :mg_id "
                        "WHERE distributor_id IS NULL "
                        "AND code NOT IN (SELECT code FROM customers WHERE distributor_id = :mg_id)"
                    ),
                    {"mg_id": mg_id},
                )
                conn.execute(
                    text(
                        "UPDATE stores SET distributor_id = :mg_id "
                        "WHERE distributor_id IS NULL "
                        "AND code NOT IN (SELECT code FROM stores WHERE distributor_id = :mg_id)"
                    ),
                    {"mg_id": mg_id},
                )
            conn.commit()
    except Exception as exc:
        logger.warning("Could not auto-create tables: %s", exc)
    sync_default_roles()
    status = bootstrap_administrator_from_environment()
    logger.info("Initial administrator bootstrap: %s.", status)
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)


# Custom middleware to add CORS headers to ALL responses (including errors)
@app.middleware("http")
async def add_cors_headers(request: Request, call_next):
    origin = request.headers.get("origin", "*")
    try:
        response = await call_next(request)
    except Exception as exc:
        # Handle exceptions and still add CORS headers

        response = JSONResponse(
            status_code=500,
            content={"detail": str(exc)}
        )

    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT"
    response.headers["Access-Control-Allow-Headers"] = "*"

    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Ghi audit log cho các thao tác write dưới /api/v1 (trừ /auth, do login được ghi log riêng).
@app.middleware("http")
async def audit_log_middleware(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    api_prefix = f"{settings.API_V1_PREFIX}/"
    if path.startswith(api_prefix) and not path.startswith(f"{settings.API_V1_PREFIX}/auth"):
        actor = getattr(request.state, "user", None)
        ip_address = request.client.host if request.client else None
        record_audit_log(
            actor=actor,
            method=request.method,
            path=path,
            api_prefix=settings.API_V1_PREFIX,
            status_code=response.status_code,
            ip_address=ip_address,
        )
    return response

@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": settings.PROJECT_NAME}

app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(
    api_router,
    prefix=settings.API_V1_PREFIX,
    dependencies=[Depends(require_endpoint_permission)],
)
