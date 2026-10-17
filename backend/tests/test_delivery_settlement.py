from datetime import date, datetime
from decimal import Decimal
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.delivery_request import (
    create, get, get_settlement, settle_order_pay, match_statements,
    import_orders_for_request,
)
from app.models.employee import Employee
from app.models.finance import CashReceipt, DebtLedgerEntry
from app.models.inventory import (
    DeliveryRequest, DeliveryRequestEmployeeSummary, DeliveryRequestItem,
    DeliveryRequestOrder, Warehouse, WarehouseLocation,
)
from app.models.product import Product, ProductCategory, ProductUnit
from app.schemas.delivery_request import (
    DeliveryRequestCreate, DeliveryRequestItemCreate, DeliveryRequestEmployeeSummaryCreate,
    DeliveryRequestOrderCreate, BankStatementItem, DailyEmployeeSettlement,
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

    # 3. Direct order-level BANK settlement is disabled; accounting uses bank allocations.
    ord_1 = [o for o in dr.orders if o.order_number == "ORD-TEST-001"][0]
    with pytest.raises(ValueError, match="(?i)phân bổ chuyển khoản"):
        settle_order_pay(
            session,
            request_id=dr.id,
            order_id=ord_1.id,
            payment_method="BANK",
            bank_ref="FT260908123456",
            note="Chuyen khoan VCB",
            created_by="accountant",
        )

    # Customer cash status is informational and must not credit employee debt.
    paid_ord = settle_order_pay(
        session,
        request_id=dr.id,
        order_id=ord_1.id,
        payment_method="CASH",
        note="Khách thanh toán tiền mặt",
        created_by="accountant",
    )
    assert paid_ord.payment_status == "PAID_CASH"
    assert paid_ord.payment_method == "CASH"
    cash_credit = session.scalar(
        select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "EMPLOYEE",
            DebtLedgerEntry.party_id == emp.id,
            DebtLedgerEntry.source_type == "DELIVERY_ORDER",
            DebtLedgerEntry.source_id == ord_1.id,
        )
    )
    assert cash_credit is None
    with pytest.raises(ValueError, match="(?i)không thể quyết toán công nợ"):
        settle_order_pay(
            session,
            request_id=dr.id,
            order_id=ord_1.id,
            payment_method="DEBT",
        )

    # 4. Cash marked at order level does not reduce the employee debt.
    overview2 = get_settlement(session, dr.id)
    assert overview2["total_paid_cash"] == 2000000.0
    assert overview2["total_paid_bank"] == 0.0
    emp_settle2 = overview2["employee_settlements"][0]
    assert emp_settle2["paid_cash"] == 2000000.0
    assert emp_settle2["remaining_cash_to_turn_in"] == 5000000.0

    # 5. Statement matching can preview, but cannot bypass explicit bank allocation.
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
        auto_confirm=False,
        created_by="accountant",
    )
    assert match_result["matched_count"] == 1
    assert match_result["auto_confirmed_count"] == 0
    assert match_result["unmatched_count"] == 1

    # ORD-TEST-002 remains unpaid until an explicit bank receipt allocation.
    ord_2 = [o for o in dr.orders if o.order_number == "ORD-TEST-002"][0]
    session.refresh(ord_2)
    assert ord_2.payment_status == "UNPAID"

    # 6. No bank transfers have been confirmed.
    overview_final = get_settlement(session, dr.id)
    assert overview_final["total_paid_bank"] == 0.0
    assert overview_final["total_unpaid"] == 3000000.0
    emp_settle_final = overview_final["employee_settlements"][0]
    assert emp_settle_final["remaining_cash_to_turn_in"] == 5000000.0


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


