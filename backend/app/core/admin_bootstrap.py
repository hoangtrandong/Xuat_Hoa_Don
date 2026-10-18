import os
from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import hash_password
from app.core.database import SessionLocal
from app.models.user import Permission, Role, User

RESOURCES = (
    "customers", "stores", "companies", "products", "product-groups",
    "sales-orders", "inventory", "employees", "payments", "debt",
    "delivery-requests", "sync", "users",
    "employee-debts", "store-debts", "cash-receipts", "debt-transfers",
    "delivery-returns", "bank-receipts",
)
ENVIRONMENT_VARIABLES = (
    "INITIAL_ADMIN_USERNAME",
    "INITIAL_ADMIN_EMAIL",
    "INITIAL_ADMIN_FULL_NAME",
    "INITIAL_ADMIN_PASSWORD",
)


def _ensure_admin_role_with_all_permissions(db: Session) -> Role:
    """Return the 'admin' role, creating it and any missing permissions as needed.

    This is idempotent and safe to call on every application startup so that
    an already-existing administrator role automatically picks up
    permissions for resources added in later releases (e.g. user
    management), without requiring a manual data migration.
    """
    role = db.scalar(select(Role).where(Role.name == "admin"))
    if role is None:
        role = Role(name="admin", description="System administrator")
        db.add(role)

    permissions = []
    for resource in RESOURCES:
        for action in ("read", "write"):
            code = f"{resource}:{action}"
            permission = db.scalar(select(Permission).where(Permission.code == code))
            if permission is None:
                permission = Permission(
                    code=code,
                    description=f"{action.title()} {resource}",
                )
                db.add(permission)
            permissions.append(permission)

    role.permissions = permissions
    return role


DEFAULT_STAFF_READ_ONLY_RESOURCES = tuple(
    resource for resource in RESOURCES if resource != "users"
)


def _ensure_staff_role_with_read_permissions(db: Session) -> Role:
    """Return a default 'staff' role with read-only access to business data.

    This gives administrators a sensible role to assign to ordinary
    employees right away, without requiring a full permission-matrix editor.
    Administrators can still create additional custom roles later.
    """
    role = db.scalar(select(Role).where(Role.name == "staff"))
    if role is None:
        role = Role(name="staff", description="Standard employee (read-only access)")
        db.add(role)

    permissions = []
    for resource in DEFAULT_STAFF_READ_ONLY_RESOURCES:
        code = f"{resource}:read"
        permission = db.scalar(select(Permission).where(Permission.code == code))
        if permission is None:
            permission = Permission(code=code, description=f"Read {resource}")
            db.add(permission)
        permissions.append(permission)

    role.permissions = permissions
    return role


def _ensure_role_with_permissions(db: Session, name: str, description: str, resource_actions: list[tuple[str, str]]) -> Role:
    role = db.scalar(select(Role).where(Role.name == name))
    if role is None:
        role = Role(name=name, description=description)
        db.add(role)

    permissions = []
    for resource, action in resource_actions:
        code = f"{resource}:{action}"
        permission = db.scalar(select(Permission).where(Permission.code == code))
        if permission is None:
            permission = Permission(code=code, description=f"{action.title()} {resource}")
            db.add(permission)
        permissions.append(permission)

    role.permissions = permissions
    return role


def sync_default_roles() -> None:
    """Ensure built-in roles exist with up-to-date permissions."""
    with SessionLocal.begin() as db:
        _ensure_admin_role_with_all_permissions(db)
        _ensure_staff_role_with_read_permissions(db)
        # Sales Admin: Quản lý khách hàng, đơn hàng, phiếu giao, phân bổ
        _ensure_role_with_permissions(
            db, "sales_admin", "Sales Admin (Quản lý đơn hàng & giao xuất)",
            [(r, "read") for r in RESOURCES if r != "users"] + [
                ("customers", "write"), ("stores", "write"), ("sales-orders", "write"),
                ("delivery-requests", "write"), ("sync", "write"),
            ]
        )
        # Kế toán: Quản lý công nợ, thu tiền và chuyển công nợ trực tiếp
        _ensure_role_with_permissions(
            db, "accountant", "Kế toán (Công nợ, thanh toán, duyệt nợ)",
            [(r, "read") for r in RESOURCES if r != "users"] + [
                ("debt", "write"), ("payments", "write"), ("cash-receipts", "write"),
                ("employee-debts", "write"), ("store-debts", "write"),
                ("debt-transfers", "write"),
                ("bank-receipts", "write"),
            ]
        )
        # Thủ kho: Quản lý tồn kho, lô FEFO, nhận hàng trả
        _ensure_role_with_permissions(
            db, "warehouse", "Thủ kho (Kho hàng, lô HSD, trả hàng)",
            [(r, "read") for r in RESOURCES if r != "users"] + [
                ("inventory", "write"), ("delivery-returns", "write"),
            ]
        )


def create_administrator(
    db: Session,
    *,
    username: str,
    email: str,
    full_name: str,
    password: str,
) -> User:
    if not username or not email or not full_name:
        raise ValueError("Username, email, and full name are required.")
    if db.scalar(select(User.id).where(User.username == username)):
        raise ValueError(f"User {username!r} already exists.")
    if db.scalar(select(User.id).where(User.email == email)):
        raise ValueError(f"Email {email!r} already exists.")

    role = _ensure_admin_role_with_all_permissions(db)
    user = User(
        username=username,
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
        is_active=True,
        must_change_password=False,  # Admin bootstrap biết mật khẩu rõ ràng, không cần buộc đổi
        roles=[role],
    )
    db.add(user)
    db.flush()
    return user


def bootstrap_administrator_from_environment(
    environment: Mapping[str, str] | None = None,
) -> str:
    environment = os.environ if environment is None else environment
    values = {
        key: environment.get(key, "").strip()
        if key != "INITIAL_ADMIN_PASSWORD"
        else environment.get(key, "")
        for key in ENVIRONMENT_VARIABLES
    }
    configured = [key for key, value in values.items() if value]
    if not configured:
        return "not configured; skipping"
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise ValueError(
            "Initial administrator bootstrap requires: "
            + ", ".join(ENVIRONMENT_VARIABLES)
        )

    with SessionLocal.begin() as db:
        username = values["INITIAL_ADMIN_USERNAME"]
        if db.scalar(select(User.id).where(User.username == username)):
            return "already exists; skipping"
        create_administrator(
            db,
            username=username,
            email=values["INITIAL_ADMIN_EMAIL"],
            full_name=values["INITIAL_ADMIN_FULL_NAME"],
            password=values["INITIAL_ADMIN_PASSWORD"],
        )
    return "created"
