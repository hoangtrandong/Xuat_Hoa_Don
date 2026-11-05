from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional

from app.models.customer import Customer, Store
from app.models.employee import Employee
from app.schemas.customer import CustomerCreate, CustomerUpdate


def get(db: Session, customer_id: int) -> Optional[Customer]:
    return db.get(Customer, customer_id)


def get_by_code(db: Session, code: str) -> Optional[Customer]:
    return db.query(Customer).filter(Customer.code == code).first()


def list_(db: Session, skip: int = 0, limit: int = 100, status: Optional[str] = None) -> List[Customer]:
    stmt = (
        select(Customer)
        .options(selectinload(Customer.store), selectinload(Customer.company))
        .order_by(Customer.code)
        .offset(skip)
        .limit(limit)
    )
    if status:
        stmt = stmt.where(Customer.status == status)
    return list(db.execute(stmt).scalars().all())


def resolve_manager_assignment(db: Session, manager_code: str | None) -> tuple[str | None, str | None]:
    code = (manager_code or "").strip().upper()
    if not code:
        return None, None
    if not code.startswith("NV"):
        raise ValueError("Mã NVQL phải bắt đầu bằng NV.")
    employee = db.scalar(select(Employee).where(func.upper(Employee.code) == code))
    if employee is None:
        raise ValueError(f"Không tìm thấy nhân viên có mã {code}.")
    return employee.code, employee.name


def create(db: Session, obj_in: CustomerCreate) -> Customer:
    data = obj_in.model_dump()
    store_route = data.pop("store_route", None)
    manager_code, manager_name = resolve_manager_assignment(db, data.get("manager_code"))
    data["manager_code"] = manager_code
    data["manager_name"] = manager_name
    customer = Customer(**data)
    db.add(customer)
    if customer.store_id and store_route is not None:
        store = db.get(Store, customer.store_id)
        if store:
            store.route = store_route.strip() or None
    db.commit()
    db.refresh(customer)
    return customer


def update(db: Session, customer: Customer, obj_in: CustomerUpdate) -> Customer:
    data = obj_in.model_dump(exclude_unset=True)
    store_route = data.pop("store_route", None)
    if "manager_code" in data:
        data["manager_code"], data["manager_name"] = resolve_manager_assignment(db, data["manager_code"])
    for field, value in data.items():
        setattr(customer, field, value)
    if customer.store_id and store_route is not None:
        store = db.get(Store, customer.store_id)
        if store:
            store.route = store_route.strip() or None
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