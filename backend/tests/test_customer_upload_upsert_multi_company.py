from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.companies import create_company, list_companies
from app.api.v1.endpoints.customers import (
    BulkAssignCompanyPayload,
    bulk_assign_company,
    create_customer,
    list_customers,
    update_customer,
    upload_customers,
)
from app.core.database import Base
from app.models.multi_tenant_invoice import Distributor
from app.schemas.company import CompanyCreate
from app.schemas.customer import CustomerCreate, CustomerUpdate


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        dist_a = Distributor(code="NPP-A", name="Nhà phân phối A", tax_code="0100000001")
        dist_b = Distributor(code="NPP-B", name="Nhà phân phối B", tax_code="0100000002")
        db.add_all([dist_a, dist_b])
        db.commit()
        db.refresh(dist_a)
        db.refresh(dist_b)
        yield db, dist_a, dist_b
    finally:
        db.close()


def _user(distributor_id: int | None, username: str = "npp_user"):
    return SimpleNamespace(id=1, distributor_id=distributor_id, username=username, roles=[])


def _make_excel_upload(rows: list[list], filename: str = "customers.xlsx") -> UploadFile:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return UploadFile(filename=filename, file=buf)


def test_upload_upsert_and_multi_company(db_session):
    db, dist_a, _ = db_session
    user_a = _user(dist_a.id)

    comp1 = create_company(CompanyCreate(code="CT001", name="Công ty A1", tax_code="0100000011"), db=db, current_user=user_a)
    comp2 = create_company(CompanyCreate(code="CT002", name="Công ty A2", tax_code="0100000012"), db=db, current_user=user_a)
    comp3 = create_company(CompanyCreate(code="CT003", name="Công ty A3", tax_code="0100000013"), db=db, current_user=user_a)

    # 1. Lần upload đầu: thêm mới 2 khách hàng
    #    - KH-001 khai báo 2 công ty trong 1 ô ("CT001, CT002")
    #    - KH-002 khai báo trên 2 dòng khác nhau trong cùng file (CT001 và CT003)
    file1 = _make_excel_upload([
        ["Mã KH", "Tên khách hàng", "Loại", "Email", "Mã số thuế", "Trạng thái", "Mã công ty quản lý"],
        ["KH-001", "Cửa hàng Mai Linh", "RETAIL", "mailinh@example.com", "8000000001", "active", "CT001, CT002"],
        ["KH-002", "Đại lý Hưng Thịnh", "WHOLESALE", "ht@example.com", "8000000002", "active", "CT001"],
        ["KH-002", "Đại lý Hưng Thịnh", "WHOLESALE", "", "", "active", "CT003"],
    ])
    res1 = upload_customers(file=file1, distributor_id=dist_a.id, db=db, current_user=user_a)
    assert res1["created"] == 2
    assert res1["updated"] == 0
    assert res1["imported"] == 2

    custs = {c.code: c for c in list_customers(distributor_id=None, company_id=None, q=None, db=db, current_user=user_a)}
    assert set(custs["KH-001"].company_ids) == {comp1.id, comp2.id}
    assert set(custs["KH-002"].company_ids) == {comp1.id, comp3.id}

    # Kiểm tra lọc theo từng công ty quản lý & customer_count trên danh sách công ty
    by_comp1 = list_customers(distributor_id=None, company_id=comp1.id, q=None, db=db, current_user=user_a)
    by_comp2 = list_customers(distributor_id=None, company_id=comp2.id, q=None, db=db, current_user=user_a)
    by_comp3 = list_customers(distributor_id=None, company_id=comp3.id, q=None, db=db, current_user=user_a)
    assert {c.code for c in by_comp1} == {"KH-001", "KH-002"}
    assert {c.code for c in by_comp2} == {"KH-001"}
    assert {c.code for c in by_comp3} == {"KH-002"}

    comps_map = {c.code: c for c in list_companies(distributor_id=None, q=None, db=db, current_user=user_a)}
    assert comps_map["CT001"].customer_count == 2
    assert comps_map["CT002"].customer_count == 1
    assert comps_map["CT003"].customer_count == 1

    # 2. Lần upload thứ 2 (mặc định append — giữ công ty cũ và bổ sung công ty mới):
    #    - KH-001 đã tồn tại (đang có CT001, CT002) -> cập nhật tên, loại (tiếng Việt), trạng thái (tiếng Việt),
    #      giữ nguyên email (ô trống), và bổ sung thêm CT003 -> thành [CT001, CT002, CT003]
    #    - KH-003 chưa tồn tại -> thêm mới với 2 công ty (CT002; CT003)
    file2 = _make_excel_upload([
        ["Mã KH", "Tên khách hàng", "Loại", "Email", "Mã số thuế", "Trạng thái", "Mã công ty quản lý"],
        ["KH-001", "Cửa hàng Mai Linh (Mới)", "Đại lý", "", "8000000099", "Ngưng giao", "CT003"],
        ["KH-003", "Siêu thị An Khang", "Cửa hàng", "ak@example.com", "8000000003", "Hoạt động", "CT002; CT003"],
    ])
    res2 = upload_customers(
        file=file2,
        distributor_id=dist_a.id,
        db=db,
        current_user=user_a,
    )
    assert res2["created"] == 1
    assert res2["updated"] == 1
    assert res2["imported"] == 2

    custs = {c.code: c for c in list_customers(distributor_id=None, company_id=None, q=None, db=db, current_user=user_a)}
    kh1 = custs["KH-001"]
    assert kh1.name == "Cửa hàng Mai Linh (Mới)"
    assert kh1.type == "WHOLESALE"
    assert kh1.status == "inactive"
    assert kh1.tax_code == "8000000099"
    assert kh1.email == "mailinh@example.com"  # ô trống không xóa dữ liệu cũ
    assert kh1.company_ids == [comp1.id, comp2.id, comp3.id]

    kh3 = custs["KH-003"]
    assert kh3.type == "RETAIL"
    assert kh3.status == "active"
    assert set(kh3.company_ids) == {comp2.id, comp3.id}

    # 3. Lần upload thứ 3 (chỉ 2 cột Mã KH + Mã công ty quản lý, mặc định append):
    #    - KH-003 đang có [CT002, CT003], upload thêm CT001 -> thành [CT002, CT003, CT001]
    file3 = _make_excel_upload([
        ["Mã KH", "Mã công ty quản lý"],
        ["KH-003", "CT001"],
    ])
    res3 = upload_customers(
        file=file3,
        distributor_id=dist_a.id,
        db=db,
        current_user=user_a,
    )
    assert res3["created"] == 0
    assert res3["updated"] == 1

    custs = {c.code: c for c in list_customers(distributor_id=None, company_id=None, q=None, db=db, current_user=user_a)}
    assert custs["KH-003"].company_ids == [comp2.id, comp3.id, comp1.id]


