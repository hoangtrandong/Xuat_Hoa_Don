from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional

from app.models.employee import Employee
from app.models.user import User
from app.schemas.employee import EmployeeCreate, EmployeeUpdate


def get(db: Session, employee_id: int) -> Optional[Employee]:
    return db.scalar(
        select(Employee).options(selectinload(Employee.user)).where(Employee.id == employee_id)
    )


def list_(db: Session, skip: int = 0, limit: int = 100, status: Optional[str] = None) -> List[Employee]:
    stmt = select(Employee).options(selectinload(Employee.user)).offset(skip).limit(limit)
    if status:
        stmt = stmt.where(Employee.status == status)
    return list(db.execute(stmt).scalars().unique().all())


def create(db: Session, obj_in: EmployeeCreate) -> Employee:
    employee = Employee(**obj_in.model_dump())
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


def update(db: Session, employee_id: int, obj_in: EmployeeUpdate) -> Optional[Employee]:
    employee = db.get(Employee, employee_id)
    if not employee:
        return None
    was_active = employee.status == "active"
    for field, value in obj_in.model_dump(exclude_unset=True).items():
        setattr(employee, field, value)
    # Nhân viên nghỉ việc/chuyển trạng thái khác "active" thì tự khóa luôn tài khoản đăng nhập liên kết,
    # tránh trường hợp tài khoản vẫn đăng nhập được sau khi hồ sơ nhân sự đã đóng.
    if was_active and employee.status != "active":
        for linked_user in db.scalars(select(User).where(User.employee_id == employee.id)):
            linked_user.is_active = False
    db.commit()
    return get(db, employee_id)


class EmployeeCRUD:
    get = staticmethod(get)
    list_ = staticmethod(list_)
    create = staticmethod(create)
    update = staticmethod(update)


employee = EmployeeCRUD()