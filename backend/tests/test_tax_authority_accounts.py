from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.core.database import Base
from app.api.v1.endpoints.multi_tenant_einvoice import (
    GdtAuthRequest,
    authenticate_gdt_account,
)
from app.models.multi_tenant_invoice import (
    Distributor,
    PurchaseInvoice,
    TaxAuthorityCredential,
)
from app.services.gdt_purchase_invoice_service import _gdt_get


def _invoice(credential: TaxAuthorityCredential, invoice_number: str) -> PurchaseInvoice:
    return PurchaseInvoice(
        distributor_id=credential.distributor_id,
        tax_credential_id=credential.id,
        invoice_template="1",
        invoice_symbol="1C26T",
        invoice_number=invoice_number,
        seller_tax_code="0100100100",
        seller_name="Supplier",
    )


def test_tax_account_deletion_removes_only_its_purchase_invoices():
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        distributor = Distributor(code="NPP-TEST", name="NPP Test")
        account_one = TaxAuthorityCredential(
            distributor=distributor,
            username="0100000001",
        )
        account_two = TaxAuthorityCredential(
            distributor=distributor,
            username="0100000002",
        )
        db.add_all([distributor, account_one, account_two])
        db.flush()
        db.add_all(
            [
                _invoice(account_one, "000001"),
                _invoice(account_two, "000001"),
            ]
        )
        db.commit()

        db.delete(account_one)
        db.commit()

        remaining = list(db.scalars(select(PurchaseInvoice)).all())
        assert len(remaining) == 1
        assert remaining[0].tax_credential_id == account_two.id
        assert db.get(TaxAuthorityCredential, account_one.id) is None
        assert db.get(TaxAuthorityCredential, account_two.id) is not None


def test_tax_credential_migration_replaces_unique_distributor_index():
    migration_path = (
        Path(__file__).parents[1]
        / "app"
        / "db"
        / "migrations"
        / "versions"
        / "20261118_fix_tax_credential_index.py"
    )
    spec = spec_from_file_location("tax_credential_index_migration", migration_path)
    assert spec and spec.loader
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE tax_authority_credentials "
                "(id INTEGER PRIMARY KEY, distributor_id INTEGER NOT NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX ix_tax_authority_credentials_distributor_id "
                "ON tax_authority_credentials (distributor_id)"
            )
        )
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()

        index = next(
            index
            for index in inspect(conn).get_indexes("tax_authority_credentials")
            if index["name"] == "ix_tax_authority_credentials_distributor_id"
        )
        assert not index["unique"]
        conn.execute(
            text(
                "INSERT INTO tax_authority_credentials (distributor_id) "
                "VALUES (2), (2)"
            )
        )
    engine.dispose()


def test_gdt_get_retries_transient_errors(monkeypatch):
    class FakeClient:
        def __init__(self):
            self.calls = 0

        def get(self, url, headers):
            self.calls += 1
            return type("Response", (), {"status_code": 503 if self.calls < 3 else 200})()

    client = FakeClient()
    monkeypatch.setattr(
        "app.services.gdt_purchase_invoice_service.time.sleep",
        lambda _: None,
    )

    response = _gdt_get(client, "https://example.test", headers={})

    assert response.status_code == 200
    assert client.calls == 3


