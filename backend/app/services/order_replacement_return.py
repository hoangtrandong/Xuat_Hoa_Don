"""Service xử lý nghiệp vụ: Thay thế đơn hàng DMS đã xuất kho (giao một phần) & Tạo lệnh yêu cầu trả hàng về kho."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.crud.debt_ledger import create_delivery_return
from app.crud.npp import NppDirectory, canonical_product_id
from app.models.employee import Employee
from app.models.finance import DeliveryReturn, DeliveryReturnItem
from app.models.inventory import (
    DeliveryRequest,
    DeliveryRequestOrder,
    DeliveryRequestOrderItem,
)
from app.models.product import Product
from app.models.vinamilk import VinamilkOrderReplacement, VinamilkOrderSnapshot


def _to_decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    try:
        return Decimal(str(value).replace(",", "").strip())
    except Exception:
        return Decimal("0")


def _snapshot_line_qty_and_amount(snapshot: VinamilkOrderSnapshot) -> tuple[int, Decimal]:
    payload = snapshot.raw_payload if isinstance(snapshot.raw_payload, dict) else {}
    qty = _to_decimal(
        next((payload[k] for k in ("Số lượng", "quantity", "qty") if payload.get(k) not in (None, "")), 0)
    )
    promo_qty = _to_decimal(
        next((payload[k] for k in ("Số lượng KM", "promotionQuantity", "freeQuantity") if payload.get(k) not in (None, "")), 0)
    )
    amount = _to_decimal(
        next((payload[k] for k in ("Giá trị", "totalValue", "amount") if payload.get(k) not in (None, "")), 0)
    )
    total_qty = qty + promo_qty
    if total_qty < 0:
        return 0, Decimal("0")
    return int(round(float(total_qty))), amount


def _build_product_lookup(db: Session) -> dict[str, Product]:
    products = db.scalars(select(Product)).all()
    lookup: dict[str, Product] = {}
    for p in products:
        if p.sku:
            lookup[p.sku.strip().upper()] = p
        if p._npp_code:
            lookup.setdefault(p._npp_code.strip().upper(), p)
    return lookup


def _resolve_snapshot_sku(
    db: Session,
    product_code: str | None,
    product_lookup: dict[str, Product],
) -> tuple[int | None, Product | None]:
    code = (product_code or "").strip().upper()
    if not code:
        return None, None
    prod = product_lookup.get(code)
    if not prod:
        return None, None
    try:
        canon_id = canonical_product_id(db, prod.id)
    except ValueError:
        canon_id = prod.id
    canon_prod = db.get(Product, canon_id) or prod
    return canon_id, canon_prod


def _serialize_old_order(dro: DeliveryRequestOrder) -> dict[str, Any]:
    orig_amt = float(dro.amount or 0)
    ret_amt = float(dro.returned_amount or 0)
    net_amt = float(dro.net_amount) if dro.net_amount is not None else max(0.0, orig_amt - ret_amt)
    items = dro.order_items or []
    total_qty = sum(max(0, int(it.ordered_qty or 0) - int(it.returned_qty or 0)) for it in items)
    return {
        "delivery_request_order_id": dro.id,
        "delivery_request_id": dro.delivery_request_id,
        "delivery_request_code": dro.request.code if dro.request else "",
        "order_number": dro.order_number,
        "order_date": dro.order_date,
        "employee_id": dro.employee_id,
        "employee_code": dro.employee_code,
        "employee_name": dro.employee_name,
        "customer_code": dro.customer_code,
        "customer_name": dro.customer_name,
        "amount": orig_amt,
        "returned_amount": ret_amt,
        "net_amount": net_amt,
        "delivery_status": dro.delivery_status,
        "payment_status": dro.payment_status,
        "item_count": len(items),
        "total_qty": total_qty,
    }


def list_eligible_old_orders(
    db: Session,
    search: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Tìm các đơn hàng cũ đã xuất kho (DeliveryRequest COMPLETED) nhưng chưa giao thành công."""
    pending_replacement_order_ids = set(
        db.scalars(
            select(DeliveryReturn.order_id).where(
                DeliveryReturn.order_id.is_not(None),
                DeliveryReturn.status == "PENDING_WAREHOUSE",
                DeliveryReturn.return_type == "ORDER_REPLACEMENT",
            )
        ).all()
    )

    stmt = (
        select(DeliveryRequestOrder)
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestOrder.delivery_request_id)
        .options(
            selectinload(DeliveryRequestOrder.request),
            selectinload(DeliveryRequestOrder.order_items),
        )
        .where(
            DeliveryRequest.status == "COMPLETED",
            DeliveryRequestOrder.delivery_status.in_(("PENDING", "PARTIAL_DELIVERED")),
            DeliveryRequestOrder.payment_status != "RETURNED",
        )
        .order_by(DeliveryRequestOrder.id.desc())
    )
    if pending_replacement_order_ids:
        stmt = stmt.where(DeliveryRequestOrder.id.not_in(pending_replacement_order_ids))

    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                DeliveryRequestOrder.order_number.ilike(q),
                DeliveryRequestOrder.customer_code.ilike(q),
                DeliveryRequestOrder.customer_name.ilike(q),
                DeliveryRequestOrder.employee_code.ilike(q),
                DeliveryRequestOrder.employee_name.ilike(q),
                DeliveryRequest.code.ilike(q),
            )
        )

    rows = db.scalars(stmt.limit(limit)).all()
    return [_serialize_old_order(dro) for dro in rows]


