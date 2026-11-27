"""Tests for batch dispatch (creating consolidated DeliveryRequest from multiple SalesOrders)."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.delivery_requests import (
    create_request_from_orders,
    list_dispatch_pool_orders,
    plan_request,
)
from app.core.database import Base
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.inventory import InventoryLot, Warehouse, WarehouseLocation
from app.models.product import Product, ProductCategory, ProductGroup, ProductGroupItem, ProductUnit
from app.models.sales import SalesOrder, SalesOrderItem
from app.schemas.delivery_request import (
    DeliveryRequestCreate,
    DeliveryRequestFromOrdersCreate,
    DeliveryRequestItemCreate,
    OrderDispatchAllocation,
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


def _seed_dispatch_data(db):
    wh = Warehouse(code="KHO1", name="Kho Trung Tâm", location="HN")
    db.add(wh)
    db.flush()

    loc_a = WarehouseLocation(warehouse_id=wh.id, code="A1-01", name="Kệ A1")
    loc_b = WarehouseLocation(warehouse_id=wh.id, code="B2-01", name="Kệ B2")
    cat = ProductCategory(code="SUA", name="Sữa")
    unit = ProductUnit(code="HOP", name="Hộp")
    db.add_all([loc_a, loc_b, cat, unit])
    db.flush()

    p1 = Product(
        sku="01TD03",
        name="Sữa tươi 180ml",
        category_id=cat.id,
        unit_id=unit.id,
        boxes_per_carton=48,
        base_price=10000,
        _npp_code="01TD03",
    )
    p2 = Product(
        sku="07KD12",
        name="Sữa chua ăn 100g",
        category_id=cat.id,
        unit_id=unit.id,
        boxes_per_carton=48,
        base_price=8000,
        _npp_code="07KD12",
    )
    db.add_all([p1, p2])
    db.flush()

    g1 = ProductGroup(name="Nhóm 01TD03", representative_product_id=p1.id)
    g2 = ProductGroup(name="Nhóm 07KD12", representative_product_id=p2.id)
    db.add_all([g1, g2])
    db.flush()
    db.add_all([
        ProductGroupItem(product_group_id=g1.id, product_id=p1.id),
        ProductGroupItem(product_group_id=g2.id, product_id=p2.id),
    ])
    db.flush()

    # Tồn kho 2 lô HSD khác nhau để test FEFO
    db.add_all([
        InventoryLot(
            warehouse_id=wh.id,
            location_id=loc_a.id,
            product_id=p1.id,
            lot_number="LOT-EARLY",
            expiry_date=datetime.utcnow() + timedelta(days=30),
            quantity_on_hand=20,
        ),
        InventoryLot(
            warehouse_id=wh.id,
            location_id=loc_b.id,
            product_id=p1.id,
            lot_number="LOT-LATE",
            expiry_date=datetime.utcnow() + timedelta(days=90),
            quantity_on_hand=50,
        ),
        InventoryLot(
            warehouse_id=wh.id,
            location_id=loc_a.id,
            product_id=p2.id,
            lot_number="LOT-P2",
            expiry_date=datetime.utcnow() + timedelta(days=45),
            quantity_on_hand=100,
        ),
    ])

    emp1 = Employee(code="NVGH01", name="Nguyễn Giao 1", position="Nhân viên giao hàng", phone="0901")
    emp2 = Employee(code="NVGH02", name="Trần Giao 2", position="Nhân viên giao hàng", phone="0902")
    cust1 = Customer(code="KH001", name="Tạp hóa Minh Anh", type="RETAIL")
    cust2 = Customer(code="KH002", name="Siêu thị Mini Hoa", type="RETAIL")
    db.add_all([emp1, emp2, cust1, cust2])
    db.flush()

    so1 = SalesOrder(
        code="SO-001",
        customer_id=cust1.id,
        warehouse_id=wh.id,
        status="APPROVED",
        total=200000,
    )
    so2 = SalesOrder(
        code="SO-002",
        customer_id=cust2.id,
        warehouse_id=wh.id,
        status="APPROVED",
        total=260000,
    )
    db.add_all([so1, so2])
    db.flush()

    db.add_all([
        SalesOrderItem(order_id=so1.id, product_id=p1.id, quantity=15, price=10000, line_total=150000),
        SalesOrderItem(order_id=so1.id, product_id=p2.id, quantity=10, price=5000, line_total=50000),
        SalesOrderItem(order_id=so2.id, product_id=p1.id, quantity=15, price=10000, line_total=150000),
        SalesOrderItem(order_id=so2.id, product_id=p2.id, quantity=20, price=5500, line_total=110000),
    ])
    db.commit()

    admin_user = SimpleNamespace(id=1, username="admin", roles=[SimpleNamespace(name="admin")])
    return wh, p1, p2, emp1, emp2, so1, so2, admin_user


def test_dispatch_pool_batch_creation_fefo_and_duplicate_guard(db_session):
    wh, p1, p2, emp1, emp2, so1, so2, admin_user = _seed_dispatch_data(db_session)

    # 1. Pool ban đầu có cả 2 đơn
    pool = list_dispatch_pool_orders(db=db_session, current_user=admin_user)
    assert {o.code for o in pool} == {"SO-001", "SO-002"}

    # 2. Check FEFO cho đơn tổng (p1 = 30 -> lấy 20 từ LOT-EARLY ở A1-01 + 10 từ LOT-LATE ở B2-01)
    fefo = plan_request(
        DeliveryRequestCreate(
            warehouse_id=wh.id,
            items=[
                DeliveryRequestItemCreate(product_id=p1.id, quantity=30),
                DeliveryRequestItemCreate(product_id=p2.id, quantity=30),
            ],
        ),
        db=db_session,
    )
    p1_plan = next(item for item in fefo if item.product_id == p1.id)
    assert p1_plan.shortage_quantity == 0
    assert len(p1_plan.picks) == 2
    assert p1_plan.picks[0].lot_number == "LOT-EARLY"
    assert p1_plan.picks[0].quantity == 20
    assert p1_plan.picks[1].lot_number == "LOT-LATE"
    assert p1_plan.picks[1].quantity == 10

    # 3. Gom 2 đơn vào Đợt 1 và phân bổ cho 2 NVGH
    batch = create_request_from_orders(
        payload=DeliveryRequestFromOrdersCreate(
            warehouse_id=wh.id,
            note="Đợt 1 - Sáng",
            allocations=[
                OrderDispatchAllocation(sales_order_id=so1.id, employee_id=emp1.id),
                OrderDispatchAllocation(sales_order_id=so2.id, employee_id=emp2.id),
            ],
        ),
        db=db_session,
        current_user=admin_user,
    )
    assert batch.status == "DRAFT"
    assert len(batch.items) == 2
    item_p1 = next(it for it in batch.items if it.product_id == p1.id)
    assert item_p1.quantity == 30
    assert item_p1.employee_allocations == {"NVGH01": 15, "NVGH02": 15}
    assert len(batch.orders) == 2
    assert len(batch.employee_summaries) == 2

    # 4. Pool chờ điều phối không còn 2 đơn đã gom (chống giao trùng)
    pool_after = list_dispatch_pool_orders(db=db_session, current_user=admin_user)
    assert pool_after == []

    # 5. Cố tình gom lại đơn đã có đợt -> báo lỗi 409
    with pytest.raises(HTTPException) as exc:
        create_request_from_orders(
            payload=DeliveryRequestFromOrdersCreate(
                warehouse_id=wh.id,
                allocations=[OrderDispatchAllocation(sales_order_id=so1.id, employee_id=emp1.id)],
            ),
            db=db_session,
            current_user=admin_user,
        )
    assert exc.value.status_code == 409
