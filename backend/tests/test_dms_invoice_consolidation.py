from datetime import date
import zipfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.customer import Company, Customer
from app.models.multi_tenant_invoice import Distributor
from app.models.product import Product, ProductCategory, ProductUnit
from app.models.vinamilk import VinamilkOrderSnapshot
from app.services.invoice_consolidation import (
    consolidate_dms_orders_for_invoicing,
    export_consolidated_groups,
)


@pytest.fixture()
def seeded_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        dist = Distributor(code="NPP-MAIGOLD", name="Công ty Mai Gold", tax_code="2902292227")
        db.add(dist)
        db.flush()

        comp1 = Company(distributor_id=dist.id, code="CT01", name="Công ty A", tax_code="2902292227")
        comp2 = Company(distributor_id=dist.id, code="CT02", name="Công ty B", tax_code="2902292227")
        db.add_all([comp1, comp2])
        db.flush()

        cat = ProductCategory(code="CAT1", name="Sữa")
        unit = ProductUnit(code="THUNG", name="Thùng")
        db.add_all([cat, unit])
        db.flush()

        p1 = Product(sku="SKU001", name="Sữa tươi 180ml", category_id=cat.id, unit_id=unit.id, _npp_code="NPP_P1")
        db.add(p1)
        db.flush()

        # 2 mã KH khác nhau, cùng MST, cùng Công ty quản lý CT01 -> PHẢI GOM THÀNH 1 HÓA ĐƠN
        c1 = Customer(distributor_id=dist.id, code="KH01", name="Cửa hàng Minh A", type="RETAIL", tax_code="0101234567", company_id=comp1.id)
        c2 = Customer(distributor_id=dist.id, code="KH02", name="Cửa hàng Minh A (CS2)", type="RETAIL", tax_code="0101234567", company_id=comp1.id)
        # Cùng MST nhưng KHÁC Công ty quản lý CT02 -> PHẢI TÁCH THÀNH HÓA ĐƠN KHÁC
        c3 = Customer(distributor_id=dist.id, code="KH03", name="Cửa hàng Minh A (CT02)", type="RETAIL", tax_code="0101234567", company_id=comp2.id)
        # 2 mã KH cùng CCCD, cùng CT01 -> PHẢI GOM THÀNH 1 HÓA ĐƠN
        c4 = Customer(distributor_id=dist.id, code="KH04", name="Hộ KD Lan", type="RETAIL", citizen_id="040199001122", company_id=comp1.id)
        c5 = Customer(distributor_id=dist.id, code="KH05", name="Hộ KD Lan 2", type="RETAIL", citizen_id="040199001122", company_id=comp1.id)
        # KH thiếu MST, thiếu CCCD, thiếu Công ty QL -> KHÔNG HỢP LỆ
        c6 = Customer(distributor_id=dist.id, code="KH06", name="Khách thiếu info", type="RETAIL")
        db.add_all([c1, c2, c3, c4, c5, c6])
        db.flush()

        d = date(2026, 11, 20)
        snaps = [
            VinamilkOrderSnapshot(
                remote_key="k1", order_number="ORD01", customer_code="KH01", customer_name="Cửa hàng Minh A",
                product_code="NPP_P1", product_name="Sữa tươi 180ml",
                order_created_date=d, delivery_date=d, synced_from=d, synced_to=d,
                raw_payload={"Số lượng": 2, "Giá bán": 100000, "Thành tiền": 200000},
            ),
            VinamilkOrderSnapshot(
                remote_key="k2", order_number="ORD02", customer_code="KH02", customer_name="Cửa hàng Minh A (CS2)",
                product_code="SKU001", product_name="Sữa tươi 180ml",
                order_created_date=d, delivery_date=d, synced_from=d, synced_to=d,
                raw_payload={"Số lượng": 3, "Giá bán": 100000, "Thành tiền": 300000},
            ),
            VinamilkOrderSnapshot(
                remote_key="k3", order_number="ORD03", customer_code="KH03", customer_name="Cửa hàng Minh A (CT02)",
                product_code="SKU001", product_name="Sữa tươi 180ml",
                order_created_date=d, delivery_date=d, synced_from=d, synced_to=d,
                raw_payload={"Số lượng": 1, "Giá bán": 100000, "Thành tiền": 100000},
            ),
            VinamilkOrderSnapshot(
                remote_key="k4", order_number="ORD04", customer_code="KH04", customer_name="Hộ KD Lan",
                product_code="SKU001", product_name="Sữa tươi 180ml",
                order_created_date=d, delivery_date=d, synced_from=d, synced_to=d,
                raw_payload={"Số lượng": 4, "Giá bán": 100000, "Thành tiền": 400000},
            ),
            VinamilkOrderSnapshot(
                remote_key="k5", order_number="ORD05", customer_code="KH05", customer_name="Hộ KD Lan 2",
                product_code="SKU001", product_name="Sữa tươi 180ml",
                order_created_date=d, delivery_date=d, synced_from=d, synced_to=d,
                raw_payload={"Số lượng": 1, "Giá bán": 100000, "Thành tiền": 100000},
            ),
            VinamilkOrderSnapshot(
                remote_key="k6", order_number="ORD06", customer_code="KH06", customer_name="Khách thiếu info",
                product_code="UNKNOWN_SKU", product_name="SP chưa đăng ký",
                order_created_date=d, delivery_date=d, synced_from=d, synced_to=d,
                raw_payload={"Số lượng": 1, "Giá bán": 50000, "Thành tiền": 50000},
            ),
        ]
        db.add_all(snaps)
        db.commit()
        yield db, dist, d
    finally:
        db.close()


