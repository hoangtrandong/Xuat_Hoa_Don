from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.delivery_requests import create_request_from_orders
from app.core.database import Base
from app.crud.vehicle import create_vehicle
from app.models.customer import Customer, Store
from app.models.employee import Employee
from app.models.inventory import (
    DeliveryRequestOrderItem,
    InventoryLot,
    Warehouse,
    WarehouseLocation,
)
from app.models.product import Product, ProductCategory, ProductGroup, ProductGroupItem, ProductUnit
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.user import User
from app.schemas.delivery_request import DeliveryRequestFromOrdersCreate, OrderDispatchAllocation
from app.schemas.vehicle import VehicleCreate


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        wh = Warehouse(code="WH-P2", name="Kho P2", location="HCM")
        session.add(wh)
        session.flush()
        loc = WarehouseLocation(warehouse_id=wh.id, code="A-01", name="Ke A1", is_active=True)
        session.add(loc)
        session.flush()

        cat = ProductCategory(code="CAT-1", name="Sua")
        unit = ProductUnit(code="HOP", name="Hop")
        session.add_all([cat, unit])
        session.flush()

        prod = Product(
            sku="SKU-P2-01",
            name="Sua Dac 380g",
            category_id=cat.id,
            unit_id=unit.id,
            boxes_per_carton=24,
            cost_price=20000,
            base_price=25000,
        )
        session.add(prod)
        session.flush()
        grp = ProductGroup(name="Sua Dac 380g", representative_product_id=prod.id)
        session.add(grp)
        session.flush()
        session.add(ProductGroupItem(product_group_id=grp.id, product_id=prod.id))

        store = Store(code="ST-P2", name="Cua Hang P2")
        session.add(store)
        session.flush()
        cust = Customer(code="KH-P2", name="Khach Hang P2", type="RETAIL", store_id=store.id)
        emp = Employee(code="NV-P2", name="NV Giao P2", position="Delivery", phone="0903333333")
        driver = Employee(code="TX-P2", name="Tai Xe P2", position="Driver", phone="0904444444")
        session.add_all([cust, emp, driver])
        session.flush()

        lot = InventoryLot(
            warehouse_id=wh.id,
            location_id=loc.id,
            product_id=prod.id,
            lot_number="LOT-P2",
            expiry_date=datetime.utcnow() + timedelta(days=60),
            quantity_on_hand=10,
            locked_quantity=0,
        )
        session.add(lot)
        session.commit()
        yield session, wh, prod, store, cust, emp, driver
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_from_orders_hard_blocks_shortage_and_binds_vehicle_and_order_items(db):
    session, wh, prod, store, cust, emp, driver = db
    vehicle = create_vehicle(
        session,
        VehicleCreate(
            code="XE-P2",
            plate_number="51D-999.99",
            name="Xe tai 1.5T",
            max_weight_kg=1500,
            default_driver_id=driver.id,
        ),
    )

    # Order requiring 15 units (warehouse only has 10) -> MUST HARD BLOCK (D1)
    so_big = SalesOrder(
        code="SO-BIG-01",
        customer_id=cust.id,
        employee_id=emp.id,
        warehouse_id=wh.id,
        status="PENDING",
        subtotal=375000,
        total=375000,
    )
    session.add(so_big)
    session.flush()
    session.add(SalesOrderItem(order_id=so_big.id, product_id=prod.id, quantity=15, price=25000, line_total=375000))
    session.commit()

    fake_user = User(username="dispatcher", hashed_password="x", full_name="Dispatcher")
    with pytest.raises(HTTPException) as exc_info:
        create_request_from_orders(
            DeliveryRequestFromOrdersCreate(
                warehouse_id=wh.id,
                vehicle_id=vehicle["id"],
                allocations=[OrderDispatchAllocation(sales_order_id=so_big.id, employee_id=emp.id)],
            ),
            db=session,
            current_user=fake_user,
        )
    assert exc_info.value.status_code == 400
    assert "Không đủ 100% tồn kho khả dụng" in exc_info.value.detail

    # Order requiring 8 units (<= 10 available) -> SUCCEEDS, auto-fills default driver, saves order_items & approves SO
    so_ok = SalesOrder(
        code="SO-OK-01",
        customer_id=cust.id,
        employee_id=emp.id,
        warehouse_id=wh.id,
        status="PENDING",
        subtotal=200000,
        total=200000,
    )
    session.add(so_ok)
    session.flush()
    session.add(SalesOrderItem(order_id=so_ok.id, product_id=prod.id, quantity=8, price=25000, line_total=200000))
    session.commit()

    created = create_request_from_orders(
        DeliveryRequestFromOrdersCreate(
            warehouse_id=wh.id,
            vehicle_id=vehicle["id"],
            route_code="TUYEN-Q1",
            planned_weight_kg=450,
            allocations=[OrderDispatchAllocation(sales_order_id=so_ok.id, employee_id=emp.id)],
        ),
        db=session,
        current_user=fake_user,
    )
    assert created.vehicle_id == vehicle["id"]
    assert created.driver_id == driver.id  # Auto-filled from vehicle.default_driver_id
    assert created.route_code == "TUYEN-Q1"
    assert float(created.planned_weight_kg) == 450.0
    assert len(created.orders) == 1
    dro = created.orders[0]
    assert dro.source_type == "SALES_ORDER"
    assert dro.source_order_id == so_ok.id
    assert dro.store_id == store.id

    dro_items = session.scalars(
        select(DeliveryRequestOrderItem).where(DeliveryRequestOrderItem.delivery_request_order_id == dro.id)
    ).all()
    assert len(dro_items) == 1
    assert dro_items[0].ordered_qty == 8

    session.refresh(so_ok)
    assert so_ok.status == "APPROVED"
