from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.customer import Company
from app.models.multi_tenant_invoice import (
    Distributor,
    IssuedInvoice,
    IssuedInvoiceItem,
    PurchaseInvoice,
    PurchaseInvoiceItem,
    TaxAuthorityCredential,
)
from app.services.gdt_sales_invoice_service import (
    get_sales_reconciliation_report,
    reconcile_gdt_sold_invoice_records,
)
from app.services.tax_inventory_service import compute_tax_inventory_by_mst


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)
    with Session() as db:
        dist = Distributor(code="NPP-TEST", name="NPP Test", tax_code="0101000001")
        db.add(dist)
        db.flush()
        comp = Company(
            distributor_id=dist.id,
            code="CT01",
            name="Công ty TNHH Test 01",
            tax_code="0101000001",
        )
        db.add(comp)
        cred = TaxAuthorityCredential(distributor_id=dist.id, username="0101000001")
        db.add(cred)
        db.commit()
        db.refresh(dist)
        db.refresh(comp)
        db.refresh(cred)
        yield db, dist, comp, cred


def test_monthly_weighted_average_cogs_does_not_leak_future_month_price(db_session):
    """BQGQ theo từng tháng: Giá nhập tháng 2 (300k) KHÔNG được làm tăng giá vốn xuất kho của tháng 1 (200k)."""
    db, dist, _comp, cred = db_session

    # Tháng 1: Nhập 10 thùng @ 200,000 = 2,000,000
    p1 = PurchaseInvoice(
        distributor_id=dist.id,
        tax_credential_id=cred.id,
        invoice_template="1",
        invoice_symbol="1C26TAA",
        invoice_number="0000001",
        invoice_date=datetime(2026, 1, 5, 10, 0),
        seller_tax_code="0300588569",
        seller_name="Vinamilk",
        buyer_tax_code="0101000001",
        xml_downloaded=True,
    )
    db.add(p1)
    db.flush()
    db.add(
        PurchaseInvoiceItem(
            purchase_invoice_id=p1.id,
            item_nature=1,
            product_code="SKU-M1",
            product_name="Sữa tươi 180ml",
            unit_name="THUNG",
            quantity=10,
            unit_price=200_000,
            amount_before_tax=2_000_000,
        )
    )

    # Tháng 1: Xuất 5 thùng (giá vốn chuẩn tháng 1 = 5 * 200,000 = 1,000,000; tồn cuối T1 = 5 @ 200k = 1,000,000)
    s1 = IssuedInvoice(
        distributor_id=dist.id,
        seller_tax_code="0101000001",
        provider="VIETTEL",
        invoice_template_code="1/001",
        invoice_series="1C26TDD",
        invoice_number="0000101",
        status="ISSUED",
        buyer_name="KH A",
        issued_at=datetime(2026, 1, 20, 14, 0),
    )
    db.add(s1)
    db.flush()
    db.add(
        IssuedInvoiceItem(
            invoice_id=s1.id,
            item_type="NORMAL",
            product_code="SKU-M1",
            product_name="Sữa tươi 180ml",
            unit_name="THUNG",
            quantity=5,
            source_sku="SKU-M1",
            source_quantity=5,
            amount_before_tax=1_250_000,
        )
    )

    # Tháng 2: Nhập thêm 5 thùng @ 300,000 = 1,500,000
    # -> Tháng 2 khả dụng = 5 (1,000,000) + 5 (1,500,000) = 10 thùng / 2,500,000 -> ĐG BQGQ T2 = 250,000
    p2 = PurchaseInvoice(
        distributor_id=dist.id,
        tax_credential_id=cred.id,
        invoice_template="1",
        invoice_symbol="1C26TAA",
        invoice_number="0000002",
        invoice_date=datetime(2026, 2, 5, 10, 0),
        seller_tax_code="0300588569",
        seller_name="Vinamilk",
        buyer_tax_code="0101000001",
        xml_downloaded=True,
    )
    db.add(p2)
    db.flush()
    db.add(
        PurchaseInvoiceItem(
            purchase_invoice_id=p2.id,
            item_nature=1,
            product_code="SKU-M1",
            product_name="Sữa tươi 180ml",
            unit_name="THUNG",
            quantity=5,
            unit_price=300_000,
            amount_before_tax=1_500_000,
        )
    )

    # Tháng 2: Xuất 4 thùng -> Giá vốn T2 = 4 * 250,000 = 1,000,000; tồn cuối T2 = 6 thùng / 1,500,000
    s2 = IssuedInvoice(
        distributor_id=dist.id,
        seller_tax_code="0101000001",
        provider="VIETTEL",
        invoice_template_code="1/001",
        invoice_series="1C26TDD",
        invoice_number="0000102",
        status="ISSUED",
        buyer_name="KH B",
        issued_at=datetime(2026, 2, 18, 14, 0),
    )
    db.add(s2)
    db.flush()
    db.add(
        IssuedInvoiceItem(
            invoice_id=s2.id,
            item_type="NORMAL",
            product_code="SKU-M1",
            product_name="Sữa tươi 180ml",
            unit_name="THUNG",
            quantity=4,
            source_sku="SKU-M1",
            source_quantity=4,
            amount_before_tax=1_200_000,
        )
    )
    db.commit()

    res = compute_tax_inventory_by_mst(
        db,
        distributor_id=dist.id,
        from_date=date(2026, 1, 1),
        to_date=date(2026, 2, 28),
        group_by="MST_SKU",
    )
    assert len(res["items"]) == 1
    row = res["items"][0]
    # Tổng giá vốn chuẩn theo từng tháng = 1,000,000 (T1) + 1,000,000 (T2) = 2,000,000
    # (Nếu tính sai theo cả kỳ sẽ là 9 * (3,500,000 / 15) = 2,100,000!)
    assert row["cogs_amount"] == 2_000_000.0
    assert row["ending_inventory_value"] == 1_500_000.0
    assert row["balance_qty"] == 6.0


