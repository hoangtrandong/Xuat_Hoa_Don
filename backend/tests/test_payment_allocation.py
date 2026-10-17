from datetime import date, datetime
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.bank_receipt import (
    create_bank_receipt,
    get_bank_receipt,
    get_allocatable_orders_for_store,
    get_allocatable_employee_days_for_store,
    allocate_bank_receipt,
    cancel_allocation,
)
from app.crud.delivery_request import list_daily_settlements
from app.models.customer import Customer, Store
from app.models.employee import Employee
from app.models.finance import BankReceipt, DebtLedgerEntry, PaymentAllocation
from app.models.inventory import (
    DeliveryRequest,
    DeliveryRequestEmployeeSummary,
    DeliveryRequestItem,
    DeliveryRequestOrder,
    Warehouse,
)
from app.models.product import Product, ProductCategory, ProductUnit
from app.schemas.bank_receipt import BankReceiptCreate, PaymentAllocationItemCreate


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    cat = ProductCategory(code="CAT01", name="Sữa")
    unit = ProductUnit(code="HOP", name="Hộp")
    wh = Warehouse(code="WH-MAIN", name="Kho Tổng", location="HN")
    store = Store(code="ST-HOAMAI", name="Đại lý Hoa Mai", phone="0988888888")
    emp1 = Employee(code="NV001", name="Nguyễn Văn A", phone="0901", position="Giao hàng")
    emp2 = Employee(code="NV002", name="Trần Văn B", phone="0902", position="Giao hàng")

    session.add_all([cat, unit, wh, store, emp1, emp2])
    session.flush()

    prod = Product(sku="VNM-100", name="Sữa tươi 100ml", category_id=cat.id, unit_id=unit.id, boxes_per_carton=12)
    session.add(prod)
    session.commit()

    cust = Customer(
        code="CUST-HM",
        name="Đại lý Hoa Mai - Điểm 1",
        type="RETAIL",
        tier="A",
        store_id=store.id,
    )
    session.add(cust)
    session.commit()

    yield session, wh, prod, store, cust, emp1, emp2
    session.close()


