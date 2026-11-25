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
)
from app.services.gdt_purchase_invoice_service import parse_gdt_invoice_xml
from app.services.tax_inventory_service import (
    build_opening_balance_template_excel,
    compute_tax_inventory_by_mst,
    create_adjustment_or_replacement_invoice,
    export_daily_tax_inventory_excel,
    export_sku_mapping_explanation_excel,
    export_tax_inventory_excel,
    get_daily_tax_inventory_ledger,
    get_tax_inventory_card_detail,
    import_opening_balances_excel,
    list_unmapped_purchase_items,
    map_unmapped_purchase_item_sku,
    upsert_opening_balance,
)


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _seed_distributor_and_companies(db):
    dist = Distributor(code="NPP01", name="NPP Chinh", tax_code="2900000001")
    db.add(dist)
    db.flush()
    c1 = Company(code="CTY1", name="Cong Ty A", tax_code="2900000001", distributor_id=dist.id)
    c2 = Company(code="CTY2", name="Cong Ty B", tax_code="2900000002", distributor_id=dist.id)
    db.add_all([c1, c2])
    db.flush()
    return dist, c1, c2


def test_replaced_purchase_invoice_excluded_not_negated_and_scoped_by_seller(db_session):
    """HĐ mua vào bị thay thế phải được loại trừ (skip), không nhân -1, và không ảnh hưởng HĐ trùng số của NCC khác."""
    dist, _, _ = _seed_distributor_and_companies(db_session)

    # NCC A: HĐ gốc 0000100 (SL 50) bị thay thế bởi HĐ 0000101 (SL 60)
    p_orig = PurchaseInvoice(
        distributor_id=dist.id,
        invoice_template="1",
        invoice_symbol="1C26TAA",
        invoice_number="0000100",
        invoice_date=datetime(2026, 11, 1),
        seller_tax_code="0300000001",
        seller_name="NCC A",
        buyer_tax_code="2900000001",
        xml_downloaded=True,
        items=[
            PurchaseInvoiceItem(
                line_number=1,
                product_code="SKU01",
                product_name="Sua Tuoi",
                unit_name="THUNG",
                quantity=50,
                unit_price=200000,
                amount_before_tax=10000000,
            )
        ],
    )
    p_repl = PurchaseInvoice(
        distributor_id=dist.id,
        invoice_template="1",
        invoice_symbol="1C26TAA",
        invoice_number="0000101",
        invoice_date=datetime(2026, 11, 2),
        seller_tax_code="0300000001",
        seller_name="NCC A",
        buyer_tax_code="2900000001",
        replaced_invoice_number="0000100",
        xml_downloaded=True,
        items=[
            PurchaseInvoiceItem(
                line_number=1,
                product_code="SKU01",
                product_name="Sua Tuoi",
                unit_name="THUNG",
                quantity=60,
                unit_price=200000,
                amount_before_tax=12000000,
            )
        ],
    )
    # NCC B: Có HĐ trùng số 0000100 (SL 25) -> phải GIỮ NGUYÊN!
    p_other_seller = PurchaseInvoice(
        distributor_id=dist.id,
        invoice_template="1",
        invoice_symbol="1C26TBB",
        invoice_number="0000100",
        invoice_date=datetime(2026, 11, 3),
        seller_tax_code="0300000002",
        seller_name="NCC B",
        buyer_tax_code="2900000001",
        xml_downloaded=True,
        items=[
            PurchaseInvoiceItem(
                line_number=1,
                product_code="SKU01",
                product_name="Sua Tuoi",
                unit_name="THUNG",
                quantity=25,
                unit_price=200000,
                amount_before_tax=5000000,
            )
        ],
    )
    db_session.add_all([p_orig, p_repl, p_other_seller])
    db_session.commit()

    res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id)
    assert len(res["items"]) == 1
    row = res["items"][0]
    # Đúng = 60 (NCC A thay thế) + 25 (NCC B) = 85 (KHÔNG phải 60 - 50 - 25 = -15 như bug cũ)
    assert row["input_qty"] == 85.0
    assert row["balance_qty"] == 85.0


