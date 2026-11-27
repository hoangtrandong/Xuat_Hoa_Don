"""Tests for employee account provisioning (login by employee code) and password reset."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.employees import (
    create_employee,
    setup_or_update_employee_account,
)
from app.core.auth import verify_password
from app.core.database import Base
from app.models.multi_tenant_invoice import Distributor
from app.models.user import Role, User
from app.schemas.employee import EmployeeAccountSetupRequest, EmployeeCreateRequest


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _seed(db):
    dist = Distributor(code="NPP01", name="NPP Test", tax_code="0100000001")
    db.add(dist)
    db.add_all([
        Role(name="admin", description="Admin"),
        Role(name="accountant", description="Kế toán"),
        Role(name="staff", description="Nhân viên"),
    ])
    db.commit()
    admin_user = SimpleNamespace(id=1, username="admin", distributor_id=dist.id)
    return dist, admin_user


def test_create_employee_with_custom_password(db_session):
    dist, admin_user = _seed(db_session)

    res = create_employee(
        payload=EmployeeCreateRequest(
            code="KT01",
            name="Vũ Thị Lê",
            position="Kế toán",
            phone="0901234567",
            create_account=True,
            account_password="Kt01@2026",
        ),
        db=db_session,
        current_user=admin_user,
    )
    assert res.account_username == "KT01"
    assert res.account_is_active is True
    assert res.initial_username == "KT01"
    assert res.initial_password == "Kt01@2026"

    user = db_session.scalar(select(User).where(User.username == "KT01"))
    assert user is not None
    assert user.employee_id == res.id
    assert user.distributor_id == dist.id
    assert verify_password("Kt01@2026", user.hashed_password)
    assert any(r.name == "accountant" for r in user.roles)


def test_provision_and_reset_password_and_lock_existing_employee(db_session):
    _, admin_user = _seed(db_session)

    # 1. Tạo nhân viên chưa có tài khoản
    emp = create_employee(
        payload=EmployeeCreateRequest(
            code="NVGH05",
            name="Nguyễn Văn Giao",
            position="Nhân viên giao hàng",
            create_account=False,
        ),
        db=db_session,
        current_user=admin_user,
    )
    assert emp.account_username is None

    # 2. Cấp tài khoản với mật khẩu tự sinh
    provisioned = setup_or_update_employee_account(
        employee_id=emp.id,
        payload=EmployeeAccountSetupRequest(password=None),
        db=db_session,
        current_user=admin_user,
    )
    assert provisioned.account_username == "NVGH05"
    assert provisioned.account_is_active is True
    assert provisioned.initial_username == "NVGH05"
    assert provisioned.initial_password and len(provisioned.initial_password) >= 12

    # 3. Đặt lại mật khẩu thủ công + khóa tài khoản
    updated = setup_or_update_employee_account(
        employee_id=emp.id,
        payload=EmployeeAccountSetupRequest(password="NewPass123", is_active=False),
        db=db_session,
        current_user=admin_user,
    )
    assert updated.account_is_active is False
    assert updated.initial_password == "NewPass123"
    user = db_session.scalar(select(User).where(User.username == "NVGH05"))
    assert user is not None
    assert user.is_active is False
    assert verify_password("NewPass123", user.hashed_password)

    # 4. Mật khẩu dưới 6 ký tự bị từ chối
    with pytest.raises(HTTPException) as exc:
        setup_or_update_employee_account(
            employee_id=emp.id,
            payload=EmployeeAccountSetupRequest(password="12345"),
            db=db_session,
            current_user=admin_user,
        )
    assert exc.value.status_code == 400
