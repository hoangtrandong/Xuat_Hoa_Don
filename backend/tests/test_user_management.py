import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.admin_bootstrap import RESOURCES, sync_default_roles
from app.core.auth import hash_password
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app
from app.models.user import Permission, Role, User


@pytest.fixture
def user_management_client(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "test-user-mgmt-key-that-is-long-enough-32")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)

    admin_role = Role(
        name="admin",
        permissions=[
            Permission(code="users:read", description="Read users"),
            Permission(code="users:write", description="Write users"),
        ],
    )
    staff_role = Role(name="staff", description="Standard employee (read-only access)")
    db.add_all([admin_role, staff_role])
    admin = User(
        username="admin",
        email="admin@example.test",
        full_name="Administrator",
        hashed_password=hash_password("a-strong-password"),
        is_active=True,
        must_change_password=False,
        roles=[admin_role],
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    db.refresh(staff_role)

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "a-strong-password"},
        )
        token = login.json()["access_token"]
        yield client, db, {"Authorization": f"Bearer {token}"}, staff_role
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_admin_can_create_list_and_update_a_user(user_management_client):
    client, _, headers, staff_role = user_management_client

    create_response = client.post(
        "/api/v1/users/",
        json={
            "username": "nhanvien01",
            "email": "nhanvien01@example.test",
            "full_name": "Nguyen Van A",
            "password": "a-strong-password",
            "role_ids": [staff_role.id],
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["username"] == "nhanvien01"
    assert created["is_active"] is True
    assert [role["name"] for role in created["roles"]] == ["staff"]

    list_response = client.get("/api/v1/users/", headers=headers)
    assert list_response.status_code == 200
    usernames = {user["username"] for user in list_response.json()}
    assert usernames == {"admin", "nhanvien01"}

    update_response = client.patch(
        f"/api/v1/users/{created['id']}",
        json={"is_active": False},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["is_active"] is False


def test_new_user_login_works_with_the_password_that_was_set(user_management_client):
    client, _, headers, staff_role = user_management_client

    client.post(
        "/api/v1/users/",
        json={
            "username": "nhanvien02",
            "email": "nhanvien02@example.test",
            "full_name": "Nguyen Van B",
            "password": "another-strong-password",
            "role_ids": [staff_role.id],
        },
        headers=headers,
    )

    login = client.post(
        "/api/v1/auth/login",
        json={"username": "nhanvien02", "password": "another-strong-password"},
    )
    assert login.status_code == 200


def test_create_user_rejects_duplicate_username(user_management_client):
    client, _, headers, staff_role = user_management_client

    payload = {
        "username": "nhanvien03",
        "email": "nhanvien03@example.test",
        "full_name": "Nguyen Van C",
        "password": "a-strong-password",
        "role_ids": [staff_role.id],
    }
    assert client.post("/api/v1/users/", json=payload, headers=headers).status_code == 201
    duplicate = client.post("/api/v1/users/", json=payload, headers=headers)
    assert duplicate.status_code == 400


def test_create_user_rejects_short_password(user_management_client):
    client, _, headers, staff_role = user_management_client

    response = client.post(
        "/api/v1/users/",
        json={
            "username": "nhanvien04",
            "email": "nhanvien04@example.test",
            "full_name": "Nguyen Van D",
            "password": "short",
            "role_ids": [staff_role.id],
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_staff_role_cannot_manage_users(user_management_client):
    client, db, _, staff_role = user_management_client
    staffer = User(
        username="staffer",
        email="staffer@example.test",
        full_name="Staffer",
        hashed_password=hash_password("a-strong-password"),
        is_active=True,
        must_change_password=False,
        roles=[staff_role],
    )
    db.add(staffer)
    db.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"username": "staffer", "password": "a-strong-password"},
    )
    token = login.json()["access_token"]

    response = client.get(
        "/api/v1/users/", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 403


def test_sync_default_roles_creates_admin_and_staff_with_expected_permissions(monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from app.core import admin_bootstrap

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(admin_bootstrap, "SessionLocal", session_factory)

    sync_default_roles()
    sync_default_roles()  # idempotent: running twice must not duplicate roles/permissions

    with session_factory() as db:
        admin_role = db.query(Role).filter_by(name="admin").one()
        staff_role = db.query(Role).filter_by(name="staff").one()
        assert {permission.code for permission in admin_role.permissions} == {
            f"{resource}:{action}" for resource in RESOURCES for action in ("read", "write")
        }
        assert {permission.code for permission in staff_role.permissions} == {
            f"{resource}:read"
            for resource in RESOURCES
            if resource not in {"users", "employee-borrowing"}
        }
        assert db.query(Role).filter_by(name="admin").count() == 1
        assert db.query(Role).filter_by(name="staff").count() == 1
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_create_user_defaults_username_to_employee_code(user_management_client):
    from app.models.employee import Employee
    client, db, headers, staff_role = user_management_client

    emp = Employee(code="NV099", name="Nguyễn Văn Chín", position="Nhân viên kinh doanh", phone="0909090909")
    db.add(emp)
    db.commit()

    resp = client.post(
        "/api/v1/users/",
        json={
            "employee_id": emp.id,
            "email": "nv099@congty.vn",
            "full_name": emp.name,
            "password": "Password123456!",
            "role_ids": [staff_role.id],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["username"] == "NV099"
    assert data["employee_code"] == "NV099"
    assert data["employee_name"] == "Nguyễn Văn Chín"


def test_update_user_can_link_employee(user_management_client):
    from app.models.employee import Employee
    client, db, headers, staff_role = user_management_client

    emp = Employee(code="NV088", name="Trần Văn Tám", position="Giao hàng", phone="0808080808")
    db.add(emp)
    db.commit()

    created = client.post(
        "/api/v1/users/",
        json={
            "username": "custom_user_88",
            "email": "user88@congty.vn",
            "full_name": "Tài khoản 88",
            "password": "Password123456!",
            "role_ids": [staff_role.id],
        },
        headers=headers,
    ).json()

    patch_resp = client.patch(
        f"/api/v1/users/{created['id']}",
        json={"employee_id": emp.id},
        headers=headers,
    )
    assert patch_resp.status_code == 200, patch_resp.text
    updated = patch_resp.json()
    assert updated["employee_id"] == emp.id
    assert updated["employee_code"] == "NV088"