def test_delivery_return_and_stock_restoration(db):
    from app.crud.debt_ledger import create_delivery_return
    from app.models.inventory import InventoryTransaction
    from app.models.finance import DeliveryReturn

    session, wh, prod, emp = db

    # 1. Create delivery request with orders
    payload = DeliveryRequestCreate(
        warehouse_id=wh.id,
        items=[
            DeliveryRequestItemCreate(
                product_id=prod.id,
                quantity=20,
                employee_allocations={
                    "EMP01": {"quantity": 20, "cartons": 1, "boxes": 8, "raw": "1T 8H"}
                }
            )
        ],
        employee_summaries=[
            DeliveryRequestEmployeeSummaryCreate(
                employee_id=emp.id,
                employee_code="EMP01",
                employee_name=emp.name,
                amount=6000000.0,
                order_count=2,
            )
        ],
        orders=[
            DeliveryRequestOrderCreate(
                order_date=date(2026, 9, 8),
                order_number="ORD-RET-001",
                employee_id=emp.id,
                employee_code="EMP01",
                employee_name=emp.name,
                customer_code="KH001",
                customer_name="Cua Hang 1",
                amount=2000000.0,
                payment_status="UNPAID",
            ),
            DeliveryRequestOrderCreate(
                order_date=date(2026, 9, 8),
                order_number="ORD-RET-002",
                employee_id=emp.id,
                employee_code="EMP01",
                employee_name=emp.name,
                customer_code="KH002",
                customer_name="Cua Hang 2",
                amount=4000000.0,
                payment_status="UNPAID",
            ),
        ]
    )
    dr = create(session, payload)

    # 2. Return entire order ORD-RET-001 via settle_order_pay(method="RETURN")
    ord_1 = [o for o in dr.orders if o.order_number == "ORD-RET-001"][0]
    settle_order_pay(session, dr.id, ord_1.id, payment_method="RETURN")

    # Check order is marked RETURNED
    assert ord_1.payment_status == "RETURNED"
    assert ord_1.payment_method == "RETURN"

    # Check DeliveryReturn created and debt deducted
    ret_ord1 = session.scalar(
        select(DeliveryReturn).where(
            DeliveryReturn.delivery_request_id == dr.id,
            DeliveryReturn.order_id == ord_1.id,
        )
    )
    assert ret_ord1 is not None
    assert float(ret_ord1.amount) == 2000000.0

    debt_ret1 = session.scalar(
        select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "EMPLOYEE",
            DebtLedgerEntry.party_id == emp.id,
            DebtLedgerEntry.source_type == "DELIVERY_RETURN",
            DebtLedgerEntry.source_id == ret_ord1.id,
        )
    )
    assert debt_ret1 is not None
    assert float(debt_ret1.amount) == -2000000.0

    # 3. Create partial item return (e.g. 5 boxes returned to warehouse)
    ret_slip = create_delivery_return(
        session,
        delivery_request_id=dr.id,
        employee_id=emp.id,
        items=[
            {
                "product_id": prod.id,
                "quantity": 5,
                "cartons": 0,
                "loose_boxes": 5,
                "unit_price": 100000.0,
                "amount": 500000.0,
                "reason": "Khách thừa hàng, trả lại",
            }
        ],
        restore_stock=True,
        note="Nhập trả 5 hộp hàng về kho",
    )
    assert ret_slip.id is not None
    assert float(ret_slip.amount) == 500000.0
    assert len(ret_slip.items) == 1
    assert ret_slip.items[0].quantity == 5

    # Verify InventoryTransaction IN was generated to restore stock
    txn = session.scalar(
        select(InventoryTransaction).where(
            InventoryTransaction.ref_type == "DELIVERY_RETURN",
            InventoryTransaction.ref_code == ret_slip.code,
        )
    )
    assert txn is not None
    assert txn.type == "IN"
    assert txn.quantity == 5
    assert txn.warehouse_id == wh.id
    assert txn.product_id == prod.id

    # 4. Bank payment cannot be confirmed on an individual order.
    ord_2 = [o for o in dr.orders if o.order_number == "ORD-RET-002"][0]
    with pytest.raises(ValueError, match="(?i)phân bổ chuyển khoản"):
        settle_order_pay(session, dr.id, ord_2.id, payment_method="BANK", paid_amount=3500000.0)

    # 5. Check settlement overview
    overview = get_settlement(session, dr.id)
    assert overview["total_returned"] == 2500000.0  # 2M from ord_1 + 500k from item return
    assert overview["total_paid_bank"] == 0.0
    assert len(overview["returns"]) == 2

    emp_settle = overview["employee_settlements"][0]
    assert emp_settle["returned"] == 2500000.0
    # Allocated: 6,000,000. Bank: 0. Returned: 2,500,000.
    assert emp_settle["remaining_cash_to_turn_in"] == 3500000.0


