from datetime import date
from decimal import Decimal
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.delivery_request import (
    create, get, get_settlement, settle_order_pay, match_statements
)
from app.models.employee import Employee
from app.models.finance import DebtLedgerEntry
from app.models.inventory import (
    DeliveryRequest, DeliveryRequestEmployeeSummary, DeliveryRequestItem,
    DeliveryRequestOrder, Warehouse, WarehouseLocation,
)
from app.models.product import Product, ProductCategory, ProductUnit
from app.schemas.delivery_request import (
    DeliveryRequestCreate, DeliveryRequestItemCreate, DeliveryRequestEmployeeSummaryCreate,
    DeliveryRequestOrderCreate, BankStatementItem,
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
        category = ProductCategory(code="CAT01", name="Category 1")
        unit = ProductUnit(code="THUNG", name="Thung")
        warehouse = Warehouse(code="WH01", name="Kho Chinh", location="HN")
        employee = Employee(
            code="EMP01",
            name="Nguyen Van A",
            position="DELIVERY",
            phone="0987654321",
            debt_limit=100000000.0,
        )
        session.add_all([category, unit, warehouse, employee])
        session.flush()

        product = Product(
            sku="SKU01",
            name="Sua Tuoi VNM 1L",
            category_id=category.id,
            unit_id=unit.id,
            boxes_per_carton=12,
        )
        session.add(product)
        session.commit()

        yield session, warehouse, product, employee

    Base.metadata.drop_all(engine)
    engine.dispose()


def test_delivery_settlement_crud_and_debt_deduction(db):
    session, wh, prod, emp = db

    # 1. Create delivery request with orders
    payload = DeliveryRequestCreate(
        warehouse_id=wh.id,
        items=[
            DeliveryRequestItemCreate(
                product_id=prod.id,
                quantity=10,
                employee_allocations={
                    "EMP01": {"quantity": 10, "cartons": 0, "boxes": 10, "raw": "10"}
                }
            )
        ],
        employee_summaries=[
            DeliveryRequestEmployeeSummaryCreate(
                employee_id=emp.id,
                employee_code="EMP01",
                employee_name=emp.name,
                amount=5000000.0,
                order_count=2,
                weight_ton=0.1,
            )
        ],
        orders=[
            DeliveryRequestOrderCreate(
                order_date=date(2026, 9, 8),
                order_number="ORD-TEST-001",
                employee_id=emp.id,
                employee_code="EMP01",
                employee_name=emp.name,
                customer_code="KH001",
                customer_name="Tap Hoa Minh Anh",
                amount=2000000.0,
                payment_status="UNPAID",
            ),
            DeliveryRequestOrderCreate(
                order_date=date(2026, 9, 8),
                order_number="ORD-TEST-002",
                employee_id=emp.id,
                employee_code="EMP01",
                employee_name=emp.name,
                customer_code="KH002",
                customer_name="Dai Ly Xuan Mai",
                amount=3000000.0,
                payment_status="UNPAID",
            ),
        ],
        note="Quyet toan chuyen xe test",
    )

    dr = create(session, payload, created_by="test_user")
    assert dr.id is not None
    assert len(dr.orders) == 2
    assert {o.order_number for o in dr.orders} == {"ORD-TEST-001", "ORD-TEST-002"}

    # 2. Get settlement overview
    overview = get_settlement(session, dr.id)
    assert overview["total_orders_count"] == 2
    assert overview["total_amount"] == 5000000.0
    assert overview["total_unpaid"] == 5000000.0
    assert overview["total_paid_bank"] == 0.0
    assert overview["total_paid_cash"] == 0.0
    assert len(overview["employee_settlements"]) == 1
    emp_settle = overview["employee_settlements"][0]
    assert emp_settle["employee_code"] == "EMP01"
    assert emp_settle["orders_count"] == 2
    assert emp_settle["allocated_amount"] == 5000000.0
    assert emp_settle["remaining_cash_to_turn_in"] == 5000000.0

    # 3. Pay order ORD-TEST-001 via BANK
    ord_1 = [o for o in dr.orders if o.order_number == "ORD-TEST-001"][0]
    paid_ord = settle_order_pay(
        session,
        request_id=dr.id,
        order_id=ord_1.id,
        payment_method="BANK",
        bank_ref="FT260908123456",
        note="Chuyen khoan VCB",
        created_by="accountant",
    )
    assert paid_ord.payment_status == "PAID_BANK"
    assert paid_ord.payment_method == "BANK"
    assert paid_ord.bank_ref == "FT260908123456"

    # Verify DebtLedgerEntry was created to deduct employee debt
    debt_entry = session.scalar(
        select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "EMPLOYEE",
            DebtLedgerEntry.party_id == emp.id,
            DebtLedgerEntry.source_type == "DELIVERY_ORDER",
            DebtLedgerEntry.source_id == ord_1.id,
        )
    )
    assert debt_entry is not None
    assert float(debt_entry.amount) == -2000000.0
    assert debt_entry.entry_type == "BANK_RECEIPT"

    # 4. Check overview after payment 1
    overview2 = get_settlement(session, dr.id)
    assert overview2["total_paid_bank"] == 2000000.0
    assert overview2["total_unpaid"] == 3000000.0
    emp_settle2 = overview2["employee_settlements"][0]
    assert emp_settle2["paid_bank"] == 2000000.0
    assert emp_settle2["remaining_cash_to_turn_in"] == 3000000.0

    # 5. Bank statement matching for ORD-TEST-002
    statements = [
        BankStatementItem(
            ref_number="MB_TRANS_999",
            amount=3000000.0,
            description="KH XUAN MAI THANH TOAN DON ORD-TEST-002",
        ),
        BankStatementItem(
            ref_number="MB_TRANS_000",
            amount=150000.0,
            description="TIEN CA FE",
        )
    ]
    match_result = match_statements(
        session,
        request_id=dr.id,
        statements=statements,
        auto_confirm=True,
        created_by="accountant",
    )
    assert match_result["matched_count"] == 1
    assert match_result["auto_confirmed_count"] == 1
    assert match_result["unmatched_count"] == 1

    # Verify ORD-TEST-002 was auto-paid and debt deducted
    ord_2 = [o for o in dr.orders if o.order_number == "ORD-TEST-002"][0]
    session.refresh(ord_2)
    assert ord_2.payment_status == "PAID_BANK"

    debt_entry_2 = session.scalar(
        select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "EMPLOYEE",
            DebtLedgerEntry.party_id == emp.id,
            DebtLedgerEntry.source_type == "DELIVERY_ORDER",
            DebtLedgerEntry.source_id == ord_2.id,
        )
    )
    assert debt_entry_2 is not None
    assert float(debt_entry_2.amount) == -3000000.0

    # 6. Check final overview: everything settled via bank transfer!
    overview_final = get_settlement(session, dr.id)
    assert overview_final["total_paid_bank"] == 5000000.0
    assert overview_final["total_unpaid"] == 0.0
    emp_settle_final = overview_final["employee_settlements"][0]
    assert emp_settle_final["remaining_cash_to_turn_in"] == 0.0


