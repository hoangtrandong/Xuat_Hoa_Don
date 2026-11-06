from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (đăng ký toàn bộ model)
from app.api.v1.endpoints.sync import (
    ManualOrderLine,
    ManualOrderRequest,
    _create_manual_order,
    _delete_manual_order,
    list_local_vinamilk_orders,
)
from app.api.v1.endpoints.delivery_requests import submit_request
from app.core.database import Base
from app.crud import customer as customer_crud
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.inventory import DeliveryRequest, DeliveryRequestOrder, Warehouse
from app.models.product import Product, ProductCategory, ProductUnit
from app.models.promotion import Promotion, PromotionItem, PromotionRule
from app.models.vinamilk import VinamilkOrderSnapshot
from app.schemas.customer import CustomerCreate


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        cat = ProductCategory(code="SUA", name="Sữa")
        unit = ProductUnit(code="HOP", name="Hộp")
        session.add_all([cat, unit])
        session.flush()
        session.add(Product(sku="01VD41", name="SĐCĐ Ông Thọ", category_id=cat.id, unit_id=unit.id,
                            supplier="Vinamilk", base_price=4428))
        session.add(Customer(code="0MD", name="Nam thúy 1", type="RETAIL", staff_code="0000030917",
                             staff_name="Phạm Thị Lê", manager_code="NV001", manager_name="Nguyễn An"))
        session.commit()
        yield session
    engine.dispose()


def _payload(**kwargs):
    base = dict(
        customer_code="0MD",
        order_date=date(2026, 11, 4),
        lines=[ManualOrderLine(product_code="01vd41", quantity=10, discount_amount=4280)],
    )
    base.update(kwargs)
    return ManualOrderRequest(**base)


def test_create_manual_order_uses_system_customer_and_sku(db):
    result = _create_manual_order(db, _payload(), performed_by="admin")
    assert result["order_number"] == "TC-261104-001"
    assert result["total_value"] == 44280 - 4280

    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == "TC-261104-001"))
    assert row.is_synthetic is True
    assert row.raw_payload["Tên KH"] == "Nam thúy 1"
    assert row.raw_payload["Mã NVBH"] == "0000030917"
    assert row.raw_payload["Đơn giá"] == 4428
    assert row.raw_payload["ĐVT"] == "HOP"
    assert row.raw_payload["Trạng thái tạo đơn"] == "001-Xuất hàng"
    assert row.raw_payload["orderType"] == "001-Xuất hàng"

    second = _create_manual_order(db, _payload(order_type="002-Dương Số"), performed_by="admin")
    assert second["order_number"] == "TC-261104-002"
    second_row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == "TC-261104-002"))
    assert second_row.raw_payload["Trạng thái tạo đơn"] == "002-Dương Số"


def test_manual_order_shows_in_order_list_with_supplier(db):
    _create_manual_order(db, _payload(), performed_by="admin")
    res = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    rows = res["rows"]
    assert len(rows) == 1
    assert rows[0]["Số đơn hàng"] == "TC-261104-001"
    assert rows[0]["Nhà cung cấp"] == "Vinamilk"
    assert rows[0]["Tình trạng xử lý đơn hàng"] == "Đơn Tự Tạo"
    assert rows[0]["Trạng thái tạo đơn"] == "001-Xuất hàng"
    assert rows[0]["Mã NVQL"] == "NV001"
    assert rows[0]["Tên NVQL"] == "Nguyễn An"


def test_order_list_resolves_manager_by_last_three_customer_code_characters(db):
    db.add(Customer(
        code="IMV",
        name="Khách hàng khớp hậu tố",
        type="RETAIL",
        manager_code="NV002",
        manager_name="Trần Bình",
    ))
    db.add(VinamilkOrderSnapshot(
        remote_key="manager-suffix-order",
        order_number="VM-MANAGER-SUFFIX",
        customer_code="MG20031IMV",
        order_created_date=date(2026, 11, 4),
        synced_from=date(2026, 11, 4),
        synced_to=date(2026, 11, 4),
        raw_payload={"orderNumber": "VM-MANAGER-SUFFIX", "customerCode": "MG20031IMV"},
    ))
    db.commit()

    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    order = next(row for row in response["rows"] if row["orderNumber"] == "VM-MANAGER-SUFFIX")
    assert order["Mã NVQL"] == "NV002"
    assert order["Tên NVQL"] == "Trần Bình"


