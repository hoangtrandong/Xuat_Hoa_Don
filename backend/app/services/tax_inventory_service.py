from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Company
from app.models.multi_tenant_invoice import (
    Distributor,
    IssuedInvoice,
    IssuedInvoiceItem,
    PurchaseInvoice,
    PurchaseInvoiceItem,
    TaxAuthorityCredential,
)
from app.models.product import Product


def compute_tax_inventory_by_mst(
    db: Session,
    *,
    distributor_id: int | None = None,
    company_tax_code: str | None = None,
    search: str | None = None,
    only_negative: bool = False,
) -> dict[str, Any]:
    """Tính sổ Nhập – Xuất – Tồn Thuế theo từng cặp (MST pháp nhân, Mã SKU đầu vào CQT).

    - Nhập (Input): Tổng SL từ PurchaseInvoiceItem thuộc PurchaseInvoice (tự trừ lùi HĐ bị thay thế).
    - Xuất (Output): Tổng SL từ IssuedInvoiceItem thuộc IssuedInvoice không bị CANCELLED / REPLACED.
      + Nếu dòng có `source_quantity` (đã quy đổi quy cách), dùng `source_quantity` để khớp ĐVT đầu vào.
      + Nếu là hóa đơn ADJUSTMENT (điều chỉnh giảm trả hàng, SL âm), phép cộng tự động hoàn tồn kho thuế.
    """
    # 1. Nạp danh mục Công ty & NPP để map MST -> Tên pháp nhân
    comp_stmt = select(Company)
    if distributor_id is not None:
        comp_stmt = comp_stmt.where(Company.distributor_id == distributor_id)
    company_name_by_mst: dict[str, str] = {}
    for c in db.scalars(comp_stmt).all():
        mst = (c.tax_code or "").strip()
        if mst and mst not in company_name_by_mst:
            company_name_by_mst[mst] = c.short_name or c.name

    dist_mst_by_id: dict[int, str] = {}
    for d in db.scalars(select(Distributor)).all():
        if d.tax_code:
            dist_mst_by_id[d.id] = d.tax_code.strip()

    # 2. Quét Hóa đơn mua vào CQT (Đầu vào)
    purch_stmt = (
        select(PurchaseInvoice)
        .options(
            selectinload(PurchaseInvoice.items),
            selectinload(PurchaseInvoice.tax_credential),
        )
    )
    if distributor_id is not None:
        purch_stmt = purch_stmt.where(PurchaseInvoice.distributor_id == distributor_id)
    purchase_invoices = list(db.scalars(purch_stmt).all())

    replaced_shds: set[str] = set()
    for inv in purchase_invoices:
        if inv.replaced_invoice_number:
            for part in inv.replaced_invoice_number.split("/"):
                clean = part.strip()
                if clean:
                    replaced_shds.add(clean)

    ledger: dict[tuple[str, str], dict[str, Any]] = {}

    for inv in purchase_invoices:
        mst = (
            inv.buyer_tax_code
            or (inv.tax_credential.username if inv.tax_credential else None)
            or dist_mst_by_id.get(inv.distributor_id)
            or ""
        ).strip()
        if not mst:
            continue
        if inv.buyer_name and mst not in company_name_by_mst:
            company_name_by_mst[mst] = inv.buyer_name.strip()

        is_replaced = (inv.invoice_number or "").strip() in replaced_shds
        mult = -1.0 if is_replaced else 1.0

        for it in inv.items:
            sku = (it.product_code or "").strip().upper()
            if not sku:
                continue
            key = (mst, sku)
            rec = ledger.get(key)
            if rec is None:
                rec = {
                    "tax_code": mst,
                    "company_name": company_name_by_mst.get(mst, f"MST {mst}"),
                    "sku": sku,
                    "product_name": (it.product_name or "").strip(),
                    "unit_name": (it.unit_name or "").strip(),
                    "input_qty": 0.0,
                    "input_amount": 0.0,
                    "output_qty": 0.0,
                    "output_amount": 0.0,
                    "adjustment_qty": 0.0,
                }
                ledger[key] = rec
            rec["input_qty"] += float(it.quantity or 0.0) * mult
            rec["input_amount"] += float(it.amount_before_tax or 0.0) * mult

    # 3. Quét Hóa đơn bán ra đã phát hành (Đầu ra & Điều chỉnh trả hàng)
    issued_stmt = (
        select(IssuedInvoice)
        .options(selectinload(IssuedInvoice.items))
        .where(IssuedInvoice.status.notin_(("CANCELLED", "REPLACED")))
    )
    if distributor_id is not None:
        issued_stmt = issued_stmt.where(IssuedInvoice.distributor_id == distributor_id)
    issued_invoices = list(db.scalars(issued_stmt).all())

    for inv in issued_invoices:
        mst = (inv.seller_tax_code or dist_mst_by_id.get(inv.distributor_id) or "").strip()
        if not mst:
            continue
        is_adjustment = (inv.invoice_type or "ORIGINAL").upper() == "ADJUSTMENT"
        for it in inv.items:
            if (it.item_type or "NORMAL").upper() not in ("NORMAL", "PROMOTION", "ADJUSTMENT"):
                continue
            sku = (it.source_sku or it.product_code or "").strip().upper()
            if not sku:
                continue
            qty_in_source_unit = (
                float(it.source_quantity)
                if it.source_quantity is not None
                else float(it.quantity or 0.0)
            )
            key = (mst, sku)
            rec = ledger.get(key)
            if rec is None:
                rec = {
                    "tax_code": mst,
                    "company_name": company_name_by_mst.get(mst, f"MST {mst}"),
                    "sku": sku,
                    "product_name": (it.product_name or "").strip(),
                    "unit_name": (it.source_unit or it.unit_name or "").strip(),
                    "input_qty": 0.0,
                    "input_amount": 0.0,
                    "output_qty": 0.0,
                    "output_amount": 0.0,
                    "adjustment_qty": 0.0,
                }
                ledger[key] = rec
            rec["output_qty"] += qty_in_source_unit
            rec["output_amount"] += float(it.amount_before_tax or 0.0)
            if is_adjustment:
                rec["adjustment_qty"] += qty_in_source_unit

    # 4. Chuẩn hóa tên sản phẩm từ bảng products (nếu có) & tính tồn kho chéo giữa các MST
    all_skus = list({sku for _, sku in ledger.keys()})
    prod_info: dict[str, tuple[str, float | None]] = {}
    if all_skus:
        for p in db.scalars(select(Product).where(Product.sku.in_(all_skus))).all():
            prod_info[p.sku.strip().upper()] = (p.name, p.vat_rate)

    sku_positive_by_mst: dict[str, list[dict[str, Any]]] = {}
    balance_lookup: dict[tuple[str, str], float] = {}
    for (mst, sku), rec in ledger.items():
        bal = round(rec["input_qty"] - rec["output_qty"], 4)
        balance_lookup[(mst, sku)] = bal
        if bal > 0:
            sku_positive_by_mst.setdefault(sku, []).append(
                {
                    "tax_code": mst,
                    "company_name": rec["company_name"],
                    "balance_qty": bal,
                }
            )

    rows: list[dict[str, Any]] = []
    negative_count = 0
    low_count = 0
    ok_count = 0
    mst_filter = (company_tax_code or "").strip()
    search_term = (search or "").strip().lower()

    for (mst, sku), rec in ledger.items():
        bal = balance_lookup[(mst, sku)]
        status = "NEGATIVE" if bal < -1e-6 else ("LOW" if bal <= 5 else "OK")
        if status == "NEGATIVE":
            negative_count += 1
        elif status == "LOW":
            low_count += 1
        else:
            ok_count += 1

        if mst_filter and mst != mst_filter:
            continue
        if only_negative and status != "NEGATIVE":
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
                "input_qty": round(rec["input_qty"], 4),
                "input_amount": round(rec["input_amount"], 2),
                "output_qty": round(rec["output_qty"], 4),
                "output_amount": round(rec["output_amount"], 2),
                "adjustment_qty": round(rec["adjustment_qty"], 4),
                "balance_qty": bal,
                "status": status,
                "other_mst_stocks": other_stocks,
            }
        )

    rows.sort(key=lambda r: (0 if r["status"] == "NEGATIVE" else 1, r["tax_code"], r["sku"]))
    available_msts = sorted(
        [
            {"tax_code": mst, "company_name": company_name_by_mst.get(mst, f"MST {mst}")}
            for mst in {k[0] for k in ledger.keys()}
        ],
        key=lambda x: x["tax_code"],
    )

    return {
        "summary": {
            "total_records": len(ledger),
            "negative_count": negative_count,
            "low_count": low_count,
            "ok_count": ok_count,
            "mst_count": len(available_msts),
        },
        "available_msts": available_msts,
        "items": rows,
        "balance_lookup": balance_lookup,
        "sku_positive_by_mst": sku_positive_by_mst,
    }


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
    """Tạo Hóa đơn Điều chỉnh giảm (ADJUSTMENT) hoặc Thay thế (REPLACEMENT) theo NĐ 123 / TT 78.

    - ADJUSTMENT: Ghi nhận dòng hàng trả lại / giảm trừ với SL và Thành tiền ÂM -> tự hoàn tồn kho thuế.
      Hóa đơn gốc chuyển status = 'ADJUSTED'.
    - REPLACEMENT: Ghi nhận toàn bộ danh sách dòng hàng mới sau trả hàng -> Hóa đơn gốc chuyển status = 'REPLACED'
      (không còn tính vào đầu ra tồn kho thuế).
    """
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

    subtotal = 0.0
    total_vat = 0.0
    total_payment = 0.0
    new_items: list[IssuedInvoiceItem] = []

    for idx, row in enumerate(items_payload, start=1):
        parent_it = (
            parent_items_by_id.get(row.get("parent_item_id"))
            if row.get("parent_item_id") is not None
            else parent_items_by_code.get(str(row.get("product_code") or "").strip().upper())
        )
        raw_qty = float(row.get("quantity") or 0.0)
        if clean_mode == "ADJUSTMENT":
            # Điều chỉnh giảm hàng trả lại: luôn chuẩn hóa về số âm
            qty = -abs(raw_qty) if raw_qty != 0 else 0.0
        else:
            qty = max(0.0, raw_qty)
        if qty == 0:
            continue

        unit_price = float(
            row.get("unit_price")
            if row.get("unit_price") is not None
            else (parent_it.unit_price if parent_it else 0.0)
        )
        vat_rate = float(
            row.get("vat_rate")
            if row.get("vat_rate") is not None
            else (parent_it.vat_rate if parent_it else parent_invoice.vat_rate)
        )
        amt_before_tax = (
            float(row["amount_before_tax"])
            if row.get("amount_before_tax") is not None
            else round(qty * unit_price, 2)
        )
        if clean_mode == "ADJUSTMENT" and amt_before_tax > 0:
            amt_before_tax = -amt_before_tax
        vat_amt = round(amt_before_tax * vat_rate / 100.0, 2)
        line_total = round(amt_before_tax + vat_amt, 2)

        # Tính source_quantity tỷ lệ thuận để hoàn tồn kho thuế chính xác khi có đổi quy cách
        src_sku = (
            row.get("source_sku")
            or (parent_it.source_sku if parent_it else None)
            or (parent_it.product_code if parent_it else row.get("product_code"))
        )
        src_unit = row.get("source_unit") or (parent_it.source_unit if parent_it else None) or row.get("unit_name")
        conv_ratio = parent_it.conversion_ratio if parent_it else None
        src_qty = qty
        if parent_it and parent_it.quantity and parent_it.source_quantity:
            src_qty = round(qty * (float(parent_it.source_quantity) / float(parent_it.quantity)), 4)

        new_items.append(
            IssuedInvoiceItem(
                line_number=idx,
                item_type="ADJUSTMENT" if clean_mode == "ADJUSTMENT" else "NORMAL",
                product_code=str(row.get("product_code") or (parent_it.product_code if parent_it else "")),
                product_name=str(row.get("product_name") or (parent_it.product_name if parent_it else "")),
                unit_name=str(row.get("unit_name") or (parent_it.unit_name if parent_it else "Hộp")),
                quantity=round(qty, 4),
                unit_price=round(abs(unit_price), 2),
                discount_rate=0.0,
                discount_amount=0.0,
                amount_before_tax=amt_before_tax,
                vat_rate=vat_rate,
                vat_amount=vat_amt,
                total_amount=line_total,
                source_order_number=return_reference or (parent_it.source_order_number if parent_it else None),
                source_sku=str(src_sku) if src_sku else None,
                source_quantity=src_qty,
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
        invoice_number=None,  # Nháp chờ phát hành lên cổng HĐĐT
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
        subtotal_before_tax=round(subtotal, 2),
        discount_amount=0.0,
        vat_rate=parent_invoice.vat_rate,
        vat_amount=round(total_vat, 2),
        total_payment=round(total_payment, 2),
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
