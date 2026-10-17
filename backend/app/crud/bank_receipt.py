from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import uuid4
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Customer, Store
from app.models.employee import Employee
from app.models.finance import BankReceipt, DebtLedgerEntry, PaymentAllocation
from app.models.inventory import DeliveryRequest, DeliveryRequestOrder
from app.schemas.bank_receipt import BankReceiptCreate, PaymentAllocationItemCreate


def _code(prefix: str) -> str:
    return f"{prefix}-{datetime.utcnow():%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"


def create_bank_receipt(
    db: Session,
    payload: BankReceiptCreate,
    created_by: Optional[str] = None,
) -> BankReceipt:
    amount = round(float(payload.amount), 2)
    if amount <= 0:
        raise ValueError("Số tiền chuyển khoản phải lớn hơn 0.")

    if payload.store_id:
        store = db.get(Store, payload.store_id)
        if not store:
            raise ValueError(f"Không tìm thấy Cửa hàng ID {payload.store_id}.")

    if payload.customer_id:
        cust = db.get(Customer, payload.customer_id)
        if not cust:
            raise ValueError(f"Không tìm thấy Khách hàng ID {payload.customer_id}.")

    receipt = BankReceipt(
        code=_code("BR"),
        bank_name=payload.bank_name,
        account_number=payload.account_number,
        ref_number=payload.ref_number,
        transaction_date=payload.transaction_date or datetime.utcnow(),
        party_type="STORE",
        store_id=payload.store_id,
        customer_id=payload.customer_id,
        amount=amount,
        allocated_amount=0.0,
        unallocated_amount=amount,
        status="UNALLOCATED",
        description=payload.description,
        created_by=created_by,
        created_at=datetime.utcnow(),
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    return receipt


def get_bank_receipt(db: Session, receipt_id: int) -> Optional[BankReceipt]:
    return db.scalar(
        select(BankReceipt)
        .options(
            selectinload(BankReceipt.store),
            selectinload(BankReceipt.customer),
            selectinload(BankReceipt.allocations).selectinload(PaymentAllocation.order),
            selectinload(BankReceipt.allocations).selectinload(PaymentAllocation.employee),
        )
        .where(BankReceipt.id == receipt_id)
    )


def list_bank_receipts(
    db: Session,
    status: Optional[str] = None,
    store_id: Optional[int] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: int = 200,
) -> List[BankReceipt]:
    stmt = (
        select(BankReceipt)
        .options(
            selectinload(BankReceipt.store),
            selectinload(BankReceipt.customer),
            selectinload(BankReceipt.allocations).selectinload(PaymentAllocation.order),
            selectinload(BankReceipt.allocations).selectinload(PaymentAllocation.employee),
        )
        .order_by(BankReceipt.transaction_date.desc(), BankReceipt.id.desc())
    )
    if status and status != "ALL":
        stmt = stmt.where(BankReceipt.status == status)
    if store_id is not None:
        stmt = stmt.where(BankReceipt.store_id == store_id)
    if from_date is not None:
        stmt = stmt.where(BankReceipt.transaction_date >= datetime.combine(from_date, time.min))
    if to_date is not None:
        stmt = stmt.where(BankReceipt.transaction_date <= datetime.combine(to_date, time.max))

    return db.scalars(stmt.limit(limit)).all()


def get_allocatable_orders_for_store(
    db: Session,
    store_id: Optional[int] = None,
    customer_code: Optional[str] = None,
    limit: int = 150,
) -> List[dict]:
    """Lấy danh sách các đơn hàng còn nợ có thể gạch nợ từ tiền chuyển khoản của Cửa hàng."""
    customer_codes = set()
    if customer_code:
        customer_codes.add(customer_code.strip())

    if store_id:
        store_customers = db.scalars(
            select(Customer.code).where(Customer.store_id == store_id)
        ).all()
        for cc in store_customers:
            if cc:
                customer_codes.add(cc.strip())

    stmt = (
        select(DeliveryRequestOrder)
        .options(
            selectinload(DeliveryRequestOrder.request),
            selectinload(DeliveryRequestOrder.employee),
        )
        .where(
            DeliveryRequestOrder.payment_status.notin_(("PAID", "PAID_BANK", "PAID_CASH", "RETURNED"))
        )
    )

    if customer_codes:
        stmt = stmt.where(DeliveryRequestOrder.customer_code.in_(list(customer_codes)))

    stmt = stmt.order_by(
        DeliveryRequestOrder.order_date.asc().nulls_last(),
        DeliveryRequestOrder.id.asc(),
    )
    orders = db.scalars(stmt.limit(limit)).all()
    if not orders:
        return []

    order_ids = [o.id for o in orders]
    alloc_sums = dict(
        db.execute(
            select(
                PaymentAllocation.order_id,
                func.coalesce(func.sum(PaymentAllocation.amount), 0),
            )
            .where(PaymentAllocation.order_id.in_(order_ids))
            .group_by(PaymentAllocation.order_id)
        ).all()
    )

    results = []
    for order in orders:
        allocated = float(alloc_sums.get(order.id, 0.0))
        total_amt = float(order.amount)
        remaining = max(0.0, total_amt - allocated)
        if remaining > 0.01:
            results.append({
                "id": order.id,
                "delivery_request_id": order.delivery_request_id,
                "delivery_request_code": order.request.code if order.request else "",
                "order_date": order.order_date,
                "order_number": order.order_number,
                "customer_code": order.customer_code,
                "customer_name": order.customer_name,
                "employee_id": order.employee_id,
                "employee_code": order.employee_code,
                "employee_name": order.employee_name,
                "total_amount": total_amt,
                "allocated_amount": allocated,
                "remaining_amount": round(remaining, 2),
                "payment_status": order.payment_status,
            })

    return results


def allocate_bank_receipt(
    db: Session,
    receipt_id: int,
    allocations: List[PaymentAllocationItemCreate],
    created_by: Optional[str] = None,
) -> BankReceipt:
    receipt = db.scalar(
        select(BankReceipt).where(BankReceipt.id == receipt_id).with_for_update()
    )
    if not receipt:
        raise ValueError(f"Không tìm thấy phiếu chuyển khoản ID {receipt_id}.")

    total_alloc_req = sum(round(float(a.amount), 2) for a in allocations if float(a.amount) > 0)
    if total_alloc_req <= 0:
        raise ValueError("Tổng số tiền phân bổ phải lớn hơn 0.")

    current_unalloc = float(receipt.unallocated_amount)
    if total_alloc_req > current_unalloc + 0.01:
        raise ValueError(
            f"Tổng tiền phân bổ ({total_alloc_req:,.0f}đ) vượt quá số tiền chưa phân bổ còn lại ({current_unalloc:,.0f}đ)."
        )

    now = datetime.utcnow()
    alloc_date = receipt.transaction_date or now
    eligible_customer_codes: set[str] = set()
    if receipt.store_id is not None:
        eligible_customer_codes.update(
            code.strip().upper()
            for code in db.scalars(
                select(Customer.code).where(Customer.store_id == receipt.store_id)
            ).all()
            if code and code.strip()
        )
    if receipt.customer_id is not None:
        customer = db.get(Customer, receipt.customer_id)
        if not customer:
            raise ValueError("Không tìm thấy khách hàng gắn với phiếu chuyển khoản.")
        if eligible_customer_codes and customer.code.strip().upper() not in eligible_customer_codes:
            raise ValueError("Khách hàng trên phiếu không thuộc cửa hàng chuyển tiền.")
        eligible_customer_codes = {customer.code.strip().upper()}

    for item in allocations:
        amt = round(float(item.amount), 2)
        if amt <= 0:
            continue

        if item.order_id:
            order = db.scalar(
                select(DeliveryRequestOrder)
                .where(DeliveryRequestOrder.id == item.order_id)
                .with_for_update()
            )
            if not order:
                raise ValueError(f"Không tìm thấy đơn hàng ID {item.order_id}.")
            if not eligible_customer_codes:
                raise ValueError("Phiếu chuyển khoản chưa gắn cửa hàng/khách hàng để xác nhận đơn.")
            order_customer_code = (order.customer_code or "").strip().upper()
            if order_customer_code not in eligible_customer_codes:
                raise ValueError(
                    f"Đơn {order.order_number} không thuộc cửa hàng/khách hàng trên phiếu chuyển khoản."
                )

            existing_alloc = float(
                db.scalar(
                    select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
                    .where(PaymentAllocation.order_id == order.id)
                ) or 0.0
            )
            order_amt = float(order.amount)
            if existing_alloc + amt > order_amt + 0.01:
                raise ValueError(
                    f"Số tiền gạch ({amt:,.0f}đ) vượt quá số nợ còn lại của đơn {order.order_number} ({order_amt - existing_alloc:,.0f}đ)."
                )

            pa = PaymentAllocation(
                code=_code("PA"),
                bank_receipt_id=receipt.id,
                order_id=order.id,
                employee_id=order.employee_id,
                store_id=receipt.store_id,
                amount=amt,
                allocation_date=alloc_date,
                note=item.note or f"Gạch nợ đơn {order.order_number}",
                created_by=created_by,
                created_at=now,
            )
            db.add(pa)
            db.flush()

            new_total_alloc = existing_alloc + amt
            if new_total_alloc >= order_amt - 0.01:
                order.payment_status = "PAID_BANK"
            else:
                order.payment_status = "PARTIAL_BANK"

            order.payment_method = "BANK"
            if not order.bank_ref:
                order.bank_ref = receipt.ref_number or receipt.code
            order.paid_at = now

            # Ledger debit reduction for Employee
            if order.employee_id:
                db.add(
                    DebtLedgerEntry(
                        party_type="EMPLOYEE",
                        party_id=order.employee_id,
                        entry_type="BANK_RECEIPT",
                        amount=-Decimal(str(amt)),
                        source_type="PAYMENT_ALLOCATION",
                        source_id=pa.id,
                        source_code=pa.code,
                        document_date=alloc_date,
                        note=f"Khách CK ({receipt.code}) gạch nợ đơn {order.order_number}"
                        + (f" ({receipt.description})" if receipt.description else ""),
                        created_by=created_by,
                        created_at=now,
                    )
                )

        elif item.store_id:
            store = db.get(Store, item.store_id)
            if not store:
                raise ValueError(f"Không tìm thấy Cửa hàng ID {item.store_id}.")

            pa = PaymentAllocation(
                code=_code("PA"),
                bank_receipt_id=receipt.id,
                order_id=None,
                employee_id=None,
                store_id=item.store_id,
                amount=amt,
                allocation_date=alloc_date,
                note=item.note or f"Gạch giảm nợ Cửa hàng {store.code}",
                created_by=created_by,
                created_at=now,
            )
            db.add(pa)
            db.flush()

            # Ledger debit reduction for Store
            db.add(
                DebtLedgerEntry(
                    party_type="STORE",
                    party_id=item.store_id,
                    entry_type="BANK_RECEIPT",
                    amount=-Decimal(str(amt)),
                    source_type="PAYMENT_ALLOCATION",
                    source_id=pa.id,
                    source_code=pa.code,
                    document_date=alloc_date,
                    note=f"Thu chuyển khoản giảm nợ theo phiếu {receipt.code}",
                    created_by=created_by,
                    created_at=now,
                )
            )

    # Recalculate receipt allocated & unallocated
    total_allocated = float(
        db.scalar(
            select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
            .where(PaymentAllocation.bank_receipt_id == receipt.id)
        ) or 0.0
    )
    receipt_total = float(receipt.amount)
    unallocated = max(0.0, receipt_total - total_allocated)

    receipt.allocated_amount = total_allocated
    receipt.unallocated_amount = unallocated
    if unallocated <= 0.01:
        receipt.status = "FULLY_ALLOCATED"
    elif total_allocated > 0.01:
        receipt.status = "PARTIALLY_ALLOCATED"
    else:
        receipt.status = "UNALLOCATED"

    db.commit()
    db.refresh(receipt)
    return get_bank_receipt(db, receipt.id) or receipt


def cancel_allocation(
    db: Session,
    receipt_id: int,
    allocation_id: int,
) -> BankReceipt:
    receipt = db.scalar(
        select(BankReceipt).where(BankReceipt.id == receipt_id).with_for_update()
    )
    if not receipt:
        raise ValueError("Không tìm thấy phiếu chuyển khoản.")

    pa = db.scalar(
        select(PaymentAllocation).where(
            PaymentAllocation.id == allocation_id,
            PaymentAllocation.bank_receipt_id == receipt_id,
        )
    )
    if not pa:
        raise ValueError("Không tìm thấy bút toán phân bổ.")

    order_id = pa.order_id

    # 1. Delete associated DebtLedgerEntry
    ledger_entries = db.scalars(
        select(DebtLedgerEntry).where(
            DebtLedgerEntry.source_type == "PAYMENT_ALLOCATION",
            DebtLedgerEntry.source_id == pa.id,
        )
    ).all()
    for entry in ledger_entries:
        db.delete(entry)

    # 2. Delete the allocation
    db.delete(pa)
    db.flush()

    # 3. Re-evaluate order status
    if order_id:
        order = db.get(DeliveryRequestOrder, order_id)
        if order:
            remaining_alloc = float(
                db.scalar(
                    select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
                    .where(PaymentAllocation.order_id == order.id)
                ) or 0.0
            )
            order_amt = float(order.amount)
            if remaining_alloc <= 0.01:
                order.payment_status = "UNPAID"
                order.payment_method = None
                order.paid_at = None
            elif remaining_alloc >= order_amt - 0.01:
                order.payment_status = "PAID_BANK"
            else:
                order.payment_status = "PARTIAL_BANK"

    # 4. Recalculate receipt status
    total_allocated = float(
        db.scalar(
            select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
            .where(PaymentAllocation.bank_receipt_id == receipt.id)
        ) or 0.0
    )
    receipt_total = float(receipt.amount)
    unallocated = max(0.0, receipt_total - total_allocated)
    receipt.allocated_amount = total_allocated
    receipt.unallocated_amount = unallocated
    if unallocated <= 0.01:
        receipt.status = "FULLY_ALLOCATED"
    elif total_allocated > 0.01:
        receipt.status = "PARTIALLY_ALLOCATED"
    else:
        receipt.status = "UNALLOCATED"

    db.commit()
    db.refresh(receipt)
    return get_bank_receipt(db, receipt.id) or receipt
