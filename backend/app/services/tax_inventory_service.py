from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.customer import Company
from app.models.multi_tenant_invoice import (
    Distributor,
    IssuedInvoice,
    IssuedInvoiceItem,
    PurchaseInvoice,
    PurchaseInvoiceItem,
    TaxAuthorityCredential,
    TaxInventoryOpeningBalance,
)
from app.models.product import Product

ZERO = Decimal("0")
QTY_QUANT = Decimal("0.0001")
AMT_QUANT = Decimal("0.01")
EPSILON = Decimal("0.000001")
NON_STOCK_ITEM_NATURES = (3, 4)  # 3 = Chiết khấu thương mại, 4 = Ghi chú / diễn giải theo NĐ 123


def _to_dec(val: Any) -> Decimal:
    if val is None:
        return ZERO
    if isinstance(val, Decimal):
        return val
    try:
        return Decimal(str(val))
    except Exception:
        return ZERO


def _q_qty(val: Decimal) -> float:
    return float(val.quantize(QTY_QUANT, rounding=ROUND_HALF_UP))


def _q_amt(val: Decimal) -> float:
    return float(val.quantize(AMT_QUANT, rounding=ROUND_HALF_UP))


def _to_date(dt: datetime | date | None) -> date | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.date()
    return dt


def _extract_purchase_tthai(raw_metadata: Any) -> int | None:
    """Lấy mã trạng thái hóa đơn GDT (tthai): 4 = Đã bị thay thế, 6 = Đã bị hủy."""
    if not isinstance(raw_metadata, dict):
        return None
    raw_val = raw_metadata.get("tthai")
    if raw_val is None:
        return None
    try:
        return int(str(raw_val).strip())
    except (TypeError, ValueError):
        return None


def _build_excluded_purchase_invoice_ids(
    purch_headers: list[tuple[Any, ...]],
) -> set[int]:
    """Xác định các PurchaseInvoice ID phải LOẠI TRỪ khỏi đầu vào (không nhân -1):
    - Hóa đơn có trạng thái GDT tthai in (4: Đã bị thay thế, 6: Đã bị hủy).
    - Hóa đơn bị tham chiếu trong `replaced_invoice_number` bởi một hóa đơn THAY THẾ
      CÙNG nhà cung cấp (`seller_tax_code`).
    - QUAN TRỌNG: Nếu hóa đơn tham chiếu là Hóa đơn ĐIỀU CHỈNH (tthai == 3, tchdon == 2,
      hoặc có tổng tiền âm) thì TUYỆT ĐỐI KHÔNG loại trừ hóa đơn gốc (vì HĐ điều chỉnh chỉ cộng/trừ phần chênh lệch).
    """
    excluded_ids: set[int] = set()
    replaced_keys: set[tuple[str, str]] = set()

    for row in purch_headers:
        inv_id, seller_mst, _inv_no, replaced_no, raw_meta = (
            row[0],
            (row[1] or "").strip(),
            (row[2] or "").strip(),
            row[3],
            row[4],
        )
        amt_before = _to_dec(row[11]) if len(row) > 11 else ZERO
        total_amt = _to_dec(row[12]) if len(row) > 12 else ZERO

        tthai = _extract_purchase_tthai(raw_meta)
        tchdon_raw = raw_meta.get("tchdon") if isinstance(raw_meta, dict) else None
        is_adjustment_doc = (
            tthai == 3
            or str(tchdon_raw or "").strip() == "2"
            or amt_before < ZERO
            or total_amt < ZERO
        )

        if tthai in (4, 6):
            excluded_ids.add(inv_id)
        if replaced_no and not is_adjustment_doc:
            for part in str(replaced_no).split("/"):
                clean = part.strip()
                if clean:
                    replaced_keys.add((seller_mst, clean))

    for row in purch_headers:
        inv_id, seller_mst, inv_no = row[0], (row[1] or "").strip(), (row[2] or "").strip()
        if inv_no and (seller_mst, inv_no) in replaced_keys:
            excluded_ids.add(inv_id)

    return excluded_ids


def _load_effective_opening_balances(
    db: Session,
    *,
    distributor_id: int | None = None,
    to_date: date | None = None,
) -> dict[tuple[str, str], dict[str, Any]]:
    """Nạp số dư tồn đầu kỳ hiệu lực mới nhất (as_of_date <= to_date) cho từng cặp (MST, SKU)."""
    stmt = select(
        TaxInventoryOpeningBalance.tax_code,
        TaxInventoryOpeningBalance.sku,
        TaxInventoryOpeningBalance.product_name,
        TaxInventoryOpeningBalance.unit_name,
        TaxInventoryOpeningBalance.as_of_date,
        TaxInventoryOpeningBalance.opening_qty,
        TaxInventoryOpeningBalance.opening_amount,
    ).order_by(TaxInventoryOpeningBalance.as_of_date.desc(), TaxInventoryOpeningBalance.id.desc())
    if distributor_id is not None:
        stmt = stmt.where(
            (TaxInventoryOpeningBalance.distributor_id == distributor_id)
            | (TaxInventoryOpeningBalance.distributor_id.is_(None))
        )
    if to_date is not None:
        stmt = stmt.where(TaxInventoryOpeningBalance.as_of_date <= to_date)

    result: dict[tuple[str, str], dict[str, Any]] = {}
    for mst_raw, sku_raw, p_name, u_name, as_of, o_qty, o_amt in db.execute(stmt).all():
        mst = (mst_raw or "").strip()
        sku = (sku_raw or "").strip().upper()
        if not mst or not sku:
            continue
        key = (mst, sku)
        if key not in result:
            result[key] = {
                "as_of_date": as_of,
                "opening_qty": _to_dec(o_qty),
                "opening_amount": _to_dec(o_amt),
                "product_name": (p_name or "").strip(),
                "unit_name": (u_name or "").strip(),
            }
    return result


