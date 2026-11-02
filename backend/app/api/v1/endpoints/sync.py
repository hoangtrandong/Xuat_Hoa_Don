import asyncio
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from io import BytesIO
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from pydantic import BaseModel, Field
from playwright.sync_api import sync_playwright
from dotenv import dotenv_values, set_key
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, joinedload
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.services.vinamilk_sales_summary import build_sales_summary
from app.models.customer import Company, Customer
from app.models.user import User
from app.models.vinamilk import (
    VinamilkOrderReplacement,
    VinamilkOrderSnapshot,
    VinamilkOrderSplitRequest,
    VinamilkSyncRun,
)
from app.models.vinamilk_allocation import VinamilkOrderAllocation
from app.services.vinamilk_dates import iter_inclusive_dates
from scripts.vinamilk_login import configure_playwright_browser_path, login_and_get_cookie

router = APIRouter()
_cookie_refresh_lock = asyncio.Lock()
_runtime_cookie = ""
_ENV_LOCAL = Path(__file__).resolve().parents[4] / ".env.local"
_PLAYWRIGHT_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
]

VINAMILK_URL = "https://vinamilk.dmsone.vn/sale-product/search-sale/search"


def _iso_utc(value: datetime | None) -> str | None:
    """Mốc thời gian trong DB lưu UTC naive -> gắn +00:00 để client quy đổi đúng giờ VN."""
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


class VinamilkSearchRequest(BaseModel):
    orderNumber: str = ""
    refOrderNumber: str = ""
    fromDate: str
    toDate: str
    deliveryDate: str = ""
    customerCode: str = ""
    customerName: str = ""
    orderSource: str = "0"
    priorityCode: str = "-1"
    csvStatus: str = ""
    xmlStatus: str = ""
    saleStaff: str = ""
    deliveryStaff: str = ""
    orderType: str = "IN"
    saleOrderType: str = "-1"
    page: int = Field(default=1, ge=1)
    rows: int = Field(default=500, ge=1, le=500)


class AllocationUpdateRequest(BaseModel):
    """Các trường cho phép chỉnh sửa trên một dòng cân đối upload thủ công."""

    allocated_quantity: int | None = Field(default=None, ge=0)
    company_code: str | None = None
    distributor_sku: str | None = None
    note: str | None = None


class AllocationBulkDeleteRequest(BaseModel):
    """Danh sách id dòng cân đối cần xóa (hỗ trợ chọn nhiều hoặc chọn tất cả)."""

    allocation_ids: list[int] = Field(default_factory=list)
    delete_all: bool = False
    from_date: date | None = None
    to_date: date | None = None


class OrderReplacementUpdateRequest(BaseModel):
    replaced_order_number: str | None = Field(default=None, max_length=120)


class SplitOrderItemAllocation(BaseModel):
    snapshot_id: int
    quantity: float = Field(default=0, ge=0)
    promo_quantity: float = Field(default=0, ge=0)
    value_amount: float | None = Field(default=None, ge=0)
    discount_amount: float | None = Field(default=None, ge=0)


class SplitOrderTarget(BaseModel):
    customer_code: str | None = None
    customer_name: str | None = None
    customer_address: str | None = None
    is_staff_debt: bool = False
    staff_code: str | None = None
    staff_name: str | None = None
    items: list[SplitOrderItemAllocation] = Field(default_factory=list)


class SplitOrderRequest(BaseModel):
    source_order_number: str | None = None
    order_number: str | None = None
    splits: list[SplitOrderTarget]
    auto_assign_remainder_to_staff: bool = False


class RejectSplitOrderRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class MergeOrdersRequest(BaseModel):
    source_order_numbers: list[str] = Field(default_factory=list)
    order_numbers: list[str] = Field(default_factory=list)
    representative_order_number: str | None = None


def _order_numbers(payload: Any) -> set[str]:
    numbers = (
        _field(row, ("orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng"))
        for row in _row_list(payload)
    )
    return {number for number in numbers if number}


def _apply_scoped_states(
    db: Session,
    day: date,
    warehouse_orders: set[str] | None,
) -> None:
    """Đặt true/false theo kết quả truy vấn đã lọc; truy vấn lỗi (None) thì giữ nguyên giá trị cũ."""
    if warehouse_orders is None:
        return
    snapshots = db.scalars(select(VinamilkOrderSnapshot).where(
        VinamilkOrderSnapshot.synced_from == day,
        VinamilkOrderSnapshot.synced_to == day,
        VinamilkOrderSnapshot.order_number.is_not(None),
    )).all()
    synthetic_snapshots: list[VinamilkOrderSnapshot] = []
    for snapshot in snapshots:
        if getattr(snapshot, "is_synthetic", False):
            synthetic_snapshots.append(snapshot)
            continue
        snapshot.warehouse_updated = snapshot.order_number in warehouse_orders

    if synthetic_snapshots:
        replacements = {
            item.new_order_number: item.replaced_order_number
            for item in db.scalars(select(VinamilkOrderReplacement)).all()
            if getattr(item, "replacement_type", "MANUAL") in ("SPLIT", "MERGE")
        }
        for snapshot in synthetic_snapshots:
            replaced_str = replacements.get(snapshot.order_number or "", "")
            old_nums = [part.strip() for part in replaced_str.split(",") if part.strip()]
            if old_nums and any(old in warehouse_orders for old in old_nums):
                snapshot.warehouse_updated = True


def _update_order_replacement(
    db: Session,
    new_order_number: str,
    replaced_order_number: str | None,
    performed_by: str | None = None,
) -> None:
    new_order_number = new_order_number.strip()
    replaced_order_number = replaced_order_number.strip() if replaced_order_number is not None else None
    replaced_order_number = replaced_order_number or None
    actor = (performed_by or "").strip() or None
    if not new_order_number:
        raise HTTPException(status_code=400, detail="Số đơn hàng mới không hợp lệ.")
    if replaced_order_number == new_order_number:
        raise HTTPException(status_code=400, detail="Một đơn hàng không thể thay thế chính nó.")

    order_exists = db.scalar(
        select(VinamilkOrderSnapshot.id).where(VinamilkOrderSnapshot.order_number == new_order_number).limit(1)
    )
    if order_exists is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng mới trong dữ liệu đã đồng bộ.")

    current = db.get(VinamilkOrderReplacement, new_order_number)
    if replaced_order_number is None:
        if current is not None:
            if getattr(current, "replacement_type", "MANUAL") in ("SPLIT", "MERGE"):
                raise HTTPException(
                    status_code=400,
                    detail="Đơn Tách/Gộp không thể xóa liên kết thủ công. Hãy dùng chức năng Hoàn tác Tách/Gộp.",
                )
            db.delete(current)
        return

    replaced_exists = db.scalar(
        select(VinamilkOrderSnapshot.id).where(VinamilkOrderSnapshot.order_number == replaced_order_number).limit(1)
    )
    if replaced_exists is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng được thay thế trong dữ liệu đã đồng bộ.")

    relationships = {
        order: replaced
        for order, replaced in db.execute(
            select(VinamilkOrderReplacement.new_order_number, VinamilkOrderReplacement.replaced_order_number)
        )
    }
    relationships[new_order_number] = replaced_order_number
    visited: set[str] = set()
    cursor = replaced_order_number
    while cursor in relationships:
        if cursor == new_order_number or cursor in visited:
            raise HTTPException(status_code=400, detail="Liên kết này tạo thành vòng thay thế đơn hàng.")
        visited.add(cursor)
        cursor = relationships[cursor]

    if current is None:
        db.add(VinamilkOrderReplacement(
            new_order_number=new_order_number,
            replaced_order_number=replaced_order_number,
            replacement_type="MANUAL",
            performed_by=actor,
        ))
    else:
        current.replaced_order_number = replaced_order_number
        if actor:
            current.performed_by = actor
        current.updated_at = datetime.utcnow()


def _float_from_payload(payload: dict[str, Any], keys: tuple[str, ...]) -> float:
    for key in keys:
        value = payload.get(key)
        if value is not None and str(value).strip() != "":
            try:
                return float(str(value).replace(",", "").strip())
            except ValueError:
                continue
    return 0.0


def _format_qty_value(value: float) -> int | float:
    if abs(value - round(value)) < 1e-6:
        return int(round(value))
    return round(value, 2)


def _check_orders_available_for_split_merge(
    db: Session,
    order_numbers: list[str],
    ignore_split_request_id: int | None = None,
) -> None:
    all_replacements = db.scalars(select(VinamilkOrderReplacement)).all()
    busy_orders: set[str] = set()
    for item in all_replacements:
        busy_orders.add(item.new_order_number.strip())
        for old_part in (item.replaced_order_number or "").split(","):
            if old_part.strip():
                busy_orders.add(old_part.strip())
    conflicts = [num for num in order_numbers if num in busy_orders]
    if conflicts:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Đơn hàng {', '.join(conflicts)} đã tham gia tách/gộp hoặc thay thế. "
                "Vui lòng hoàn tác trước khi thực hiện lại."
            ),
        )
    pending_stmt = select(VinamilkOrderSplitRequest.source_order_number).where(
        VinamilkOrderSplitRequest.source_order_number.in_(order_numbers),
        VinamilkOrderSplitRequest.status == "PENDING",
    )
    if ignore_split_request_id is not None:
        pending_stmt = pending_stmt.where(VinamilkOrderSplitRequest.id != ignore_split_request_id)
    pending_orders = list(dict.fromkeys(db.scalars(pending_stmt).all()))
    if pending_orders:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Đơn hàng {', '.join(pending_orders)} đang có yêu cầu tách đơn chờ Kế toán xác nhận. "
                "Vui lòng duyệt hoặc từ chối/hủy yêu cầu trước khi thực hiện lại."
            ),
        )


