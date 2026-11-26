from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Company
from app.models.multi_tenant_invoice import (
    Distributor,
    IssuedInvoice,
    IssuedInvoiceItem,
    PurchaseInvoice,
    PurchaseInvoiceItem,
    TaxAuthorityCredential,
    TaxInventoryMonthlySnapshot,
    TaxInventoryOpeningBalance,
)
from app.models.product import (
    DistributorProduct,
    InvoiceProduct,
    Product,
    ProductCompany,
    ProductGroup,
    ProductGroupItem,
)

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
    """Nạp số dư tồn đầu kỳ hiệu lực mới nhất (as_of_date <= to_date) cho từng cặp (MST, SKU).
    Khi một MST đã chốt kỳ mới (as_of_date = D mới nhất), chỉ giữ số dư của kỳ D đó
    (các SKU không có trong kỳ D coi như tồn đầu kỳ = 0 và không lấy lại số dư kỳ cũ)."""
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

    rows = db.execute(stmt).all()
    latest_as_of_by_mst: dict[str, date] = {}
    for mst_raw, sku_raw, _p_name, _u_name, as_of, _o_qty, _o_amt in rows:
        mst = (mst_raw or "").strip()
        sku = (sku_raw or "").strip().upper()
        if not mst or not sku or as_of is None:
            continue
        prev = latest_as_of_by_mst.get(mst)
        if prev is None or as_of > prev:
            latest_as_of_by_mst[mst] = as_of

    result: dict[tuple[str, str], dict[str, Any]] = {}
    for mst_raw, sku_raw, p_name, u_name, as_of, o_qty, o_amt in rows:
        mst = (mst_raw or "").strip()
        sku = (sku_raw or "").strip().upper()
        if not mst or not sku:
            continue
        latest_mst_date = latest_as_of_by_mst.get(mst)
        if latest_mst_date is not None and as_of != latest_mst_date:
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


