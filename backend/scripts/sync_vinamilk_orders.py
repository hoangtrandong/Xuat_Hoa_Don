"""Sync recent Vinamilk orders into the Neon snapshot tables."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import dotenv_values
from playwright.sync_api import sync_playwright
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.vinamilk import VinamilkSyncRun
from app.api.v1.endpoints.sync import _row_list, _save_snapshot
from scripts.vinamilk_login import login_and_get_cookie

VINAMILK_URL = "https://vinamilk.dmsone.vn/sale-product/search-sale/search"
PAGE_SIZE = 500
LOOKBACK_DAYS = 3


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


def fetch_orders(from_date: date, to_date: date) -> list[dict[str, Any]]:
    cookie_header = _cookie_header() or login_and_get_cookie()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        try:
            context = browser.new_context()
            context.add_cookies(_browser_cookies(cookie_header))
            try:
                first_payload = _fetch_page(context.request, from_date, to_date, 1)
            except PermissionError:
                refreshed_cookie = login_and_get_cookie()
                context.clear_cookies()
                context.add_cookies(_browser_cookies(refreshed_cookie))
                first_payload = _fetch_page(context.request, from_date, to_date, 1)

            rows = _row_list(first_payload)
            total = int(first_payload.get("total") or len(rows))
            page_count = (total + PAGE_SIZE - 1) // PAGE_SIZE
            for page_number in range(2, page_count + 1):
                rows.extend(_row_list(_fetch_page(context.request, from_date, to_date, page_number)))
            return rows
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
            rows = fetch_orders(from_date, today)
            row_count = _save_snapshot(db, rows, from_date, today)
            sync_run.status = "SUCCESS"
            sync_run.row_count = row_count
            sync_run.finished_at = datetime.utcnow()
            db.commit()
            print(f"Vinamilk order sync completed: fetched={len(rows)} saved={row_count} from={from_date} to={today}")
        except Exception as exc:
            db.rollback()
            sync_run.status = "FAILED"
            sync_run.error_message = str(exc)
            sync_run.finished_at = datetime.utcnow()
            db.add(sync_run)
            db.commit()
            raise


if __name__ == "__main__":
    main()
