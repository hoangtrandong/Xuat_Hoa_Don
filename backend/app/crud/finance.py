from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import select, func
from sqlalchemy.orm import Session, joinedload

from app.models.customer import Customer
from app.models.finance import Payment, Receivable
from app.models.sales import SalesOrder
from app.schemas.finance import PaymentCreate


def _generate_payment_code() -> str:
    return f"PAY-{datetime.utcnow():%y%m%d-%H%M%S}"


def _as_float(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def receivable_balance(receivable: Receivable) -> float:
    return max(0.0, _as_float(receivable.amount) - _as_float(receivable.paid))


def recalc_customer_debt(db: Session, customer_id: int) -> float:
    rows = db.execute(
        select(Receivable).where(
            Receivable.customer_id == customer_id,
            Receivable.status.in_(("OPEN", "OVERDUE", "PARTIAL")),
        )
    ).scalars().all()
    total = sum(receivable_balance(row) for row in rows)
    customer = db.get(Customer, customer_id)
    if customer:
        customer.current_debt = total
    return total


def sync_order_payment_status(db: Session, order: SalesOrder) -> None:
    total = _as_float(order.total)
    paid = _as_float(order.amount_paid)
    if paid <= 0:
        order.payment_status = "UNPAID"
    elif paid + 1e-6 >= total:
        order.payment_status = "PAID"
        order.amount_paid = total
    else:
        order.payment_status = "PARTIAL"


def ensure_receivable_for_order(db: Session, order: SalesOrder) -> Receivable | None:
    """Create customer receivable once when warehouse export succeeds for this order."""
    existing = db.scalar(select(Receivable).where(Receivable.order_id == order.id))
    if existing:
        if order.status not in ("COMPLETED", "CANCELLED"):
            order.status = "COMPLETED"
        recalc_customer_debt(db, order.customer_id)
        return existing

    amount = _as_float(order.total)
    already_paid = min(_as_float(order.amount_paid), amount)
    balance = max(0.0, amount - already_paid)
    status = "PAID" if balance <= 1e-6 else "OPEN"

    receivable = Receivable(
        customer_id=order.customer_id,
        order_id=order.id,
        amount=amount,
        paid=already_paid,
        status=status,
        due_date=None,
    )
    db.add(receivable)
    order.status = "COMPLETED"
    sync_order_payment_status(db, order)
    db.flush()
    recalc_customer_debt(db, order.customer_id)
    return receivable


def record_debt_on_sales_export(db: Session, ref_code: str | None) -> Receivable | None:
    if not ref_code or not str(ref_code).strip():
        return None
    code = str(ref_code).strip()
    order = db.scalar(select(SalesOrder).where(SalesOrder.code == code))
    if not order:
        raise ValueError(f"Không tìm thấy đơn bán {code} để ghi công nợ.")
    if order.status == "CANCELLED":
        raise ValueError(f"Đơn bán {code} đã hủy, không thể xuất kho ghi nợ.")
    return ensure_receivable_for_order(db, order)


def list_payments(db: Session, skip: int = 0, limit: int = 100, customer_id: Optional[int] = None) -> List[Payment]:
    stmt = select(Payment).order_by(Payment.created_at.desc()).offset(skip).limit(limit)
    if customer_id:
        stmt = stmt.where(Payment.customer_id == customer_id)
    return list(db.execute(stmt).scalars().all())


def list_receivables(
    db: Session,
    skip: int = 0,
    limit: int = 200,
    customer_id: Optional[int] = None,
    open_only: bool = False,
) -> List[Receivable]:
    stmt = (
        select(Receivable)
        .options(joinedload(Receivable.customer))
        .order_by(Receivable.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if customer_id:
        stmt = stmt.where(Receivable.customer_id == customer_id)
    if open_only:
        stmt = stmt.where(Receivable.status.in_(("OPEN", "OVERDUE", "PARTIAL")))
    return list(db.execute(stmt).unique().scalars().all())


def list_customer_debt_summary(db: Session) -> list[dict]:
    customers = db.execute(
        select(Customer).where(Customer.current_debt > 0).order_by(Customer.current_debt.desc())
    ).scalars().all()
    result = []
    for customer in customers:
        open_count = db.scalar(
            select(func.count()).select_from(Receivable).where(
                Receivable.customer_id == customer.id,
                Receivable.status.in_(("OPEN", "OVERDUE", "PARTIAL")),
            )
        ) or 0
        result.append({
            "customer_id": customer.id,
            "customer_code": customer.code,
            "customer_name": customer.name,
            "phone": customer.phone,
            "credit_limit": _as_float(customer.credit_limit),
            "current_debt": _as_float(customer.current_debt),
            "open_receivables": int(open_count),
        })
    return result


def create_payment(db: Session, obj_in: PaymentCreate) -> Payment:
    customer = db.get(Customer, obj_in.customer_id)
    if not customer:
        raise ValueError("Không tìm thấy khách hàng.")
    amount = _as_float(obj_in.amount)
    if amount <= 0:
        raise ValueError("Số tiền thanh toán phải lớn hơn 0.")

    payment = Payment(
        code=_generate_payment_code(),
        customer_id=obj_in.customer_id,
        amount=amount,
        method=obj_in.method.strip().upper(),
        reference=obj_in.reference,
    )
    db.add(payment)
    db.flush()

    remaining = amount
    receivables = db.execute(
        select(Receivable)
        .where(
            Receivable.customer_id == obj_in.customer_id,
            Receivable.status.in_(("OPEN", "OVERDUE", "PARTIAL")),
        )
        .order_by(Receivable.created_at.asc())
        .with_for_update()
    ).scalars().all()

    for receivable in receivables:
        if remaining <= 1e-6:
            break
        balance = receivable_balance(receivable)
        if balance <= 1e-6:
            receivable.status = "PAID"
            continue
        apply = min(balance, remaining)
        receivable.paid = _as_float(receivable.paid) + apply
        remaining -= apply
        if receivable_balance(receivable) <= 1e-6:
            receivable.paid = _as_float(receivable.amount)
            receivable.status = "PAID"
        else:
            receivable.status = "PARTIAL"

        if receivable.order_id:
            order = db.get(SalesOrder, receivable.order_id)
            if order:
                order.amount_paid = _as_float(order.amount_paid) + apply
                sync_order_payment_status(db, order)

    recalc_customer_debt(db, obj_in.customer_id)
    db.commit()
    db.refresh(payment)
    return payment


class PaymentCRUD:
    list_ = staticmethod(list_payments)
    create = staticmethod(create_payment)


payment = PaymentCRUD()
