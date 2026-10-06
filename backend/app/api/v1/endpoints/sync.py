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
from playwright.async_api import Browser, Error as PlaywrightError, async_playwright
from dotenv import dotenv_values
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.customer import Company
from app.models.vinamilk import VinamilkOrderReplacement, VinamilkOrderSnapshot, VinamilkSyncRun
from app.models.vinamilk_allocation import VinamilkOrderAllocation
from app.services.vinamilk_dates import iter_inclusive_dates
from scripts.vinamilk_login import login_and_get_cookie

router = APIRouter()
_cookie_refresh_lock = asyncio.Lock()
_runtime_cookie = ""

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
    returned_orders: set[str] | None,
) -> None:
    """Đặt true/false theo kết quả truy vấn đã lọc; truy vấn lỗi (None) thì giữ nguyên giá trị cũ."""
    if warehouse_orders is None and returned_orders is None:
        return
    snapshots = db.scalars(select(VinamilkOrderSnapshot).where(
        VinamilkOrderSnapshot.synced_from == day,
        VinamilkOrderSnapshot.synced_to == day,
        VinamilkOrderSnapshot.order_number.is_not(None),
    )).all()
    for snapshot in snapshots:
        if warehouse_orders is not None:
            snapshot.warehouse_updated = snapshot.order_number in warehouse_orders
        if returned_orders is not None:
            snapshot.returned = snapshot.order_number in returned_orders


def _update_order_replacement(
    db: Session,
    new_order_number: str,
    replaced_order_number: str | None,
) -> None:
    new_order_number = new_order_number.strip()
    replaced_order_number = replaced_order_number.strip() if replaced_order_number is not None else None
    replaced_order_number = replaced_order_number or None
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
        ))
    else:
        current.replaced_order_number = replaced_order_number
        current.updated_at = datetime.utcnow()


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
    try:
        return _date_value(value)
    except ValueError:
        return None


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
            import json
            identity = json.dumps(row, ensure_ascii=False, sort_keys=True, default=str)
        import hashlib
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
        snapshot.order_created_date = _parse_optional_date(_field(row, ("createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày")))
        snapshot.delivery_date = _parse_optional_date(_field(row, ("deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày")))
        snapshot.synced_from = from_date
        snapshot.synced_to = to_date
        snapshot.synced_at = datetime.utcnow()
        snapshot.raw_payload = row
        saved += 1
    return saved

def read_cookie() -> str:
    if _runtime_cookie:
        return _runtime_cookie
    local_env = Path(__file__).resolve().parents[4] / ".env.local"
    local_cookie = dotenv_values(local_env).get("VINAMILK_SESSION_COOKIE", "")
    return (local_cookie or settings.VINAMILK_SESSION_COOKIE).strip()


async def refresh_cookie() -> str:
    global _runtime_cookie
    async with _cookie_refresh_lock:
        cookie = await asyncio.to_thread(login_and_get_cookie)
        if not cookie:
            raise RuntimeError("Đăng nhập thành công nhưng không tạo được cookie Vinamilk.")
        _runtime_cookie = cookie
        return cookie