def _prepare_split_vinamilk_order(
    db: Session,
    payload: SplitOrderRequest,
    ignore_split_request_id: int | None = None,
) -> dict[str, Any]:
    source_order_number = (payload.source_order_number or payload.order_number or "").strip()
    if not source_order_number:
        raise HTTPException(status_code=400, detail="Mã đơn hàng gốc không được để trống.")
    min_splits = 1 if payload.auto_assign_remainder_to_staff else 2
    if len(payload.splits) < min_splits:
        raise HTTPException(status_code=400, detail="Cần tách thành ít nhất 2 đơn hàng.")

    source_rows = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(
            VinamilkOrderSnapshot.order_number == source_order_number,
            VinamilkOrderSnapshot.product_code.is_not(None),
        )
        .order_by(VinamilkOrderSnapshot.id)
    ).all()
    if not source_rows:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy đơn hàng {source_order_number}.")
    if any(getattr(row, "is_synthetic", False) for row in source_rows):
        raise HTTPException(status_code=400, detail=f"Đơn {source_order_number} là đơn Tách/Gộp, không thể tách tiếp.")

    _check_orders_available_for_split_merge(
        db,
        [source_order_number],
        ignore_split_request_id=ignore_split_request_id,
    )

    source_by_id = {row.id: row for row in source_rows}
    effective_splits: list[SplitOrderTarget] = list(payload.splits)
    alloc_by_split: list[dict[int, tuple[float, float]]] = []
    custom_val_by_split_item: dict[tuple[int, int], float] = {}
    custom_disc_by_split_item: dict[tuple[int, int], float] = {}
    sum_qty: dict[int, float] = defaultdict(float)
    sum_promo: dict[int, float] = defaultdict(float)

    for split_idx, split_target in enumerate(effective_splits):
        split_map: dict[int, tuple[float, float]] = {}
        has_positive = False
        for item in split_target.items:
            if item.snapshot_id not in source_by_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Dòng sản phẩm #{item.snapshot_id} không thuộc đơn {source_order_number}.",
                )
            qty = float(item.quantity or 0)
            promo = float(item.promo_quantity or 0)
            if qty < 0 or promo < 0:
                raise HTTPException(status_code=400, detail="Số lượng tách không được âm.")
            if qty > 0 or promo > 0:
                has_positive = True
            prev_q, prev_p = split_map.get(item.snapshot_id, (0.0, 0.0))
            split_map[item.snapshot_id] = (prev_q + qty, prev_p + promo)
            if item.value_amount is not None:
                if item.value_amount < 0:
                    raise HTTPException(status_code=400, detail="Giá trị không được âm.")
                custom_val_by_split_item[(split_idx, item.snapshot_id)] = (
                    custom_val_by_split_item.get((split_idx, item.snapshot_id), 0.0)
                    + float(item.value_amount)
                )
            if item.discount_amount is not None:
                if item.discount_amount < 0:
                    raise HTTPException(status_code=400, detail="Số tiền CK không được âm.")
                custom_disc_by_split_item[(split_idx, item.snapshot_id)] = (
                    custom_disc_by_split_item.get((split_idx, item.snapshot_id), 0.0)
                    + float(item.discount_amount)
                )
            sum_qty[item.snapshot_id] += qty
            sum_promo[item.snapshot_id] += promo
        if not has_positive:
            raise HTTPException(
                status_code=400,
                detail=f"Đơn tách #{split_idx + 1} phải có ít nhất 1 sản phẩm có số lượng lớn hơn 0.",
            )
        alloc_by_split.append(split_map)

    remainder_map: dict[int, tuple[float, float]] = {}
    for s_id, s_row in source_by_id.items():
        raw = s_row.raw_payload if isinstance(s_row.raw_payload, dict) else {}
        orig_qty = _float_from_payload(raw, ("Số lượng", "quantity", "qty"))
        orig_promo = _float_from_payload(raw, ("Số lượng KM", "promotionQuantity", "freeQuantity", "giftQuantity"))
        got_qty = sum_qty.get(s_id, 0.0)
        got_promo = sum_promo.get(s_id, 0.0)
        if got_qty - orig_qty > 1e-6:
            raise HTTPException(
                status_code=400,
                detail=f"Sản phẩm {s_row.product_code}: tổng SL tách ({got_qty:g}) vượt quá SL đơn gốc ({orig_qty:g}).",
            )
        if got_promo - orig_promo > 1e-6:
            raise HTTPException(
                status_code=400,
                detail=f"Sản phẩm {s_row.product_code}: tổng SL KM tách ({got_promo:g}) vượt quá SL KM đơn gốc ({orig_promo:g}).",
            )
        rem_q = max(0.0, round(orig_qty - got_qty, 4))
        rem_p = max(0.0, round(orig_promo - got_promo, 4))
        if rem_q > 1e-6 or rem_p > 1e-6:
            if not payload.auto_assign_remainder_to_staff:
                if abs(got_qty - orig_qty) > 1e-6:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Sản phẩm {s_row.product_code}: tổng SL tách ({got_qty:g}) phải bằng SL đơn gốc ({orig_qty:g}).",
                    )
                if abs(got_promo - orig_promo) > 1e-6:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Sản phẩm {s_row.product_code}: tổng SL KM tách ({got_promo:g}) phải bằng SL KM đơn gốc ({orig_promo:g}).",
                    )
            else:
                remainder_map[s_id] = (rem_q, rem_p)

    if remainder_map:
        staff_split_idx = len(effective_splits)
        remainder_items: list[SplitOrderItemAllocation] = []
        for s_id, (rem_q, rem_p) in remainder_map.items():
            s_row = source_by_id[s_id]
            raw = s_row.raw_payload if isinstance(s_row.raw_payload, dict) else {}
            orig_val = _float_from_payload(raw, ("Giá trị", "totalValue", "total", "amount"))
            orig_disc = _float_from_payload(raw, ("Số tiền CK", "totalDiscount", "discountAmount"))
            has_line_custom_val = any(k[1] == s_id for k in custom_val_by_split_item)
            rem_val: float | None = None
            if has_line_custom_val:
                used_custom_val = sum(
                    val for (idx, sid), val in custom_val_by_split_item.items() if sid == s_id
                )
                rem_val = max(0.0, round(orig_val - used_custom_val))
                custom_val_by_split_item[(staff_split_idx, s_id)] = rem_val
            has_line_custom_disc = any(k[1] == s_id for k in custom_disc_by_split_item)
            rem_disc: float | None = None
            if has_line_custom_disc:
                used_custom_disc = sum(
                    val for (idx, sid), val in custom_disc_by_split_item.items() if sid == s_id
                )
                rem_disc = max(0.0, round(orig_disc - used_custom_disc))
                custom_disc_by_split_item[(staff_split_idx, s_id)] = rem_disc
            remainder_items.append(
                SplitOrderItemAllocation(
                    snapshot_id=s_id,
                    quantity=rem_q,
                    promo_quantity=rem_p,
                    value_amount=rem_val,
                    discount_amount=rem_disc,
                )
            )
            sum_qty[s_id] += rem_q
            sum_promo[s_id] += rem_p
        effective_splits.append(
            SplitOrderTarget(
                is_staff_debt=True,
                items=remainder_items,
            )
        )
        alloc_by_split.append(remainder_map)

    if len(effective_splits) < 2:
        raise HTTPException(
            status_code=400,
            detail="Cần tách thành ít nhất 2 đơn hàng (hoặc có phần thiếu tách cho NVBH).",
        )

    new_order_numbers: list[str] = []
    for idx in range(1, len(effective_splits) + 1):
        candidate = f"TD-{source_order_number}-{idx:02d}"
        suffix = idx
        while candidate in new_order_numbers or db.scalar(
            select(VinamilkOrderSnapshot.id).where(VinamilkOrderSnapshot.order_number == candidate).limit(1)
        ) is not None:
            suffix += 1
            candidate = f"TD-{source_order_number}-{suffix:02d}"
        new_order_numbers.append(candidate)

    line_financials: dict[tuple[int, int], tuple[float, float, float]] = {}
    total_orig_qty = 0.0
    total_orig_promo = 0.0
    total_orig_val = 0.0
    total_orig_disc = 0.0
    for s_id, s_row in source_by_id.items():
        raw = s_row.raw_payload if isinstance(s_row.raw_payload, dict) else {}
        orig_qty = _float_from_payload(raw, ("Số lượng", "quantity", "qty"))
        orig_promo = _float_from_payload(raw, ("Số lượng KM", "promotionQuantity", "freeQuantity", "giftQuantity"))
        orig_val = _float_from_payload(raw, ("Giá trị", "totalValue", "total", "amount"))
        orig_disc = _float_from_payload(raw, ("Số tiền CK", "totalDiscount", "discountAmount"))
        orig_voucher = _float_from_payload(raw, ("Giảm giá voucher", "voucherAmount", "voucherDiscount"))
        total_orig_qty += orig_qty
        total_orig_promo += orig_promo
        total_orig_val += orig_val
        total_orig_disc += orig_disc

        active_indices = [
            idx for idx, split_map in enumerate(alloc_by_split)
            if (split_map.get(s_id, (0.0, 0.0))[0] > 0 or split_map.get(s_id, (0.0, 0.0))[1] > 0)
        ]
        qty_positive_indices = [
            idx for idx in active_indices if alloc_by_split[idx].get(s_id, (0.0, 0.0))[0] > 0
        ]
        weight_indices = qty_positive_indices if qty_positive_indices else active_indices
        used_val = 0.0
        used_disc = 0.0
        used_voucher = 0.0
        for pos, idx in enumerate(active_indices):
            q, p = alloc_by_split[idx].get(s_id, (0.0, 0.0))
            if idx not in weight_indices:
                auto_val = 0.0
                auto_disc = 0.0
                if (idx, s_id) in custom_val_by_split_item:
                    auto_val = round(custom_val_by_split_item[(idx, s_id)])
                if (idx, s_id) in custom_disc_by_split_item:
                    auto_disc = round(custom_disc_by_split_item[(idx, s_id)])
                line_financials[(idx, s_id)] = (auto_val, auto_disc, 0.0)
                continue
            if idx == weight_indices[-1]:
                val = round(orig_val - used_val)
                disc = round(orig_disc - used_disc)
                voucher = round(orig_voucher - used_voucher)
            else:
                denom = orig_qty if orig_qty > 0 else (orig_promo if orig_promo > 0 else 1.0)
                num = q if orig_qty > 0 else p
                ratio = num / denom
                val = round(orig_val * ratio)
                disc = round(orig_disc * ratio)
                voucher = round(orig_voucher * ratio)
                used_val += val
                used_disc += disc
                used_voucher += voucher
            if (idx, s_id) in custom_val_by_split_item:
                val = round(custom_val_by_split_item[(idx, s_id)])
            if (idx, s_id) in custom_disc_by_split_item:
                disc = round(custom_disc_by_split_item[(idx, s_id)])
            line_financials[(idx, s_id)] = (val, disc, voucher)

    if custom_disc_by_split_item:
        total_split_disc = sum(fin[1] for fin in line_financials.values())
        if abs(total_split_disc - round(total_orig_disc)) > max(1.0, float(len(source_by_id))):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Tổng Số tiền CK của các đơn tách ({total_split_disc:,.0f}) "
                    f"phải khớp với Tổng Số tiền CK đơn gốc ({round(total_orig_disc):,.0f})."
                ),
            )

    first_raw = source_rows[0].raw_payload if isinstance(source_rows[0].raw_payload, dict) else {}
    default_staff_code = (_field(first_raw, ("staffCode", "salesStaffCode", "Mã NVBH")) or "").strip()
    default_staff_name = (_field(first_raw, ("staffName", "salesStaffName", "Tên NVBH")) or "").strip()
    orig_cust_code = (source_rows[0].customer_code or _field(first_raw, ("customerCode", "shopCode", "Mã KH")) or "").strip()
    orig_cust_name = (source_rows[0].customer_name or _field(first_raw, ("customerName", "shopName", "Tên KH")) or "").strip()

    resolved_targets: list[dict[str, Any]] = []
    preview_splits: list[dict[str, Any]] = []

    for split_idx, new_order_num in enumerate(new_order_numbers):
        split_map = alloc_by_split[split_idx]
        split_target = effective_splits[split_idx]
        is_staff_debt = bool(split_target.is_staff_debt)
        chosen_cust_code = (split_target.customer_code or "").strip()
        chosen_cust_name = (split_target.customer_name or "").strip()
        chosen_cust_addr = (split_target.customer_address or "").strip()

        if is_staff_debt:
            staff_code_val = (split_target.staff_code or default_staff_code).strip()
            staff_name_val = (split_target.staff_name or default_staff_name).strip()
            if not chosen_cust_code:
                chosen_cust_code = f"NVBH-{staff_code_val}" if staff_code_val else "NVBH"
            if not chosen_cust_name:
                staff_label = (
                    f"{staff_name_val} ({staff_code_val})"
                    if (staff_name_val and staff_code_val)
                    else (staff_name_val or staff_code_val or "Nhân viên")
                )
                chosen_cust_name = f"NVBH: {staff_label} — Công nợ tách thiếu"
            if not chosen_cust_addr:
                chosen_cust_addr = "Đơn tách phần thiếu gắn công nợ NVBH"
        elif chosen_cust_code and not chosen_cust_name:
            snap_cust = db.scalar(
                select(VinamilkOrderSnapshot)
                .where(VinamilkOrderSnapshot.customer_code == chosen_cust_code)
                .order_by(VinamilkOrderSnapshot.id.desc())
                .limit(1)
            )
            if snap_cust:
                chosen_cust_name = (snap_cust.customer_name or "").strip()
                if not chosen_cust_addr and isinstance(snap_cust.raw_payload, dict):
                    chosen_cust_addr = (
                        _field(snap_cust.raw_payload, ("address", "customerAddress", "shipTo", "Địa chỉ")) or ""
                    ).strip()

        final_cust_code = chosen_cust_code or orig_cust_code
        final_cust_name = chosen_cust_name or orig_cust_name
        status_label = "Đơn Tách (Nợ NVBH)" if is_staff_debt else "Đơn Tách"

        resolved_targets.append({
            "new_order_number": new_order_num,
            "customer_code": final_cust_code,
            "customer_name": final_cust_name,
            "customer_address": chosen_cust_addr,
            "is_staff_debt": is_staff_debt,
            "status_label": status_label,
        })

        split_items_preview: list[dict[str, Any]] = []
        split_qty_sum = 0.0
        split_promo_sum = 0.0
        split_val_sum = 0.0
        split_disc_sum = 0.0
        for s_id, s_row in source_by_id.items():
            q, p = split_map.get(s_id, (0.0, 0.0))
            if q <= 0 and p <= 0:
                continue
            val, disc, voucher = line_financials.get((split_idx, s_id), (0.0, 0.0, 0.0))
            raw_line = s_row.raw_payload if isinstance(s_row.raw_payload, dict) else {}
            unit_str = (_field(raw_line, ("ĐVT", "unit", "unitName")) or "").strip()
            promo_code_str = (_field(raw_line, ("Mã CTKM", "promotionCode", "campaignCode", "ctkmCode")) or "").strip()
            split_qty_sum += q
            split_promo_sum += p
            split_val_sum += val
            split_disc_sum += disc
            split_items_preview.append({
                "snapshot_id": s_id,
                "product_code": s_row.product_code or "",
                "product_name": s_row.product_name or "",
                "promo_code": promo_code_str,
                "unit": unit_str,
                "quantity": _format_qty_value(q),
                "promo_quantity": _format_qty_value(p),
                "value_amount": _format_qty_value(val),
                "discount_amount": _format_qty_value(disc),
            })

        preview_splits.append({
            "new_order_number": new_order_num,
            "customer_code": final_cust_code,
            "customer_name": final_cust_name,
            "customer_address": chosen_cust_addr,
            "is_staff_debt": is_staff_debt,
            "status_label": status_label,
            "total_qty": _format_qty_value(split_qty_sum),
            "total_promo_qty": _format_qty_value(split_promo_sum),
            "total_value": _format_qty_value(split_val_sum),
            "total_discount": _format_qty_value(split_disc_sum),
            "items": split_items_preview,
        })

    preview_data = {
        "source_order_number": source_order_number,
        "customer_code": orig_cust_code,
        "customer_name": orig_cust_name,
        "staff_code": default_staff_code,
        "staff_name": default_staff_name,
        "order_created_date": source_rows[0].order_created_date.isoformat() if source_rows[0].order_created_date else None,
        "total_qty": _format_qty_value(total_orig_qty),
        "total_promo_qty": _format_qty_value(total_orig_promo),
        "total_value": _format_qty_value(total_orig_val),
        "total_discount": _format_qty_value(total_orig_disc),
        "splits": preview_splits,
    }

    return {
        "source_order_number": source_order_number,
        "source_rows": source_rows,
        "source_by_id": source_by_id,
        "effective_splits": effective_splits,
        "alloc_by_split": alloc_by_split,
        "new_order_numbers": new_order_numbers,
        "line_financials": line_financials,
        "resolved_targets": resolved_targets,
        "preview_data": preview_data,
    }


