import asyncio
import hashlib
import json
import unicodedata
from collections import defaultdict
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from io import BytesIO
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from pydantic import BaseModel, Field
import httpx
from dotenv import dotenv_values
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload
from app.api.v1.endpoints.promotions import promotion_matches_customer
from app.core.auth import get_current_user, resolve_user_employee
from app.core.config import settings
from app.core.database import get_db
from app.services.vinamilk_sales_summary import build_sales_summary
from app.models.customer import Company, Customer, Store
from app.models.employee import Employee
from app.models.inventory import DeliveryRequest, DeliveryRequestOrder
from app.models.multi_tenant_invoice import Distributor, DistributorSupplierConfig
from app.models.product import Product
from app.models.promotion import Promotion, PromotionRule
from app.models.user import User
from app.models.vinamilk import (
    VinamilkOrderReplacement,
    VinamilkOrderSnapshot,
    VinamilkOrderSplitRequest,
    VinamilkSyncRun,
)
from app.models.vinamilk_allocation import VinamilkOrderAllocation
from app.services.vinamilk_credentials import (
    get_credentials_status,
    load_db_credentials,
    load_db_session_cookie,
    save_db_session_cookie,
    upsert_db_credentials,
)
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


def _today_vn() -> date:
    """Ngày hiện tại theo múi giờ Việt Nam (UTC+7)."""
    return datetime.now(timezone(timedelta(hours=7))).date()


def _is_admin_user(user: User | None) -> bool:
    if user is None:
        return True
    username = (getattr(user, "username", None) or "").strip().lower()
    if username == "admin":
        return True
    roles = getattr(user, "roles", None) or []
    return any((getattr(r, "name", None) or "").strip().lower() == "admin" for r in roles)


def _enforce_today_only_for_non_admin(
    rows: list[VinamilkOrderSnapshot],
    is_admin: bool = True,
    action_label: str = "Tách/Gộp đơn",
    today_date: date | None = None,
) -> None:
    if is_admin:
        return
    today = today_date or _today_vn()
    past_orders: list[str] = []
    for row in rows:
        order_date = row.order_created_date or row.synced_from
        if order_date is not None and order_date != today:
            label = f"{row.order_number} ({order_date:%d/%m/%Y})"
            if label not in past_orders:
                past_orders.append(label)
    if past_orders:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Chỉ tài khoản Admin mới được phép {action_label} đối với đơn hàng khác ngày hôm nay "
                f"({today:%d/%m/%Y}). Đơn bị chặn: {', '.join(past_orders)}."
            ),
        )


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
    delivery_employee_code: str | None = Field(default=None, max_length=20)
    debt_target: str | None = Field(default=None, pattern="^DELIVERY$")
    delivery_recipient: bool = False
    items: list[SplitOrderItemAllocation] = Field(default_factory=list)


class SplitOrderRequest(BaseModel):
    source_order_number: str | None = None
    order_number: str | None = None
    splits: list[SplitOrderTarget]
    auto_assign_remainder_to_staff: bool = False
    auto_assign_remainder_to_delivery: bool = False
    auto_assign_remainder_to_delivery_customer: bool = False
    remainder_delivery_employee_code: str | None = Field(default=None, max_length=20)


class RejectSplitOrderRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class MergeOrdersRequest(BaseModel):
    source_order_numbers: list[str] = Field(default_factory=list)
    order_numbers: list[str] = Field(default_factory=list)
    representative_order_number: str | None = None
    customer_code: str | None = None
    customer_name: str | None = None
    customer_address: str | None = None
    staff_code: str | None = None
    staff_name: str | None = None
    delivery_employee_code: str | None = Field(default=None, max_length=20)


class DeliveryRequestFormOrder(BaseModel):
    order_number: str = Field(min_length=1, max_length=120)
    delivery_employee_code: str = Field(min_length=1, max_length=20)
    status: str = Field(
        default="001-Xuất hàng",
        pattern="^(?:(?:001|002|003).*$|(?:Xuất Hàng|Trả Số|Gửi Số)$)",
    )


class DeliveryRequestFormRequest(BaseModel):
    orders: list[DeliveryRequestFormOrder] = Field(min_length=1, max_length=500)


class VinamilkCredentialUpdateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str | None = Field(default=None, max_length=255)
    verify_login: bool = True


def _order_numbers(payload: Any) -> set[str]:
    numbers = (
        _field(row, ("orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng"))
        for row in _row_list(payload)
    )
    return {number for number in numbers if number}


