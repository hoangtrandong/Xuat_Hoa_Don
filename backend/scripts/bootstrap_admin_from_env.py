"""Create the first administrator from Render environment variables during deploy."""

import os

from sqlalchemy import select

from app.core.admin_bootstrap import create_administrator
from app.core.database import SessionLocal
from app.models.user import User

ENVIRONMENT_VARIABLES = (
    "INITIAL_ADMIN_USERNAME",
    "INITIAL_ADMIN_EMAIL",
    "INITIAL_ADMIN_FULL_NAME",
    "INITIAL_ADMIN_PASSWORD",
)


def main() -> None:
    values = {
        key: os.environ.get(key, "").strip()
        if key != "INITIAL_ADMIN_PASSWORD"
        else os.environ.get(key, "")
        for key in ENVIRONMENT_VARIABLES
    }
    configured = [key for key, value in values.items() if value]
    if not configured:
        print("Initial administrator bootstrap is not configured; skipping.")
        return
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise SystemExit(
            "Initial administrator bootstrap requires: "
            + ", ".join(ENVIRONMENT_VARIABLES)
        )

    with SessionLocal.begin() as db:
        if db.scalar(select(User.id).where(User.username == values["INITIAL_ADMIN_USERNAME"])):
            print("Initial administrator already exists; skipping.")
            return
        try:
            create_administrator(
                db,
                username=values["INITIAL_ADMIN_USERNAME"],
                email=values["INITIAL_ADMIN_EMAIL"],
                full_name=values["INITIAL_ADMIN_FULL_NAME"],
                password=values["INITIAL_ADMIN_PASSWORD"],
            )
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
    print("Initial administrator created.")


if __name__ == "__main__":
    main()
