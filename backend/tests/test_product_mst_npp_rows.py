from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.v1.endpoints.products import (
    list_products_paged,
    update_product_company_npp_code,
)
from app.core.database import Base
from app.models.customer import Company
from app.models.multi_tenant_invoice import Distributor, PurchaseInvoice, PurchaseInvoiceItem
from app.models.product import Product, ProductCategory, ProductCompany, ProductUnit
from app.schemas.product import ProductCompanyNppCodeUpdate
from app.services.tax_inventory_service import compute_tax_inventory_by_mst


def _make_session() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def test_list_products_paged_expands_rows_per_mst_and_maps_npp_independently():
    db = _make_session()
    try:
        cat = ProductCategory(code="C", name="C - Sữa Tươi")
        unit = ProductUnit(code="THUNG", name="Thùng")
        dist = Distributor(code="NPP01", name="NPP Mai Gold")
        db.add_all([cat, unit, dist])
        db.flush()

        comp_a = Company(
            distributor_id=dist.id,
            code="CT01",
            name="Công ty TNHH A",
            short_name="Cty A",
            tax_code="0101111111",
            status="active",
        )
        comp_b = Company(
            distributor_id=dist.id,
            code="CT02",
            name="Công ty TNHH B",
            short_name="Cty B",
            tax_code="0102222222",
            status="active",
        )
        db.add_all([comp_a, comp_b])
        db.flush()

        # SKU dùng chung 2 MST
        p_multi = Product(
            sku="01TD03",
            name="Sữa tươi tiệt trùng 180ml",
            category_id=cat.id,
            unit_id=unit.id,
            supplier="Vinamilk",
            status="active",
            sync_source="PURCHASE_INVOICE",
        )
        # SKU chưa gắn MST nào
        p_single = Product(
            sku="09KM01",
            name="Hàng khuyến mãi",
            category_id=cat.id,
            unit_id=unit.id,
            supplier="Vinamilk",
            status="active",
            sync_source="MANUAL",
        )
        db.add_all([p_multi, p_single])
        db.flush()

        db.add_all(
            [
                ProductCompany(
                    product_id=p_multi.id,
                    company_id=comp_a.id,
                    role="MANAGER",
                    is_primary=True,
                    source="PURCHASE_INVOICE",
                    total_purchased_qty=100,
                ),
                ProductCompany(
                    product_id=p_multi.id,
                    company_id=comp_b.id,
                    role="MANAGER",
                    is_primary=False,
                    source="PURCHASE_INVOICE",
                    total_purchased_qty=50,
                ),
            ]
        )
        db.commit()

        # 1. Tổng số dòng phải là 3 (2 dòng cho 01TD03 theo 2 MST + 1 dòng cho 09KM01 chưa có MST)
        res = list_products_paged(page=1, page_size=50, db=db)
        assert res["total"] == 3
        items = res["items"]
        multi_rows = [it for it in items if it["sku"] == "01TD03"]
        assert len(multi_rows) == 2
        assert {it["row_company_tax_code"] for it in multi_rows} == {"0101111111", "0102222222"}
        assert all(it["mst_count"] == 2 for it in multi_rows)
        assert len({it["row_key"] for it in multi_rows}) == 2

        single_rows = [it for it in items if it["sku"] == "09KM01"]
        assert len(single_rows) == 1
        assert single_rows[0]["row_company_id"] is None
        assert single_rows[0]["mst_count"] == 0

        # 2. Gán Mã NPP riêng cho (01TD03, MST A) -> MST B vẫn trống
        upd_a = update_product_company_npp_code(
            product_id=p_multi.id,
            company_id=comp_a.id,
            payload=ProductCompanyNppCodeUpdate(npp_code="NPP_A_01"),
            db=db,
        )
        assert upd_a["ok"] is True
        assert upd_a["npp_code"] == "NPP_A_01"

        res_after_a = list_products_paged(page=1, page_size=50, search="01TD03", db=db)
        by_mst = {it["row_company_tax_code"]: it for it in res_after_a["items"]}
        assert by_mst["0101111111"]["npp_code"] == "NPP_A_01"
        assert by_mst["0102222222"]["npp_code"] is None

        # 3. Lọc theo has_internal_code phân biệt đúng từng dòng (SKU, MST)
        mapped_only = list_products_paged(page=1, page_size=50, search="01TD03", has_internal_code=True, db=db)
        assert mapped_only["total"] == 1
        assert mapped_only["items"][0]["row_company_tax_code"] == "0101111111"

        unmapped_only = list_products_paged(page=1, page_size=50, search="01TD03", has_internal_code=False, db=db)
        assert unmapped_only["total"] == 1
        assert unmapped_only["items"][0]["row_company_tax_code"] == "0102222222"

        # 4. Gán Mã NPP khác cho (01TD03, MST B) -> kiểm tra tồn kho thuế phân giải đúng từng MST
        upd_b = update_product_company_npp_code(
            product_id=p_multi.id,
            company_id=comp_b.id,
            payload=ProductCompanyNppCodeUpdate(npp_code="NPP_B_02"),
            db=db,
        )
        assert upd_b["npp_code"] == "NPP_B_02"

        inv_a = PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0001",
            invoice_date=datetime(2026, 11, 10),
            seller_tax_code="0300588569",
            seller_name="Vinamilk",
            buyer_tax_code="0101111111",
            buyer_name="Công ty TNHH A",
            xml_downloaded=True,
            total_amount=100000,
        )
        inv_b = PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0002",
            invoice_date=datetime(2026, 11, 10),
            seller_tax_code="0300588569",
            seller_name="Vinamilk",
            buyer_tax_code="0102222222",
            buyer_name="Công ty TNHH B",
            xml_downloaded=True,
            total_amount=50000,
        )
        db.add_all([inv_a, inv_b])
        db.flush()
        db.add_all(
            [
                PurchaseInvoiceItem(
                    purchase_invoice_id=inv_a.id,
                    line_number=1,
                    product_code="01TD03",
                    product_name="Sữa tươi tiệt trùng 180ml",
                    unit_name="Thùng",
                    quantity=10,
                    unit_price=10000,
                    amount_before_tax=100000,
                ),
                PurchaseInvoiceItem(
                    purchase_invoice_id=inv_b.id,
                    line_number=1,
                    product_code="01TD03",
                    product_name="Sữa tươi tiệt trùng 180ml",
                    unit_name="Thùng",
                    quantity=5,
                    unit_price=10000,
                    amount_before_tax=50000,
                ),
            ]
        )
        db.commit()

        tax_summary = compute_tax_inventory_by_mst(db, distributor_id=dist.id, group_by="MST_SKU")
        rows_by_mst = {r["tax_code"]: r for r in tax_summary["items"]}
        assert rows_by_mst["0101111111"]["npp_code"] == "NPP_A_01"
        assert rows_by_mst["0102222222"]["npp_code"] == "NPP_B_02"
    finally:
        db.close()
