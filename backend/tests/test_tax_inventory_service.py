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
    export_tax_inventory_excel,
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

