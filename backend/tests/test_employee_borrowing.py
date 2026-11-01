from datetime import datetime
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import pytest

from app.core.database import Base
from app.crud.delivery_request import create as create_delivery_request, delete as delete_delivery_request, transition
from app.crud.employee_borrow import create_pending_batch, create_posted_batch, list_ledger
from app.models.employee import Employee
from app.models.employee_borrow import EmployeeBorrowBatch, EmployeeBorrowEntry
from app.models.inventory import (
    DeliveryAllocation,
    DeliveryRequest,
    DeliveryRequestItem,
    Warehouse,
)
from app.models.product import Product, ProductCategory, ProductGroup, ProductGroupItem, ProductUnit
from app.schemas.delivery_request import (
    DeliveryRequestCreate,
    DeliveryRequestItemCreate,
    EmployeeBorrowEntryCreate,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        category = ProductCategory(code="BORROW", name="Borrow test")
        unit = ProductUnit(code="BOX", name="Box")
        warehouse = Warehouse(code="BW01", name="Borrow warehouse", location="Test")
        regular_employee = Employee(
            code="NV001", name="Regular employee", position="SALES", phone="0001"
        )
        borrow_employee = Employee(
            code="NV002", vinamilk_code="0000032253", name="Borrow employee", position="SALES", phone="0002"
        )
        session.add_all([category, unit, warehouse, regular_employee, borrow_employee])
        session.flush()
        product = Product(
            sku="BORROW01",
            name="Borrow test product",
            category_id=category.id,
            unit_id=unit.id,
            boxes_per_carton=12,
        )
        session.add(product)
        session.flush()
        session.add(ProductGroup(
            name=product.name,
            representative_product_id=product.id,
            items=[ProductGroupItem(product_id=product.id)],
        ))
        session.commit()
        yield session, warehouse, product, regular_employee, borrow_employee
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_dms_borrow_identity_is_posted_immediately_on_creation(db):
    session, _, product, _, _ = db
    batch = create_pending_batch(
        session,
        import_hash="d" * 64,
        filename="dms-borrow.xlsx",
        entries=[{
            "employee_id": None,
            "external_employee_code": "0000032253",
            "external_employee_name": "Nguyễn Thị Thúy Hằng",
            "product_id": product.id,
            "quantity": -2,
            "amount": -40000,
            "note": "Mượn Số theo đơn IN061790",
        }],
        created_by="admin",
    )
    session.commit()

    assert batch.status == "POSTED"
    assert batch.entries[0].employee_id is None
    assert batch.entries[0].external_employee_code == "0000032253"

    balance = list_ledger(session)["balances"][0]
    assert balance["employee_id"] is None
    assert (balance["employee_code"], balance["employee_name"]) == (
        "0000032253",
        "Nguyễn Thị Thúy Hằng",
    )
    assert (balance["quantity"], balance["amount"]) == (-2, -40000.0)


def test_return_shipment_offsets_dms_salesperson_borrow_on_warehouse_completion(db):
    session, warehouse, product, _, _ = db
    batch = create_posted_batch(
        session,
        import_hash="c" * 64,
        filename="dms-borrow.xlsx",
        entries=[{
            "employee_id": None,
            "external_employee_code": "0000032253",
            "external_employee_name": "Nguyễn Thị Thúy Hằng",
            "product_id": product.id,
            "quantity": -8,
            "amount": -500000,
            "note": "Mượn Số theo đơn BOR-01",
        }],
        created_by="admin",
    )
    request = DeliveryRequest(
        code="DR-DMS-RETURN",
        warehouse_id=warehouse.id,
        status="RECEIVED",
        created_by="admin",
        items=[DeliveryRequestItem(
            product=product,
            quantity=3,
            allocations=[DeliveryAllocation(allocated_quantity=3, allocation_sequence=1)],
            borrowed_employee_offsets=[{
                "external_employee_code": "0000032253",
                "external_employee_name": "Nguyễn Thị Thúy Hằng",
                "quantity": 3,
                "amount": 187500,
            }],
        )],
    )
    session.add(request)
    session.commit()

    # Trước khi Thủ kho bấm Hoàn tất, số dư vẫn là -8 (chỉ có Mượn Số)
    assert list_ledger(session)["balances"][0]["quantity"] == -8

    # Khi Thủ kho bấm Hoàn tất xuất kho thực tế, Trả Số (+3) được ghi nhận và bù trừ
    transition(session, request.id, "complete")

    entries = session.scalars(
        select(EmployeeBorrowEntry).order_by(EmployeeBorrowEntry.id)
    ).all()
    assert [(row.entry_type, row.quantity, float(row.amount)) for row in entries] == [
        ("BORROW", -8, -500000.0),
        ("OFFSET", 3, 187500.0),
    ]
    assert entries[1].source_entry_id == entries[0].id
    assert entries[1].source_request_id == request.id
    balance = list_ledger(session)["balances"][0]
    assert balance["employee_id"] is None
    assert (balance["employee_code"], balance["employee_name"]) == (
        "0000032253",
        "Nguyễn Thị Thúy Hằng",
    )
    assert (balance["quantity"], balance["amount"]) == (-5, -312500.0)


def test_cancelling_or_deleting_request_rolls_back_borrow_entries(db):
    session, warehouse, product, _, salesperson = db
    req = create_delivery_request(
        session,
        DeliveryRequestCreate(
            warehouse_id=warehouse.id,
            items=[DeliveryRequestItemCreate(product_id=product.id, quantity=2)],
            borrow_entries=[
                EmployeeBorrowEntryCreate(
                    employee_id=salesperson.id,
                    external_employee_code="0000032253",
                    external_employee_name="Borrow employee",
                    product_id=product.id,
                    quantity=-4,
                    amount=-200000,
                    note="Mượn Số theo đơn BOR-02",
                )
            ],
            borrow_import_hash="e" * 64,
            borrow_filename="dsdonhang.xlsx",
        ),
        created_by="admin",
    )
    # Ngay khi tạo yêu cầu, Mượn Số đã xuất hiện trong số dư
    assert len(list_ledger(session)["balances"]) == 1
    assert list_ledger(session)["balances"][0]["quantity"] == -4

    # Khi xóa phiếu ở trạng thái DRAFT, dòng Mượn Số của phiếu đó được hoàn tác
    delete_delivery_request(session, req.id)
    assert list_ledger(session)["balances"] == []
    assert session.scalars(select(EmployeeBorrowBatch)).all() == []
