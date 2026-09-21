import logging
from pathlib import Path
import traceback
import asyncio

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
from app.core.config import settings
from app.api.v1.router import api_router

logger = logging.getLogger(__name__)


def run_database_migrations() -> None:
    alembic_config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_uri)
    try:
        command.upgrade(alembic_config, "head")
    except Exception:
        logger.error("Database migration failed during application startup.")
        traceback.print_exc()
        raise


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
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

@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": settings.PROJECT_NAME}

app.include_router(api_router, prefix=settings.API_V1_PREFIX)

