from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from decimal import Decimal
import time
from typing import Any
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Company
from app.models.multi_tenant_invoice import (
    IssuedInvoice,
    IssuedInvoiceItem,
    TaxAuthorityCredential,
)
from app.services.gdt_purchase_invoice_service import (
    DEFAULT_HEADERS,
    GDT_BASE_URL,
    GDT_MAX_XML_WORKERS,
    _download_and_extract_invoice_zip,
    _gdt_get,
    _parse_invoice_datetime,
    normalize_bearer_token,
    parse_gdt_invoice_xml,
    split_date_range_monthly,
)


def _norm_str(val: Any) -> str:
    return str(val or "").strip()


def _norm_mst(val: Any) -> str:
    return "".join(ch for ch in _norm_str(val) if ch.isalnum() or ch == "-").upper()


def _to_dec(val: Any) -> Decimal:
    try:
        return Decimal(str(val or 0))
    except Exception:
        return Decimal("0")


def _tchat_to_item_type(tchat: int | None) -> str:
    if tchat == 2:
        return "PROMOTION"
    if tchat == 3:
        return "DISCOUNT"
    if tchat == 4:
        return "NOTE"
    return "NORMAL"


def _gdt_tthai_to_status(tthai: Any) -> str:
    try:
        code = int(str(tthai).strip())
    except (TypeError, ValueError):
        return "ISSUED"
    if code == 6:
        return "CANCELLED"
    if code == 4:
        return "REPLACED"
    return "ISSUED"


def _gdt_tthai_to_invoice_type(tthai: Any, tchdon: Any) -> str:
    try:
        t_code = int(str(tthai).strip()) if tthai is not None else None
    except (TypeError, ValueError):
        t_code = None
    tc_str = _norm_str(tchdon)
    if t_code == 3 or tc_str == "2":
        return "ADJUSTMENT"
    if t_code == 2 or tc_str == "1":
        return "REPLACEMENT"
    return "ORIGINAL"


