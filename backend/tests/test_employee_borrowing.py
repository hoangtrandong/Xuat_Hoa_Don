from datetime import datetime
from io import BytesIO
from types import SimpleNamespace

import openpyxl
import pytest
from fastapi import UploadFile
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.delivery_request import transition
from app.crud.employee_borrow import confirm_batch, create_pending_batch, list_ledger
from app.models.employee import Employee
from app.models.employee_borrow import EmployeeBorrowBatch, EmployeeBorrowEntry
from app.models.inventory import (
    DeliveryAllocation,
    DeliveryRequest,
    DeliveryRequestItem,
    Warehouse,
)
from app.models.product import Product, ProductCategory, ProductGroup, ProductGroupItem, ProductUnit
from app.api.v1.endpoints.delivery_requests import (
    confirm_borrowed_goods,
    import_borrowed_goods,
    upload_request,
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
            code="NV002", name="Borrow employee", position="SALES", phone="0002"
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


def workbook_bytes(db, *, regular_quantity=12, borrowed_quantity=8):
    _, _, product, _, _ = db
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "PhieuGiaoHang"
    for _ in range(8):
        sheet.append([""] * 6)
    sheet.append(["STT", "Mã hàng", "Tên SP", "Số lượng tổng", "NV001", "NV002"])
    sheet.append(["", "", "", "", "NV001 (Regular)", "NV002(Borrow)-X"])
    total = regular_quantity + borrowed_quantity
    sheet.append(["1", product.sku, product.name, str(total), str(regular_quantity), str(borrowed_quantity)])
    sheet.append(["", "TỔNG CỘNG (ngàn đồng)", "", "", 1000, 500])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def upload_file(content: bytes):
    return UploadFile(file=BytesIO(content), filename="borrow-test.xlsx")


def test_import_borrow_columns_posts_negative_ledger_without_delivery_request(db):
    session, _, product, _, borrow_employee = db
    content = workbook_bytes(db)
    result = import_borrowed_goods(
        file=upload_file(content),
        db=session,
        current_user=SimpleNamespace(username="admin"),
    )
    assert result["status"] == "PENDING"
    assert len(result["entries"]) == 1
    assert result["entries"][0]["quantity"] == -8
    assert result["entries"][0]["amount"] == -500000.0
    assert session.scalar(select(DeliveryRequest.id)) is None
    assert list_ledger(session)["balances"] == []

    import_borrowed_goods(
        file=upload_file(content),
        db=session,
        current_user=SimpleNamespace(username="admin"),
    )
    result_batch = session.get(EmployeeBorrowBatch, result["batch_id"])
    session.refresh(result_batch)
    assert result_batch.status == "PENDING"

    confirm_borrowed_goods(result["batch_id"], db=session, current_user=SimpleNamespace(username="admin"))
    balance = list_ledger(session)["balances"][0]
    assert (balance["employee_id"], balance["product_id"]) == (borrow_employee.id, product.id)
    assert (balance["quantity"], balance["amount"]) == (-8, -500000.0)
    with pytest.raises(Exception, match="đã được ghi nhận"):
        import_borrowed_goods(
            file=upload_file(content),
            db=session,
            current_user=SimpleNamespace(username="admin"),
        )


def test_dms_borrow_identity_can_be_added_without_internal_employee(db):
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
    assert batch.entries[0].employee_id is None
    assert batch.entries[0].external_employee_code == "0000032253"
    assert list_ledger(session)["balances"] == []

    confirm_batch(session, batch.id)

    balance = list_ledger(session)["balances"][0]
    assert balance["employee_id"] is None
    assert (balance["employee_code"], balance["employee_name"]) == (
        "0000032253",
        "Nguyễn Thị Thúy Hằng",
    )
    assert (balance["quantity"], balance["amount"]) == (-2, -40000.0)


def test_regular_delivery_upload_excludes_x_quantity_and_employee_debt(db):
    session, warehouse, _, _, _ = db
    result = upload_request(
        warehouse_id=warehouse.id,
        file=upload_file(workbook_bytes(db)),
        db=session,
    )
    assert len(result.items) == 1
    assert result.items[0].quantity == 12
    assert [summary.employee_code for summary in result.employee_summaries] == ["NV001"]
    assert result.employee_summaries[0].amount == 1000000.0
    assert any("-X" in warning for warning in result.warnings)


def test_real_completed_delivery_offsets_only_borrowed_quantity(db):
    session, warehouse, product, _, employee = db
    batch = EmployeeBorrowBatch(
        import_hash="a" * 64,
        filename="borrow.xlsx",
        status="POSTED",
        created_by="admin",
        posted_at=datetime.utcnow(),
    )
    entry = EmployeeBorrowEntry(
        employee=employee,
        product=product,
        entry_type="BORROW",
        quantity=-8,
        amount=-500000,
        created_by="admin",
    )
    batch.entries.append(entry)
    request = DeliveryRequest(
        code="DR-BORROW-TEST",
        warehouse_id=warehouse.id,
        status="RECEIVED",
        created_by="admin",
    )
    item = DeliveryRequestItem(
        product=product,
        quantity=10,
        employee_allocations={"NV002": {"quantity": 10}},
        allocations=[DeliveryAllocation(allocated_quantity=10, allocation_sequence=1)],
    )
    request.items.append(item)
    session.add_all([batch, request])
    session.commit()

    transition(session, request.id, "complete")

    entries = session.scalars(
        select(EmployeeBorrowEntry).order_by(EmployeeBorrowEntry.id)
    ).all()
    assert [(row.entry_type, row.quantity, float(row.amount)) for row in entries] == [
        ("BORROW", -8, -500000.0),
        ("OFFSET", 8, 500000.0),
    ]
    balance = list_ledger(session)["balances"]
    assert balance == []


def test_partial_actual_delivery_offsets_only_shipped_borrowed_quantity(db):
    session, warehouse, product, _, employee = db
    batch = EmployeeBorrowBatch(
        import_hash="b" * 64,
        filename="borrow-partial.xlsx",
        status="POSTED",
        created_by="admin",
        posted_at=datetime.utcnow(),
    )
    batch.entries.append(EmployeeBorrowEntry(
        employee=employee,
        product=product,
        entry_type="BORROW",
        quantity=-8,
        amount=-500000,
        created_by="admin",
    ))
    request = DeliveryRequest(
        code="DR-BORROW-PARTIAL",
        warehouse_id=warehouse.id,
        status="RECEIVED",
        created_by="admin",
        items=[DeliveryRequestItem(
            product=product,
            quantity=3,
            employee_allocations={"NV002": {"quantity": 10}},
            allocations=[DeliveryAllocation(allocated_quantity=3, allocation_sequence=1)],
        )],
    )
    session.add_all([batch, request])
    session.commit()

    transition(session, request.id, "complete")

    offsets = session.scalars(
        select(EmployeeBorrowEntry).where(EmployeeBorrowEntry.entry_type == "OFFSET")
    ).all()
    assert [(row.quantity, float(row.amount)) for row in offsets] == [(3, 187500.0)]
    balance = list_ledger(session)["balances"][0]
    assert (balance["quantity"], balance["amount"]) == (-5, -312500.0)


def test_return_shipment_offsets_dms_salesperson_borrow_without_internal_employee(db):
    session, warehouse, product, _, _ = db
    batch = EmployeeBorrowBatch(
        import_hash="c" * 64,
        filename="dms-borrow.xlsx",
        status="POSTED",
        created_by="admin",
        posted_at=datetime.utcnow(),
        entries=[EmployeeBorrowEntry(
            employee_id=None,
            external_employee_code="0000032253",
            external_employee_name="Nguyễn Thị Thúy Hằng",
            product=product,
            entry_type="BORROW",
            quantity=-8,
            amount=-500000,
            created_by="admin",
        )],
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
    session.add_all([batch, request])
    session.commit()

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