async def fetch_vinamilk(session_cookie: str, form: dict[str, str]) -> dict[str, object]:
    import tempfile
    import openpyxl
    form["page"] = str(form.get("page", "1"))
    form["rows"] = str(form.get("rows", "2000"))
    
    # format date
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
        "reportFormId": ""
    }
    # DMS Vinamilk xác định trạng thái bằng bộ lọc truy vấn, không có cột trạng thái trong file.
    scope = form.get("scope", "all")
    if scope == "warehouse":
        del export_form["saleOrderType"]
        export_form.update({"approved": "1", "approvedStep": "3"})
    elif scope == "returned":
        export_form["saleOrderType"] = "0"
        
    cookies: list[dict[str, str]] = [
        {"name": part.split("=", 1)[0].strip(), "value": part.split("=", 1)[1].strip(),
         "domain": "vinamilk.dmsone.vn", "path": "/"}
        for part in session_cookie.split(";")
        if "=" in part and part.split("=", 1)[0].strip()
    ]

    try:
        from playwright.async_api import async_playwright
        import json
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
                    locale="en-US",
                )
                await context.add_cookies(cookies)
                
                resp = await context.request.post(
                    "https://vinamilk.dmsone.vn/sale-product/search-sale/export-excel",
                    form=export_form,
                    headers={
                        "accept": "application/json, text/javascript, */*; q=0.01",
                        "x-requested-with": "XMLHttpRequest",
                        "referer": "https://vinamilk.dmsone.vn/sale-product/search-sale/info"
                    }
                )
                
                if resp.status in (401, 403):
                    return {"status": resp.status, "body": ""}
                    
                data = await resp.json()
                if not data or not data.get("path"):
                    raise RuntimeError(f"Failed to export excel: {data}")
                    
                excel_resp = await context.request.get(data["path"])
                excel_bytes = await excel_resp.body()
                
                # read excel
                import os
                fd, temp_path = tempfile.mkstemp(suffix=".xlsx")
                with os.fdopen(fd, 'wb') as f:
                    f.write(excel_bytes)
                
                wb = openpyxl.load_workbook(temp_path, data_only=True)
                sheet = wb.active
                headers = [cell.value for cell in sheet[1]]
                rows = []
                for row in sheet.iter_rows(min_row=2, values_only=True):
                    row_dict = dict(zip(headers, row))
                    if row_dict.get("Số đơn hàng") and str(row_dict.get("Số đơn hàng")) != "None":
                        # Convert datetime objects to string for JSON serialization
                        for k, v in row_dict.items():
                            if hasattr(v, "isoformat"):
                                row_dict[k] = v.isoformat()
                        rows.append(row_dict)
                        
                os.remove(temp_path)
                return {"status": 200, "body": json.dumps(rows)}
                
            finally:
                await browser.close()
    except Exception as exc:
        raise RuntimeError(f"Playwright không thể gọi Vinamilk: {exc}") from exc


async def _fetch_vinamilk_payload(session_cookie: str, form: dict[str, str]) -> tuple[str, Any]:
    if not session_cookie:
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
                session_cookie, payload = await _fetch_vinamilk_payload(session_cookie, day_form)
                row_count = _save_snapshot(db, payload, day, day)
                scoped: dict[str, set[str] | None] = {}
                for scope in ("warehouse", "returned"):
                    try:
                        session_cookie, scoped_payload = await _fetch_vinamilk_payload(
                            session_cookie, {**day_form, "scope": scope}
                        )
                        scoped[scope] = _order_numbers(scoped_payload)
                    except (RuntimeError, ValueError):
                        scoped[scope] = None
                _apply_scoped_states(db, day, scoped["warehouse"], scoped["returned"])
                db.commit()
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
    order_numbers = {row.order_number for row in rows if row.order_number}
    replacements = db.scalars(
        select(VinamilkOrderReplacement).where(
            or_(
                VinamilkOrderReplacement.new_order_number.in_(order_numbers),
                VinamilkOrderReplacement.replaced_order_number.in_(order_numbers),
            )
        )
    ).all() if order_numbers else []
    replaced_by: dict[str, list[str]] = defaultdict(list)
    replaced_order_for = {item.new_order_number: item.replaced_order_number for item in replacements}
    for replacement in replacements:
        replaced_by[replacement.replaced_order_number].append(replacement.new_order_number)
    for row in rows:
        base = {
            **row.raw_payload,
            "_local_id": row.id,
            "_synced_at": _iso_utc(row.synced_at),
            "_allocation_id": None,
            "_warehouse_updated": row.warehouse_updated,
            "_returned": row.returned,
            "_replaced_order_number": replaced_order_for.get(row.order_number or ""),
            "_replaced_by_order_numbers": replaced_by.get(row.order_number or "", []),
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


@router.patch("/vinamilk-orders/{new_order_number}/replacement")
def update_vinamilk_order_replacement(
    new_order_number: str,
    payload: OrderReplacementUpdateRequest,
    db: Session = Depends(get_db),
):
    _update_order_replacement(db, new_order_number, payload.replaced_order_number)
    db.commit()
    return {
        "new_order_number": new_order_number,
        "replaced_order_number": payload.replaced_order_number.strip() if payload.replaced_order_number else None,
    }


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