def reconcile_gdt_sold_invoice_records(
    db: Session,
    *,
    distributor_id: int,
    seller_tax_code: str,
    records: list[dict[str, Any]],
    from_date: date | None = None,
    to_date: date | None = None,
) -> dict[str, Any]:
    """Lưu & tự động đối chiếu danh sách Hóa đơn BÁN RA từ Cổng CQT với các lô Nháp/Excel (`IssuedInvoice` status=DRAFT).

    Quy tắc đối chiếu (Auto-Reconcile):
    1. Nếu đã có `IssuedInvoice` trùng `(distributor_id, seller_tax_code, invoice_series, invoice_number)`:
       cập nhật trạng thái mới nhất từ CQT (VD: đã bị hủy/thay thế trên Viettel) và bổ sung dòng hàng nếu thiếu.
    2. Nếu chưa có, tìm `IssuedInvoice` đang ở trạng thái `DRAFT` cùng `(distributor_id, seller_tax_code)` thỏa mãn:
       - Cùng `buyer_tax_code` (chuẩn hóa) VÀ chênh lệch `total_payment` <= 5 VNĐ VÀ ngày lập lệch <= 7 ngày.
       -> Tự động nâng cấp DRAFT thành `ISSUED` (hoặc `CANCELLED`/`REPLACED` theo CQT), điền Số HĐ thật, Ký hiệu thật, Mã CQT thật!
    3. Nếu không khớp DRAFT nào (kế toán tự lập trực tiếp trên Viettel/MISA):
       -> Tự tạo mới bản ghi `IssuedInvoice` (`provider="GDT_CQT"`) kèm chi tiết dòng hàng XML để Kho Thuế TK 156 luôn khớp 100% với CQT.
    """
    clean_seller_mst = _norm_mst(seller_tax_code)

    seller_company = db.scalar(
        select(Company).where(
            Company.distributor_id == distributor_id,
            Company.tax_code == clean_seller_mst,
        )
    )
    seller_company_id = seller_company.id if seller_company else None

    existing_issued = db.scalars(
        select(IssuedInvoice)
        .options(selectinload(IssuedInvoice.items))
        .where(
            IssuedInvoice.distributor_id == distributor_id,
            IssuedInvoice.seller_tax_code == clean_seller_mst,
        )
    ).all()

    by_inv_key: dict[tuple[str, str], IssuedInvoice] = {}
    draft_candidates: list[IssuedInvoice] = []
    for inv in existing_issued:
        if inv.status == "DRAFT" and not inv.invoice_number:
            draft_candidates.append(inv)
        elif inv.invoice_number:
            key = (_norm_str(inv.invoice_series).upper(), _norm_str(inv.invoice_number).lstrip("0") or "0")
            by_inv_key[key] = inv

    matched_drafts = 0
    created_from_cqt = 0
    updated_existing = 0
    cancelled_or_replaced = 0
    matched_draft_ids: set[int] = set()

    for rec in records:
        inv_series = _norm_str(rec.get("invoice_series") or rec.get("khhdon")).upper()
        inv_number = _norm_str(rec.get("invoice_number") or rec.get("shdon"))
        inv_template = _norm_str(rec.get("invoice_template") or rec.get("khmshdon") or "1")
        if not inv_number:
            continue

        norm_num_key = inv_number.lstrip("0") or "0"
        inv_key = (inv_series, norm_num_key)
        cqt_status = _gdt_tthai_to_status(rec.get("tthai"))
        cqt_inv_type = _gdt_tthai_to_invoice_type(rec.get("tthai"), rec.get("tchdon"))
        if cqt_status in ("CANCELLED", "REPLACED"):
            cancelled_or_replaced += 1

        cqt_code = _norm_str(rec.get("tax_authority_code") or rec.get("mhdon") or rec.get("mccqt")) or None
        buyer_mst = _norm_mst(rec.get("buyer_tax_code") or rec.get("nmmst"))
        buyer_name = _norm_str(rec.get("buyer_name") or rec.get("nmten") or "Khách lẻ")
        inv_dt = rec.get("invoice_date")
        if not isinstance(inv_dt, datetime):
            inv_dt = _parse_invoice_datetime(inv_dt or rec.get("tdlap") or rec.get("invoice_date_str"))
        amount_before_tax = float(_to_dec(rec.get("amount_before_tax")))
        tax_amount = float(_to_dec(rec.get("tax_amount")))
        total_amount = float(_to_dec(rec.get("total_amount")))
        parsed_items: list[dict[str, Any]] = rec.get("items") or []

        existing_inv = by_inv_key.get(inv_key)
        if existing_inv is not None:
            existing_inv.status = cqt_status
            existing_inv.invoice_type = cqt_inv_type
            if cqt_code:
                existing_inv.tax_authority_code = cqt_code
            if inv_dt:
                existing_inv.issued_at = inv_dt
            resp_meta = dict(existing_inv.provider_response or {})
            resp_meta.update(
                {
                    "cqt_synced": True,
                    "cqt_tthai": rec.get("tthai"),
                    "cqt_synced_at": datetime.utcnow().isoformat(),
                }
            )
            existing_inv.provider_response = resp_meta
            if not existing_inv.items and parsed_items:
                for idx, it in enumerate(parsed_items, start=1):
                    item_type = _tchat_to_item_type(it.get("item_nature"))
                    qty = float(_to_dec(it.get("quantity")))
                    amt_before = float(_to_dec(it.get("amount_before_tax")))
                    db.add(
                        IssuedInvoiceItem(
                            invoice_id=existing_inv.id,
                            line_number=int(it.get("line_number") or idx),
                            item_type=item_type,
                            product_code=_norm_str(it.get("product_code") or f"ITEM-{idx}"),
                            product_name=_norm_str(it.get("product_name") or "Hàng hóa"),
                            unit_name=_norm_str(it.get("unit_name") or "Hộp"),
                            quantity=qty,
                            unit_price=float(_to_dec(it.get("unit_price"))),
                            discount_amount=float(_to_dec(it.get("discount_amount"))),
                            amount_before_tax=amt_before,
                            vat_rate=0.0,
                            vat_amount=0.0,
                            total_amount=amt_before,
                            source_sku=_norm_str(it.get("product_code") or f"ITEM-{idx}"),
                            source_quantity=qty,
                            source_unit=_norm_str(it.get("unit_name") or "Hộp"),
                        )
                    )
            updated_existing += 1
            continue

        # Tìm DRAFT phù hợp để tự động đối chiếu (Auto-Reconcile)
        matched_draft: IssuedInvoice | None = None
        for cand in draft_candidates:
            if cand.id in matched_draft_ids:
                continue
            cand_buyer_mst = _norm_mst(cand.buyer_tax_code)
            if buyer_mst and cand_buyer_mst and cand_buyer_mst != buyer_mst:
                continue
            if not buyer_mst and cand_buyer_mst:
                continue
            diff_amt = abs(_to_dec(cand.total_payment) - _to_dec(total_amount))
            if diff_amt > Decimal("5"):
                continue
            if inv_dt and cand.created_at:
                delta_days = abs((inv_dt.date() - cand.created_at.date()).days)
                if delta_days > 7:
                    continue
            matched_draft = cand
            break

        if matched_draft is not None:
            matched_draft_ids.add(matched_draft.id)
            matched_draft.status = cqt_status
            matched_draft.invoice_type = cqt_inv_type
            matched_draft.invoice_template_code = inv_template or matched_draft.invoice_template_code
            matched_draft.invoice_series = inv_series or matched_draft.invoice_series
            matched_draft.invoice_number = inv_number
            matched_draft.tax_authority_code = cqt_code
            if inv_dt:
                matched_draft.issued_at = inv_dt
            resp_meta = dict(matched_draft.provider_response or {})
            resp_meta.update(
                {
                    "cqt_reconciled": True,
                    "cqt_synced": True,
                    "cqt_tthai": rec.get("tthai"),
                    "cqt_synced_at": datetime.utcnow().isoformat(),
                }
            )
            matched_draft.provider_response = resp_meta
            by_inv_key[inv_key] = matched_draft
            matched_drafts += 1
            continue

        # Không có DRAFT -> Tạo mới IssuedInvoice trực tiếp từ dữ liệu CQT bán ra
        new_inv = IssuedInvoice(
            distributor_id=distributor_id,
            seller_company_id=seller_company_id,
            seller_tax_code=clean_seller_mst,
            provider="GDT_CQT",
            invoice_template_code=inv_template,
            invoice_series=inv_series,
            invoice_number=inv_number,
            tax_authority_code=cqt_code,
            transaction_id=f"GDT-SOLD-{clean_seller_mst}-{inv_series}-{inv_number}",
            status=cqt_status,
            invoice_type=cqt_inv_type,
            supplier_code="GDT_CQT",
            source_order_numbers=[],
            buyer_code=buyer_mst or None,
            buyer_name=buyer_name,
            buyer_legal_name=buyer_name,
            buyer_tax_code=buyer_mst or None,
            subtotal_before_tax=amount_before_tax,
            vat_amount=tax_amount,
            total_payment=total_amount,
            provider_response={
                "cqt_synced": True,
                "cqt_only": True,
                "cqt_tthai": rec.get("tthai"),
                "cqt_synced_at": datetime.utcnow().isoformat(),
            },
            issued_by="GDT_CQT_SYNC",
            issued_at=inv_dt or datetime.utcnow(),
        )
        db.add(new_inv)
        db.flush()

        for idx, it in enumerate(parsed_items, start=1):
            item_type = _tchat_to_item_type(it.get("item_nature"))
            qty = float(_to_dec(it.get("quantity")))
            amt_before = float(_to_dec(it.get("amount_before_tax")))
            vat_raw = _norm_str(it.get("vat_rate")).replace("%", "").strip()
            try:
                vat_num = float(vat_raw) if vat_raw and vat_raw.upper() not in ("KCT", "KKKNT") else 0.0
            except ValueError:
                vat_num = 0.0
            vat_amt = round(amt_before * vat_num / 100.0, 2) if vat_num > 0 else 0.0
            db.add(
                IssuedInvoiceItem(
                    invoice_id=new_inv.id,
                    line_number=int(it.get("line_number") or idx),
                    item_type=item_type,
                    product_code=_norm_str(it.get("product_code") or f"ITEM-{idx}"),
                    product_name=_norm_str(it.get("product_name") or "Hàng hóa"),
                    unit_name=_norm_str(it.get("unit_name") or "Hộp"),
                    quantity=qty,
                    unit_price=float(_to_dec(it.get("unit_price"))),
                    discount_amount=float(_to_dec(it.get("discount_amount"))),
                    amount_before_tax=amt_before,
                    vat_rate=vat_num,
                    vat_amount=vat_amt,
                    total_amount=amt_before + vat_amt,
                    source_sku=_norm_str(it.get("product_code") or f"ITEM-{idx}"),
                    source_quantity=qty,
                    source_unit=_norm_str(it.get("unit_name") or "Hộp"),
                )
            )
        by_inv_key[inv_key] = new_inv
        created_from_cqt += 1

    db.commit()

    # Đếm các DRAFT còn tồn đọng chưa thấy xuất hiện trên CQT trong kỳ
    pending_drafts: list[dict[str, Any]] = []
    for cand in draft_candidates:
        if cand.id in matched_draft_ids:
            continue
        c_date = cand.created_at.date() if cand.created_at else None
        if from_date and c_date and c_date < from_date:
            continue
        if to_date and c_date and c_date > to_date:
            continue
        pending_drafts.append(
            {
                "id": cand.id,
                "buyer_name": cand.buyer_name,
                "buyer_tax_code": cand.buyer_tax_code,
                "total_payment": float(_to_dec(cand.total_payment)),
                "source_order_numbers": cand.source_order_numbers or [],
                "created_at": cand.created_at.isoformat() if cand.created_at else None,
            }
        )

    return {
        "seller_tax_code": clean_seller_mst,
        "total_cqt_invoices": len(records),
        "matched_drafts": matched_drafts,
        "created_from_cqt": created_from_cqt,
        "updated_existing": updated_existing,
        "cancelled_or_replaced": cancelled_or_replaced,
        "pending_drafts_count": len(pending_drafts),
        "pending_drafts": pending_drafts,
    }