def test_consolidation_merges_by_tax_cccd_and_company_and_blocks_invalid(seeded_db):
    db, dist, d = seeded_db
    res = consolidate_dms_orders_for_invoicing(
        db,
        from_date=d,
        to_date=d,
        distributor_id=dist.id,
        default_vat_rate=8.0,
    )

    assert res["summary"]["total_groups"] == 4
    assert res["summary"]["valid_groups"] == 3
    assert res["summary"]["invalid_groups"] == 1

    # Kiểm tra nhóm gom KH01 + KH02 (cùng MST + cùng CT01) -> SL = 2 + 3 = 5, Tiền = 500,000
    grp_mst_ct1 = next(
        g for g in res["groups"]
        if g["company_code"] == "CT01" and g["buyer_tax_code"] == "0101234567"
    )
    assert grp_mst_ct1["is_valid"] is True
    assert grp_mst_ct1["customer_codes"] == ["KH01", "KH02"]
    assert grp_mst_ct1["order_numbers"] == ["ORD01", "ORD02"]
    assert grp_mst_ct1["items"][0]["quantity"] == 5
    assert grp_mst_ct1["subtotal_before_tax"] == 500000.0

    # Kiểm tra nhóm gom KH04 + KH05 (cùng CCCD + cùng CT01) -> SL = 4 + 1 = 5
    grp_cccd = next(g for g in res["groups"] if g["buyer_citizen_id"] == "040199001122")
    assert grp_cccd["is_valid"] is True
    assert grp_cccd["customer_codes"] == ["KH04", "KH05"]
    assert grp_cccd["items"][0]["quantity"] == 5

    # Kiểm tra nhóm thiếu thông tin bị khóa (KH06 thiếu Công ty QL, MST/CCCD, và SP UNKNOWN_SKU)
    grp_invalid = next(g for g in res["groups"] if not g["is_valid"])
    assert set(grp_invalid["missing_flags"]) == {"COMPANY", "TAX_OR_CCCD", "PRODUCT"}

    # Cố xuất nhóm không hợp lệ -> phải bị chặn ValueError
    with pytest.raises(ValueError, match="chưa đủ thông tin"):
        export_consolidated_groups([grp_invalid], provider="VIETTEL")

    # Xuất các nhóm hợp lệ (gồm 2 Công ty CT01 & CT02) -> tự tách thành file .zip
    valid_groups = [g for g in res["groups"] if g["is_valid"]]
    zip_buf, zip_name, media_type = export_consolidated_groups(
        valid_groups, provider="MISA", split_by_company=True
    )
    assert zip_name.endswith(".zip")
    assert media_type == "application/zip"
    with zipfile.ZipFile(zip_buf) as zf:
        names = zf.namelist()
        assert len(names) == 2
        assert any("CT01" in n for n in names)
        assert any("CT02" in n for n in names)

    # Xuất 1 công ty theo mẫu Viettel S-Invoice (.xls)
    ct1_groups = [g for g in valid_groups if g["company_code"] == "CT01"]
    xls_buf, xls_name, xls_media = export_consolidated_groups(
        ct1_groups, provider="VIETTEL", split_by_company=True
    )
    assert xls_name.endswith(".xls")
    assert xls_media == "application/vnd.ms-excel"
    assert len(xls_buf.getvalue()) > 1000


def test_vinamilk_customer_code_normalized_to_last_3_chars(seeded_db):
    from app.services.vinamilk_customer_code import normalize_vinamilk_customer_code

    assert normalize_vinamilk_customer_code("MG200310CR", "VINAMILK") == "0CR"
    assert normalize_vinamilk_customer_code("MG2003100J", "VINAMILK") == "00J"
    assert normalize_vinamilk_customer_code("00J", "VINAMILK") == "00J"
    assert normalize_vinamilk_customer_code("NVGH-001", "VINAMILK") == "NVGH-001"
    assert normalize_vinamilk_customer_code("MG200310CR", "KIOTVIET") == "MG200310CR"

    db, dist, d = seeded_db
    comp1 = db.query(Company).filter(Company.code == "CT01").first()
    c_0cr = Customer(
        distributor_id=dist.id,
        code="0CR",
        name="Cửa hàng 0CR",
        type="RETAIL",
        tax_code="0909090909",
        company_id=comp1.id,
    )
    db.add(c_0cr)
    db.flush()
    db.add(
        VinamilkOrderSnapshot(
            remote_key="k_vnm_full",
            order_number="ORD_VNM_01",
            customer_code="MG200310CR",
            customer_name="Cửa hàng 0CR",
            product_code="SKU001",
            product_name="Sữa tươi 180ml",
            order_created_date=d,
            delivery_date=d,
            synced_from=d,
            synced_to=d,
            raw_payload={"Nhà cung cấp": "VINAMILK", "Số lượng": 2, "Giá bán": 100000, "Thành tiền": 200000},
        )
    )
    db.commit()

    res = consolidate_dms_orders_for_invoicing(
        db,
        from_date=d,
        to_date=d,
        distributor_id=dist.id,
        default_vat_rate=8.0,
    )
    grp_0cr = next((g for g in res["groups"] if g["buyer_tax_code"] == "0909090909"), None)
    assert grp_0cr is not None
    assert grp_0cr["is_valid"] is True
    assert grp_0cr["customer_codes"] == ["0CR"]
    assert grp_0cr["buyer_name"] == "Cửa hàng 0CR"
