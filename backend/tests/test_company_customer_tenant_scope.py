from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.companies import (
    create_company,
    delete_company,
    get_company,
    list_companies,
)
from app.api.v1.endpoints.customers import (
    create_customer,
    get_customer,
    list_customers,
)
from app.core.database import Base
from app.models.multi_tenant_invoice import Distributor
from app.schemas.company import CompanyCreate
from app.schemas.customer import CustomerCreate


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


def _user(distributor_id: int | None, username: str = "npp_user", roles=None):
    return SimpleNamespace(
        id=1,
        distributor_id=distributor_id,
        username=username,
        roles=roles or [],
    )


def test_companies_and_customers_isolated_per_distributor(db_session):
    db, dist_a, dist_b = db_session
    user_a = _user(dist_a.id, username="user_a")
    user_b = _user(dist_b.id, username="user_b")
    super_admin = _user(None, username="admin")

    # 1. Hai NPP khác nhau có thể cùng dùng mã công ty CT001
    comp_a = create_company(
        CompanyCreate(code="CT001", name="Công ty con A1", tax_code="0100000001"),
        db=db,
        current_user=user_a,
    )
    comp_b = create_company(
        CompanyCreate(code="CT001", name="Công ty con B1", tax_code="0100000002"),
        db=db,
        current_user=user_b,
    )
    assert comp_a.distributor_id == dist_a.id
    assert comp_b.distributor_id == dist_b.id

    # Trùng mã trong CÙNG 1 NPP phải báo 409
    with pytest.raises(HTTPException) as exc:
        create_company(
            CompanyCreate(code="CT001", name="Trùng mã A"),
            db=db,
            current_user=user_a,
        )
    assert exc.value.status_code == 409

    # 2. Hai NPP khác nhau có thể cùng dùng mã khách hàng KH001
    cust_a = create_customer(
        CustomerCreate(code="KH001", name="Khách hàng A1", company_id=comp_a.id),
        db=db,
        current_user=user_a,
    )
    cust_b = create_customer(
        CustomerCreate(code="KH001", name="Khách hàng B1", company_id=comp_b.id),
        db=db,
        current_user=user_b,
    )
    assert cust_a.distributor_id == dist_a.id
    assert cust_b.distributor_id == dist_b.id

    # 3. Cô lập danh sách: User A chỉ thấy dữ liệu NPP A; Super Admin thấy cả 2 và lọc được
    list_a = list_companies(distributor_id=None, q=None, db=db, current_user=user_a)
    assert [c.id for c in list_a] == [comp_a.id]
    assert list_a[0].customer_count == 1

    list_all = list_companies(distributor_id=None, q=None, db=db, current_user=super_admin)
    assert {c.id for c in list_all} == {comp_a.id, comp_b.id}

    list_b_by_admin = list_companies(distributor_id=dist_b.id, q=None, db=db, current_user=super_admin)
    assert [c.id for c in list_b_by_admin] == [comp_b.id]

    custs_a = list_customers(distributor_id=None, company_id=None, q=None, db=db, current_user=user_a)
    assert [c.id for c in custs_a] == [cust_a.id]

    # 4. User A cố truy cập / xóa bản ghi của NPP B phải bị chặn 403
    with pytest.raises(HTTPException) as exc:
        list_companies(distributor_id=dist_b.id, q=None, db=db, current_user=user_a)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        get_company(comp_b.id, db=db, current_user=user_a)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        delete_company(comp_b.id, db=db, current_user=user_a)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        get_customer(cust_b.id, db=db, current_user=user_a)
    assert exc.value.status_code == 403

    # 5. Chống liên kết chéo Tenant: Khách hàng NPP A không được gắn Công ty quản lý của NPP B
    with pytest.raises(HTTPException) as exc:
        create_customer(
            CustomerCreate(code="KH002", name="Khách gắn chéo", company_id=comp_b.id),
            db=db,
            current_user=user_a,
        )
    assert exc.value.status_code == 400

    # 6. Super Admin tạo mới nhưng không chỉ định distributor_id phải báo 400
    with pytest.raises(HTTPException) as exc:
        create_company(
            CompanyCreate(code="CT999", name="Không có NPP"),
            db=db,
            current_user=super_admin,
        )
    assert exc.value.status_code == 400
