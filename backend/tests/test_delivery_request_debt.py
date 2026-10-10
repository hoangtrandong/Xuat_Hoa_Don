from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.delivery_request import create, list_, transition, update
from app.models.employee import Employee
from app.models.finance import DebtLedgerEntry
from app.models.inventory import (
    DeliveryAllocation,
    DeliveryRequest,
    DeliveryRequestEmployeeSummary,
    DeliveryRequestItem,
    InventoryTransaction,
    Warehouse,
    WarehouseLocation,
)
from app.models.product import Product, ProductCategory, ProductUnit
from app.schemas.delivery_request import (
    DeliveryRequestCreate,
    DeliveryRequestEmployeeSummaryCreate,
    DeliveryRequestItemCreate,
    DeliveryRequestList,
)
from app.api.v1.endpoints.delivery_requests import _employee_amount


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        category = ProductCategory(code="DRTEST", name="Delivery test")
        unit = ProductUnit(code="DRBOX", name="Box")
        warehouse = Warehouse(code="DRTEST", name="Delivery test", location="Test")
        employee = Employee(
            code="EMP01",
            name="Test employee",
            position="Sales",
            phone="0000000000",
        )
        session.add_all([category, unit, warehouse, employee])
        session.flush()
        product = Product(
            sku="DRTEST01",
            name="Delivery test product",
            category_id=category.id,
            unit_id=unit.id,
        )
        location = WarehouseLocation(
            warehouse_id=warehouse.id,
            code="DR-A01",
            name="Test location",
            is_active=True,
        )
        session.add_all([product, location])
        session.commit()
        yield session, warehouse, product, location, employee
    Base.metadata.drop_all(engine)
    engine.dispose()


def make_received_request(db, warehouse, product, location, employee_id, amount=12000):
    request = DeliveryRequest(
        code="DR-TEST-001",
        warehouse_id=warehouse.id,
        status="RECEIVED",
    )
    db.add(request)
    db.flush()
    item = DeliveryRequestItem(
        request_id=request.id,
        product_id=product.id,
        quantity=4,
    )
    db.add(item)
    db.flush()
    db.add(DeliveryAllocation(
        item_id=item.id,
        allocated_quantity=4,
        allocation_sequence=1,
        location_id=location.id,
    ))
    db.add(DeliveryRequestEmployeeSummary(
        delivery_request_id=request.id,
        employee_id=employee_id,
        employee_code="EMP01",
        employee_name="Test employee",
        amount=amount,
    ))
    db.commit()
    return request


def test_complete_records_employee_debt_once(db):
    session, warehouse, product, location, employee = db
    request = make_received_request(session, warehouse, product, location, employee.id)

    completed = transition(session, request.id, "complete")

    assert completed.status == "COMPLETED"
    entries = session.scalars(select(DebtLedgerEntry)).all()
    assert [(entry.party_id, entry.entry_type, Decimal(entry.amount)) for entry in entries] == [
        (employee.id, "DELIVERY_ISSUE", Decimal("12000.00"))
    ]
    transactions = session.scalars(select(InventoryTransaction)).all()
    assert len(transactions) == 1
    assert transactions[0].quantity == -4

    with pytest.raises(ValueError, match="đang ở trạng thái COMPLETED"):
        transition(session, request.id, "complete")
    assert session.scalar(select(DebtLedgerEntry.id)) == entries[0].id


def test_complete_rolls_back_stock_and_debt_if_employee_is_unlinked(db):
    session, warehouse, product, location, _ = db
    request = make_received_request(session, warehouse, product, location, None)

    with pytest.raises(ValueError, match="chưa được liên kết"):
        transition(session, request.id, "complete")

    session.refresh(request)
    assert request.status == "RECEIVED"
    assert session.scalar(select(InventoryTransaction.id)) is None
    assert session.scalar(select(DebtLedgerEntry.id)) is None


def test_create_rejects_unmapped_employee_in_debt_summary(db):
    session, warehouse, product, _, _ = db
    payload = DeliveryRequestCreate(
        warehouse_id=warehouse.id,
        items=[DeliveryRequestItemCreate(product_id=product.id, quantity=1)],
        employee_summaries=[
            DeliveryRequestEmployeeSummaryCreate(
                employee_code="UNKNOWN",
                amount=1000,
            )
        ],
    )

    with pytest.raises(ValueError, match="Không tìm thấy nhân viên UNKNOWN"):
        create(session, payload)


def test_update_rejects_request_with_stale_employee_summary(db):
    session, warehouse, product, location, employee = db
    request = make_received_request(
        session, warehouse, product, location, employee.id
    )
    request.status = "DRAFT"
    session.commit()
    payload = DeliveryRequestCreate(
        warehouse_id=warehouse.id,
        items=[DeliveryRequestItemCreate(product_id=product.id, quantity=2)],
    )

    with pytest.raises(ValueError, match="cần gửi lại bảng tổng hợp công nợ"):
        update(session, request.id, payload)

    session.refresh(request)
    assert request.items[0].quantity == 4
    assert len(request.employee_summaries) == 1


def test_update_replaces_items_and_employee_debt_summary_together(db):
    session, warehouse, product, location, employee = db
    request = make_received_request(
        session, warehouse, product, location, employee.id
    )
    request.status = "DRAFT"
    session.commit()
    payload = DeliveryRequestCreate(
        warehouse_id=warehouse.id,
        items=[DeliveryRequestItemCreate(product_id=product.id, quantity=2)],
        employee_summaries=[
            DeliveryRequestEmployeeSummaryCreate(
                employee_id=employee.id,
                employee_code=employee.code,
                employee_name=employee.name,
                amount=15000,
            )
        ],
    )

    updated = update(session, request.id, payload)

    assert [(item.product_id, item.quantity) for item in updated.items] == [
        (product.id, 2)
    ]
    assert [(summary.employee_id, summary.amount) for summary in updated.employee_summaries] == [
        (employee.id, Decimal("15000.00"))
    ]


def test_delivery_request_list_includes_employee_summaries(db):
    session, warehouse, product, location, employee = db
    request = make_received_request(
        session, warehouse, product, location, employee.id
    )

    listed = DeliveryRequestList.model_validate(list_(session)[0])

    assert listed.id == request.id
    assert listed.employee_summaries[0].employee_code == employee.code
    assert listed.employee_summaries[0].amount == 12000


def test_employee_amount_requires_valid_nonnegative_thousand_dong_value():
    assert _employee_amount(12.5, "EMP01", 17) == 12500
    assert _employee_amount(0, "EMP01", 17) == 0
    with pytest.raises(ValueError, match="thiếu tổng tiền"):
        _employee_amount(None, "EMP01", 17)
    with pytest.raises(ValueError, match="không hợp lệ"):
        _employee_amount("not an amount", "EMP01", 17)
    with pytest.raises(ValueError, match="không âm"):
        _employee_amount(-1, "EMP01", 17)
