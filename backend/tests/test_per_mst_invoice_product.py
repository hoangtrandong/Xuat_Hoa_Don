"""Tests for per-MST InvoiceProduct assignment on CQT products (ProductCompany.invoice_product_id)."""
from datetime import datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.invoice_products import _serialize_invoice_products
from app.api.v1.endpoints.products import assign_product_invoice_product, list_products_paged
from app.core.database import Base
from app.models.customer import Company
from app.models.multi_tenant_invoice import (
    Distributor,
    PurchaseInvoice,
    PurchaseInvoiceItem,
)
from app.models.product import (
    InvoiceProduct,
    Product,
    ProductCategory,
    ProductCompany,
    ProductUnit,
)
from app.schemas.product import ProductInvoiceProductUpdate
from app.services.tax_inventory_service import compute_tax_inventory_by_mst


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _seed_multi_mst_product(db):
    dist = Distributor(code="NPP01", name="NPP Test", tax_code="0100000001")
    db.add(dist)
    db.flush()

    comp_a = Company(code="CTY_A", name="Cong Ty A", short_name="CTY A", tax_code="0101111111", distributor_id=dist.id)
    comp_b = Company(code="CTY_B", name="Cong Ty B", short_name="CTY B", tax_code="0102222222", distributor_id=dist.id)
    cat = ProductCategory(code="SUA", name="Sua")
    unit = ProductUnit(code="HOP", name="Hộp")
    db.add_all([comp_a, comp_b, cat, unit])
    db.flush()

    ip_a = InvoiceProduct(distributor_id=dist.id, code="XHD-A", name="Sữa Tươi A (Thùng)", unit_name="Thùng", vat_rate=8.0)
    ip_b = InvoiceProduct(distributor_id=dist.id, code="XHD-B", name="Sữa Tươi B (Hộp)", unit_name="Hộp", vat_rate=8.0)
    db.add_all([ip_a, ip_b])
    db.flush()

    prod = Product(
        sku="CQT-001",
        name="Sữa tươi CQT 001",
        category_id=cat.id,
        unit_id=unit.id,
        supplier="Vinamilk",
        status="active",
    )
    db.add(prod)
    db.flush()

    pc_a = ProductCompany(product_id=prod.id, company_id=comp_a.id, is_primary=True, total_purchased_qty=100)
    pc_b = ProductCompany(product_id=prod.id, company_id=comp_b.id, is_primary=False, total_purchased_qty=50)
    db.add_all([pc_a, pc_b])
    db.commit()
    return dist, comp_a, comp_b, prod, ip_a, ip_b


def test_assign_distinct_invoice_products_per_mst_and_list_expanded(db_session):
    _dist, comp_a, comp_b, prod, ip_a, ip_b = _seed_multi_mst_product(db_session)

    # Gán riêng XHD-A cho MST A
    res_a = assign_product_invoice_product(
        prod.id,
        ProductInvoiceProductUpdate(invoice_product_id=ip_a.id, company_id=comp_a.id, apply_all_companies=False),
        db=db_session,
    )
    assert res_a["ok"] is True
    assert res_a["invoice_product_code"] == "XHD-A"

    # Gán riêng XHD-B cho MST B
    res_b = assign_product_invoice_product(
        prod.id,
        ProductInvoiceProductUpdate(invoice_product_id=ip_b.id, company_id=comp_b.id, apply_all_companies=False),
        db=db_session,
    )
    assert res_b["ok"] is True
    assert res_b["invoice_product_code"] == "XHD-B"

    # Kiểm tra API /products/paged?expand_by_mst=true tách thành 2 dòng với 2 Mã SP XHĐ khác nhau
    paged = list_products_paged(page=1, page_size=50, expand_by_mst=True, db=db_session)
    assert paged["total"] == 2
    by_comp = {row["row_company_id"]: row for row in paged["items"]}
    assert by_comp[comp_a.id]["invoice_product_code"] == "XHD-A"
    assert by_comp[comp_a.id]["invoice_product_id"] == ip_a.id
    assert by_comp[comp_a.id]["mst_count"] == 2

    assert by_comp[comp_b.id]["invoice_product_code"] == "XHD-B"
    assert by_comp[comp_b.id]["invoice_product_id"] == ip_b.id
    assert by_comp[comp_b.id]["mst_count"] == 2

    # Đếm cqt_sku_count trên danh sách SP xuất hóa đơn phải đúng = 1 cho mỗi mã
    serialized_ips = _serialize_invoice_products(db_session, [ip_a, ip_b])
    counts = {item.code: item.cqt_sku_count for item in serialized_ips}
    assert counts == {"XHD-A": 1, "XHD-B": 1}

    # Gỡ riêng MST B -> MST A vẫn giữ XHD-A
    assign_product_invoice_product(
        prod.id,
        ProductInvoiceProductUpdate(invoice_product_id=None, company_id=comp_b.id, apply_all_companies=False),
        db=db_session,
    )
    paged_after_clear = list_products_paged(page=1, page_size=50, expand_by_mst=True, db=db_session)
    by_comp_after = {row["row_company_id"]: row for row in paged_after_clear["items"]}
    assert by_comp_after[comp_a.id]["invoice_product_code"] == "XHD-A"
    assert by_comp_after[comp_b.id]["invoice_product_code"] is None

    # Áp dụng cho tất cả MST của mã CQT này
    assign_product_invoice_product(
        prod.id,
        ProductInvoiceProductUpdate(invoice_product_id=ip_b.id, company_id=comp_a.id, apply_all_companies=True),
        db=db_session,
    )
    pcs = db_session.scalars(select(ProductCompany).where(ProductCompany.product_id == prod.id)).all()
    assert all(pc.invoice_product_id == ip_b.id for pc in pcs)


