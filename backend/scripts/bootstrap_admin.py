"""Interactively create the first administrator without a default credential."""

from getpass import getpass

from app.core.admin_bootstrap import create_administrator
from app.core.database import SessionLocal


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
    with SessionLocal.begin() as db:
        try:
            create_administrator(
                db,
                username=username,
                email=email,
                full_name=full_name,
                password=password,
            )
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
    print(f"Administrator {username!r} created.")


if __name__ == "__main__":
    main()
