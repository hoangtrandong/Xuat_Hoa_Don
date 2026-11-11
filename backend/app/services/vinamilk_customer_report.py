from __future__ import annotations

import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import dotenv_values
from playwright.sync_api import sync_playwright
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.customer import Customer
from scripts.vinamilk_login import login_and_get_cookie

VINAMILK_CUSTOMER_URL = "https://vinamilk.dmsone.vn/catalog-customer-manager/searchCustomerVO"
PAGE_SIZE = 500
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def _cookie_header() -> str:
    try:
        from app.services.vinamilk_credentials import load_db_session_cookie

        db_cookie = load_db_session_cookie()
        if db_cookie:
            return db_cookie
    except Exception:
        pass
    env_path = Path(__file__).resolve().parents[2] / ".env.local"
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


def _request_form(page_number: int) -> dict[str, str]:
    return {
        "originalCustomerCode": "",
        "customerCode": "",
        "customerName": "",
        "customerType": "",
        "address": "",
        "phone": "",
        "status": "1",
        "refCode": "",
        "chainCode": "",
        "channelType": "",
        "shipTo": "",
        "listShopId": os.getenv("VINAMILK_LIST_SHOP_ID", "10060330"),
        "page": str(page_number),
        "rows": str(PAGE_SIZE),
    }


def _fetch_page(request_context, page_number: int) -> dict[str, Any]:
    response = request_context.post(
        VINAMILK_CUSTOMER_URL,
        form=_request_form(page_number),
        headers={
            "accept": "application/json, text/javascript, */*; q=0.01",
            "x-requested-with": "XMLHttpRequest",
            "referer": "https://vinamilk.dmsone.vn/catalog-customer-manager/info",
        },
    )
    if response.status in (401, 403):
        raise PermissionError("Phiên đăng nhập Vinamilk không còn hợp lệ.")
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(payload.get("errMsg") or "Vinamilk từ chối truy vấn khách hàng.")
    if not isinstance(payload.get("rows"), list):
        raise RuntimeError("Cấu trúc response khách hàng Vinamilk không hợp lệ.")
    return payload


def fetch_vinamilk_customers() -> list[dict[str, Any]]:
    cookie_header = _cookie_header() or login_and_get_cookie()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        try:
            context = browser.new_context()
            context.add_cookies(_browser_cookies(cookie_header))
            try:
                first_payload = _fetch_page(context.request, 1)
            except PermissionError:
                refreshed_cookie = login_and_get_cookie()
                context.clear_cookies()
                context.add_cookies(_browser_cookies(refreshed_cookie))
                first_payload = _fetch_page(context.request, 1)

            rows = list(first_payload["rows"])
            total = int(first_payload.get("total") or len(rows))
            page_count = (total + PAGE_SIZE - 1) // PAGE_SIZE
            for page_number in range(2, page_count + 1):
                rows.extend(_fetch_page(context.request, page_number)["rows"])
            return rows
        finally:
            browser.close()


def build_customer_report() -> str:
    remote_rows = fetch_vinamilk_customers()
    if not remote_rows:
        raise RuntimeError("Vinamilk trả về danh sách khách hàng rỗng; không gửi báo cáo đối soát.")

    remote = {
        str(row.get("customerCode") or "").strip()[:3]: str(row.get("customerName") or "").strip()
        for row in remote_rows
        if row.get("customerCode")
    }
    with SessionLocal() as db:
        local = {
            customer.code.strip(): customer.name.strip()
            for customer in db.scalars(select(Customer)).all()
            if customer.code
        }

    matched = {code for code in remote if code in local}
    exact_names = {
        code for code in matched if local[code].casefold() == remote[code].casefold()
    }
    different_names = [
        (code, local[code], remote[code])
        for code in sorted(matched - exact_names)
    ]
    missing = [(code, remote[code]) for code in sorted(set(remote) - set(local))]

    lines = [
        "BÁO CÁO ĐỐI SOÁT KHÁCH HÀNG VINAMILK",
        f"Thời gian: {datetime.now(VN_TZ).strftime('%d/%m/%Y %H:%M:%S')} (giờ VN)",
        f"Shop DMS: {os.getenv('VINAMILK_LIST_SHOP_ID', '10060330')}",
        "",
        f"Tổng khách hàng DMS: {len(remote_rows)}",
        f"Khớp mã 3 ký tự: {len(matched)}",
        f"Tên khớp (không phân biệt hoa thường): {len(exact_names)}",
        f"Tên khác nhau cần kiểm tra: {len(different_names)}",
        f"Mã DMS chưa có trong database: {len(missing)}",
        "",
        "CÁC TÊN KHÁC NHAU (tối đa 50):",
    ]
    lines.extend(f"{code}: DB='{local_name}' | DMS='{remote_name}'" for code, local_name, remote_name in different_names[:50])
    lines.append("")
    lines.append("MÃ DMS CHƯA CÓ TRONG DATABASE (tối đa 50):")
    lines.extend(f"{code}: {name}" for code, name in missing[:50])
    return "\n".join(lines)


def send_report(report: str) -> None:
    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "")
    recipients = [item.strip() for item in os.getenv("REPORT_EMAIL_TO", "").split(",") if item.strip()]
    sender = os.getenv("REPORT_EMAIL_FROM", username)
    if not host or not username or not password or not recipients:
        raise RuntimeError("Thiếu SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD hoặc REPORT_EMAIL_TO.")

    message = EmailMessage()
    message["Subject"] = f"Báo cáo đối soát KH Vinamilk {datetime.now(VN_TZ):%d/%m/%Y}"
    message["From"] = sender
    message["To"] = ", ".join(recipients)
    message.set_content(report)

    if os.getenv("SMTP_USE_SSL", "false").lower() == "true":
        with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(message)