def _split_vinamilk_order(
    db: Session,
    payload: SplitOrderRequest,
    performed_by: str | None = None,
    ignore_split_request_id: int | None = None,
) -> dict[str, Any]:
    actor = (performed_by or "").strip() or "Hệ thống"
    prepared = _prepare_split_vinamilk_order(
        db,
        payload,
        ignore_split_request_id=ignore_split_request_id,
    )
    source_order_number: str = prepared["source_order_number"]
    source_by_id: dict[int, VinamilkOrderSnapshot] = prepared["source_by_id"]
    alloc_by_split: list[dict[int, tuple[float, float]]] = prepared["alloc_by_split"]
    new_order_numbers: list[str] = prepared["new_order_numbers"]
    line_financials: dict[tuple[int, int], tuple[float, float, float]] = prepared["line_financials"]
    resolved_targets: list[dict[str, Any]] = prepared["resolved_targets"]
    now = datetime.utcnow()

    for split_idx, target_info in enumerate(resolved_targets):
        new_order_num = target_info["new_order_number"]
        split_map = alloc_by_split[split_idx]
        is_staff_debt = bool(target_info["is_staff_debt"])
        final_cust_code = target_info["customer_code"]
        final_cust_name = target_info["customer_name"]
        chosen_cust_addr = target_info["customer_address"]
        status_label = target_info["status_label"]

        for s_id, s_row in source_by_id.items():
            q, p = split_map.get(s_id, (0.0, 0.0))
            if q <= 0 and p <= 0:
                continue
            val, disc, voucher = line_financials.get((split_idx, s_id), (0.0, 0.0, 0.0))
            base_raw = dict(s_row.raw_payload) if isinstance(s_row.raw_payload, dict) else {}
            fmt_q = _format_qty_value(q)
            fmt_p = _format_qty_value(p)
            fmt_val = _format_qty_value(val)
            fmt_disc = _format_qty_value(disc)
            fmt_voucher = _format_qty_value(voucher)

            cust_code = final_cust_code or s_row.customer_code
            cust_name = final_cust_name or s_row.customer_name

            base_raw["Số đơn hàng"] = new_order_num
            base_raw["orderNumber"] = new_order_num
            if cust_code:
                base_raw["Mã KH"] = cust_code
                base_raw["customerCode"] = cust_code
                base_raw["shopCode"] = cust_code
            if cust_name:
                base_raw["Tên KH"] = cust_name
                base_raw["customerName"] = cust_name
                base_raw["shopName"] = cust_name
            if chosen_cust_addr:
                base_raw["Địa chỉ"] = chosen_cust_addr
                base_raw["address"] = chosen_cust_addr
                base_raw["customerAddress"] = chosen_cust_addr
                base_raw["shipTo"] = chosen_cust_addr
            base_raw["Số lượng"] = fmt_q
            base_raw["quantity"] = fmt_q
            base_raw["qty"] = fmt_q
            base_raw["Số lượng KM"] = fmt_p
            base_raw["promotionQuantity"] = fmt_p
            base_raw["Giá trị"] = fmt_val
            base_raw["totalValue"] = fmt_val
            base_raw["Số tiền CK"] = fmt_disc
            base_raw["totalDiscount"] = fmt_disc
            base_raw["Giảm giá voucher"] = fmt_voucher
            base_raw["voucherAmount"] = fmt_voucher
            base_raw["orderStatus"] = status_label
            base_raw["status"] = status_label
            base_raw["_is_staff_debt"] = is_staff_debt
            base_raw["Người thực hiện"] = actor
            base_raw["performedBy"] = actor

            remote_key = hashlib.sha256(f"SPLIT|{new_order_num}|{s_id}".encode()).hexdigest()
            db.add(VinamilkOrderSnapshot(
                remote_key=remote_key,
                order_number=new_order_num,
                original_order_number=source_order_number,
                customer_code=cust_code,
                customer_name=cust_name,
                product_code=s_row.product_code,
                product_name=s_row.product_name,
                status=status_label,
                processing_status=status_label,
                performed_by=actor,
                is_synthetic=True,
                warehouse_updated=s_row.warehouse_updated,
                returned=s_row.returned,
                order_created_date=s_row.order_created_date,
                delivery_date=s_row.delivery_date,
                synced_from=s_row.synced_from,
                synced_to=s_row.synced_to,
                synced_at=now,
                raw_payload=base_raw,
            ))
        db.add(VinamilkOrderReplacement(
            new_order_number=new_order_num,
            replaced_order_number=source_order_number,
            replacement_type="SPLIT",
            performed_by=actor,
            updated_at=now,
        ))

    db.commit()
    return {
        "source_order_number": source_order_number,
        "replaced_order_number": source_order_number,
        "new_order_numbers": new_order_numbers,
        "replacement_type": "SPLIT",
        "performed_by": actor,
    }


