import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import admin_bootstrap
from app.core.admin_bootstrap import (
    RESOURCES,
    bootstrap_administrator_from_environment,
    create_administrator,
)
from app.core.auth import verify_password
from app.core.database import Base
from app.models.user import User


def test_create_administrator_assigns_all_resource_permissions():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        administrator = create_administrator(
            db,
            username="admin",
            email="admin@example.test",
            full_name="Administrator",
            password="a-strong-password",
        )
        db.commit()

        assert verify_password("a-strong-password", administrator.hashed_password)
        assert {
            permission.code
            for role in administrator.roles
            for permission in role.permissions
        } == {
            f"{resource}:{action}"
            for resource in RESOURCES
            for action in ("read", "write")
        }

        with pytest.raises(ValueError, match="already exists"):
            create_administrator(
                db,
                username="admin",
                email="another@example.test",
                full_name="Another Administrator",
                password="another-strong-password",
            )

        assert db.query(User).count() == 1
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_environment_bootstrap_creates_once_and_is_idempotent(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(admin_bootstrap, "SessionLocal", session_factory)
    environment = {
        "INITIAL_ADMIN_USERNAME": "render-admin",
        "INITIAL_ADMIN_EMAIL": "render-admin@example.test",
        "INITIAL_ADMIN_FULL_NAME": "Render Administrator",
        "INITIAL_ADMIN_PASSWORD": "a-strong-password",
    }

    assert bootstrap_administrator_from_environment(environment) == "created"
    assert bootstrap_administrator_from_environment(environment) == "already exists; skipping"
    with session_factory() as session:
        assert session.query(User).count() == 1
    Base.metadata.drop_all(engine)
    engine.dispose()
