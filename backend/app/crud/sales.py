from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.models.sales import SalesOrder, SalesOrderItem
from app.schemas.sales import SalesOrderCreate


def _generate_code() -> str:
    ts = datetime.utcnow()
    return f"SO-{ts:%y%m%d}-{ts:%H%M%S}"


def get(db: Session, order_id: int) -> Optional[SalesOrder]:
    return db.get(SalesOrder, order_id)


def list_(db: Session, skip: int = 0, limit: int = 100, customer_id: Optional[int] = None, status: Optional[str] = None) -> List[SalesOrder]:
    stmt = select(SalesOrder).order_by(SalesOrder.created_at.desc()).offset(skip).limit(limit)
    if customer_id:
        stmt = stmt.where(SalesOrder.customer_id == customer_id)
    if status:
        stmt = stmt.where(SalesOrder.status == status)
    return list(db.execute(stmt).scalars().all())


def create(db: Session, obj_in: SalesOrderCreate, employee_id: Optional[int] = None) -> SalesOrder:
    subtotal = sum(i.quantity * i.price * (1 - i.discount / 100) for i in obj_in.items)
    total = subtotal
    order = SalesOrder(
        code=_generate_code(),
        customer_id=obj_in.customer_id,
        employee_id=employee_id,
        warehouse_id=obj_in.warehouse_id,
        status="PENDING",
        payment_status="UNPAID",
        subtotal=subtotal,
        discount=0,
        total=total,
        payment_method=obj_in.payment_method,
        note=obj_in.note,
        source="WEB",
    )
    db.add(order)
    db.flush()
    for item in obj_in.items:
        line_total = item.quantity * item.price * (1 - item.discount / 100)
        db.add(SalesOrderItem(
            order_id=order.id,
            product_id=item.product_id,
            quantity=item.quantity,
            price=item.price,
            discount=item.discount,
            line_total=line_total,
        ))
    db.commit()
    db.refresh(order)
    return order


class SalesOrderCRUD:
    get = staticmethod(get)
    list_ = staticmethod(list_)
    create = staticmethod(create)


sales_order = SalesOrderCRUD()