def _serialize_split_order_request(req: VinamilkOrderSplitRequest) -> dict[str, Any]:
    preview = req.preview_data if isinstance(req.preview_data, dict) else {}
    return {
        "id": req.id,
        "source_order_number": req.source_order_number,
        "status": req.status,
        "requested_by": req.requested_by or "Hệ thống",
        "requested_at": _iso_utc(req.requested_at),
        "reviewed_by": req.reviewed_by,
        "reviewed_at": _iso_utc(req.reviewed_at),
        "rejection_reason": req.rejection_reason,
        "result_order_numbers": req.result_order_numbers or [],
        "preview": preview,
    }


def _create_split_order_request(
    db: Session,
    payload: SplitOrderRequest,
    requested_by: str | None = None,
) -> dict[str, Any]:
    actor = (requested_by or "").strip() or "Hệ thống"
    prepared = _prepare_split_vinamilk_order(db, payload)
    req_row = VinamilkOrderSplitRequest(
        source_order_number=prepared["source_order_number"],
        status="PENDING",
        requested_by=actor,
        requested_at=datetime.utcnow(),
        request_payload=payload.model_dump(mode="json"),
        preview_data=prepared["preview_data"],
    )
    db.add(req_row)
    db.commit()
    db.refresh(req_row)
    return _serialize_split_order_request(req_row)


def _approve_split_order_request(
    db: Session,
    request_id: int,
    reviewed_by: str | None = None,
) -> dict[str, Any]:
    req_row = db.get(VinamilkOrderSplitRequest, request_id)
    if not req_row:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu tách đơn.")
    if req_row.status != "PENDING":
        raise HTTPException(
            status_code=400,
            detail=f"Yêu cầu tách đơn #{request_id} đã được xử lý ({req_row.status}).",
        )
    reviewer = (reviewed_by or "").strip() or "Kế toán"
    requester = (req_row.requested_by or "").strip()
    if requester and reviewer and requester != reviewer:
        actor_label = f"{requester} (KT duyệt: {reviewer})"
    else:
        actor_label = reviewer or requester or "Hệ thống"

    payload_obj = SplitOrderRequest.model_validate(req_row.request_payload)
    split_res = _split_vinamilk_order(
        db,
        payload_obj,
        performed_by=actor_label,
        ignore_split_request_id=req_row.id,
    )
    req_row.status = "APPROVED"
    req_row.reviewed_by = reviewer
    req_row.reviewed_at = datetime.utcnow()
    req_row.result_order_numbers = split_res["new_order_numbers"]
    db.commit()
    db.refresh(req_row)
    return {
        **_serialize_split_order_request(req_row),
        "new_order_numbers": split_res["new_order_numbers"],
        "replaced_order_number": split_res["replaced_order_number"],
        "performed_by": actor_label,
    }


def _reject_split_order_request(
    db: Session,
    request_id: int,
    reason: str | None = None,
    reviewed_by: str | None = None,
) -> dict[str, Any]:
    req_row = db.get(VinamilkOrderSplitRequest, request_id)
    if not req_row:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu tách đơn.")
    if req_row.status != "PENDING":
        raise HTTPException(
            status_code=400,
            detail=f"Yêu cầu tách đơn #{request_id} đã được xử lý ({req_row.status}).",
        )
    req_row.status = "REJECTED"
    req_row.reviewed_by = (reviewed_by or "").strip() or "Kế toán"
    req_row.reviewed_at = datetime.utcnow()
    req_row.rejection_reason = (reason or "").strip() or None
    db.commit()
    db.refresh(req_row)
    return _serialize_split_order_request(req_row)


def _merge_vinamilk_orders(
    db: Session,
    payload: MergeOrdersRequest,
    performed_by: str | None = None,
) -> dict[str, Any]:
    actor = (performed_by or "").strip() or "Hệ thống"
    raw_nums = payload.source_order_numbers or payload.order_numbers or []
    order_nums = list(dict.fromkeys(num.strip() for num in raw_nums if num and num.strip()))
    if len(order_nums) < 2:
        raise HTTPException(status_code=400, detail="Cần chọn ít nhất 2 đơn hàng để gộp.")

    source_rows = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(
            VinamilkOrderSnapshot.order_number.in_(order_nums),
            VinamilkOrderSnapshot.product_code.is_not(None),
        )
        .order_by(VinamilkOrderSnapshot.id)
    ).all()
    found_orders = {row.order_number for row in source_rows if row.order_number}
    missing = [num for num in order_nums if num not in found_orders]
    if missing:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy đơn hàng: {', '.join(missing)}.")
    if any(getattr(row, "is_synthetic", False) for row in source_rows):
        raise HTTPException(status_code=400, detail="Không thể gộp các đơn đã là Đơn Tách hoặc Đơn Gộp.")

    _check_orders_available_for_split_merge(db, order_nums)

    rep_order_num = (payload.representative_order_number or "").strip()
    if rep_order_num not in order_nums:
        rep_order_num = order_nums[0]
    rep_row = next((r for r in source_rows if r.order_number == rep_order_num), source_rows[0])
    rep_raw = dict(rep_row.raw_payload) if isinstance(rep_row.raw_payload, dict) else {}

    ref_date = rep_row.order_created_date or date.today()
    prefix = f"GD-{ref_date:%y%m%d}-"
    existing_gd = db.scalars(
        select(VinamilkOrderSnapshot.order_number)
        .where(VinamilkOrderSnapshot.order_number.like(f"{prefix}%"))
        .distinct()
    ).all()
    max_seq = 0
    for code in existing_gd:
        if not code:
            continue
        tail = code[len(prefix):]
        if tail.isdigit():
            max_seq = max(max_seq, int(tail))
    new_order_num = f"{prefix}{max_seq + 1:03d}"

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in source_rows:
        raw = row.raw_payload if isinstance(row.raw_payload, dict) else {}
        prod_code = (row.product_code or _field(raw, ("productCode", "itemCode", "sku", "Mã sản phẩm")) or "").strip().upper()
        promo_code = (_field(raw, ("Mã CTKM", "promotionCode", "campaignCode", "ctkmCode", "promotionId")) or "").strip().upper()
        key = (prod_code, promo_code)
        qty = _float_from_payload(raw, ("Số lượng", "quantity", "qty"))
        promo_qty = _float_from_payload(raw, ("Số lượng KM", "promotionQuantity", "freeQuantity", "giftQuantity"))
        val = _float_from_payload(raw, ("Giá trị", "totalValue", "total", "amount"))
        disc = _float_from_payload(raw, ("Số tiền CK", "totalDiscount", "discountAmount"))
        voucher = _float_from_payload(raw, ("Giảm giá voucher", "voucherAmount", "voucherDiscount"))

        if key not in grouped:
            grouped[key] = {
                "template_row": row,
                "template_raw": dict(raw),
                "qty": qty,
                "promo_qty": promo_qty,
                "val": val,
                "disc": disc,
                "voucher": voucher,
            }
        else:
            grouped[key]["qty"] += qty
            grouped[key]["promo_qty"] += promo_qty
            grouped[key]["val"] += val
            grouped[key]["disc"] += disc
            grouped[key]["voucher"] += voucher

    header_keys = (
        "createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày tạo", "Ngày",
        "deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày giao",
        "staffCode", "salesStaffCode", "Mã NVBH",
        "staffName", "salesStaffName", "Tên NVBH",
        "customerCode", "shopCode", "Mã KH",
        "customerName", "shopName", "Tên KH",
        "address", "customerAddress", "shipTo", "Địa chỉ",
        "initialOrderDate", "originalOrderDate", "Ngày đơn hàng gốc",
    )
    warehouse_updated = (
        True if any(r.warehouse_updated is True for r in source_rows)
        else (False if any(r.warehouse_updated is False for r in source_rows) else None)
    )
    returned = (
        all(r.returned is True for r in source_rows)
        if any(r.returned is not None for r in source_rows)
        else None
    )
    now = datetime.utcnow()
    replaced_str = ", ".join(order_nums)

    for line_idx, ((prod_code, promo_code), group_info) in enumerate(grouped.items(), start=1):
        t_row: VinamilkOrderSnapshot = group_info["template_row"]
        merged_raw = dict(group_info["template_raw"])
        for h_key in header_keys:
            if h_key in rep_raw:
                merged_raw[h_key] = rep_raw[h_key]

        fmt_q = _format_qty_value(group_info["qty"])
        fmt_p = _format_qty_value(group_info["promo_qty"])
        fmt_val = _format_qty_value(group_info["val"])
        fmt_disc = _format_qty_value(group_info["disc"])
        fmt_voucher = _format_qty_value(group_info["voucher"])

        merged_raw["Số đơn hàng"] = new_order_num
        merged_raw["orderNumber"] = new_order_num
        merged_raw["Số lượng"] = fmt_q
        merged_raw["quantity"] = fmt_q
        merged_raw["qty"] = fmt_q
        merged_raw["Số lượng KM"] = fmt_p
        merged_raw["promotionQuantity"] = fmt_p
        merged_raw["Giá trị"] = fmt_val
        merged_raw["totalValue"] = fmt_val
        merged_raw["Số tiền CK"] = fmt_disc
        merged_raw["totalDiscount"] = fmt_disc
        merged_raw["Giảm giá voucher"] = fmt_voucher
        merged_raw["voucherAmount"] = fmt_voucher
        merged_raw["orderStatus"] = "Đơn Gộp"
        merged_raw["status"] = "Đơn Gộp"
        merged_raw["Người thực hiện"] = actor
        merged_raw["performedBy"] = actor

        remote_key = hashlib.sha256(f"MERGE|{new_order_num}|{prod_code}|{promo_code}|{line_idx}".encode()).hexdigest()
        db.add(VinamilkOrderSnapshot(
            remote_key=remote_key,
            order_number=new_order_num,
            original_order_number=replaced_str[:120],
            customer_code=rep_row.customer_code,
            customer_name=rep_row.customer_name,
            product_code=t_row.product_code,
            product_name=t_row.product_name,
            status="Đơn Gộp",
            processing_status="Đơn Gộp",
            performed_by=actor,
            is_synthetic=True,
            warehouse_updated=warehouse_updated,
            returned=returned,
            order_created_date=rep_row.order_created_date,
            delivery_date=rep_row.delivery_date,
            synced_from=rep_row.synced_from,
            synced_to=rep_row.synced_to,
            synced_at=now,
            raw_payload=merged_raw,
        ))

    db.add(VinamilkOrderReplacement(
        new_order_number=new_order_num,
        replaced_order_number=replaced_str,
        replacement_type="MERGE",
        performed_by=actor,
        updated_at=now,
    ))
    db.commit()
    return {
        "new_order_number": new_order_num,
        "source_order_numbers": order_nums,
        "merged_order_numbers": order_nums,
        "replacement_type": "MERGE",
        "performed_by": actor,
    }