def test_chronological_negative_and_opening_balance_and_kpi_scoping(db_session):
    """Kiểm tra:
    1. Xuất ngày 5/11 trước khi nhập ngày 10/11 -> Tồn cuối kỳ = 0 nhưng vẫn cờ has_chronological_negative=True.
    2. Lọc theo MST -> KPI summary khớp chính xác MST đang lọc.
    3. Thẻ kho chi tiết trả về running_balance chính xác từng ngày.
    """
    dist, _, _ = _seed_distributor_and_companies(db_session)

    # MST 1: Xuất 10 ngày 05/11, Nhập 10 ngày 10/11
    db_session.add(
        IssuedInvoice(
            distributor_id=dist.id,
            seller_tax_code="2900000001",
            provider="VIETTEL",
            invoice_template_code="1/001",
            invoice_series="1C26TAA",
            invoice_number="0000001",
            status="ISSUED",
            buyer_name="KH 1",
            issued_at=datetime(2026, 11, 5),
            items=[
                IssuedInvoiceItem(
                    line_number=1,
                    product_code="SKU01",
                    source_sku="SKU01",
                    product_name="Sua A",
                    unit_name="THUNG",
                    quantity=10,
                    source_quantity=10,
                    unit_price=250000,
                    amount_before_tax=2500000,
                )
            ],
        )
    )
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0000200",
            invoice_date=datetime(2026, 11, 10),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    product_code="SKU01",
                    product_name="Sua A",
                    unit_name="THUNG",
                    quantity=10,
                    unit_price=200000,
                    amount_before_tax=2000000,
                )
            ],
        )
    )
    # MST 2: Tồn an toàn 100
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0000201",
            invoice_date=datetime(2026, 10, 15),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000002",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    product_code="SKU02",
                    product_name="Sua B",
                    unit_name="THUNG",
                    quantity=100,
                    unit_price=150000,
                    amount_before_tax=15000000,
                )
            ],
        )
    )
    db_session.commit()

    # Lọc riêng MST 1
    res_mst1 = compute_tax_inventory_by_mst(
        db_session,
        distributor_id=dist.id,
        company_tax_code="2900000001",
    )
    assert res_mst1["summary"]["total_records"] == 1
    assert res_mst1["summary"]["ok_count"] == 0
    assert res_mst1["summary"]["chrono_negative_count"] == 1
    row1 = res_mst1["items"][0]
    assert row1["balance_qty"] == 0.0
    assert row1["has_chronological_negative"] is True
    assert row1["min_running_balance"] == -10.0

    # Kiểm tra Thẻ kho chi tiết của MST 1 / SKU01
    card = get_tax_inventory_card_detail(
        db_session,
        tax_code="2900000001",
        sku="SKU01",
        distributor_id=dist.id,
    )
    assert len(card["entries"]) == 2
    assert card["entries"][0]["running_balance"] == -10.0
    assert card["entries"][0]["is_negative_point"] is True
    assert card["entries"][1]["running_balance"] == 0.0
    assert card["entries"][1]["is_negative_point"] is False

    # Kiểm tra Tồn đầu kỳ khi lọc từ 01/11/2026 cho MST 2 (nhập tháng 10 -> thành opening_qty = 100)
    res_mst2 = compute_tax_inventory_by_mst(
        db_session,
        distributor_id=dist.id,
        company_tax_code="2900000002",
        from_date=date(2026, 11, 1),
    )
    assert res_mst2["items"][0]["opening_qty"] == 100.0
    assert res_mst2["items"][0]["input_qty"] == 0.0
    assert res_mst2["items"][0]["balance_qty"] == 100.0

    # Kiểm tra xuất Excel không lỗi
    excel_buf = export_tax_inventory_excel(res_mst1)
    assert len(excel_buf.getvalue()) > 1000


def test_cumulative_adjustment_cannot_exceed_original_quantity(db_session):
    """Không cho phép lập nhiều hóa đơn điều chỉnh giảm vượt quá SL hóa đơn gốc."""
    dist, _, _ = _seed_distributor_and_companies(db_session)
    orig = IssuedInvoice(
        distributor_id=dist.id,
        seller_tax_code="2900000001",
        provider="VIETTEL",
        invoice_template_code="1/001",
        invoice_series="1C26TAA",
        invoice_number="0000099",
        status="ISSUED",
        buyer_name="KH Test",
        issued_at=datetime(2026, 11, 10),
        items=[
            IssuedInvoiceItem(
                line_number=1,
                product_code="SKU01",
                source_sku="SKU01",
                product_name="Sua A",
                unit_name="THUNG",
                quantity=10,
                source_quantity=10,
                unit_price=100000,
                amount_before_tax=1000000,
                vat_rate=8.0,
            )
        ],
    )
    db_session.add(orig)
    db_session.commit()
    db_session.refresh(orig)

    # Lần 1: Trả 6 thùng -> hợp lệ
    adj1 = create_adjustment_or_replacement_invoice(
        db_session,
        parent_invoice=orig,
        mode="ADJUSTMENT",
        reason="Tra hang dot 1",
        items_payload=[{"product_code": "SKU01", "quantity": 6}],
    )
    assert adj1.items[0].quantity == -6.0

    # Lần 2: Trả thêm 5 thùng (6 + 5 = 11 > 10 gốc) -> phải báo lỗi
    with pytest.raises(ValueError, match="vượt quá SL còn lại"):
        create_adjustment_or_replacement_invoice(
            db_session,
            parent_invoice=orig,
            mode="ADJUSTMENT",
            reason="Tra hang dot 2 vuot muc",
            items_payload=[{"product_code": "SKU01", "quantity": 5}],
        )