def test_promotion_tchat2_separated_from_commercial_cogs_and_below_cost(db_session):
    """Hàng khuyến mãi (TChat=2 đầu vào & item_type=PROMOTION đầu ra) tách riêng, không làm loãng giá vốn TK 156."""
    db, dist, _comp, cred = db_session

    p1 = PurchaseInvoice(
        distributor_id=dist.id,
        tax_credential_id=cred.id,
        invoice_template="1",
        invoice_symbol="1C26TAA",
        invoice_number="0000010",
        invoice_date=datetime(2026, 3, 2, 9, 0),
        seller_tax_code="0300588569",
        seller_name="Vinamilk",
        buyer_tax_code="0101000001",
        xml_downloaded=True,
    )
    db.add(p1)
    db.flush()
    db.add_all(
        [
            PurchaseInvoiceItem(
                purchase_invoice_id=p1.id,
                item_nature=1,  # Hàng thương mại
                product_code="SKU-KM",
                product_name="Sữa chua",
                unit_name="THUNG",
                quantity=10,
                unit_price=200_000,
                amount_before_tax=2_000_000,
            ),
            PurchaseInvoiceItem(
                purchase_invoice_id=p1.id,
                item_nature=2,  # Hàng khuyến mãi không thu tiền (TChat=2)
                product_code="SKU-KM",
                product_name="Sữa chua (KM)",
                unit_name="THUNG",
                quantity=10,
                unit_price=0,
                amount_before_tax=0,
            ),
        ]
    )

    s1 = IssuedInvoice(
        distributor_id=dist.id,
        seller_tax_code="0101000001",
        provider="VIETTEL",
        invoice_template_code="1/001",
        invoice_series="1C26TDD",
        invoice_number="0000201",
        status="ISSUED",
        buyer_name="KH C",
        issued_at=datetime(2026, 3, 10, 11, 0),
    )
    db.add(s1)
    db.flush()
    db.add_all(
        [
            IssuedInvoiceItem(
                invoice_id=s1.id,
                item_type="NORMAL",
                product_code="SKU-KM",
                product_name="Sữa chua",
                unit_name="THUNG",
                quantity=4,
                source_sku="SKU-KM",
                source_quantity=4,
                amount_before_tax=880_000,  # 220k/thùng > giá vốn 200k
            ),
            IssuedInvoiceItem(
                invoice_id=s1.id,
                item_type="PROMOTION",
                product_code="SKU-KM",
                product_name="Sữa chua (KM)",
                unit_name="THUNG",
                quantity=3,
                source_sku="SKU-KM",
                source_quantity=3,
                amount_before_tax=0,
            ),
        ]
    )
    db.commit()

    res = compute_tax_inventory_by_mst(
        db,
        distributor_id=dist.id,
        from_date=date(2026, 3, 1),
        to_date=date(2026, 3, 31),
        group_by="MST_SKU",
    )
    row = res["items"][0]
    # Đơn giá bình quân hàng thương mại phải giữ nguyên 200,000 (không bị chia cho 20 thành 100,000!)
    assert row["avg_unit_cost"] == 200_000.0
    assert row["cogs_amount"] == 800_000.0
    assert row["is_below_cost"] is False
    assert row["promo_in_qty"] == 10.0
    assert row["promo_out_qty"] == 3.0
    assert row["promo_balance_qty"] == 7.0