def test_import_orders_for_request(db):
    session, wh, prod, emp = db

    req_create = DeliveryRequestCreate(
        warehouse_id=wh.id,
        items=[DeliveryRequestItemCreate(product_id=prod.id, quantity=50)],
        employee_summaries=[
            DeliveryRequestEmployeeSummaryCreate(
                employee_id=emp.id,
                employee_code=emp.code,
                employee_name=emp.name,
                order_count=2,
                amount=5000000.0,
            )
        ],
    )
    dr = create(session, req_create)

    # Initially 0 orders
    assert len(dr.orders) == 0

    orders_data = [
        {
            "order_number": "ORD-IMP-001",
            "order_date": date.today(),
            "employee_code": emp.code,
            "employee_name": emp.name,
            "customer_code": "CUST01",
            "customer_name": "Tạp hoá Hoa Mai",
            "amount": 2000000.0,
        },
        {
            "order_number": "ORD-IMP-002",
            "order_date": date.today(),
            "employee_code": emp.code,
            "employee_name": emp.name,
            "customer_code": "CUST02",
            "customer_name": "Đại lý Phúc Lộc",
            "amount": 3000000.0,
        },
    ]

    settlement = import_orders_for_request(session, dr.id, orders_data, replace_existing=True)

    assert settlement["total_orders_count"] == 2
    assert settlement["total_amount"] == 5000000.0
    assert len(settlement["orders"]) == 2
    assert settlement["employee_settlements"][0]["orders_count"] == 2
    assert settlement["employee_settlements"][0]["orders_amount"] == 5000000.0