def sync_gdt_sold_invoices(
    db: Session,
    *,
    distributor_id: int,
    tax_credential_id: int,
    from_date: date,
    to_date: date,
    bearer_token: str,
    progress_callback: Any = None,
) -> dict[str, Any]:
    """Đồng bộ Hóa đơn điện tử BÁN RA từ Cổng Tổng cục Thuế (hoadondientu.gdt.gov.vn)
    và tự động đối chiếu với các Hóa đơn nháp / Excel Viettel đã xuất."""
    norm_token = normalize_bearer_token(bearer_token)
    if not norm_token:
        raise PermissionError("CQT_TOKEN_EXPIRED")

    cred = db.get(TaxAuthorityCredential, tax_credential_id)
    if not cred or cred.distributor_id != distributor_id:
        raise ValueError("Không tìm thấy tài khoản Cổng Tổng cục Thuế thuộc Nhà phân phối này.")

    date_chunks = split_date_range_monthly(from_date, to_date)
    if not date_chunks:
        raise ValueError("Khoảng ngày tra cứu không hợp lệ.")

    searches_to_run = [
        {"ttxly": "5", "is_mtt": False, "category": "CO_MA"},
        {"ttxly": "6", "is_mtt": False, "category": "KHONG_MA"},
        {"ttxly": "8", "is_mtt": True, "category": "MAY_TINH_TIEN"},
    ]

    all_raw_items: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    warnings: list[str] = []

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        for chunk_idx, (chunk_start, chunk_end) in enumerate(date_chunks):
            date_from_fmt = f"{chunk_start:%d/%m/%Y}T00:00:00"
            date_to_fmt = f"{chunk_end:%d/%m/%Y}T23:59:59"

            for job_idx, job in enumerate(searches_to_run):
                if chunk_idx > 0 or job_idx > 0:
                    time.sleep(0.8)
                ttxly = job["ttxly"]
                api_endpoint = f"{GDT_BASE_URL}/api/query/invoices/sold"
                action_header = "T%C3%ACm%20ki%E1%BA%BFm%20(h%C3%B3a%20%C4%91%C6%A1n%20b%C3%A1n%20ra)"
                search_param = f"tdlap=ge={date_from_fmt};tdlap=le={date_to_fmt};ttxly=={ttxly}"

                state: str | None = None
                for _ in range(50):
                    headers = {
                        **DEFAULT_HEADERS,
                        "Authorization": norm_token,
                        "request-id": str(uuid.uuid4()),
                        "Action": action_header,
                        "End-Point": "/tra-cuu/tra-cuu-hoa-don",
                        "Referer": f"{GDT_BASE_URL}/tra-cuu/tra-cuu-hoa-don",
                    }
                    state_param = f"&state={state}" if state else ""
                    url = f"{api_endpoint}?sort=tdlap:desc&size=50{state_param}&search={search_param}"
                    try:
                        resp = _gdt_get(client, url, headers=headers)
                    except RuntimeError as exc:
                        warnings.append(f"HĐ bán ra ({job['category']}): {exc}")
                        break

                    if resp.status_code == 401:
                        raise PermissionError("CQT_TOKEN_EXPIRED")
                    if resp.status_code != 200:
                        warnings.append(f"HĐ bán ra ({job['category']}): HTTP {resp.status_code}")
                        break

                    body = resp.json()
                    datas = body.get("datas") or []
                    for item in datas:
                        key = f"{item.get('nbmst')}|{item.get('khmshdon')}|{item.get('khhdon')}|{item.get('shdon')}"
                        if key not in seen_keys:
                            seen_keys.add(key)
                            item["_is_mtt"] = job["is_mtt"]
                            all_raw_items.append(item)

                    state = body.get("state")
                    if not state or len(datas) < 50:
                        break

        # Tải song song XML cho các hóa đơn bán ra
        parsed_records: list[dict[str, Any]] = []

        def _fetch_one(raw_it: dict[str, Any]) -> dict[str, Any]:
            nbmst = _norm_str(raw_it.get("nbmst") or cred.username)
            khhdon = _norm_str(raw_it.get("khhdon"))
            shdon = _norm_str(raw_it.get("shdon"))
            khmshdon = _norm_str(raw_it.get("khmshdon") or "1")
            xml_text, _ = _download_and_extract_invoice_zip(
                client, norm_token, nbmst, khhdon, shdon, khmshdon, bool(raw_it.get("_is_mtt"))
            )
            parsed = parse_gdt_invoice_xml(xml_text) if xml_text else {}
            return {
                "invoice_template": parsed.get("invoice_template") or khmshdon,
                "invoice_series": parsed.get("invoice_series") or khhdon,
                "invoice_number": parsed.get("invoice_number") or shdon,
                "invoice_date": _parse_invoice_datetime(
                    parsed.get("invoice_date_str") or raw_it.get("tdlap")
                ),
                "tax_authority_code": raw_it.get("mhdon") or raw_it.get("mccqt"),
                "tthai": raw_it.get("tthai"),
                "tchdon": raw_it.get("tchdon"),
                "buyer_tax_code": parsed.get("buyer_tax_code") or raw_it.get("nmmst"),
                "buyer_name": parsed.get("buyer_name") or raw_it.get("nmten"),
                "amount_before_tax": parsed.get("amount_before_tax") or raw_it.get("tgtcthue") or 0,
                "tax_amount": parsed.get("tax_amount") or raw_it.get("tgtthue") or 0,
                "total_amount": parsed.get("total_amount") or raw_it.get("tgtttbso") or 0,
                "items": parsed.get("items") or [],
            }

        if all_raw_items:
            with ThreadPoolExecutor(max_workers=GDT_MAX_XML_WORKERS) as pool:
                futures = [pool.submit(_fetch_one, raw_it) for raw_it in all_raw_items]
                for fut in as_completed(futures):
                    try:
                        parsed_records.append(fut.result())
                    except Exception as exc:
                        warnings.append(f"Lỗi tải XML hóa đơn bán ra: {exc}")

    reconcile_summary = reconcile_gdt_sold_invoice_records(
        db,
        distributor_id=distributor_id,
        seller_tax_code=_norm_str(cred.username),
        records=parsed_records,
        from_date=from_date,
        to_date=to_date,
    )
    cred.last_synced_at = datetime.utcnow()
    db.commit()

    return {
        **reconcile_summary,
        "warnings": warnings,
    }


