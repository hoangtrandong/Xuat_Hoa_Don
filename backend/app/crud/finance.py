from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.models.finance import Payment
from app.schemas.finance import PaymentCreate


def _generate_code() -> str:
    return f"PAY-{datetime.utcnow():%y%m%d-%H%M%S}"


def list_(db: Session, skip: int = 0, limit: int = 100, customer_id: Optional[int] = None) -> List[Payment]:
    stmt = select(Payment).order_by(Payment.created_at.desc()).offset(skip).limit(limit)
    if customer_id:
        stmt = stmt.where(Payment.customer_id == customer_id)
    return list(db.execute(stmt).scalars().all())


def create(db: Session, obj_in: PaymentCreate) -> Payment:
    payment = Payment(code=_generate_code(), **obj_in.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


class PaymentCRUD:
    list_ = staticmethod(list_)
    create = staticmethod(create)


payment = PaymentCRUD()