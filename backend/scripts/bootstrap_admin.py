"""Interactively create the first administrator without a default credential."""

from getpass import getpass

from sqlalchemy import select

from app.core.auth import hash_password
from app.core.database import SessionLocal
from app.models.user import Permission, Role, User

RESOURCES = (
    "customers", "stores", "companies", "products", "product-groups",
    "sales-orders", "inventory", "employees", "payments", "debt",
    "delivery-requests", "sync",
)


def main() -> None:
    username = input("Admin username: ").strip()
    email = input("Admin email: ").strip()
    full_name = input("Admin full name: ").strip()
    password = getpass("Admin password (minimum 12 characters): ")
    confirmation = getpass("Confirm password: ")
    if not username or not email or not full_name:
        raise SystemExit("Username, email, and full name are required.")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    with SessionLocal.begin() as db:
        if db.scalar(select(User.id).where(User.username == username)):
            raise SystemExit(f"User {username!r} already exists.")
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
                    permission = Permission(code=code, description=f"{action.title()} {resource}")
                    db.add(permission)
                permissions.append(permission)
        role.permissions = permissions
        db.add(User(
            username=username,
            email=email,
            full_name=full_name,
            hashed_password=password_hash,
            is_active=True,
            roles=[role],
        ))
    print(f"Administrator {username!r} created.")


if __name__ == "__main__":
    main()