def get_sales_reconciliation_report(
    db: Session,
    *,
    distributor_id: int | None = None,
    seller_tax_code: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> dict[str, Any]:
    """Báo cáo đối chiếu 3 chiều: Đơn DMS/Excel Draft <-> Hóa đơn bán ra CQT thật."""
    stmt = select(IssuedInvoice).order_by(IssuedInvoice.id.desc())
    if distributor_id is not None:
        stmt = stmt.where(IssuedInvoice.distributor_id == distributor_id)
    if seller_tax_code:
        stmt = stmt.where(IssuedInvoice.seller_tax_code == _norm_mst(seller_tax_code))

    invoices = db.scalars(stmt).all()
    reconciled: list[dict[str, Any]] = []
    cqt_only: list[dict[str, Any]] = []
    pending_drafts: list[dict[str, Any]] = []
    cancelled_or_replaced: list[dict[str, Any]] = []

    for inv in invoices:
        inv_dt = (inv.issued_at or inv.created_at)
        inv_d = inv_dt.date() if inv_dt else None
        if from_date and inv_d and inv_d < from_date:
            continue
        if to_date and inv_d and inv_d > to_date:
            continue

        resp = inv.provider_response if isinstance(inv.provider_response, dict) else {}
        row = {
            "id": inv.id,
            "seller_tax_code": inv.seller_tax_code,
            "invoice_series": inv.invoice_series,
            "invoice_number": inv.invoice_number,
            "tax_authority_code": inv.tax_authority_code,
            "status": inv.status,
            "provider": inv.provider,
            "buyer_name": inv.buyer_name,
            "buyer_tax_code": inv.buyer_tax_code,
            "total_payment": float(_to_dec(inv.total_payment)),
            "source_order_numbers": inv.source_order_numbers or [],
            "issued_at": inv.issued_at.isoformat() if inv.issued_at else None,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
        }

        if inv.status in ("CANCELLED", "REPLACED"):
            cancelled_or_replaced.append(row)
        elif inv.status == "DRAFT":
            pending_drafts.append(row)
        elif resp.get("cqt_only") or inv.provider == "GDT_CQT":
            cqt_only.append(row)
        elif resp.get("cqt_reconciled") or resp.get("cqt_synced"):
            reconciled.append(row)
        else:
            reconciled.append(row)

    return {
        "summary": {
            "reconciled_count": len(reconciled),
            "cqt_only_count": len(cqt_only),
            "pending_drafts_count": len(pending_drafts),
            "cancelled_or_replaced_count": len(cancelled_or_replaced),
            "reconciled_amount": sum(r["total_payment"] for r in reconciled),
            "cqt_only_amount": sum(r["total_payment"] for r in cqt_only),
            "pending_drafts_amount": sum(r["total_payment"] for r in pending_drafts),
        },
        "reconciled": reconciled,
        "cqt_only": cqt_only,
        "pending_drafts": pending_drafts,
        "cancelled_or_replaced": cancelled_or_replaced,
    }