def compute_tax_inventory_by_mst(
    db: Session,
    *,
    distributor_id: int | None = None,
    company_tax_code: str | None = None,
    search: str | None = None,
    only_negative: bool = False,
    status_filter: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    include_draft: bool = True,
    low_threshold: float = 5.0,
    page: int = 1,
    page_size: int = 0,
) -> dict[str, Any]:
    """Tính sổ Nhập – Xuất – Tồn Thuế theo từng cặp (MST pháp nhân, Mã SKU đầu vào CQT).

    Chuẩn kế toán quyết toán (TT 200 / TT 133 / NĐ 123):
    - Hỗ trợ Số dư Tồn đầu kỳ (`tax_inventory_opening_balances`) gồm cả SL & Trị giá TK 156.
    - Loại trừ hóa đơn đầu vào bị thay thế/bị hủy và lọc dòng `<TChat>` = 3 (CKTM) / 4 (Ghi chú).
    - Tính Giá vốn Bình quân gia quyền (TK 632), Trị giá tồn kho cuối kỳ (TK 156) & cảnh báo bán dưới giá vốn.
    - Kiểm tra Âm kho theo thời điểm (Chronological Cutoff Check).
    """
    low_thresh_dec = _to_dec(low_threshold)

    # 1. Nạp danh mục Công ty & NPP (chỉ lấy cột cần thiết)
    comp_stmt = select(Company.tax_code, Company.short_name, Company.name)
    if distributor_id is not None:
        comp_stmt = comp_stmt.where(Company.distributor_id == distributor_id)
    company_name_by_mst: dict[str, str] = {}
    for tax_code, short_name, full_name in db.execute(comp_stmt).all():
        mst = (tax_code or "").strip()
        if mst and mst not in company_name_by_mst:
            company_name_by_mst[mst] = short_name or full_name

    dist_mst_by_id: dict[int, str] = {}
    for d_id, d_mst in db.execute(select(Distributor.id, Distributor.tax_code)).all():
        if d_mst:
            dist_mst_by_id[d_id] = d_mst.strip()

    # 1b. Nạp Số dư Tồn đầu kỳ (TK 156)
    opening_map = _load_effective_opening_balances(
        db,
        distributor_id=distributor_id,
        to_date=to_date,
    )

    ledger: dict[tuple[str, str], dict[str, Any]] = {}
    daily_deltas: dict[tuple[str, str], dict[date, Decimal]] = {}
    unmapped_sku_items_count = 0

    def _get_or_init_rec(mst: str, sku: str, pname: str, uname: str) -> dict[str, Any]:
        key = (mst, sku)
        rec = ledger.get(key)
        if rec is None:
            ob = opening_map.get(key)
            rec = {
                "tax_code": mst,
                "company_name": company_name_by_mst.get(mst, f"MST {mst}"),
                "sku": sku,
                "product_name": pname or (ob["product_name"] if ob else ""),
                "unit_name": uname or (ob["unit_name"] if ob else ""),
                "opening_as_of_date": ob["as_of_date"] if ob else None,
                "base_opening_qty": ob["opening_qty"] if ob else ZERO,
                "base_opening_amount": ob["opening_amount"] if ob else ZERO,
                "pre_in_qty": ZERO,
                "pre_in_amount": ZERO,
                "pre_out_qty": ZERO,
                "input_qty": ZERO,
                "input_amount": ZERO,
                "output_qty": ZERO,
                "output_amount": ZERO,
                "official_output_qty": ZERO,
                "draft_output_qty": ZERO,
                "adjustment_qty": ZERO,
            }
            ledger[key] = rec
        else:
            if not rec["product_name"] and pname:
                rec["product_name"] = pname
            if not rec["unit_name"] and uname:
                rec["unit_name"] = uname
        return rec

    # Khởi tạo sẵn các dòng có khai báo tồn đầu kỳ (kể cả khi kỳ này chưa có phát sinh N-X)
    for (mst, sku), ob in opening_map.items():
        _get_or_init_rec(mst, sku, ob["product_name"], ob["unit_name"])

    # 2. Quét header Hóa đơn mua vào CQT (không tải xml_content / html_content)
    purch_hdr_stmt = (
        select(
            PurchaseInvoice.id,
            PurchaseInvoice.seller_tax_code,
            PurchaseInvoice.invoice_number,
            PurchaseInvoice.replaced_invoice_number,
            PurchaseInvoice.raw_metadata,
            PurchaseInvoice.buyer_tax_code,
            PurchaseInvoice.buyer_name,
            PurchaseInvoice.distributor_id,
            PurchaseInvoice.invoice_date,
            PurchaseInvoice.xml_downloaded,
            TaxAuthorityCredential.username,
            PurchaseInvoice.amount_before_tax,
            PurchaseInvoice.total_amount,
        )
        .outerjoin(
            TaxAuthorityCredential,
            PurchaseInvoice.tax_credential_id == TaxAuthorityCredential.id,
        )
    )
    if distributor_id is not None:
        purch_hdr_stmt = purch_hdr_stmt.where(PurchaseInvoice.distributor_id == distributor_id)
    purch_headers = list(db.execute(purch_hdr_stmt).all())

    excluded_purch_ids = _build_excluded_purchase_invoice_ids(purch_headers)

    purch_meta_by_id: dict[int, tuple[str, date | None]] = {}
    missing_xml_invoices_count = 0
    for row in purch_headers:
        (
            inv_id,
            _seller_mst,
            _inv_no,
            _replaced_no,
            _raw_meta,
            buyer_mst,
            buyer_name,
            dist_id,
            inv_dt,
            xml_downloaded,
            cred_username,
            _amt_before,
            _total_amt,
        ) = row
        if inv_id in excluded_purch_ids:
            continue
        inv_date = _to_date(inv_dt)
        if to_date is not None and inv_date is not None and inv_date > to_date:
            continue
        mst = (buyer_mst or cred_username or dist_mst_by_id.get(dist_id) or "").strip()
        if not mst:
            continue
        if buyer_name and mst not in company_name_by_mst:
            company_name_by_mst[mst] = buyer_name.strip()
        if not xml_downloaded:
            missing_xml_invoices_count += 1
        purch_meta_by_id[inv_id] = (mst, inv_date)

    if purch_meta_by_id:
        valid_purch_ids = list(purch_meta_by_id.keys())
        for i in range(0, len(valid_purch_ids), 500):
            batch_ids = valid_purch_ids[i : i + 500]
            item_rows = db.execute(
                select(
                    PurchaseInvoiceItem.purchase_invoice_id,
                    PurchaseInvoiceItem.item_nature,
                    PurchaseInvoiceItem.product_code,
                    PurchaseInvoiceItem.product_name,
                    PurchaseInvoiceItem.unit_name,
                    PurchaseInvoiceItem.quantity,
                    PurchaseInvoiceItem.amount_before_tax,
                ).where(PurchaseInvoiceItem.purchase_invoice_id.in_(batch_ids))
            ).all()

            for p_inv_id, item_nature, p_code, p_name, u_name, qty_raw, amt_raw in item_rows:
                # Lọc bỏ dòng Chiết khấu thương mại (TChat=3) và Ghi chú/diễn giải (TChat=4)
                if item_nature in NON_STOCK_ITEM_NATURES:
                    continue
                sku = (p_code or "").strip().upper()
                if not sku:
                    unmapped_sku_items_count += 1
                    continue
                mst, inv_date = purch_meta_by_id[p_inv_id]
                ob = opening_map.get((mst, sku))
                if ob is not None and inv_date is not None and inv_date < ob["as_of_date"]:
                    # Đã nằm trong số dư chốt đầu kỳ -> bỏ qua không cộng lặp
                    continue

                qty_dec = _to_dec(qty_raw)
                amt_dec = _to_dec(amt_raw)
                rec = _get_or_init_rec(mst, sku, (p_name or "").strip(), (u_name or "").strip())

                if from_date is not None and inv_date is not None and inv_date < from_date:
                    rec["pre_in_qty"] += qty_dec
                    rec["pre_in_amount"] += amt_dec
                else:
                    rec["input_qty"] += qty_dec
                    rec["input_amount"] += amt_dec
                    if inv_date is not None:
                        dmap = daily_deltas.setdefault((mst, sku), {})
                        dmap[inv_date] = dmap.get(inv_date, ZERO) + qty_dec

    # 3. Quét Hóa đơn bán ra đã phát hành / nháp (chỉ đọc cột nhẹ)
    issued_stmt = (
        select(
            IssuedInvoice.seller_tax_code,
            IssuedInvoice.distributor_id,
            IssuedInvoice.status,
            IssuedInvoice.invoice_type,
            IssuedInvoice.issued_at,
            IssuedInvoice.created_at,
            IssuedInvoiceItem.item_type,
            IssuedInvoiceItem.source_sku,
            IssuedInvoiceItem.product_code,
            IssuedInvoiceItem.product_name,
            IssuedInvoiceItem.source_unit,
            IssuedInvoiceItem.unit_name,
            IssuedInvoiceItem.source_quantity,
            IssuedInvoiceItem.quantity,
            IssuedInvoiceItem.amount_before_tax,
        )
        .join(IssuedInvoiceItem, IssuedInvoiceItem.invoice_id == IssuedInvoice.id)
        .where(IssuedInvoice.status.notin_(("CANCELLED", "REPLACED")))
    )
    if distributor_id is not None:
        issued_stmt = issued_stmt.where(IssuedInvoice.distributor_id == distributor_id)

    for row in db.execute(issued_stmt).all():
        (
            seller_mst,
            dist_id,
            inv_status,
            inv_type,
            issued_at,
            created_at,
            item_type,
            src_sku,
            prod_code,
            prod_name,
            src_unit,
            unit_name,
            src_qty_raw,
            qty_raw,
            amt_raw,
        ) = row

        if (item_type or "NORMAL").upper() not in ("NORMAL", "PROMOTION", "ADJUSTMENT"):
            continue

        is_draft = (inv_status or "").upper() == "DRAFT"
        tx_date = _to_date(issued_at or created_at)
        if to_date is not None and tx_date is not None and tx_date > to_date:
            continue

        mst = (seller_mst or dist_mst_by_id.get(dist_id) or "").strip()
        if not mst:
            continue
        sku = (src_sku or prod_code or "").strip().upper()
        if not sku:
            continue

        ob = opening_map.get((mst, sku))
        if ob is not None and tx_date is not None and tx_date < ob["as_of_date"]:
            continue

        qty_dec = _to_dec(src_qty_raw) if src_qty_raw is not None else _to_dec(qty_raw)
        amt_dec = _to_dec(amt_raw)
        is_adjustment = (inv_type or "ORIGINAL").upper() == "ADJUSTMENT"

        rec = _get_or_init_rec(
            mst,
            sku,
            (prod_name or "").strip(),
            (src_unit or unit_name or "").strip(),
        )

        if is_draft:
            rec["draft_output_qty"] += qty_dec
            if not include_draft:
                continue
        else:
            rec["official_output_qty"] += qty_dec

        if from_date is not None and tx_date is not None and tx_date < from_date:
            rec["pre_out_qty"] += qty_dec
        else:
            rec["output_qty"] += qty_dec
            rec["output_amount"] += amt_dec
            if is_adjustment:
                rec["adjustment_qty"] += qty_dec
            if tx_date is not None:
                dmap = daily_deltas.setdefault((mst, sku), {})
                dmap[tx_date] = dmap.get(tx_date, ZERO) - qty_dec

    # 4. Chuẩn hóa tên sản phẩm từ bảng products & tính Tồn đầu kỳ, Bình quân gia quyền (TK 632 & TK 156)
    all_skus = list({sku for _, sku in ledger.keys()})
    prod_info: dict[str, tuple[str, float | None]] = {}
    if all_skus:
        for i in range(0, len(all_skus), 500):
            batch_skus = all_skus[i : i + 500]
            for p_sku, p_name, p_vat in db.execute(
                select(Product.sku, Product.name, Product.vat_rate).where(Product.sku.in_(batch_skus))
            ).all():
                if p_sku:
                    prod_info[p_sku.strip().upper()] = (p_name, p_vat)

    sku_positive_by_mst: dict[str, list[dict[str, Any]]] = {}
    balance_lookup: dict[tuple[str, str], float] = {}
    computed_metrics: dict[tuple[str, str], dict[str, Any]] = {}

    for (mst, sku), rec in ledger.items():
        # Tính số dư đầu kỳ (tại from_date) = số dư chốt + phát sinh trước from_date
        pre_avail_qty = rec["base_opening_qty"] + rec["pre_in_qty"]
        pre_avail_amt = rec["base_opening_amount"] + rec["pre_in_amount"]
        opening_qty_dec = pre_avail_qty - rec["pre_out_qty"]
        if pre_avail_qty > EPSILON and opening_qty_dec > EPSILON:
            pre_unit_cost = pre_avail_amt / pre_avail_qty
            opening_amt_dec = (opening_qty_dec * pre_unit_cost).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)
        elif opening_qty_dec > EPSILON and rec["pre_out_qty"] == ZERO:
            opening_amt_dec = pre_avail_amt
        else:
            opening_amt_dec = ZERO

        # Tính Bình quân gia quyền cả kỳ (TT 200 / TT 133)
        avail_qty = opening_qty_dec + rec["input_qty"]
        avail_amt = opening_amt_dec + rec["input_amount"]
        avg_unit_cost_dec = (avail_amt / avail_qty) if (avail_qty > EPSILON and avail_amt > ZERO) else ZERO

        bal_dec = avail_qty - rec["output_qty"]
        bal = _q_qty(bal_dec)
        balance_lookup[(mst, sku)] = bal

        cogs_amt_dec = (rec["output_qty"] * avg_unit_cost_dec).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)
        if bal_dec > EPSILON:
            ending_val_dec = max(ZERO, (avail_amt - cogs_amt_dec).quantize(AMT_QUANT, rounding=ROUND_HALF_UP))
        else:
            ending_val_dec = ZERO

        avg_sale_price_dec = (
            (rec["output_amount"] / rec["output_qty"]) if rec["output_qty"] > EPSILON else ZERO
        )
        is_below_cost = bool(
            rec["output_qty"] > EPSILON
            and rec["output_amount"] > ZERO
            and avg_unit_cost_dec > ZERO
            and avg_sale_price_dec < (avg_unit_cost_dec - Decimal("1"))
        )

        if bal_dec > EPSILON:
            sku_positive_by_mst.setdefault(sku, []).append(
                {
                    "tax_code": mst,
                    "company_name": rec["company_name"],
                    "balance_qty": bal,
                }
            )

        # Kiểm tra âm kho theo từng ngày (Chronological Cutoff Check)
        running = opening_qty_dec
        min_running = running
        has_chrono_neg = running < -EPSILON
        for _d, delta in sorted(daily_deltas.get((mst, sku), {}).items()):
            running += delta
            if running < min_running:
                min_running = running
            if running < -EPSILON:
                has_chrono_neg = True

        computed_metrics[(mst, sku)] = {
            "opening_qty_dec": opening_qty_dec,
            "opening_amt_dec": opening_amt_dec,
            "bal_dec": bal_dec,
            "avg_unit_cost_dec": avg_unit_cost_dec,
            "avg_sale_price_dec": avg_sale_price_dec,
            "cogs_amt_dec": cogs_amt_dec,
            "ending_val_dec": ending_val_dec,
            "is_below_cost": is_below_cost,
            "has_chrono_neg": has_chrono_neg,
            "min_running_bal": _q_qty(min_running),
        }

    # 5. Lọc theo MST & search, tính KPI Summary khớp đúng ngữ cảnh đang chọn
    mst_filter = (company_tax_code or "").strip()
    search_term = (search or "").strip().lower()
    norm_status_filter = (status_filter or "").strip().upper()
    if only_negative and not norm_status_filter:
        norm_status_filter = "NEGATIVE"

    rows: list[dict[str, Any]] = []
    scoped_total = 0
    negative_count = 0
    low_count = 0
    ok_count = 0
    chrono_negative_count = 0
    below_cost_count = 0
    total_opening_amount = ZERO
    total_input_amount = ZERO
    total_output_amount = ZERO
    total_cogs_amount = ZERO
    total_ending_inventory_value = ZERO

    for (mst, sku), rec in ledger.items():
        if mst_filter and mst != mst_filter:
            continue

        pname = prod_info.get(sku, (rec["product_name"], None))[0] or rec["product_name"]
        pvat = prod_info.get(sku, (None, None))[1]

        if search_term and not (
            search_term in sku.lower()
            or search_term in pname.lower()
            or search_term in mst.lower()
            or search_term in rec["company_name"].lower()
        ):
            continue

        m = computed_metrics[(mst, sku)]
        bal_dec = m["bal_dec"]
        bal = balance_lookup[(mst, sku)]
        has_chrono_neg = m["has_chrono_neg"]
        is_below_cost = m["is_below_cost"]

        if bal_dec < -EPSILON:
            status = "NEGATIVE"
            negative_count += 1
        elif bal_dec <= low_thresh_dec:
            status = "LOW"
            low_count += 1
        else:
            status = "OK"
            ok_count += 1

        if has_chrono_neg and status != "NEGATIVE":
            chrono_negative_count += 1
        if is_below_cost:
            below_cost_count += 1

        scoped_total += 1

        if norm_status_filter == "NEGATIVE" and status != "NEGATIVE":
            continue
        if norm_status_filter == "LOW" and status != "LOW":
            continue
        if norm_status_filter == "OK" and status != "OK":
            continue
        if norm_status_filter == "CHRONO_NEGATIVE" and not has_chrono_neg:
            continue
        if norm_status_filter == "BELOW_COST" and not is_below_cost:
            continue

        total_opening_amount += m["opening_amt_dec"]
        total_input_amount += rec["input_amount"]
        total_output_amount += rec["output_amount"]
        total_cogs_amount += m["cogs_amt_dec"]
        total_ending_inventory_value += m["ending_val_dec"]

        other_stocks = [
            x for x in sku_positive_by_mst.get(sku, []) if x["tax_code"] != mst
        ]
        rows.append(
            {
                "tax_code": mst,
                "company_name": rec["company_name"],
                "sku": sku,
                "product_name": pname,
                "unit_name": rec["unit_name"],
                "vat_rate": pvat,
                "opening_as_of_date": rec["opening_as_of_date"].isoformat() if rec["opening_as_of_date"] else None,
                "opening_qty": _q_qty(m["opening_qty_dec"]),
                "opening_amount": _q_amt(m["opening_amt_dec"]),
                "input_qty": _q_qty(rec["input_qty"]),
                "input_amount": _q_amt(rec["input_amount"]),
                "output_qty": _q_qty(rec["output_qty"]),
                "output_amount": _q_amt(rec["output_amount"]),
                "official_output_qty": _q_qty(rec["official_output_qty"]),
                "draft_output_qty": _q_qty(rec["draft_output_qty"]),
                "adjustment_qty": _q_qty(rec["adjustment_qty"]),
                "balance_qty": bal,
                "avg_unit_cost": _q_amt(m["avg_unit_cost_dec"]),
                "avg_sale_price": _q_amt(m["avg_sale_price_dec"]),
                "cogs_amount": _q_amt(m["cogs_amt_dec"]),
                "ending_inventory_value": _q_amt(m["ending_val_dec"]),
                "is_below_cost": is_below_cost,
                "has_chronological_negative": has_chrono_neg,
                "min_running_balance": m["min_running_bal"],
                "status": status,
                "other_mst_stocks": other_stocks,
            }
        )

    rows.sort(
        key=lambda r: (
            0 if r["status"] == "NEGATIVE" else (1 if r["has_chronological_negative"] else (2 if r["is_below_cost"] else 3)),
            r["tax_code"],
            r["sku"],
        )
    )
    available_msts = sorted(
        [
            {"tax_code": mst, "company_name": company_name_by_mst.get(mst, f"MST {mst}")}
            for mst in {k[0] for k in ledger.keys()}
        ],
        key=lambda x: x["tax_code"],
    )

    total_filtered = len(rows)
    if page_size > 0:
        safe_page = max(1, page)
        start_idx = (safe_page - 1) * page_size
        paged_rows = rows[start_idx : start_idx + page_size]
    else:
        safe_page = 1
        paged_rows = rows

    return {
        "summary": {
            "total_records": scoped_total,
            "filtered_records": total_filtered,
            "negative_count": negative_count,
            "low_count": low_count,
            "ok_count": ok_count,
            "chrono_negative_count": chrono_negative_count,
            "below_cost_count": below_cost_count,
            "mst_count": len(available_msts),
            "total_opening_amount": _q_amt(total_opening_amount),
            "total_input_amount": _q_amt(total_input_amount),
            "total_output_amount": _q_amt(total_output_amount),
            "total_cogs_amount": _q_amt(total_cogs_amount),
            "total_ending_inventory_value": _q_amt(total_ending_inventory_value),
        },
        "data_quality": {
            "missing_xml_invoices_count": missing_xml_invoices_count,
            "unmapped_sku_items_count": unmapped_sku_items_count,
        },
        "pagination": {
            "page": safe_page,
            "page_size": page_size,
            "total": total_filtered,
            "total_pages": max(1, (total_filtered + page_size - 1) // page_size) if page_size > 0 else 1,
        },
        "available_msts": available_msts,
        "items": paged_rows,
        "balance_lookup": balance_lookup,
        "sku_positive_by_mst": sku_positive_by_mst,
    }


def get_tax_inventory_card_detail(
    db: Session,
    *,
    tax_code: str,
    sku: str,
    distributor_id: int | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    include_draft: bool = True,
) -> dict[str, Any]:
    """Lấy Thẻ kho thuế chi tiết (Sổ chi tiết N-X-T) theo trục thời gian cho 1 cặp (MST, SKU)."""
    target_mst = (tax_code or "").strip()
    target_sku = (sku or "").strip().upper()
    if not target_mst or not target_sku:
        raise ValueError("Thiếu MST hoặc mã SKU để xem thẻ kho thuế.")

    dist_mst_by_id: dict[int, str] = {
        d_id: d_mst.strip()
        for d_id, d_mst in db.execute(select(Distributor.id, Distributor.tax_code)).all()
        if d_mst
    }
    opening_map = _load_effective_opening_balances(
        db, distributor_id=distributor_id, to_date=to_date
    )
    ob = opening_map.get((target_mst, target_sku))
    opening_qty = ob["opening_qty"] if ob else ZERO
    opening_as_of = ob["as_of_date"] if ob else None

    # 1. Lấy danh sách hóa đơn mua vào hợp lệ (đã loại thay thế/hủy)
    purch_hdr_stmt = (
        select(
            PurchaseInvoice.id,
            PurchaseInvoice.seller_tax_code,
            PurchaseInvoice.invoice_number,
            PurchaseInvoice.replaced_invoice_number,
            PurchaseInvoice.raw_metadata,
            PurchaseInvoice.buyer_tax_code,
            PurchaseInvoice.distributor_id,
            PurchaseInvoice.invoice_date,
            PurchaseInvoice.invoice_symbol,
            PurchaseInvoice.seller_name,
            TaxAuthorityCredential.username,
            PurchaseInvoice.amount_before_tax,
            PurchaseInvoice.total_amount,
        )
        .outerjoin(
            TaxAuthorityCredential,
            PurchaseInvoice.tax_credential_id == TaxAuthorityCredential.id,
        )
    )
    if distributor_id is not None:
        purch_hdr_stmt = purch_hdr_stmt.where(PurchaseInvoice.distributor_id == distributor_id)
    purch_headers = list(db.execute(purch_hdr_stmt).all())
    excluded_purch_ids = _build_excluded_purchase_invoice_ids(purch_headers)

    matched_purch: dict[int, tuple[Any, ...]] = {}
    for row in purch_headers:
        inv_id = row[0]
        if inv_id in excluded_purch_ids:
            continue
        mst = (row[5] or row[10] or dist_mst_by_id.get(row[6]) or "").strip()
        if mst != target_mst:
            continue
        inv_date = _to_date(row[7])
        if to_date is not None and inv_date is not None and inv_date > to_date:
            continue
        if opening_as_of is not None and inv_date is not None and inv_date < opening_as_of:
            continue
        matched_purch[inv_id] = row

    events: list[dict[str, Any]] = []

    if matched_purch:
        p_ids = list(matched_purch.keys())
        for i in range(0, len(p_ids), 500):
            batch_ids = p_ids[i : i + 500]
            item_rows = db.execute(
                select(
                    PurchaseInvoiceItem.purchase_invoice_id,
                    PurchaseInvoiceItem.item_nature,
                    PurchaseInvoiceItem.product_code,
                    PurchaseInvoiceItem.product_name,
                    PurchaseInvoiceItem.unit_name,
                    PurchaseInvoiceItem.quantity,
                    PurchaseInvoiceItem.unit_price,
                    PurchaseInvoiceItem.amount_before_tax,
                ).where(
                    PurchaseInvoiceItem.purchase_invoice_id.in_(batch_ids),
                    func.upper(func.trim(PurchaseInvoiceItem.product_code)) == target_sku,
                )
            ).all()
            for p_inv_id, item_nature, _p_code, p_name, u_name, qty_raw, price_raw, amt_raw in item_rows:
                if item_nature in NON_STOCK_ITEM_NATURES:
                    continue
                hdr = matched_purch[p_inv_id]
                tx_date = _to_date(hdr[7])
                qty_dec = _to_dec(qty_raw)
                if from_date is not None and tx_date is not None and tx_date < from_date:
                    opening_qty += qty_dec
                    continue
                events.append(
                    {
                        "tx_date": tx_date.isoformat() if tx_date else "",
                        "sort_date": tx_date or date.min,
                        "sort_order": 0,
                        "doc_type": "INPUT",
                        "status": "CQT",
                        "invoice_symbol": hdr[8] or "",
                        "invoice_number": hdr[2] or "",
                        "partner_tax_code": hdr[1] or "",
                        "partner_name": hdr[9] or "",
                        "unit_name": u_name or "",
                        "qty_in": qty_dec,
                        "qty_out": ZERO,
                        "unit_price": _q_amt(_to_dec(price_raw)),
                        "amount": _q_amt(_to_dec(amt_raw)),
                        "note": p_name or "",
                    }
                )

    # 2. Lấy chứng từ đầu ra / điều chỉnh
    issued_stmt = (
        select(
            IssuedInvoice.id,
            IssuedInvoice.seller_tax_code,
            IssuedInvoice.distributor_id,
            IssuedInvoice.status,
            IssuedInvoice.invoice_type,
            IssuedInvoice.invoice_series,
            IssuedInvoice.invoice_number,
            IssuedInvoice.buyer_tax_code,
            IssuedInvoice.buyer_name,
            IssuedInvoice.issued_at,
            IssuedInvoice.created_at,
            IssuedInvoice.note,
            IssuedInvoiceItem.item_type,
            IssuedInvoiceItem.source_sku,
            IssuedInvoiceItem.product_code,
            IssuedInvoiceItem.source_unit,
            IssuedInvoiceItem.unit_name,
            IssuedInvoiceItem.source_quantity,
            IssuedInvoiceItem.quantity,
            IssuedInvoiceItem.unit_price,
            IssuedInvoiceItem.amount_before_tax,
        )
        .join(IssuedInvoiceItem, IssuedInvoiceItem.invoice_id == IssuedInvoice.id)
        .where(IssuedInvoice.status.notin_(("CANCELLED", "REPLACED")))
    )
    if distributor_id is not None:
        issued_stmt = issued_stmt.where(IssuedInvoice.distributor_id == distributor_id)

    for row in db.execute(issued_stmt).all():
        mst = (row[1] or dist_mst_by_id.get(row[2]) or "").strip()
        if mst != target_mst:
            continue
        if (row[12] or "NORMAL").upper() not in ("NORMAL", "PROMOTION", "ADJUSTMENT"):
            continue
        item_sku = (row[13] or row[14] or "").strip().upper()
        if item_sku != target_sku:
            continue
        is_draft = (row[3] or "").upper() == "DRAFT"
        if is_draft and not include_draft:
            continue
        tx_date = _to_date(row[9] or row[10])
        if to_date is not None and tx_date is not None and tx_date > to_date:
            continue
        if opening_as_of is not None and tx_date is not None and tx_date < opening_as_of:
            continue
        qty_dec = _to_dec(row[17]) if row[17] is not None else _to_dec(row[18])
        if from_date is not None and tx_date is not None and tx_date < from_date:
            opening_qty -= qty_dec
            continue
        inv_type = (row[4] or "ORIGINAL").upper()
        doc_type = "ADJUSTMENT" if inv_type == "ADJUSTMENT" else ("DRAFT" if is_draft else "OUTPUT")
        events.append(
            {
                "tx_date": tx_date.isoformat() if tx_date else "",
                "sort_date": tx_date or date.min,
                "sort_order": 1,
                "doc_type": doc_type,
                "status": row[3] or "",
                "invoice_symbol": row[5] or "",
                "invoice_number": row[6] or f"NHÁP #{row[0]}",
                "partner_tax_code": row[7] or "",
                "partner_name": row[8] or "",
                "unit_name": row[15] or row[16] or "",
                "qty_in": ZERO,
                "qty_out": qty_dec,
                "unit_price": _q_amt(_to_dec(row[19])),
                "amount": _q_amt(_to_dec(row[20])),
                "note": row[11] or "",
            }
        )

    events.sort(key=lambda e: (e["sort_date"], e["sort_order"], e["invoice_number"]))

    running = opening_qty
    entries: list[dict[str, Any]] = []
    for ev in events:
        running = running + ev["qty_in"] - ev["qty_out"]
        entries.append(
            {
                "tx_date": ev["tx_date"],
                "doc_type": ev["doc_type"],
                "status": ev["status"],
                "invoice_symbol": ev["invoice_symbol"],
                "invoice_number": ev["invoice_number"],
                "partner_tax_code": ev["partner_tax_code"],
                "partner_name": ev["partner_name"],
                "unit_name": ev["unit_name"],
                "qty_in": _q_qty(ev["qty_in"]),
                "qty_out": _q_qty(ev["qty_out"]),
                "unit_price": ev["unit_price"],
                "amount": ev["amount"],
                "running_balance": _q_qty(running),
                "is_negative_point": running < -EPSILON,
                "note": ev["note"],
            }
        )

    return {
        "tax_code": target_mst,
        "sku": target_sku,
        "opening_as_of_date": opening_as_of.isoformat() if opening_as_of else None,
        "opening_qty": _q_qty(opening_qty),
        "closing_qty": _q_qty(running),
        "entries": entries,
    }


# ==============================================================================
# QUẢN LÝ TỒN ĐẦU KỲ (TK 156) THEO (MST, SKU)
# ==============================================================================

def list_opening_balances(
    db: Session,
    *,
    distributor_id: int | None = None,
    tax_code: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    stmt = select(TaxInventoryOpeningBalance).order_by(
        TaxInventoryOpeningBalance.as_of_date.desc(),
        TaxInventoryOpeningBalance.tax_code.asc(),
        TaxInventoryOpeningBalance.sku.asc(),
    )
    if distributor_id is not None:
        stmt = stmt.where(
            (TaxInventoryOpeningBalance.distributor_id == distributor_id)
            | (TaxInventoryOpeningBalance.distributor_id.is_(None))
        )
    if tax_code and tax_code.strip():
        stmt = stmt.where(TaxInventoryOpeningBalance.tax_code == tax_code.strip())
    rows = db.scalars(stmt).all()
    q = (search or "").strip().lower()
    out: list[dict[str, Any]] = []
    for r in rows:
        if q and not (
            q in (r.sku or "").lower()
            or q in (r.product_name or "").lower()
            or q in (r.tax_code or "").lower()
        ):
            continue
        out.append(
            {
                "id": r.id,
                "distributor_id": r.distributor_id,
                "tax_code": r.tax_code,
                "sku": r.sku,
                "product_name": r.product_name or "",
                "unit_name": r.unit_name or "",
                "as_of_date": r.as_of_date.isoformat(),
                "opening_qty": float(r.opening_qty or 0),
                "opening_amount": float(r.opening_amount or 0),
                "note": r.note or "",
                "updated_by": r.updated_by or "",
            }
        )
    return out


def upsert_opening_balance(
    db: Session,
    *,
    distributor_id: int | None,
    tax_code: str,
    sku: str,
    as_of_date: date,
    opening_qty: float,
    opening_amount: float = 0.0,
    product_name: str | None = None,
    unit_name: str | None = None,
    note: str | None = None,
    updated_by: str | None = None,
    commit: bool = True,
) -> TaxInventoryOpeningBalance:
    clean_mst = (tax_code or "").strip()
    clean_sku = (sku or "").strip().upper()
    if not clean_mst or not clean_sku:
        raise ValueError("MST pháp nhân và Mã SKU không được để trống.")

    existing = db.scalar(
        select(TaxInventoryOpeningBalance).where(
            TaxInventoryOpeningBalance.distributor_id == distributor_id,
            TaxInventoryOpeningBalance.tax_code == clean_mst,
            TaxInventoryOpeningBalance.sku == clean_sku,
            TaxInventoryOpeningBalance.as_of_date == as_of_date,
        )
    )
    if existing is None:
        existing = TaxInventoryOpeningBalance(
            distributor_id=distributor_id,
            tax_code=clean_mst,
            sku=clean_sku,
            as_of_date=as_of_date,
            opening_qty=_q_qty(_to_dec(opening_qty)),
            opening_amount=_q_amt(_to_dec(opening_amount)),
            product_name=(product_name or "").strip() or None,
            unit_name=(unit_name or "").strip() or None,
            note=(note or "").strip()[:300] or None,
            updated_by=updated_by or "ADMIN",
        )
        db.add(existing)
    else:
        existing.opening_qty = _q_qty(_to_dec(opening_qty))
        existing.opening_amount = _q_amt(_to_dec(opening_amount))
        if product_name and product_name.strip():
            existing.product_name = product_name.strip()
        if unit_name and unit_name.strip():
            existing.unit_name = unit_name.strip()
        if note is not None:
            existing.note = note.strip()[:300] or None
        existing.updated_by = updated_by or existing.updated_by
    if commit:
        db.commit()
        db.refresh(existing)
    return existing


def build_opening_balance_template_excel() -> BytesIO:
    wb = Workbook()
    ws = wb.active
    ws.title = "Ton_Dau_Ky_MST"
    headers = [
        "MST Pháp nhân (*)",
        "Mã SKU CQT (*)",
        "Tên hàng hóa",
        "ĐVT",
        "Ngày chốt (YYYY-MM-DD) (*)",
        "SL tồn đầu kỳ (*)",
        "Giá trị đầu kỳ TK 156 (VND)",
        "Ghi chú",
    ]
    ws.append(headers)
    header_fill = PatternFill("solid", fgColor="14263D")
    header_font = Font(bold=True, color="FFFFFF", size=10)
    for idx in range(1, len(headers) + 1):
        c = ws.cell(row=1, column=idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center")
    ws.append(["2900000001", "SKU01", "Sữa tươi tiệt trùng 180ml", "THUNG", "2026-01-01", 100, 20000000, "Chuyển số dư BCTC 2025"])
    for idx, w in enumerate([18, 18, 32, 10, 24, 18, 24, 28], start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = w
    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def import_opening_balances_excel(
    db: Session,
    *,
    file_bytes: bytes,
    distributor_id: int | None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    wb = load_workbook(BytesIO(file_bytes), data_only=True)
    ws = wb.active
    imported = 0
    errors: list[str] = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row or all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        mst = str(row[0] or "").strip()
        sku = str(row[1] or "").strip().upper()
        pname = str(row[2] or "").strip() if len(row) > 2 else ""
        uname = str(row[3] or "").strip() if len(row) > 3 else ""
        raw_date = row[4] if len(row) > 4 else None
        raw_qty = row[5] if len(row) > 5 else 0
        raw_amt = row[6] if len(row) > 6 else 0
        note = str(row[7] or "").strip() if len(row) > 7 else ""

        if not mst or not sku:
            errors.append(f"Dòng {row_idx}: Thiếu MST hoặc Mã SKU.")
            continue

        parsed_date: date | None = None
        if isinstance(raw_date, datetime):
            parsed_date = raw_date.date()
        elif isinstance(raw_date, date):
            parsed_date = raw_date
        elif raw_date:
            text_d = str(raw_date).strip()
            for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
                try:
                    parsed_date = datetime.strptime(text_d, fmt).date()
                    break
                except ValueError:
                    continue
        if parsed_date is None:
            errors.append(f"Dòng {row_idx}: Ngày chốt không hợp lệ ({raw_date}).")
            continue

        upsert_opening_balance(
            db,
            distributor_id=distributor_id,
            tax_code=mst,
            sku=sku,
            as_of_date=parsed_date,
            opening_qty=float(_to_dec(raw_qty)),
            opening_amount=float(_to_dec(raw_amt)),
            product_name=pname,
            unit_name=uname,
            note=note,
            updated_by=updated_by,
            commit=False,
        )
        imported += 1

    db.commit()
    return {"imported": imported, "errors": errors[:50]}


# ==============================================================================
# XỬ LÝ DÒNG HÀNG MUA VÀO THIẾU MÃ SKU (MHHDVu TRỐNG)
# ==============================================================================

def list_unmapped_purchase_items(
    db: Session,
    *,
    distributor_id: int | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    purch_hdr_stmt = select(
        PurchaseInvoice.id,
        PurchaseInvoice.seller_tax_code,
        PurchaseInvoice.invoice_number,
        PurchaseInvoice.replaced_invoice_number,
        PurchaseInvoice.raw_metadata,
        PurchaseInvoice.buyer_tax_code,
        PurchaseInvoice.invoice_symbol,
        PurchaseInvoice.invoice_date,
        PurchaseInvoice.seller_name,
    )
    if distributor_id is not None:
        purch_hdr_stmt = purch_hdr_stmt.where(PurchaseInvoice.distributor_id == distributor_id)
    purch_headers = list(db.execute(purch_hdr_stmt).all())
    excluded_ids = _build_excluded_purchase_invoice_ids(purch_headers)
    hdr_by_id = {r[0]: r for r in purch_headers if r[0] not in excluded_ids}
    if not hdr_by_id:
        return []

    stmt = (
        select(
            PurchaseInvoiceItem.id,
            PurchaseInvoiceItem.purchase_invoice_id,
            PurchaseInvoiceItem.item_nature,
            PurchaseInvoiceItem.product_name,
            PurchaseInvoiceItem.unit_name,
            PurchaseInvoiceItem.quantity,
            PurchaseInvoiceItem.unit_price,
            PurchaseInvoiceItem.amount_before_tax,
        )
        .where(
            PurchaseInvoiceItem.purchase_invoice_id.in_(list(hdr_by_id.keys())),
            (PurchaseInvoiceItem.product_code.is_(None))
            | (func.trim(PurchaseInvoiceItem.product_code) == ""),
        )
        .order_by(PurchaseInvoiceItem.id.desc())
        .limit(limit)
    )
    items: list[dict[str, Any]] = []
    for item_id, inv_id, item_nature, p_name, u_name, qty, price, amt in db.execute(stmt).all():
        if item_nature in NON_STOCK_ITEM_NATURES:
            continue
        hdr = hdr_by_id[inv_id]
        items.append(
            {
                "id": item_id,
                "purchase_invoice_id": inv_id,
                "invoice_date": _to_date(hdr[7]).isoformat() if hdr[7] else "",
                "invoice_symbol": hdr[6] or "",
                "invoice_number": hdr[2] or "",
                "buyer_tax_code": hdr[5] or "",
                "seller_tax_code": hdr[1] or "",
                "seller_name": hdr[8] or "",
                "product_name": p_name or "",
                "unit_name": u_name or "",
                "quantity": float(qty or 0),
                "unit_price": float(price or 0),
                "amount_before_tax": float(amt or 0),
            }
        )
    return items


def map_unmapped_purchase_item_sku(
    db: Session,
    *,
    item_id: int,
    sku: str,
    distributor_id: int | None = None,
    apply_same_name: bool = True,
) -> dict[str, Any]:
    clean_sku = (sku or "").strip().upper()
    if not clean_sku:
        raise ValueError("Mã SKU ánh xạ không được để trống.")

    target = db.get(PurchaseInvoiceItem, item_id)
    if target is None:
        raise ValueError("Không tìm thấy dòng hàng mua vào.")
    parent_inv = db.get(PurchaseInvoice, target.purchase_invoice_id)
    if distributor_id is not None and parent_inv and parent_inv.distributor_id != distributor_id:
        raise ValueError("Bạn không có quyền thao tác dòng hàng của Nhà phân phối khác.")

    updated_count = 0
    if apply_same_name and (target.product_name or "").strip():
        same_name_stmt = (
            select(PurchaseInvoiceItem)
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceItem.purchase_invoice_id)
            .where(
                PurchaseInvoiceItem.product_name == target.product_name,
                (PurchaseInvoiceItem.product_code.is_(None))
                | (func.trim(PurchaseInvoiceItem.product_code) == ""),
            )
        )
        if distributor_id is not None:
            same_name_stmt = same_name_stmt.where(PurchaseInvoice.distributor_id == distributor_id)
        for row in db.scalars(same_name_stmt).all():
            if row.item_nature in NON_STOCK_ITEM_NATURES:
                continue
            row.product_code = clean_sku
            updated_count += 1
    else:
        target.product_code = clean_sku
        updated_count = 1

    db.commit()
    return {"ok": True, "sku": clean_sku, "updated_count": updated_count}


# ==============================================================================
# XUẤT EXCEL SỔ N-X-T THUẾ (CHUẨN TK 156 & TK 632)
# ==============================================================================

def export_tax_inventory_excel(data: dict[str, Any]) -> BytesIO:
    """Xuất Sổ Nhập – Xuất – Tồn Thuế theo MST ra file Excel (.xlsx) chuẩn kế toán (có Giá vốn & TK 156)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "So_NXT_Thue_MST"

    header_fill = PatternFill("solid", fgColor="14263D")
    header_font = Font(bold=True, color="FFFFFF", size=10)
    bold_font = Font(bold=True, size=10)
    red_font = Font(bold=True, color="B91C1C", size=10)
    amber_font = Font(bold=True, color="B45309", size=10)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    headers = [
        "STT",
        "MST Pháp nhân",
        "Tên Công ty quản lý",
        "Mã SKU (CQT)",
        "Tên hàng hóa",
        "ĐVT",
        "VAT (%)",
        "Tồn đầu kỳ (SL)",
        "Giá trị đầu kỳ TK 156",
        "Nhập CQT (SL)",
        "Giá trị Nhập (VND)",
        "Xuất HĐĐT (SL)",
        "Doanh thu Xuất (VND)",
        "Đơn giá vốn BQ",
        "Giá vốn xuất (TK 632)",
        "Tồn cuối kỳ (SL)",
        "Trị giá tồn cuối kỳ (TK 156)",
        "Trạng thái",
        "Cảnh báo thanh tra thuế",
    ]
    ws.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
    ws.row_dimensions[1].height = 26

    items = data.get("items", [])
    tot_open_amt = 0.0
    tot_in_amt = 0.0
    tot_out_amt = 0.0
    tot_cogs_amt = 0.0
    tot_end_val = 0.0

    for idx, r in enumerate(items, start=1):
        status_label = (
            "Âm kho thuế"
            if r["status"] == "NEGATIVE"
            else ("Tồn thấp" if r["status"] == "LOW" else "Đủ đầu vào")
        )
        vat_str = "" if r.get("vat_rate") is None else ("KCT" if r["vat_rate"] < 0 else r["vat_rate"])
        warns: list[str] = []
        if r.get("has_chronological_negative"):
            warns.append(f"Âm thời điểm ({r['min_running_balance']})")
        if r.get("is_below_cost"):
            warns.append(f"Bán dưới giá vốn (Bán {r['avg_sale_price']:,.0f} < Vốn {r['avg_unit_cost']:,.0f})")

        row_vals = [
            idx,
            r["tax_code"],
            r["company_name"],
            r["sku"],
            r["product_name"],
            r["unit_name"],
            vat_str,
            r.get("opening_qty", 0),
            r.get("opening_amount", 0),
            r["input_qty"],
            r["input_amount"],
            r["output_qty"],
            r["output_amount"],
            r.get("avg_unit_cost", 0),
            r.get("cogs_amount", 0),
            r["balance_qty"],
            r.get("ending_inventory_value", 0),
            status_label,
            " | ".join(warns),
        ]
        ws.append(row_vals)
        tot_open_amt += float(r.get("opening_amount") or 0)
        tot_in_amt += float(r.get("input_amount") or 0)
        tot_out_amt += float(r.get("output_amount") or 0)
        tot_cogs_amt += float(r.get("cogs_amount") or 0)
        tot_end_val += float(r.get("ending_inventory_value") or 0)

        row_num = idx + 1
        for c_i in range(1, len(headers) + 1):
            c = ws.cell(row=row_num, column=c_i)
            c.border = thin_border
            if c_i in (8, 9, 10, 11, 12, 13, 14, 15, 16, 17):
                c.number_format = "#,##0.##"
                c.alignment = Alignment(horizontal="right")
            if c_i == 16:
                if r["status"] == "NEGATIVE":
                    c.font = red_font
                elif r["status"] == "LOW":
                    c.font = amber_font

    tot_row = len(items) + 2
    ws.cell(row=tot_row, column=1, value="TỔNG CỘNG").font = bold_font
    for col_idx, val in [
        (9, tot_open_amt),
        (11, tot_in_amt),
        (13, tot_out_amt),
        (15, tot_cogs_amt),
        (17, tot_end_val),
    ]:
        cell = ws.cell(row=tot_row, column=col_idx, value=round(val, 2))
        cell.font = bold_font
        cell.number_format = "#,##0"
    for c_i in range(1, len(headers) + 1):
        ws.cell(row=tot_row, column=c_i).border = thin_border

    widths = [6, 16, 26, 15, 34, 9, 8, 13, 18, 13, 18, 13, 18, 15, 18, 13, 20, 14, 30]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def create_adjustment_or_replacement_invoice(
    db: Session,
    *,
    parent_invoice: IssuedInvoice,
    mode: str,
    reason: str,
    items_payload: list[dict[str, Any]],
    return_reference: str | None = None,
    issued_by: str | None = None,
) -> IssuedInvoice:
    """Tạo Hóa đơn Điều chỉnh giảm (ADJUSTMENT) hoặc Thay thế (REPLACEMENT) theo NĐ 123 / TT 78."""
    clean_mode = (mode or "ADJUSTMENT").strip().upper()
    if clean_mode not in ("ADJUSTMENT", "REPLACEMENT"):
        raise ValueError("Chế độ chỉ hỗ trợ 'ADJUSTMENT' (Điều chỉnh) hoặc 'REPLACEMENT' (Thay thế).")
    if parent_invoice.status in ("CANCELLED", "REPLACED"):
        raise ValueError(f"Hóa đơn gốc đang ở trạng thái {parent_invoice.status}, không thể lập điều chỉnh/thay thế.")
    if not reason or not reason.strip():
        raise ValueError("Vui lòng nhập lý do điều chỉnh / thay thế hóa đơn theo quy định NĐ 123.")
    if not items_payload:
        raise ValueError("Danh sách dòng hàng điều chỉnh / thay thế không được để trống.")

    parent_items_by_id = {it.id: it for it in parent_invoice.items}
    parent_items_by_code = {(it.product_code or "").strip().upper(): it for it in parent_invoice.items}

    already_adjusted_by_code: dict[str, Decimal] = {}
    if clean_mode == "ADJUSTMENT":
        prev_adj_rows = db.execute(
            select(IssuedInvoiceItem.product_code, IssuedInvoiceItem.quantity)
            .join(IssuedInvoice, IssuedInvoice.id == IssuedInvoiceItem.invoice_id)
            .where(
                IssuedInvoice.parent_invoice_id == parent_invoice.id,
                IssuedInvoice.invoice_type == "ADJUSTMENT",
                IssuedInvoice.status != "CANCELLED",
            )
        ).all()
        for p_code, p_qty in prev_adj_rows:
            key = (p_code or "").strip().upper()
            already_adjusted_by_code[key] = already_adjusted_by_code.get(key, ZERO) + abs(_to_dec(p_qty))

    subtotal = ZERO
    total_vat = ZERO
    total_payment = ZERO
    new_items: list[IssuedInvoiceItem] = []

    for idx, row in enumerate(items_payload, start=1):
        parent_it = (
            parent_items_by_id.get(row.get("parent_item_id"))
            if row.get("parent_item_id") is not None
            else parent_items_by_code.get(str(row.get("product_code") or "").strip().upper())
        )
        raw_qty = _to_dec(row.get("quantity"))
        if clean_mode == "ADJUSTMENT":
            abs_qty = abs(raw_qty)
            if abs_qty == ZERO:
                continue
            if parent_it is not None:
                code_key = (parent_it.product_code or "").strip().upper()
                orig_qty = abs(_to_dec(parent_it.quantity))
                prev_adj = already_adjusted_by_code.get(code_key, ZERO)
                remaining = orig_qty - prev_adj
                if abs_qty > remaining + EPSILON:
                    raise ValueError(
                        f"SKU {code_key}: SL điều chỉnh giảm ({_q_qty(abs_qty)}) vượt quá SL còn lại có thể điều chỉnh ({_q_qty(remaining)} / gốc {_q_qty(orig_qty)})."
                    )
                already_adjusted_by_code[code_key] = prev_adj + abs_qty
            qty = -abs_qty
        else:
            qty = max(ZERO, raw_qty)
            if qty == ZERO:
                continue

        unit_price = _to_dec(
            row.get("unit_price")
            if row.get("unit_price") is not None
            else (parent_it.unit_price if parent_it else ZERO)
        )
        vat_rate = _to_dec(
            row.get("vat_rate")
            if row.get("vat_rate") is not None
            else (parent_it.vat_rate if parent_it else parent_invoice.vat_rate)
        )
        amt_before_tax = (
            _to_dec(row["amount_before_tax"])
            if row.get("amount_before_tax") is not None
            else (qty * unit_price).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)
        )
        if clean_mode == "ADJUSTMENT" and amt_before_tax > ZERO:
            amt_before_tax = -amt_before_tax
        vat_amt = (amt_before_tax * vat_rate / Decimal("100")).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)
        line_total = (amt_before_tax + vat_amt).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)

        src_sku = (
            row.get("source_sku")
            or (parent_it.source_sku if parent_it else None)
            or (parent_it.product_code if parent_it else row.get("product_code"))
        )
        src_unit = row.get("source_unit") or (parent_it.source_unit if parent_it else None) or row.get("unit_name")
        conv_ratio = parent_it.conversion_ratio if parent_it else None
        src_qty = qty
        if parent_it and parent_it.quantity and parent_it.source_quantity:
            ratio = _to_dec(parent_it.source_quantity) / _to_dec(parent_it.quantity)
            src_qty = (qty * ratio).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)

        new_items.append(
            IssuedInvoiceItem(
                line_number=idx,
                item_type="ADJUSTMENT" if clean_mode == "ADJUSTMENT" else "NORMAL",
                product_code=str(row.get("product_code") or (parent_it.product_code if parent_it else "")),
                product_name=str(row.get("product_name") or (parent_it.product_name if parent_it else "")),
                unit_name=str(row.get("unit_name") or (parent_it.unit_name if parent_it else "Hộp")),
                quantity=_q_qty(qty),
                unit_price=_q_amt(abs(unit_price)),
                discount_rate=0.0,
                discount_amount=0.0,
                amount_before_tax=_q_amt(amt_before_tax),
                vat_rate=float(vat_rate),
                vat_amount=_q_amt(vat_amt),
                total_amount=_q_amt(line_total),
                source_order_number=return_reference or (parent_it.source_order_number if parent_it else None),
                source_sku=str(src_sku) if src_sku else None,
                source_quantity=_q_qty(src_qty),
                source_unit=str(src_unit) if src_unit else None,
                conversion_ratio=conv_ratio,
            )
        )
        subtotal += amt_before_tax
        total_vat += vat_amt
        total_payment += line_total

    if not new_items:
        raise ValueError("Không có dòng hàng hợp lệ (số lượng khác 0) để lập hóa đơn.")

    prefix_note = (
        f"Điều chỉnh giảm cho HĐ số {parent_invoice.invoice_number or parent_invoice.id}"
        if clean_mode == "ADJUSTMENT"
        else f"Thay thế cho HĐ số {parent_invoice.invoice_number or parent_invoice.id}"
    )
    full_note = f"{prefix_note} | Lý do: {reason.strip()}"
    if return_reference:
        full_note += f" | Phiếu trả hàng: {return_reference.strip()}"

    new_inv = IssuedInvoice(
        distributor_id=parent_invoice.distributor_id,
        invoice_config_id=parent_invoice.invoice_config_id,
        seller_company_id=parent_invoice.seller_company_id,
        seller_tax_code=parent_invoice.seller_tax_code,
        provider=parent_invoice.provider,
        invoice_template_code=parent_invoice.invoice_template_code,
        invoice_series=parent_invoice.invoice_series,
        invoice_number=None,
        status="DRAFT",
        invoice_type=clean_mode,
        parent_invoice_id=parent_invoice.id,
        adjustment_reason=reason.strip()[:500],
        return_reference=(return_reference or "").strip()[:120] or None,
        supplier_code=parent_invoice.supplier_code,
        source_order_numbers=list(parent_invoice.source_order_numbers or []),
        buyer_code=parent_invoice.buyer_code,
        buyer_name=parent_invoice.buyer_name,
        buyer_legal_name=parent_invoice.buyer_legal_name,
        buyer_tax_code=parent_invoice.buyer_tax_code,
        buyer_address=parent_invoice.buyer_address,
        buyer_email=parent_invoice.buyer_email,
        payment_method=parent_invoice.payment_method,
        subtotal_before_tax=_q_amt(subtotal),
        discount_amount=0.0,
        vat_rate=parent_invoice.vat_rate,
        vat_amount=_q_amt(total_vat),
        total_payment=_q_amt(total_payment),
        note=full_note,
        issued_by=issued_by or "SYSTEM",
        issued_at=datetime.utcnow(),
        items=new_items,
    )
    db.add(new_inv)

    parent_invoice.status = "ADJUSTED" if clean_mode == "ADJUSTMENT" else "REPLACED"
    db.commit()
    db.refresh(new_inv)
    return new_inv
