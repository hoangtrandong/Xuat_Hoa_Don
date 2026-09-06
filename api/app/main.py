from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.migrate import apply_schema
from app.models import Base  # noqa: F401 — register ORM metadata
from app.routers.api import router as api_router
from app.routers.health import router as health_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.auto_create_schema:
        apply_schema()
    yield


app = FastAPI(
    title="DMS API",
    version="0.1.0",
    description="Modular monolith — PostgreSQL Phase 1",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(api_router)
