from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import hash_password
from app.models.user import Permission, Role, User

RESOURCES = (
    "customers", "stores", "companies", "products", "product-groups",
    "sales-orders", "inventory", "employees", "payments", "debt",
    "delivery-requests", "sync",
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
