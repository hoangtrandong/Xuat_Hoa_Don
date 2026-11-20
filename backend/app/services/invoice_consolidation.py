from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any
import zipfile

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
import xlrd
from xlutils.copy import copy as xl_copy

from app.models.customer import Company, Customer
from app.models.multi_tenant_invoice import Distributor, IssuedInvoice
from app.models.product import Product
from app.models.vinamilk import VinamilkOrderSnapshot

VIETTEL_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[1] / "templates" / "viettel_sinvoice_template.xls"
)

SUPPORTED_PROVIDERS = {
    "VIETTEL": {
        "code": "VIETTEL",
        "name": "Viettel S-Invoice (Mẫu C26TTD .xls)",
        "ext": "xls",
        "media_type": "application/vnd.ms-excel",
    },
    "MISA": {
        "code": "MISA",
        "name": "MISA meInvoice (Mẫu nhập khẩu .xlsx)",
        "ext": "xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "VNPT": {
        "code": "VNPT",
        "name": "VNPT Invoice (Mẫu nhập khẩu .xlsx)",
        "ext": "xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "EASYINVOICE": {
        "code": "EASYINVOICE",
        "name": "EasyInvoice (Mẫu nhập khẩu .xlsx)",
        "ext": "xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
}


def _to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _clean_identifier(value: str | None) -> str:
    if not value:
        return ""
    return "".join(ch for ch in str(value).strip() if ch.isalnum() or ch == "-").upper()


def consolidate_dms_orders_for_invoicing(
    db: Session,
    *,
    from_date: date,
    to_date: date,
    date_field: str = "order_created_date",
    distributor_id: int | None = None,
    company_id: int | None = None,
    supplier_code: str | None = None,
    default_vat_rate: float = 8.0,
    exclude_invoiced: bool = True,
) -> dict[str, Any]:
    """Tổng hợp & gom đơn hàng DMS theo ngày thành các nhóm hóa đơn dự kiến.

    Quy tắc gom:
    - Cùng Công ty quản lý (`company_id`) VÀ chung MST (ưu tiên 1) hoặc chung CCCD (ưu tiên 2)
      -> gom thành 1 hóa đơn hợp nhất, cộng gộp dòng hàng theo mã SKU CQT.
    - Kiểm tra điều kiện bắt buộc (Pre-flight Validation):
      + Khách hàng phải đã đăng ký trong danh mục `customers`
      + Khách hàng phải có MST hoặc CCCD
      + Khách hàng phải đã gán Công ty quản lý (`company_id`)
      + Sản phẩm trên đơn phải đã đăng ký trong danh mục `products`
      Nếu thiếu bất kỳ thông tin nào -> đánh dấu `is_valid = False` kèm danh sách cảnh báo cụ thể
      và không cho phép xuất file cho đến khi đăng ký đầy đủ.
    """
    target_dist_code: str | None = None
    if distributor_id is not None:
        dist_obj = db.get(Distributor, distributor_id)
        if dist_obj:
            target_dist_code = (dist_obj.code or "").strip().upper()

    # 1. Truy vấn đơn hàng DMS trong khoảng ngày đã chọn
    date_expr = (
        func.coalesce(
            VinamilkOrderSnapshot.delivery_date,
            VinamilkOrderSnapshot.order_created_date,
            VinamilkOrderSnapshot.synced_from,
        )
        if date_field == "delivery_date"
        else func.coalesce(
            VinamilkOrderSnapshot.order_created_date,
            VinamilkOrderSnapshot.synced_from,
        )
    )

    stmt = (
        select(VinamilkOrderSnapshot)
        .where(
            VinamilkOrderSnapshot.order_number.is_not(None),
            VinamilkOrderSnapshot.product_code.is_not(None),
            date_expr >= from_date,
            date_expr <= to_date,
        )
        .order_by(VinamilkOrderSnapshot.order_number.asc(), VinamilkOrderSnapshot.id.asc())
    )
    snapshots = list(db.scalars(stmt).all())

    # 2. Lấy danh sách số đơn đã xuất hóa đơn (nếu bật lọc)
    invoiced_orders: set[str] = set()
    if exclude_invoiced:
        issued_stmt = select(IssuedInvoice.source_order_numbers).where(
            IssuedInvoice.status != "CANCELLED"
        )
        if distributor_id is not None:
            issued_stmt = issued_stmt.where(IssuedInvoice.distributor_id == distributor_id)
        for src_nums in db.scalars(issued_stmt).all():
            if isinstance(src_nums, list):
                for num in src_nums:
                    if num:
                        invoiced_orders.add(str(num).strip())

    # 3. Nạp danh mục Khách hàng (kèm Công ty quản lý & Địa chỉ) và Sản phẩm (zero N+1)
    cust_stmt = select(Customer).options(
        selectinload(Customer.company),
        selectinload(Customer.addresses),
        selectinload(Customer.store),
    )
    if distributor_id is not None:
        cust_stmt = cust_stmt.where(
            (Customer.distributor_id == distributor_id) | (Customer.distributor_id.is_(None))
        )
    customer_map: dict[str, Customer] = {}
    for c in db.scalars(cust_stmt).all():
        key = (c.code or "").strip().upper()
        if not key:
            continue
        # Ưu tiên bản ghi khớp chính xác distributor_id
        if key not in customer_map or (
            distributor_id is not None and c.distributor_id == distributor_id
        ):
            customer_map[key] = c

    prod_map: dict[str, Product] = {}
    all_products = db.scalars(select(Product).options(selectinload(Product.unit))).all()
    for p in all_products:
        if p.sku:
            prod_map[p.sku.strip().upper()] = p
        if p._npp_code:
            prod_map[p._npp_code.strip().upper()] = p

    # 4. Gom nhóm theo (company_id, identity_type, identity_value)
    groups_acc: dict[str, dict[str, Any]] = {}
    companies_seen: dict[int, dict[str, Any]] = {}

    for snap in snapshots:
        order_num = (snap.order_number or "").strip()
        if not order_num:
            continue
        if exclude_invoiced and order_num in invoiced_orders:
            continue

        raw = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
        row_dist_code = str(raw.get("Mã NPP") or "").strip().upper()
        if target_dist_code and row_dist_code and row_dist_code != target_dist_code:
            continue

        sup = str(raw.get("Nhà cung cấp") or "VINAMILK").strip().upper()
        if supplier_code and sup != supplier_code.strip().upper():
            continue

        cust_code_raw = (snap.customer_code or "").strip()
        cust_code_key = cust_code_raw.upper()
        customer = customer_map.get(cust_code_key) if cust_code_key else None

        # Nếu lọc theo distributor_id và dòng snapshot không có "Mã NPP" thì kiểm tra qua customer.distributor_id
        if (
            distributor_id is not None
            and not row_dist_code
            and customer is not None
            and customer.distributor_id is not None
            and customer.distributor_id != distributor_id
        ):
            continue

        comp: Company | None = customer.company if customer else None
        comp_id = comp.id if comp else None

        if company_id is not None and comp_id != company_id:
            continue

        if comp is not None:
            companies_seen[comp.id] = {
                "id": comp.id,
                "code": comp.code,
                "name": comp.name,
                "tax_code": comp.tax_code or "",
            }

        tax_code = _clean_identifier(customer.tax_code if customer else None)
        citizen_id = _clean_identifier(customer.citizen_id if customer else None)

        if tax_code:
            identity_type = "TAX_CODE"
            identity_value = tax_code
        elif citizen_id:
            identity_type = "CITIZEN_ID"
            identity_value = citizen_id
        else:
            identity_type = "MISSING_ID"
            identity_value = cust_code_key or f"ORDER_{order_num}"

        group_key = f"{comp_id or 'NO_COMPANY'}::{identity_type}::{identity_value}"

        if group_key not in groups_acc:
            buyer_name = (
                (customer.name if customer else None)
                or (snap.customer_name or "").strip()
                or cust_code_raw
                or "Khách hàng chưa đăng ký"
            )
            buyer_address = (
                (customer.address if customer else None)
                or str(raw.get("Địa chỉ") or raw.get("customerAddress") or "").strip()
            )
            buyer_email = (customer.email if customer else None) or ""
            buyer_phone = (customer.phone if customer else None) or str(
                raw.get("Điện thoại") or raw.get("Số điện thoại") or ""
            ).strip()

            groups_acc[group_key] = {
                "group_key": group_key,
                "company_id": comp_id,
                "company_code": comp.code if comp else "",
                "company_name": comp.name if comp else "",
                "company_tax_code": (comp.tax_code or "") if comp else "",
                "identity_type": identity_type,
                "identity_value": identity_value if identity_type != "MISSING_ID" else "",
                "buyer_name": buyer_name,
                "buyer_tax_code": tax_code,
                "buyer_citizen_id": citizen_id,
                "buyer_address": buyer_address,
                "buyer_email": buyer_email,
                "buyer_phone": buyer_phone,
                "customer_codes": set(),
                "order_numbers": set(),
                "suppliers": set(),
                "missing_customers": set(),
                "missing_companies": set(),
                "missing_tax_or_cccd": set(),
                "missing_products": {},  # raw_code -> product_name
                "items_acc": {},
            }

        grp = groups_acc[group_key]
        if cust_code_raw:
            grp["customer_codes"].add(cust_code_raw)
        grp["order_numbers"].add(order_num)
        grp["suppliers"].add(sup)

        # Kiểm tra điều kiện đăng ký Khách hàng & Công ty quản lý
        if customer is None:
            grp["missing_customers"].add(cust_code_raw or f"(Đơn {order_num})")
        else:
            if comp is None:
                grp["missing_companies"].add(f"{customer.code} ({customer.name})")
            if not tax_code and not citizen_id:
                grp["missing_tax_or_cccd"].add(f"{customer.code} ({customer.name})")

        # Kiểm tra đăng ký Sản phẩm & cộng gộp dòng hàng
        raw_prod_code = (snap.product_code or "").strip().upper()
        prod = prod_map.get(raw_prod_code)
        if prod is None:
            grp["missing_products"][raw_prod_code or "(Trống)"] = (
                snap.product_name or "Sản phẩm chưa đặt tên"
            )

        cqt_sku = prod.sku if prod else raw_prod_code
        cqt_name = prod.name if prod else (snap.product_name or "Hàng hóa chưa đăng ký")
        cqt_unit = (
            (prod.unit.name if (prod and prod.unit) else None)
            or str(raw.get("ĐVT") or raw.get("unit") or "THUNG").strip()
        )

        qty = _to_float(raw.get("Số lượng") or raw.get("quantity"), 0.0)
        promo_qty = _to_float(raw.get("Số lượng KM") or raw.get("promotionQuantity"), 0.0)
        price = _to_float(raw.get("Giá bán") or raw.get("unitPrice") or raw.get("price"), 0.0)
        raw_val = _to_float(
            raw.get("Thành tiền") or raw.get("Giá trị") or raw.get("amount") or raw.get("totalValue"),
            0.0,
        )
        discount = _to_float(raw.get("Số tiền CK") or raw.get("discountAmount"), 0.0)

        if qty > 0 or raw_val > 0:
            line_amount = raw_val if raw_val > 0 else round(qty * price, 2)
            net_before_tax = max(0.0, round(line_amount - discount, 2))
            item_key = f"{cqt_sku}::SALE"
            if item_key not in grp["items_acc"]:
                grp["items_acc"][item_key] = {
                    "product_code": cqt_sku,
                    "source_product_code": raw_prod_code,
                    "product_name": cqt_name,
                    "unit_name": cqt_unit,
                    "is_promo": False,
                    "is_registered": prod is not None,
                    "quantity": 0.0,
                    "discount_amount": 0.0,
                    "amount_before_tax": 0.0,
                    "vat_rate": float(default_vat_rate),
                }
            it = grp["items_acc"][item_key]
            it["quantity"] += qty
            it["discount_amount"] += discount
            it["amount_before_tax"] += net_before_tax

        if promo_qty > 0:
            promo_key = f"{cqt_sku}::PROMO"
            if promo_key not in grp["items_acc"]:
                grp["items_acc"][promo_key] = {
                    "product_code": cqt_sku,
                    "source_product_code": raw_prod_code,
                    "product_name": f"{cqt_name} (Hàng khuyến mại không thu tiền)",
                    "unit_name": cqt_unit,
                    "is_promo": True,
                    "is_registered": prod is not None,
                    "quantity": 0.0,
                    "discount_amount": 0.0,
                    "amount_before_tax": 0.0,
                    "vat_rate": 0.0,
                }
            grp["items_acc"][promo_key]["quantity"] += promo_qty

    # 5. Hoàn thiện danh sách nhóm, tính tổng và tổng hợp lỗi kiểm tra
    result_groups: list[dict[str, Any]] = []
    valid_count = 0
    invalid_count = 0
    total_orders_set: set[str] = set()
    total_customers_set: set[str] = set()
    grand_before_tax = 0.0
    grand_vat = 0.0
    grand_payment = 0.0

    for grp in groups_acc.values():
        validation_errors: list[str] = []
        missing_flags: list[str] = []

        if grp["missing_customers"]:
            missing_flags.append("CUSTOMER")
            codes_str = ", ".join(sorted(grp["missing_customers"]))
            validation_errors.append(
                f"Chưa đăng ký thông tin Khách hàng cho mã KH: {codes_str}"
            )
        if grp["missing_companies"]:
            missing_flags.append("COMPANY")
            codes_str = ", ".join(sorted(grp["missing_companies"]))
            validation_errors.append(
                f"Chưa đăng ký / gán Công ty quản lý cho: {codes_str}"
            )
        if grp["missing_tax_or_cccd"]:
            missing_flags.append("TAX_OR_CCCD")
            codes_str = ", ".join(sorted(grp["missing_tax_or_cccd"]))
            validation_errors.append(
                f"Thiếu cả Mã số thuế (MST) và CCCD cho: {codes_str}"
            )
        if grp["missing_products"]:
            missing_flags.append("PRODUCT")
            prods_str = ", ".join(
                f"{code} ({name})" for code, name in sorted(grp["missing_products"].items())
            )
            validation_errors.append(
                f"Sản phẩm chưa đăng ký trong danh mục sản phẩm: {prods_str}"
            )

        items_list: list[dict[str, Any]] = []
        grp_before_tax = 0.0
        grp_vat = 0.0
        grp_payment = 0.0
        for idx, it in enumerate(
            sorted(
                grp["items_acc"].values(),
                key=lambda x: (x["is_promo"], x["product_code"]),
            ),
            start=1,
        ):
            qty = round(float(it["quantity"]), 4)
            amt = round(float(it["amount_before_tax"]), 2)
            unit_price = round(amt / qty, 2) if qty > 0 else 0.0
            vat_rate = float(it["vat_rate"])
            vat_amt = round(amt * vat_rate / 100.0, 2)
            total_amt = round(amt + vat_amt, 2)

            items_list.append(
                {
                    "line_number": idx,
                    "product_code": it["product_code"],
                    "source_product_code": it["source_product_code"],
                    "product_name": it["product_name"],
                    "unit_name": it["unit_name"],
                    "is_promo": it["is_promo"],
                    "is_registered": it["is_registered"],
                    "quantity": qty,
                    "unit_price": unit_price,
                    "discount_amount": round(float(it["discount_amount"]), 2),
                    "amount_before_tax": amt,
                    "vat_rate": vat_rate,
                    "vat_amount": vat_amt,
                    "total_amount": total_amt,
                }
            )
            grp_before_tax += amt
            grp_vat += vat_amt
            grp_payment += total_amt

        if not items_list:
            continue

        is_valid = len(validation_errors) == 0
        if is_valid:
            valid_count += 1
        else:
            invalid_count += 1

        cust_codes = sorted(grp["customer_codes"])
        ord_nums = sorted(grp["order_numbers"])
        total_orders_set.update(ord_nums)
        total_customers_set.update(cust_codes)
        grand_before_tax += grp_before_tax
        grand_vat += grp_vat
        grand_payment += grp_payment

        result_groups.append(
            {
                "group_key": grp["group_key"],
                "is_valid": is_valid,
                "validation_errors": validation_errors,
                "missing_flags": missing_flags,
                "company_id": grp["company_id"],
                "company_code": grp["company_code"],
                "company_name": grp["company_name"],
                "company_tax_code": grp["company_tax_code"],
                "identity_type": grp["identity_type"],
                "identity_value": grp["identity_value"],
                "buyer_name": grp["buyer_name"],
                "buyer_tax_code": grp["buyer_tax_code"],
                "buyer_citizen_id": grp["buyer_citizen_id"],
                "buyer_address": grp["buyer_address"],
                "buyer_email": grp["buyer_email"],
                "buyer_phone": grp["buyer_phone"],
                "customer_codes": cust_codes,
                "customer_count": len(cust_codes),
                "order_numbers": ord_nums,
                "order_count": len(ord_nums),
                "suppliers": sorted(grp["suppliers"]),
                "item_count": len(items_list),
                "items": items_list,
                "subtotal_before_tax": round(grp_before_tax, 2),
                "vat_amount": round(grp_vat, 2),
                "total_payment": round(grp_payment, 2),
            }
        )

    # Sắp xếp: nhóm thiếu thông tin lên trước hoặc sắp theo Công ty quản lý -> giá trị
    result_groups.sort(
        key=lambda g: (
            g["is_valid"],  # False (thiếu thông tin) hiện trước để kế toán thấy ngay
            g["company_code"] or "ZZZ",
            -g["total_payment"],
        )
    )

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "date_field": date_field,
        "distributor_id": distributor_id,
        "default_vat_rate": float(default_vat_rate),
        "summary": {
            "total_groups": len(result_groups),
            "valid_groups": valid_count,
            "invalid_groups": invalid_count,
            "total_orders": len(total_orders_set),
            "total_customers": len(total_customers_set),
            "total_before_tax": round(grand_before_tax, 2),
            "total_vat": round(grand_vat, 2),
            "total_payment": round(grand_payment, 2),
            "companies": sorted(companies_seen.values(), key=lambda c: c["code"]),
        },
        "groups": result_groups,
    }