def test_upload_request_sheet2_parsing(db):
    from io import BytesIO
    import openpyxl
    from fastapi import UploadFile
    from app.api.v1.endpoints.delivery_requests import upload_request
    from app.models import VinamilkOrderSnapshot

    session, wh, prod, emp = db

    # Add snapshot for an order
    snap = VinamilkOrderSnapshot(
        remote_key="REMOTE_001",
        order_number="IN059999",
        synced_from=date(2026, 9, 8),
        synced_to=date(2026, 9, 8),
        raw_payload={"Giá trị": "1,500,000", "Số đơn hàng": "IN059999"},
    )
    session.add(snap)
    session.commit()

    # Create Excel workbook with 2 sheets
    wb = openpyxl.Workbook()
    # Sheet 1: Delivery request format
    ws1 = wb.active
    ws1.title = "PhieuGiaoHang"
    for _ in range(8):
        ws1.append([""] * 10)
    ws1.append(["STT", "Mã SKU", "Tên SP", "Số lượng tổng", "EMP01"])
    ws1.append(["", "", "", "", f"EMP01 ({emp.name})"])
    ws1.append(["1", prod.sku, prod.name, "10", "10"])
    ws1.append(["", "TỔNG CỘNG (ngàn đồng)", "", "", "1500"])

    # Sheet 2: Orders list
    ws2 = wb.create_sheet(title="DSDonHang")
    ws2.append([""] * 6)
    ws2.append(["", "", "", "DANH SÁCH ĐƠN HÀNG", "", ""])
    ws2.append([""] * 6)
    ws2.append(["Ngày đơn hàng", "Số đơn hàng", "Mã NVGH", "Tên NVGH", "Mã Khách hàng", "Tên Khách hàng"])
    ws2.append(["08/09/2026", "IN059999", "EMP01", emp.name, "KH001", "Cua Hang A"])

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    upload_file = UploadFile(file=bio, filename="bcthgh.xlsx")
    res = upload_request(warehouse_id=wh.id, file=upload_file, db=session)

    assert len(res.items) == 1
    assert len(res.employee_summaries) == 1
    assert len(res.orders) == 1
    order_res = res.orders[0]
    assert order_res.order_number == "IN059999"
    assert order_res.employee_code == "EMP01"
    assert order_res.customer_code == "KH001"
    assert order_res.customer_name == "Cua Hang A"
    assert order_res.amount == 1500000.0