def test_tax_inventory_resolves_cqt_sku_by_mst_invoice_product(db_session):
    dist, comp_a, comp_b, prod, ip_a, ip_b = _seed_multi_mst_product(db_session)

    assign_product_invoice_product(
        prod.id,
        ProductInvoiceProductUpdate(invoice_product_id=ip_a.id, company_id=comp_a.id, apply_all_companies=False),
        db=db_session,
    )
    assign_product_invoice_product(
        prod.id,
        ProductInvoiceProductUpdate(invoice_product_id=ip_b.id, company_id=comp_b.id, apply_all_companies=False),
        db=db_session,
    )

    # Cùng 1 mã CQT-001 mua vào ở 2 MST khác nhau
    db_session.add_all([
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0001001",
            invoice_date=datetime(2026, 11, 10),
            seller_tax_code="0300000001",
            seller_name="NCC",
            buyer_tax_code=comp_a.tax_code,
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT-001",
                    product_name="Sữa tươi CQT 001",
                    unit_name="Thùng",
                    quantity=10,
                    unit_price=100000,
                    amount_before_tax=1_000_000,
                )
            ],
        ),
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TBB",
            invoice_number="0001002",
            invoice_date=datetime(2026, 11, 11),
            seller_tax_code="0300000001",
            seller_name="NCC",
            buyer_tax_code=comp_b.tax_code,
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT-001",
                    product_name="Sữa tươi CQT 001",
                    unit_name="Hộp",
                    quantity=24,
                    unit_price=10000,
                    amount_before_tax=240_000,
                )
            ],
        ),
    ])
    db_session.commit()

    res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="MST_SKU")
    by_mst = {item["tax_code"]: item for item in res["items"]}

    assert by_mst[comp_a.tax_code]["invoice_product_code"] == "XHD-A"
    assert by_mst[comp_a.tax_code]["input_qty"] == 10.0

    assert by_mst[comp_b.tax_code]["invoice_product_code"] == "XHD-B"
    assert by_mst[comp_b.tax_code]["input_qty"] == 24.0