def _build_delivery_request_form(
    orders: list[dict[str, Any]],
    template_path: Path | None = None,
) -> bytes:
    source_path = template_path or (
        Path(__file__).resolve().parents[3] / "templates" / "delivery_request_form.xlsx"
    )
    workbook = load_workbook(source_path)
    if "DSDonHang" not in workbook.sheetnames:
        raise RuntimeError("Mẫu phiếu xuất hàng không có sheet DSDonHang.")
    worksheet = workbook["DSDonHang"]
    expected_headers = [
        "Ngày đơn hàng",
        "Số đơn hàng",
        "Mã NVGH",
        "Tên NVGH",
        "Mã Khách hàng",
        "Tên Khách hàng",
        "Trạng Thái",
    ]
    actual_headers = [worksheet.cell(4, column).value for column in range(1, 8)]
    if actual_headers != expected_headers:
        raise RuntimeError("Cấu trúc mẫu phiếu xuất hàng không đúng định dạng DSDonHang.")

    for row in worksheet.iter_rows(min_row=5, max_col=7):
        for cell in row:
            cell.value = None

    for row_number, order in enumerate(orders, start=5):
        if row_number > worksheet.max_row:
            worksheet.row_dimensions[row_number].height = worksheet.row_dimensions[5].height
            for column in range(1, 8):
                source_cell = worksheet.cell(5, column)
                target_cell = worksheet.cell(row_number, column)
                if source_cell.has_style:
                    target_cell._style = source_cell._style
        values = (
            order["order_date"],
            order["order_number"],
            order["employee_code"],
            order["employee_name"],
            order["customer_code"],
            order["customer_name"],
            order["status"],
        )
        for column, value in enumerate(values, start=1):
            worksheet.cell(row=row_number, column=column, value=value)

    worksheet.auto_filter.ref = f"A4:G{max(4, len(orders) + 4)}"
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


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
    is_admin: bool = True,
) -> dict[str, Any]:
    source_order_number = (payload.source_order_number or payload.order_number or "").strip()
    if not source_order_number:
        raise HTTPException(status_code=400, detail="Mã đơn hàng gốc không được để trống.")
    if not payload.splits and not payload.auto_assign_remainder_to_delivery_customer:
        raise HTTPException(status_code=400, detail="Cần có ít nhất 1 đơn nhận tách.")

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

    _enforce_today_only_for_non_admin(source_rows, is_admin=is_admin, action_label="tách đơn")

    _check_orders_available_for_split_merge(
        db,
        [source_order_number],
        ignore_split_request_id=ignore_split_request_id,
    )

    source_by_id = {row.id: row for row in source_rows}
    effective_splits: list[SplitOrderTarget] = list(payload.splits)
    delivery_codes = {
        target.delivery_employee_code.strip().upper()
        for target in effective_splits
        if target.delivery_employee_code and target.delivery_employee_code.strip()
    }
    if payload.auto_assign_remainder_to_delivery or payload.auto_assign_remainder_to_delivery_customer:
        remainder_code = (payload.remainder_delivery_employee_code or "").strip().upper()
        if not remainder_code:
            raise HTTPException(status_code=400, detail="Vui lòng chọn NVGH nhận phần thiếu.")
        delivery_codes.add(remainder_code)
    if sum((payload.auto_assign_remainder_to_staff, payload.auto_assign_remainder_to_delivery,
            payload.auto_assign_remainder_to_delivery_customer)) > 1:
        raise HTTPException(status_code=400, detail="Chỉ được chọn một cách phân bổ phần thiếu.")
    for target in effective_splits:
        if target.delivery_recipient and (target.is_staff_debt or target.debt_target or not (target.delivery_employee_code or "").strip()):
            raise HTTPException(status_code=400, detail="Vui lòng chọn NVGH hợp lệ cho đơn nhận phần thiếu.")
        if target.debt_target == "DELIVERY" and (
            not target.is_staff_debt or not (target.delivery_employee_code or "").strip()
        ):
            raise HTTPException(status_code=400, detail="Vui lòng chọn NVGH nhận phần thiếu.")
    delivery_employees = {
        employee.code.strip().upper(): employee
        for employee in db.scalars(select(Employee).where(func.upper(Employee.code).in_(delivery_codes))).all()
    } if delivery_codes else {}
    for code in delivery_codes:
        employee = delivery_employees.get(code)
        if not code.startswith("NV") or employee is None or (employee.status or "").lower() != "active":
            raise HTTPException(status_code=400, detail=f"Không tìm thấy NVGH đang hoạt động {code}.")
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
            if not (payload.auto_assign_remainder_to_staff or payload.auto_assign_remainder_to_delivery or payload.auto_assign_remainder_to_delivery_customer):
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
                is_staff_debt=not payload.auto_assign_remainder_to_delivery_customer,
                debt_target="DELIVERY" if payload.auto_assign_remainder_to_delivery else None,
                delivery_recipient=payload.auto_assign_remainder_to_delivery_customer,
                delivery_employee_code=payload.remainder_delivery_employee_code if (payload.auto_assign_remainder_to_delivery or payload.auto_assign_remainder_to_delivery_customer) else None,
                items=remainder_items,
            )
        )
        alloc_by_split.append(remainder_map)

    if len(effective_splits) < 1:
        raise HTTPException(
            status_code=400,
            detail="Cần có ít nhất 1 đơn nhận tách.",
        )

    first_raw_check = source_rows[0].raw_payload if isinstance(source_rows[0].raw_payload, dict) else {}
    orig_cust_code_check = (
        source_rows[0].customer_code
        or _field(first_raw_check, ("customerCode", "shopCode", "Mã KH"))
        or ""
    ).strip()
    if len(effective_splits) == 1:
        only_target = effective_splits[0]
        target_code = (only_target.customer_code or "").strip()
        if not only_target.is_staff_debt and not only_target.delivery_recipient and (
            not target_code or target_code.upper() == orig_cust_code_check.upper()
        ):
            raise HTTPException(
                status_code=400,
                detail="Khi tách thành 1 đơn, vui lòng chọn Mã khách hàng mới khác với khách hàng của đơn gốc (hoặc gắn Công nợ NVBH).",
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
        delivery_employee = delivery_employees.get((split_target.delivery_employee_code or "").strip().upper())

        if split_target.delivery_recipient:
            if delivery_employee is None:
                raise HTTPException(status_code=400, detail="Vui lòng chọn NVGH nhận phần thiếu.")
            chosen_cust_code = f"NVGH-{delivery_employee.code}"
            chosen_cust_name = f"NVGH: {delivery_employee.name} ({delivery_employee.code})"
            chosen_cust_addr = "Đơn tách giao NVGH"
        elif is_staff_debt:
            if split_target.debt_target == "DELIVERY":
                if delivery_employee is None:
                    raise HTTPException(status_code=400, detail="Vui lòng chọn NVGH nhận phần thiếu.")
                chosen_cust_code = f"NVGH-{delivery_employee.code}"
                chosen_cust_name = f"NVGH: {delivery_employee.name} ({delivery_employee.code}) — Công nợ tách thiếu"
                chosen_cust_addr = "Đơn tách phần thiếu gắn công nợ NVGH"
            else:
                staff_code_val = (split_target.staff_code or default_staff_code).strip()
                staff_name_val = (split_target.staff_name or default_staff_name).strip()
                if not chosen_cust_code:
                    chosen_cust_code = f"NVBH-{staff_code_val}" if staff_code_val else "NVBH"
                if not chosen_cust_name:
                    staff_label = f"{staff_name_val} ({staff_code_val})" if staff_name_val and staff_code_val else (staff_name_val or staff_code_val or "Nhân viên")
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
        status_label = ("Đơn Tách (Nợ NVGH)" if split_target.debt_target == "DELIVERY" else "Đơn Tách (Nợ NVBH)") if is_staff_debt else "Đơn Tách"

        resolved_targets.append({
            "new_order_number": new_order_num,
            "customer_code": final_cust_code,
            "customer_name": final_cust_name,
            "customer_address": chosen_cust_addr,
            "is_staff_debt": is_staff_debt,
            "delivery_recipient": split_target.delivery_recipient,
            "status_label": status_label,
            "delivery_employee_code": delivery_employee.code if delivery_employee else "",
            "delivery_employee_name": delivery_employee.name if delivery_employee else "",
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
            "delivery_recipient": split_target.delivery_recipient,
            "status_label": status_label,
            "delivery_employee_code": delivery_employee.code if delivery_employee else "",
            "delivery_employee_name": delivery_employee.name if delivery_employee else "",
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
    is_admin: bool = True,
) -> dict[str, Any]:
    actor = (performed_by or "").strip() or "Hệ thống"
    prepared = _prepare_split_vinamilk_order(
        db,
        payload,
        ignore_split_request_id=ignore_split_request_id,
        is_admin=is_admin,
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
            base_raw["Mã NVGH"] = target_info["delivery_employee_code"]
            base_raw["Tên NVGH"] = target_info["delivery_employee_name"]
            base_raw["_is_staff_debt"] = is_staff_debt
            if target_info["delivery_recipient"]:
                base_raw["_delivery_recipient"] = True
                base_raw["_order_type"] = "001-Xuất hàng"
                base_raw["Trạng thái tạo đơn"] = "001-Xuất hàng"
                base_raw["orderType"] = "001-Xuất hàng"
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
    is_admin: bool = True,
) -> dict[str, Any]:
    actor = (requested_by or "").strip() or "Hệ thống"
    prepared = _prepare_split_vinamilk_order(db, payload, is_admin=is_admin)
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
    is_admin: bool = True,
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
        is_admin=is_admin,
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
    is_admin: bool = True,
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

    _enforce_today_only_for_non_admin(source_rows, is_admin=is_admin, action_label="gộp đơn")

    _check_orders_available_for_split_merge(db, order_nums)

    rep_order_num = (payload.representative_order_number or "").strip()
    if rep_order_num not in order_nums:
        rep_order_num = order_nums[0]
    rep_row = next((r for r in source_rows if r.order_number == rep_order_num), source_rows[0])
    rep_raw = dict(rep_row.raw_payload) if isinstance(rep_row.raw_payload, dict) else {}

    custom_cust_code = (payload.customer_code or "").strip()
    custom_cust_name = (payload.customer_name or "").strip()
    custom_cust_addr = (payload.customer_address or "").strip()
    custom_staff_code = (payload.staff_code or "").strip()
    custom_staff_name = (payload.staff_name or "").strip()
    delivery_code = (payload.delivery_employee_code or "").strip().upper()
    delivery_employee = None
    if delivery_code:
        delivery_employee = db.scalar(select(Employee).where(func.upper(Employee.code) == delivery_code))
        if not delivery_code.startswith("NV") or delivery_employee is None or (delivery_employee.status or "").lower() != "active":
            raise HTTPException(status_code=400, detail=f"Không tìm thấy NVGH đang hoạt động {delivery_code}.")

    final_cust_code = custom_cust_code or (
        rep_row.customer_code
        or _field(rep_raw, ("customerCode", "shopCode", "Mã KH"))
        or ""
    ).strip() or None
    final_cust_name = custom_cust_name or (
        rep_row.customer_name
        or _field(rep_raw, ("customerName", "shopName", "Tên KH"))
        or ""
    ).strip() or None
    final_cust_addr = custom_cust_addr or (
        _field(rep_raw, ("address", "customerAddress", "shipTo", "Địa chỉ"))
        or ""
    ).strip() or None
    final_staff_code = custom_staff_code or (
        _field(rep_raw, ("staffCode", "salesStaffCode", "Mã NVBH"))
        or ""
    ).strip() or None
    final_staff_name = custom_staff_name or (
        _field(rep_raw, ("staffName", "salesStaffName", "Tên NVBH"))
        or ""
    ).strip() or None

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

        if final_cust_code:
            merged_raw["Mã KH"] = final_cust_code
            merged_raw["customerCode"] = final_cust_code
            merged_raw["shopCode"] = final_cust_code
        if final_cust_name:
            merged_raw["Tên KH"] = final_cust_name
            merged_raw["customerName"] = final_cust_name
            merged_raw["shopName"] = final_cust_name
        if final_cust_addr:
            merged_raw["Địa chỉ"] = final_cust_addr
            merged_raw["address"] = final_cust_addr
            merged_raw["customerAddress"] = final_cust_addr
            merged_raw["shipTo"] = final_cust_addr
        if final_staff_code:
            merged_raw["Mã NVBH"] = final_staff_code
            merged_raw["staffCode"] = final_staff_code
            merged_raw["salesStaffCode"] = final_staff_code
        if final_staff_name:
            merged_raw["Tên NVBH"] = final_staff_name
            merged_raw["staffName"] = final_staff_name
            merged_raw["salesStaffName"] = final_staff_name
        merged_raw["Mã NVGH"] = delivery_employee.code if delivery_employee else ""
        merged_raw["Tên NVGH"] = delivery_employee.name if delivery_employee else ""

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
            customer_code=final_cust_code,
            customer_name=final_cust_name,
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


def _revert_split_or_merge_order(
    db: Session,
    order_number: str,
    is_admin: bool = True,
) -> dict[str, Any]:
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

    if not is_admin:
        involved_orders = list(dict.fromkeys([*synthetic_orders, *restored_orders]))
        involved_rows = db.scalars(
            select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number.in_(involved_orders))
        ).all()
        _enforce_today_only_for_non_admin(involved_rows, is_admin=False, action_label="hoàn tác tách/gộp")

    for item in matched_replacements:
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
    if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
        raise ValueError("Vinamilk trả về danh sách đơn hàng không hợp lệ; không thể đối soát snapshot.")
    rows = payload
    row_data_list = []
    keys_to_fetch = []
    
    for row in rows:
        order_number = _field(row, ("orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng"))
        if not order_number:
            raise ValueError("Vinamilk trả về dòng dữ liệu không có số đơn hàng; không thể đối soát snapshot.")
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
        snapshot.order_created_date = (
            _parse_optional_date(_field(row, ("createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày")))
            or from_date
        )
        snapshot.delivery_date = _parse_optional_date(_field(row, ("deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày")))
        snapshot.synced_from = from_date
        snapshot.synced_to = to_date
        snapshot.synced_at = datetime.utcnow()
        snapshot.raw_payload = {**row, "Nguồn đồng bộ": "VINAMILK"}
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
    incoming_remote_keys = set(keys_to_fetch)
    stale_snapshots = db.scalars(select(VinamilkOrderSnapshot).where(
        or_(
            and_(
                VinamilkOrderSnapshot.order_created_date >= from_date,
                VinamilkOrderSnapshot.order_created_date <= to_date,
            ),
            and_(
                VinamilkOrderSnapshot.synced_from == from_date,
                VinamilkOrderSnapshot.synced_to == to_date,
            ),
        ),
        VinamilkOrderSnapshot.is_synthetic.is_(False),
    )).all()
    for snapshot in stale_snapshots:
        if snapshot.remote_key not in incoming_remote_keys:
            db.delete(snapshot)
    # Tự động cập nhật mã NVBH và tên NVBH cho khách hàng tương ứng nếu chưa có
    try:
        cust_staff_updates: dict[str, tuple[str | None, str | None]] = {}
        for _, row, _, _ in row_data_list:
            c_code = _field(row, ("customerCode", "shopCode", "Mã KH"))
            s_code = _field(row, ("Mã NVBH", "staffCode", "salesStaffCode"))
            s_name = _field(row, ("Tên NVBH", "staffName", "salesStaffName"))
            if c_code and (s_code or s_name):
                clean_c = c_code.strip()
                cust_staff_updates[clean_c] = (s_code, s_name)
                if len(clean_c) > 3:
                    cust_staff_updates[clean_c[-3:]] = (s_code, s_name)
        if cust_staff_updates:
            target_custs = db.scalars(
                select(Customer).where(Customer.code.in_(list(cust_staff_updates.keys())))
            ).all()
            for c in target_custs:
                sc, sn = cust_staff_updates.get(c.code, (None, None))
                if sc and not c.staff_code:
                    c.staff_code = sc
                if sn and not c.staff_name:
                    c.staff_name = sn
        from app.crud.customer import sync_customers_from_snapshots
        from app.crud.product import sync_products_from_system_data
        db.flush()
        sync_customers_from_snapshots(db, commit=False)
        sync_products_from_system_data(db, commit=False)
    except Exception:
        pass
    return saved

def read_cookie() -> str:
    if _runtime_cookie:
        return _runtime_cookie
    db_cookie = load_db_session_cookie()
    if db_cookie:
        return db_cookie
    local_cookie = dotenv_values(_ENV_LOCAL).get("VINAMILK_SESSION_COOKIE", "")
    return (local_cookie or settings.VINAMILK_SESSION_COOKIE).strip()


def _persist_cookie(cookie: str) -> None:
    if not cookie:
        return
    save_db_session_cookie(cookie)


async def refresh_cookie() -> str:
    global _runtime_cookie
    async with _cookie_refresh_lock:
        cookie = await asyncio.to_thread(login_and_get_cookie)
        if not cookie:
            raise RuntimeError("Đăng nhập thành công nhưng không tạo được cookie Vinamilk.")
        _runtime_cookie = cookie
        _persist_cookie(cookie)
        return cookie


@router.get("/vinamilk/credentials")
def get_vinamilk_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Chỉ tài khoản Admin mới được phép xem hoặc cập nhật tài khoản Vinamilk DMS.",
        )
    status_info = get_credentials_status(db)
    return {
        "username": status_info["username"],
        "has_password": status_info["has_password"],
        "source": status_info["source"],
        "has_session_cookie": bool(_runtime_cookie or status_info["has_session_cookie"]),
        "updated_by": status_info["updated_by"],
        "updated_at": _iso_utc(status_info["updated_at"]),
    }


