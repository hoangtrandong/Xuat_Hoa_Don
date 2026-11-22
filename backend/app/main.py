import logging
import os
from pathlib import Path
import re
import traceback
import asyncio
import uuid
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
        if settings.ALLOW_MIGRATION_STAMP_FALLBACK:
            logger.warning(
                "Database migration upgrade encountered an issue: %s. "
                "ALLOW_MIGRATION_STAMP_FALLBACK=true -> attempting to stamp head...",
                exc,
            )
            try:
                command.stamp(alembic_config, "head")
                logger.info("Database schema stamped to head successfully.")
                return
            except Exception as stamp_exc:
                logger.error("Could not stamp alembic head: %s.", stamp_exc)
        logger.error("Database migration failed: %s", exc, exc_info=True)
        raise


@asynccontextmanager
async def lifespan(_: FastAPI):
    from sqlalchemy import text
    from app.core.database import Base, engine, init_db
    import app.models.multi_tenant_invoice  # noqa: F401

    got_bootstrap_lock = True
    lock_conn = None
    if engine.dialect.name == "postgresql":
        try:
            lock_conn = engine.connect()
            got_bootstrap_lock = bool(
                lock_conn.execute(text("SELECT pg_try_advisory_lock(88421901)")).scalar()
            )
        except Exception as lock_exc:
            logger.warning("Could not acquire startup advisory lock: %s", lock_exc)
            got_bootstrap_lock = False

    if not got_bootstrap_lock:
        logger.info("Another worker is running startup bootstrap; skipping duplicate DDL/seed in this worker.")
        if lock_conn is not None:
            lock_conn.close()
    else:
        try:
            if os.getenv("SKIP_LIFESPAN_MIGRATIONS", "").strip().lower() not in {"1", "true", "yes"}:
                run_database_migrations()
            try:
                Base.metadata.create_all(bind=engine)
                init_db()
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

                    conn.commit()
            except Exception as exc:
                logger.warning("Could not auto-create tables: %s", exc)
            try:
                sync_default_roles()
                admin_status = bootstrap_administrator_from_environment()
                logger.info("Initial administrator bootstrap: %s.", admin_status)
            except Exception as role_exc:
                logger.warning("Startup role/admin bootstrap warning: %s", role_exc)
        finally:
            if lock_conn is not None:
                try:
                    lock_conn.execute(text("SELECT pg_advisory_unlock(88421901)"))
                except Exception:
                    pass
                lock_conn.close()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)


def _is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return False
    clean = origin.strip().rstrip("/")
    if clean in settings.cors_origins:
        return True
    if settings.ALLOWED_ORIGIN_REGEX:
        try:
            if re.fullmatch(settings.ALLOWED_ORIGIN_REGEX, clean):
                return True
        except re.error:
            pass
    if settings.DEBUG and (
        clean.startswith("http://localhost:")
        or clean.startswith("http://127.0.0.1:")
    ):
        return True
    return False


# Custom middleware to catch unhandled errors safely without leaking internals and attach CORS only for whitelisted origins
@app.middleware("http")
async def add_cors_headers(request: Request, call_next):
    origin = request.headers.get("origin")
    try:
        response = await call_next(request)
    except Exception as exc:
        request_id = uuid.uuid4().hex[:12]
        logger.error(
            "Unhandled exception [request_id=%s] %s %s: %s\n%s",
            request_id,
            request.method,
            request.url.path,
            exc,
            traceback.format_exc(),
        )
        detail = str(exc) if settings.DEBUG else "Lỗi hệ thống nội bộ. Vui lòng thử lại hoặc liên hệ quản trị viên."
        response = JSONResponse(
            status_code=500,
            content={"detail": detail, "request_id": request_id},
        )

    if _is_allowed_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT"
        response.headers["Access-Control-Allow-Headers"] = "*"

    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.ALLOWED_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
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