def test_bank_receipt_multi_employee_allocation_and_daily_settlement(db):
    session, wh, prod, store, cust, emp1, emp2 = db

    # 1. Create a completed DeliveryRequest with orders for both employees under this store
    req = DeliveryRequest(
        code="DR-ALLOC-001",
        warehouse_id=wh.id,
        status="COMPLETED",
        completed_at=datetime(2026, 10, 14, 10, 0),
        items=[
            DeliveryRequestItem(product_id=prod.id, quantity=200),
        ],
        employee_summaries=[
            DeliveryRequestEmployeeSummary(
                employee_id=emp1.id,
                employee_code=emp1.code,
                employee_name=emp1.name,
                order_count=1,
                amount=8000000.0,
            ),
            DeliveryRequestEmployeeSummary(
                employee_id=emp2.id,
                employee_code=emp2.code,
                employee_name=emp2.name,
                order_count=1,
                amount=12000000.0,
            ),
        ],
        orders=[
            DeliveryRequestOrder(
                order_date=date(2026, 10, 14),
                order_number="ORD-HM-001",
                customer_code=cust.code,
                customer_name=cust.name,
                employee_id=emp1.id,
                employee_code=emp1.code,
                employee_name=emp1.name,
                amount=8000000.0,
                payment_status="UNPAID",
            ),
            DeliveryRequestOrder(
                order_date=date(2026, 10, 14),
                order_number="ORD-HM-002",
                customer_code=cust.code,
                customer_name=cust.name,
                employee_id=emp2.id,
                employee_code=emp2.code,
                employee_name=emp2.name,
                amount=12000000.0,
                payment_status="UNPAID",
            ),
        ],
    )
    session.add(req)
    session.commit()

    # Bank receipts can be allocated by daily employee debt instead of every order.
    allocatable_days = get_allocatable_employee_days_for_store(session, store_id=store.id)
    assert len(allocatable_days) == 2
    assert allocatable_days[0]["settlement_date"] == date(2026, 10, 14)
    assert {row["employee_code"] for row in allocatable_days} == {"NV001", "NV002"}
    assert {row["remaining_employee_debt"] for row in allocatable_days} == {
        8000000.0,
        12000000.0,
    }

    # Legacy order targets remain available for existing receipts and audit history.
    allocatable = get_allocatable_orders_for_store(session, store_id=store.id)
    assert len(allocatable) == 2
    assert allocatable[0]["remaining_amount"] == 8000000.0
    assert allocatable[1]["remaining_amount"] == 12000000.0

    # 2. Store transfers 20,000,000 VND in one lump sum
    receipt = create_bank_receipt(
        session,
        BankReceiptCreate(
            bank_name="Vietcombank",
            ref_number="FT261014-9999",
            transaction_date=datetime(2026, 10, 14, 11, 30),
            store_id=store.id,
            amount=20000000.0,
            description="CH HOA MAI THANH TOAN TIEN SUA NGAY 14/10",
        ),
        created_by="ketoan_lan",
    )
    assert receipt.status == "UNALLOCATED"
    assert float(receipt.unallocated_amount) == 20000000.0

    # 3. Accountant allocates by employee and settlement date.
    updated_receipt = allocate_bank_receipt(
        session,
        receipt.id,
        [
            PaymentAllocationItemCreate(
                employee_id=emp1.id,
                settlement_date=date(2026, 10, 14),
                amount=8000000.0,
            ),
            PaymentAllocationItemCreate(
                employee_id=emp2.id,
                settlement_date=date(2026, 10, 14),
                amount=12000000.0,
            ),
        ],
        created_by="ketoan_lan",
    )

    assert updated_receipt.status == "FULLY_ALLOCATED"
    assert float(updated_receipt.allocated_amount) == 20000000.0
    assert float(updated_receipt.unallocated_amount) == 0.0
    assert len(updated_receipt.allocations) == 2

    # Employee/day allocations do not require finding or marking individual orders.
    assert all(allocation.order_id is None for allocation in updated_receipt.allocations)
    assert {
        (allocation.employee_id, allocation.settlement_date)
        for allocation in updated_receipt.allocations
    } == {
        (emp1.id, date(2026, 10, 14)),
        (emp2.id, date(2026, 10, 14)),
    }

    # 5. Verify DebtLedgerEntry generated for both employees
    ledger_emp1 = session.scalars(
        select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "EMPLOYEE",
            DebtLedgerEntry.party_id == emp1.id,
            DebtLedgerEntry.source_type == "PAYMENT_ALLOCATION",
        )
    ).all()
    assert len(ledger_emp1) == 1
    assert float(ledger_emp1[0].amount) == -8000000.0

    ledger_emp2 = session.scalars(
        select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "EMPLOYEE",
            DebtLedgerEntry.party_id == emp2.id,
            DebtLedgerEntry.source_type == "PAYMENT_ALLOCATION",
        )
    ).all()
    assert len(ledger_emp2) == 1
    assert float(ledger_emp2[0].amount) == -12000000.0

    # 6. Verify Daily Settlement for that date
    settlements = list_daily_settlements(
        session,
        from_date=date(2026, 10, 14),
        to_date=date(2026, 10, 14),
    )
    assert len(settlements) == 2
    row_emp1 = next(r for r in settlements if r["employee_code"] == "NV001")
    row_emp2 = next(r for r in settlements if r["employee_code"] == "NV002")

    assert row_emp1["allocated_amount"] == 8000000.0
    assert row_emp1["paid_bank"] == 8000000.0
    assert row_emp1["unpaid"] == 0.0
    assert row_emp1["remaining_employee_debt"] == 0.0

    assert row_emp2["allocated_amount"] == 12000000.0
    assert row_emp2["paid_bank"] == 12000000.0
    assert row_emp2["unpaid"] == 0.0
    assert row_emp2["remaining_employee_debt"] == 0.0

    # Oversettling a specific employee/day is rejected.
    extra_receipt = create_bank_receipt(
        session,
        BankReceiptCreate(store_id=store.id, amount=1000000.0),
    )
    with pytest.raises(ValueError, match="(?i)nhân viên"):
        allocate_bank_receipt(
            session,
            extra_receipt.id,
            [
                PaymentAllocationItemCreate(
                    employee_id=emp1.id,
                    settlement_date=date(2026, 10, 14),
                    amount=1000000.0,
                )
            ],
        )


