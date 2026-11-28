from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.sales import change_order_customer
from app.api.v1.endpoints.sync import OrderCustomerUpdateRequest, update_vinamilk_order_customer
from app.core.database import Base
from app.models.customer import Customer, Store
from app.models.inventory import DeliveryRequest, DeliveryRequestOrder, Warehouse
from app.models.sales import SalesOrder
from app.models.user import User
from app.models.vinamilk import VinamilkOrderSnapshot
from app.schemas.sales import SalesOrderChangeCustomerRequest


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        wh = Warehouse(code="WH-C1", name="Kho C1", location="HCM")
        st1 = Store(code="ST-OLD", name="Cua Hang Cu", address="123 Duong Cu")
        st2 = Store(code="ST-NEW", name="Cua Hang Moi", address="456 Duong Moi")
        session.add_all([wh, st1, st2])
        session.flush()

        c1 = Customer(code="KH-OLD", name="Khach Hang Cu", type="RETAIL", store_id=st1.id)
        c2 = Customer(code="KH-NEW", name="Khach Hang Moi", type="RETAIL", store_id=st2.id)
        session.add_all([c1, c2])
        session.commit()
        yield session, wh, st1, st2, c1, c2
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_change_vinamilk_order_customer_updates_snapshots_and_syncs_delivery_and_sales_order(db):
    session, wh, _, st2, c1, c2 = db
    snap1 = VinamilkOrderSnapshot(
        remote_key="K1",
        order_number="DH-DMS-001",
        customer_code="KH-OLD",
        customer_name="Khach Hang Cu",
        synced_from=date.today(),
        synced_to=date.today(),
        raw_payload={"customerCode": "KH-OLD", "customerName": "Khach Hang Cu", "Mã KH": "KH-OLD"},
    )
    snap2 = VinamilkOrderSnapshot(
        remote_key="K2",
        order_number="DH-DMS-001",
        customer_code="KH-OLD",
        customer_name="Khach Hang Cu",
        synced_from=date.today(),
        synced_to=date.today(),
        raw_payload={"customerCode": "KH-OLD", "customerName": "Khach Hang Cu", "Mã KH": "KH-OLD"},
    )
    dr = DeliveryRequest(code="DR-C1", warehouse_id=wh.id, status="SUBMITTED")
    session.add_all([snap1, snap2, dr])
    session.flush()

    dro = DeliveryRequestOrder(
        delivery_request_id=dr.id,
        order_number="DH-DMS-001",
        employee_code="NV01",
        customer_code="KH-OLD",
        customer_name="Khach Hang Cu",
        amount=500000,
        payment_status="UNPAID",
    )
    so = SalesOrder(
        code="DH-DMS-001",
        customer_id=c1.id,
        warehouse_id=wh.id,
        status="PENDING",
        subtotal=500000,
        total=500000,
    )
    session.add_all([dro, so])
    session.commit()

    actor = User(username="accountant", hashed_password="x", full_name="Accountant")
    res = update_vinamilk_order_customer(
        order_number="DH-DMS-001",
        payload=OrderCustomerUpdateRequest(customer_code="kh-new"),
        db=session,
        current_user=actor,
    )
    assert res["customer_code"] == "KH-NEW"
    assert res["customer_name"] == "Khach Hang Moi"
    assert res["updated_lines"] == 2

    session.refresh(snap1)
    session.refresh(snap2)
    assert snap1.customer_code == "KH-NEW"
    assert snap2.customer_code == "KH-NEW"
    assert snap1.raw_payload["originalCustomerCode"] == "KH-OLD"
    assert snap1.raw_payload["customerCode"] == "KH-NEW"
    assert snap1.raw_payload["Mã KH"] == "KH-NEW"

    session.refresh(dro)
    assert dro.customer_code == "KH-NEW"
    assert dro.customer_name == "Khach Hang Moi"
    assert dro.store_id == st2.id

    session.refresh(so)
    assert so.customer_id == c2.id


def test_change_sales_order_customer_and_block_completed(db):
    session, wh, _, st2, c1, c2 = db
    so = SalesOrder(
        code="SO-CHG-01",
        customer_id=c1.id,
        warehouse_id=wh.id,
        status="PENDING",
        subtotal=100000,
        total=100000,
    )
    session.add(so)
    session.commit()

    actor = User(username="sales01", hashed_password="x", full_name="Sales")
    updated = change_order_customer(
        order_id=so.id,
        payload=SalesOrderChangeCustomerRequest(customer_id=c2.id),
        current_user=actor,
        db=session,
    )
    assert updated.customer_id == c2.id

    # Completed order must be blocked
    so.status = "COMPLETED"
    session.commit()
    with pytest.raises(HTTPException) as exc:
        change_order_customer(
            order_id=so.id,
            payload=SalesOrderChangeCustomerRequest(customer_id=c1.id),
            current_user=actor,
            db=session,
        )
    assert exc.value.status_code == 400
    assert "không thể đổi mã khách hàng" in exc.value.detail