def test_gdt_sold_invoice_auto_reconciles_draft_and_creates_cqt_only(db_session):
    """Vòng kín CQT: tự động nâng cấp DRAFT (Excel Viettel) thành ISSUED khi khớp MST mua + tổng tiền,
    đồng thời tạo mới bản ghi GDT_CQT cho hóa đơn lập trực tiếp trên Viettel và cảnh báo DRAFT tồn đọng."""
    db, dist, comp, _cred = db_session

    # 1. Tạo 2 DRAFT đã xuất file Excel Viettel
    draft_matched = IssuedInvoice(
        distributor_id=dist.id,
        seller_company_id=comp.id,
        seller_tax_code="0101000001",
        provider="VIETTEL",
        invoice_template_code="1/001",
        invoice_series="1C26TTD",
        status="DRAFT",
        source_order_numbers=["DMS-001"],
        buyer_name="Cửa hàng Minh Anh",
        buyer_tax_code="0108888888",
        subtotal_before_tax=1_000_000,
        vat_amount=80_000,
        total_payment=1_080_000,
        created_at=datetime(2026, 11, 20, 15, 0),
    )
    draft_pending = IssuedInvoice(
        distributor_id=dist.id,
        seller_company_id=comp.id,
        seller_tax_code="0101000001",
        provider="VIETTEL",
        invoice_template_code="1/001",
        invoice_series="1C26TTD",
        status="DRAFT",
        source_order_numbers=["DMS-002"],
        buyer_name="Cửa hàng Chưa Ký",
        buyer_tax_code="0107777777",
        subtotal_before_tax=500_000,
        vat_amount=40_000,
        total_payment=540_000,
        created_at=datetime(2026, 11, 20, 16, 0),
    )
    db.add_all([draft_matched, draft_pending])
    db.commit()

    # 2. Mô phỏng dữ liệu trả về từ Cổng CQT bán ra (1 hóa đơn khớp draft_matched, 1 hóa đơn lập tay ngoài DMS)
    cqt_records = [
        {
            "invoice_template": "1",
            "invoice_series": "C26TTD",
            "invoice_number": "0000555",
            "invoice_date": datetime(2026, 11, 20, 17, 30),
            "tax_authority_code": "M1-26-CQT-REAL-555",
            "tthai": 1,
            "buyer_tax_code": "0108888888",
            "buyer_name": "Cửa hàng Minh Anh",
            "amount_before_tax": 1_000_000,
            "tax_amount": 80_000,
            "total_amount": 1_080_000,
            "items": [],
        },
        {
            "invoice_template": "1",
            "invoice_series": "C26TTD",
            "invoice_number": "0000556",
            "invoice_date": datetime(2026, 11, 21, 9, 0),
            "tax_authority_code": "M1-26-CQT-REAL-556",
            "tthai": 1,
            "buyer_tax_code": "0106666666",
            "buyer_name": "Khách lập tay Viettel",
            "amount_before_tax": 2_000_000,
            "tax_amount": 160_000,
            "total_amount": 2_160_000,
            "items": [
                {
                    "line_number": 1,
                    "item_nature": 1,
                    "product_code": "SKU-DIRECT",
                    "product_name": "Hàng bán trực tiếp",
                    "unit_name": "THUNG",
                    "quantity": 10,
                    "unit_price": 200_000,
                    "amount_before_tax": 2_000_000,
                    "vat_rate": "8%",
                }
            ],
        },
    ]

    summary = reconcile_gdt_sold_invoice_records(
        db,
        distributor_id=dist.id,
        seller_tax_code="0101000001",
        records=cqt_records,
        from_date=date(2026, 11, 1),
        to_date=date(2026, 11, 30),
    )
    assert summary["matched_drafts"] == 1
    assert summary["created_from_cqt"] == 1
    assert summary["pending_drafts_count"] == 1

    db.refresh(draft_matched)
    assert draft_matched.status == "ISSUED"
    assert draft_matched.invoice_number == "0000555"
    assert draft_matched.tax_authority_code == "M1-26-CQT-REAL-555"

    report = get_sales_reconciliation_report(
        db,
        distributor_id=dist.id,
        seller_tax_code="0101000001",
        from_date=date(2026, 11, 1),
        to_date=date(2026, 11, 30),
    )
    assert report["summary"]["reconciled_count"] == 1
    assert report["summary"]["cqt_only_count"] == 1
    assert report["summary"]["pending_drafts_count"] == 1
