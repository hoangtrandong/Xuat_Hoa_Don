from math import isfinite

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional

from app.models.employee import Employee, EmployeeDebtLimitChange
from app.models.user import User
from app.schemas.employee import EmployeeCreate, EmployeeUpdate


def get(db: Session, employee_id: int) -> Optional[Employee]:
    return db.scalar(
        select(Employee).options(selectinload(Employee.user)).where(Employee.id == employee_id)
    )


def list_(db: Session, skip: int = 0, limit: int = 100, status: Optional[str] = None) -> List[Employee]:
    stmt = select(Employee).options(selectinload(Employee.user)).order_by(Employee.code.asc()).offset(skip).limit(limit)
    if status:
        stmt = stmt.where(Employee.status == status)
    return list(db.execute(stmt).scalars().unique().all())


def get_by_code(db: Session, code: str) -> Optional[Employee]:
    return db.scalar(select(Employee).where(func.upper(Employee.code) == code.strip().upper()))


def usage_summary(db: Session, employee_id: int) -> List[str]:
    """Liệt kê các dữ liệu đang tham chiếu tới nhân viên (rỗng = có thể xóa)."""
    from app.core.database import Base
    from app.models.finance import DebtLedgerEntry

    used: List[str] = []
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table.name != "employees":
                continue
            if fk.ondelete and fk.ondelete.upper() in ("SET NULL", "CASCADE"):
                continue
            col = fk.parent
            count = db.scalar(select(func.count()).select_from(table).where(col == employee_id)) or 0
            if count:
                used.append(f"{table.name} ({count})")
    ledger = db.scalar(
        select(func.count()).select_from(DebtLedgerEntry)
        .where(DebtLedgerEntry.party_type == "EMPLOYEE", DebtLedgerEntry.party_id == employee_id)
    ) or 0
    if ledger:
        used.append(f"debt_ledger_entries ({ledger})")
    return used


def delete(db: Session, employee: Employee) -> None:
    db.delete(employee)
    db.commit()


def create(db: Session, obj_in: EmployeeCreate) -> Employee:
    employee = Employee(**obj_in.model_dump())
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


def record_debt_limit_change(
    db: Session,
    employee: Employee,
    new_limit: float,
    reason: str,
    changed_by: str | None,
) -> None:
    old_limit = float(employee.debt_limit if employee.debt_limit is not None else 500000000)
    if old_limit == new_limit:
        return
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Cần ghi lý do khi thay đổi hạn mức công nợ.")
    if not isfinite(new_limit) or new_limit < 0 or new_limit > 999999999999.99:
        raise ValueError("Hạn mức công nợ phải từ 0 đến 999.999.999.999,99 đồng.")
    db.add(EmployeeDebtLimitChange(
        employee_id=employee.id,
        employee_code=employee.code,
        old_limit=old_limit,
        new_limit=new_limit,
        reason=normalized_reason,
        changed_by=changed_by,
    ))


def list_debt_limit_changes(db: Session, employee_id: int, limit: int = 100):
    return db.scalars(
        select(EmployeeDebtLimitChange)
        .where(EmployeeDebtLimitChange.employee_id == employee_id)
        .order_by(EmployeeDebtLimitChange.changed_at.desc(), EmployeeDebtLimitChange.id.desc())
        .limit(max(1, min(limit, 500)))
    ).all()


def update(
    db: Session,
    employee_id: int,
    obj_in: EmployeeUpdate,
    changed_by: str | None = None,
) -> Optional[Employee]:
    employee = db.get(Employee, employee_id)
    if not employee:
        return None
    update_data = obj_in.model_dump(exclude_unset=True)
    new_limit = update_data.pop("debt_limit", None)
    reason = update_data.pop("debt_limit_reason", None)
    if new_limit is not None:
        record_debt_limit_change(
            db, employee, new_limit, reason or "", changed_by
        )
        employee.debt_limit = new_limit
    was_active = employee.status == "active"
    for field, value in update_data.items():
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
    list_debt_limit_changes = staticmethod(list_debt_limit_changes)
    record_debt_limit_change = staticmethod(record_debt_limit_change)
    delete = staticmethod(delete)
    get_by_code = staticmethod(get_by_code)
    usage_summary = staticmethod(usage_summary)


employee = EmployeeCRUD()