"""Sync new Vinamilk products into the local product catalog."""

from app.core.database import SessionLocal
from app.services.vinamilk_products import sync_new_products


def main() -> None:
    with SessionLocal() as db:
        result = sync_new_products(db)
    print(
        "Vinamilk product sync completed: "
        f"fetched={result['fetched']} added={result['added']} skipped={result['skipped']} "
        f"deactivated={result['deactivated']} reactivated={result['reactivated']}"
    )


if __name__ == "__main__":
    main()