def test_crud_and_bulk_assign_multi_company_and_tenant_isolation(db_session):
    db, dist_a, dist_b = db_session
    user_a = _user(dist_a.id)
    user_b = _user(dist_b.id)

    comp_a1 = create_company(CompanyCreate(code="CT001", name="Công ty A1", tax_code="0100000021"), db=db, current_user=user_a)
    comp_a2 = create_company(CompanyCreate(code="CT002", name="Công ty A2", tax_code="0100000022"), db=db, current_user=user_a)
    comp_a3 = create_company(CompanyCreate(code="CT003", name="Công ty A3", tax_code="0100000023"), db=db, current_user=user_a)
    comp_b1 = create_company(CompanyCreate(code="CT001", name="Công ty B1", tax_code="0100000024"), db=db, current_user=user_b)

    # Tạo khách hàng gắn trực tiếp nhiều công ty
    created = create_customer(
        CustomerCreate(code="KH-MULTI", name="Khách đa công ty", company_ids=[comp_a1.id, comp_a2.id]),
        db=db,
        current_user=user_a,
    )
    assert created.company_ids == [comp_a1.id, comp_a2.id]
    assert created.company_id == comp_a1.id
    assert len(created.companies) == 2

    # Bulk assign mode="add" không xóa công ty cũ
    bulk_assign_company(
        BulkAssignCompanyPayload(customer_ids=[created.id], company_id=comp_a3.id, mode="add"),
        db=db,
        current_user=user_a,
    )
    reloaded = list_customers(distributor_id=None, company_id=None, q=None, db=db, current_user=user_a)[0]
    assert reloaded.company_ids == [comp_a1.id, comp_a2.id, comp_a3.id]

    # Cập nhật bỏ bớt công ty
    updated = update_customer(
        created.id,
        CustomerUpdate(company_ids=[comp_a2.id, comp_a3.id]),
        db=db,
        current_user=user_a,
    )
    assert updated.company_ids == [comp_a2.id, comp_a3.id]
    assert updated.company_id == comp_a2.id

    # Chống gắn chéo Tenant trong danh sách company_ids
    with pytest.raises(HTTPException) as exc:
        update_customer(
            created.id,
            CustomerUpdate(company_ids=[comp_a2.id, comp_b1.id]),
            db=db,
            current_user=user_a,
        )
    assert exc.value.status_code == 400