@router.put("/vinamilk/credentials")
async def update_vinamilk_credentials(
    payload: VinamilkCredentialUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    global _runtime_cookie
    if not _is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Chỉ tài khoản Admin mới được phép cập nhật tài khoản Vinamilk DMS.",
        )
    clean_username = payload.username.strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="Tên đăng nhập Vinamilk DMS không được để trống.")

    raw_password = (payload.password or "").strip() or None
    existing_creds = load_db_credentials(db)
    if raw_password is None and existing_creds is None:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng nhập mật khẩu Vinamilk DMS.",
        )
    effective_password = raw_password or (existing_creds[1] if existing_creds else "")

    new_cookie: str | None = None
    verified = False
    if payload.verify_login:
        try:
            async with _cookie_refresh_lock:
                new_cookie = await asyncio.to_thread(
                    login_and_get_cookie,
                    clean_username,
                    effective_password,
                )
            verified = bool(new_cookie)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Đăng nhập thử vào Vinamilk DMS thất bại: {exc}",
            ) from exc

    actor = getattr(current_user, "username", None) or "admin"
    try:
        record = upsert_db_credentials(
            db,
            username=clean_username,
            password=raw_password,
            updated_by=actor,
            session_cookie=new_cookie,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if new_cookie:
        _runtime_cookie = new_cookie
        _persist_cookie(new_cookie)
    else:
        _runtime_cookie = ""

    return {
        "username": record.username,
        "has_password": True,
        "source": "DATABASE",
        "verified": verified,
        "has_session_cookie": bool(_runtime_cookie or record.session_cookie),
        "updated_by": record.updated_by,
        "updated_at": _iso_utc(record.updated_at),
    }


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
    """Gọi DMS bằng HTTP client thuần (httpx). Nhanh, nhẹ, không cần Chromium/Playwright."""
    import io
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

    cookie_dict = {}
    for part in (session_cookie or "").split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            if k.strip():
                cookie_dict[k.strip()] = v.strip()

    req_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://vinamilk.dmsone.vn/sale-product/search-sale/info",
        "Origin": "https://vinamilk.dmsone.vn",
    }

    with httpx.Client(timeout=60.0, headers=req_headers, cookies=cookie_dict, follow_redirects=True) as client:
        resp = client.post(
            "https://vinamilk.dmsone.vn/sale-product/search-sale/export-excel",
            data=export_form,
        )

        if resp.status_code in (401, 403) or resp.headers.get("requires_auth") == "1":
            return {"status": 401, "body": ""}

        if resp.content.startswith(b"PK\x03\x04"):
            excel_bytes = resp.content
        else:
            try:
                data = resp.json()
            except Exception:
                return {"status": 401, "body": ""}

            if data and data.get("hasData") is False and not data.get("path"):
                return {"status": 200, "body": "[]"}
            if not data or not data.get("path"):
                raise RuntimeError(f"Failed to export excel: {data}")

            file_url = data["path"]
            if not file_url.startswith("http"):
                file_url = "https://vinamilk.dmsone.vn" + file_url

            dl_resp = client.get(file_url)
            if dl_resp.status_code != 200:
                raise RuntimeError(
                    f"Không thể tải file excel từ DMS (HTTP {dl_resp.status_code})"
                )
            excel_bytes = dl_resp.content
        workbook = openpyxl.load_workbook(io.BytesIO(excel_bytes), data_only=True)
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

        return {"status": 200, "body": json.dumps(rows)}


