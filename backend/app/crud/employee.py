from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List, Optional

from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate


def get(db: Session, employee_id: int) -> Optional[Employee]:
    return db.get(Employee, employee_id)


def list_(db: Session, skip: int = 0, limit: int = 100, status: Optional[str] = None) -> List[Employee]:
    stmt = select(Employee).offset(skip).limit(limit)
    if status:
        stmt = stmt.where(Employee.status == status)
    return list(db.execute(stmt).scalars().all())


def create(db: Session, obj_in: EmployeeCreate) -> Employee:
    employee = Employee(**obj_in.model_dump())
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


class EmployeeCRUD:
    get = staticmethod(get)
    list_ = staticmethod(list_)
    create = staticmethod(create)


employee = EmployeeCRUD()