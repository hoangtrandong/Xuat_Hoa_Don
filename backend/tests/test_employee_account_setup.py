"""Tests for employee account provisioning (login by employee code) and password reset."""
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.employees import (
    create_employee,
    download_employee_template,
    setup_or_update_employee_account,
    upload_employees,
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


def test_employee_excel_template_and_upload_with_accounts(db_session):
    _, admin_user = _seed(db_session)

    # 1. File mẫu có cột Tạo tài khoản và Mật khẩu
    tpl = download_employee_template()
    wb_tpl = load_workbook(BytesIO(tpl.body))
    headers = [c.value for c in wb_tpl.active[1]]
    assert "Tạo tài khoản" in headers
    assert "Mật khẩu" in headers

    # 2. Upload Excel tạo 2 nhân viên có tài khoản + 1 nhân viên không tạo tài khoản
    wb = Workbook()
    ws = wb.active
    ws.append([
        "Mã nhân viên", "Họ và tên", "Tên gọi", "Vị trí", "Số điện thoại",
        "Email", "Mục tiêu tháng", "Hạn mức nợ", "Trạng thái", "Tạo tài khoản", "Mật khẩu",
    ])
    ws.append(["KT02", "Lê Kế Toán", "Lê KT", "Kế toán", "0901111222", "", 0, 500000000, "active", "Có", "Kt02@123"])
    ws.append(["NVGH09", "Phạm Giao Hàng", "Phạm xe", "Đội xe", "0903333444", "", 0, 500000000, "active", "", "Gh09@123"])
    ws.append(["NVGH10", "Trần Chưa TK", "", "Đội xe", "0905555666", "", 0, 500000000, "active", "", ""])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    res = upload_employees(
        file=UploadFile(filename="nv.xlsx", file=buf),
        db=db_session,
        current_user=admin_user,
    )
    assert res["created"] == 3
    assert res["accounts_created"] == 2

    u1 = db_session.scalar(select(User).where(User.username == "KT02"))
    u2 = db_session.scalar(select(User).where(User.username == "NVGH09"))
    u3 = db_session.scalar(select(User).where(User.username == "NVGH10"))
    assert u1 is not None and verify_password("Kt02@123", u1.hashed_password)
    assert u2 is not None and verify_password("Gh09@123", u2.hashed_password)
    assert u3 is None
