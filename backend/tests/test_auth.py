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
    promotion_read_permission = Permission(code="promotions:read", description="Read promotions")
    role = Role(name="viewer", permissions=[read_permission, promotion_read_permission])
    viewer = User(
        username="viewer",
        email="viewer@example.test",
        full_name="Viewer",
        hashed_password=hash_password("a-strong-password"),
        is_active=True,
        must_change_password=False,
        roles=[role],
    )
    db.add(viewer)
    db.commit()
    db.refresh(viewer)

    def override_db():
        yield db

    from app.core import audit as audit_mod
    from sqlalchemy.orm import sessionmaker

    monkeypatch.setattr(audit_mod, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False))
    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)
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


def test_authenticated_users_with_promotions_read_permission_can_list_promotions(auth_client):
    client, _, _ = auth_client
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "viewer", "password": "a-strong-password"},
    )
    token = login.json()["access_token"]

    response = client.get(
        "/api/v1/promotions",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json() == []


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


def test_me_profile_update_change_password_and_activity(auth_client):
    from app.models.user import AuditLog

    client, db, viewer = auth_client
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "viewer", "password": "a-strong-password"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. GET /auth/me returns enriched profile + permissions
    me_res = client.get("/api/v1/auth/me", headers=headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["email"] == "viewer@example.test"
    assert "customers:read" in me_data["permissions"]
    assert me_data["must_change_password"] is False

    # 2. PATCH /auth/me updates full_name and email
    upd_res = client.patch(
        "/api/v1/auth/me",
        json={"full_name": "Nguyễn Văn Kế Toán", "email": "ketoan@example.test"},
        headers=headers,
    )
    assert upd_res.status_code == 200
    assert upd_res.json()["full_name"] == "Nguyễn Văn Kế Toán"
    assert upd_res.json()["email"] == "ketoan@example.test"

    # 3. POST /auth/change-password validates current password, same password, and length
    wrong_res = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong-password", "new_password": "NewPassword@2026"},
        headers=headers,
    )
    assert wrong_res.status_code == 400

    same_res = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "a-strong-password", "new_password": "a-strong-password"},
        headers=headers,
    )
    assert same_res.status_code == 400

    ok_res = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "a-strong-password", "new_password": "NewPassword@2026"},
        headers=headers,
    )
    assert ok_res.status_code == 200
    assert ok_res.json()["access_token"]

    # New password works for login
    relogin = client.post(
        "/api/v1/auth/login",
        json={"username": "viewer", "password": "NewPassword@2026"},
    )
    assert relogin.status_code == 200

    # 4. GET /auth/me/activity returns only current user's audit entries
    db.add(
        AuditLog(
            actor_user_id=viewer.id,
            actor_username=viewer.username,
            action="login",
            resource="auth",
            path="/api/v1/auth/login",
            status_code=200,
            ip_address="127.0.0.1",
        )
    )
    db.add(
        AuditLog(
            actor_user_id=99999,
            actor_username="other_user",
            action="login",
            resource="auth",
            path="/api/v1/auth/login",
            status_code=200,
            ip_address="10.0.0.1",
        )
    )
    db.commit()

    act_res = client.get("/api/v1/auth/me/activity?category=security", headers=headers)
    assert act_res.status_code == 200
    rows = act_res.json()
    assert len(rows) >= 1
    assert all(r["resource"] == "auth" for r in rows)
    assert all(r["ip_address"] != "10.0.0.1" for r in rows)
