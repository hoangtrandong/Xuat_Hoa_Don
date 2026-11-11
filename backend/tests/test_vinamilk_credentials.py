from pathlib import Path
from importlib.util import module_from_spec, spec_from_file_location

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints.sync import (
    VinamilkCredentialUpdateRequest,
    get_vinamilk_credentials,
    update_vinamilk_credentials,
)
from app.core.database import Base
from app.models.user import Role, User
from app.services.vinamilk_credentials import (
    decrypt_vinamilk_password,
    encrypt_vinamilk_password,
    get_credentials_status,
    load_db_credentials,
    upsert_db_credentials,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def _make_user(username: str, role_name: str = "staff") -> User:
    role = Role(name=role_name, description=role_name)
    user = User(
        username=username,
        email=f"{username}@test.local",
        full_name=username,
        hashed_password="x",
        is_active=True,
    )
    user.roles = [role]
    return user


def test_encrypt_decrypt_roundtrip():
    cipher = encrypt_vinamilk_password("Secret@123456")
    assert cipher != "Secret@123456"
    assert decrypt_vinamilk_password(cipher) == "Secret@123456"


def test_upsert_and_load_db_credentials(db: Session):
    record = upsert_db_credentials(
        db,
        username="vnm_user_01",
        password="PassWord#2026",
        updated_by="admin",
        session_cookie="JSESSIONID=abc123",
    )
    assert record.username == "vnm_user_01"
    assert record.encrypted_password != "PassWord#2026"
    assert load_db_credentials(db) == ("vnm_user_01", "PassWord#2026")

    status_info = get_credentials_status(db)
    assert status_info["username"] == "vnm_user_01"
    assert status_info["has_password"] is True
    assert status_info["source"] == "DATABASE"
    assert status_info["has_session_cookie"] is True


def test_non_admin_cannot_access_or_update_credentials(db: Session):
    staff_user = _make_user("nvbh01", "staff")
    with pytest.raises(HTTPException) as exc_info:
        get_vinamilk_credentials(db=db, current_user=staff_user)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_update_and_verify_credentials(db: Session, monkeypatch):
    admin_user = _make_user("admin", "admin")
    called_with = {}

    def fake_login(u=None, p=None):
        called_with["username"] = u
        called_with["password"] = p
        return "JSESSIONID=verified999"

    monkeypatch.setattr("app.api.v1.endpoints.sync.login_and_get_cookie", fake_login)

    resp = await update_vinamilk_credentials(
        payload=VinamilkCredentialUpdateRequest(
            username="dms_shop_01",
            password="NewPassword@2026",
            verify_login=True,
        ),
        db=db,
        current_user=admin_user,
    )
    assert resp["username"] == "dms_shop_01"
    assert resp["has_password"] is True
    assert resp["verified"] is True
    assert resp["source"] == "DATABASE"
    assert called_with == {"username": "dms_shop_01", "password": "NewPassword@2026"}
    assert load_db_credentials(db) == ("dms_shop_01", "NewPassword@2026")


def test_vinamilk_credentials_migration_upgrade_downgrade():
    migration_path = (
        Path(__file__).parents[1]
        / "app"
        / "db"
        / "migrations"
        / "versions"
        / "20261111_vinamilk_credentials.py"
    )
    spec = spec_from_file_location("vnm_cred_mig", migration_path)
    assert spec and spec.loader
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            assert "vinamilk_credentials" in inspect(conn).get_table_names()
            migration.downgrade()
            assert "vinamilk_credentials" not in inspect(conn).get_table_names()
    engine.dispose()
