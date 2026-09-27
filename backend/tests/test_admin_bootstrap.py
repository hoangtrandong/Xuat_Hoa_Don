import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.admin_bootstrap import RESOURCES, create_administrator
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