def list_eligible_new_orders(
    db: Session,
    search: str | None = None,
    customer_code: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Tìm các đơn hàng mới đồng bộ từ DMS chưa xuất kho và chưa gán thay thế."""
    exported_order_numbers = {
        (num or "").strip().upper()
        for num in db.scalars(
            select(DeliveryRequestOrder.order_number)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestOrder.delivery_request_id)
            .where(DeliveryRequest.status != "CANCELLED")
        ).all()
        if num
    }

    used_replacement_numbers = set()
    for rep in db.scalars(select(VinamilkOrderReplacement)).all():
        if rep.new_order_number:
            used_replacement_numbers.add(rep.new_order_number.strip().upper())
        for old_part in (rep.replaced_order_number or "").split(","):
            if old_part.strip():
                used_replacement_numbers.add(old_part.strip().upper())

    excluded = exported_order_numbers | used_replacement_numbers

    stmt = (
        select(VinamilkOrderSnapshot)
        .where(
            VinamilkOrderSnapshot.order_number.is_not(None),
            or_(
                VinamilkOrderSnapshot.returned.is_(None),
                VinamilkOrderSnapshot.returned.is_(False),
            ),
        )
        .order_by(VinamilkOrderSnapshot.order_created_date.desc(), VinamilkOrderSnapshot.id.desc())
    )
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                VinamilkOrderSnapshot.order_number.ilike(q),
                VinamilkOrderSnapshot.customer_code.ilike(q),
                VinamilkOrderSnapshot.customer_name.ilike(q),
            )
        )
    elif customer_code and customer_code.strip():
        # Ưu tiên lọc nhanh theo khách hàng nếu chưa gõ từ khóa tìm kiếm
        stmt = stmt.where(VinamilkOrderSnapshot.customer_code.ilike(f"%{customer_code.strip()}%"))

    snapshots = db.scalars(stmt.limit(1500)).all()
    grouped: dict[str, dict[str, Any]] = {}
    for snap in snapshots:
        ord_num = (snap.order_number or "").strip()
        if not ord_num or ord_num.upper() in excluded:
            continue
        qty, amt = _snapshot_line_qty_and_amount(snap)
        payload = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
        entry = grouped.get(ord_num)
        if entry is None:
            entry = {
                "order_number": ord_num,
                "order_date": snap.order_created_date,
                "customer_code": snap.customer_code,
                "customer_name": snap.customer_name,
                "staff_code": str(payload.get("Mã NVBH") or payload.get("staffCode") or "").strip() or None,
                "staff_name": str(payload.get("Tên NVBH") or payload.get("staffName") or "").strip() or None,
                "total_qty": 0,
                "total_amount": 0.0,
                "line_count": 0,
                "status": snap.status,
            }
            grouped[ord_num] = entry
        entry["total_qty"] += qty
        entry["total_amount"] = round(entry["total_amount"] + float(amt), 2)
        entry["line_count"] += 1

    results = list(grouped.values())
    norm_cust = (customer_code or "").strip().upper()
    results.sort(
        key=lambda x: (
            0 if (norm_cust and (x.get("customer_code") or "").strip().upper() == norm_cust) else 1,
            -(x["order_date"].toordinal() if x.get("order_date") else 0),
            x["order_number"],
        )
    )
    return results[:limit]


def _resolve_old_dro(
    db: Session,
    old_delivery_request_order_id: int | None = None,
    old_order_number: str | None = None,
) -> DeliveryRequestOrder | None:
    base_stmt = (
        select(DeliveryRequestOrder)
        .options(
            selectinload(DeliveryRequestOrder.request),
            selectinload(DeliveryRequestOrder.order_items).selectinload(DeliveryRequestOrderItem.product),
        )
    )
    if old_delivery_request_order_id:
        return db.scalar(base_stmt.where(DeliveryRequestOrder.id == old_delivery_request_order_id))
    if old_order_number and old_order_number.strip():
        return db.scalar(
            base_stmt
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestOrder.delivery_request_id)
            .where(
                func.upper(func.trim(DeliveryRequestOrder.order_number)) == old_order_number.strip().upper(),
                DeliveryRequest.status == "COMPLETED",
            )
            .order_by(DeliveryRequest.completed_at.desc(), DeliveryRequestOrder.id.desc())
        )
    return None


def get_old_order_replacement_context(
    db: Session,
    old_order_number: str,
) -> dict[str, Any]:
    """Kiểm tra 1 đơn hàng (theo số đơn) có đủ điều kiện gán đơn thay thế & tạo lệnh trả hàng hay không."""
    ord_num = (old_order_number or "").strip()
    if not ord_num:
        return {"eligible": False, "reason": "Số đơn hàng không hợp lệ."}

    old_dro = _resolve_old_dro(db, old_order_number=ord_num)
    if not old_dro:
        return {
            "eligible": False,
            "reason": "Đơn hàng chưa ở trạng thái Đã xuất kho nên không thuộc diện thay thế trả hàng.",
        }

    existing_ret = db.scalar(
        select(DeliveryReturn)
        .where(
            DeliveryReturn.order_id == old_dro.id,
            DeliveryReturn.return_type == "ORDER_REPLACEMENT",
            DeliveryReturn.status.in_(("PENDING_WAREHOUSE", "WAREHOUSE_RECEIVED", "APPROVED")),
        )
        .order_by(DeliveryReturn.id.desc())
    )
    if existing_ret:
        return {
            "eligible": False,
            "reason": f"Đơn này đã được gán thay thế bởi đơn {existing_ret.replacement_order_number} (Phiếu trả {existing_ret.code}).",
            "old_order": _serialize_old_order(old_dro),
            "existing_return_code": existing_ret.code,
            "existing_return_status": existing_ret.status,
            "existing_replacement_order_number": existing_ret.replacement_order_number,
        }

    if old_dro.delivery_status in ("DELIVERED", "RETURNED_ALL"):
        return {
            "eligible": False,
            "reason": f"Đơn hàng đang ở trạng thái {old_dro.delivery_status}, không thể gán thay thế trả hàng.",
            "old_order": _serialize_old_order(old_dro),
        }

    if old_dro.payment_status == "RETURNED":
        return {
            "eligible": False,
            "reason": "Đơn hàng đã được trả toàn bộ.",
            "old_order": _serialize_old_order(old_dro),
        }

    return {
        "eligible": True,
        "reason": None,
        "old_order": _serialize_old_order(old_dro),
    }


def preview_replacement_return(
    db: Session,
    old_delivery_request_order_id: int | None = None,
    new_order_number: str = "",
    old_order_number: str | None = None,
) -> dict[str, Any]:
    """Đối chiếu đơn cũ (đã xuất kho) và đơn mới (DMS), tính phần hàng chênh lệch cần trả kho."""
    old_dro = _resolve_old_dro(db, old_delivery_request_order_id, old_order_number)
    if not old_dro:
        raise ValueError("Không tìm thấy đơn hàng cũ đã xuất kho trong hệ thống.")

    new_ord_num = new_order_number.strip()
    if not new_ord_num:
        raise ValueError("Vui lòng chọn số đơn hàng mới.")

    errors: list[str] = []
    warnings: list[str] = []

    if not old_dro.request or old_dro.request.status != "COMPLETED":
        errors.append("Đơn hàng cũ chưa ở trạng thái ĐÃ XUẤT KHO (Phiếu xuất chưa hoàn tất).")
    if old_dro.delivery_status in ("DELIVERED", "RETURNED_ALL"):
        errors.append(f"Đơn hàng cũ đang ở trạng thái {old_dro.delivery_status}, không thể lập lệnh thay thế trả hàng.")
    if old_dro.order_number.strip().upper() == new_ord_num.upper():
        errors.append("Đơn hàng mới không thể trùng với đơn hàng cũ.")
    if not old_dro.employee_id:
        errors.append("Đơn hàng cũ chưa gắn nhân viên giao hàng (NVGH) để ghi nhận công nợ.")

    existing_pending = db.scalar(
        select(DeliveryReturn.code).where(
            DeliveryReturn.order_id == old_dro.id,
            DeliveryReturn.status == "PENDING_WAREHOUSE",
            DeliveryReturn.return_type == "ORDER_REPLACEMENT",
        )
    )
    if existing_pending:
        errors.append(f"Đơn hàng cũ đang có lệnh trả hàng thay thế chờ thủ kho xác nhận ({existing_pending}).")

    # Kiểm tra đơn mới trên DMS snapshot
    new_snapshots = db.scalars(
        select(VinamilkOrderSnapshot).where(
            func.upper(VinamilkOrderSnapshot.order_number) == new_ord_num.upper()
        )
    ).all()
    if not new_snapshots:
        raise ValueError(f"Không tìm thấy đơn hàng mới {new_ord_num} trong dữ liệu đồng bộ DMS.")

    canonical_new_order_number = new_snapshots[0].order_number or new_ord_num

    # Kiểm tra đơn mới đã bị xuất kho chưa
    exported_new = db.scalar(
        select(DeliveryRequest.code)
        .join(DeliveryRequestOrder, DeliveryRequestOrder.delivery_request_id == DeliveryRequest.id)
        .where(
            func.upper(DeliveryRequestOrder.order_number) == canonical_new_order_number.upper(),
            DeliveryRequest.status != "CANCELLED",
        )
    )
    if exported_new:
        errors.append(f"Đơn hàng mới {canonical_new_order_number} đã nằm trong phiếu xuất kho {exported_new} (tránh xuất trùng kho).")

    # Kiểm tra đơn mới đã được gán thay thế chưa
    existing_rep = db.get(VinamilkOrderReplacement, canonical_new_order_number)
    if existing_rep and existing_rep.replaced_order_number.strip().upper() != old_dro.order_number.strip().upper():
        errors.append(
            f"Đơn mới {canonical_new_order_number} đã được gán thay thế cho đơn {existing_rep.replaced_order_number}."
        )

    product_lookup = _build_product_lookup(db)
    directory = NppDirectory(db)

    # 1. Tổng hợp SKU & tiền của ĐƠN CŨ (ưu tiên DeliveryRequestOrderItem, fallback VinamilkOrderSnapshot)
    old_by_prod: dict[int, dict[str, Any]] = {}
    old_total_qty = 0
    old_lines_amount = Decimal("0")

    if old_dro.order_items:
        for oi in old_dro.order_items:
            rem_qty = max(0, int(oi.ordered_qty or 0) - int(oi.returned_qty or 0))
            if rem_qty <= 0:
                continue
            try:
                canon_id = canonical_product_id(db, oi.product_id)
            except ValueError:
                canon_id = oi.product_id
            prod = db.get(Product, canon_id) or oi.product
            ratio = Decimal(rem_qty) / Decimal(max(1, int(oi.ordered_qty or 1)))
            line_amt = _to_decimal(oi.line_total) * ratio
            if line_amt <= 0 and oi.unit_price:
                line_amt = _to_decimal(oi.unit_price) * Decimal(rem_qty)
            bucket = old_by_prod.setdefault(canon_id, {"product": prod, "qty": 0, "amount": Decimal("0")})
            bucket["qty"] += rem_qty
            bucket["amount"] += line_amt
            old_total_qty += rem_qty
            old_lines_amount += line_amt
    else:
        old_snapshots = db.scalars(
            select(VinamilkOrderSnapshot).where(
                func.upper(VinamilkOrderSnapshot.order_number) == old_dro.order_number.strip().upper()
            )
        ).all()
        if not old_snapshots:
            errors.append(
                f"Đơn hàng cũ {old_dro.order_number} không có chi tiết dòng sản phẩm (cả trong phiếu xuất lẫn dữ liệu DMS)."
            )
        for snap in old_snapshots:
            qty, amt = _snapshot_line_qty_and_amount(snap)
            if qty <= 0:
                continue
            canon_id, prod = _resolve_snapshot_sku(db, snap.product_code, product_lookup)
            if canon_id is None or prod is None:
                errors.append(f"Đơn cũ {old_dro.order_number}: không tìm thấy mã SP {snap.product_code} trong danh mục.")
                continue
            bucket = old_by_prod.setdefault(canon_id, {"product": prod, "qty": 0, "amount": Decimal("0")})
            bucket["qty"] += qty
            bucket["amount"] += amt
            old_total_qty += qty
            old_lines_amount += amt

    # 2. Tổng hợp SKU & tiền của ĐƠN MỚI từ VinamilkOrderSnapshot
    new_by_prod: dict[int, dict[str, Any]] = {}
    new_order_lines: list[dict[str, Any]] = []
    new_total_qty = 0
    new_total_amount = Decimal("0")
    new_first = new_snapshots[0]
    new_payload_first = new_first.raw_payload if isinstance(new_first.raw_payload, dict) else {}

    for snap in new_snapshots:
        payload = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
        sale_qty = int(round(float(_to_decimal(
            next((payload[k] for k in ("Số lượng", "quantity", "qty") if payload.get(k) not in (None, "")), 0)
        ))))
        promo_qty = int(round(float(_to_decimal(
            next((payload[k] for k in ("Số lượng KM", "promotionQuantity", "freeQuantity") if payload.get(k) not in (None, "")), 0)
        ))))
        qty, amt = _snapshot_line_qty_and_amount(snap)
        if qty <= 0 and amt <= 0:
            continue
        canon_id, prod = _resolve_snapshot_sku(db, snap.product_code, product_lookup)
        display_sku = (snap.product_code or "").strip()
        display_name = (snap.product_name or "").strip()
        if prod is not None and canon_id is not None:
            display_sku, display_name = directory.label(canon_id, prod.sku, prod.name)
        unit_price = round(float(amt) / qty, 2) if qty > 0 else 0.0
        new_order_lines.append({
            "product_id": canon_id,
            "sku": display_sku or "—",
            "product_name": display_name or "—",
            "quantity": max(0, sale_qty),
            "promo_quantity": max(0, promo_qty),
            "total_qty": qty,
            "unit_price": unit_price,
            "amount": round(float(amt), 2),
        })
        if canon_id is None or prod is None:
            errors.append(f"Đơn mới {canonical_new_order_number}: không tìm thấy mã SP {snap.product_code} trong danh mục.")
            continue
        bucket = new_by_prod.setdefault(canon_id, {"product": prod, "qty": 0, "amount": Decimal("0")})
        bucket["qty"] += qty
        bucket["amount"] += amt
        new_total_qty += qty
        new_total_amount += amt

    if old_dro.customer_code and new_first.customer_code:
        if old_dro.customer_code.strip().upper() != new_first.customer_code.strip().upper():
            warnings.append(
                f"Mã khách hàng khác nhau: đơn cũ ({old_dro.customer_code}) vs đơn mới ({new_first.customer_code}). Vui lòng kiểm tra kỹ."
            )

    # 3. Đối chiếu từng SKU
    all_product_ids = list(dict.fromkeys(list(old_by_prod.keys()) + list(new_by_prod.keys())))
    comparison_lines: list[dict[str, Any]] = []
    total_return_qty = 0

    for prod_id in all_product_ids:
        old_entry = old_by_prod.get(prod_id)
        new_entry = new_by_prod.get(prod_id)
        prod = (old_entry or new_entry)["product"]
        sku, prod_name = directory.label(prod_id, prod.sku, prod.name)
        bpc = max(1, int(prod.boxes_per_carton or 1))

        old_q = old_entry["qty"] if old_entry else 0
        new_q = new_entry["qty"] if new_entry else 0
        old_a = float(old_entry["amount"]) if old_entry else 0.0
        new_a = float(new_entry["amount"]) if new_entry else 0.0

        if old_q == 0 and new_q > 0:
            errors.append(f"Sản phẩm {sku} ({prod_name}) có trong đơn mới (SL {new_q}) nhưng KHÔNG có trong đơn cũ.")
        elif new_q > old_q:
            errors.append(f"Sản phẩm {sku} ({prod_name}): SL đơn mới ({new_q}) lớn hơn SL đơn cũ ({old_q}).")

        ret_q = max(0, old_q - new_q)
        total_return_qty += ret_q
        raw_ret_amt = max(0.0, round(old_a - new_a, 2))
        if ret_q > 0 and raw_ret_amt <= 0 and old_q > 0 and old_a > 0:
            raw_ret_amt = round((old_a / old_q) * ret_q, 2)
        unit_price = round(raw_ret_amt / ret_q, 2) if ret_q > 0 else (round(old_a / old_q, 2) if old_q > 0 else 0.0)

        comparison_lines.append({
            "product_id": prod_id,
            "sku": sku,
            "product_name": prod_name,
            "boxes_per_carton": bpc,
            "old_qty": old_q,
            "new_qty": new_q,
            "return_qty": ret_q,
            "return_cartons": ret_q // bpc,
            "return_loose_boxes": ret_q % bpc,
            "old_amount": round(old_a, 2),
            "new_amount": round(new_a, 2),
            "unit_price": unit_price,
            "return_amount": raw_ret_amt,
        })

    if total_return_qty <= 0 and not errors:
        errors.append("Không có hàng chênh lệch cần trả về kho (SL đơn mới bằng SL đơn cũ).")

    # Tính tổng tiền trả khớp chính xác với (net_amount đơn cũ - total_amount đơn mới)
    old_net_amount = (
        float(old_dro.net_amount)
        if old_dro.net_amount is not None
        else max(0.0, float(old_dro.amount or 0) - float(old_dro.returned_amount or 0))
    )
    if old_net_amount <= 0:
        old_net_amount = round(float(old_lines_amount), 2)
    new_amt_float = round(float(new_total_amount), 2)
    target_return_amount = max(0.0, round(old_net_amount - new_amt_float, 2))

    # Cân bằng chênh lệch làm tròn vào dòng trả có giá trị lớn nhất để tổng chi tiết == target_return_amount
    return_only_lines = [ln for ln in comparison_lines if ln["return_qty"] > 0]
    sum_line_ret = round(sum(ln["return_amount"] for ln in return_only_lines), 2)
    if return_only_lines and target_return_amount > 0 and abs(sum_line_ret - target_return_amount) > 0.01:
        diff = round(target_return_amount - sum_line_ret, 2)
        largest = max(return_only_lines, key=lambda x: x["return_amount"])
        adjusted = round(largest["return_amount"] + diff, 2)
        if adjusted >= 0:
            largest["return_amount"] = adjusted
            largest["unit_price"] = round(adjusted / largest["return_qty"], 2)

    if target_return_amount <= 0 and sum_line_ret > 0:
        target_return_amount = sum_line_ret

    if target_return_amount <= 0 and total_return_qty > 0:
        warnings.append("Chênh lệch tiền giữa đơn cũ và đơn mới bằng 0đ (chỉ trả hàng khuyến mãi / hàng không tính tiền).")

    old_order_out = _serialize_old_order(old_dro)
    if old_order_out["total_qty"] == 0:
        old_order_out["total_qty"] = old_total_qty
    if old_order_out["item_count"] == 0:
        old_order_out["item_count"] = len(old_by_prod)

    new_order_out = {
        "order_number": canonical_new_order_number,
        "order_date": new_first.order_created_date,
        "customer_code": new_first.customer_code,
        "customer_name": new_first.customer_name,
        "staff_code": str(new_payload_first.get("Mã NVBH") or new_payload_first.get("staffCode") or "").strip() or None,
        "staff_name": str(new_payload_first.get("Tên NVBH") or new_payload_first.get("staffName") or "").strip() or None,
        "total_qty": new_total_qty,
        "total_amount": new_amt_float,
        "line_count": len(new_snapshots),
        "status": new_first.status,
    }

    return {
        "old_order": old_order_out,
        "new_order": new_order_out,
        "new_order_lines": new_order_lines,
        "comparison_lines": comparison_lines,
        "old_amount": round(old_net_amount, 2),
        "new_amount": new_amt_float,
        "return_amount": target_return_amount,
        "total_old_qty": old_total_qty,
        "total_new_qty": new_total_qty,
        "total_return_qty": total_return_qty,
        "warnings": warnings,
        "errors": errors,
        "can_create": len(errors) == 0 and total_return_qty > 0,
    }


def create_replacement_return(
    db: Session,
    old_delivery_request_order_id: int | None = None,
    new_order_number: str = "",
    created_by: str = "",
    note: str | None = None,
    old_order_number: str | None = None,
) -> DeliveryReturn:
    """Thực thi thay thế đơn cũ bằng đơn mới và tạo lệnh yêu cầu trả phần hàng còn lại về kho (PENDING_WAREHOUSE)."""
    resolved_old = _resolve_old_dro(db, old_delivery_request_order_id, old_order_number)
    if not resolved_old:
        raise ValueError("Không tìm thấy đơn hàng cũ đã xuất kho.")

    locked_old = db.scalar(
        select(DeliveryRequestOrder)
        .where(DeliveryRequestOrder.id == resolved_old.id)
        .with_for_update()
    )
    if not locked_old:
        raise ValueError("Không tìm thấy đơn hàng cũ.")

    preview = preview_replacement_return(
        db,
        old_delivery_request_order_id=locked_old.id,
        new_order_number=new_order_number,
    )
    if not preview["can_create"]:
        raise ValueError(" ".join(preview["errors"]) or "Không thể tạo lệnh trả hàng thay thế.")

    old_order_num = locked_old.order_number.strip()
    canonical_new_num = preview["new_order"]["order_number"]

    # 1. Lưu liên kết thay thế đơn hàng trên DMS (VinamilkOrderReplacement) với loại PARTIAL_RETURN
    #    -> Đơn mới hiển thị trạng thái "Đã giao", đơn cũ hiển thị trạng thái "Giao 1 phần"
    existing_rep = db.get(VinamilkOrderReplacement, canonical_new_num)
    if existing_rep is None:
        db.add(VinamilkOrderReplacement(
            new_order_number=canonical_new_num,
            replaced_order_number=old_order_num,
            replacement_type="PARTIAL_RETURN",
            performed_by=created_by,
        ))
    else:
        existing_rep.replaced_order_number = old_order_num
        existing_rep.replacement_type = "PARTIAL_RETURN"
        existing_rep.performed_by = created_by
        existing_rep.updated_at = datetime.utcnow()

    # Chuyển đơn cũ sang trạng thái Giao 1 phần ngay khi xác nhận thay thế
    locked_old.delivery_status = "PARTIAL_DELIVERED"

    # 2. Chuẩn bị danh sách hàng chênh lệch trả về kho
    return_items_payload = []
    for ln in preview["comparison_lines"]:
        if ln["return_qty"] <= 0:
            continue
        return_items_payload.append({
            "product_id": ln["product_id"],
            "quantity": ln["return_qty"],
            "cartons": ln["return_cartons"],
            "loose_boxes": ln["return_loose_boxes"],
            "unit_price": ln["unit_price"],
            "amount": ln["return_amount"],
            "reason": f"Giao một phần - Đơn mới {canonical_new_num} thay thế đơn cũ {old_order_num}",
            "item_condition": "GOOD",
        })

    auto_note = f"Thay thế đơn {old_order_num} bằng đơn mới {canonical_new_num} (giao một phần)"
    final_note = f"{auto_note} | {note.strip()}" if (note and note.strip()) else auto_note

    # 3. Tạo phiếu yêu cầu trả hàng ở trạng thái PENDING_WAREHOUSE (chưa nhập kho, chưa trừ công nợ)
    ret = create_delivery_return(
        db=db,
        delivery_request_id=locked_old.delivery_request_id,
        employee_id=locked_old.employee_id,
        amount=preview["return_amount"],
        order_id=locked_old.id,
        items=return_items_payload,
        restore_stock=True,
        note=final_note,
        created_by=created_by,
        auto_receive=False,
        settlement_party_type="EMPLOYEE",
        settlement_party_id=locked_old.employee_id,
        return_type="ORDER_REPLACEMENT",
        replacement_order_number=canonical_new_num,
        commit=True,
    )

    # Eager-load relationships for response serialization
    return db.scalar(
        select(DeliveryReturn)
        .options(
            selectinload(DeliveryReturn.delivery_request),
            selectinload(DeliveryReturn.employee),
            selectinload(DeliveryReturn.order),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.product),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.location),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.lot),
        )
        .where(DeliveryReturn.id == ret.id)
    )
