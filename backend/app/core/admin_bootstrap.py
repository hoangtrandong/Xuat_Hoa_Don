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
    "delivery-requests", "sync",
)
ENVIRONMENT_VARIABLES = (
    "INITIAL_ADMIN_USERNAME",
    "INITIAL_ADMIN_EMAIL",
    "INITIAL_ADMIN_FULL_NAME",
    "INITIAL_ADMIN_PASSWORD",
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
    user = User(
        username=username,
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
        is_active=True,
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