def test_captcha_authentication_stores_token(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    captured: dict[str, str] = {}

    def fake_authenticate(username: str, password: str, ckey: str, cvalue: str):
        captured.update(
            {
                "username": username,
                "password": password,
                "ckey": ckey,
                "cvalue": cvalue,
            }
        )
        return "Bearer captcha-token"

    monkeypatch.setattr(
        "app.api.v1.endpoints.multi_tenant_einvoice.authenticate_gdt_taxpayer",
        fake_authenticate,
    )

    with Session(engine) as db:
        distributor = Distributor(code="NPP-CAPTCHA", name="NPP CAPTCHA")
        db.add(distributor)
        db.commit()
        result = authenticate_gdt_account(
            GdtAuthRequest(
                distributor_id=distributor.id,
                username="0100000003",
                password="secret",
                ckey="captcha-key",
                cvalue="AB12",
            ),
            db=db,
            current_user=type("User", (), {"username": "admin"})(),
        )

        credential = db.get(TaxAuthorityCredential, result["credential_id"])
        assert credential is not None
        assert credential.bearer_token == "Bearer captcha-token"
        assert credential.encrypted_password == "secret"

    assert captured == {
        "username": "0100000003",
        "password": "secret",
        "ckey": "captcha-key",
        "cvalue": "AB12",
    }


def test_parse_sync_error_reason():
    from app.api.v1.endpoints.multi_tenant_einvoice import _parse_sync_error_reason
    import httpx

    assert "Bearer Token đã hết hạn" in _parse_sync_error_reason(PermissionError("CQT_TOKEN_EXPIRED"))
    assert "401" in _parse_sync_error_reason(RuntimeError("HTTP 401 Unauthorized"))
    assert "403" in _parse_sync_error_reason(RuntimeError("HTTP 403 Forbidden"))
    assert "Timeout" in _parse_sync_error_reason(httpx.ReadTimeout("Request timed out"))
    assert "Không thể kết nối" in _parse_sync_error_reason(httpx.ConnectError("Connection refused"))


def test_sync_purchase_invoices_reports_failed_account_name_and_reason(monkeypatch):
    from datetime import date
    from app.api.v1.endpoints.multi_tenant_einvoice import (
        GdtSyncPurchaseRequest,
        sync_purchase_invoices_endpoint,
    )

    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    def fake_sync(db, distributor_id, tax_credential_id, from_date, to_date, bearer_token, sync_products=False):
        if tax_credential_id == 2:
            raise PermissionError("CQT_TOKEN_EXPIRED")
        return {
            "total_found": 29,
            "saved_invoices": 29,
            "xml_extracted_count": 1,
            "saved_invoice_ids": [],
            "warnings": ["MAY_TINH_TIEN: Cổng Thuế phản hồi HTTP 404"],
        }

    monkeypatch.setattr(
        "app.api.v1.endpoints.multi_tenant_einvoice.sync_gdt_purchase_invoices",
        fake_sync,
    )

    with Session(engine) as db:
        distributor = Distributor(code="NPP-MULTI", name="NPP Multi")
        db.add(distributor)
        db.flush()

        acc1 = TaxAuthorityCredential(
            id=1,
            distributor_id=distributor.id,
            username="0101111111",
            bearer_token="Bearer token1",
        )
        acc2 = TaxAuthorityCredential(
            id=2,
            distributor_id=distributor.id,
            username="0102222222",
            bearer_token="Bearer token2",
        )
        acc3 = TaxAuthorityCredential(
            id=3,
            distributor_id=distributor.id,
            username="0103333333",
            bearer_token=None,  # skipped
        )
        db.add_all([acc1, acc2, acc3])
        db.commit()

        result = sync_purchase_invoices_endpoint(
            GdtSyncPurchaseRequest(
                distributor_id=distributor.id,
                from_date=date(2026, 11, 1),
                to_date=date(2026, 11, 19),
            ),
            db=db,
        )

        assert result["success"] is True
        assert result["synced_accounts"] == 1
        assert result["total_found"] == 29
        assert result["saved_invoices"] == 29
        assert result["xml_extracted_count"] == 1
        assert result["skipped_accounts"] == 1
        assert "0103333333" in result["skipped_account_names"]

        # Check errors list exposes the username and human-readable reason
        assert len(result["errors"]) == 1
        err = result["errors"][0]
        assert err["credential_id"] == 2
        assert err["username"] == "0102222222"
        assert "Bearer Token đã hết hạn" in err["reason"]

        # Check warnings contain account prefix
        assert any("[0101111111]" in w for w in result["warnings"])


def test_split_date_range_monthly():
    from app.services.gdt_purchase_invoice_service import split_date_range_monthly
    from datetime import date

    # Same month
    r1 = split_date_range_monthly(date(2026, 10, 1), date(2026, 10, 31))
    assert r1 == [(date(2026, 10, 1), date(2026, 10, 31))]

    # Span 2 months
    r2 = split_date_range_monthly(date(2026, 10, 1), date(2026, 11, 20))
    assert r2 == [
        (date(2026, 10, 1), date(2026, 10, 31)),
        (date(2026, 11, 1), date(2026, 11, 20)),
    ]

    # Span 3 months
    r3 = split_date_range_monthly(date(2026, 8, 15), date(2026, 10, 5))
    assert r3 == [
        (date(2026, 8, 15), date(2026, 8, 31)),
        (date(2026, 9, 1), date(2026, 9, 30)),
        (date(2026, 10, 1), date(2026, 10, 5)),
    ]

    # Invalid range
    r4 = split_date_range_monthly(date(2026, 11, 20), date(2026, 10, 1))
    assert r4 == []