def _build_mst_cutoff_dates(opening_map: dict[tuple[str, str], dict[str, Any]]) -> dict[str, date]:
    """Mốc ngày bắt đầu kỳ (cutoff date) của từng MST = as_of_date mới nhất đã chốt tồn đầu kỳ.
    Mọi hóa đơn trước ngày này của MST đó đều bị cắt bỏ (kể cả SKU tồn đầu kỳ = 0 không upload)."""
    cutoffs: dict[str, date] = {}
    for (mst, _sku), ob in opening_map.items():
        as_of = ob.get("as_of_date")
        if as_of is not None:
            prev = cutoffs.get(mst)
            if prev is None or as_of > prev:
                cutoffs[mst] = as_of
    return cutoffs


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
    group_by: str = "MST_SKU",
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
    comp_stmt = select(Company.id, Company.tax_code, Company.short_name, Company.name)
    if distributor_id is not None:
        comp_stmt = comp_stmt.where(Company.distributor_id == distributor_id)
    company_name_by_mst: dict[str, str] = {}
    company_by_id: dict[int, tuple[str, str]] = {}
    for c_id, tax_code, short_name, full_name in db.execute(comp_stmt).all():
        mst = (tax_code or "").strip()
        cname = (short_name or full_name or "").strip()
        if c_id:
            company_by_id[int(c_id)] = (mst, cname)
        if mst and mst not in company_name_by_mst:
            company_name_by_mst[mst] = cname or f"MST {mst}"

    dist_mst_by_id: dict[int, str] = {}
    for d_id, d_mst in db.execute(select(Distributor.id, Distributor.tax_code)).all():
        if d_mst:
            dist_mst_by_id[d_id] = d_mst.strip()

    # 1b. Nạp Danh mục SP xuất hóa đơn (Single Source of Truth) & bảng ánh xạ SKU CQT / Mã DMS -> SP xuất HĐ
    ip_stmt = select(InvoiceProduct)
    if distributor_id is not None:
        ip_stmt = ip_stmt.where(
            (InvoiceProduct.distributor_id == distributor_id)
            | (InvoiceProduct.distributor_id.is_(None))
        )
    ip_by_id: dict[int, InvoiceProduct] = {}
    ip_by_code: dict[str, InvoiceProduct] = {}
    for ip in db.scalars(ip_stmt).all():
        ip_by_id[ip.id] = ip
        code_u = (ip.code or "").strip().upper()
        if code_u and (code_u not in ip_by_code or (distributor_id is not None and ip.distributor_id == distributor_id)):
            ip_by_code[code_u] = ip

    cqt_sku_to_ip: dict[str, InvoiceProduct] = {}
    for p_sku, p_ip_id in db.execute(
        select(Product.sku, Product.invoice_product_id).where(Product.invoice_product_id.is_not(None))
    ).all():
        if p_sku and p_ip_id in ip_by_id:
            cqt_sku_to_ip[p_sku.strip().upper()] = ip_by_id[p_ip_id]

    # Ánh xạ ưu tiên theo từng cặp (MST đầu vào, SKU CQT) -> Sản phẩm xuất hóa đơn
    cqt_mst_sku_to_ip: dict[tuple[str, str], InvoiceProduct] = {}
    for pc_mst, p_sku, pc_ip_id in db.execute(
        select(Company.tax_code, Product.sku, ProductCompany.invoice_product_id)
        .join(Product, Product.id == ProductCompany.product_id)
        .join(Company, Company.id == ProductCompany.company_id)
        .where(ProductCompany.invoice_product_id.is_not(None))
    ).all():
        clean_mst = (pc_mst or "").strip()
        clean_sku = (p_sku or "").strip().upper()
        if clean_mst and clean_sku and pc_ip_id in ip_by_id:
            cqt_mst_sku_to_ip[(clean_mst, clean_sku)] = ip_by_id[pc_ip_id]

    dms_sku_to_ip: dict[str, InvoiceProduct] = {}
    dp_ip_stmt = select(DistributorProduct.distributor_sku, DistributorProduct.invoice_product_id).where(
        DistributorProduct.invoice_product_id.is_not(None)
    )
    if distributor_id is not None:
        dp_ip_stmt = dp_ip_stmt.where(
            (DistributorProduct.distributor_id == distributor_id)
            | (DistributorProduct.distributor_id.is_(None))
        )
    for d_sku, d_ip_id in db.execute(dp_ip_stmt).all():
        if d_sku and d_ip_id in ip_by_id:
            dms_sku_to_ip[d_sku.strip().upper()] = ip_by_id[d_ip_id]

    def _resolve_to_invoice_product(
        raw_code: str,
        mst: str | None = None,
        *,
        prefer_cqt_mst: bool = False,
    ) -> tuple[str, InvoiceProduct | None]:
        clean = (raw_code or "").strip().upper()
        if not clean:
            return "", None
        clean_mst = (mst or "").strip()
        mst_ip = cqt_mst_sku_to_ip.get((clean_mst, clean)) if clean_mst else None
        if prefer_cqt_mst and mst_ip is not None:
            return mst_ip.code.strip().upper(), mst_ip
        ip = ip_by_code.get(clean) or mst_ip or cqt_sku_to_ip.get(clean) or dms_sku_to_ip.get(clean)
        if ip is not None:
            return ip.code.strip().upper(), ip
        return clean, None

    # 1c. Nạp Số dư Tồn đầu kỳ (TK 156) & mốc cắt sổ (cutoff date) theo từng MST
    raw_opening_map = _load_effective_opening_balances(
        db,
        distributor_id=distributor_id,
        to_date=to_date,
    )
    mst_cutoffs = _build_mst_cutoff_dates(raw_opening_map)
    # Quy đổi số dư đầu kỳ về Mã SP xuất hóa đơn (nếu bản ghi cũ nhập theo SKU CQT đã gán)
    opening_map: dict[tuple[str, str], dict[str, Any]] = {}
    for (mst, raw_sku), ob in raw_opening_map.items():
        eff_code, ip = _resolve_to_invoice_product(raw_sku, mst=mst, prefer_cqt_mst=True)
        key = (mst, eff_code)
        if key not in opening_map:
            opening_map[key] = {
                "as_of_date": ob["as_of_date"],
                "opening_qty": ob["opening_qty"],
                "opening_amount": ob["opening_amount"],
                "product_name": (ip.name if ip else ob["product_name"]),
                "unit_name": (ip.unit_name if ip else ob["unit_name"]),
            }
        else:
            opening_map[key]["opening_qty"] += ob["opening_qty"]
            opening_map[key]["opening_amount"] += ob["opening_amount"]

    ledger: dict[tuple[str, str], dict[str, Any]] = {}
    daily_deltas: dict[tuple[str, str], dict[date, Decimal]] = {}
    monthly_buckets: dict[tuple[str, str], dict[tuple[int, int], dict[str, Decimal]]] = {}
    unmapped_sku_items_count = 0

    def _get_or_init_rec(
        mst: str,
        sku: str,
        pname: str,
        uname: str,
        *,
        ip: InvoiceProduct | None = None,
        raw_cqt_sku: str | None = None,
    ) -> dict[str, Any]:
        key = (mst, sku)
        rec = ledger.get(key)
        if rec is None:
            ob = opening_map.get(key)
            rec = {
                "tax_code": mst,
                "company_name": company_name_by_mst.get(mst, f"MST {mst}"),
                "sku": sku,
                "invoice_product_id": ip.id if ip else None,
                "has_invoice_product": ip is not None,
                "invoice_product_vat_rate": ip.vat_rate if ip else None,
                "cqt_skus": set(),
                "product_name": (ip.name if ip else None) or pname or (ob["product_name"] if ob else ""),
                "unit_name": (ip.unit_name if ip else None) or uname or (ob["unit_name"] if ob else ""),
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
                "promo_in_qty": ZERO,
                "promo_out_qty": ZERO,
                "official_output_qty": ZERO,
                "draft_output_qty": ZERO,
                "adjustment_qty": ZERO,
            }
            ledger[key] = rec
        else:
            if ip is not None and not rec["has_invoice_product"]:
                rec["invoice_product_id"] = ip.id
                rec["has_invoice_product"] = True
                rec["invoice_product_vat_rate"] = ip.vat_rate
                rec["product_name"] = ip.name
                rec["unit_name"] = ip.unit_name or rec["unit_name"]
            if not rec["product_name"] and pname:
                rec["product_name"] = pname
            if not rec["unit_name"] and uname:
                rec["unit_name"] = uname
        if raw_cqt_sku:
            rec["cqt_skus"].add(raw_cqt_sku)
        return rec

    # Khởi tạo sẵn các dòng có khai báo tồn đầu kỳ (kể cả khi kỳ này chưa có phát sinh N-X)
    for (mst, sku), ob in opening_map.items():
        _, ip = _resolve_to_invoice_product(sku, mst=mst)
        _get_or_init_rec(mst, sku, ob["product_name"], ob["unit_name"], ip=ip)

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
                raw_sku = (p_code or "").strip().upper()
                if not raw_sku:
                    unmapped_sku_items_count += 1
                    continue
                mst, inv_date = purch_meta_by_id[p_inv_id]
                sku, ip = _resolve_to_invoice_product(raw_sku, mst=mst, prefer_cqt_mst=True)
                ob = opening_map.get((mst, sku))
                cutoff_date = (ob["as_of_date"] if ob is not None else None) or mst_cutoffs.get(mst)
                if cutoff_date is not None and inv_date is not None and inv_date < cutoff_date:
                    # Đã nằm trước mốc chốt sổ đầu kỳ của MST -> bỏ qua không cộng dồn dữ liệu cũ
                    continue

                qty_dec = _to_dec(qty_raw)
                amt_dec = _to_dec(amt_raw)
                rec = _get_or_init_rec(
                    mst,
                    sku,
                    (p_name or "").strip(),
                    (u_name or "").strip(),
                    ip=ip,
                    raw_cqt_sku=raw_sku,
                )

                # Tách riêng Hàng khuyến mãi (TChat = 2 theo NĐ 123) để KHÔNG làm loãng đơn giá BQGQ TK 156
                if item_nature == 2:
                    if not (from_date is not None and inv_date is not None and inv_date < from_date):
                        rec["promo_in_qty"] += qty_dec
                    continue

                if from_date is not None and inv_date is not None and inv_date < from_date:
                    rec["pre_in_qty"] += qty_dec
                    rec["pre_in_amount"] += amt_dec
                else:
                    rec["input_qty"] += qty_dec
                    rec["input_amount"] += amt_dec
                    if inv_date is not None:
                        dmap = daily_deltas.setdefault((mst, sku), {})
                        dmap[inv_date] = dmap.get(inv_date, ZERO) + qty_dec
                        ym = (inv_date.year, inv_date.month)
                        mb = monthly_buckets.setdefault((mst, sku), {}).setdefault(
                            ym, {"in_qty": ZERO, "in_amt": ZERO, "out_qty": ZERO}
                        )
                        mb["in_qty"] += qty_dec
                        mb["in_amt"] += amt_dec

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
        raw_out_code = (prod_code or src_sku or "").strip().upper()
        if not raw_out_code:
            continue
        sku, ip = _resolve_to_invoice_product(raw_out_code, mst=mst)
        if ip is None and src_sku:
            alt_sku, alt_ip = _resolve_to_invoice_product(src_sku, mst=mst)
            if alt_ip is not None:
                sku, ip = alt_sku, alt_ip

        ob = opening_map.get((mst, sku))
        cutoff_date = (ob["as_of_date"] if ob is not None else None) or mst_cutoffs.get(mst)
        if cutoff_date is not None and tx_date is not None and tx_date < cutoff_date:
            continue

        # Đầu ra tính theo ĐVT nhỏ nhất sau khi quy đổi (quantity trên dòng hóa đơn xuất ra)
        qty_dec = _to_dec(qty_raw) if qty_raw is not None else _to_dec(src_qty_raw)
        amt_dec = _to_dec(amt_raw)
        is_adjustment = (inv_type or "ORIGINAL").upper() == "ADJUSTMENT"

        rec = _get_or_init_rec(
            mst,
            sku,
            (prod_name or "").strip(),
            (unit_name or src_unit or "").strip(),
            ip=ip,
        )

        if is_draft:
            if (item_type or "NORMAL").upper() != "PROMOTION":
                rec["draft_output_qty"] += qty_dec
            if not include_draft:
                continue
        else:
            if (item_type or "NORMAL").upper() != "PROMOTION":
                rec["official_output_qty"] += qty_dec

        # Tách riêng Hàng khuyến mãi đầu ra (PROMOTION) để không gây cảnh báo giả bán dưới giá vốn
        if (item_type or "NORMAL").upper() == "PROMOTION":
            if not (from_date is not None and tx_date is not None and tx_date < from_date):
                rec["promo_out_qty"] += qty_dec
            continue

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
                ym = (tx_date.year, tx_date.month)
                mb = monthly_buckets.setdefault((mst, sku), {}).setdefault(
                    ym, {"in_qty": ZERO, "in_amt": ZERO, "out_qty": ZERO}
                )
                mb["out_qty"] += qty_dec

    # 4. Chuẩn hóa tên sản phẩm (ưu tiên Tên sản phẩm xuất hóa đơn) & ánh xạ Mã sản phẩm nội bộ NPP (npp_code) + Hệ số quy đổi ĐVT (conversion_factor)
    all_skus = list({sku for _, sku in ledger.keys()})
    # prod_info[sku] = (invoice_display_name, vat_rate, npp_code, npp_invoice_name, npp_unit, has_explicit_npp, conv_factor, product_id)
    prod_info: dict[str, tuple[str, float | None, str, str, str, bool, int, int | None]] = {}
    prod_mst_invoice_override: dict[tuple[int, str], str] = {}
    prod_default_invoice_override: dict[int, str] = {}
    prod_mst_npp_code: dict[tuple[int, str], str] = {}
    if all_skus:
        # dist_prod_by_sku_mst[(npp_sku, mst)] = (inv_code, inv_name, dp_name, dp_unit)
        dist_prod_by_sku_mst: dict[tuple[str, str], tuple[str, str, str, str]] = {}
        # dist_prod_by_sku[npp_sku] = (inv_name, dp_name, dp_unit, inv_code) (fallback chung)
        dist_prod_by_sku: dict[str, tuple[str, str, str, str]] = {}
        inv_code_to_npp: dict[tuple[str, str], str] = {}
        inv_code_to_npp_default: dict[str, str] = {}
        dp_stmt = select(
            DistributorProduct.distributor_sku,
            DistributorProduct.distributor_product_name,
            DistributorProduct.invoice_product_code,
            DistributorProduct.invoice_product_name,
            DistributorProduct.unit,
            Company.tax_code,
            DistributorProduct.distributor_id,
        ).outerjoin(Company, DistributorProduct.company_id == Company.id)
        if distributor_id is not None:
            dp_stmt = dp_stmt.where(
                (DistributorProduct.distributor_id == distributor_id)
                | (DistributorProduct.distributor_id.is_(None))
            )
        dp_rows = list(db.execute(dp_stmt).all())
        dp_rows.sort(key=lambda r: 0 if r[6] is None else 1)
        for d_sku, d_name, d_inv_code, d_inv_name, d_unit, d_comp_mst, _d_dist_id in dp_rows:
            if not d_sku:
                continue
            sku_u = d_sku.strip().upper()
            clean_inv_code = (d_inv_code or "").strip().upper()
            clean_inv_name = (d_inv_name or "").strip()
            clean_name = (d_name or "").strip()
            clean_unit = (d_unit or "").strip()
            clean_mst = (d_comp_mst or "").strip()
            if clean_mst:
                dist_prod_by_sku_mst[(sku_u, clean_mst)] = (
                    clean_inv_code,
                    clean_inv_name,
                    clean_name,
                    clean_unit,
                )
                if clean_inv_code:
                    inv_code_to_npp[(clean_inv_code, clean_mst)] = sku_u
            if clean_inv_code and clean_inv_code not in inv_code_to_npp_default:
                inv_code_to_npp_default[clean_inv_code] = sku_u
            # Ưu tiên dòng chưa gán công ty làm mặc định, hoặc dòng đầu tiên
            if not clean_mst or sku_u not in dist_prod_by_sku:
                dist_prod_by_sku[sku_u] = (
                    clean_inv_name,
                    clean_name,
                    clean_unit,
                    clean_inv_code,
                )

        loaded_prod_ids: set[int] = set()
        loaded_prods: list[Product] = []
        for i in range(0, len(all_skus), 500):
            batch_skus = all_skus[i : i + 500]
            prods = db.scalars(
                select(Product)
                .options(
                    selectinload(Product.unit),
                    selectinload(Product.group_items)
                    .selectinload(ProductGroupItem.group)
                    .selectinload(ProductGroup.company_links),
                    selectinload(Product.group_items)
                    .selectinload(ProductGroupItem.group)
                    .selectinload(ProductGroup.representative_product),
                )
                .where(
                    (func.upper(Product.sku).in_(batch_skus))
                    | (func.upper(Product._npp_code).in_(batch_skus))
                )
            ).all()
            for p in prods:
                if p.id not in loaded_prod_ids:
                    loaded_prod_ids.add(p.id)
                    loaded_prods.append(p)

        if loaded_prod_ids:
            pc_rows = db.execute(
                select(
                    ProductCompany.product_id,
                    ProductCompany.invoice_name_override,
                    ProductCompany.npp_code,
                    Company.tax_code,
                )
                .outerjoin(Company, ProductCompany.company_id == Company.id)
                .where(ProductCompany.product_id.in_(loaded_prod_ids))
                .order_by(
                    ProductCompany.is_primary.desc(),
                    ProductCompany.last_purchased_at.desc().nullslast(),
                )
            ).all()
            for p_id, inv_ovr, pc_npp, c_mst in pc_rows:
                clean_mst = (c_mst or "").strip()
                clean_pc_npp = (pc_npp or "").strip().upper()
                if clean_mst and clean_pc_npp and (p_id, clean_mst) not in prod_mst_npp_code:
                    prod_mst_npp_code[(p_id, clean_mst)] = clean_pc_npp
                clean_ovr = (inv_ovr or "").strip()
                if not clean_ovr:
                    continue
                if p_id not in prod_default_invoice_override:
                    prod_default_invoice_override[p_id] = clean_ovr
                if clean_mst and (p_id, clean_mst) not in prod_mst_invoice_override:
                    prod_mst_invoice_override[(p_id, clean_mst)] = clean_ovr

        for p in loaded_prods:
            p_sku_u = (p.sku or "").strip().upper()
            resolved_npp = (p.npp_code or p_sku_u).strip().upper()
            has_explicit = bool((p._npp_code or "").strip()) or (resolved_npp != p_sku_u)
            dp_inv_name, dp_name, dp_unit, _dp_inv_code = dist_prod_by_sku.get(resolved_npp, ("", "", "", ""))
            if not dp_inv_name and p_sku_u and p_sku_u != resolved_npp:
                sku_dp_inv, sku_dp_name, sku_dp_unit, _ = dist_prod_by_sku.get(p_sku_u, ("", "", "", ""))
                dp_inv_name = sku_dp_inv or dp_inv_name
                dp_name = dp_name or sku_dp_name
                dp_unit = dp_unit or sku_dp_unit
            pc_override = prod_default_invoice_override.get(p.id, "")
            # Thứ tự ưu tiên chuẩn xuất hóa đơn (khớp invoice_consolidation):
            # 1. DistributorProduct.invoice_product_name -> 2. ProductCompany.invoice_name_override
            # -> 3. Product.internal_name -> 4. DistributorProduct.distributor_product_name -> 5. Product.npp_name / Product.name
            npp_invoice_name = (
                dp_inv_name
                or pc_override
                or (p.internal_name or "").strip()
                or dp_name
                or p.npp_name
                or p.name
            )
            npp_unit = (p.internal_unit or "").strip() or dp_unit or (p.unit.name if p.unit else "")
            conv_factor = 1
            if p.group_items:
                raw_cf = p.group_items[0].conversion_factor
                if raw_cf and int(raw_cf) > 0:
                    conv_factor = int(raw_cf)
            info_tuple = (
                npp_invoice_name,
                p.vat_rate,
                resolved_npp,
                npp_invoice_name,
                npp_unit,
                has_explicit,
                conv_factor,
                p.id,
            )
            if p_sku_u:
                prod_info[p_sku_u] = info_tuple
            if resolved_npp and resolved_npp not in prod_info:
                prod_info[resolved_npp] = info_tuple

        # Fallback cho các SKU chỉ khai báo trong DistributorProduct mà chưa có trong bảng products
        for sku_u in all_skus:
            if sku_u not in prod_info:
                mapped_npp = inv_code_to_npp_default.get(sku_u, sku_u)
                if mapped_npp in dist_prod_by_sku:
                    dp_inv_name, dp_name, dp_unit, _dp_inv_code = dist_prod_by_sku[mapped_npp]
                    resolved_inv_name = dp_inv_name or dp_name
                    if resolved_inv_name or dp_unit:
                        prod_info[sku_u] = (
                            resolved_inv_name,
                            None,
                            mapped_npp,
                            resolved_inv_name,
                            dp_unit,
                            True,
                            1,
                            None,
                        )

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

        # Tính Bình quân gia quyền CHUẨN THEO TỪNG THÁNG dương lịch (TT 200 / TT 133):
        # Tồn cuối tháng T kết chuyển thành tồn đầu tháng T+1, tránh giá nhập tháng sau bóp méo giá vốn tháng trước.
        avail_qty = opening_qty_dec + rec["input_qty"]
        avail_amt = opening_amt_dec + rec["input_amount"]
        bal_dec = avail_qty - rec["output_qty"]
        balance_lookup[(mst, sku)] = _q_qty(bal_dec)

        sku_months = monthly_buckets.get((mst, sku))
        if sku_months and len(sku_months) > 1:
            run_qty = opening_qty_dec
            run_amt = opening_amt_dec
            cogs_amt_dec = ZERO
            last_unit_cost = ZERO
            for _ym, mb in sorted(sku_months.items()):
                m_avail_qty = run_qty + mb["in_qty"]
                m_avail_amt = run_amt + mb["in_amt"]
                m_unit_cost = (
                    (m_avail_amt / m_avail_qty)
                    if (m_avail_qty > EPSILON and m_avail_amt > ZERO)
                    else ZERO
                )
                if m_unit_cost > ZERO:
                    last_unit_cost = m_unit_cost
                m_cogs = (mb["out_qty"] * m_unit_cost).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)
                cogs_amt_dec += m_cogs
                run_qty = m_avail_qty - mb["out_qty"]
                run_amt = (
                    max(ZERO, (m_avail_amt - m_cogs).quantize(AMT_QUANT, rounding=ROUND_HALF_UP))
                    if run_qty > EPSILON
                    else ZERO
                )
            ending_val_dec = run_amt
            if rec["output_qty"] > EPSILON and cogs_amt_dec > ZERO:
                avg_unit_cost_dec = cogs_amt_dec / rec["output_qty"]
            elif run_qty > EPSILON and run_amt > ZERO:
                avg_unit_cost_dec = run_amt / run_qty
            else:
                avg_unit_cost_dec = last_unit_cost
        else:
            avg_unit_cost_dec = (avail_amt / avail_qty) if (avail_qty > EPSILON and avail_amt > ZERO) else ZERO
            cogs_amt_dec = (rec["output_qty"] * avg_unit_cost_dec).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)
            if bal_dec > EPSILON:
                ending_val_dec = max(ZERO, (avail_amt - cogs_amt_dec).quantize(AMT_QUANT, rounding=ROUND_HALF_UP))
            else:
                ending_val_dec = ZERO
        bal = balance_lookup[(mst, sku)]

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

    # 5. Lọc theo MST & search, tính KPI Summary (hỗ trợ 2 chế độ: MST_SKU hoặc gộp theo NPP_SKU)
    mst_filter = (company_tax_code or "").strip()
    search_term = (search or "").strip().lower()
    norm_status_filter = (status_filter or "").strip().upper()
    if only_negative and not norm_status_filter:
        norm_status_filter = "NEGATIVE"
    norm_group_by = (group_by or "MST_SKU").strip().upper()

    available_msts = sorted(
        [
            {"tax_code": mst, "company_name": company_name_by_mst.get(mst, f"MST {mst}")}
            for mst in {k[0] for k in ledger.keys()}
        ],
        key=lambda x: x["tax_code"],
    )

    if norm_group_by in ("NPP_SKU", "INVOICE_SKU"):
        # Gom toàn bộ tồn kho thuế theo Mã SP xuất hóa đơn (ĐVT nhỏ nhất)
        npp_groups: dict[str, dict[str, Any]] = {}
        for (mst, sku), rec in ledger.items():
            if mst_filter and mst != mst_filter:
                continue
            p_meta = prod_info.get(sku)
            p_id = p_meta[7] if p_meta else None
            has_inv_prod = bool(rec.get("has_invoice_product"))
            npp_code = sku
            mst_inv_code = sku
            pname = rec["product_name"] or (p_meta[0] if p_meta else "")
            pvat = (
                rec.get("invoice_product_vat_rate")
                if rec.get("invoice_product_vat_rate") is not None
                else (p_meta[1] if p_meta else None)
            )
            npp_name = pname
            npp_unit = rec["unit_name"] or (p_meta[4] if p_meta else "")
            has_explicit_npp = has_inv_prod
            conv_factor = 1
            cf_dec = Decimal("1")

            m = computed_metrics[(mst, sku)]
            bal_dec = m["bal_dec"]
            child_status = "NEGATIVE" if bal_dec < -EPSILON else ("LOW" if bal_dec <= low_thresh_dec else "OK")

            grp = npp_groups.get(npp_code)
            if grp is None:
                grp = {
                    "npp_code": npp_code,
                    "invoice_product_id": rec.get("invoice_product_id"),
                    "has_invoice_product": has_inv_prod,
                    "product_name": npp_name,
                    "unit_name": npp_unit,
                    "vat_rate": pvat,
                    "has_npp_code": has_explicit_npp,
                    "cqt_skus": set(),
                    "invoice_product_codes": set(),
                    "msts": set(),
                    "vat_rates_seen": set(),
                    "raw_units_seen": set(),
                    "has_conversion": False,
                    "opening_qty": ZERO,
                    "opening_amount": ZERO,
                    "input_qty": ZERO,
                    "input_amount": ZERO,
                    "output_qty": ZERO,
                    "output_amount": ZERO,
                    "promo_in_qty": ZERO,
                    "promo_out_qty": ZERO,
                    "official_output_qty": ZERO,
                    "draft_output_qty": ZERO,
                    "adjustment_qty": ZERO,
                    "has_chrono_neg": False,
                    "min_running_bal": None,
                    "negative_mst_count": 0,
                    "mst_breakdown": [],
                }
                npp_groups[npp_code] = grp

            if rec.get("cqt_skus"):
                grp["cqt_skus"].update(rec["cqt_skus"])
            else:
                grp["cqt_skus"].add(sku)
            if mst_inv_code:
                grp["invoice_product_codes"].add(mst_inv_code)
            grp["msts"].add(mst)
            if pvat is not None:
                grp["vat_rates_seen"].add(float(pvat))
            if (rec["unit_name"] or "").strip():
                grp["raw_units_seen"].add(rec["unit_name"].strip().lower())
            if conv_factor > 1:
                grp["has_conversion"] = True
            if grp["vat_rate"] is None and pvat is not None:
                grp["vat_rate"] = pvat
            if not grp["product_name"] and npp_name:
                grp["product_name"] = npp_name
            if not grp["unit_name"] and npp_unit:
                grp["unit_name"] = npp_unit

            # Quy đổi số lượng về ĐVT chuẩn (Base UOM) bằng conversion_factor
            grp["opening_qty"] += m["opening_qty_dec"] * cf_dec
            grp["opening_amount"] += m["opening_amt_dec"]
            grp["input_qty"] += rec["input_qty"] * cf_dec
            grp["input_amount"] += rec["input_amount"]
            grp["output_qty"] += rec["output_qty"] * cf_dec
            grp["output_amount"] += rec["output_amount"]
            grp["promo_in_qty"] += rec["promo_in_qty"] * cf_dec
            grp["promo_out_qty"] += rec["promo_out_qty"] * cf_dec
            grp["official_output_qty"] += rec["official_output_qty"] * cf_dec
            grp["draft_output_qty"] += rec["draft_output_qty"] * cf_dec
            grp["adjustment_qty"] += rec["adjustment_qty"] * cf_dec
            if m["has_chrono_neg"]:
                grp["has_chrono_neg"] = True
            scaled_min = float(_to_dec(m["min_running_bal"]) * cf_dec)
            if grp["min_running_bal"] is None or scaled_min < grp["min_running_bal"]:
                grp["min_running_bal"] = scaled_min
            if child_status == "NEGATIVE":
                grp["negative_mst_count"] += 1

            grp["mst_breakdown"].append(
                {
                    "tax_code": mst,
                    "company_name": rec["company_name"],
                    "sku": sku,
                    "invoice_product_code": mst_inv_code,
                    "product_name": pname,
                    "unit_name": rec["unit_name"],
                    "conversion_factor": conv_factor,
                    "vat_rate": pvat,
                    "opening_as_of_date": rec["opening_as_of_date"].isoformat() if rec["opening_as_of_date"] else None,
                    "opening_qty": _q_qty(m["opening_qty_dec"]),
                    "opening_amount": _q_amt(m["opening_amt_dec"]),
                    "input_qty": _q_qty(rec["input_qty"]),
                    "input_amount": _q_amt(rec["input_amount"]),
                    "output_qty": _q_qty(rec["output_qty"]),
                    "output_amount": _q_amt(rec["output_amount"]),
                    "promo_in_qty": _q_qty(rec["promo_in_qty"]),
                    "promo_out_qty": _q_qty(rec["promo_out_qty"]),
                    "promo_balance_qty": _q_qty(rec["promo_in_qty"] - rec["promo_out_qty"]),
                    "official_output_qty": _q_qty(rec["official_output_qty"]),
                    "draft_output_qty": _q_qty(rec["draft_output_qty"]),
                    "adjustment_qty": _q_qty(rec["adjustment_qty"]),
                    "balance_qty": balance_lookup[(mst, sku)],
                    "base_balance_qty": _q_qty(bal_dec * cf_dec),
                    "avg_unit_cost": _q_amt(m["avg_unit_cost_dec"]),
                    "avg_sale_price": _q_amt(m["avg_sale_price_dec"]),
                    "cogs_amount": _q_amt(m["cogs_amt_dec"]),
                    "ending_inventory_value": _q_amt(m["ending_val_dec"]),
                    "is_below_cost": m["is_below_cost"],
                    "has_chronological_negative": m["has_chrono_neg"],
                    "min_running_balance": m["min_running_bal"],
                    "status": child_status,
                }
            )

        rows: list[dict[str, Any]] = []
        scoped_total = 0
        negative_count = 0
        low_count = 0
        ok_count = 0
        chrono_negative_count = 0
        below_cost_count = 0
        unmapped_invoice_product_count = 0
        total_opening_amount = ZERO
        total_input_amount = ZERO
        total_output_amount = ZERO
        total_cogs_amount = ZERO
        total_ending_inventory_value = ZERO

        for npp_code, grp in npp_groups.items():
            cqt_skus_sorted = sorted(grp["cqt_skus"])
            inv_codes_sorted = sorted(grp["invoice_product_codes"])
            if search_term and not (
                search_term in npp_code.lower()
                or search_term in (grp["product_name"] or "").lower()
                or any(search_term in s.lower() for s in cqt_skus_sorted)
                or any(search_term in ic.lower() for ic in inv_codes_sorted)
                or any(
                    search_term in b["tax_code"].lower() or search_term in b["company_name"].lower()
                    for b in grp["mst_breakdown"]
                )
            ):
                continue

            avail_qty = grp["opening_qty"] + grp["input_qty"]
            avail_amt = grp["opening_amount"] + grp["input_amount"]
            avg_unit_cost_dec = (avail_amt / avail_qty) if (avail_qty > EPSILON and avail_amt > ZERO) else ZERO
            bal_dec = avail_qty - grp["output_qty"]
            cogs_amt_dec = (grp["output_qty"] * avg_unit_cost_dec).quantize(AMT_QUANT, rounding=ROUND_HALF_UP)
            ending_val_dec = (
                max(ZERO, (avail_amt - cogs_amt_dec).quantize(AMT_QUANT, rounding=ROUND_HALF_UP))
                if bal_dec > EPSILON
                else ZERO
            )
            avg_sale_price_dec = (
                (grp["output_amount"] / grp["output_qty"]) if grp["output_qty"] > EPSILON else ZERO
            )
            is_below_cost = bool(
                grp["output_qty"] > EPSILON
                and grp["output_amount"] > ZERO
                and avg_unit_cost_dec > ZERO
                and avg_sale_price_dec < (avg_unit_cost_dec - Decimal("1"))
            )

            if bal_dec < -EPSILON:
                status = "NEGATIVE"
                negative_count += 1
            elif bal_dec <= low_thresh_dec:
                status = "LOW"
                low_count += 1
            else:
                status = "OK"
                ok_count += 1

            has_chrono_neg = grp["has_chrono_neg"]
            if has_chrono_neg and status != "NEGATIVE":
                chrono_negative_count += 1
            if is_below_cost:
                below_cost_count += 1
            if not grp.get("has_invoice_product"):
                unmapped_invoice_product_count += 1

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
            if norm_status_filter == "UNMAPPED" and grp.get("has_invoice_product"):
                continue

            total_opening_amount += grp["opening_amount"]
            total_input_amount += grp["input_amount"]
            total_output_amount += grp["output_amount"]
            total_cogs_amount += cogs_amt_dec
            total_ending_inventory_value += ending_val_dec

            grp["mst_breakdown"].sort(
                key=lambda b: (0 if b["status"] == "NEGATIVE" else 1, b["tax_code"], b["sku"])
            )
            ip_obj = ip_by_id.get(grp["invoice_product_id"]) if grp.get("invoice_product_id") else None
            def_comp = company_by_id.get(ip_obj.default_company_id) if (ip_obj and ip_obj.default_company_id) else None
            def_comp_mst = def_comp[0] if def_comp else ""
            def_comp_name = def_comp[1] if def_comp else ""

            seen_mst_map: dict[str, str] = {}
            for b in grp["mst_breakdown"]:
                b_mst = (b.get("tax_code") or "").strip()
                if b_mst and b_mst not in seen_mst_map:
                    seen_mst_map[b_mst] = b.get("company_name") or company_name_by_mst.get(b_mst, f"MST {b_mst}")
            mst_list = [
                {"tax_code": m_code, "company_name": seen_mst_map[m_code]}
                for m_code in sorted(seen_mst_map.keys(), key=lambda x: (0 if def_comp_mst and x == def_comp_mst else 1, x))
            ]
            if not mst_list and def_comp_mst:
                mst_list = [{"tax_code": def_comp_mst, "company_name": def_comp_name or f"MST {def_comp_mst}"}]

            display_tax_code = (
                mst_list[0]["tax_code"]
                if len(mst_list) == 1
                else (", ".join(x["tax_code"] for x in mst_list) if mst_list else "")
            )
            display_company_name = (
                mst_list[0]["company_name"]
                if len(mst_list) == 1
                else (", ".join(x["company_name"] for x in mst_list) if mst_list else "")
            )
            inv_code_display = inv_codes_sorted[0] if inv_codes_sorted else npp_code
            has_vat_mismatch = len(grp["vat_rates_seen"]) > 1
            has_unit_mismatch = len(grp["raw_units_seen"]) > 1 and not grp["has_conversion"]
            rows.append(
                {
                    "tax_code": display_tax_code,
                    "company_name": display_company_name,
                    "mst_list": mst_list,
                    "default_company_tax_code": def_comp_mst or None,
                    "default_company_name": def_comp_name or None,
                    "sku": npp_code,
                    "npp_code": npp_code,
                    "invoice_product_id": grp.get("invoice_product_id"),
                    "has_invoice_product": bool(grp.get("has_invoice_product")),
                    "invoice_product_code": inv_code_display,
                    "invoice_product_name": grp["product_name"],
                    "invoice_product_codes": inv_codes_sorted,
                    "has_npp_code": grp["has_npp_code"],
                    "cqt_skus": cqt_skus_sorted,
                    "mst_count": len(grp["msts"]),
                    "negative_mst_count": grp["negative_mst_count"],
                    "has_vat_mismatch": has_vat_mismatch,
                    "has_unit_mismatch": has_unit_mismatch,
                    "product_name": grp["product_name"],
                    "unit_name": grp["unit_name"],
                    "vat_rate": grp["vat_rate"],
                    "opening_as_of_date": None,
                    "opening_qty": _q_qty(grp["opening_qty"]),
                    "opening_amount": _q_amt(grp["opening_amount"]),
                    "input_qty": _q_qty(grp["input_qty"]),
                    "input_amount": _q_amt(grp["input_amount"]),
                    "output_qty": _q_qty(grp["output_qty"]),
                    "output_amount": _q_amt(grp["output_amount"]),
                    "promo_in_qty": _q_qty(grp["promo_in_qty"]),
                    "promo_out_qty": _q_qty(grp["promo_out_qty"]),
                    "promo_balance_qty": _q_qty(grp["promo_in_qty"] - grp["promo_out_qty"]),
                    "official_output_qty": _q_qty(grp["official_output_qty"]),
                    "draft_output_qty": _q_qty(grp["draft_output_qty"]),
                    "adjustment_qty": _q_qty(grp["adjustment_qty"]),
                    "balance_qty": _q_qty(bal_dec),
                    "avg_unit_cost": _q_amt(avg_unit_cost_dec),
                    "avg_sale_price": _q_amt(avg_sale_price_dec),
                    "cogs_amount": _q_amt(cogs_amt_dec),
                    "ending_inventory_value": _q_amt(ending_val_dec),
                    "is_below_cost": is_below_cost,
                    "has_chronological_negative": has_chrono_neg,
                    "min_running_balance": grp["min_running_bal"] if grp["min_running_bal"] is not None else 0.0,
                    "status": status,
                    "other_mst_stocks": [],
                    "mst_breakdown": grp["mst_breakdown"],
                }
            )

        rows.sort(
            key=lambda r: (
                0 if r["status"] == "NEGATIVE" else (1 if r["negative_mst_count"] > 0 else (2 if r["has_chronological_negative"] else (3 if r["is_below_cost"] else 4))),
                r["npp_code"],
            )
        )
    else:
        rows = []
        scoped_total = 0
        negative_count = 0
        low_count = 0
        ok_count = 0
        chrono_negative_count = 0
        below_cost_count = 0
        unmapped_invoice_product_count = 0
        total_opening_amount = ZERO
        total_input_amount = ZERO
        total_output_amount = ZERO
        total_cogs_amount = ZERO
        total_ending_inventory_value = ZERO

        for (mst, sku), rec in ledger.items():
            if mst_filter and mst != mst_filter:
                continue

            p_meta = prod_info.get(sku)
            p_id = p_meta[7] if p_meta else None
            mst_specific_npp = prod_mst_npp_code.get((p_id, mst), "") if p_id else ""
            npp_code = (
                mst_specific_npp
                or (p_meta[2] if p_meta else inv_code_to_npp.get((sku, mst)) or inv_code_to_npp_default.get(sku) or sku)
                or sku
            )
            dp_mst_entry = (
                dist_prod_by_sku_mst.get((npp_code, mst))
                or dist_prod_by_sku_mst.get((sku, mst))
                if all_skus
                else None
            )
            dp_entry = dist_prod_by_sku.get(npp_code) or dist_prod_by_sku.get(sku) if all_skus else None
            mst_inv_code = (dp_mst_entry[0] if dp_mst_entry else "") or (dp_entry[3] if dp_entry else "") or npp_code
            dp_mst_inv_name = (dp_mst_entry[1] if dp_mst_entry else "")
            dp_default_inv_name = (dp_entry[0] if dp_entry else "")
            mst_inv_override = prod_mst_invoice_override.get((p_id, mst), "") if p_id else ""
            if rec.get("has_invoice_product") and rec.get("product_name"):
                pname = rec["product_name"]
            else:
                pname = (
                    dp_mst_inv_name
                    or mst_inv_override
                    or dp_default_inv_name
                    or (p_meta[0] if p_meta else "")
                    or rec["product_name"]
                )
            pvat = (
                rec.get("invoice_product_vat_rate")
                if rec.get("invoice_product_vat_rate") is not None
                else (p_meta[1] if p_meta else None)
            )

            if search_term and not (
                search_term in sku.lower()
                or search_term in npp_code.lower()
                or search_term in mst_inv_code.lower()
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
            if not rec.get("has_invoice_product"):
                unmapped_invoice_product_count += 1

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
            if norm_status_filter == "UNMAPPED" and rec.get("has_invoice_product"):
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
                    "mst_list": [{"tax_code": mst, "company_name": rec["company_name"]}],
                    "sku": sku,
                    "npp_code": sku,
                    "invoice_product_id": rec.get("invoice_product_id"),
                    "has_invoice_product": bool(rec.get("has_invoice_product")),
                    "invoice_product_code": sku,
                    "invoice_product_name": pname,
                    "invoice_product_codes": [sku],
                    "has_npp_code": bool(rec.get("has_invoice_product")),
                    "cqt_skus": sorted(rec.get("cqt_skus") or [sku]),
                    "mst_count": 1,
                    "negative_mst_count": 1 if status == "NEGATIVE" else 0,
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
                    "promo_in_qty": _q_qty(rec["promo_in_qty"]),
                    "promo_out_qty": _q_qty(rec["promo_out_qty"]),
                    "promo_balance_qty": _q_qty(rec["promo_in_qty"] - rec["promo_out_qty"]),
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
                    "mst_breakdown": [],
                }
            )

        rows.sort(
            key=lambda r: (
                0 if r["status"] == "NEGATIVE" else (1 if r["has_chronological_negative"] else (2 if r["is_below_cost"] else 3)),
                r["tax_code"],
                r["sku"],
            )
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
        "group_by": norm_group_by,
        "summary": {
            "total_records": scoped_total,
            "filtered_records": total_filtered,
            "negative_count": negative_count,
            "low_count": low_count,
            "ok_count": ok_count,
            "chrono_negative_count": chrono_negative_count,
            "below_cost_count": below_cost_count,
            "unmapped_invoice_product_count": unmapped_invoice_product_count,
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


def _resolve_target_invoice_product_codes(
    db: Session,
    target_code: str,
    distributor_id: int | None = None,
) -> tuple[InvoiceProduct | None, set[str]]:
    """Tìm Sản phẩm XHĐ ứng với target_code và trả về tập toàn bộ mã liên quan (Mã SP XHĐ + các SKU CQT + các Mã DMS)."""
    clean = (target_code or "").strip().upper()
    if not clean:
        return None, set()

    ip_stmt = select(InvoiceProduct).where(func.upper(InvoiceProduct.code) == clean)
    if distributor_id is not None:
        ip_stmt = ip_stmt.where(
            (InvoiceProduct.distributor_id == distributor_id)
            | (InvoiceProduct.distributor_id.is_(None))
        )
    ip = db.scalar(ip_stmt)

    if ip is None:
        prod_ip_id = db.scalar(
            select(Product.invoice_product_id).where(
                func.upper(Product.sku) == clean,
                Product.invoice_product_id.is_not(None),
            )
        )
        if prod_ip_id:
            ip = db.get(InvoiceProduct, prod_ip_id)

    codes: set[str] = {clean}
    if ip is not None:
        codes.add((ip.code or "").strip().upper())
        for p_sku in db.scalars(
            select(Product.sku).where(Product.invoice_product_id == ip.id)
        ).all():
            if p_sku:
                codes.add(p_sku.strip().upper())
        dp_q = select(DistributorProduct.distributor_sku).where(
            DistributorProduct.invoice_product_id == ip.id
        )
        if distributor_id is not None:
            dp_q = dp_q.where(
                (DistributorProduct.distributor_id == distributor_id)
                | (DistributorProduct.distributor_id.is_(None))
            )
        for d_sku in db.scalars(dp_q).all():
            if d_sku:
                codes.add(d_sku.strip().upper())
    codes.discard("")
    return ip, codes


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
    """Lấy Thẻ kho thuế chi tiết (Sổ chi tiết N-X-T) theo trục thời gian cho 1 cặp (MST, Mã SP XHĐ / SKU)."""
    target_mst = (tax_code or "").strip()
    target_sku = (sku or "").strip().upper()
    if not target_mst or not target_sku:
        raise ValueError("Thiếu MST hoặc mã SKU để xem thẻ kho thuế.")

    target_ip, match_codes = _resolve_target_invoice_product_codes(
        db, target_sku, distributor_id=distributor_id
    )
    if target_ip is not None:
        target_sku = target_ip.code.strip().upper()

    dist_mst_by_id: dict[int, str] = {
        d_id: d_mst.strip()
        for d_id, d_mst in db.execute(select(Distributor.id, Distributor.tax_code)).all()
        if d_mst
    }
    opening_map = _load_effective_opening_balances(
        db, distributor_id=distributor_id, to_date=to_date
    )
    mst_cutoffs = _build_mst_cutoff_dates(opening_map)
    opening_qty = ZERO
    opening_as_of: date | None = mst_cutoffs.get(target_mst)
    for code_key in match_codes:
        ob = opening_map.get((target_mst, code_key))
        if ob is not None:
            opening_qty += ob["opening_qty"]
            if ob["as_of_date"] and (opening_as_of is None or ob["as_of_date"] > opening_as_of):
                opening_as_of = ob["as_of_date"]

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
                    func.upper(func.trim(PurchaseInvoiceItem.product_code)).in_(match_codes),
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
        src_code = (row[13] or "").strip().upper()
        out_code = (row[14] or "").strip().upper()
        if out_code not in match_codes and src_code not in match_codes:
            continue
        is_draft = (row[3] or "").upper() == "DRAFT"
        if is_draft and not include_draft:
            continue
        tx_date = _to_date(row[9] or row[10])
        if to_date is not None and tx_date is not None and tx_date > to_date:
            continue
        if opening_as_of is not None and tx_date is not None and tx_date < opening_as_of:
            continue
        # Đầu ra lấy theo ĐVT nhỏ nhất sau quy đổi (quantity)
        qty_dec = _to_dec(row[18]) if row[18] is not None else _to_dec(row[17])
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


def get_daily_tax_inventory_ledger(
    db: Session,
    *,
    sku: str,
    from_date: date,
    to_date: date,
    tax_code: str | None = None,
    distributor_id: int | None = None,
    include_draft: bool = True,
    only_active_days: bool = False,
) -> dict[str, Any]:
    """Nhật ký Nhập – Xuất – Tồn Thuế theo từng ngày (Ngày 1 → Ngày N) cho 1 Mã SP nội bộ NPP (hoặc 1 cặp MST + SKU)."""
    target_code = (sku or "").strip().upper()
    if not target_code:
        raise ValueError("Thiếu mã SKU / mã SP nội bộ NPP.")
    if from_date > to_date:
        raise ValueError("Từ ngày không được lớn hơn Đến ngày.")
    if (to_date - from_date).days > 366:
        raise ValueError("Khoảng thời gian xem nhật ký từng ngày tối đa 366 ngày.")

    target_mst = (tax_code or "").strip()
    if target_mst.upper() == "ALL":
        target_mst = ""

    # Giải mã toàn bộ mã liên quan theo Sản phẩm XHĐ (InvoiceProduct) -> SKU CQT (1:1) & Mã DMS
    sku_conv_map: dict[str, Decimal] = {}
    resolved_ip, ip_match_codes = _resolve_target_invoice_product_codes(
        db, target_code, distributor_id=distributor_id
    )
    resolved_product_name = (resolved_ip.name or "").strip() if resolved_ip else ""
    resolved_unit_name = (resolved_ip.unit_name or "").strip() if resolved_ip else ""
    if ip_match_codes:
        for c in ip_match_codes:
            sku_conv_map[c] = Decimal("1")
        if resolved_ip is not None:
            target_code = resolved_ip.code.strip().upper()

    if not resolved_product_name:
        dp_target = db.scalar(
            select(DistributorProduct).where(func.upper(DistributorProduct.distributor_sku) == target_code)
        )
        dp_inv_name = (dp_target.invoice_product_name or "").strip() if dp_target else ""
        dp_fallback_name = (dp_target.distributor_product_name or "").strip() if dp_target else ""
        dp_fallback_unit = (dp_target.unit or "").strip() if dp_target else ""
        p = db.scalar(select(Product).options(selectinload(Product.unit)).where(func.upper(Product.sku) == target_code))
        resolved_product_name = (
            dp_inv_name
            or ((p.internal_name or "").strip() if p else "")
            or dp_fallback_name
            or (p.name if p else "")
            or ""
        )
        resolved_unit_name = (
            resolved_unit_name
            or ((p.internal_unit or "").strip() if p else "")
            or dp_fallback_unit
            or (p.unit.name if (p and p.unit) else "")
        )
    if not sku_conv_map:
        sku_conv_map[target_code] = Decimal("1")

    target_skus = set(sku_conv_map.keys())

    dist_mst_by_id: dict[int, str] = {
        d_id: d_mst.strip()
        for d_id, d_mst in db.execute(select(Distributor.id, Distributor.tax_code)).all()
        if d_mst
    }
    opening_map = _load_effective_opening_balances(
        db, distributor_id=distributor_id, to_date=to_date
    )
    mst_cutoffs = _build_mst_cutoff_dates(opening_map)

    # Tính số dư đầu kỳ gốc từ bảng opening_balances
    period_opening_qty = ZERO
    for (o_mst, o_sku), ob in opening_map.items():
        if o_sku not in target_skus:
            continue
        if target_mst and o_mst != target_mst:
            continue
        cf_dec = sku_conv_map.get(o_sku, Decimal("1"))
        period_opening_qty += ob["opening_qty"] * cf_dec

    daily_in_qty: dict[date, Decimal] = {}
    daily_in_amt: dict[date, Decimal] = {}
    daily_out_qty: dict[date, Decimal] = {}
    daily_out_amt: dict[date, Decimal] = {}

    # 1. Đầu vào CQT
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

    matched_purch: dict[int, tuple[str, date | None]] = {}
    for row in purch_headers:
        inv_id = row[0]
        if inv_id in excluded_purch_ids:
            continue
        mst = (row[5] or row[10] or dist_mst_by_id.get(row[6]) or "").strip()
        if not mst:
            continue
        if target_mst and mst != target_mst:
            continue
        inv_date = _to_date(row[7])
        if inv_date is not None and inv_date > to_date:
            continue
        matched_purch[inv_id] = (mst, inv_date)

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
                    PurchaseInvoiceItem.amount_before_tax,
                ).where(
                    PurchaseInvoiceItem.purchase_invoice_id.in_(batch_ids),
                    func.upper(func.trim(PurchaseInvoiceItem.product_code)).in_(list(target_skus)),
                )
            ).all()
            for p_inv_id, item_nature, p_code, p_name, u_name, qty_raw, amt_raw in item_rows:
                if item_nature in NON_STOCK_ITEM_NATURES:
                    continue
                c_sku = (p_code or "").strip().upper()
                mst, inv_date = matched_purch[p_inv_id]
                ob = opening_map.get((mst, c_sku))
                cutoff_date = (ob["as_of_date"] if ob is not None else None) or mst_cutoffs.get(mst)
                if cutoff_date is not None and inv_date is not None and inv_date < cutoff_date:
                    continue
                if not resolved_product_name and p_name:
                    resolved_product_name = p_name.strip()
                if not resolved_unit_name and u_name:
                    resolved_unit_name = u_name.strip()
                cf_dec = sku_conv_map.get(c_sku, Decimal("1"))
                qty_scaled = _to_dec(qty_raw) * cf_dec
                amt_dec = _to_dec(amt_raw)
                if inv_date is None or inv_date < from_date:
                    period_opening_qty += qty_scaled
                else:
                    daily_in_qty[inv_date] = daily_in_qty.get(inv_date, ZERO) + qty_scaled
                    daily_in_amt[inv_date] = daily_in_amt.get(inv_date, ZERO) + amt_dec

    # 2. Đầu ra HĐĐT
    issued_stmt = (
        select(
            IssuedInvoice.seller_tax_code,
            IssuedInvoice.distributor_id,
            IssuedInvoice.status,
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
        if (row[5] or "NORMAL").upper() not in ("NORMAL", "PROMOTION", "ADJUSTMENT"):
            continue
        is_draft = (row[2] or "").upper() == "DRAFT"
        if is_draft and not include_draft:
            continue
        mst = (row[0] or dist_mst_by_id.get(row[1]) or "").strip()
        if not mst:
            continue
        if target_mst and mst != target_mst:
            continue
        c_sku = (row[6] or row[7] or "").strip().upper()
        if c_sku not in target_skus:
            continue
        tx_date = _to_date(row[3] or row[4])
        if tx_date is not None and tx_date > to_date:
            continue
        ob = opening_map.get((mst, c_sku))
        cutoff_date = (ob["as_of_date"] if ob is not None else None) or mst_cutoffs.get(mst)
        if cutoff_date is not None and tx_date is not None and tx_date < cutoff_date:
            continue
        if not resolved_product_name and row[8]:
            resolved_product_name = row[8].strip()
        if not resolved_unit_name and (row[9] or row[10]):
            resolved_unit_name = (row[9] or row[10]).strip()
        cf_dec = sku_conv_map.get(c_sku, Decimal("1"))
        raw_q = _to_dec(row[11]) if row[11] is not None else _to_dec(row[12])
        qty_scaled = raw_q * cf_dec
        amt_dec = _to_dec(row[13])
        if tx_date is None or tx_date < from_date:
            period_opening_qty -= qty_scaled
        else:
            daily_out_qty[tx_date] = daily_out_qty.get(tx_date, ZERO) + qty_scaled
            daily_out_amt[tx_date] = daily_out_amt.get(tx_date, ZERO) + amt_dec

    # 3. Sinh bảng từng ngày liên tục từ from_date -> to_date
    days_list: list[dict[str, Any]] = []
    running = period_opening_qty
    tot_in_q = ZERO
    tot_in_a = ZERO
    tot_out_q = ZERO
    tot_out_a = ZERO
    negative_days_count = 0
    active_days_count = 0

    cur = from_date
    while cur <= to_date:
        day_open = running
        in_q = daily_in_qty.get(cur, ZERO)
        in_a = daily_in_amt.get(cur, ZERO)
        out_q = daily_out_qty.get(cur, ZERO)
        out_a = daily_out_amt.get(cur, ZERO)
        day_close = day_open + in_q - out_q
        running = day_close

        has_activity = (in_q != ZERO) or (out_q != ZERO)
        is_neg = day_close < -EPSILON
        if has_activity:
            active_days_count += 1
        if is_neg:
            negative_days_count += 1

        tot_in_q += in_q
        tot_in_a += in_a
        tot_out_q += out_q
        tot_out_a += out_a

        if not only_active_days or has_activity:
            days_list.append(
                {
                    "date": cur.isoformat(),
                    "opening_qty": _q_qty(day_open),
                    "input_qty": _q_qty(in_q),
                    "input_amount": _q_amt(in_a),
                    "output_qty": _q_qty(out_q),
                    "output_amount": _q_amt(out_a),
                    "closing_qty": _q_qty(day_close),
                    "is_negative": is_neg,
                    "has_activity": has_activity,
                }
            )
        cur += timedelta(days=1)

    return {
        "sku": target_code,
        "tax_code": target_mst or "ALL",
        "product_name": resolved_product_name,
        "unit_name": resolved_unit_name,
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "cqt_skus": sorted(target_skus),
        "summary": {
            "period_opening_qty": _q_qty(period_opening_qty),
            "total_input_qty": _q_qty(tot_in_q),
            "total_input_amount": _q_amt(tot_in_a),
            "total_output_qty": _q_qty(tot_out_q),
            "total_output_amount": _q_amt(tot_out_a),
            "period_closing_qty": _q_qty(running),
            "negative_days_count": negative_days_count,
            "active_days_count": active_days_count,
            "total_days": (to_date - from_date).days + 1,
        },
        "days": days_list,
    }


def export_daily_tax_inventory_excel(daily_data: dict[str, Any]) -> BytesIO:
    """Xuất Nhật ký Nhập – Xuất – Tồn Thuế theo từng ngày ra file Excel (.xlsx)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Nhat_Ky_NXT_Ngay"

    header_fill = PatternFill("solid", fgColor="14263D")
    header_font = Font(bold=True, color="FFFFFF", size=10)
    red_fill = PatternFill("solid", fgColor="FEE2E2")
    red_font = Font(bold=True, color="B91C1C", size=10)
    bold_font = Font(bold=True, size=10)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    ws.merge_cells("A1:H1")
    ws["A1"] = (
        f"NHẬT KÝ NHẬP – XUẤT – TỒN THUẾ TỪNG NGÀY · MÃ {daily_data['sku']}"
        + (f" · MST {daily_data['tax_code']}" if daily_data.get("tax_code") != "ALL" else " · TỔNG HỢP NPP")
    )
    ws["A1"].font = Font(bold=True, size=12, color="14263D")
    ws["A1"].alignment = Alignment(horizontal="center")

    ws.merge_cells("A2:H2")
    ws["A2"] = f"{daily_data.get('product_name', '')} ({daily_data.get('unit_name', '')}) | Từ {daily_data['from_date']} đến {daily_data['to_date']}"
    ws["A2"].font = Font(italic=True, size=10, color="475569")
    ws["A2"].alignment = Alignment(horizontal="center")

    headers = [
        "Ngày",
        "Tồn đầu ngày (SL)",
        "Nhập trong ngày (SL)",
        "Giá trị Nhập (VND)",
        "Xuất trong ngày (SL)",
        "Doanh thu Xuất (VND)",
        "Tồn cuối ngày (SL)",
        "Trạng thái",
    ]
    ws.append([])
    ws.append(headers)
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=4, column=col_idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = thin_border
    ws.row_dimensions[4].height = 24

    for idx, d in enumerate(daily_data.get("days", []), start=5):
        ws.append([
            d["date"],
            d["opening_qty"],
            d["input_qty"],
            d["input_amount"],
            d["output_qty"],
            d["output_amount"],
            d["closing_qty"],
            "ÂM KHO THUẾ" if d["is_negative"] else ("Có phát sinh" if d["has_activity"] else "Ổn định"),
        ])
        for col_idx in range(1, 9):
            c = ws.cell(row=idx, column=col_idx)
            c.border = thin_border
            if col_idx in (2, 3, 4, 5, 6, 7):
                c.number_format = "#,##0.##"
                c.alignment = Alignment(horizontal="right")
            if d["is_negative"]:
                c.fill = red_fill
                if col_idx in (7, 8):
                    c.font = red_font

    s = daily_data.get("summary", {})
    tot_r = len(daily_data.get("days", [])) + 5
    ws.append([
        "TỔNG KỲ",
        s.get("period_opening_qty", 0),
        s.get("total_input_qty", 0),
        s.get("total_input_amount", 0),
        s.get("total_output_qty", 0),
        s.get("total_output_amount", 0),
        s.get("period_closing_qty", 0),
        f"{s.get('negative_days_count', 0)} ngày âm",
    ])
    for col_idx in range(1, 9):
        c = ws.cell(row=tot_r, column=col_idx)
        c.font = bold_font
        c.border = thin_border
        if col_idx in (2, 3, 4, 5, 6, 7):
            c.number_format = "#,##0.##"
            c.alignment = Alignment(horizontal="right")

    for i, w in enumerate([14, 18, 18, 20, 18, 20, 18, 16], start=1):
        ws.column_dimensions[ws.cell(row=4, column=i).column_letter].width = w

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


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
        "Mã SP Xuất Hóa Đơn (*)",
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

    is_npp_mode = (data.get("group_by") or "MST_SKU").upper() == "NPP_SKU"
    headers = [
        "STT",
        "Mã SP XHĐ",
        "Tên SP XHĐ",
        "MST",
        "Tên công ty quản lý",
        "Mã SKU CQT gộp" if is_npp_mode else "Mã SKU CQT",
        "ĐVT",
        "VAT (%)",
        "Tồn đầu kỳ (SL)",
        "Giá trị đầu kỳ TK 156",
        "Nhập CQT (SL)",
        "Giá trị Nhập (VND)",
        "Xuất HĐĐT (SL)",
        "Doanh thu Xuất (VND)",
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
            r.get("invoice_product_code") or r.get("npp_code") or r["sku"],
            r.get("invoice_product_name") or r["product_name"],
            r.get("tax_code") or "",
            r.get("company_name") or "",
            ", ".join(r.get("cqt_skus") or [r["sku"]]),
            r["unit_name"],
            vat_str,
            r.get("opening_qty", 0),
            r.get("opening_amount", 0),
            r["input_qty"],
            r["input_amount"],
            r["output_qty"],
            r["output_amount"],
            r["balance_qty"],
            r.get("ending_inventory_value", 0),
            status_label,
            " | ".join(warns),
        ]
        ws.append(row_vals)
        tot_open_amt += float(r.get("opening_amount") or 0)
        tot_in_amt += float(r.get("input_amount") or 0)
        tot_out_amt += float(r.get("output_amount") or 0)
        tot_end_val += float(r.get("ending_inventory_value") or 0)

        row_num = idx + 1
        for c_i in range(1, len(headers) + 1):
            c = ws.cell(row=row_num, column=c_i)
            c.border = thin_border
            if c_i in (9, 10, 11, 12, 13, 14, 15, 16):
                c.number_format = "#,##0.##"
                c.alignment = Alignment(horizontal="right")
            if c_i == 15:
                if r["status"] == "NEGATIVE":
                    c.font = red_font
                elif r["status"] == "LOW":
                    c.font = amber_font

    tot_row = len(items) + 2
    ws.cell(row=tot_row, column=1, value="TỔNG CỘNG").font = bold_font
    for col_idx, val in [
        (10, tot_open_amt),
        (12, tot_in_amt),
        (14, tot_out_amt),
        (16, tot_end_val),
    ]:
        cell = ws.cell(row=tot_row, column=col_idx, value=round(val, 2))
        cell.font = bold_font
        cell.number_format = "#,##0"
    for c_i in range(1, len(headers) + 1):
        ws.cell(row=tot_row, column=c_i).border = thin_border

    widths = [6, 18, 34, 18, 28, 18, 9, 8, 13, 18, 13, 18, 13, 18, 13, 20, 14, 30]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def export_sku_mapping_explanation_excel(
    db: Session,
    *,
    distributor_id: int | None = None,
    company_tax_code: str | None = None,
) -> BytesIO:
    """Xuất Bảng Giải Trình Ánh Xạ & Quy Đổi Mã Hàng, Tên Hàng Đầu Vào – Đầu Ra (.xlsx) phục vụ quyết toán thuế."""
    data = compute_tax_inventory_by_mst(
        db,
        distributor_id=distributor_id,
        company_tax_code=company_tax_code,
        group_by="NPP_SKU",
        page=1,
        page_size=0,
    )

    wb = Workbook()
    ws = wb.active
    ws.title = "Giai_Trinh_Ma_Hang"

    title_font = Font(bold=True, size=13, color="14263D")
    sub_font = Font(italic=True, size=10, color="475569")
    header_fill = PatternFill("solid", fgColor="14263D")
    header_font = Font(bold=True, color="FFFFFF", size=10)
    warn_font = Font(bold=True, color="B91C1C", size=10)
    ok_font = Font(color="047857", size=10)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    ws.merge_cells("A1:L1")
    ws["A1"] = "BẢNG GIẢI TRÌNH ÁNH XẠ & QUY ĐỔI MÃ HÀNG, TÊN HÀNG ĐẦU VÀO – ĐẦU RA PHỤC VỤ QUYẾT TOÁN THUẾ"
    ws["A1"].font = title_font
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 24

    ws.merge_cells("A2:L2")
    ws["A2"] = (
        f"Căn cứ NĐ 123/2020/NĐ-CP & TT 78/2021/TT-BTC | Ngày lập: {datetime.utcnow().strftime('%d/%m/%Y')}"
        + (f" | MST lọc: {company_tax_code}" if company_tax_code else " | Toàn bộ MST trực thuộc NPP")
    )
    ws["A2"].font = sub_font
    ws["A2"].alignment = Alignment(horizontal="center")

    # Nạp ánh xạ Mã SP DMS -> SP XHĐ kèm tỷ lệ quy đổi để đưa vào Bảng giải trình 3 tầng
    dms_by_ip_id: dict[int, list[str]] = {}
    dp_q = select(
        DistributorProduct.invoice_product_id,
        DistributorProduct.distributor_sku,
        DistributorProduct.unit,
        DistributorProduct.conversion_num,
        DistributorProduct.conversion_den,
    ).where(DistributorProduct.invoice_product_id.is_not(None))
    if distributor_id is not None:
        dp_q = dp_q.where(
            (DistributorProduct.distributor_id == distributor_id)
            | (DistributorProduct.distributor_id.is_(None))
        )
    for d_ip_id, d_sku, d_unit, c_num, c_den in db.execute(dp_q).all():
        if not d_ip_id or not d_sku:
            continue
        cn = max(1, int(c_num or 1))
        cd = max(1, int(c_den or 1))
        ratio_txt = f" ({d_unit or 'DMS'} x{cn}/{cd})" if cn != cd else (f" ({d_unit})" if d_unit else "")
        dms_by_ip_id.setdefault(int(d_ip_id), []).append(f"{d_sku.strip().upper()}{ratio_txt}")

    headers = [
        "STT",
        "Mã SP XHĐ (Chuẩn)",
        "Tên SP XHĐ (Đầu ra)",
        "ĐVT XHĐ (Nhỏ nhất)",
        "Mã SKU CQT (Đầu vào)",
        "Tên hàng gốc (HĐ mua CQT)",
        "ĐVT CQT",
        "Mã SP DMS & Tỷ lệ quy đổi",
        "Thuế suất VAT",
        "Các MST phát sinh",
        "Kiểm tra tuân thủ",
        "Lý do quy đổi / Ghi chú giải trình",
    ]
    ws.append([])  # row 3 blank
    ws.append(headers)  # row 4
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=4, column=col_idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = thin_border
    ws.row_dimensions[4].height = 26

    stt = 0
    for grp in data.get("items", []):
        npp_code = grp.get("npp_code") or grp["sku"]
        npp_name = grp.get("product_name") or ""
        npp_unit = grp.get("unit_name") or ""
        ip_id = grp.get("invoice_product_id")
        has_ip = bool(grp.get("has_invoice_product"))
        dms_str = ", ".join(sorted(set(dms_by_ip_id.get(int(ip_id), [])))) if ip_id else ""
        has_vat_warn = bool(grp.get("has_vat_mismatch"))
        has_unit_warn = bool(grp.get("has_unit_mismatch"))

        # Gom breakdown theo từng mã SKU CQT gốc (tránh lặp nhiều dòng cùng SKU ở nhiều MST)
        by_cqt_sku: dict[str, dict[str, Any]] = {}
        for b in grp.get("mst_breakdown", []):
            c_sku = b["sku"]
            entry = by_cqt_sku.get(c_sku)
            if entry is None:
                entry = {
                    "sku": c_sku,
                    "product_name": b["product_name"],
                    "unit_name": b["unit_name"],
                    "conversion_factor": b.get("conversion_factor", 1),
                    "vat_rate": b.get("vat_rate"),
                    "msts": set(),
                }
                by_cqt_sku[c_sku] = entry
            entry["msts"].add(b["tax_code"])

        for c_sku, info in sorted(by_cqt_sku.items()):
            stt += 1
            vat_v = info["vat_rate"]
            vat_str = "" if vat_v is None else ("KCT" if vat_v < 0 else f"{vat_v:g}%")
            checks: list[str] = []
            if not has_ip:
                checks.append("CẢNH BÁO: SKU CQT chưa gán Sản phẩm XHĐ!")
            if has_vat_warn:
                checks.append("CẢNH BÁO: Lệch thuế suất VAT trong nhóm!")
            if has_unit_warn:
                checks.append("CẢNH BÁO: Khác ĐVT!")
            check_str = " | ".join(checks) if checks else "Hợp lệ"

            if not has_ip:
                reason = "Chưa gán vào danh mục Sản phẩm XHĐ"
            elif c_sku == npp_code:
                reason = "Khớp trực tiếp Mã SP XHĐ & ĐVT nhỏ nhất đầu vào CQT"
            else:
                reason = f"Cùng bản chất hàng hóa, gán về Mã SP XHĐ chuẩn {npp_code} (ĐVT: {npp_unit})"

            row_vals = [
                stt,
                npp_code,
                npp_name,
                npp_unit,
                c_sku,
                info["product_name"],
                info["unit_name"],
                dms_str or "—",
                vat_str,
                ", ".join(sorted(info["msts"])),
                check_str,
                reason,
            ]
            ws.append(row_vals)
            row_num = stt + 4
            for c_i in range(1, len(headers) + 1):
                cell = ws.cell(row=row_num, column=c_i)
                cell.border = thin_border
                if c_i in (1, 4, 7, 8, 9):
                    cell.alignment = Alignment(horizontal="center")
                if c_i == 11:
                    cell.font = warn_font if checks else ok_font

    # Phần chữ ký cuối bảng
    sig_row = stt + 7
    ws.cell(row=sig_row, column=2, value="NGƯỜI LẬP BIỂU").font = Font(bold=True, size=10)
    ws.cell(row=sig_row, column=6, value="KẾ TOÁN TRƯỞNG").font = Font(bold=True, size=10)
    ws.cell(row=sig_row, column=10, value="GIÁM ĐỐC (Ký, đóng dấu)").font = Font(bold=True, size=10)

    widths = [6, 18, 34, 12, 18, 34, 14, 14, 13, 24, 28, 38]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=4, column=i).column_letter].width = w

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


def _parse_year_month(year_month: str) -> tuple[int, int, date, date]:
    import calendar as _cal

    clean = (year_month or "").strip()
    parts = clean.split("-")
    if len(parts) != 2 or not (parts[0].isdigit() and parts[1].isdigit()):
        raise ValueError("Định dạng tháng không hợp lệ. Vui lòng dùng YYYY-MM (VD: 2026-11).")
    year, month = int(parts[0]), int(parts[1])
    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise ValueError("Tháng hoặc năm ngoài phạm vi hợp lệ.")
    _, last_day = _cal.monthrange(year, month)
    return year, month, date(year, month, 1), date(year, month, last_day)


def rebuild_monthly_tax_inventory_snapshots(
    db: Session,
    *,
    distributor_id: int | None,
    year_month: str,
    company_tax_code: str | None = None,
    include_draft: bool = True,
) -> dict[str, Any]:
    """Tính toán & lưu sẵn Snapshot Tồn kho Thuế theo tháng (YYYY-MM) vào bảng `tax_inventory_monthly_snapshots`
    để truy vấn tức thì không cần quét toàn bộ lịch sử XML mỗi lần mở trang."""
    _y, _m, start_d, end_d = _parse_year_month(year_month)
    computed = compute_tax_inventory_by_mst(
        db,
        distributor_id=distributor_id,
        company_tax_code=company_tax_code,
        from_date=start_d,
        to_date=end_d,
        include_draft=include_draft,
        group_by="MST_SKU",
    )

    existing_stmt = select(TaxInventoryMonthlySnapshot).where(
        TaxInventoryMonthlySnapshot.year_month == year_month
    )
    if distributor_id is not None:
        existing_stmt = existing_stmt.where(TaxInventoryMonthlySnapshot.distributor_id == distributor_id)
    else:
        existing_stmt = existing_stmt.where(TaxInventoryMonthlySnapshot.distributor_id.is_(None))
    if company_tax_code:
        existing_stmt = existing_stmt.where(TaxInventoryMonthlySnapshot.tax_code == company_tax_code.strip())

    existing_map = {
        (row.tax_code, row.sku): row for row in db.scalars(existing_stmt).all()
    }
    now = datetime.utcnow()
    upserted = 0
    seen_keys: set[tuple[str, str]] = set()

    for item in computed["items"]:
        mst = item["tax_code"]
        sku = item["sku"]
        seen_keys.add((mst, sku))
        row = existing_map.get((mst, sku))
        if row is None:
            row = TaxInventoryMonthlySnapshot(
                distributor_id=distributor_id,
                tax_code=mst,
                sku=sku,
                year_month=year_month,
            )
            db.add(row)
        row.company_name = item.get("company_name") or ""
        row.product_name = item.get("product_name") or ""
        row.unit_name = item.get("unit_name") or ""
        row.opening_qty = float(item.get("opening_qty") or 0.0)
        row.opening_amount = float(item.get("opening_amount") or 0.0)
        row.input_qty = float(item.get("input_qty") or 0.0)
        row.input_amount = float(item.get("input_amount") or 0.0)
        row.output_qty = float(item.get("output_qty") or 0.0)
        row.output_amount = float(item.get("output_amount") or 0.0)
        row.promo_in_qty = float(item.get("promo_in_qty") or 0.0)
        row.promo_out_qty = float(item.get("promo_out_qty") or 0.0)
        row.avg_unit_cost = float(item.get("avg_unit_cost") or 0.0)
        row.cogs_amount = float(item.get("cogs_amount") or 0.0)
        row.closing_qty = float(item.get("balance_qty") or 0.0)
        row.closing_amount = float(item.get("ending_inventory_value") or 0.0)
        row.computed_at = now
        upserted += 1

    # Xóa các dòng snapshot cũ không còn tồn tại trong kỳ tính lại
    for key, old_row in existing_map.items():
        if key not in seen_keys:
            db.delete(old_row)

    db.commit()
    return {
        "year_month": year_month,
        "distributor_id": distributor_id,
        "upserted_rows": upserted,
        "computed_at": now.isoformat(),
        "summary": computed["summary"],
    }


def list_monthly_tax_inventory_snapshots(
    db: Session,
    *,
    distributor_id: int | None,
    year_month: str,
    company_tax_code: str | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    """Đọc tức thì bảng Snapshot Tồn kho Thuế theo tháng (O(1) SQL, không quét XML)."""
    _parse_year_month(year_month)
    stmt = (
        select(TaxInventoryMonthlySnapshot)
        .where(TaxInventoryMonthlySnapshot.year_month == year_month)
        .order_by(TaxInventoryMonthlySnapshot.tax_code.asc(), TaxInventoryMonthlySnapshot.sku.asc())
    )
    if distributor_id is not None:
        stmt = stmt.where(TaxInventoryMonthlySnapshot.distributor_id == distributor_id)
    if company_tax_code:
        stmt = stmt.where(TaxInventoryMonthlySnapshot.tax_code == company_tax_code.strip())

    rows = db.scalars(stmt).all()
    q = (search or "").strip().lower()
    items: list[dict[str, Any]] = []
    total_opening_amt = 0.0
    total_input_amt = 0.0
    total_output_amt = 0.0
    total_cogs_amt = 0.0
    total_closing_amt = 0.0
    negative_count = 0
    latest_computed: datetime | None = None

    for r in rows:
        if q and not (
            q in (r.sku or "").lower()
            or q in (r.product_name or "").lower()
            or q in (r.tax_code or "").lower()
            or q in (r.company_name or "").lower()
        ):
            continue
        if latest_computed is None or (r.computed_at and r.computed_at > latest_computed):
            latest_computed = r.computed_at
        if r.closing_qty < -1e-6:
            negative_count += 1
        total_opening_amt += float(r.opening_amount or 0)
        total_input_amt += float(r.input_amount or 0)
        total_output_amt += float(r.output_amount or 0)
        total_cogs_amt += float(r.cogs_amount or 0)
        total_closing_amt += float(r.closing_amount or 0)
        items.append(
            {
                "id": r.id,
                "tax_code": r.tax_code,
                "company_name": r.company_name,
                "sku": r.sku,
                "product_name": r.product_name,
                "unit_name": r.unit_name,
                "year_month": r.year_month,
                "opening_qty": r.opening_qty,
                "opening_amount": float(r.opening_amount or 0),
                "input_qty": r.input_qty,
                "input_amount": float(r.input_amount or 0),
                "output_qty": r.output_qty,
                "output_amount": float(r.output_amount or 0),
                "promo_in_qty": r.promo_in_qty,
                "promo_out_qty": r.promo_out_qty,
                "promo_balance_qty": round(r.promo_in_qty - r.promo_out_qty, 4),
                "avg_unit_cost": float(r.avg_unit_cost or 0),
                "cogs_amount": float(r.cogs_amount or 0),
                "closing_qty": r.closing_qty,
                "closing_amount": float(r.closing_amount or 0),
                "computed_at": r.computed_at.isoformat() if r.computed_at else None,
            }
        )

    return {
        "year_month": year_month,
        "computed_at": latest_computed.isoformat() if latest_computed else None,
        "summary": {
            "total_skus": len(items),
            "negative_count": negative_count,
            "total_opening_amount": round(total_opening_amt, 2),
            "total_input_amount": round(total_input_amt, 2),
            "total_output_amount": round(total_output_amt, 2),
            "total_cogs_amount": round(total_cogs_amt, 2),
            "total_closing_amount": round(total_closing_amt, 2),
        },
        "items": items,
    }