def _revert_split_or_merge_order(db: Session, order_number: str) -> dict[str, Any]:
    target = order_number.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Mã đơn hàng không hợp lệ.")

    all_replacements = [
        item for item in db.scalars(select(VinamilkOrderReplacement)).all()
        if getattr(item, "replacement_type", "MANUAL") in ("SPLIT", "MERGE")
    ]
    matched_replacements: list[VinamilkOrderReplacement] = []
    direct = next((item for item in all_replacements if item.new_order_number == target), None)
    if direct is not None:
        if getattr(direct, "replacement_type", "") == "SPLIT":
            matched_replacements = [
                item for item in all_replacements
                if getattr(item, "replacement_type", "") == "SPLIT"
                and item.replaced_order_number == direct.replaced_order_number
            ]
        else:
            matched_replacements = [direct]
    else:
        for item in all_replacements:
            old_parts = [part.strip() for part in (item.replaced_order_number or "").split(",") if part.strip()]
            if target in old_parts:
                matched_replacements.append(item)

    if not matched_replacements:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy thông tin Tách/Gộp cho đơn hàng {target}.")

    synthetic_orders = sorted({item.new_order_number for item in matched_replacements})
    restored_orders: list[str] = []
    for item in matched_replacements:
        for part in (item.replaced_order_number or "").split(","):
            clean = part.strip()
            if clean and clean not in restored_orders:
                restored_orders.append(clean)
        db.delete(item)

    if synthetic_orders:
        db.execute(
            delete(VinamilkOrderSnapshot).where(
                VinamilkOrderSnapshot.order_number.in_(synthetic_orders),
                VinamilkOrderSnapshot.is_synthetic.is_(True),
            )
        )
    db.commit()
    return {
        "reverted_orders": synthetic_orders,
        "deleted_synthetic_orders": synthetic_orders,
        "restored_orders": restored_orders,
    }


def _date_value(value: str) -> date:
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value.strip(), pattern).date()
        except ValueError:
            continue
    raise ValueError(f"Ngày không hợp lệ: {value}")


def _field(row: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _row_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("rows", "list", "items", "content", "data"):
        if key not in payload:
            continue
        nested = payload[key]
        if isinstance(nested, list):
            return [row for row in nested if isinstance(row, dict)]
        rows = _row_list(nested)
        if rows or nested is None:
            return rows
    return [payload]


def _parse_optional_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return _date_value(value)
    except ValueError:
        return None


def _line_key(row: dict[str, Any]) -> str | None:
    return _field(row, ("lineId", "itemId", "orderItemId", "detailId", "id"))


def _quantity(value: Any) -> int:
    try:
        quantity = int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Số lượng không hợp lệ: {value}") from exc
    if quantity < 0:
        raise ValueError("Số lượng không được âm.")
    return quantity


def _parse_json_body(body: object) -> Any:
    text = str(body or "").strip()
    if not text:
        raise RuntimeError("Vinamilk trả về response rỗng.")
    if text.startswith("<"):
        raise RuntimeError("Vinamilk trả về trang HTML, có thể phiên đăng nhập đã hết hạn.")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        preview = " ".join(text[:200].split())
        raise RuntimeError(f"Vinamilk không trả về JSON hợp lệ: {preview}") from exc


def _save_snapshot(db: Session, payload: Any, from_date: date, to_date: date) -> int:
    rows = _row_list(payload)
    if not rows:
        return 0
        
    row_data_list = []
    keys_to_fetch = []
    
    for row in rows:
        order_number = _field(row, ("orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng"))
        product_code = _field(row, ("productCode", "itemCode", "sku", "Mã sản phẩm"))
        line_id = _field(row, ("lineId", "itemId", "orderItemId", "detailId", "id"))
        identity = "|".join((order_number or "", product_code or "", line_id or ""))
        if not identity.strip("|"):
            identity = json.dumps(row, ensure_ascii=False, sort_keys=True, default=str)
        remote_key = hashlib.sha256(identity.encode()).hexdigest()
        keys_to_fetch.append(remote_key)
        row_data_list.append((remote_key, row, order_number, product_code))

    existing_snapshots = {}
    chunk_size = 500
    for i in range(0, len(keys_to_fetch), chunk_size):
        chunk_keys = keys_to_fetch[i:i+chunk_size]
        found = db.scalars(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.remote_key.in_(chunk_keys))).all()
        for s in found:
            existing_snapshots[s.remote_key] = s

    saved = 0
    for remote_key, row, order_number, product_code in row_data_list:
        snapshot = existing_snapshots.get(remote_key)
        if snapshot is None:
            snapshot = VinamilkOrderSnapshot(remote_key=remote_key, raw_payload={})
            db.add(snapshot)
            existing_snapshots[remote_key] = snapshot
            
        snapshot.order_number = order_number
        snapshot.original_order_number = _field(row, ("fromSaleOrderNumber", "originalOrderNumber", "fromSaleOrderCode", "originalOrderId"))
        snapshot.customer_code = _field(row, ("customerCode", "shopCode", "Mã KH"))
        snapshot.customer_name = _field(row, ("customerName", "shopName", "Tên KH"))
        snapshot.product_code = product_code
        snapshot.product_name = _field(row, ("productName", "itemName", "product", "Sản phẩm"))
        snapshot.status = _field(row, ("orderStatus", "status"))
        snapshot.performed_by = "Hệ thống"
        snapshot.order_created_date = _parse_optional_date(_field(row, ("createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày")))
        snapshot.delivery_date = _parse_optional_date(_field(row, ("deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày")))
        snapshot.synced_from = from_date
        snapshot.synced_to = to_date
        snapshot.synced_at = datetime.utcnow()
        snapshot.raw_payload = row
        saved += 1
    # Dòng tiêu đề đơn (không có sản phẩm) từ các lần đồng bộ cũ là dữ liệu thừa khi đã có dòng chi tiết.
    detailed_orders = sorted({number for _, _, number, product in row_data_list if number and product})
    for i in range(0, len(detailed_orders), chunk_size):
        db.execute(
            delete(VinamilkOrderSnapshot).where(
                VinamilkOrderSnapshot.order_number.in_(detailed_orders[i:i + chunk_size]),
                VinamilkOrderSnapshot.product_code.is_(None),
            )
        )
    return saved

def read_cookie() -> str:
    if _runtime_cookie:
        return _runtime_cookie
    local_cookie = dotenv_values(_ENV_LOCAL).get("VINAMILK_SESSION_COOKIE", "")
    return (local_cookie or settings.VINAMILK_SESSION_COOKIE).strip()


def _persist_cookie(cookie: str) -> None:
    if not cookie:
        return
    try:
        set_key(str(_ENV_LOCAL), "VINAMILK_SESSION_COOKIE", cookie, quote_mode="never")
    except Exception:
        pass


