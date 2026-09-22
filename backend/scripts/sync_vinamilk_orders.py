"""Sync recent Vinamilk orders into the Neon snapshot tables."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import dotenv_values
from playwright.sync_api import sync_playwright

from app.core.database import SessionLocal
from app.models.vinamilk import VinamilkSyncRun
from app.api.v1.endpoints.sync import _row_list, _save_snapshot
from app.services.vinamilk_dates import iter_inclusive_dates
from scripts.vinamilk_login import login_and_get_cookie

VINAMILK_URL = "https://vinamilk.dmsone.vn/sale-product/search-sale/search"
PAGE_SIZE = 500
# Job chạy 2 giờ/lần: lấy hôm nay và hôm qua để bắt đơn tạo muộn / cập nhật lại.
LOOKBACK_DAYS = 2


def _cookie_header() -> str:
    env_path = Path(__file__).resolve().parents[1] / ".env.local"
    local_cookie = dotenv_values(env_path).get("VINAMILK_SESSION_COOKIE", "")
    return (local_cookie or os.getenv("VINAMILK_SESSION_COOKIE", "")).strip()


def _browser_cookies(cookie_header: str) -> list[dict[str, str]]:
    return [
        {
            "name": part.split("=", 1)[0].strip(),
            "value": part.split("=", 1)[1].strip(),
            "domain": "vinamilk.dmsone.vn",
            "path": "/",
        }
        for part in cookie_header.split(";")
        if "=" in part and part.split("=", 1)[0].strip()
    ]


def _fetch_page(context, from_date: date, to_date: date, page_number: int) -> dict[str, Any]:
    form = {
        "orderNumber": "",
        "refOrderNumber": "",
        "fromDate": from_date.strftime("%d/%m/%Y"),
        "toDate": to_date.strftime("%d/%m/%Y"),
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
        "page": str(page_number),
        "rows": str(PAGE_SIZE),
    }
    response = context.post(
        VINAMILK_URL,
        form=form,
        headers={
            "accept": "application/json, text/javascript, */*; q=0.01",
            "x-requested-with": "XMLHttpRequest",
            "referer": "https://vinamilk.dmsone.vn/sale-product/search-sale/info",
        },
    )
    if response.status in (401, 403):
        raise PermissionError("Phiên đăng nhập Vinamilk không còn hợp lệ.")
    if response.status >= 400:
        raise RuntimeError(f"Vinamilk trả về HTTP {response.status}.")
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Vinamilk trả về payload không hợp lệ.")
    return payload


def _fetch_range(context, from_date: date, to_date: date) -> list[dict[str, Any]]:
    first_payload = _fetch_page(context.request, from_date, to_date, 1)
    rows = _row_list(first_payload)
    total = int(first_payload.get("total") or len(rows))
    page_count = (total + PAGE_SIZE - 1) // PAGE_SIZE
    for page_number in range(2, page_count + 1):
        rows.extend(_row_list(_fetch_page(context.request, from_date, to_date, page_number)))
    return rows


def fetch_orders_by_day(from_date: date, to_date: date) -> tuple[list[tuple[date, list[dict[str, Any]]]], list[dict[str, Any]]]:
    cookie_header = _cookie_header() or login_and_get_cookie()
    fetched: list[tuple[date, list[dict[str, Any]]]] = []
    failed_days: list[dict[str, Any]] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        try:
            context = browser.new_context()
            context.add_cookies(_browser_cookies(cookie_header))

            def ensure_range(day: date) -> list[dict[str, Any]]:
                try:
                    return _fetch_range(context, day, day)
                except PermissionError:
                    refreshed_cookie = login_and_get_cookie()
                    context.clear_cookies()
                    context.add_cookies(_browser_cookies(refreshed_cookie))
                    return _fetch_range(context, day, day)

            for day in iter_inclusive_dates(from_date, to_date):
                try:
                    day_rows = ensure_range(day)
                    fetched.append((day, day_rows))
                    print(f"Vinamilk day sync fetched={len(day_rows)} date={day}")
                except Exception as exc:
                    failed_days.append({"date": day.isoformat(), "error": str(exc)})
                    print(f"Vinamilk day sync failed date={day} error={exc}")
            return fetched, failed_days
        finally:
            browser.close()


def main() -> None:
    today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    from_date = today - timedelta(days=LOOKBACK_DAYS - 1)
    with SessionLocal() as db:
        sync_run = VinamilkSyncRun(from_date=from_date, to_date=today, status="RUNNING")
        db.add(sync_run)
        db.commit()
        try:
            fetched, failed_days = fetch_orders_by_day(from_date, today)
            saved_total = 0
            for day, day_rows in fetched:
                saved_total += _save_snapshot(db, day_rows, day, day)
                db.commit()

            if failed_days and saved_total == 0 and not fetched:
                raise RuntimeError("; ".join(f"{item['date']}: {item['error']}" for item in failed_days))
            sync_run.status = "PARTIAL" if failed_days else "SUCCESS"
            sync_run.row_count = saved_total
            sync_run.error_message = (
                "; ".join(f"{item['date']}: {item['error']}" for item in failed_days) if failed_days else None
            )
            sync_run.finished_at = datetime.utcnow()
            db.commit()
            print(
                f"Vinamilk order sync completed: fetched={sum(len(rows) for _, rows in fetched)} "
                f"saved={saved_total} from={from_date} to={today} failed_days={len(failed_days)}"
            )
            if failed_days:
                raise RuntimeError(sync_run.error_message)
        except Exception as exc:
            db.rollback()
            if sync_run.status == "RUNNING":
                sync_run.status = "FAILED"
                sync_run.error_message = str(exc)
                sync_run.finished_at = datetime.utcnow()
                db.add(sync_run)
                db.commit()
            raise


if __name__ == "__main__":
    main()