def test_opening_balance_weighted_avg_cost_and_below_cost_warning(db_session):
    """Kiểm tra Mục 1 (Tồn đầu kỳ TK 156) + Mục 3 (Giá vốn BQ TK 632, Trị giá tồn TK 156, Bán dưới giá vốn)."""
    dist, _, _ = _seed_distributor_and_companies(db_session)

    # Khai báo tồn đầu kỳ chốt 01/01/2026: 10 thùng, giá trị 2.000.000đ (200k/thùng)
    upsert_opening_balance(
        db_session,
        distributor_id=dist.id,
        tax_code="2900000001",
        sku="SKU01",
        as_of_date=date(2026, 1, 1),
        opening_qty=10,
        opening_amount=2_000_000,
        product_name="Sua Tuoi",
        unit_name="THUNG",
    )

    # HĐ mua năm 2025 (trước ngày chốt 01/01/2026) -> PHẢI BỊ BỎ QUA không cộng lặp!
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C25TAA",
            invoice_number="0000001",
            invoice_date=datetime(2025, 12, 20),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="SKU01",
                    product_name="Sua Tuoi",
                    unit_name="THUNG",
                    quantity=99,
                    unit_price=180000,
                    amount_before_tax=17_820_000,
                )
            ],
        )
    )

    # HĐ mua tháng 01/2026: 10 thùng, giá trị 2.400.000đ (240k/thùng)
    # -> Tổng khả dụng: 20 thùng, 4.400.000đ => Đơn giá vốn BQ = 220.000đ/thùng
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0000002",
            invoice_date=datetime(2026, 1, 10),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="SKU01",
                    product_name="Sua Tuoi",
                    unit_name="THUNG",
                    quantity=10,
                    unit_price=240000,
                    amount_before_tax=2_400_000,
                )
            ],
        )
    )

    # Xuất bán 5 thùng với giá 200.000đ/thùng (THẤP HƠN giá vốn BQ 220.000đ -> phải bật cờ is_below_cost!)
    db_session.add(
        IssuedInvoice(
            distributor_id=dist.id,
            seller_tax_code="2900000001",
            provider="VIETTEL",
            invoice_template_code="1/001",
            invoice_series="1C26TAA",
            invoice_number="0000010",
            status="ISSUED",
            buyer_name="KH A",
            issued_at=datetime(2026, 1, 15),
            items=[
                IssuedInvoiceItem(
                    line_number=1,
                    product_code="SKU01",
                    source_sku="SKU01",
                    product_name="Sua Tuoi",
                    unit_name="THUNG",
                    quantity=5,
                    source_quantity=5,
                    unit_price=200000,
                    amount_before_tax=1_000_000,
                )
            ],
        )
    )
    db_session.commit()

    res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id)
    assert len(res["items"]) == 1
    row = res["items"][0]
    assert row["opening_qty"] == 10.0
    assert row["opening_amount"] == 2_000_000.0
    assert row["input_qty"] == 10.0
    assert row["output_qty"] == 5.0
    assert row["balance_qty"] == 15.0
    assert row["avg_unit_cost"] == 220_000.0
    assert row["cogs_amount"] == 1_100_000.0  # 5 * 220,000 (TK 632)
    assert row["ending_inventory_value"] == 3_300_000.0  # 15 * 220,000 (TK 156)
    assert row["is_below_cost"] is True
    assert res["summary"]["below_cost_count"] == 1
    assert res["summary"]["total_ending_inventory_value"] == 3_300_000.0

    # Kiểm tra import Excel từ file mẫu
    tpl_bytes = build_opening_balance_template_excel().getvalue()
    imp = import_opening_balances_excel(db_session, file_bytes=tpl_bytes, distributor_id=dist.id)
    assert imp["imported"] == 1
    assert imp["errors"] == []