def test_filter_has_mst_and_safe_cleanup_non_cqt_products(db_session):
    from app.crud.product import analyze_non_cqt_products, cleanup_non_cqt_products
    from app.models.product import PriceList, PriceListItem

    dist, comp_a, _comp_b, prod_cqt, _ip_a, _ip_b = _seed_multi_mst_product(db_session)

    # 1. Mã CQT có trên PurchaseInvoiceItem nhưng chưa có ProductCompany -> phải được BẢO VỆ
    prod_cqt_missing_mst = Product(
        sku="CQT-NO-MST",
        name="Sữa CQT chưa sync MST",
        category_id=prod_cqt.category_id,
        unit_id=prod_cqt.unit_id,
        status="active",
        sync_source="PURCHASE_INVOICE",
    )
    # 2. Mã DMS cũ không có MST, không có PurchaseInvoiceItem, không có FK -> XÓA AN TOÀN
    prod_dms_trash = Product(
        sku="DMS-OLD-01",
        name="Sản phẩm DMS cũ",
        category_id=prod_cqt.category_id,
        unit_id=prod_cqt.unit_id,
        status="active",
        sync_source="ORDER_SYNC",
    )
    # 3. Mã DMS cũ có tham chiếu PriceListItem -> KHÔNG XÓA VẬT LÝ, chỉ chuyển inactive
    prod_dms_ref = Product(
        sku="DMS-REF-02",
        name="Sản phẩm DMS có bảng giá",
        category_id=prod_cqt.category_id,
        unit_id=prod_cqt.unit_id,
        status="active",
        sync_source="ORDER_SYNC",
    )
    db_session.add_all([prod_cqt_missing_mst, prod_dms_trash, prod_dms_ref])
    db_session.flush()

    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0009999",
            invoice_date=datetime(2026, 11, 12),
            seller_tax_code="0300000001",
            seller_name="NCC",
            buyer_tax_code=comp_a.tax_code,
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT-NO-MST",
                    product_name="Sữa CQT chưa sync MST",
                    unit_name="Hộp",
                    quantity=5,
                    unit_price=10000,
                    amount_before_tax=50_000,
                )
            ],
        )
    )
    pl = PriceList(name="BG Test", customer_type="ALL", effective_date=datetime(2026, 11, 1))
    db_session.add(pl)
    db_session.flush()
    db_session.add(PriceListItem(price_list_id=pl.id, product_id=prod_dms_ref.id, price=15000))
    db_session.commit()

    # Kiểm tra lọc company_id = -1 (chỉ hiện SP có MST CQT)
    has_mst_paged = list_products_paged(page=1, page_size=50, company_id=-1, expand_by_mst=True, db=db_session)
    assert {r["sku"] for r in has_mst_paged["items"]} == {"CQT-001"}

    # Kiểm tra preview phân tích an toàn
    preview = analyze_non_cqt_products(db_session)
    assert preview["total_no_mst"] == 3
    assert preview["cqt_missing_mst_count"] == 1
    assert preview["deletable_count"] == 1
    assert preview["referenced_count"] == 1

    # Thực thi dọn dẹp an toàn
    res = cleanup_non_cqt_products(db_session, deactivate_referenced=True)
    assert res["deleted_count"] == 1
    assert res["deactivated_count"] == 1
    assert res["skipped_referenced_count"] == 1

    remaining_skus = {p.sku: p.status for p in db_session.scalars(select(Product)).all()}
    assert "DMS-OLD-01" not in remaining_skus
    assert remaining_skus["CQT-001"] == "active"
    assert remaining_skus["CQT-NO-MST"] == "active"
    assert remaining_skus["DMS-REF-02"] == "inactive"


def test_cqt_template_vietnamese_headers_and_per_mst_excel_upload(db_session):
    from io import BytesIO
    from fastapi import UploadFile
    from openpyxl import load_workbook
    from app.api.v1.endpoints.products import download_product_template, upload_products

    _dist, comp_a, comp_b, _prod, ip_a, ip_b = _seed_multi_mst_product(db_session)

    # 1. Tải file mẫu và kiểm tra tiêu đề tiếng Việt đúng với bảng CQT (không còn Quy cách)
    resp = download_product_template()
    wb = load_workbook(BytesIO(resp.body))
    ws = wb.active
    headers = [cell.value for cell in ws[1]]
    assert headers == [
        "MST đầu vào (CQT)",
        "Mã SP đầu vào (CQT)",
        "Mã SP xuất HĐ",
        "Tên sản phẩm / Hàng hóa",
        "Ngành hàng",
        "ĐVT",
        "Nhà cung cấp",
        "Giá bán / ĐVT (VNĐ)",
        "Thuế suất VAT (%)",
        "Trạng thái",
    ]
    assert "Quy cách" not in " ".join(headers)

    # 2. Điền 2 dòng cho cùng 1 mã CQT mới (CQT-XL-01) với 2 MST và 2 Mã SP xuất HĐ khác nhau
    ws.delete_rows(3, ws.max_row)
    ws.append([comp_a.tax_code, "CQT-XL-01", ip_a.code, "Sữa tươi upload Excel", "SUA", "Hộp", "Vinamilk", 12000, "8%", "Đang bán"])
    ws.append([comp_b.tax_code, "CQT-XL-01", ip_b.code, "Sữa tươi upload Excel", "SUA", "Hộp", "Vinamilk", 12000, "8%", "Đang bán"])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    upload_file = UploadFile(filename="mau-san-pham-cqt.xlsx", file=buf)
    result = upload_products(file=upload_file, db=db_session)
    assert result["imported"] == 1
    assert result["updated"] == 1
    assert result["mst_mapped"] == 2

    uploaded_prod = db_session.scalar(select(Product).where(Product.sku == "CQT-XL-01"))
    assert uploaded_prod is not None
    assert uploaded_prod.vat_rate == 8.0
    pcs = {
        pc.company_id: pc.invoice_product_id
        for pc in db_session.scalars(
            select(ProductCompany).where(ProductCompany.product_id == uploaded_prod.id)
        ).all()
    }
    assert pcs == {comp_a.id: ip_a.id, comp_b.id: ip_b.id}
