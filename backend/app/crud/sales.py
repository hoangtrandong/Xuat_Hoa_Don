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


def change_customer(db: Session, order_id: int, customer_id: int) -> SalesOrder:
    from app.models.customer import Customer
    from app.models.inventory import DeliveryRequestOrder

    order = db.get(SalesOrder, order_id)
    if not order:
        raise ValueError("Không tìm thấy đơn hàng.")
    if order.status in ("COMPLETED", "CANCELLED"):
        raise ValueError(f"Đơn hàng {order.code} đang ở trạng thái {order.status}, không thể đổi mã khách hàng.")
    customer = db.get(Customer, customer_id)
    if not customer:
        raise ValueError("Không tìm thấy khách hàng mới.")

    order.customer_id = customer.id
    # Đồng bộ sang DeliveryRequestOrder chưa chốt nếu đơn đã đưa vào chuyến giao
    dro_rows = db.scalars(
        select(DeliveryRequestOrder).where(
            (DeliveryRequestOrder.source_order_id == order.id) | (DeliveryRequestOrder.order_number == order.code),
            DeliveryRequestOrder.payment_status == "UNPAID",
        )
    ).all()
    for dro in dro_rows:
        dro.customer_code = customer.code
        dro.customer_name = customer.name
        dro.store_id = customer.store_id

    db.commit()
    db.refresh(order)
    return order


class SalesOrderCRUD:
    get = staticmethod(get)
    list_ = staticmethod(list_)
    create = staticmethod(create)
    change_customer = staticmethod(change_customer)


sales_order = SalesOrderCRUD()

def get_product_summary_by_customer(db: Session, from_date: Optional[datetime] = None, to_date: Optional[datetime] = None):
    from sqlalchemy import func
    from app.models.customer import Customer
    from app.models.product import Product

    stmt = select(
        Customer.id.label("customer_id"),
        Customer.code.label("customer_code"),
        Customer.name.label("customer_name"),
        Product.id.label("product_id"),
        Product.sku.label("product_sku"),
        Product.name.label("product_name"),
        func.sum(SalesOrderItem.quantity).label("total_quantity"),
        func.sum(SalesOrderItem.line_total).label("total_amount")
    ).select_from(SalesOrderItem) \
     .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id) \
     .join(Customer, Customer.id == SalesOrder.customer_id) \
     .join(Product, Product.id == SalesOrderItem.product_id)

    if from_date:
        stmt = stmt.where(SalesOrder.created_at >= from_date)
    if to_date:
        stmt = stmt.where(SalesOrder.created_at <= to_date)

    stmt = stmt.group_by(
        Customer.id, Customer.code, Customer.name,
        Product.id, Product.sku, Product.name
    ).order_by(Customer.code, Product.sku)

    result = db.execute(stmt).all()
    return result

SalesOrderCRUD.get_product_summary_by_customer = staticmethod(get_product_summary_by_customer)