def _build_viettel_sinvoice_xls(
    groups: list[dict[str, Any]],
    custom_note: str = "",
) -> BytesIO:
    if not VIETTEL_TEMPLATE_PATH.exists():
        raise FileNotFoundError(
            f"Không tìm thấy file mẫu Viettel S-Invoice tại {VIETTEL_TEMPLATE_PATH}"
        )

    rb = xlrd.open_workbook(str(VIETTEL_TEMPLATE_PATH), formatting_info=True)
    wb = xl_copy(rb)
    ws = wb.get_sheet(0)

    for c in range(45):
        ws.write(10, c, "")

    current_row = 10
    for group_idx, grp in enumerate(groups, start=1):
        buyer_code = grp["customer_codes"][0] if grp["customer_codes"] else f"KH_{group_idx}"
        buyer_name = grp["buyer_name"]
        buyer_addr = grp["buyer_address"] or "Nghệ An"
        buyer_phone = grp["buyer_phone"] or ""
        buyer_email = grp["buyer_email"] or ""
        buyer_tax = grp["buyer_tax_code"] or ""
        buyer_cccd = grp["buyer_citizen_id"] or ""

        note_parts = []
        if custom_note.strip():
            note_parts.append(custom_note.strip())
        if buyer_cccd and not buyer_tax:
            note_parts.append(f"CCCD: {buyer_cccd}")
        if grp["order_numbers"]:
            note_parts.append(f"Gom đơn DMS: {', '.join(grp['order_numbers'])}")
        note_text = " | ".join(note_parts)

        for it in grp["items"]:
            ws.write(current_row, 1, str(group_idx))
            ws.write(current_row, 3, buyer_code)
            ws.write(current_row, 4, buyer_name)
            ws.write(current_row, 5, buyer_addr)
            if buyer_phone:
                ws.write(current_row, 6, buyer_phone)
            if buyer_email:
                ws.write(current_row, 7, buyer_email)
            if buyer_tax:
                ws.write(current_row, 8, buyer_tax)
                ws.write(current_row, 12, buyer_name)
            elif buyer_cccd:
                ws.write(current_row, 10, buyer_cccd)

            ws.write(current_row, 25, "TM/CK")
            ws.write(current_row, 26, "1")
            ws.write(current_row, 27, "VND")
            ws.write(current_row, 28, 1)
            ws.write(current_row, 31, "2" if it["is_promo"] else "1")
            ws.write(current_row, 33, it["product_code"])
            ws.write(current_row, 34, it["product_name"])
            ws.write(current_row, 38, it["unit_name"])
            ws.write(current_row, 39, it["quantity"])
            ws.write(current_row, 40, it["unit_price"])
            ws.write(current_row, 41, it["amount_before_tax"])
            ws.write(current_row, 42, str(int(it["vat_rate"]) if float(it["vat_rate"]).is_integer() else it["vat_rate"]))
            ws.write(current_row, 43, it["vat_amount"])
            ws.write(current_row, 44, note_text)
            current_row += 1

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def _build_standard_xlsx(
    groups: list[dict[str, Any]],
    provider: str,
    custom_note: str = "",
) -> BytesIO:
    wb = Workbook()
    ws = wb.active
    ws.title = f"HD_{provider}"[:31]

    if provider == "MISA":
        headers = [
            "Nhóm hóa đơn (*)",
            "Công ty quản lý",
            "Mã khách hàng",
            "Tên đơn vị / Khách hàng (*)",
            "Mã số thuế",
            "Số CCCD",
            "Địa chỉ",
            "Email nhận HĐ",
            "Hình thức TT",
            "Tính chất",
            "Mã hàng (*)",
            "Tên hàng hóa, dịch vụ (*)",
            "ĐVT",
            "Số lượng",
            "Đơn giá",
            "Thành tiền chưa thuế",
            "Thuế suất GTGT (%)",
            "Tiền thuế GTGT",
            "Tổng tiền thanh toán",
            "Ghi chú / Số đơn DMS",
        ]
    elif provider == "VNPT":
        headers = [
            "STT Hóa đơn",
            "Công ty xuất HĐ",
            "Mã KH",
            "Tên KH / Đơn vị",
            "MST",
            "CCCD",
            "Địa chỉ",
            "Email",
            "HTTT",
            "Loại dòng",
            "Mã sản phẩm",
            "Tên sản phẩm",
            "ĐVT",
            "Số lượng",
            "Đơn giá",
            "Thành tiền",
            "Thuế suất (%)",
            "Tiền thuế",
            "Tổng cộng",
            "Ghi chú",
        ]
    else:  # EASYINVOICE
        headers = [
            "Số thứ tự HĐ",
            "Công ty quản lý",
            "Mã KH",
            "Tên khách hàng",
            "Mã số thuế",
            "CCCD",
            "Địa chỉ",
            "Email",
            "Phương thức TT",
            "Tính chất HH",
            "Mã HH",
            "Tên HH/DV",
            "Đơn vị tính",
            "Số lượng",
            "Đơn giá",
            "Thành tiền trước thuế",
            "Thuế suất GTGT",
            "Tiền thuế GTGT",
            "Tổng cộng tiền TT",
            "Diễn giải / Đơn DMS",
        ]

    header_fill = PatternFill(start_color="14263D", end_color="14263D", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=10)
    thin_side = Side(style="thin", color="CBD5E1")
    border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    ws.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
    ws.row_dimensions[1].height = 26

    for group_idx, grp in enumerate(groups, start=1):
        buyer_code = ", ".join(grp["customer_codes"])
        note_parts = []
        if custom_note.strip():
            note_parts.append(custom_note.strip())
        if grp["order_numbers"]:
            note_parts.append(f"Đơn DMS: {', '.join(grp['order_numbers'])}")
        note_text = " | ".join(note_parts)

        for it in grp["items"]:
            row_vals = [
                group_idx,
                f"{grp['company_code']} - {grp['company_name']}" if grp["company_code"] else "",
                buyer_code,
                grp["buyer_name"],
                grp["buyer_tax_code"],
                grp["buyer_citizen_id"],
                grp["buyer_address"],
                grp["buyer_email"],
                "TM/CK",
                "Khuyến mại" if it["is_promo"] else "Hàng hóa, dịch vụ",
                it["product_code"],
                it["product_name"],
                it["unit_name"],
                it["quantity"],
                it["unit_price"],
                it["amount_before_tax"],
                it["vat_rate"],
                it["vat_amount"],
                it["total_amount"],
                note_text,
            ]
            ws.append(row_vals)
            row_idx = ws.max_row
            for col_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=row_idx, column=col_idx)
                cell.border = border
                if col_idx in (14, 15, 16, 18, 19):
                    cell.number_format = "#,##0.##"
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif col_idx in (1, 13, 17):
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                else:
                    cell.alignment = Alignment(vertical="center")

    col_widths = [14, 24, 18, 30, 16, 16, 32, 22, 12, 16, 16, 34, 10, 12, 14, 18, 14, 16, 18, 34]
    for idx, width in enumerate(col_widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = width

    ws.freeze_panes = "A2"
    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def export_consolidated_groups(
    groups: list[dict[str, Any]],
    *,
    provider: str = "VIETTEL",
    custom_note: str = "",
    split_by_company: bool = True,
) -> tuple[BytesIO, str, str]:
    """Xuất các nhóm hóa đơn đã gom ra file theo định dạng của nhà cung cấp HĐĐT.

    Trả về: (buffer, filename, media_type)
    """
    prov = (provider or "VIETTEL").strip().upper()
    if prov not in SUPPORTED_PROVIDERS:
        raise ValueError(f"Chưa hỗ trợ mẫu Hóa đơn điện tử '{prov}'.")

    if not groups:
        raise ValueError("Chưa chọn nhóm hóa đơn nào để xuất file.")

    invalid_groups = [g for g in groups if not g.get("is_valid")]
    if invalid_groups:
        first_err = invalid_groups[0]["validation_errors"][0]
        raise ValueError(
            f"Có {len(invalid_groups)} nhóm hóa đơn chưa đủ thông tin bắt buộc. "
            f"Vui lòng đăng ký đầy đủ Sản phẩm / Khách hàng / Công ty quản lý trước khi xuất. ({first_err})"
        )

    meta = SUPPORTED_PROVIDERS[prov]
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    by_company: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g in groups:
        comp_key = g.get("company_code") or "KHONG_CTY"
        by_company[comp_key].append(g)

    def _render_single(grp_list: list[dict[str, Any]]) -> BytesIO:
        if prov == "VIETTEL":
            return _build_viettel_sinvoice_xls(grp_list, custom_note=custom_note)
        return _build_standard_xlsx(grp_list, provider=prov, custom_note=custom_note)

    if len(by_company) == 1 or not split_by_company:
        comp_tag = next(iter(by_company.keys())) if len(by_company) == 1 else "ALL"
        buf = _render_single(groups)
        filename = f"HD_{prov}_{comp_tag}_{stamp}.{meta['ext']}"
        return buf, filename, meta["media_type"]

    # Nhiều Công ty quản lý -> đóng gói file ZIP, mỗi công ty 1 file riêng
    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for comp_code, comp_groups in sorted(by_company.items()):
            file_buf = _render_single(comp_groups)
            inner_name = f"HD_{prov}_{comp_code}_{stamp}.{meta['ext']}"
            zf.writestr(inner_name, file_buf.getvalue())
    zip_buf.seek(0)
    return zip_buf, f"HD_{prov}_TheoCongTy_{stamp}.zip", "application/zip"
