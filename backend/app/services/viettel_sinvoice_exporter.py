from io import BytesIO
from pathlib import Path
from typing import List, Dict, Any, Optional
from collections import defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import select, func

import xlrd
from xlutils.copy import copy

from app.models.vinamilk import VinamilkOrderSnapshot
from app.models.product import Product


TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "viettel_sinvoice_template.xls"


def export_orders_to_viettel_sinvoice(
    db: Session,
    order_numbers: List[str],
    mode: str = "AGGREGATED",  # "AGGREGATED" (Gom đơn bán lẻ) hoặc "SEPARATE" (Xuất riêng từng đơn)
    default_tax: int = 8,
    custom_note: str = "",
) -> BytesIO:
    """Xuất file Excel theo đúng định dạng mẫu của Viettel S-Invoice (C26TTD)."""
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Không tìm thấy file mẫu Viettel S-Invoice tại {TEMPLATE_PATH}")

    # 1. Truy vấn các dòng đơn hàng
    clean_order_numbers = [str(num).strip() for num in order_numbers if str(num).strip()]
    if not clean_order_numbers:
        raise ValueError("Danh sách số đơn hàng không được để trống.")

    snapshots = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(VinamilkOrderSnapshot.order_number.in_(clean_order_numbers))
        .order_by(VinamilkOrderSnapshot.order_number.asc(), VinamilkOrderSnapshot.id.asc())
    ).all()

    if not snapshots:
        raise ValueError("Không tìm thấy dữ liệu cho các số đơn hàng đã chọn.")

    # 2. Xây dựng bảng tra cứu sản phẩm SKU CQT theo npp_code hoặc sku
    prod_map: Dict[str, Product] = {}
    all_products = db.scalars(select(Product)).all()
    for p in all_products:
        if p.sku:
            prod_map[p.sku.strip().upper()] = p
        if p._npp_code:
            prod_map[p._npp_code.strip().upper()] = p

    # 3. Mở template Viettel S-Invoice
    rb = xlrd.open_workbook(str(TEMPLATE_PATH), formatting_info=True)
    wb = copy(rb)
    ws = wb.get_sheet(0)

    # Xóa sạch dòng dữ liệu mẫu (dòng 11 - index 10) của file template Viettel
    for c in range(45):
        ws.write(10, c, "")

    start_row = 10  # Dòng 11 trong Excel (0-indexed: 10)
    current_row = start_row

    if mode == "AGGREGATED":
        # =========================================================================
        # CHẾ ĐỘ GOM ĐƠN TỰ ĐỘNG CHO KHÁCH LẺ (N ĐƠN -> 1 HÓA ĐƠN TỔNG)
        # =========================================================================
        aggregated_items: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            "item_code": "",
            "item_name": "",
            "item_unit": "",
            "quantity": 0.0,
            "amount_before_tax": 0.0,
            "unit_price": 0.0,
            "tax_percentage": default_tax,
        })

        all_order_nums = set()
        for snap in snapshots:
            all_order_nums.add(snap.order_number)
            raw = snap.raw_payload or {}
            raw_code = (snap.product_code or "").strip().upper()
            prod = prod_map.get(raw_code)

            cqt_sku = prod.sku if prod else raw_code
            cqt_name = prod.name if prod else (snap.product_name or "Hàng hóa")
            cqt_unit = (prod.unit.name if (prod and prod.unit) else None) or raw.get("ĐVT") or "THUNG"

            # Số lượng và đơn giá
            qty = float(raw.get("Số lượng") or raw.get("quantity") or 1.0)
            amount = float(raw.get("Thành tiền") or raw.get("amount") or 0.0)
            if amount <= 0:
                price = float(raw.get("Giá bán") or raw.get("price") or 0.0)
                amount = round(qty * price, 2)

            agg = aggregated_items[cqt_sku]
            agg["item_code"] = cqt_sku
            agg["item_name"] = cqt_name
            agg["item_unit"] = cqt_unit
            agg["quantity"] += qty
            agg["amount_before_tax"] += amount

        note_text = custom_note.strip() or f"Bán lẻ hàng hóa gom theo bảng kê các đơn hàng DMS: {', '.join(sorted(all_order_nums))}"

        for idx, (sku, item_data) in enumerate(aggregated_items.items(), start=1):
            qty = item_data["quantity"]
            amount = item_data["amount_before_tax"]
            unit_price = round(amount / qty, 2) if qty > 0 else 0.0
            tax_pct = item_data["tax_percentage"]
            tax_amt = round(amount * tax_pct / 100.0, 2)

            # Cột B (1): group
            ws.write(current_row, 1, "1")
            # Cột D (3): buyerCode
            ws.write(current_row, 3, "KHACH_LE")
            # Cột E (4): buyerName
            ws.write(current_row, 4, "Người mua không lấy hóa đơn")
            # Cột F (5): buyerAddress
            ws.write(current_row, 5, "Khối 3, Thị trấn Đô Lương, Nghệ An")
            # Cột Z (25): payMethod
            ws.write(current_row, 25, "TM/CK")
            # Cột AA (26): payStatus
            ws.write(current_row, 26, "1")
            # Cột AB (27): currencyCode
            ws.write(current_row, 27, "VND")
            # Cột AC (28): exchangeRate
            ws.write(current_row, 28, 1)
            # Cột AF (31): selection
            ws.write(current_row, 31, "1")
            # Cột AH (33): itemCode
            ws.write(current_row, 33, sku)
            # Cột AI (34): itemName
            ws.write(current_row, 34, item_data["item_name"])
            # Cột AM (38): itemUnit
            ws.write(current_row, 38, item_data["item_unit"])
            # Cột AN (39): itemQuantity
            ws.write(current_row, 39, qty)
            # Cột AO (40): itemPrice
            ws.write(current_row, 40, unit_price)
            # Cột AP (41): amountBeforeTax
            ws.write(current_row, 41, amount)
            # Cột AQ (42): taxPercentage
            ws.write(current_row, 42, str(tax_pct))
            # Cột AR (43): taxAmount
            ws.write(current_row, 43, tax_amt)
            # Cột AS (44): invoiceNote
            ws.write(current_row, 44, note_text)

            current_row += 1

    else:
        # =========================================================================
        # CHẾ ĐỘ XUẤT RIÊNG TỪNG ĐƠN (MỖI ĐƠN LÀ 1 GROUP HÓA ĐƠN RIÊNG)
        # =========================================================================
        orders_dict: Dict[str, List[VinamilkOrderSnapshot]] = defaultdict(list)
        for snap in snapshots:
            orders_dict[snap.order_number].append(snap)

        group_num = 1
        for order_num, order_snaps in orders_dict.items():
            first_snap = order_snaps[0]
            raw_first = first_snap.raw_payload or {}

            buyer_code = (first_snap.customer_code or "").strip() or "KH_LE"
            buyer_name = (first_snap.customer_name or "").strip() or "Khách hàng"
            buyer_tax = (raw_first.get("Mã số thuế") or "").strip()
            buyer_addr = (raw_first.get("Địa chỉ") or "").strip() or "Hà Tĩnh / Nghệ An"
            buyer_phone = (raw_first.get("Số điện thoại") or "").strip()

            order_note = custom_note.strip() or f"Đơn hàng DMS số {order_num}"

            for snap in order_snaps:
                raw = snap.raw_payload or {}
                raw_code = (snap.product_code or "").strip().upper()
                prod = prod_map.get(raw_code)

                cqt_sku = prod.sku if prod else raw_code
                cqt_name = prod.name if prod else (snap.product_name or "Hàng hóa")
                cqt_unit = (prod.unit.name if (prod and prod.unit) else None) or raw.get("ĐVT") or "THUNG"

                qty = float(raw.get("Số lượng") or raw.get("quantity") or 1.0)
                amount = float(raw.get("Thành tiền") or raw.get("amount") or 0.0)
                if amount <= 0:
                    price = float(raw.get("Giá bán") or raw.get("price") or 0.0)
                    amount = round(qty * price, 2)
                unit_price = round(amount / qty, 2) if qty > 0 else 0.0
                tax_pct = default_tax
                tax_amt = round(amount * tax_pct / 100.0, 2)

                # Ghi dòng
                ws.write(current_row, 1, str(group_num))
                ws.write(current_row, 3, buyer_code)
                ws.write(current_row, 4, buyer_name)
                ws.write(current_row, 5, buyer_addr)
                if buyer_phone:
                    ws.write(current_row, 6, buyer_phone)
                if buyer_tax:
                    ws.write(current_row, 8, buyer_tax)
                    ws.write(current_row, 12, buyer_name)  # buyerLegalName

                ws.write(current_row, 25, "TM/CK")
                ws.write(current_row, 26, "1")
                ws.write(current_row, 27, "VND")
                ws.write(current_row, 28, 1)
                ws.write(current_row, 31, "1")
                ws.write(current_row, 33, cqt_sku)
                ws.write(current_row, 34, cqt_name)
                ws.write(current_row, 38, cqt_unit)
                ws.write(current_row, 39, qty)
                ws.write(current_row, 40, unit_price)
                ws.write(current_row, 41, amount)
                ws.write(current_row, 42, str(tax_pct))
                ws.write(current_row, 43, tax_amt)
                ws.write(current_row, 44, order_note)

                current_row += 1

            group_num += 1

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out