def test_daily_settlement_groups_completed_requests_by_vietnam_business_date(db):
    session, warehouse, _, employee = db
    first = DeliveryRequest(
        code="DR-DAILY-001",
        warehouse_id=warehouse.id,
        status="COMPLETED",
        completed_at=datetime(2026, 10, 13, 13, 0),
    )
    second = DeliveryRequest(
        code="DR-DAILY-002",
        warehouse_id=warehouse.id,
        status="COMPLETED",
        completed_at=datetime(2026, 10, 13, 15, 0),
    )
    draft = DeliveryRequest(
        code="DR-DAILY-DRAFT",
        warehouse_id=warehouse.id,
        status="RECEIVED",
        completed_at=datetime(2026, 10, 13, 16, 0),
    )
    next_business_day = DeliveryRequest(
        code="DR-DAILY-NEXT",
        warehouse_id=warehouse.id,
        status="COMPLETED",
        completed_at=datetime(2026, 10, 13, 17, 30),
    )
    session.add_all([first, second, draft, next_business_day])
    session.flush()

    for request, amount in ((first, 40000000), (second, 60000000), (draft, 900000000), (next_business_day, 1)):
        session.add(DeliveryRequestEmployeeSummary(
            delivery_request_id=request.id,
            employee_id=employee.id,
            employee_code=employee.code,
            employee_name=employee.name,
            amount=amount,
        ))
    session.add_all([
        DeliveryRequestOrder(
            delivery_request_id=first.id,
            order_date=date(2026, 10, 13),
            order_number="DAILY-ORDER-1",
            employee_id=employee.id,
            employee_code=employee.code,
            employee_name=employee.name,
            amount=10000000,
            payment_status="PAID_BANK",
            payment_method="BANK",
        ),
        DeliveryRequestOrder(
            delivery_request_id=first.id,
            order_date=date(2026, 10, 13),
            order_number="DAILY-ORDER-2",
            employee_id=employee.id,
            employee_code=employee.code,
            employee_name=employee.name,
            amount=30000000,
            payment_status="UNPAID",
        ),
        DeliveryRequestOrder(
            delivery_request_id=second.id,
            order_date=date(2026, 10, 13),
            order_number="DAILY-ORDER-3",
            employee_id=employee.id,
            employee_code=employee.code,
            employee_name=employee.name,
            amount=60000000,
            payment_status="PAID_CASH",
            payment_method="CASH",
        ),
    ])
    session.add_all([
        DebtLedgerEntry(
            party_type="EMPLOYEE",
            party_id=employee.id,
            entry_type="DELIVERY_ISSUE",
            amount=Decimal("40000000"),
            source_type="DELIVERY_REQUEST",
            source_id=first.id,
            source_code=first.code,
            document_date=first.completed_at,
        ),
        DebtLedgerEntry(
            party_type="EMPLOYEE",
            party_id=employee.id,
            entry_type="DELIVERY_ISSUE",
            amount=Decimal("60000000"),
            source_type="DELIVERY_REQUEST",
            source_id=second.id,
            source_code=second.code,
            document_date=second.completed_at,
        ),
    ])
    session.commit()

    from app.crud import delivery_request as crud_obj
    from app.crud.debt_ledger import create_cash_receipt

    assert hasattr(crud_obj, "list_daily_settlements")
    results = crud_obj.list_daily_settlements(
        session,
        from_date=date(2026, 10, 13),
        to_date=date(2026, 10, 13),
    )

    assert len(results) == 1
    row = results[0]
    assert row["settlement_date"] == date(2026, 10, 13)
    assert row["employee_code"] == employee.code
    assert row["delivery_requests_count"] == 2
    assert row["orders_count"] == 3
    assert row["allocated_amount"] == 100000000
    assert row["orders_amount"] == 100000000
    assert row["paid_bank"] == 10000000
    assert row["paid_cash"] == 60000000
    assert row["unpaid"] == 30000000
    assert {item["request_code"] for item in row["requests"]} == {
        "DR-DAILY-001",
        "DR-DAILY-002",
    }
    assert len(row["orders"]) == 3
    assert [o["order_number"] for o in row["orders"]] == [
        "DAILY-ORDER-1",
        "DAILY-ORDER-2",
        "DAILY-ORDER-3",
    ]
    assert row["orders"][0]["amount"] == 10000000.0
    assert row["orders"][0]["paid_bank"] == 10000000.0
    assert row["orders"][0]["remaining_unpaid"] == 0.0
    assert row["orders"][1]["amount"] == 30000000.0
    assert row["orders"][1]["remaining_unpaid"] == 30000000.0
    assert row["orders"][2]["amount"] == 60000000.0
    assert row["orders"][2]["paid_cash"] == 60000000.0
    assert row["orders"][2]["remaining_unpaid"] == 0.0
    create_cash_receipt(
        session,
        party_type="EMPLOYEE",
        party_id=employee.id,
        amount=1000000,
        note="Thu khoản nợ cũ, không gắn phiếu",
    )
    unallocated_receipt_settlement = crud_obj.list_daily_settlements(
        session,
        from_date=date(2026, 10, 13),
        to_date=date(2026, 10, 13),
    )[0]
    assert unallocated_receipt_settlement["remaining_employee_debt"] == 90000000

    receipt = create_cash_receipt(
        session,
        party_type="EMPLOYEE",
        party_id=employee.id,
        amount=25000000,
        settlement_date=date(2026, 10, 13),
        note="Nộp tiền mặt quyết toán ngày",
    )
    assert receipt.settlement_date == date(2026, 10, 13)
    assert session.scalar(
        select(func.count(DebtLedgerEntry.id)).where(
            DebtLedgerEntry.source_type == "CASH_RECEIPT",
            DebtLedgerEntry.source_id == receipt.id,
        )
    ) == 1
    with pytest.raises(ValueError, match="vượt quá"):
        create_cash_receipt(
            session,
            party_type="EMPLOYEE",
            party_id=employee.id,
            amount=66000000,
            settlement_date=date(2026, 10, 13),
        )

    refreshed = crud_obj.list_daily_settlements(
        session,
        from_date=date(2026, 10, 13),
        to_date=date(2026, 10, 13),
    )[0]
    assert refreshed["cash_remitted"] == 25000000
    assert refreshed["cash_pending_remittance"] == 65000000
    assert refreshed["remaining_employee_debt"] == 65000000
    assert session.scalar(
        select(func.count(CashReceipt.id)).where(
            CashReceipt.settlement_date == date(2026, 10, 13),
            CashReceipt.party_id == employee.id,
        )
    ) == 1
    DailyEmployeeSettlement.model_validate(refreshed)