async def refresh_cookie() -> str:
    global _runtime_cookie
    async with _cookie_refresh_lock:
        cookie = await asyncio.to_thread(login_and_get_cookie)
        if not cookie:
            raise RuntimeError("Đăng nhập thành công nhưng không tạo được cookie Vinamilk.")
        _runtime_cookie = cookie
        _persist_cookie(cookie)
        return cookie


def _browser_cookies(session_cookie: str) -> list[dict[str, str]]:
    return [
        {
            "name": part.split("=", 1)[0].strip(),
            "value": part.split("=", 1)[1].strip(),
            "domain": "vinamilk.dmsone.vn",
            "path": "/",
        }
        for part in session_cookie.split(";")
        if "=" in part and part.split("=", 1)[0].strip()
    ]


def _fetch_vinamilk_sync(session_cookie: str, form: dict[str, str]) -> dict[str, object]:
    """Gọi DMS bằng Playwright sync. Phải chạy trong thread, không chạy trực tiếp trong loop FastAPI."""
    import tempfile
    import os
    import openpyxl

    form["page"] = str(form.get("page", "1"))
    form["rows"] = str(form.get("rows", "2000"))

    from_date = form.get("fromDate", "")
    to_date = form.get("toDate", "")
    if "-" in from_date:
        from_date = "/".join(reversed(from_date.split("-")))
    if "-" in to_date:
        to_date = "/".join(reversed(to_date.split("-")))

    export_form = {
        "orderNumber": "",
        "refOrderNumber": "",
        "fromDate": from_date,
        "toDate": to_date,
        "deliveryDate": "",
        "customerCode": "",
        "customerName": "",
        "orderSource": "0",
        "priorityCode": "-1",
        "csvStatus": "",
        "xmlStatus": "",
        "saleStaff": "",
        "deliveryStaff": "",
        "orderType": "IN",
        "saleOrderType": "-1",
        "reportCode": "1790085269000",
        "reportFormId": "",
    }
    scope = form.get("scope", "all")
    if scope == "warehouse":
        del export_form["saleOrderType"]
        export_form.update({"approved": "1", "approvedStep": "3"})
    configure_playwright_browser_path()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=_PLAYWRIGHT_LAUNCH_ARGS)
        try:
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/140.0.0.0 Safari/537.36"
                ),
                locale="en-US",
            )
            context.add_cookies(_browser_cookies(session_cookie))
            resp = context.request.post(
                "https://vinamilk.dmsone.vn/sale-product/search-sale/export-excel",
                form=export_form,
                headers={
                    "accept": "application/json, text/javascript, */*; q=0.01",
                    "x-requested-with": "XMLHttpRequest",
                    "referer": "https://vinamilk.dmsone.vn/sale-product/search-sale/info",
                },
            )
            if resp.status in (401, 403):
                return {"status": resp.status, "body": ""}
            try:
                data = resp.json()
            except Exception:
                return {"status": 401, "body": ""}
            if data and data.get("hasData") is False and not data.get("path"):
                return {"status": 200, "body": "[]"}
            if not data or not data.get("path"):
                raise RuntimeError(f"Failed to export excel: {data}")

            excel_bytes = context.request.get(data["path"]).body()
            fd, temp_path = tempfile.mkstemp(suffix=".xlsx")
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(excel_bytes)
                workbook = openpyxl.load_workbook(temp_path, data_only=True)
                sheet = workbook.active
                headers = [cell.value for cell in sheet[1]]
                rows = []
                for row in sheet.iter_rows(min_row=2, values_only=True):
                    row_dict = dict(zip(headers, row))
                    if row_dict.get("Số đơn hàng") and str(row_dict.get("Số đơn hàng")) != "None":
                        for key, value in row_dict.items():
                            if hasattr(value, "isoformat"):
                                row_dict[key] = value.isoformat()
                        rows.append(row_dict)
            finally:
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            return {"status": 200, "body": json.dumps(rows)}
        finally:
            browser.close()


async def fetch_vinamilk(session_cookie: str, form: dict[str, str]) -> dict[str, object]:
    try:
        return await asyncio.to_thread(_fetch_vinamilk_sync, session_cookie, form)
    except Exception as exc:
        detail = str(exc).strip() or repr(exc)
        raise RuntimeError(f"Playwright không thể gọi Vinamilk: {type(exc).__name__}: {detail}") from exc


async def _fetch_vinamilk_payload(session_cookie: str, form: dict[str, str]) -> tuple[str, Any]:
    if not session_cookie:
        session_cookie = await refresh_cookie()
    try:
        result = await fetch_vinamilk(session_cookie, form)
    except Exception:
        # Khi cookie cũ hết hạn hoặc bị lỗi kết nối, tự động đăng nhập lại để lấy cookie mới và thử lại
        session_cookie = await refresh_cookie()
        result = await fetch_vinamilk(session_cookie, form)

    if result["status"] in (401, 403):
        session_cookie = await refresh_cookie()
        result = await fetch_vinamilk(session_cookie, form)
    if result["status"] >= 400:
        raise RuntimeError(f"Vinamilk trả về HTTP {result['status']}.")
    try:
        payload = _parse_json_body(result["body"])
    except RuntimeError:
        session_cookie = await refresh_cookie()
        result = await fetch_vinamilk(session_cookie, form)
        if result["status"] >= 400:
            raise RuntimeError(f"Vinamilk trả về HTTP {result['status']}.")
        payload = _parse_json_body(result["body"])
    return session_cookie, payload


async def sync_vinamilk_day(
    db: Session, day_form: dict[str, str], day: date, session_cookie: str
) -> tuple[str, int]:
    """Đồng bộ 1 ngày: dòng đơn và trạng thái cập nhật kho."""
    session_cookie, payload = await _fetch_vinamilk_payload(session_cookie, day_form)
    row_count = _save_snapshot(db, payload, day, day)
    try:
        session_cookie, scoped_payload = await _fetch_vinamilk_payload(
            session_cookie, {**day_form, "scope": "warehouse"}
        )
        warehouse_orders = _order_numbers(scoped_payload)
    except (RuntimeError, ValueError):
        warehouse_orders = None
    _apply_scoped_states(db, day, warehouse_orders)
    db.commit()
    return session_cookie, row_count


@router.post("/vinamilk")
async def trigger_sync(request: VinamilkSearchRequest, db: Session = Depends(get_db)):
    form = request.model_dump()
    form["page"] = str(form["page"])
    form["rows"] = str(form["rows"])
    from_date = _date_value(request.fromDate)
    to_date = _date_value(request.toDate)
    try:
        days = list(iter_inclusive_dates(from_date, to_date))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    sync_run = VinamilkSyncRun(from_date=from_date, to_date=to_date, status="RUNNING")
    db.add(sync_run)
    db.commit()

    session_cookie = read_cookie()
    day_results: list[dict[str, Any]] = []
    saved_total = 0
    try:
        for day in days:
            day_form = {**form, "fromDate": day.strftime("%d/%m/%Y"), "toDate": day.strftime("%d/%m/%Y")}
            try:
                session_cookie, row_count = await sync_vinamilk_day(db, day_form, day, session_cookie)
                saved_total += row_count
                day_results.append({"date": day.isoformat(), "status": "SUCCESS", "row_count": row_count})
            except (RuntimeError, ValueError) as day_exc:
                db.rollback()
                day_results.append({"date": day.isoformat(), "status": "FAILED", "row_count": 0, "error": str(day_exc)})

        failed_days = [item for item in day_results if item["status"] == "FAILED"]
        succeeded_days = [item for item in day_results if item["status"] == "SUCCESS"]
        if not succeeded_days:
            raise RuntimeError(
                failed_days[0]["error"] if len(failed_days) == 1 else
                "Không đồng bộ được ngày nào: " + "; ".join(f"{item['date']}: {item['error']}" for item in failed_days)
            )
        sync_run.status = "PARTIAL" if failed_days else "SUCCESS"
        sync_run.row_count = saved_total
        sync_run.finished_at = datetime.utcnow()
        sync_run.error_message = (
            "; ".join(f"{item['date']}: {item['error']}" for item in failed_days) if failed_days else None
        )
        db.add(sync_run)
        db.commit()
        return {
            "rows": [],
            "row_count": saved_total,
            "days_total": len(days),
            "days_succeeded": len(succeeded_days),
            "days_failed": [item["date"] for item in failed_days],
            "day_results": day_results,
            "status": sync_run.status,
            "synced_at": _iso_utc(sync_run.finished_at),
        }
    except (RuntimeError, ValueError) as exc:
        db.rollback()
        sync_run.status = "FAILED"
        sync_run.row_count = saved_total
        sync_run.error_message = str(exc)
        sync_run.finished_at = datetime.utcnow()
        db.add(sync_run)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/vinamilk-orders")
