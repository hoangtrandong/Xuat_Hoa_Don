"""Create the first administrator from Render environment variables during deploy."""

from app.core.admin_bootstrap import bootstrap_administrator_from_environment


def main() -> None:
    try:
        status = bootstrap_administrator_from_environment()
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"Initial administrator bootstrap: {status}.")


if __name__ == "__main__":
    main()
