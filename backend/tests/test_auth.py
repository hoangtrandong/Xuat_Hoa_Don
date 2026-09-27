from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.delivery_requests import create_request
from app.core.auth import hash_password
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app
from app.models.user import Permission, Role, User
from app.schemas.delivery_request import DeliveryRequestCreate


@pytest.fixture
def auth_client(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "test-auth-key-that-is-long-enough-32")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    read_permission = Permission(code="customers:read", description="Read customers")
    role = Role(name="viewer", permissions=[read_permission])
    viewer = User(
        username="viewer",
        email="viewer@example.test",
        full_name="Viewer",
        hashed_password=hash_password("a-strong-password"),
        is_active=True,
        roles=[role],
    )
    db.add(viewer)
    db.commit()
    db.refresh(viewer)

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as client:
        yield client, db, viewer
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_api_requires_bearer_authentication(auth_client):
    client, _, _ = auth_client

    response = client.get("/api/v1/customers/")

    assert response.status_code == 401


def test_login_issues_a_signed_token_and_permission_is_enforced(auth_client):
    client, _, _ = auth_client

    login = client.post(
        "/api/v1/auth/login",
        json={"username": "viewer", "password": "a-strong-password"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert login.json()["token_type"] == "bearer"
    assert client.get(
        "/api/v1/customers/", headers={"Authorization": f"Bearer {token}"}
    ).status_code == 200
    assert client.post(
        "/api/v1/customers/",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    ).status_code == 403


@pytest.mark.parametrize("token_kind", ["invalid", "expired"])
def test_invalid_or_expired_token_is_rejected(auth_client, token_kind):
    client, _, viewer = auth_client
    if token_kind == "invalid":
        token = "not.a.valid.token"
    else:
        token = jwt.encode(
            {"sub": str(viewer.id), "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
            settings.SECRET_KEY,
            algorithm="HS256",
        )

    response = client.get(
        "/api/v1/customers/", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401


def test_delivery_request_creator_comes_from_authenticated_user(monkeypatch):
    from app.api.v1.endpoints import delivery_requests

    create = Mock(return_value={"id": 1})
    monkeypatch.setattr(delivery_requests.crud, "create", create)
    payload = DeliveryRequestCreate(
        warehouse_id=1,
        items=[{"product_id": 1, "quantity": 1}],
        created_by="forged-client-actor",
    )
    actor = User(username="authenticated-user")

    create_request(payload, db=Mock(), current_user=actor)

    assert create.call_args.kwargs["created_by"] == "authenticated-user"
