import asyncio
import hashlib
import json
from pathlib import Path
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from playwright.async_api import Browser, Error as PlaywrightError, async_playwright
from dotenv import dotenv_values
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.vinamilk import VinamilkOrderSnapshot, VinamilkSyncRun
from scripts.vinamilk_login import login_and_get_cookie

router = APIRouter()
_cookie_refresh_lock = asyncio.Lock()
_runtime_cookie = ""

VINAMILK_URL = "https://vinamilk.dmsone.vn/sale-product/search-sale/search"


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


def _save_snapshot(db: Session, payload: Any, from_date: date, to_date: date) -> int:
    rows = _row_list(payload)
    saved = 0
    for row in rows:
        order_number = _field(row, ("orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode"))
        product_code = _field(row, ("productCode", "itemCode", "sku"))
        line_id = _field(row, ("lineId", "itemId", "orderItemId", "detailId", "id"))
        identity = "|".join((order_number or "", product_code or "", line_id or ""))
        if not identity.strip("|"):
            identity = json.dumps(row, ensure_ascii=False, sort_keys=True, default=str)
        remote_key = hashlib.sha256(identity.encode()).hexdigest()
        snapshot = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.remote_key == remote_key))
        if snapshot is None:
            snapshot = VinamilkOrderSnapshot(remote_key=remote_key, raw_payload={})
            db.add(snapshot)
        snapshot.order_number = order_number
        snapshot.original_order_number = _field(row, ("fromSaleOrderNumber", "originalOrderNumber", "fromSaleOrderCode", "originalOrderId"))
        snapshot.customer_code = _field(row, ("customerCode", "shopCode"))
        snapshot.customer_name = _field(row, ("customerName", "shopName"))
        snapshot.product_code = product_code
        snapshot.product_name = _field(row, ("productName", "itemName", "product"))
        snapshot.status = _field(row, ("orderStatus", "status"))
        snapshot.order_created_date = _parse_optional_date(_field(row, ("createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate")))
        snapshot.delivery_date = _parse_optional_date(_field(row, ("deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate")))
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
    form["page"] = str(form["page"])
    form["rows"] = str(form["rows"])
    cookies: list[dict[str, str]] = [
        {"name": part.split("=", 1)[0].strip(), "value": part.split("=", 1)[1].strip(),
         "domain": "vinamilk.dmsone.vn", "path": "/"}
        for part in session_cookie.split(";")
        if "=" in part and part.split("=", 1)[0].strip()
    ]

    try:
        async with async_playwright() as playwright:
            browser: Browser = await playwright.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
                    locale="en-US",
                )
                await context.add_cookies(cookies)
                page = await context.new_page()
                await page.goto(
                    "https://vinamilk.dmsone.vn/sale-product/search-sale/info",
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
                result = await page.evaluate(
                    """async ({ url, form }) => {
                      const response = await fetch(url, {
                        method: "POST",
                        headers: {
                          "accept": "application/json, text/javascript, */*; q=0.01",
                          "accept-language": "en-US,en;q=0.9,vi;q=0.8,en-ID;q=0.7",
                          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                          "x-requested-with": "XMLHttpRequest"
                        },
                        body: new URLSearchParams(form).toString()
                      });
                      return { status: response.status, body: await response.text() };
                    }""",
                    {"url": VINAMILK_URL, "form": form},
                )
            finally:
                await browser.close()
    except PlaywrightError as exc:
        raise RuntimeError(f"Playwright không thể gọi Vinamilk: {exc}") from exc

    if result["status"] in (401, 403):
        return result
    if result["status"] >= 400:
        raise RuntimeError(f"Vinamilk trả về HTTP {result['status']}.")
    return result


@router.post("/vinamilk")
async def trigger_sync(request: VinamilkSearchRequest, db: Session = Depends(get_db)):
    session_cookie = read_cookie()

    form = request.model_dump()
    form["page"] = str(form["page"])
    form["rows"] = str(form["rows"])
    from_date = _date_value(request.fromDate)
    to_date = _date_value(request.toDate)
    sync_run = VinamilkSyncRun(from_date=from_date, to_date=to_date, status="RUNNING")
    db.add(sync_run)
    db.commit()
    try:
        if not session_cookie:
            session_cookie = await refresh_cookie()
        result = await fetch_vinamilk(session_cookie, form)
        if result["status"] in (401, 403):
            session_cookie = await refresh_cookie()
            result = await fetch_vinamilk(session_cookie, form)
        if result["status"] >= 400:
            raise RuntimeError(f"Vinamilk trả về HTTP {result['status']}.")
        payload = json.loads(str(result["body"]))
        row_count = _save_snapshot(db, payload, from_date, to_date)
        sync_run.status = "SUCCESS"
        sync_run.row_count = row_count
        sync_run.finished_at = datetime.utcnow()
        db.commit()
        return {"rows": _row_list(payload), "row_count": row_count, "synced_at": sync_run.finished_at.isoformat()}
    except (RuntimeError, ValueError) as exc:
        db.rollback()
        sync_run.status = "FAILED"
        sync_run.error_message = str(exc)
        sync_run.finished_at = datetime.utcnow()
        db.add(sync_run)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/vinamilk-orders")
def list_local_vinamilk_orders(
    from_date: date,
    to_date: date,
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    stmt = select(VinamilkOrderSnapshot).where(
        VinamilkOrderSnapshot.order_created_date >= from_date,
        VinamilkOrderSnapshot.order_created_date <= to_date,
    )
    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(
            VinamilkOrderSnapshot.order_number.ilike(term),
            VinamilkOrderSnapshot.customer_code.ilike(term),
            VinamilkOrderSnapshot.customer_name.ilike(term),
            VinamilkOrderSnapshot.product_code.ilike(term),
            VinamilkOrderSnapshot.product_name.ilike(term),
        ))
    if status:
        stmt = stmt.where(VinamilkOrderSnapshot.status == status)
    rows = db.scalars(stmt.order_by(VinamilkOrderSnapshot.order_created_date.desc(), VinamilkOrderSnapshot.id.desc()).offset(skip).limit(limit)).all()
    latest = db.scalar(select(VinamilkSyncRun).where(
        VinamilkSyncRun.from_date <= to_date,
        VinamilkSyncRun.to_date >= from_date,
        VinamilkSyncRun.status == "SUCCESS",
    ).order_by(VinamilkSyncRun.finished_at.desc()))
    return {
        "rows": [
            {**row.raw_payload, "_local_id": row.id, "_synced_at": row.synced_at.isoformat()}
            for row in rows
        ],
        "total": len(rows),
        "last_synced_at": latest.finished_at.isoformat() if latest and latest.finished_at else None,
    }
