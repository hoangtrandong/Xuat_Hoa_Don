from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.auth import hash_password
from app.models.employee import Employee
from app.models.multi_tenant_invoice import Distributor
from app.models.user import Role, User
from app.schemas.user import UserCreate, UserUpdate


def _load_options():
    return (
        selectinload(User.roles),
        joinedload(User.employee),
        joinedload(User.distributor),
    )


def user_response(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "employee_id": user.employee_id,
        "employee_code": user.employee.code if user.employee else None,
        "employee_name": user.employee.name if user.employee else None,
        "distributor_id": user.distributor_id,
        "distributor_code": user.distributor.code if user.distributor else None,
        "distributor_name": user.distributor.name if user.distributor else None,
        "distributor_tax_code": user.distributor.tax_code if user.distributor else None,
        "created_at": user.created_at,
        "roles": user.roles,
    }


def list_users(db: Session) -> List[User]:
    stmt = select(User).options(*_load_options()).order_by(User.username)
    return list(db.scalars(stmt).unique().all())


def get_user(db: Session, user_id: int) -> Optional[User]:
    return db.scalar(
        select(User).options(*_load_options()).where(User.id == user_id)
    )


def _resolve_roles(db: Session, role_ids: List[int]) -> List[Role]:
    if not role_ids:
        return []
    roles = db.scalars(select(Role).where(Role.id.in_(role_ids))).all()
    found_ids = {role.id for role in roles}
    missing = set(role_ids) - found_ids
    if missing:
        raise ValueError(f"Không tìm thấy vai trò: {', '.join(str(role_id) for role_id in missing)}.")
    return list(roles)


def create_user(db: Session, payload: UserCreate) -> User:
    username = (payload.username or "").strip()
    if payload.employee_id is not None:
        employee = db.get(Employee, payload.employee_id)
        if not employee:
            raise ValueError("Không tìm thấy nhân viên tương ứng.")
        if not username:
            username = employee.code.strip()
    if not username:
        raise ValueError("Tên đăng nhập không được để trống.")
    if len(username) < 3:
        raise ValueError("Tên đăng nhập cần tối thiểu 3 ký tự.")
    if db.scalar(select(User.id).where(User.username == username)):
        raise ValueError(f"Tên đăng nhập '{username}' đã tồn tại.")
    if db.scalar(select(User.id).where(User.email == payload.email)):
        raise ValueError(f"Email '{payload.email}' đã được sử dụng.")
    roles = _resolve_roles(db, payload.role_ids)
    if not roles and payload.distributor_id is not None:
        admin_role = db.scalar(select(Role).where(Role.name == "admin"))
        if admin_role:
            roles = [admin_role]
    user = User(
        username=username,
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        is_active=True,
        must_change_password=False,
        employee_id=payload.employee_id,
        distributor_id=payload.distributor_id,
        roles=roles,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user_id: int, payload: UserUpdate) -> Optional[User]:
    user = get_user(db, user_id)
    if not user:
        return None
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.role_ids is not None:
        user.roles = _resolve_roles(db, payload.role_ids)
    if payload.password and payload.password.strip():
        user.hashed_password = hash_password(payload.password.strip())
        user.must_change_password = False
        user.failed_login_attempts = 0
        user.locked_until = None
    if "employee_id" in payload.model_fields_set:
        if payload.employee_id is not None and not db.get(Employee, payload.employee_id):
            raise ValueError("Không tìm thấy nhân viên tương ứng.")
        user.employee_id = payload.employee_id
    if "distributor_id" in payload.model_fields_set:
        if payload.distributor_id is not None and not db.get(Distributor, payload.distributor_id):
            raise ValueError("Không tìm thấy Nhà phân phối tương ứng.")
        user.distributor_id = payload.distributor_id
    db.commit()
    db.refresh(user)
    return user


def list_roles(db: Session) -> List[Role]:
    return list(db.scalars(select(Role).order_by(Role.name)).all())