def test_customer_manager_assignment_requires_existing_nv_employee(db):
    db.add(Employee(code="NV003", name="Lê Cường", position="Quản lý", phone=""))
    db.commit()

    customer = customer_crud.create(
        db,
        CustomerCreate(code="MGR-1", name="Khách hàng quản lý", manager_code="nv003"),
    )
    assert customer.manager_code == "NV003"
    assert customer.manager_name == "Lê Cường"

    with pytest.raises(ValueError, match="bắt đầu bằng NV"):
        customer_crud.create(
            db,
            CustomerCreate(code="MGR-2", name="Mã không hợp lệ", manager_code="AB001"),
        )


def test_order_list_separates_processing_and_warehouse_request_statuses(db):
    warehouse = Warehouse(code="W1", name="Kho chính", location="Hà Nội")
    db.add(warehouse)
    db.flush()

    statuses = {
        "TC-REQUESTED": "DRAFT",
        "TC-APPROVED": "SUBMITTED",
        "TC-RECEIVING": "RECEIVED",
        "TC-EXPORTED": "COMPLETED",
        "TC-CANCELLED": "CANCELLED",
    }
    expected_delivery_statuses = {
        "TC-NONE": "Chưa yêu cầu",
        "TC-PENDING": "Chưa yêu cầu",
        "TC-REQUESTED": "Chờ Admin duyệt",
        "TC-APPROVED": "Đã duyệt - chờ kho nhận",
        "TC-RECEIVING": "Đã nhận - đang xuất kho",
        "TC-EXPORTED": "Đã xuất kho",
        "TC-CANCELLED": "Đã hủy yêu cầu",
    }
    order_numbers = ["TC-NONE", "TC-PENDING", *statuses]
    for order_number in order_numbers:
        db.add(VinamilkOrderSnapshot(
            remote_key=f"key-{order_number}",
            order_number=order_number,
            order_created_date=date(2026, 11, 4),
            synced_from=date(2026, 11, 4),
            synced_to=date(2026, 11, 4),
            processing_status="Đơn Tách" if order_number == "TC-NONE" else None,
            warehouse_updated=order_number == "TC-NONE",
            raw_payload={"orderNumber": order_number},
        ))
    db.flush()

    for order_number, status in statuses.items():
        request = DeliveryRequest(
            code=f"YC-{order_number}",
            warehouse_id=warehouse.id,
            status=status,
        )
        db.add(request)
        db.flush()
        db.add(DeliveryRequestOrder(
            delivery_request_id=request.id,
            order_number=order_number,
            employee_code="NV001",
        ))
    db.flush()

    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4),
        to_date=date(2026, 11, 4),
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=100,
        db=db,
    )
    rows_by_order = {row["orderNumber"]: row for row in response["rows"]}

    for order_number, expected in expected_delivery_statuses.items():
        assert rows_by_order[order_number]["Tình trạng xuất kho"] == expected
    assert rows_by_order["TC-NONE"]["Tình trạng xử lý đơn hàng"] == "Đơn Tách"
    assert rows_by_order["TC-NONE"]["Trạng thái xử lý"] == "Đơn Tách"
    assert rows_by_order["TC-NONE"]["_warehouse_updated"] is True
    assert rows_by_order["TC-PENDING"]["Tình trạng xử lý đơn hàng"] == "Chưa xử lý"


def test_admin_approval_is_required_and_recorded(db):
    warehouse = Warehouse(code="APPROVAL", name="Approval test warehouse", location="Test")
    db.add(warehouse)
    db.flush()
    request = DeliveryRequest(code="YC-APPROVAL-TEST", warehouse_id=warehouse.id, status="DRAFT")
    db.add(request)
    db.commit()

    with pytest.raises(HTTPException) as error:
        submit_request(
            request.id,
            db,
            SimpleNamespace(username="warehouse", roles=[]),
        )
    assert error.value.status_code == 403

    approved = submit_request(
        request.id,
        db,
        SimpleNamespace(username="supervisor", roles=[SimpleNamespace(name="Admin")]),
    )

    assert approved.status == "SUBMITTED"
    assert approved.approved_by == "supervisor"
    assert approved.approved_at is not None
    assert approved.submitted_at is not None