async def fetch_vinamilk(session_cookie: str, form: dict[str, str]) -> dict[str, object]:
    try:
        return await asyncio.to_thread(_fetch_vinamilk_sync, session_cookie, form)
    except Exception as exc:
        detail = str(exc).strip() or repr(exc)
        raise RuntimeError(f"Không thể kết nối hoặc tải dữ liệu từ Vinamilk DMS: {type(exc).__name__}: {detail}") from exc


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
    current_user: User | None = Depends(get_current_user),
    order_number: str | None = None,
    distributor_code: str | None = None,
):
    filters = [
        VinamilkOrderSnapshot.order_created_date >= from_date,
        VinamilkOrderSnapshot.order_created_date <= to_date,
    ]
    if order_number is not None:
        filters.append(VinamilkOrderSnapshot.order_number == order_number)
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
    user_dist_id = getattr(current_user, "distributor_id", None) if current_user else None
    user_dist_code = (
        (current_user.distributor.code or "").strip().upper()
        if current_user and getattr(current_user, "distributor", None)
        else None
    )
    req_dist_code = (distributor_code or "").strip().upper() or None
    effective_dist_code = user_dist_code if (user_dist_id is not None and user_dist_code) else req_dist_code
    if effective_dist_code:
        payload_dist_code = VinamilkOrderSnapshot.raw_payload["Mã NPP"].as_string()
        dist_conditions = [
            func.upper(VinamilkOrderSnapshot.performed_by) == effective_dist_code,
            func.upper(payload_dist_code) == effective_dist_code,
        ]
        if user_dist_id == 1:
            dist_conditions.append(
                and_(
                    or_(
                        VinamilkOrderSnapshot.performed_by.is_(None),
                        VinamilkOrderSnapshot.performed_by == "",
                    ),
                    or_(payload_dist_code.is_(None), payload_dist_code == ""),
                )
            )
        filters.append(or_(*dist_conditions))
    snapshot_total = db.scalar(select(func.count()).select_from(VinamilkOrderSnapshot).where(*filters)) or 0
    rows = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(*filters)
        .order_by(VinamilkOrderSnapshot.order_created_date.desc(), VinamilkOrderSnapshot.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    distributors_by_code = {
        (distributor.code or "").strip().upper(): distributor
        for distributor in db.scalars(select(Distributor)).all()
        if (distributor.code or "").strip()
    }
    distributors_by_id = {distributor.id: distributor for distributor in distributors_by_code.values()}
    supplier_distributor_codes: dict[str, set[str]] = defaultdict(set)
    for config in db.scalars(select(DistributorSupplierConfig)).all():
        distributor = distributors_by_id.get(config.distributor_id)
        if distributor and config.supplier_code:
            supplier_distributor_codes[config.supplier_code.strip().upper()].add(distributor.code.upper())

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
    customer_codes = {
        (
            row.customer_code
            or _field(row.raw_payload, ("customerCode", "shopCode", "Mã KH"))
            or ""
        ).strip().upper()
        for row in rows
    }
    customer_codes.discard("")
    customer_code_suffixes = {code[-3:] for code in customer_codes if len(code) >= 3}
    customer_match = (
        or_(
            func.upper(func.trim(Customer.code)).in_(customer_codes),
            func.substr(func.upper(func.trim(Customer.code)), -3, 3).in_(
                customer_code_suffixes
            ),
        )
        if customer_codes
        else Customer.id == -1
    )
    customer_manager_by_code: dict[str, tuple[str | None, str | None]] = {}
    customer_managers_by_suffix: dict[str, list[tuple[str | None, str | None]]] = defaultdict(list)
    if rows:
        customer_assignments = db.execute(
            select(Customer.code, Customer.manager_code, Customer.manager_name).where(
                customer_match,
                or_(
                    Customer.manager_code.is_not(None),
                    Customer.manager_name.is_not(None),
                ),
            )
        ).all()
        for customer_code, manager_code, manager_name in customer_assignments:
            normalized_code = (customer_code or "").strip().upper()
            assignment = (manager_code, manager_name)
            if normalized_code:
                customer_manager_by_code[normalized_code] = assignment
                if len(normalized_code) >= 3:
                    customer_managers_by_suffix[normalized_code[-3:]].append(assignment)
    customers_by_code: dict[str, str | None] = {}
    customers_by_suffix: dict[str, list[str | None]] = defaultdict(list)
    if customer_codes:
        customer_rows = db.execute(
            select(Customer.code, Store.name)
            .outerjoin(Store, Customer.store_id == Store.id)
            .where(customer_match)
        ).all()
        for customer_code, store_name in customer_rows:
            normalized_code = (customer_code or "").strip().upper()
            if normalized_code:
                customers_by_code[normalized_code] = store_name
                if len(normalized_code) >= 3:
                    customers_by_suffix[normalized_code[-3:]].append(store_name)
    output_rows: list[dict[str, Any]] = []
    replaced_by: dict[str, list[str]] = defaultdict(list)
    replaced_order_for: dict[str, str] = {}
    replacement_type_for: dict[str, str] = {}
    replacement_actor_for: dict[str, str] = {}
    merged_source_orders: set[str] = set()
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
                    if rep_type in ("MERGE", "SPLIT"):
                        merged_source_orders.add(old_clean.upper())
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

    order_numbers = {
        (row.order_number or "").strip().upper()
        for row in rows
        if (row.order_number or "").strip()
    }
    product_codes = {
        (row.product_code or "").strip().upper()
        for row in rows
        if (row.product_code or "").strip()
    }
    products_by_sku = {}
    product_stmt = select(Product)
    if product_codes:
        product_stmt = product_stmt.where(
            or_(
                func.upper(Product.sku).in_(product_codes),
                func.upper(Product._npp_code).in_(product_codes),
            )
        )
    else:
        product_stmt = product_stmt.where(Product.id == -1)
    for product in db.scalars(product_stmt):
        if product.sku:
            products_by_sku[product.sku.strip().upper()] = product
        if product.npp_code:
            products_by_sku[product.npp_code.strip().upper()] = product

    order_delivery_status: dict[str, str] = {}
    try:
        dr_rows = (
            db.execute(
                select(DeliveryRequestOrder.order_number, DeliveryRequest.status)
                .join(
                    DeliveryRequest,
                    DeliveryRequest.id == DeliveryRequestOrder.delivery_request_id,
                )
                .where(
                    func.upper(func.trim(DeliveryRequestOrder.order_number)).in_(
                        order_numbers
                    )
                )
                .order_by(DeliveryRequest.created_at.desc(), DeliveryRequest.id.desc())
            ).all()
            if order_numbers
            else []
        )
        delivery_status_labels = {
            "DRAFT": "Chờ Admin duyệt",
            "SUBMITTED": "Đã duyệt - chờ kho nhận",
            "RECEIVED": "Đã nhận - đang xuất kho",
            "COMPLETED": "Đã xuất kho",
            "CANCELLED": "Đã hủy yêu cầu",
        }
        for o_num, req_status in dr_rows:
            if not o_num:
                continue
            key = o_num.strip().upper()
            if key not in order_delivery_status:
                order_delivery_status[key] = delivery_status_labels.get(req_status, "Chưa yêu cầu")
    except Exception:
        pass
    delivery_assignments: dict[tuple[str, date | None], dict[str, str]] = defaultdict(dict)
    if order_numbers:
        assignments = db.execute(
            select(
                DeliveryRequestOrder.order_number,
                DeliveryRequestOrder.order_date,
                DeliveryRequestOrder.employee_code,
                DeliveryRequestOrder.employee_name,
            )
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestOrder.delivery_request_id)
            .where(
                func.upper(func.trim(DeliveryRequestOrder.order_number)).in_(order_numbers),
                DeliveryRequest.status.in_(("SUBMITTED", "RECEIVED", "COMPLETED")),
            )
        ).all()
        for number, order_date, code, name in assignments:
            normalized_code = (code or "").strip()
            if normalized_code:
                employees = delivery_assignments[(number.strip().upper(), order_date)]
                employee_code = normalized_code.upper()
                employee_name = (name or "").strip()
                if employee_code not in employees or employee_name:
                    employees[employee_code] = employee_name
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

        is_merged_source = order_num.strip().upper() in merged_source_orders

        # Tình trạng xuất kho / duyệt đơn từ Yêu cầu xuất hàng (DeliveryRequest)
        d_status = None if is_merged_source else order_delivery_status.get(order_num.upper())
        if not d_status and rep_order:
            for old_part in [p.strip().upper() for p in rep_order.split(",") if p.strip()]:
                if old_part in order_delivery_status:
                    d_status = order_delivery_status[old_part]
                    break
        if not d_status and rep_by_list:
            sub_statuses = [order_delivery_status.get(s.upper(), "Chưa yêu cầu") for s in rep_by_list]
            if sub_statuses:
                if all(status == "Đã xuất kho" for status in sub_statuses):
                    d_status = "Đã xuất kho"
                elif any(status == "Đã xuất kho" for status in sub_statuses):
                    d_status = "Đã xuất một phần"
                else:
                    progress = {
                        "Chưa yêu cầu": 0,
                        "Đã hủy yêu cầu": 0,
                        "Chờ Admin duyệt": 1,
                        "Đã duyệt - chờ kho nhận": 2,
                        "Đã nhận - đang xuất kho": 3,
                    }
                    d_status = min(sub_statuses, key=lambda status: progress.get(status, 0))
        if is_merged_source:
            d_status = "Không áp dụng"

        proc_status = (
            row.processing_status
            if getattr(row, "processing_status", None)
            else ("Đã cập nhật kho" if row.warehouse_updated is True else "")
        )
        if pending_req and not getattr(row, "is_synthetic", False):
            proc_status = "Chờ KT duyệt tách"
        if order_num in merged_source_orders:
            proc_status = "Đã Hủy"
        elif replacement_type_for.get(order_num) == "MERGE":
            proc_status = "Đơn Gộp"

        prod_sku = (row.product_code or "").strip().upper()
        product = products_by_sku.get(prod_sku)
        raw_sync_src = (
            _field(row.raw_payload, ("Nguồn đồng bộ", "_sync_source"))
            or (
                row.processing_status.split(":", 1)[1].strip()
                if (row.processing_status or "").upper().startswith("NCC:")
                else ""
            )
        ).strip().upper()
        raw_supplier = (
            _field(row.raw_payload, ("Nhà cung cấp", "supplier", "supplierName", "NCC")) or ""
        ).strip()
        if raw_supplier.upper() in ("NAZZY", "DMS NAZZY", "DMS NAZZY (NPP MAI GOLD)"):
            raw_supplier = ""
        prod_supplier = (product.supplier or "").strip() if product else ""
        # Tránh gán nhầm mặc định "Vinamilk" cho đơn đến từ nguồn khác (VD: Nazzy - hàng KM / trưng bày)
        if raw_sync_src and raw_sync_src != "VINAMILK" and prod_supplier.lower() == "vinamilk":
            prod_supplier = ""
        supplier = raw_supplier or prod_supplier
        order_status_label = proc_status or "Chưa xử lý"
        customer_code = (
            row.customer_code
            or _field(row.raw_payload, ("customerCode", "shopCode", "Mã KH"))
            or ""
        ).strip().upper()
        store_name = customers_by_code.get(customer_code)
        if store_name is None and len(customer_code) >= 3:
            suffix_customers = customers_by_suffix.get(customer_code[-3:], [])
            if len(suffix_customers) == 1:
                store_name = suffix_customers[0]
        manager_assignment = customer_manager_by_code.get(customer_code)
        if manager_assignment is None and len(customer_code) >= 3:
            suffix_matches = customer_managers_by_suffix.get(customer_code[-3:], [])
            if len(suffix_matches) == 1:
                manager_assignment = suffix_matches[0]
        manager_code, manager_name = manager_assignment or (None, None)

        assigned_employees = {
            **delivery_assignments.get((order_num.strip().upper(), None), {}),
            **delivery_assignments.get((order_num.strip().upper(), row.order_created_date), {}),
        }
        manual_code = str(row.raw_payload.get("Mã NVGH") or "").strip() if row.is_synthetic else ""
        manual_name = str(row.raw_payload.get("Tên NVGH") or "").strip() if row.is_synthetic else ""
        if manual_code and (replacement_type_for.get(order_num) not in ("SPLIT", "MERGE") or not assigned_employees):
            assigned_employees = {manual_code: manual_name}
        delivery_labels = [
            f"{code} - {name}" if name else code
            for code, name in sorted(assigned_employees.items())
        ]
        delivery_code, delivery_name = next(iter(assigned_employees.items())) if len(assigned_employees) == 1 else ("", "")

        row_actor = (getattr(row, "performed_by", None) or "").strip()
        if not row_actor and isinstance(row.raw_payload, dict):
            row_actor = (
                _field(row.raw_payload, ("performedBy", "Người thực hiện", "_performed_by")) or ""
            ).strip()
        resolved_distributor_code = _field(
            row.raw_payload,
            ("Mã NPP", "_distributor_code", "distributorCode", "distributor_code"),
        )
        resolved_distributor_code = (resolved_distributor_code or "").strip().upper()
        if not resolved_distributor_code and row_actor.upper() in distributors_by_code:
            resolved_distributor_code = row_actor.upper()
        if not resolved_distributor_code:
            source_for_distributor = _field(row.raw_payload, ("Nguồn đồng bộ", "_sync_source"))
            processing_source = (getattr(row, "processing_status", None) or "").strip()
            if not source_for_distributor and processing_source.upper().startswith("NCC:"):
                source_for_distributor = processing_source.split(":", 1)[1].strip()
            if not source_for_distributor:
                normalized_actor = unicodedata.normalize("NFKD", row_actor).encode("ascii", "ignore").decode("ascii").casefold()
                if normalized_actor == "he thong" and not getattr(row, "is_synthetic", False):
                    source_for_distributor = "VINAMILK"
            configured_distributors = supplier_distributor_codes.get((source_for_distributor or "").strip().upper(), set())
            if len(configured_distributors) == 1:
                resolved_distributor_code = next(iter(configured_distributors))
        distributor = distributors_by_code.get(resolved_distributor_code)
        distributor_name = distributor.name if distributor else ""
        distributor_label = distributor_name or resolved_distributor_code
        if pending_req and pending_req.requested_by:
            performed_by = f"{pending_req.requested_by} (Chờ KT)"
        else:
            performed_by = replacement_actor_for.get(order_num) or row_actor or "Hệ thống"
        sync_source = _field(row.raw_payload, ("Nguồn đồng bộ", "_sync_source"))
        if not sync_source:
            processing_source = (getattr(row, "processing_status", None) or "").strip()
            if processing_source.upper().startswith("NCC:"):
                sync_source = processing_source.split(":", 1)[1].strip()
            elif (order_num or "").upper().startswith("TC-"):
                sync_source = "Tự tạo"
            elif getattr(row, "is_synthetic", False):
                sync_source = "Tách/Gộp"
            else:
                sync_source = "VINAMILK"

        resolved_created_date = (
            _field(row.raw_payload, ("createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày tạo", "Ngày", "Ngày đơn hàng"))
            or (row.order_created_date.strftime("%d/%m/%Y") if row.order_created_date else None)
        )
        resolved_delivery_date = (
            _field(row.raw_payload, ("deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày giao", "Ngày giao hàng"))
            or (row.delivery_date.strftime("%d/%m/%Y") if row.delivery_date else resolved_created_date)
        )

        base = {
            **row.raw_payload,
            "NPP": distributor_label or "Chưa xác định",
            **({"Ngày tạo": resolved_created_date} if resolved_created_date and not _field(row.raw_payload, ("Ngày tạo", "createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày")) else {}),
            **({"Ngày giao": resolved_delivery_date} if resolved_delivery_date and not _field(row.raw_payload, ("Ngày giao", "deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate")) else {}),
            **({"Nguồn đồng bộ": sync_source} if sync_source else {}),
            "Nhà cung cấp": supplier,
            "supplier": supplier,
            "_supplier": supplier,
            "_boxes_per_carton": product.boxes_per_carton if product and product.boxes_per_carton and product.boxes_per_carton > 0 else None,
            "Tình trạng xử lý đơn hàng": order_status_label,
            "Trạng thái xử lý": order_status_label,
            "Cửa Hàng": store_name or "",
            "NVGH": ", ".join(delivery_labels),
            "Mã NVGH": delivery_code,
            "Tên NVGH": delivery_name,
            "Tình trạng xuất kho": d_status or "Chưa yêu cầu",
            "_delivery_status": d_status or "Chưa yêu cầu",
            "Mã NVQL": manager_code,
            "Tên NVQL": manager_name,
            "_manager_code": manager_code,
            "_manager_name": manager_name,
            "Người thực hiện": performed_by,
            "_performed_by": performed_by,
            "_local_id": row.id,
            "_snapshot_order_number": row.order_number,
            "_distributor_code": resolved_distributor_code or None,
            "_distributor_name": distributor_name or None,
            "_order_created_date": row.order_created_date.isoformat() if row.order_created_date else None,
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
    if distributor_code:
        normalized_distributor_code = distributor_code.strip().upper()
        output_rows = [
            row for row in output_rows
            if (row.get("_distributor_code") or "").strip().upper() == normalized_distributor_code
        ]
        snapshot_total = len(output_rows)

    return {
        "rows": output_rows,
        "total": snapshot_total,
        "snapshot_total": snapshot_total,
        "snapshot_count": len(output_rows) if distributor_code else len(rows),
        "row_count": len(output_rows),
        "skip": skip,
        "limit": limit,
        "source": source,
        "last_synced_at": _iso_utc(latest.finished_at) if latest else None,
    }


@router.get("/vinamilk-orders/grouped")
def list_grouped_vinamilk_orders(
    from_date: date,
    to_date: date,
    order_search: str = "",
    customer: str = "",
    staff: str = "",
    product: str = "",
    supplier: str = "",
    processing_status: str = "",
    delivery_status: str = "",
    distributor_code: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if to_date < from_date:
        raise HTTPException(status_code=422, detail="Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.")

    groups: dict[str, list[dict[str, Any]]] = {}
    offset = 0
    last_synced_at = None
    while True:
        page = list_local_vinamilk_orders(
            from_date=from_date, to_date=to_date, source="sync", search=None,
            status=None, skip=offset, limit=10_000, db=db, current_user=current_user,
            distributor_code=distributor_code,
        )
        last_synced_at = page["last_synced_at"]
        for row in page["rows"]:
            number = row.get("_snapshot_order_number") or _field(row, ("orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng"))
            distributor_code = row.get("_distributor_code") or ""
            key = f"{distributor_code}|{number}" if number else f"{distributor_code}|__snapshot_{row['_local_id']}"
            groups.setdefault(key, []).append(row)
        offset += page["snapshot_count"]
        if not page["snapshot_count"] or offset >= page["snapshot_total"]:
            break

    def field(row: dict[str, Any], keys: tuple[str, ...]) -> str:
        return (_field(row, keys) or "").strip()

    def status_for(row: dict[str, Any]) -> str:
        status = field(row, ("_processing_status",)) or ("Đã cập nhật kho" if row.get("_warehouse_updated") is True else "Chưa xử lý")
        kind = field(row, ("_order_type", "Trạng thái tạo đơn", "orderType"))
        if status == "Đơn Tách" or not kind:
            return status
        return " · ".join(part for part in (kind, "" if status == "Đơn Tự Tạo" else status) if part)

    def includes(value: str, query: str) -> bool:
        return not query or query.strip().casefold() in value.casefold()

    order_search, customer, staff, product, supplier = (
        value.strip() for value in (order_search, customer, staff, product, supplier)
    )
    summaries = []
    statuses = set()
    delivery_statuses = set()
    all_suppliers_by_key: dict[str, str] = {}
    total_value = total_discount = confirmed = 0
    for key, lines in groups.items():
        row = lines[0]
        status = status_for(row)
        delivery = field(row, ("Tình trạng xuất kho", "_delivery_status")) or "Chưa yêu cầu"
        line_suppliers = sorted({
            field(line, ("Nhà cung cấp", "supplier", "_supplier"))
            for line in lines
            if field(line, ("Nhà cung cấp", "supplier", "_supplier"))
        })
        line_sync_sources = sorted({
            (
                field(line, ("Nguồn đồng bộ", "_sync_source"))
                or (
                    field(line, ("_processing_status",)).split(":", 1)[1].strip()
                    if field(line, ("_processing_status",)).upper().startswith("NCC:")
                    else ""
                )
            )
            for line in lines
            if (
                field(line, ("Nguồn đồng bộ", "_sync_source"))
                or field(line, ("_processing_status",)).upper().startswith("NCC:")
            )
        })
        order_supplier_candidates: list[str] = []
        for candidate in (*line_suppliers, *line_sync_sources):
            c_clean = candidate.strip()
            if not c_clean:
                continue
            c_key = c_clean.casefold()
            if c_key not in all_suppliers_by_key:
                all_suppliers_by_key[c_key] = c_clean
            elif all_suppliers_by_key[c_key].isupper() and not c_clean.isupper():
                # Ưu tiên dạng chữ đẹp như "Vinamilk" thay vì "VINAMILK"
                all_suppliers_by_key[c_key] = c_clean
            order_supplier_candidates.append(c_key)

        statuses.add(status)
        delivery_statuses.add(delivery)
        related = " ".join(str(item or "") for item in (
            key, row.get("_replacement_display"), row.get("_replaced_order_number"),
            *(row.get("_replaced_by_order_numbers") or []),
        ))
        if not includes(related, order_search):
            continue
        if not any(includes(field(line, ("customerCode", "shopCode", "Mã KH")), customer) or
                   includes(field(line, ("customerName", "shopName", "Tên KH")), customer) for line in lines):
            continue
        if not any(includes(field(line, ("staffCode", "salesStaffCode", "Mã NVBH")), staff) or
                   includes(field(line, ("staffName", "salesStaffName", "Tên NVBH")), staff) for line in lines):
            continue
        if not any(includes(field(line, ("productCode", "itemCode", "sku", "Mã sản phẩm")), product) or
                   includes(field(line, ("productName", "itemName", "product", "Sản phẩm")), product) or
                   includes(field(line, ("Nhà cung cấp",)), product) for line in lines):
            continue
        if supplier and supplier.casefold() not in order_supplier_candidates:
            continue
        if processing_status and status != processing_status:
            continue
        if delivery_status and delivery != delivery_status:
            continue
        value = sum(_float_from_payload(line, ("totalValue", "total", "amount", "Giá trị")) for line in lines)
        discount = sum(_float_from_payload(line, ("totalDiscount", "discountAmount", "Số tiền CK")) for line in lines)
        order_discount = _float_from_payload(row, ("orderDiscount", "Chiết khấu đơn hàng"))
        summary_fields = {
            "orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng",
            "createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày tạo", "Ngày", "Ngày đơn hàng",
            "deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày giao", "Ngày giao hàng",
            "staffCode", "salesStaffCode", "Mã NVBH", "staffName", "salesStaffName", "Tên NVBH",
            "customerCode", "shopCode", "Mã KH", "customerName", "shopName", "Tên KH",
            "NPP", "_distributor_code", "_distributor_name",
            "Nguồn đồng bộ",
            "Cửa Hàng", "store_name", "storeName", "NVGH", "Mã NVGH", "Tên NVGH",
            "Mã NVQL", "Tên NVQL", "_manager_code", "_manager_name",
            "address", "customerAddress", "shipTo", "Địa chỉ", "orderStatus", "status",
            "_order_type", "Trạng thái tạo đơn", "orderType", "_order_created_date",
            "_processing_status", "_warehouse_updated", "_is_synthetic", "_local_id",
            "_delivery_status", "Tình trạng xuất kho", "_replacement_type", "_replacement_display",
            "_replaced_order_number", "_replaced_by_order_numbers", "_pending_split_request_id",
            "_performed_by", "performedBy", "Người thực hiện",
        }
        summary = {k: v for k, v in row.items() if k in summary_fields}
        if row.get("_snapshot_order_number"):
            summary["orderNumber"] = row["_snapshot_order_number"]
        summary.update({
            "totalValue": value,
            "totalDiscount": max(discount, order_discount),
            "_product_count": len(lines),
            "_summary_key": key,
        })
        suppliers = sorted({
            field(line, ("Nhà cung cấp", "supplier", "_supplier"))
            for line in lines
            if field(line, ("Nhà cung cấp", "supplier", "_supplier"))
        })
        if suppliers:
            summary["Nhà cung cấp"] = " / ".join(suppliers)
        sync_sources = set()
        for line in lines:
            source = field(line, ("Nguồn đồng bộ", "_sync_source"))
            if not source:
                processing_source = field(line, ("_processing_status",))
                if processing_source.upper().startswith("NCC:"):
                    source = processing_source.split(":", 1)[1].strip()
            if source:
                sync_sources.add(source)
        if sync_sources:
            summary["Nguồn đồng bộ"] = " / ".join(sorted(sync_sources))
        summaries.append(summary)
        replaced = row.get("_replacement_type") in ("SPLIT", "MERGE") and bool(row.get("_replaced_by_order_numbers"))
        if not replaced:
            total_value += value
            total_discount += max(discount, order_discount)
            confirmed += bool(field(row, ("deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate")))
    return {
        "rows": summaries[skip:skip + limit], "total": len(summaries), "all_total": len(groups),
        "total_value": total_value, "total_discount": total_discount, "confirmed": confirmed,
        "statuses": sorted(statuses), "delivery_statuses": sorted(delivery_statuses),
        "suppliers": sorted(all_suppliers_by_key.values(), key=str.casefold),
        "last_synced_at": last_synced_at,
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


@router.post("/vinamilk-orders/delivery-request-form")
def download_vinamilk_delivery_request_form(
    payload: DeliveryRequestFormRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được tạo phiếu yêu cầu xuất hàng.")

    orders_by_number: dict[str, DeliveryRequestFormOrder] = {}
    for order in payload.orders:
        order_number = order.order_number.strip()
        if not order_number:
            raise HTTPException(status_code=422, detail="Số đơn hàng không được để trống.")
        normalized_number = order_number.upper()
        if normalized_number in orders_by_number:
            raise HTTPException(status_code=422, detail=f"Đơn hàng {order_number} bị chọn nhiều lần.")
        orders_by_number[normalized_number] = order.model_copy(update={"order_number": order_number})

    employee_codes = {
        order.delivery_employee_code.strip().upper()
        for order in orders_by_number.values()
    }
    employees = db.scalars(
        select(Employee).where(
            Employee.status == "active",
            func.upper(Employee.code).in_(employee_codes),
        )
    ).all()
    employees_by_code = {
        employee.code.strip().upper(): employee
        for employee in employees
        if employee.code.strip().upper().startswith("NV")
    }
    missing_employees = sorted(employee_codes - employees_by_code.keys())
    if missing_employees:
        raise HTTPException(
            status_code=422,
            detail="NVGH không hợp lệ hoặc không còn hoạt động: " + ", ".join(missing_employees),
        )

    snapshots = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(func.upper(VinamilkOrderSnapshot.order_number).in_(orders_by_number))
        .order_by(VinamilkOrderSnapshot.id.desc())
    ).all()
    latest_snapshot_by_number: dict[str, VinamilkOrderSnapshot] = {}
    for snapshot in snapshots:
        if snapshot.order_number:
            latest_snapshot_by_number.setdefault(snapshot.order_number.strip().upper(), snapshot)

    missing_orders = sorted(set(orders_by_number) - latest_snapshot_by_number.keys())
    if missing_orders:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy các đơn hàng đã chọn trong dữ liệu đồng bộ: " + ", ".join(missing_orders),
        )

    form_orders = []
    for normalized_number, request_order in orders_by_number.items():
        snapshot = latest_snapshot_by_number[normalized_number]
        employee = employees_by_code[request_order.delivery_employee_code.strip().upper()]
        customer_code = (snapshot.customer_code or "").strip()
        if not customer_code.upper().startswith(("NVBH-", "NVGH-")) and customer_code.upper() != "NVBH":
            customer_code = customer_code[-3:]
        form_orders.append({
            "order_date": snapshot.order_created_date.strftime("%d/%m/%Y") if snapshot.order_created_date else "",
            "order_number": snapshot.order_number or request_order.order_number,
            "employee_code": employee.code,
            "employee_name": employee.name,
            "customer_code": customer_code,
            "customer_name": snapshot.customer_name or "",
            "status": request_order.status,
        })

    workbook_bytes = _build_delivery_request_form(form_orders)
    filename = f"Form_Yeu_Cau_Xuat_Kho_{date.today():%Y%m%d}.xlsx"
    return Response(
        content=workbook_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


@router.get("/vinamilk-orders/staff-options")
def list_vinamilk_staff_options(
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """Trả về danh sách NVBH từ bảng employees và từ các đơn DMS đã đồng bộ."""
    term = search.strip()
    options_by_code: dict[str, dict[str, Any]] = {}

    emp_stmt = select(Employee)
    if term:
        like_term = f"%{term}%"
        emp_stmt = emp_stmt.where(
            or_(
                Employee.code.ilike(like_term),
                Employee.name.ilike(like_term),
                Employee.vinamilk_code.ilike(like_term),
            )
        )
    emp_rows = db.scalars(emp_stmt.order_by(Employee.code).limit(limit)).all()
    for emp in emp_rows:
        code = ((emp.vinamilk_code or emp.code) or "").strip()
        if not code:
            continue
        options_by_code[code.upper()] = {
            "staff_code": code,
            "staff_name": (emp.name or "").strip(),
            "employee_code": emp.code,
        }

    return {"staffs": list(options_by_code.values())[:limit]}


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
    return _split_vinamilk_order(
        db,
        payload,
        performed_by=getattr(current_user, "username", None),
        is_admin=_is_admin_user(current_user),
    )


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
        is_admin=_is_admin_user(current_user),
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
        is_admin=_is_admin_user(current_user),
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
    return _merge_vinamilk_orders(
        db,
        payload,
        performed_by=getattr(current_user, "username", None),
        is_admin=_is_admin_user(current_user),
    )


@router.delete("/vinamilk-orders/split-merge/{order_number}")
def revert_split_or_merge_order(
    order_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _revert_split_or_merge_order(
        db,
        order_number,
        is_admin=_is_admin_user(current_user),
    )


MANUAL_ORDER_PREFIX = "TC"
MANUAL_ORDER_STATUS = "Đơn Tự Tạo"


class ManualOrderLine(BaseModel):
    product_code: str
    quantity: float = Field(gt=0)
    cartons: int | None = Field(default=None, ge=0)
    boxes: int | None = Field(default=None, ge=0)
    promo_quantity: float = Field(default=0, ge=0)
    unit_price: float | None = Field(default=None, ge=0)
    discount_amount: float = Field(default=0, ge=0)
    promotion_id: int | None = Field(default=None, gt=0)


class ManualOrderRequest(BaseModel):
    customer_code: str
    order_type: str = "001-Xuất hàng"
    order_date: date | None = None
    entry_date: date | None = None
    delivery_date: date | None = None
    sales_route: str | None = None
    staff_code: str | None = None
    staff_name: str | None = None
    delivery_employee_code: str | None = None
    delivery_employee_name: str | None = None
    customer_address: str | None = None
    note: str | None = None
    lines: list[ManualOrderLine] = Field(min_length=1)


def _next_manual_order_number(db: Session, ref_date: date) -> str:
    prefix = f"{MANUAL_ORDER_PREFIX}-{ref_date:%y%m%d}-"
    existing = db.scalars(
        select(VinamilkOrderSnapshot.order_number)
        .where(VinamilkOrderSnapshot.order_number.like(f"{prefix}%"))
        .distinct()
    ).all()
    max_seq = 0
    for code in existing:
        tail = (code or "")[len(prefix):]
        if tail.isdigit():
            max_seq = max(max_seq, int(tail))
    return f"{prefix}{max_seq + 1:03d}"


def _create_manual_order(
    db: Session,
    payload: ManualOrderRequest,
    performed_by: str | None = None,
    current_employee: Employee | None = None,
    distributor_code: str | None = None,
) -> dict[str, Any]:
    """Tạo đơn hàng tự tạo (không từ DMS), lưu cùng bảng snapshot để hiển thị chung danh sách Đơn hàng.

    NVBH mặc định là nhân viên gắn với tài khoản đang đăng nhập (nếu không truyền staff_code).
    """
    actor = (performed_by or "").strip() or "Hệ thống"
    cust_code = (payload.customer_code or "").strip()
    customer = db.scalar(select(Customer).where(Customer.code == cust_code)) if cust_code else None
    if customer is None:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy khách hàng {cust_code}.")

    codes = [line.product_code.strip().upper() for line in payload.lines]
    if len(set(codes)) != len(codes):
        raise HTTPException(status_code=400, detail="Mỗi sản phẩm chỉ được xuất hiện một lần trong đơn.")
    products = {
        p.sku.strip().upper(): p
        for p in db.scalars(select(Product).options(joinedload(Product.unit)).where(func.upper(Product.sku).in_(codes))).all()
    }
    missing = [code for code in codes if code not in products]
    if missing:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy sản phẩm trong Danh sách SKU: {', '.join(missing)}.")

    order_type = (payload.order_type or "001-Xuất hàng").strip()
    if order_type not in ("001-Xuất hàng", "002-Dương Số"):
        order_type = "001-Xuất hàng"

    order_date = payload.order_date or date.today()
    entry_date = payload.entry_date or date.today()
    delivery_date = payload.delivery_date or order_date
    order_number = _next_manual_order_number(db, order_date)
    staff_code = (payload.staff_code or "").strip()
    staff_name = (payload.staff_name or "").strip()
    if not staff_code and current_employee is not None:
        staff_code = current_employee.code or ""
        staff_name = staff_name or current_employee.name or ""
    if not staff_code:
        staff_code = (customer.staff_code or "").strip()
        staff_name = staff_name or (customer.staff_name or "").strip()

    delivery_code = (payload.delivery_employee_code or "").strip()
    delivery_name = (payload.delivery_employee_name or "").strip()
    if delivery_code:
        delivery_employee = db.scalar(select(Employee).where(func.upper(Employee.code) == delivery_code.upper()))
        if delivery_employee is None or (delivery_employee.status or "").lower() != "active":
            raise HTTPException(status_code=404, detail=f"Không tìm thấy NVGH đang hoạt động {delivery_code}.")
        delivery_code = delivery_employee.code
        delivery_name = delivery_employee.name
    address = (payload.customer_address or "").strip()
    if not address and customer.addresses:
        default_addr = next((a for a in customer.addresses if a.is_default), customer.addresses[0])
        address = ", ".join(part for part in (default_addr.address, default_addr.district, default_addr.city) if part)
    note = (payload.note or "").strip()
    sales_route = (payload.sales_route or customer.store_route or "").strip()
    now = datetime.utcnow()
    total_value = 0.0

    for line_idx, line in enumerate(payload.lines, start=1):
        product = products[line.product_code.strip().upper()]
        if line.cartons is not None and line.boxes is not None:
            boxes_per_carton = max(int(product.boxes_per_carton or 1), 1)
            expected_quantity = line.boxes if boxes_per_carton <= 1 else line.cartons * boxes_per_carton + line.boxes
            if boxes_per_carton > 1 and line.boxes >= boxes_per_carton:
                raise HTTPException(status_code=400, detail=f"Số hộp của {product.sku} phải nhỏ hơn {boxes_per_carton}.")
            if abs(float(line.quantity) - expected_quantity) > 1e-6:
                raise HTTPException(status_code=400, detail=f"Số lượng quy đổi của {product.sku} không khớp thùng/hộp.")
        price = float(line.unit_price if line.unit_price is not None else (product.base_price or 0))
        value = round(price * line.quantity, 2)
        promo_quantity = float(line.promo_quantity or 0)
        discount = float(line.discount_amount or 0)
        promotion = None
        promotion_reward_products: list[dict[str, Any]] = []
        if line.promotion_id is not None:
            if order_type != "001-Xuất hàng":
                raise HTTPException(status_code=400, detail="Đơn Dương Số không áp dụng chương trình khuyến mãi.")
            promotion = db.scalar(
                select(Promotion)
                .options(
                    selectinload(Promotion.rules).selectinload(PromotionRule.reward_product_links),
                    selectinload(Promotion.items),
                    selectinload(Promotion.store_links),
                )
                .where(Promotion.id == line.promotion_id)
            )
            if promotion is None:
                raise HTTPException(status_code=404, detail=f"Không tìm thấy chương trình khuyến mãi ID {line.promotion_id}.")
            if not promotion.is_active or promotion.is_locked:
                raise HTTPException(status_code=400, detail=f"Chương trình {promotion.name} đã ngừng áp dụng hoặc bị khóa.")
            if promotion.promotion_type != "ORDER":
                raise HTTPException(status_code=400, detail=f"Chương trình {promotion.name} không áp dụng trực tiếp trong đơn hàng.")
            if promotion.promotion_kind != "GENERAL" or promotion.applied_quantity_unit != "STANDARD":
                raise HTTPException(
                    status_code=400,
                    detail=f"Chương trình {promotion.name} dùng kiểu tính khuyến mại chưa được hỗ trợ.",
                )
            if promotion.start_date.date() > order_date or promotion.end_date.date() < order_date:
                raise HTTPException(status_code=400, detail=f"Chương trình {promotion.name} không áp dụng trong ngày đặt hàng.")
            if not promotion_matches_customer(promotion, customer):
                raise HTTPException(status_code=400, detail=f"Khách hàng không thuộc đối tượng áp dụng chương trình {promotion.name}.")
            if promotion.employee_code and promotion.employee_code.strip().casefold() != staff_code.strip().casefold():
                raise HTTPException(status_code=400, detail=f"Chương trình {promotion.name} không áp dụng cho nhân viên này.")
            if promotion.product_scope == "SUPPLIER":
                if not promotion.supplier or (product.supplier or "").strip().casefold() != promotion.supplier.strip().casefold():
                    raise HTTPException(status_code=400, detail=f"Sản phẩm {product.sku} không thuộc nhà cung cấp áp dụng của chương trình {promotion.name}.")
            elif not any(item.product_id == product.id for item in promotion.items):
                raise HTTPException(status_code=400, detail=f"Sản phẩm {product.sku} không thuộc chương trình {promotion.name}.")

            selected_product_ids = {item.product_id for item in promotion.items}
            qualifying_product_count = 0
            for candidate_line in payload.lines:
                candidate_product = products[candidate_line.product_code.strip().upper()]
                matches_scope = (
                    (promotion.product_scope == "SUPPLIER"
                     and (candidate_product.supplier or "").strip().casefold() == (promotion.supplier or "").strip().casefold())
                    or (promotion.product_scope == "SELECTED" and candidate_product.id in selected_product_ids)
                )
                if not matches_scope:
                    continue
                product_minimum = next(
                    (item.min_quantity for item in promotion.items if item.product_id == candidate_product.id),
                    1,
                )
                if candidate_line.quantity >= max(1, int(product_minimum or 1)):
                    qualifying_product_count += 1
            if qualifying_product_count < max(1, int(promotion.minimum_product_quantity or 1)):
                raise HTTPException(
                    status_code=400,
                    detail=f"Đơn hàng chưa đủ số lượng sản phẩm áp dụng cho chương trình {promotion.name}.",
                )

            promo_quantity = 0
            discount = 0
            boxes_per_carton = max(int(product.boxes_per_carton or 1), 1)
            best_reward_value = -1.0
            for rule in promotion.rules:
                if rule.trigger_type in ("QUANTITY", "CARTON"):
                    quantity_unit = getattr(rule, "quantity_unit", "CARTON") or "CARTON"
                    threshold = int(
                        getattr(rule, "min_quantity", None)
                        or rule.min_cartons
                        or rule.min_qty
                        or 1
                    )
                    eligible_quantity = (
                        int(line.quantity // boxes_per_carton)
                        if quantity_unit == "CARTON"
                        else int(line.quantity)
                    )
                    maximum = getattr(rule, "max_quantity", None)
                    if maximum is not None and eligible_quantity > maximum:
                        continue
                    repeats = eligible_quantity // threshold
                else:
                    threshold = float(rule.min_amount or 0)
                    maximum = getattr(rule, "max_amount", None)
                    if maximum is not None and value > maximum:
                        continue
                    repeats = int(value // threshold) if threshold > 0 else 0
                if repeats <= 0:
                    continue
                if rule.reward_type == "FREE_QUANTITY":
                    candidate_reward_products: list[dict[str, Any]] = []
                    candidate_reward_value = 0.0
                    reward_groups = getattr(rule, "reward_product_details", []) or []
                    if reward_groups:
                        for group_index, group in enumerate(reward_groups):
                            if not group:
                                continue
                            reward_detail = group[0]
                            reward_product = db.get(Product, int(reward_detail["product_id"]))
                            if reward_product is None:
                                continue
                            reward_unit = str(reward_detail.get("unit") or "BOX")
                            reward_item_quantity = int(reward_detail.get("quantity") or 0) * repeats
                            reward_boxes_per_carton = max(int(reward_product.boxes_per_carton or 1), 1)
                            base_quantity = (
                                reward_item_quantity * reward_boxes_per_carton
                                if reward_unit == "CARTON"
                                else reward_item_quantity
                            )
                            candidate_reward_value += base_quantity * float(reward_product.base_price or 0)
                            candidate_reward_products.append({
                                "product_id": reward_product.id,
                                "product_code": reward_product.sku,
                                "product_name": reward_product.name,
                                "quantity": reward_item_quantity,
                                "unit": reward_unit,
                                "group_index": group_index,
                                "base_quantity": base_quantity,
                            })
                    if candidate_reward_products:
                        candidate_quantity = sum(int(detail["base_quantity"]) for detail in candidate_reward_products)
                    else:
                        free_quantity = int(rule.reward_value or rule.free_quantity) * repeats
                        reward_unit = getattr(rule, "reward_unit", "BOX") or "BOX"
                        candidate_quantity = free_quantity * boxes_per_carton if reward_unit == "CARTON" else free_quantity
                        candidate_reward_value = candidate_quantity * price
                    candidate_discount = 0
                elif rule.reward_type == "DISCOUNT_PERCENT":
                    candidate_quantity = 0
                    candidate_discount = value * float(rule.reward_value or rule.discount_percent) / 100 * repeats
                    candidate_reward_products = []
                    candidate_reward_value = 0.0
                else:
                    candidate_quantity = 0
                    candidate_discount = float(rule.reward_value or rule.discount_amount) * repeats
                    candidate_reward_products = []
                    candidate_reward_value = 0.0
                reward_value = candidate_reward_value + min(value, candidate_discount)
                if reward_value > best_reward_value:
                    best_reward_value = reward_value
                    promo_quantity = candidate_quantity
                    discount = candidate_discount
                    promotion_reward_products = [
                        {key: value for key, value in detail.items() if key != "base_quantity"}
                        for detail in candidate_reward_products
                    ]
            if best_reward_value < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Sản phẩm {product.sku} chưa đạt điều kiện của chương trình {promotion.name}.",
                )
        discount = min(discount, value)
        total_value += value - discount
        unit_name = (product.unit.code if product.unit else "") or ""
        raw = {
            "Số đơn hàng gốc": "",
            "Số đơn hàng": order_number,
            "Trạng thái tạo đơn": order_type,
            "orderType": order_type,
            "_order_type": order_type,
            "Mã CTKM": promotion.code if promotion else "",
            "Tên CTKM": promotion.name if promotion else "",
            "Ngày": order_date.strftime("%d/%m/%Y"),
            "Ngày nhập": entry_date.strftime("%d/%m/%Y"),
            "Tuyến bán hàng": sales_route,
            "Mã NVBH": staff_code,
            "Tên NVBH": staff_name,
            "Mã NVGH": delivery_code,
            "Tên NVGH": delivery_name,
            "Mã KH": customer.code,
            "Tên KH": customer.name,
            "Địa chỉ": address,
            "Mã sản phẩm": product.sku,
            "Sản phẩm": product.name,
            "ĐVT": unit_name,
            "Số lượng": float(line.quantity),
            "Số thùng": line.cartons if line.cartons is not None else int(line.quantity // max(int(product.boxes_per_carton or 1), 1)),
            "Số hộp": line.boxes if line.boxes is not None else float(line.quantity % max(int(product.boxes_per_carton or 1), 1)),
            "Số lượng KM": promo_quantity,
            "Sản phẩm khuyến mãi": promotion_reward_products,
            "Giá trị": value,
            "Tỉ lệ CK": round(discount / value * 100, 2) if value and discount else "",
            "Số tiền CK": discount if discount else "",
            "Đơn giá": price,
            "Thời gian xác nhận giao hàng": "",
            "Ngày đơn hàng gốc": "",
            "Ghi chú": note,
            "promotion_id": promotion.id if promotion else None,
            "Người thực hiện": actor,
            "performedBy": actor,
            "_manual_order": True,
            **({"Mã NPP": distributor_code} if distributor_code else {}),
        }
        db.add(VinamilkOrderSnapshot(
            remote_key=hashlib.sha256(f"MANUAL|{order_number}|{product.sku}|{line_idx}".encode()).hexdigest(),
            order_number=order_number,
            customer_code=customer.code,
            customer_name=customer.name,
            product_code=product.sku,
            product_name=product.name,
            status=MANUAL_ORDER_STATUS,
            processing_status=MANUAL_ORDER_STATUS,
            performed_by=actor,
            is_synthetic=True,
            order_created_date=order_date,
            delivery_date=delivery_date,
            synced_from=order_date,
            synced_to=order_date,
            synced_at=now,
            raw_payload=raw,
        ))
    db.commit()
    return {
        "order_number": order_number,
        "customer_code": customer.code,
        "line_count": len(payload.lines),
        "total_value": total_value,
        "performed_by": actor,
    }


def _delete_manual_order(db: Session, order_number: str) -> dict[str, Any]:
    target = order_number.strip()
    if not target.upper().startswith(f"{MANUAL_ORDER_PREFIX}-"):
        raise HTTPException(status_code=400, detail="Chỉ xóa được đơn hàng tự tạo.")
    in_delivery = db.scalar(
        select(DeliveryRequestOrder.id)
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestOrder.delivery_request_id)
        .where(func.upper(DeliveryRequestOrder.order_number) == target.upper(), DeliveryRequest.status != "CANCELLED")
        .limit(1)
    )
    if in_delivery is not None:
        raise HTTPException(status_code=400, detail=f"Đơn {target} đã nằm trong yêu cầu xuất hàng, không thể xóa.")
    result = db.execute(
        delete(VinamilkOrderSnapshot).where(
            VinamilkOrderSnapshot.order_number == target,
            VinamilkOrderSnapshot.is_synthetic.is_(True),
        )
    )
    if not result.rowcount:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy đơn hàng {target}.")
    db.commit()
    return {"deleted_order_number": target, "deleted_lines": result.rowcount}


@router.post("/vinamilk-orders/manual", status_code=201)
def create_manual_order(
    payload: ManualOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dist_code = (
        (current_user.distributor.code or "").strip().upper()
        if current_user and getattr(current_user, "distributor", None)
        else None
    )
    return _create_manual_order(
        db,
        payload,
        performed_by=getattr(current_user, "username", None),
        current_employee=resolve_user_employee(db, current_user),
        distributor_code=dist_code,
    )


@router.get("/vinamilk-orders/manual/next-number")
def get_next_manual_order_number(
    order_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return {"order_number": _next_manual_order_number(db, order_date or date.today())}


@router.delete("/vinamilk-orders/manual/{order_number}")
def delete_manual_order(
    order_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _delete_manual_order(db, order_number)


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


# =========================================================================
# TIẾN TRÌNH CHẠY NGẦM & HÀNG ĐỢI XỬ LÝ ĐỒNG BỘ THỜI GIAN THỰC (JOB QUEUE)
# =========================================================================

from app.core.job_queue import job_manager, JobInfo


async def _run_vinamilk_sync_background(job_id: str, form_dict: dict, days: list[date]):
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        job_manager.start_job(job_id, f"Khởi tạo kết nối cào dữ liệu {len(days)} ngày từ cổng Vinamilk...")
        session_cookie = read_cookie()
        saved_total = 0
        total_days = len(days)

        for idx, day in enumerate(days, start=1):
            day_str = day.strftime("%d/%m/%Y")
            job_manager.update_progress(
                job_id,
                current_step=idx - 1,
                message=f"Đang đồng bộ ngày {day_str} ({idx}/{total_days})...",
            )
            day_form = {**form_dict, "fromDate": day_str, "toDate": day_str}
            try:
                session_cookie, row_count = await sync_vinamilk_day(db, day_form, day, session_cookie)
                saved_total += row_count
                job_manager.update_progress(
                    job_id,
                    current_step=idx,
                    message=f"Đã lưu ngày {day_str} (+{row_count} đơn, tổng cộng {saved_total} đơn).",
                )
            except Exception as day_exc:
                db.rollback()
                job_manager.update_progress(
                    job_id,
                    current_step=idx,
                    message=f"Ngày {day_str} gặp sự cố: {day_exc}",
                )

        job_manager.set_success(
            job_id,
            result_summary={"saved_total": saved_total, "days_total": total_days},
            message=f"Đồng bộ hoàn tất! Đã lưu {saved_total} dòng đơn hàng từ Vinamilk DMS.",
        )
    except Exception as exc:
        db.rollback()
        job_manager.set_failed(job_id, str(exc))
    finally:
        db.close()


@router.post("/vinamilk/async")
async def trigger_sync_async(request: VinamilkSearchRequest):
    """Kích hoạt cào đơn Vinamilk vào Hàng Đợi Ngầm (Queue) - phản hồi 0ms không làm đơ trang."""
    form = request.model_dump()
    form["page"] = str(form["page"])
    form["rows"] = str(form["rows"])
    from_date = _date_value(request.fromDate)
    to_date = _date_value(request.toDate)

    try:
        days = list(iter_inclusive_dates(from_date, to_date))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    title = f"Đồng bộ đơn Vinamilk ({from_date:%d/%m} → {to_date:%d/%m})"
    job = job_manager.create_job(
        job_type="SYNC_VINAMILK",
        title=title,
        total_steps=len(days),
    )

    # Đưa tác vụ vào hàng đợi ngầm asyncio
    asyncio.create_task(_run_vinamilk_sync_background(job.id, form, days))

    return {
        "job_id": job.id,
        "status": "RUNNING",
        "title": job.title,
        "total_days": len(days),
        "message": "Đã đưa tiến trình cào đơn vào hàng đợi xử lý ngầm thành công.",
    }


@router.get("/jobs/active", response_model=list[JobInfo])
def get_active_sync_jobs():
    """Lấy danh sách các tiến trình ngầm đang xử lý hoặc vừa hoàn tất để hiển thị % tiến độ."""
    return job_manager.list_active_jobs()


@router.get("/jobs/{job_id}", response_model=JobInfo)
def get_sync_job_status(job_id: str):
    """Kiểm tra chi tiết % tiến độ của một tác vụ ngầm."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy tác vụ.")
    return job