def test_tchat_xml_filtering_and_unmapped_sku_mapping(db_session):
    """Kiểm tra Mục 4: Parse <TChat> từ XML, loại bỏ dòng chiết khấu/ghi chú (TChat 3, 4) và ánh xạ dòng thiếu SKU."""
    dist, _, _ = _seed_distributor_and_companies(db_session)

    sample_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <HDon>
      <DLHDon>
        <TTChung><SHDon>0000555</SHDon><KHHDon>1C26TAA</KHHDon><NLap>2026-11-12</NLap></TTChung>
        <NDHDon>
          <NBan><MST>0300000001</MST><Ten>NCC Test</Ten></NBan>
          <NMua><MST>2900000001</MST><Ten>Cong Ty A</Ten></NMua>
          <DSHHDVu>
            <HHDVu><STT>1</STT><TChat>1</TChat><MHHDVu>SKU01</MHHDVu><THHDVu>Sua A</THHDVu><DVTinh>THUNG</DVTinh><SLuong>10</SLuong><DGia>200000</DGia><ThTien>2000000</ThTien></HHDVu>
            <HHDVu><STT>2</STT><TChat>3</TChat><MHHDVu>SKU01</MHHDVu><THHDVu>Chiet khau thuong mai</THHDVu><DVTinh>THUNG</DVTinh><SLuong>5</SLuong><DGia>0</DGia><ThTien>-100000</ThTien></HHDVu>
            <HHDVu><STT>3</STT><TChat>4</TChat><MHHDVu></MHHDVu><THHDVu>Ghi chu don hang</THHDVu><SLuong>0</SLuong><ThTien>0</ThTien></HHDVu>
          </DSHHDVu>
        </NDHDon>
      </DLHDon>
    </HDon>"""
    parsed = parse_gdt_invoice_xml(sample_xml)
    assert [it["item_nature"] for it in parsed["items"]] == [1, 3, 4]

    # Lưu vào DB kèm 1 dòng TChat=1 nhưng trống MHHDVu
    p_inv = PurchaseInvoice(
        distributor_id=dist.id,
        invoice_template="1",
        invoice_symbol="1C26TAA",
        invoice_number="0000555",
        invoice_date=datetime(2026, 11, 12),
        seller_tax_code="0300000001",
        seller_name="NCC Test",
        buyer_tax_code="2900000001",
        xml_downloaded=True,
        items=[
            PurchaseInvoiceItem(
                line_number=1,
                item_nature=1,
                product_code="SKU01",
                product_name="Sua A",
                unit_name="THUNG",
                quantity=10,
                unit_price=200000,
                amount_before_tax=2_000_000,
            ),
            PurchaseInvoiceItem(
                line_number=2,
                item_nature=3,  # Chiết khấu TM -> phải bị lọc bỏ khỏi SL nhập!
                product_code="SKU01",
                product_name="Chiet khau thuong mai",
                unit_name="THUNG",
                quantity=5,
                unit_price=0,
                amount_before_tax=-100_000,
            ),
            PurchaseInvoiceItem(
                line_number=3,
                item_nature=1,
                product_code=None,  # Trống MHHDVu -> phải xuất hiện trong unmapped-items
                product_name="Sua Khong Ma",
                unit_name="THUNG",
                quantity=7,
                unit_price=150000,
                amount_before_tax=1_050_000,
            ),
        ],
    )
    db_session.add(p_inv)
    db_session.commit()

    res_before = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id)
    # Chỉ tính 10 thùng của TChat=1, KHÔNG cộng 5 thùng của TChat=3
    assert res_before["items"][0]["input_qty"] == 10.0
    assert res_before["data_quality"]["unmapped_sku_items_count"] == 1

    # Lấy danh sách unmapped và ánh xạ SKU99
    unmapped = list_unmapped_purchase_items(db_session, distributor_id=dist.id)
    assert len(unmapped) == 1
    assert unmapped[0]["product_name"] == "Sua Khong Ma"

    mapped = map_unmapped_purchase_item_sku(
        db_session,
        item_id=unmapped[0]["id"],
        sku="SKU99",
        distributor_id=dist.id,
        apply_same_name=True,
    )
    assert mapped["updated_count"] == 1

    res_after = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id)
    assert res_after["data_quality"]["unmapped_sku_items_count"] == 0
    skus = {r["sku"]: r["input_qty"] for r in res_after["items"]}
    assert skus["SKU99"] == 7.0


def test_adjustment_decrease_purchase_invoice_does_not_exclude_original(db_session):
    """HĐ mua vào điều chỉnh giảm (SL & tiền âm) có replaced_invoice_number trỏ về HĐ gốc KHÔNG ĐƯỢC loại bỏ HĐ gốc."""
    dist, _, _ = _seed_distributor_and_companies(db_session)

    # HĐ gốc: +9204 hộp
    p_orig = PurchaseInvoice(
        distributor_id=dist.id,
        invoice_template="1",
        invoice_symbol="1C26TVM",
        invoice_number="0001000",
        invoice_date=datetime(2026, 11, 1),
        seller_tax_code="0300588569",
        seller_name="Vinamilk",
        buyer_tax_code="2901744664",
        amount_before_tax=462_962_963,
        total_amount=500_000_000,
        xml_downloaded=True,
        items=[
            PurchaseInvoiceItem(
                line_number=1,
                item_nature=1,
                product_code="01SB10",
                product_name="Creamer dac co duong",
                unit_name="Hop",
                quantity=9204,
                unit_price=50300.19,
                amount_before_tax=462_962_963,
            )
        ],
    )
    # HĐ điều chỉnh giảm: -9204 hộp (trỏ về 0001000 nhưng raw_metadata không có tthai=3)
    p_adj = PurchaseInvoice(
        distributor_id=dist.id,
        invoice_template="1",
        invoice_symbol="1C26TVM",
        invoice_number="0001001",
        invoice_date=datetime(2026, 11, 2),
        seller_tax_code="0300588569",
        seller_name="Vinamilk",
        buyer_tax_code="2901744664",
        replaced_invoice_number="0001000",
        amount_before_tax=-462_962_963,
        total_amount=-500_000_000,
        xml_downloaded=True,
        items=[
            PurchaseInvoiceItem(
                line_number=1,
                item_nature=1,
                product_code="01SB10",
                product_name="Creamer dac co duong",
                unit_name="Hop",
                quantity=-9204,
                unit_price=50300.19,
                amount_before_tax=-462_962_963,
            )
        ],
    )
    db_session.add_all([p_orig, p_adj])
    db_session.commit()

    res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id)
    assert len(res["items"]) == 1
    # (+9204) + (-9204) = 0, KHÔNG bị thành -9204!
    assert res["items"][0]["input_qty"] == 0.0
    assert res["items"][0]["balance_qty"] == 0.0


def test_group_by_npp_sku_consolidates_across_msts_and_returns_mst_breakdown(db_session):
    """Gom toàn bộ tồn kho thuế theo Mã sản phẩm nội bộ NPP (không tách dòng theo từng MST), kèm mst_breakdown khi click."""
    from app.models.product import Product, ProductCategory, ProductUnit

    dist, _, _ = _seed_distributor_and_companies(db_session)
    cat = ProductCategory(code="SUA", name="Sua")
    unit = ProductUnit(code="THUNG", name="Thùng")
    db_session.add_all([cat, unit])
    db_session.flush()

    # Hai mã CQT khác nhau cùng map về 1 Mã nội bộ NPP = "NPP-SUA-01"
    p1 = Product(sku="CQT_A", name="Sua CQT A", category_id=cat.id, unit_id=unit.id, internal_name="Sua Noi Bo 01")
    p1.npp_code = "NPP-SUA-01"
    p2 = Product(sku="CQT_B", name="Sua CQT B", category_id=cat.id, unit_id=unit.id, internal_name="Sua Noi Bo 01")
    p2.npp_code = "NPP-SUA-01"
    db_session.add_all([p1, p2])
    db_session.flush()

    # MST 1 nhập CQT_A: 40 thùng
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0002001",
            invoice_date=datetime(2026, 11, 1),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT_A",
                    product_name="Sua CQT A",
                    unit_name="Thùng",
                    quantity=40,
                    unit_price=200000,
                    amount_before_tax=8_000_000,
                )
            ],
        )
    )
    # MST 2 nhập CQT_B: 60 thùng, xuất 70 thùng (MST 2 bị âm -10, nhưng tổng NPP = +30!)
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TBB",
            invoice_number="0002002",
            invoice_date=datetime(2026, 11, 2),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000002",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT_B",
                    product_name="Sua CQT B",
                    unit_name="Thùng",
                    quantity=60,
                    unit_price=200000,
                    amount_before_tax=12_000_000,
                )
            ],
        )
    )
    db_session.add(
        IssuedInvoice(
            distributor_id=dist.id,
            seller_tax_code="2900000002",
            provider="VIETTEL",
            invoice_template_code="1/001",
            invoice_series="1C26TBB",
            invoice_number="0000050",
            status="ISSUED",
            buyer_name="KH B",
            issued_at=datetime(2026, 11, 3),
            items=[
                IssuedInvoiceItem(
                    line_number=1,
                    product_code="CQT_B",
                    source_sku="CQT_B",
                    product_name="Sua CQT B",
                    unit_name="Thùng",
                    quantity=70,
                    source_quantity=70,
                    unit_price=250000,
                    amount_before_tax=17_500_000,
                )
            ],
        )
    )
    db_session.commit()

    res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="NPP_SKU")
    assert res["group_by"] == "NPP_SKU"
    assert len(res["items"]) == 1
    row = res["items"][0]
    assert row["npp_code"] == "NPP-SUA-01"
    assert row["product_name"] == "Sua Noi Bo 01"
    assert row["mst_count"] == 2
    assert row["cqt_skus"] == ["CQT_A", "CQT_B"]
    assert row["input_qty"] == 100.0
    assert row["output_qty"] == 70.0
    assert row["balance_qty"] == 30.0
    assert row["negative_mst_count"] == 1
    assert len(row["mst_breakdown"]) == 2
    # Kiểm tra xuất Excel ở chế độ NPP_SKU không lỗi
    excel_buf = export_tax_inventory_excel(res)
    assert len(excel_buf.getvalue()) > 1000


def test_conversion_factor_uom_rollup_vat_mismatch_and_explanation_excel(db_session):
    """Kiểm tra quy đổi ĐVT bằng ProductGroupItem.conversion_factor khi gom NPP_SKU, cảnh báo lệch VAT, và xuất Excel giải trình."""
    from app.models.product import Product, ProductCategory, ProductGroup, ProductGroupItem, ProductUnit

    dist, _, _ = _seed_distributor_and_companies(db_session)
    cat = ProductCategory(code="SUA2", name="Sua 2")
    u_hop = ProductUnit(code="HOP", name="Hộp")
    u_thung = ProductUnit(code="THUNG2", name="Thùng")
    db_session.add_all([cat, u_hop, u_thung])
    db_session.flush()

    p_hop = Product(sku="OT_HOP", name="Sua Ong Tho 380g Hop", category_id=cat.id, unit_id=u_hop.id, vat_rate=8.0)
    p_hop.npp_code = "NPP-OT380"
    p_thung = Product(sku="OT_THUNG", name="Sua Ong Tho 380g Thung 48", category_id=cat.id, unit_id=u_thung.id, vat_rate=10.0)
    p_thung.npp_code = "NPP-OT380"
    db_session.add_all([p_hop, p_thung])
    db_session.flush()

    grp = ProductGroup(name="Sua Ong Tho 380g", representative_product_id=p_hop.id)
    db_session.add(grp)
    db_session.flush()
    db_session.add_all([
        ProductGroupItem(product_group_id=grp.id, product_id=p_hop.id, conversion_factor=1),
        ProductGroupItem(product_group_id=grp.id, product_id=p_thung.id, conversion_factor=48),
    ])

    # Nhập 2 Thùng (OT_THUNG, factor=48 -> 96 Hộp) + Nhập 4 Hộp (OT_HOP, factor=1 -> 4 Hộp) => Tổng = 100 Hộp!
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0003001",
            invoice_date=datetime(2026, 11, 5),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="OT_THUNG",
                    product_name="Sua Ong Tho 380g Thung 48",
                    unit_name="Thùng",
                    quantity=2,
                    unit_price=960000,
                    amount_before_tax=1_920_000,
                ),
                PurchaseInvoiceItem(
                    line_number=2,
                    item_nature=1,
                    product_code="OT_HOP",
                    product_name="Sua Ong Tho 380g Hop",
                    unit_name="Hộp",
                    quantity=4,
                    unit_price=20000,
                    amount_before_tax=80_000,
                ),
            ],
        )
    )
    db_session.commit()

    res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="NPP_SKU")
    assert len(res["items"]) == 1
    row = res["items"][0]
    assert row["npp_code"] == "NPP-OT380"
    assert row["input_qty"] == 100.0  # 2*48 + 4*1 = 100 Hộp
    assert row["avg_unit_cost"] == 20_000.0  # 2,000,000 / 100 Hộp
    assert row["has_vat_mismatch"] is True  # 8% vs 10%

    exp_buf = export_sku_mapping_explanation_excel(db_session, distributor_id=dist.id)
    assert len(exp_buf.getvalue()) > 2000


def test_daily_tax_inventory_ledger_tracks_day_by_day_opening_in_out_closing(db_session):
    """Kiểm tra Nhật ký N-X-T từng ngày: tồn đầu ngày, nhập, xuất, tồn cuối ngày & phát hiện ngày âm."""
    dist, _, _ = _seed_distributor_and_companies(db_session)

    # Đầu kỳ chốt 01/11/2026: 10 thùng
    upsert_opening_balance(
        db_session,
        distributor_id=dist.id,
        tax_code="2900000001",
        sku="SKU_DAY",
        as_of_date=date(2026, 11, 1),
        opening_qty=10,
        opening_amount=1_000_000,
    )
    # Ngày 02/11: Xuất 15 thùng -> Tồn cuối ngày 02/11 = -5 (ÂM!)
    db_session.add(
        IssuedInvoice(
            distributor_id=dist.id,
            seller_tax_code="2900000001",
            provider="VIETTEL",
            invoice_template_code="1/001",
            invoice_series="1C26TAA",
            invoice_number="0000901",
            status="ISSUED",
            buyer_name="KH 1",
            issued_at=datetime(2026, 11, 2),
            items=[
                IssuedInvoiceItem(
                    line_number=1,
                    product_code="SKU_DAY",
                    source_sku="SKU_DAY",
                    product_name="Hang Test Ngay",
                    unit_name="Thùng",
                    quantity=15,
                    source_quantity=15,
                    unit_price=120000,
                    amount_before_tax=1_800_000,
                )
            ],
        )
    )
    # Ngày 04/11: Nhập 20 thùng -> Tồn cuối ngày 04/11 = +15
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0004001",
            invoice_date=datetime(2026, 11, 4),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="SKU_DAY",
                    product_name="Hang Test Ngay",
                    unit_name="Thùng",
                    quantity=20,
                    unit_price=100000,
                    amount_before_tax=2_000_000,
                )
            ],
        )
    )
    db_session.commit()

    daily = get_daily_tax_inventory_ledger(
        db_session,
        sku="SKU_DAY",
        from_date=date(2026, 11, 1),
        to_date=date(2026, 11, 5),
        distributor_id=dist.id,
        only_active_days=False,
    )
    assert len(daily["days"]) == 5
    # Ngày 01: đầu 10, cuối 10
    assert daily["days"][0]["opening_qty"] == 10.0 and daily["days"][0]["closing_qty"] == 10.0
    # Ngày 02: đầu 10, xuất 15, cuối -5 (Âm!)
    assert daily["days"][1]["opening_qty"] == 10.0 and daily["days"][1]["output_qty"] == 15.0
    assert daily["days"][1]["closing_qty"] == -5.0 and daily["days"][1]["is_negative"] is True
    # Ngày 03: không phát sinh, vẫn âm -5
    assert daily["days"][2]["closing_qty"] == -5.0 and daily["days"][2]["is_negative"] is True
    # Ngày 04: đầu -5, nhập 20, cuối 15
    assert daily["days"][3]["opening_qty"] == -5.0 and daily["days"][3]["input_qty"] == 20.0
    assert daily["days"][3]["closing_qty"] == 15.0 and daily["days"][3]["is_negative"] is False
    # Tổng 2 ngày âm (ngày 02 và ngày 03)
    assert daily["summary"]["negative_days_count"] == 2
    assert daily["summary"]["period_closing_qty"] == 15.0

    # Kiểm tra xuất Excel nhật ký từng ngày
    buf = export_daily_tax_inventory_excel(daily)
    assert len(buf.getvalue()) > 1500


def test_tax_inventory_displays_invoice_product_name_across_all_views(db_session):
    """Cột Tên hàng hóa trong tồn kho thuế (NPP_SKU, MST_SKU, mst_breakdown, daily) luôn ưu tiên Tên sản phẩm xuất hóa đơn."""
    from app.models.product import DistributorProduct, Product, ProductCategory, ProductUnit

    dist, _, _ = _seed_distributor_and_companies(db_session)
    cat = ProductCategory(code="SUA2", name="Sua")
    unit = ProductUnit(code="HOP2", name="Hộp")
    db_session.add_all([cat, unit])
    db_session.flush()

    p = Product(sku="CQT_INV_01", name="Ten Goc CQT", category_id=cat.id, unit_id=unit.id, internal_name="Ten Noi Bo")
    p.npp_code = "05AN26"
    dp = DistributorProduct(
        distributor_sku="05AN26",
        distributor_product_name="Ten Noi Bo NPP",
        invoice_product_name="Sữa tươi tiệt trùng Vinamilk 100% Có Đường - Thùng 48 hộp 180ml (Xuất HĐ)",
        unit="Thùng",
    )
    db_session.add_all([p, dp])
    db_session.flush()

    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0009001",
            invoice_date=datetime(2026, 11, 5),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT_INV_01",
                    product_name="Ten Tren XML Hoa Don",
                    unit_name="Thùng",
                    quantity=10,
                    unit_price=300000,
                    amount_before_tax=3_000_000,
                )
            ],
        )
    )
    db_session.commit()

    expected_name = "Sữa tươi tiệt trùng Vinamilk 100% Có Đường - Thùng 48 hộp 180ml (Xuất HĐ)"

    npp_res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="NPP_SKU")
    assert len(npp_res["items"]) == 1
    assert npp_res["items"][0]["product_name"] == expected_name
    assert npp_res["items"][0]["mst_breakdown"][0]["product_name"] == expected_name

    mst_res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="MST_SKU")
    assert len(mst_res["items"]) == 1
    assert mst_res["items"][0]["product_name"] == expected_name

    daily_res = get_daily_tax_inventory_ledger(
        db_session,
        sku="05AN26",
        from_date=date(2026, 11, 1),
        to_date=date(2026, 11, 10),
        distributor_id=dist.id,
    )
    assert daily_res["product_name"] == expected_name


def test_mst_cutoff_date_excludes_old_invoices_even_for_zero_opening_skus(db_session):
    """Khi MST chốt tồn đầu kỳ ngày mới (VD 23/11), mọi hóa đơn trước 23/11 kể cả của SKU tồn=0 (không upload) đều bị cắt bỏ."""
    from app.models.multi_tenant_invoice import TaxInventoryOpeningBalance

    dist, _, _ = _seed_distributor_and_companies(db_session)

    # Chỉ upload tồn đầu kỳ ngày 2026-11-23 cho SKU_STOCK (SKU_ZERO tồn = 0 nên không upload)
    db_session.add(
        TaxInventoryOpeningBalance(
            distributor_id=dist.id,
            tax_code="2900000001",
            sku="SKU_STOCK",
            product_name="Hang co ton",
            unit_name="Thùng",
            as_of_date=date(2026, 11, 23),
            opening_qty=20,
            opening_amount=4_000_000,
        )
    )
    # Hóa đơn cũ ngày 2026-11-10 (trước mốc 2026-11-23) cho SKU_ZERO -> phải bị cắt bỏ hoàn toàn!
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0009100",
            invoice_date=datetime(2026, 11, 10),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="SKU_ZERO",
                    product_name="Hang ton 0",
                    unit_name="Thùng",
                    quantity=99,
                    unit_price=100000,
                    amount_before_tax=9_900_000,
                )
            ],
        )
    )
    # Hóa đơn mới ngày 2026-11-23 cho SKU_ZERO -> được tính bình thường
    db_session.add(
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0009101",
            invoice_date=datetime(2026, 11, 23),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code="2900000001",
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="SKU_ZERO",
                    product_name="Hang ton 0",
                    unit_name="Thùng",
                    quantity=5,
                    unit_price=100000,
                    amount_before_tax=500_000,
                )
            ],
        )
    )
    db_session.commit()

    res = compute_tax_inventory_by_mst(
        db_session,
        distributor_id=dist.id,
        from_date=date(2026, 11, 23),
        to_date=date(2026, 11, 30),
        group_by="MST_SKU",
    )
    by_sku = {item["sku"]: item for item in res["items"]}
    assert by_sku["SKU_STOCK"]["opening_qty"] == 20.0
    assert by_sku["SKU_ZERO"]["opening_qty"] == 0.0
    assert by_sku["SKU_ZERO"]["input_qty"] == 5.0
    assert by_sku["SKU_ZERO"]["balance_qty"] == 5.0

    daily = get_daily_tax_inventory_ledger(
        db_session,
        sku="SKU_ZERO",
        from_date=date(2026, 11, 23),
        to_date=date(2026, 11, 24),
        tax_code="2900000001",
        distributor_id=dist.id,
    )
    assert daily["summary"]["period_opening_qty"] == 0.0
    assert daily["summary"]["total_input_qty"] == 5.0
    assert daily["summary"]["period_closing_qty"] == 5.0


def test_multiple_companies_per_distributor_sku_with_distinct_invoice_codes_and_names(db_session):
    """Cùng 1 Mã SP NPP có thể đăng ký cho 2 Công ty QL khác nhau với Mã SP xuất HĐ và Tên SP xuất HĐ riêng."""
    from app.models.product import DistributorProduct, Product, ProductCategory, ProductUnit

    dist, comp_a, comp_b = _seed_distributor_and_companies(db_session)
    cat = ProductCategory(code="SUA3", name="Sua")
    unit = ProductUnit(code="HOP3", name="Hộp")
    db_session.add_all([cat, unit])
    db_session.flush()

    p = Product(sku="01SB10", name="Ten Goc", category_id=cat.id, unit_id=unit.id)
    p.npp_code = "01SB10"
    dp_a = DistributorProduct(
        distributor_sku="01SB10",
        distributor_product_name="Creamer NSPN 1284g",
        invoice_product_code="INV-A-01",
        invoice_product_name="Sữa đặc NSPN 1284g (Công ty A)",
        company_id=comp_a.id,
        unit="HOP",
    )
    dp_b = DistributorProduct(
        distributor_sku="01SB10",
        distributor_product_name="Creamer NSPN 1284g",
        invoice_product_code="INV-B-01",
        invoice_product_name="Creamer đặc NSPN 1284g (Công ty B)",
        company_id=comp_b.id,
        unit="HOP",
    )
    db_session.add_all([p, dp_a, dp_b])
    db_session.flush()

    db_session.add_all([
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0009201",
            invoice_date=datetime(2026, 11, 10),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code=comp_a.tax_code,
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="01SB10",
                    product_name="Ten XML A",
                    unit_name="Hộp",
                    quantity=10,
                    unit_price=50000,
                    amount_before_tax=500_000,
                )
            ],
        ),
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TBB",
            invoice_number="0009202",
            invoice_date=datetime(2026, 11, 11),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code=comp_b.tax_code,
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="01SB10",
                    product_name="Ten XML B",
                    unit_name="Hộp",
                    quantity=25,
                    unit_price=50000,
                    amount_before_tax=1_250_000,
                )
            ],
        ),
    ])
    db_session.commit()

    # 1. Chế độ gộp NPP_SKU -> 1 dòng chung, mst_breakdown tách đúng Mã/Tên xuất HĐ từng MST
    npp_res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="NPP_SKU")
    assert len(npp_res["items"]) == 1
    row = npp_res["items"][0]
    assert row["npp_code"] == "01SB10"
    assert row["invoice_product_codes"] == ["INV-A-01", "INV-B-01"]
    assert row["balance_qty"] == 35.0
    by_mst = {b["tax_code"]: b for b in row["mst_breakdown"]}
    assert by_mst[comp_a.tax_code]["invoice_product_code"] == "INV-A-01"
    assert by_mst[comp_a.tax_code]["product_name"] == "Sữa đặc NSPN 1284g (Công ty A)"
    assert by_mst[comp_b.tax_code]["invoice_product_code"] == "INV-B-01"
    assert by_mst[comp_b.tax_code]["product_name"] == "Creamer đặc NSPN 1284g (Công ty B)"

    # 2. Chế độ MST_SKU -> 2 dòng riêng biệt theo từng MST với đúng Mã/Tên xuất HĐ
    mst_res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="MST_SKU")
    assert len(mst_res["items"]) == 2
    mst_rows = {item["tax_code"]: item for item in mst_res["items"]}
    assert mst_rows[comp_a.tax_code]["invoice_product_code"] == "INV-A-01"
    assert mst_rows[comp_a.tax_code]["product_name"] == "Sữa đặc NSPN 1284g (Công ty A)"
    assert mst_rows[comp_b.tax_code]["invoice_product_code"] == "INV-B-01"
    assert mst_rows[comp_b.tax_code]["product_name"] == "Creamer đặc NSPN 1284g (Công ty B)"


def test_tax_inventory_displays_invoice_product_mst_company_and_excel_drops_cogs(db_session):
    """Tồn kho thuế (NPP_SKU & MST_SKU) hiển thị Mã SP XHĐ, Tên SP XHĐ, MST, Tên công ty quản lý; Excel bỏ cột giá vốn."""
    from openpyxl import load_workbook
    from app.models.product import InvoiceProduct, Product, ProductCategory, ProductUnit

    dist, comp_a, comp_b = _seed_distributor_and_companies(db_session)
    cat = ProductCategory(code="SUA4", name="Sua")
    unit = ProductUnit(code="HOP4", name="Hộp")
    db_session.add_all([cat, unit])
    db_session.flush()

    ip = InvoiceProduct(
        distributor_id=dist.id,
        code="XHD-ST180",
        name="Sữa tươi tiệt trùng 180ml (SP XHĐ)",
        unit_name="Hộp",
        vat_rate=8.0,
        default_company_id=comp_a.id,
    )
    db_session.add(ip)
    db_session.flush()

    p = Product(
        sku="CQT-0180",
        name="Ten Goc CQT",
        category_id=cat.id,
        unit_id=unit.id,
        invoice_product_id=ip.id,
    )
    db_session.add(p)
    db_session.flush()

    db_session.add_all([
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0009301",
            invoice_date=datetime(2026, 11, 10),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code=comp_a.tax_code,
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT-0180",
                    product_name="Ten XML CQT",
                    unit_name="Hộp",
                    quantity=48,
                    unit_price=8000,
                    amount_before_tax=384_000,
                )
            ],
        ),
        PurchaseInvoice(
            distributor_id=dist.id,
            invoice_template="1",
            invoice_symbol="1C26TBB",
            invoice_number="0009302",
            invoice_date=datetime(2026, 11, 11),
            seller_tax_code="0300000001",
            seller_name="NCC A",
            buyer_tax_code=comp_b.tax_code,
            xml_downloaded=True,
            items=[
                PurchaseInvoiceItem(
                    line_number=1,
                    item_nature=1,
                    product_code="CQT-0180",
                    product_name="Ten XML CQT",
                    unit_name="Hộp",
                    quantity=24,
                    unit_price=8000,
                    amount_before_tax=192_000,
                )
            ],
        ),
    ])
    db_session.commit()

    # 1. Chế độ NPP_SKU (gộp theo SP XHĐ)
    npp_res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="NPP_SKU")
    assert len(npp_res["items"]) == 1
    row = npp_res["items"][0]
    assert row["invoice_product_code"] == "XHD-ST180"
    assert row["invoice_product_name"] == "Sữa tươi tiệt trùng 180ml (SP XHĐ)"
    assert row["product_name"] == "Sữa tươi tiệt trùng 180ml (SP XHĐ)"
    assert comp_a.tax_code in row["tax_code"] and comp_b.tax_code in row["tax_code"]
    assert comp_a.name in row["company_name"] and comp_b.name in row["company_name"]
    assert row["mst_list"][0]["tax_code"] == comp_a.tax_code  # default_company prioritized

    # 2. Chế độ MST_SKU (tách theo MST)
    mst_res = compute_tax_inventory_by_mst(db_session, distributor_id=dist.id, group_by="MST_SKU")
    assert len(mst_res["items"]) == 2
    by_mst = {r["tax_code"]: r for r in mst_res["items"]}
    assert by_mst[comp_a.tax_code]["invoice_product_code"] == "XHD-ST180"
    assert by_mst[comp_a.tax_code]["invoice_product_name"] == "Sữa tươi tiệt trùng 180ml (SP XHĐ)"
    assert by_mst[comp_a.tax_code]["company_name"] == comp_a.name

    # 3. Xuất Excel: có Mã SP XHĐ, Tên SP XHĐ, MST, Tên công ty quản lý và KHÔNG có cột Giá vốn
    buf = export_tax_inventory_excel(npp_res)
    wb = load_workbook(buf)
    ws = wb.active
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    assert "Mã SP XHĐ" in headers
    assert "Tên SP XHĐ" in headers
    assert "MST" in headers
    assert "Tên công ty quản lý" in headers
    assert not any("Giá vốn" in str(h or "") or "giá vốn" in str(h or "") for h in headers)