def test_manual_order_rejects_unknown_customer_or_product(db):
    with pytest.raises(HTTPException):
        _create_manual_order(db, _payload(customer_code="KHONGCO"))
    with pytest.raises(HTTPException):
        _create_manual_order(db, _payload(lines=[ManualOrderLine(product_code="XXX", quantity=1)]))


def test_delete_manual_order(db):
    _create_manual_order(db, _payload())
    assert _delete_manual_order(db, "TC-261104-001")["deleted_lines"] == 1
    with pytest.raises(HTTPException):
        _delete_manual_order(db, "IN062823")


def test_manual_order_defaults_staff_to_current_user_and_records_delivery_employee(db):
    seller = Employee(code="NV010", name="Người Bán", position="Nhân viên kinh doanh", phone="0900000010")
    shipper = Employee(code="NV020", name="Người Giao", position="Giao hàng", phone="0900000020")
    db.add_all([seller, shipper])
    db.commit()

    result = _create_manual_order(
        db,
        _payload(delivery_employee_code="nv020"),
        performed_by="nv010",
        current_employee=seller,
    )
    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"]))
    assert row.raw_payload["Mã NVBH"] == "NV010"
    assert row.raw_payload["Tên NVBH"] == "Người Bán"
    assert row.raw_payload["Mã NVGH"] == "NV020"
    assert row.raw_payload["Tên NVGH"] == "Người Giao"


def test_manual_order_rejects_unknown_delivery_employee(db):
    with pytest.raises(HTTPException) as exc:
        _create_manual_order(db, _payload(delivery_employee_code="NV999"), performed_by="admin")
    assert exc.value.status_code == 404


def test_manual_order_applies_promotion_server_side_and_saves_entry_metadata(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    product.boxes_per_carton = 10
    promotion = Promotion(
        code="KM-TEST-001",
        name="Mua thùng tặng hộp",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[
            PromotionRule(
                trigger_type="CARTON",
                min_cartons=1,
                min_qty=1,
                reward_type="FREE_QUANTITY",
                reward_value=2,
                free_quantity=2,
            )
        ],
    )
    db.add(promotion)
    db.commit()
    result = _create_manual_order(
        db,
        _payload(
            order_date=date(2026, 11, 4),
            entry_date=date(2026, 11, 5),
            sales_route="Tuyến A",
            lines=[
                ManualOrderLine(
                    product_code="01VD41",
                    quantity=10,
                    promo_quantity=999,
                    discount_amount=999999,
                    promotion_id=promotion.id,
                )
            ],
        ),
    )

    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"]))
    assert row.raw_payload["Mã CTKM"] == "KM-TEST-001"
    assert row.raw_payload["Tên CTKM"] == "Mua thùng tặng hộp"
    assert row.raw_payload["Số lượng KM"] == 2
    assert row.raw_payload["Số tiền CK"] == ""
    assert row.raw_payload["Ngày nhập"] == "05/11/2026"
    assert row.raw_payload["Tuyến bán hàng"] == "Tuyến A"


def test_manual_order_rejects_locked_promotion(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    promotion = Promotion(
        code="KM-TEST-LOCK",
        name="Đã khóa",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30),
        is_active=True,
        is_locked=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[PromotionRule(trigger_type="CARTON", min_cartons=1, min_qty=1, reward_type="FREE_QUANTITY", reward_value=1)],
    )
    db.add(promotion)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        _create_manual_order(
            db,
            _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=1, promotion_id=promotion.id)]),
        )
    assert exc.value.status_code == 400


def test_resolve_user_employee_falls_back_to_username_as_employee_code(db):
    from app.core.auth import resolve_user_employee
    from app.models.user import User

    staff = Employee(code="NV030", name="Theo Mã", position="Nhân viên kinh doanh", phone="0900000030")
    db.add(staff)
    db.commit()
    user = User(username="nv030", email="nv030@noemail.local", hashed_password="x", full_name="Theo Mã")
    assert resolve_user_employee(db, user).code == "NV030"
    assert resolve_user_employee(db, User(username="admin", email="a@a", hashed_password="x", full_name="A")) is None
