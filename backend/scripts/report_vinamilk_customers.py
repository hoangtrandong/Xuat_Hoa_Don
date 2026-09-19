"""Build and email a read-only Vinamilk customer reconciliation report."""

from app.services.vinamilk_customer_report import build_customer_report, send_report


def main() -> None:
    report = build_customer_report()
    print(report)
    send_report(report)
    print("Customer reconciliation report sent.")


if __name__ == "__main__":
    main()