def list_local_vinamilk_orders(
    from_date: date,
    to_date: date,
    source: str = Query(default="manual", pattern="^(manual|sync)$"),
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=2000, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    filters = [
        VinamilkOrderSnapshot.order_created_date >= from_date,
        VinamilkOrderSnapshot.order_created_date <= to_date,
    ]
    if search and search.strip():
        term = f"%{search.strip()}%"
        filters.append(or_(
            VinamilkOrderSnapshot.order_number.ilike(term),
            VinamilkOrderSnapshot.customer_code.ilike(term),
            VinamilkOrderSnapshot.customer_name.ilike(term),
            VinamilkOrderSnapshot.product_code.ilike(term),
            VinamilkOrderSnapshot.product_name.ilike(term),
        ))
    if status:
        filters.append(VinamilkOrderSnapshot.status == status)
    snapshot_total = db.scalar(select(func.count()).select_from(VinamilkOrderSnapshot).where(*filters)) or 0
    rows = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(*filters)
        .order_by(VinamilkOrderSnapshot.order_created_date.desc(), VinamilkOrderSnapshot.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    latest = db.scalar(select(VinamilkSyncRun).where(
        VinamilkSyncRun.from_date <= to_date,
        VinamilkSyncRun.to_date >= from_date,
        VinamilkSyncRun.status.in_(("SUCCESS", "PARTIAL")),
    ).order_by(VinamilkSyncRun.finished_at.desc()))
    allocations_by_snapshot: dict[int, list[VinamilkOrderAllocation]] = defaultdict(list)
    if source != "sync" and rows:
        allocations = db.scalars(
            select(VinamilkOrderAllocation)
            .where(VinamilkOrderAllocation.snapshot_id.in_([row.id for row in rows]))
            .order_by(VinamilkOrderAllocation.id)
        ).all()
        for allocation in allocations:
            allocations_by_snapshot[allocation.snapshot_id].append(allocation)
    output_rows: list[dict[str, Any]] = []
    replaced_by: dict[str, list[str]] = defaultdict(list)
    replaced_order_for: dict[str, str] = {}
    replacement_type_for: dict[str, str] = {}
    replacement_actor_for: dict[str, str] = {}
    pending_split_for: dict[str, VinamilkOrderSplitRequest] = {}
    if rows:
        all_replacements = db.scalars(select(VinamilkOrderReplacement)).all()
        for replacement in all_replacements:
            replaced_order_for[replacement.new_order_number] = replacement.replaced_order_number
            rep_type = getattr(replacement, "replacement_type", "MANUAL") or "MANUAL"
            replacement_type_for[replacement.new_order_number] = rep_type
            rep_actor = (getattr(replacement, "performed_by", None) or "").strip()
            if rep_actor:
                replacement_actor_for[replacement.new_order_number] = rep_actor
            for old_part in (replacement.replaced_order_number or "").split(","):
                old_clean = old_part.strip()
                if old_clean:
                    if replacement.new_order_number not in replaced_by[old_clean]:
                        replaced_by[old_clean].append(replacement.new_order_number)
                    if old_clean not in replacement_type_for:
                        replacement_type_for[old_clean] = rep_type
        pending_reqs = db.scalars(
            select(VinamilkOrderSplitRequest)
            .where(VinamilkOrderSplitRequest.status == "PENDING")
            .order_by(VinamilkOrderSplitRequest.id.desc())
        ).all()
        for req_item in pending_reqs:
            src_num = (req_item.source_order_number or "").strip()
            if src_num and src_num not in pending_split_for:
                pending_split_for[src_num] = req_item
    for row in rows:
        order_num = row.order_number or ""
        rep_order = replaced_order_for.get(order_num)
        rep_by_list = replaced_by.get(order_num, [])
        pending_req = pending_split_for.get(order_num)
        if rep_order:
            replacement_display = f"TT: {rep_order}"
        elif rep_by_list:
            replacement_display = f"BTT: {', '.join(rep_by_list)}"
        elif pending_req:
            replacement_display = f"Chờ KT duyệt tách (#{pending_req.id})"
        else:
            replacement_display = None
        proc_status = (
            row.processing_status
            if getattr(row, "processing_status", None)
            else ("Đã cập nhật kho" if row.warehouse_updated is True else "")
        )
        if pending_req and not getattr(row, "is_synthetic", False):
            proc_status = "Chờ KT duyệt tách"
        row_actor = (getattr(row, "performed_by", None) or "").strip()
        if not row_actor and isinstance(row.raw_payload, dict):
            row_actor = (
                _field(row.raw_payload, ("performedBy", "Người thực hiện", "_performed_by")) or ""
            ).strip()
        if pending_req and pending_req.requested_by:
            performed_by = f"{pending_req.requested_by} (Chờ KT)"
        else:
            performed_by = replacement_actor_for.get(order_num) or row_actor or "Hệ thống"
        base = {
            **row.raw_payload,
            "Người thực hiện": performed_by,
            "_performed_by": performed_by,
            "_local_id": row.id,
            "_synced_at": _iso_utc(row.synced_at),
            "_allocation_id": None,
            "_warehouse_updated": row.warehouse_updated,
            "_processing_status": proc_status,
            "_is_synthetic": bool(getattr(row, "is_synthetic", False)),
            "_replacement_type": replacement_type_for.get(order_num) or ("PENDING_SPLIT" if pending_req else None),
            "_replaced_order_number": rep_order,
            "_replaced_by_order_numbers": rep_by_list,
            "_replacement_display": replacement_display,
            "_pending_split_request_id": pending_req.id if pending_req else None,
        }
        if source == "sync":
            output_rows.append(base)
            continue
        allocations = allocations_by_snapshot.get(row.id, [])
        if not allocations:
            output_rows.append({**base, "_allocation_status": "UNALLOCATED", "_company_code": None, "_company_name": None, "_allocated_quantity": None, "_distributor_sku": None, "_uploaded_at": None, "_uploaded_by": None, "_note": None})
            continue
        for allocation in allocations:
            output_rows.append({
                **base,
                "_allocation_id": allocation.id,
                "_allocation_status": allocation.status,
                "_allocation_method": allocation.allocation_method,
                "_company_code": allocation.company_code,
                "_company_name": allocation.company_name,
                "_distributor_sku": allocation.distributor_sku,
                "_allocated_quantity": allocation.allocated_quantity,
                "_uploaded_at": _iso_utc(allocation.uploaded_at),
                "_uploaded_by": allocation.uploaded_by,
                "_note": allocation.note,
            })
    return {
        "rows": output_rows,
        "total": snapshot_total,
        "snapshot_total": snapshot_total,
        "snapshot_count": len(rows),
        "row_count": len(output_rows),
        "skip": skip,
        "limit": limit,
        "source": source,
        "last_synced_at": _iso_utc(latest.finished_at) if latest else None,
    }


@router.get("/vinamilk-orders/summary")
def summarize_vinamilk_sales(
    from_date: date,
    to_date: date,
    group_by: str = Query(default="product", pattern="^(product|customer|staff|day|promotion)$"),
    customer: str | None = Query(default=None, max_length=120),
    staff: str | None = Query(default=None, max_length=120),
    product: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
):
    if to_date < from_date:
        raise HTTPException(status_code=422, detail="Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.")
    return build_sales_summary(db, from_date, to_date, group_by, customer, staff, product)


@router.get("/vinamilk-orders/order-options")
def list_vinamilk_order_options(
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = select(VinamilkOrderSnapshot.order_number).where(VinamilkOrderSnapshot.order_number.is_not(None))
    if search.strip():
        query = query.where(VinamilkOrderSnapshot.order_number.ilike(f"%{search.strip()}%"))
    order_numbers = db.scalars(query.distinct().order_by(VinamilkOrderSnapshot.order_number.desc()).limit(limit)).all()
    return {"order_numbers": order_numbers}


@router.get("/vinamilk-orders/customer-options")
def list_vinamilk_customer_options(
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """Trả về danh sách khách hàng từ bảng customers (kèm cửa hàng/công ty) và từ các đơn DMS đã đồng bộ."""
    term = search.strip()
    options_by_code: dict[str, dict[str, Any]] = {}

    cust_stmt = select(Customer).options(
        joinedload(Customer.store),
        joinedload(Customer.company),
        joinedload(Customer.addresses),
    )
    if term:
        like_term = f"%{term}%"
        cust_stmt = cust_stmt.where(or_(Customer.code.ilike(like_term), Customer.name.ilike(like_term)))
    cust_rows = db.scalars(cust_stmt.order_by(Customer.code).limit(limit)).unique().all()
    for c in cust_rows:
        code = (c.code or "").strip()
        if not code:
            continue
        default_addr = next((a.address for a in (c.addresses or []) if a.is_default), None)
        if not default_addr and c.addresses:
            default_addr = c.addresses[0].address
        if not default_addr and c.store:
            default_addr = c.store.address
        options_by_code[code.upper()] = {
            "customer_code": code,
            "customer_name": c.name or "",
            "customer_address": default_addr or "",
            "store_code": c.store.code if c.store else None,
            "store_name": c.store.name if c.store else None,
            "company_code": c.company.code if c.company else None,
            "company_name": c.company.name if c.company else None,
        }

    snap_stmt = (
        select(
            VinamilkOrderSnapshot.customer_code,
            VinamilkOrderSnapshot.customer_name,
        )
        .where(VinamilkOrderSnapshot.customer_code.is_not(None))
        .distinct()
    )
    if term:
        like_term = f"%{term}%"
        snap_stmt = snap_stmt.where(
            or_(
                VinamilkOrderSnapshot.customer_code.ilike(like_term),
                VinamilkOrderSnapshot.customer_name.ilike(like_term),
            )
        )
    for s_code, s_name in db.execute(snap_stmt.limit(limit)).all():
        clean_code = (s_code or "").strip()
        if not clean_code:
            continue
        key = clean_code.upper()
        if key not in options_by_code:
            options_by_code[key] = {
                "customer_code": clean_code,
                "customer_name": (s_name or "").strip(),
                "customer_address": "",
                "store_code": None,
                "store_name": None,
                "company_code": None,
                "company_name": None,
            }

    return {"customers": list(options_by_code.values())[:limit]}


@router.patch("/vinamilk-orders/{new_order_number}/replacement")
def update_vinamilk_order_replacement(
    new_order_number: str,
    payload: OrderReplacementUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = getattr(current_user, "username", None)
    _update_order_replacement(
        db,
        new_order_number,
        payload.replaced_order_number,
        performed_by=actor,
    )
    db.commit()
    return {
        "new_order_number": new_order_number,
        "replaced_order_number": payload.replaced_order_number.strip() if payload.replaced_order_number else None,
        "performed_by": actor if payload.replaced_order_number and payload.replaced_order_number.strip() else "Hệ thống",
    }


@router.post("/vinamilk-orders/split")
def split_vinamilk_order(
    payload: SplitOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _split_vinamilk_order(db, payload, performed_by=getattr(current_user, "username", None))


@router.get("/vinamilk-orders/split-requests")
def list_vinamilk_split_order_requests(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    stmt = select(VinamilkOrderSplitRequest).order_by(
        VinamilkOrderSplitRequest.requested_at.desc(),
        VinamilkOrderSplitRequest.id.desc(),
    )
    if status and status.strip() and status.strip().upper() != "ALL":
        stmt = stmt.where(VinamilkOrderSplitRequest.status == status.strip().upper())
    rows = db.scalars(stmt.limit(limit)).all()
    pending_count = (
        db.scalar(
            select(func.count())
            .select_from(VinamilkOrderSplitRequest)
            .where(VinamilkOrderSplitRequest.status == "PENDING")
        )
        or 0
    )
    return {
        "requests": [_serialize_split_order_request(r) for r in rows],
        "pending_count": int(pending_count),
    }


@router.post("/vinamilk-orders/split-requests")
def create_vinamilk_split_order_request(
    payload: SplitOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _create_split_order_request(
        db,
        payload,
        requested_by=getattr(current_user, "username", None),
    )


@router.post("/vinamilk-orders/split-requests/{request_id}/approve")
def approve_vinamilk_split_order_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _approve_split_order_request(
        db,
        request_id,
        reviewed_by=getattr(current_user, "username", None),
    )


@router.post("/vinamilk-orders/split-requests/{request_id}/reject")
def reject_vinamilk_split_order_request(
    request_id: int,
    payload: RejectSplitOrderRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _reject_split_order_request(
        db,
        request_id,
        reason=payload.reason if payload else None,
        reviewed_by=getattr(current_user, "username", None),
    )


@router.post("/vinamilk-orders/merge")
def merge_vinamilk_orders(
    payload: MergeOrdersRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _merge_vinamilk_orders(db, payload, performed_by=getattr(current_user, "username", None))


@router.delete("/vinamilk-orders/split-merge/{order_number}")
def revert_split_or_merge_order(
    order_number: str,
    db: Session = Depends(get_db),
):
    return _revert_split_or_merge_order(db, order_number)


@router.get("/vinamilk-orders/allocations/template")
def download_allocation_template():
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Can doi don hang"
    sheet.append(["order_number", "line_key", "product_code", "quantity", "company_code", "distributor_sku"])
    sheet.append(["DH-001", "", "02HD14", 10, "001", "123456"])
    output = BytesIO()
    workbook.save(output)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-can-doi-don-hang.xlsx"'},
    )


@router.post("/vinamilk-orders/allocations/upload")
def upload_order_allocations(
    file: UploadFile = File(...),
    uploaded_by: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise ValueError("File Excel không có dữ liệu.")
        headers = [str(value).strip().lower() if value is not None else "" for value in rows[0]]
        required = {"order_number", "product_code", "quantity", "company_code"}
        if not required.issubset(headers):
            raise ValueError("File cần có order_number, product_code, quantity và company_code.")
        companies = {company.code.casefold(): company for company in db.scalars(select(Company)).all()}
        snapshots = db.scalars(select(VinamilkOrderSnapshot)).all()
        by_key: dict[tuple[str, str, str | None], VinamilkOrderSnapshot] = {}
        by_order_product: dict[tuple[str, str], list[VinamilkOrderSnapshot]] = {}
        for snapshot in snapshots:
            order = (snapshot.order_number or "").strip().casefold()
            product = (snapshot.product_code or "").strip().casefold()
            key = (order, product, _line_key(snapshot.raw_payload))
            by_key[key] = snapshot
            by_order_product.setdefault((order, product), []).append(snapshot)
        parsed: list[tuple[VinamilkOrderSnapshot, dict[str, Any]]] = []
        errors: list[str] = []
        totals: dict[int, int] = {}
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            order_number = str(data.get("order_number") or "").strip()
            product_code = str(data.get("product_code") or "").strip().upper()
            line_key = str(data.get("line_key") or "").strip() or None
            company_code = str(data.get("company_code") or "").strip().casefold()
            snapshot = by_key.get((order_number.casefold(), product_code.casefold(), line_key)) if line_key else None
            candidates = by_order_product.get((order_number.casefold(), product_code.casefold()), [])
            if snapshot is None and not line_key and len(candidates) == 1:
                snapshot = candidates[0]
            if not snapshot:
                errors.append(f"Dòng {row_number}: không tìm thấy dòng đơn {order_number}/{product_code}.")
                continue
            company = companies.get(company_code)
            if not company:
                errors.append(f"Dòng {row_number}: không tìm thấy công ty {data.get('company_code')}.")
                continue
            try:
                quantity = _quantity(data.get("quantity"))
            except ValueError as exc:
                errors.append(f"Dòng {row_number}: {exc}")
                continue
            parsed.append((snapshot, {"order_number": order_number, "line_key": line_key, "product_code": product_code, "quantity": quantity, "company": company, "distributor_sku": str(data.get("distributor_sku") or "").strip() or None}))
            totals[snapshot.id] = totals.get(snapshot.id, 0) + quantity
        for snapshot_id, total in totals.items():
            snapshot = db.get(VinamilkOrderSnapshot, snapshot_id)
            expected = _quantity(_field(snapshot.raw_payload, ("quantity", "qty")) or 0)
            if total != expected:
                errors.append(f"Đơn {snapshot.order_number}, SKU {snapshot.product_code}: phân bổ {total}, số lượng gốc {expected}.")
        if errors:
            raise ValueError("; ".join(errors[:20]))
        affected = {snapshot.id for snapshot, _ in parsed}
        if affected:
            db.query(VinamilkOrderAllocation).filter(VinamilkOrderAllocation.snapshot_id.in_(affected)).delete(synchronize_session=False)
        for snapshot, item in parsed:
            company = item["company"]
            db.add(VinamilkOrderAllocation(
                snapshot_id=snapshot.id,
                order_number=item["order_number"],
                line_key=item["line_key"],
                product_code=item["product_code"],
                allocated_quantity=item["quantity"],
                company_id=company.id,
                company_code=company.code,
                company_name=company.name,
                distributor_sku=item["distributor_sku"],
                source_file=file.filename,
                uploaded_by=uploaded_by,
            ))
        db.commit()
        return {"uploaded": len(parsed), "orders": len(affected), "replaced": len(affected)}
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/vinamilk-orders/allocations/bulk-delete")
def bulk_delete_order_allocations(
    payload: AllocationBulkDeleteRequest,
    db: Session = Depends(get_db),
):
    """Xóa các dòng cân đối upload thủ công.

    Hỗ trợ hai chế độ:
    - Chọn nhiều dòng: truyền ``allocation_ids``.
    - Chọn tất cả: đặt ``delete_all=True`` kèm ``from_date``/``to_date`` để xóa
      toàn bộ dòng cân đối thuộc khoảng ngày đang xem.
    """
    try:
        if payload.delete_all:
            if not payload.from_date or not payload.to_date:
                raise HTTPException(status_code=400, detail="Cần có from_date và to_date khi xóa toàn bộ.")
            snapshot_ids = select(VinamilkOrderSnapshot.id).where(
                VinamilkOrderSnapshot.order_created_date >= payload.from_date,
                VinamilkOrderSnapshot.order_created_date <= payload.to_date,
            )
            deleted = db.query(VinamilkOrderAllocation).filter(
                VinamilkOrderAllocation.snapshot_id.in_(snapshot_ids)
            ).delete(synchronize_session=False)
        else:
            allocation_ids = sorted({int(item) for item in payload.allocation_ids if item})
            if not allocation_ids:
                raise HTTPException(status_code=400, detail="Chưa chọn dòng cân đối nào để xóa.")
            deleted = db.query(VinamilkOrderAllocation).filter(
                VinamilkOrderAllocation.id.in_(allocation_ids)
            ).delete(synchronize_session=False)
        db.commit()
        return {"deleted": deleted, "delete_all": payload.delete_all}
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/vinamilk-orders/allocations/{allocation_id}")
def update_order_allocation(
    allocation_id: int,
    payload: AllocationUpdateRequest,
    db: Session = Depends(get_db),
):
    """Chỉnh sửa một dòng cân đối upload thủ công (số lượng, công ty, SKU NPP, ghi chú)."""
    allocation = db.get(VinamilkOrderAllocation, allocation_id)
    if not allocation:
        raise HTTPException(status_code=404, detail="Không tìm thấy dòng cân đối cần chỉnh sửa.")
    try:
        if payload.company_code is not None:
            company_code = payload.company_code.strip()
            if not company_code:
                raise ValueError("Mã công ty không được để trống.")
            company = db.scalar(select(Company).where(func.lower(Company.code) == company_code.casefold()))
            if not company:
                raise ValueError(f"Không tìm thấy công ty {company_code}.")
            allocation.company_id = company.id
            allocation.company_code = company.code
            allocation.company_name = company.name
        if payload.allocated_quantity is not None:
            allocation.allocated_quantity = _quantity(payload.allocated_quantity)
        if payload.distributor_sku is not None:
            allocation.distributor_sku = payload.distributor_sku.strip() or None
        if payload.note is not None:
            allocation.note = payload.note.strip() or None
        db.commit()
        db.refresh(allocation)
        snapshot = db.get(VinamilkOrderSnapshot, allocation.snapshot_id)
        expected_quantity = _quantity(_field(snapshot.raw_payload, ("quantity", "qty")) or 0) if snapshot else None
        allocated_total = db.scalar(select(func.coalesce(func.sum(VinamilkOrderAllocation.allocated_quantity), 0)).where(
            VinamilkOrderAllocation.snapshot_id == allocation.snapshot_id
        ))
        return {
            "id": allocation.id,
            "snapshot_id": allocation.snapshot_id,
            "order_number": allocation.order_number,
            "product_code": allocation.product_code,
            "allocated_quantity": allocation.allocated_quantity,
            "company_code": allocation.company_code,
            "company_name": allocation.company_name,
            "distributor_sku": allocation.distributor_sku,
            "note": allocation.note,
            "status": allocation.status,
            "expected_quantity": expected_quantity,
            "allocated_total": int(allocated_total or 0),
        }
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