def test_partial_allocation_and_cancellation(db):
    session, wh, prod, store, cust, emp1, _ = db

    req = DeliveryRequest(
        code="DR-ALLOC-002",
        warehouse_id=wh.id,
        status="COMPLETED",
        completed_at=datetime(2026, 10, 14, 10, 0),
        orders=[
            DeliveryRequestOrder(
                order_date=date(2026, 10, 14),
                order_number="ORD-PARTIAL-001",
                customer_code=cust.code,
                customer_name=cust.name,
                employee_id=emp1.id,
                employee_code=emp1.code,
                employee_name=emp1.name,
                amount=10000000.0,
                payment_status="UNPAID",
            ),
        ],
    )
    session.add(req)
    session.commit()

    order = req.orders[0]

    receipt = create_bank_receipt(
        session,
        BankReceiptCreate(
            ref_number="FT261014-PARTIAL",
            store_id=store.id,
            amount=6000000.0,
        ),
    )

    # Allocate partial: 6M on 10M order
    updated = allocate_bank_receipt(
        session,
        receipt.id,
        [PaymentAllocationItemCreate(order_id=order.id, amount=6000000.0)],
    )

    assert updated.status == "FULLY_ALLOCATED"
    assert order.payment_status == "PARTIAL_BANK"

    allocatable = get_allocatable_orders_for_store(session, store_id=store.id)
    assert len(allocatable) == 1
    assert allocatable[0]["remaining_amount"] == 4000000.0

    # Test canceling allocation
    alloc_id = updated.allocations[0].id
    canceled = cancel_allocation(session, receipt.id, alloc_id)

    assert canceled.status == "UNALLOCATED"
    assert float(canceled.unallocated_amount) == 6000000.0
    assert order.payment_status == "UNPAID"

    allocatable_after = get_allocatable_orders_for_store(session, store_id=store.id)
    assert allocatable_after[0]["remaining_amount"] == 10000000.0


def test_store_transfer_cannot_reduce_an_unrelated_employee_order_debt(db):
    session, wh, _, store, _, employee, _ = db
    other_store = Store(code="ST-OTHER", name="Đại lý khác")
    session.add(other_store)
    session.flush()
    other_customer = Customer(
        code="CUST-OTHER",
        name="Đại lý khác",
        type="RETAIL",
        tier="A",
        store_id=other_store.id,
    )
    request = DeliveryRequest(
        code="DR-OTHER-STORE",
        warehouse_id=wh.id,
        status="COMPLETED",
        completed_at=datetime(2026, 10, 14, 12, 0),
    )
    session.add_all([other_customer, request])
    session.flush()
    order = DeliveryRequestOrder(
        delivery_request_id=request.id,
        order_date=date(2026, 10, 14),
        order_number="ORD-OTHER-STORE",
        customer_code=other_customer.code,
        customer_name=other_customer.name,
        employee_id=employee.id,
        employee_code=employee.code,
        employee_name=employee.name,
        amount=5000000.0,
        payment_status="UNPAID",
    )
    session.add(order)
    session.commit()

    receipt = create_bank_receipt(
        session,
        BankReceiptCreate(store_id=store.id, amount=5000000.0),
    )

    with pytest.raises(ValueError, match="không thuộc cửa hàng"):
        allocate_bank_receipt(
            session,
            receipt.id,
            [PaymentAllocationItemCreate(order_id=order.id, amount=5000000.0)],
        )

    with pytest.raises(ValueError, match="(?i)cửa hàng này"):
        allocate_bank_receipt(
            session,
            receipt.id,
            [
                PaymentAllocationItemCreate(
                    employee_id=employee.id,
                    settlement_date=date(2026, 10, 14),
                    amount=5000000.0,
                )
            ],
        )

    session.refresh(receipt)
    assert float(receipt.unallocated_amount) == 5000000.0
    assert session.scalar(
        select(PaymentAllocation).where(PaymentAllocation.bank_receipt_id == receipt.id)
    ) is None
