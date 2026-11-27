"""Tests for assigning sales manager employee codes to DMS products (DistributorProduct)."""
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import UploadFile
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.product_groups import (
    create_distributor_product,
    download_distributor_product_template,
    list_distributor_products,
    update_distributor_product,
    update_dms_product_sales_managers,
    upload_distributor_products,
)
from app.core.database import Base
from app.models.employee import Employee
from app.models.multi_tenant_invoice import Distributor
from app.schemas.product_group import (
    DistributorProductCreate,
    DistributorProductManagersUpdate,
    DistributorProductUpdate,
)


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


def _seed_context(db):
    dist = Distributor(code="NPP01", name="NPP Test", tax_code="0100000001")
    db.add(dist)
    db.flush()

    emp1 = Employee(
        code="NV001",
        vinamilk_code="DMS001",
        name="Nguyễn Văn An",
        nickname="Anh An",
        position="Nhân viên bán hàng",
        phone="0901111111",
        email="an@congty.vn",
        status="active",
    )
    emp2 = Employee(
        code="NV002",
        vinamilk_code="DMS002",
        name="Trần Thị Bình",
        position="Nhân viên bán hàng",
        phone="0902222222",
        status="active",
    )
    db.add_all([emp1, emp2])
    db.commit()

    user = SimpleNamespace(
        id=1,
        role="admin",
        distributor_id=dist.id,
        is_superadmin=False,
    )
    return dist, user


def test_create_update_patch_sales_managers_on_dms_product(db_session):
    dist, user = _seed_context(db_session)

    created = create_distributor_product(
        payload=DistributorProductCreate(
            distributor_id=dist.id,
            distributor_sku="01TD03",
            distributor_product_name="Sữa tươi 180ml",
            sales_manager_codes="nv001, NV002, nv001, NV999",
        ),
        db=db_session,
        current_user=user,
    )
    assert created.sales_manager_codes == ["NV001", "NV002", "NV999"]
    assert len(created.sales_managers) == 3
    assert created.sales_managers[0].matched is True
    assert created.sales_managers[0].name == "Nguyễn Văn An"
    assert created.sales_managers[0].phone == "0901111111"
    assert created.sales_managers[2].code == "NV999"
    assert created.sales_managers[2].matched is False

    # PATCH nhanh (hỗ trợ cả mã vinamilk_code DMS002)
    patched = update_dms_product_sales_managers(
        item_id=created.id,
        payload=DistributorProductManagersUpdate(sales_manager_codes=["DMS002", "NV001"]),
        db=db_session,
        current_user=user,
    )
    assert patched.sales_manager_codes == ["DMS002", "NV001"]
    assert patched.sales_managers[0].matched is True
    assert patched.sales_managers[0].employee_code == "NV002"
    assert patched.sales_managers[0].name == "Trần Thị Bình"

    # PUT cập nhật qua form sửa
    updated = update_distributor_product(
        payload=DistributorProductUpdate(
            id=created.id,
            distributor_sku="01TD03",
            distributor_product_name="Sữa tươi 180ml (Cập nhật)",
            sales_manager_codes=["NV001"],
        ),
        db=db_session,
        current_user=user,
    )
    assert updated["sales_manager_codes"] == ["NV001"]
    assert len(updated["sales_managers"]) == 1
    assert updated["sales_managers"][0]["name"] == "Nguyễn Văn An"


def test_template_and_excel_upload_with_sales_managers(db_session):
    dist, user = _seed_context(db_session)

    # 1. Template chứa cột Mã NV Quản Lý
    resp = download_distributor_product_template()
    wb_tpl = load_workbook(BytesIO(resp.body))
    headers = [c.value for c in wb_tpl.active[1]]
    assert "Mã NV Quản Lý" in headers

    # 2. Upload Excel gắn 01TD03 với NV001,NV002, NV003
    wb = Workbook()
    ws = wb.active
    ws.append([
        "STT",
        "Nhà phân phối",
        "Mã SP DMS",
        "Tên Sản Phẩm DMS",
        "Mã SP Xuất Hóa Đơn",
        "Tên Sản Phẩm Xuất Hóa Đơn",
        "Tỷ lệ quy đổi",
        "Nhà cung cấp",
        "Mã Công ty QL",
        "Tên Công ty QL",
        "Mã NV Quản Lý",
    ])
    ws.append([
        1,
        "NPP Test",
        "01TD03",
        "Sữa tươi có đường 180ml",
        "",
        "",
        "1/1",
        "Vinamilk",
        "",
        "",
        "NV001,NV002, NV003",
    ])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    upload_file = UploadFile(filename="dms_products.xlsx", file=buf)
    result = upload_distributor_products(
        file=upload_file,
        distributor_id=dist.id,
        db=db_session,
        current_user=user,
    )
    assert result["success"] is True
    assert result["added"] == 1

    items = list_distributor_products(distributor_id=dist.id, db=db_session, current_user=user)
    assert len(items) == 1
    item = items[0]
    assert item.distributor_sku == "01TD03"
    assert item.sales_manager_codes == ["NV001", "NV002", "NV003"]
    assert item.sales_managers[0].matched is True
    assert item.sales_managers[0].name == "Nguyễn Văn An"
    assert item.sales_managers[1].matched is True
    assert item.sales_managers[1].name == "Trần Thị Bình"
    assert item.sales_managers[2].matched is False
    assert item.sales_managers[2].code == "NV003"
