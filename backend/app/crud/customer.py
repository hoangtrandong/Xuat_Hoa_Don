from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List, Optional

from app.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerUpdate


def get(db: Session, customer_id: int) -> Optional[Customer]:
    return db.get(Customer, customer_id)


def get_by_code(db: Session, code: str) -> Optional[Customer]:
    return db.query(Customer).filter(Customer.code == code).first()


def list_(db: Session, skip: int = 0, limit: int = 100, status: Optional[str] = None) -> List[Customer]:
    stmt = select(Customer).offset(skip).limit(limit)
    if status:
        stmt = stmt.where(Customer.status == status)
    return list(db.execute(stmt).scalars().all())


def create(db: Session, obj_in: CustomerCreate) -> Customer:
    customer = Customer(**obj_in.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


def update(db: Session, customer: Customer, obj_in: CustomerUpdate) -> Customer:
    for field, value in obj_in.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


def delete(db: Session, customer: Customer) -> None:
    if customer.sales_orders:
        raise ValueError("Không thể xóa khách hàng đã phát sinh đơn hàng.")
    db.delete(customer)
    db.commit()


class CustomerCRUD:
    get = staticmethod(get)
    get_by_code = staticmethod(get_by_code)
    list_ = staticmethod(list_)
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)


customer = CustomerCRUD()