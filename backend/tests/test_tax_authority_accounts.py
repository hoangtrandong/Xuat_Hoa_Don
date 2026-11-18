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
