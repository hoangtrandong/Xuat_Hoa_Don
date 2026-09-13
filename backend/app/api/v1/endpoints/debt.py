from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.crud import finance as crud
from app.models.sales import SalesOrder
from app.schemas.finance import DebtDashboard, Receivable, CustomerDebtSummary

router = APIRouter(prefix="/debt", tags=["debt"])


def _serialize_receivable(row, order_code: str | None = None) -> Receivable:
    customer = getattr(row, "customer", None)
    return Receivable(
        id=row.id,
        customer_id=row.customer_id,
        order_id=row.order_id,
        amount=float(row.amount or 0),
        paid=float(row.paid or 0),
        status=row.status,
        due_date=row.due_date,
        created_at=row.created_at,
        balance=crud.receivable_balance(row),
        customer_code=customer.code if customer else None,
        customer_name=customer.name if customer else None,
        order_code=order_code,
    )


def _order_codes(db: Session, rows) -> dict[int, str]:
    order_ids = [r.order_id for r in rows if r.order_id]
    if not order_ids:
        return {}
    orders = db.execute(select(SalesOrder).where(SalesOrder.id.in_(order_ids))).scalars().all()
    return {order.id: order.code for order in orders}


@router.get("/summary", response_model=DebtDashboard)
def debt_summary(db: Session = Depends(get_db)):
    customers = crud.list_customer_debt_summary(db)
    receivables = crud.list_receivables(db, limit=50, open_only=True)
    codes = _order_codes(db, receivables)
    recent = [
        _serialize_receivable(row, codes.get(row.order_id) if row.order_id else None)
        for row in receivables
    ]
    return DebtDashboard(
        total_debt=sum(c["current_debt"] for c in customers),
        customers_in_debt=len(customers),
        open_receivables=sum(c["open_receivables"] for c in customers),
        customers=[CustomerDebtSummary(**c) for c in customers],
        recent_receivables=recent,
    )


@router.get("/receivables", response_model=list[Receivable])
def list_receivables(customer_id: int | None = None, open_only: bool = True, db: Session = Depends(get_db)):
    rows = crud.list_receivables(db, customer_id=customer_id, open_only=open_only, limit=500)
    codes = _order_codes(db, rows)
    return [
        _serialize_receivable(row, codes.get(row.order_id) if row.order_id else None)
        for row in rows
    ]