def test_upload_exported_customer_sheet_with_numeric_company_codes(db_session):
    db, dist_a, _ = db_session
    user_a = _user(dist_a.id)

    comp1 = create_company(
        CompanyCreate(code="2902292227", name="CÔNG TY TNHH TRUNG ĐÔNG VINAGOLD", tax_code="2902292227"),
        db=db,
        current_user=user_a,
    )
    comp2 = create_company(
        CompanyCreate(code="2902227676", name="CÔNG TY TNHH MAI GOLD", tax_code="2902227676"),
        db=db,
        current_user=user_a,
    )

    file = _make_excel_upload([
        [
            "Mã NPP", "Tên NPP", "Mã KH", "Tên khách hàng", "Mã NVQL", "Tên NVQL",
            "Loại", "Hạng", "CCCD", "Mã số thuế", "Cửa hàng", "Mã cửa hàng",
            "Tuyến", "Công ty quản lý", "Mã công ty", "Công nợ", "Trạng thái",
        ],
        [
            "NPP-MAIGOLD", "Nhà Phân Phối Mai Gold", "00J", "Châu Hà", "", "",
            "Cửa hàng", "B", "", "040194010250", "", "",
            "", "CÔNG TY TNHH TRUNG ĐÔNG VINAGOLD", 2902292227.0, 0, "Hoạt động",
        ],
        [
            "NPP-MAIGOLD", "Nhà Phân Phối Mai Gold", "00O", "Tuấn Hữu", "", "",
            "Cửa hàng", "B", "", "040081028702", "", "",
            "", "CÔNG TY TNHH TRUNG ĐÔNG VINAGOLD", 2902292227, 0, "Hoạt động",
        ],
        [
            "NPP-MAIGOLD", "Nhà Phân Phối Mai Gold", "00J", "Châu Hà", "", "",
            "Cửa hàng", "B", "", "040194010250", "", "",
            "", "CÔNG TY TNHH MAI GOLD", 2902227676.0, 0, "Hoạt động",
        ],
        [
            "NPP-MAIGOLD", "Nhà Phân Phối Mai Gold", "00O", "Tuấn Hữu", "", "",
            "Cửa hàng", "B", "", "040081028702", "", "",
            "", "CÔNG TY TNHH MAI GOLD", 2902227676, 0, "Hoạt động",
        ],
    ])
    res = upload_customers(file=file, distributor_id=dist_a.id, db=db, current_user=user_a)
    assert res["created"] == 2
    assert res["updated"] == 0

    custs = {c.code: c for c in list_customers(distributor_id=None, company_id=None, q=None, db=db, current_user=user_a)}
    assert custs["00J"].company_ids == [comp1.id, comp2.id]
    assert custs["00O"].company_ids == [comp1.id, comp2.id]
    assert custs["00J"].type == "RETAIL"
    assert custs["00J"].status == "active"

