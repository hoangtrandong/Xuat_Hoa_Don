from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.product_groups import (
    create_distributor_product,
    delete_distributor_product,
    list_distributor_products,
)
from app.core.config import settings
from app.core.database import Base
from app.crud.customer import sync_customers_from_snapshots
from app.main import _is_allowed_origin
from app.models.customer import Customer
from app.models.multi_tenant_invoice import Distributor, DistributorInvoiceConfig
from app.models.vinamilk import VinamilkOrderSnapshot
from app.schemas.product_group import DistributorProductCreate
from app.services.einvoice_gateway import (
    MisaMeInvoiceProvider,
    MockEInvoiceBlockedError,
    PreviewInvoiceDocument,
)
from app.services.supplier_secrets import decrypt_supplier_secret, encrypt_supplier_secret


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)
    with Session() as db:
        dist_a = Distributor(code="NPP-A", name="NPP Alpha", tax_code="0101111111")
        dist_b = Distributor(code="NPP-B", name="NPP Beta", tax_code="0102222222")
        db.add_all([dist_a, dist_b])
        db.commit()
        db.refresh(dist_a)
        db.refresh(dist_b)
        yield db, dist_a, dist_b


def _user(distributor_id: int | None, username: str = "tester"):
    return SimpleNamespace(
        id=1,
        username=username,
        distributor_id=distributor_id,
        roles=[SimpleNamespace(name="admin")] if distributor_id is None else [SimpleNamespace(name="staff")],
    )


def test_mock_einvoice_blocked_by_default_and_draft_allowed(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_MOCK_EINVOICE", False)
    provider = MisaMeInvoiceProvider()
    cfg = DistributorInvoiceConfig(
        id=1,
        distributor_id=1,
        provider="MISA",
        invoice_template_code="1/001",
        invoice_series="1C26TDD",
    )
    doc = PreviewInvoiceDocument(
        distributor_id=1,
        distributor_code="NPP-A",
        distributor_name="NPP Alpha",
        seller_tax_code="0101111111",
        seller_address="HN",
        seller_phone="",
        seller_bank_account="",
        seller_bank_name="",
        invoice_config_id=1,
        provider="MISA",
        invoice_template_code="1/001",
        invoice_series="1C26TDD",
        supplier_code="VINAMILK",
        source_order_numbers=["ORD-001"],
        buyer_code="KH01",
        buyer_name="Khach A",
        buyer_legal_name="Khach A",
        buyer_tax_code="0109999999",
        buyer_address="HN",
    )

    draft_res = provider.issue_invoice(doc, cfg, publish_immediately=False)
    assert draft_res["status"] == "DRAFT"
    assert draft_res["invoice_number"] is None
    assert draft_res["tax_authority_code"] is None
    assert draft_res["is_simulated"] is False

    with pytest.raises(MockEInvoiceBlockedError):
        provider.issue_invoice(doc, cfg, publish_immediately=True)

    monkeypatch.setattr(settings, "ALLOW_MOCK_EINVOICE", True)
    sim_res = provider.issue_invoice(doc, cfg, publish_immediately=True)
    assert sim_res["status"] == "ISSUED"
    assert sim_res["is_simulated"] is True
    assert sim_res["invoice_number"] is not None


def test_supplier_secret_rotation_with_data_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "legacy-jwt-secret-key-at-least-32-chars!!")
    monkeypatch.setattr(settings, "DATA_ENCRYPTION_KEY", None)
    legacy_cipher = encrypt_supplier_secret("top-secret-password")
    assert legacy_cipher and legacy_cipher.startswith("enc:v1:")

    # Khi bật DATA_ENCRYPTION_KEY riêng, vẫn giải mã được dữ liệu cũ mã hóa bằng SECRET_KEY
    monkeypatch.setattr(settings, "DATA_ENCRYPTION_KEY", "dedicated-data-encryption-key-32-chars!!")
    assert decrypt_supplier_secret(legacy_cipher) == "top-secret-password"

    new_cipher = encrypt_supplier_secret("new-secret-password")
    assert decrypt_supplier_secret(new_cipher) == "new-secret-password"


def test_cors_whitelist_blocks_arbitrary_origins(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", "https://app.dms.vn,http://localhost:3001")
    monkeypatch.setattr(settings, "DEBUG", False)
    assert _is_allowed_origin("https://app.dms.vn") is True
    assert _is_allowed_origin("http://localhost:3001") is True
    assert _is_allowed_origin("http://103.90.225.142.sslip.io") is True
    assert _is_allowed_origin("https://web.103.90.225.142.sslip.io") is True
    assert _is_allowed_origin("https://evil.example.com") is False
    assert _is_allowed_origin(None) is False


def test_distributor_products_isolated_per_tenant(db_session):
    db, dist_a, dist_b = db_session
    user_a = _user(dist_a.id, "user_a")
    user_b = _user(dist_b.id, "user_b")

    # Hai NPP độc lập đều có thể tạo cùng mã SP NPP "01TD03"
    item_a = create_distributor_product(
        DistributorProductCreate(
            distributor_sku="01TD03",
            distributor_product_name="Sữa Alpha",
        ),
        db=db,
        current_user=user_a,
    )
    item_b = create_distributor_product(
        DistributorProductCreate(
            distributor_sku="01TD03",
            distributor_product_name="Sữa Beta",
        ),
        db=db,
        current_user=user_b,
    )
    assert item_a.distributor_id == dist_a.id
    assert item_b.distributor_id == dist_b.id
    assert item_a.distributor_name == "NPP Alpha"
    assert item_b.distributor_name == "NPP Beta"

    list_a = list_distributor_products(db=db, current_user=user_a)
    list_b = list_distributor_products(db=db, current_user=user_b)
    assert [x.distributor_product_name for x in list_a] == ["Sữa Alpha"]
    assert [x.distributor_product_name for x in list_b] == ["Sữa Beta"]

    # NPP A không được xóa mã SP của NPP B
    with pytest.raises(HTTPException) as exc:
        delete_distributor_product(str(item_b.id), db=db, current_user=user_a)
    assert exc.value.status_code == 403


def test_sync_customers_from_snapshots_resolves_distributor_dynamically(db_session):
    db, dist_a, dist_b = db_session
    db.add(
        VinamilkOrderSnapshot(
            remote_key="K1",
            order_number="ORD-B1",
            customer_code="KH-B01",
            customer_name="Cửa hàng Beta",
            product_code="SKU1",
            synced_from=date(2026, 11, 1),
            synced_to=date(2026, 11, 1),
            raw_payload={"Mã NPP": "NPP-B"},
        )
    )
    db.commit()

    created = sync_customers_from_snapshots(db)
    assert created == 1
    cust = db.query(Customer).filter(Customer.code == "KH-B01").one()
    assert cust.distributor_id == dist_b.id
