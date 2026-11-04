from datetime import date

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
from app.core.database import Base
from app.models.customer import Customer
from app.models.product import Product, ProductCategory, ProductUnit
from app.models.vinamilk import VinamilkOrderSnapshot


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
                             staff_name="Phạm Thị Lê"))
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
