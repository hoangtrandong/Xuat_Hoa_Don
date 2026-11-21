from __future__ import annotations

import calendar
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from io import BytesIO
import time
from typing import Any
import uuid
import xml.etree.ElementTree as ET
import zipfile

import httpx
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session, selectinload

from app.models.multi_tenant_invoice import (
    PurchaseInvoice,
    PurchaseInvoiceItem,
    TaxAuthorityCredential,
)

GDT_BASE_URL = "https://hoadondientu.gdt.gov.vn"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi",
    "Referer": f"{GDT_BASE_URL}/",
    "Origin": GDT_BASE_URL,
}
GDT_MAX_XML_WORKERS = 4
GDT_MAX_REQUEST_ATTEMPTS = 3
GDT_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


def _gdt_get(
    client: httpx.Client,
    url: str,
    *,
    headers: dict[str, str],
) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(GDT_MAX_REQUEST_ATTEMPTS):
        try:
            response = client.get(url, headers=headers)
            if response.status_code not in GDT_RETRYABLE_STATUS_CODES:
                return response
            last_error = RuntimeError(
                f"Cổng Thuế trả về HTTP {response.status_code}"
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
        if attempt + 1 < GDT_MAX_REQUEST_ATTEMPTS:
            time.sleep(0.5 * (2**attempt))
    if last_error is not None:
        raise RuntimeError(f"Không thể kết nối Cổng Thuế: {last_error}") from last_error
    raise RuntimeError("Không thể kết nối Cổng Thuế.")


import re

def normalize_bearer_token(token: str) -> str:
    clean = (token or "").strip()
    if not clean:
        return ""

    # 1. Nếu dán cURL hoặc header chứa "authorization: Bearer <token>"
    bearer_match = re.search(
        r"bearer\s+([A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+)",
        clean,
        re.IGNORECASE,
    )
    if bearer_match:
        return f"Bearer {bearer_match.group(1).strip()}"

    # 2. Nếu dán chuỗi JWT 3 đoạn (eyJ...)
    jwt_match = re.search(
        r"([A-Za-z0-9\-_=]{20,}\.[A-Za-z0-9\-_=]{20,}\.[A-Za-z0-9\-_=]+)",
        clean,
    )
    if jwt_match:
        return f"Bearer {jwt_match.group(1).strip()}"

    # 3. Chuỗi thông thường
    clean = clean.strip("'\"")
    if clean.lower().startswith("authorization:"):
        clean = clean[14:].strip()
    if not clean.lower().startswith("bearer "):
        return f"Bearer {clean}"
    return "Bearer " + clean[7:].strip()


def fetch_gdt_captcha() -> dict[str, str]:
    """Lấy mã CAPTCHA SVG trực tiếp từ Cổng Hóa đơn điện tử Tổng cục Thuế."""
    headers = {
        **DEFAULT_HEADERS,
        "request-id": str(uuid.uuid4()),
        "Action": "",
        "End-Point": "/",
    }
    with httpx.Client(timeout=15.0, headers=headers, follow_redirects=True) as client:
        resp = client.get(f"{GDT_BASE_URL}/api/captcha")
        if resp.status_code != 200:
            raise RuntimeError(f"Cổng Tổng cục Thuế trả về HTTP {resp.status_code} khi lấy CAPTCHA.")
        data = resp.json()
        key = str(data.get("key") or "").strip()
        content = str(data.get("content") or "").strip()
        if not key or not content:
            raise RuntimeError("Dữ liệu CAPTCHA từ Tổng cục Thuế không hợp lệ.")
        return {"key": key, "content": content}


def authenticate_gdt_taxpayer(
    username: str,
    password: str,
    ckey: str,
    cvalue: str,
) -> str:
    """Xác thực tài khoản người nộp thuế kèm mã CAPTCHA người dùng nhập để lấy Bearer Token."""
    payload = {
        "username": username.strip(),
        "password": password,
        "cvalue": cvalue.strip(),
        "ckey": ckey.strip(),
    }
    headers = {
        **DEFAULT_HEADERS,
        "Content-Type": "application/json",
        "request-id": str(uuid.uuid4()),
        "Action": "",
        "End-Point": "/",
    }
    with httpx.Client(timeout=20.0, headers=headers, follow_redirects=True) as client:
        resp = client.post(
            f"{GDT_BASE_URL}/api/security-taxpayer/authenticate",
            json=payload,
        )
        try:
            data = resp.json()
        except Exception:
            data = {}

        if resp.status_code != 200 or not data.get("token"):
            err_msg = (
                data.get("message")
                or data.get("details")
                or data.get("error")
                or f"Đăng nhập Cổng Thuế thất bại (HTTP {resp.status_code}). Vui lòng kiểm tra lại MST, mật khẩu hoặc mã CAPTCHA."
            )
            raise ValueError(str(err_msg))

        return normalize_bearer_token(str(data["token"]))


def interactive_gdt_login_and_capture_token(
    username: str | None = None,
    password: str | None = None,
    timeout_seconds: int = 180,
) -> str:
    """Mở trình duyệt hiển thị trực tiếp trang hoadondientu.gdt.gov.vn,
    tự động bật khung Đăng nhập và điền sẵn MST + Mật khẩu (nếu có).
    Người dùng chỉ cần gõ CAPTCHA và bấm Đăng nhập; hệ thống tự động bắt Bearer Token và đóng trình duyệt."""
    from playwright.sync_api import sync_playwright
    from scripts.vinamilk_login import configure_playwright_browser_path

    configure_playwright_browser_path()
    captured_token: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--new-window",
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        context = browser.new_context(no_viewport=True)
        try:
            page = context.pages[0] if context.pages else context.new_page()

            def _on_request(req):
                if captured_token:
                    return
                try:
                    auth = req.headers.get("authorization") or req.headers.get("Authorization")
                    if auth and ("bearer " in auth.lower() or len(auth.split(".")) == 3):
                        captured_token.append(normalize_bearer_token(auth))
                except Exception:
                    pass

            def _on_response(resp):
                if captured_token:
                    return
                try:
                    if "security-taxpayer/authenticate" in resp.url and resp.status == 200:
                        body = resp.json()
                        if isinstance(body, dict) and body.get("token"):
                            captured_token.append(normalize_bearer_token(str(body["token"])))
                except Exception:
                    pass

            context.on("request", _on_request)
            context.on("response", _on_response)

            page.goto(GDT_BASE_URL, wait_until="domcontentloaded", timeout=60000)
            try:
                page.bring_to_front()
            except Exception:
                pass

            # Tự động đóng popup thông báo của Tổng cục Thuế (nếu có) và bấm mở khung "Đăng nhập"
            try:
                page.wait_for_timeout(1200)
                close_btns = page.locator("button.ant-modal-close")
                if close_btns.count() > 0:
                    for i in range(close_btns.count()):
                        try:
                            if close_btns.nth(i).is_visible():
                                close_btns.nth(i).click(timeout=1500)
                                page.wait_for_timeout(400)
                        except Exception:
                            pass

                login_trigger = page.locator("text=Đăng nhập").first
                if login_trigger.is_visible() and not page.locator("input#username").is_visible():
                    login_trigger.click(timeout=3000)
                    page.wait_for_timeout(600)
            except Exception:
                pass

            # Tự động điền sẵn MST (username) và Mật khẩu (password) nếu đã lưu
            if username:
                try:
                    page.wait_for_selector("input#username", timeout=5000)
                    page.fill("input#username", username.strip())
                    if password:
                        page.fill("input#password", password)
                    page.focus("input#cvalue")
                except Exception:
                    pass

            deadline = time.time() + timeout_seconds
            while time.time() < deadline and not captured_token:
                if page.is_closed():
                    break
                try:
                    page.wait_for_timeout(500)
                    for ck in context.cookies():
                        if ck.get("name") in ("jwt", "token", "access_token") and ck.get("value"):
                            val = str(ck["value"]).strip()
                            if len(val.split(".")) == 3:
                                captured_token.append(normalize_bearer_token(val))
                                break
                    if not captured_token and not page.is_closed():
                        ls_token = page.evaluate(
                            """() => {
                                for (const k of ['jwt', 'token', 'access_token', 'accessToken']) {
                                    const v = localStorage.getItem(k) || sessionStorage.getItem(k);
                                    if (v && v.split('.').length === 3) return v;
                                }
                                return null;
                            }"""
                        )
                        if ls_token:
                            captured_token.append(normalize_bearer_token(str(ls_token).strip('"')))
                except Exception:
                    if page.is_closed():
                        break
        finally:
            try:
                context.close()
            except Exception:
                pass
            try:
                browser.close()
            except Exception:
                pass

    if not captured_token:
        raise RuntimeError(
            "Chưa nhận được Bearer Token từ trang Thuế (hết thời gian chờ hoặc cửa sổ đã bị đóng trước khi đăng nhập xong)."
        )
    return captured_token[0]


def _local_tag(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    if ":" in tag:
        return tag.split(":", 1)[1]
    return tag


def _find_child_text(parent: ET.Element | None, tag_name: str) -> str:
    if parent is None:
        return ""
    target = tag_name.lower()
    for elem in parent.iter():
        if elem is parent:
            continue
        if _local_tag(elem.tag).lower() == target:
            return (elem.text or "").strip()
    return ""


def _find_first_elem(parent: ET.Element | None, tag_name: str) -> ET.Element | None:
    if parent is None:
        return None
    target = tag_name.lower()
    for elem in parent.iter():
        if _local_tag(elem.tag).lower() == target:
            return elem
    return None


def _find_all_elems(parent: ET.Element | None, tag_name: str) -> list[ET.Element]:
    if parent is None:
        return []
    target = tag_name.lower()
    return [elem for elem in parent.iter() if _local_tag(elem.tag).lower() == target]


def _safe_float(val: Any) -> float:
    if val is None:
        return 0.0
    text = str(val).strip().replace(",", "")
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def parse_gdt_invoice_xml(xml_content: str) -> dict[str, Any]:
    """Bóc tách chi tiết file XML Hóa đơn điện tử chuẩn Tổng cục Thuế (theo đúng logic Extension__New)."""
    clean_xml = xml_content.lstrip("\ufeff").strip()
    root = ET.fromstring(clean_xml)

    shd = _find_child_text(root, "SHDon")
    khhdon = _find_child_text(root, "KHHDon")
    nlap = _find_child_text(root, "NLap")
    khmshdon = _find_child_text(root, "KHMSHDon")
    dvtte = _find_child_text(root, "DVTTe") or "VND"

    nban = _find_first_elem(root, "NBan")
    mst_ban = _find_child_text(nban, "MST")
    ten_ban = _find_child_text(nban, "Ten")
    dchi_ban = _find_child_text(nban, "DChi")

    nmua = _find_first_elem(root, "NMua")
    mst_mua = _find_child_text(nmua, "MST")
    ten_mua = _find_child_text(nmua, "Ten")

    # Hóa đơn thay thế / điều chỉnh (TChinh/KHLQuan & TTHDLQuan)
    hd_thay_the = ""
    ngay_thay_the = ""
    tchinh = _find_first_elem(root, "TChinh")
    if tchinh is not None:
        khlquan = _find_first_elem(tchinh, "KHLQuan")
        if khlquan is not None:
            hd_thay_the = _find_child_text(khlquan, "SHDon")
            ngay_thay_the = _find_child_text(khlquan, "NLap")

    tthd_lquan = _find_first_elem(root, "TTHDLQuan")
    if tthd_lquan is not None:
        shd_clquan = _find_child_text(tthd_lquan, "SHDCLQuan")
        if shd_clquan:
            hd_thay_the = f"{hd_thay_the} / {shd_clquan}" if hd_thay_the else shd_clquan
        nlhd_clquan = _find_child_text(tthd_lquan, "NLHDCLQuan")
        if nlhd_clquan:
            ngay_thay_the = f"{ngay_thay_the} / {nlhd_clquan}" if ngay_thay_the else nlhd_clquan

    ttoan = _find_first_elem(root, "TToan")
    tgt_cthue = _safe_float(_find_child_text(ttoan, "TgTCThue"))
    tgt_thue = _safe_float(_find_child_text(ttoan, "TgTThue"))
    tgt_ttbso = _safe_float(_find_child_text(ttoan, "TgTTTBSo"))

    hhdvus = _find_all_elems(root, "HHDVu")
    items: list[dict[str, Any]] = []
    for idx, item_node in enumerate(hhdvus, start=1):
        stt_raw = _find_child_text(item_node, "STT")
        try:
            line_no = int(stt_raw) if stt_raw else idx
        except ValueError:
            line_no = idx
        ma = _find_child_text(item_node, "MHHDVu")
        ten = _find_child_text(item_node, "THHDVu")
        dvt = _find_child_text(item_node, "DVTinh")
        sl = _safe_float(_find_child_text(item_node, "SLuong"))
        dg = _safe_float(_find_child_text(item_node, "DGia"))
        ck = _safe_float(_find_child_text(item_node, "STCKhau"))
        tt = _safe_float(_find_child_text(item_node, "ThTien"))
        tsuat = _find_child_text(item_node, "TSuat")
        items.append(
            {
                "line_number": line_no,
                "product_code": ma,
                "product_name": ten,
                "unit_name": dvt,
                "quantity": sl,
                "unit_price": dg,
                "discount_amount": ck,
                "amount_before_tax": tt,
                "vat_rate": tsuat,
            }
        )

    return {
        "invoice_number": shd,
        "invoice_symbol": khhdon,
        "invoice_date_str": nlap,
        "invoice_template": khmshdon,
        "currency": dvtte,
        "seller_tax_code": mst_ban,
        "seller_name": ten_ban,
        "seller_address": dchi_ban,
        "buyer_tax_code": mst_mua,
        "buyer_name": ten_mua,
        "replaced_invoice_number": hd_thay_the,
        "replaced_invoice_date": ngay_thay_the,
        "amount_before_tax": tgt_cthue,
        "tax_amount": tgt_thue,
        "total_amount": tgt_ttbso,
        "items": items,
    }


def _parse_invoice_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(text[:26], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _download_and_extract_invoice_zip(
    client: httpx.Client,
    bearer_token: str,
    nbmst: str,
    khhdon: str,
    shdon: str,
    khmshdon: str,
    is_mtt: bool,
) -> tuple[str | None, str | None]:
    """Tải file ZIP từ endpoint /export-xml của CQT và giải nén file .xml và .html trong bộ nhớ."""
    if not (nbmst and khhdon and shdon and khmshdon):
        return None, None

    base_url = f"{GDT_BASE_URL}/api/query/invoices"
    export_action = "Xu%E1%BA%A5t%20xml%20(h%C3%B3a%20%C4%91%C6%A1n%20mua%20v%C3%A0o)"
    xml_url = f"{base_url}/export-xml?nbmst={nbmst}&khhdon={khhdon}&shdon={shdon}&khmshdon={khmshdon}"
    headers = {
        **DEFAULT_HEADERS,
        "Authorization": bearer_token,
        "request-id": str(uuid.uuid4()),
        "Action": export_action,
        "End-Point": "/tra-cuu/tra-cuu-hoa-don",
        "Referer": f"{GDT_BASE_URL}/tra-cuu/tra-cuu-hoa-don",
    }

    resp = _gdt_get(client, xml_url, headers=headers)
    if resp.status_code != 200 or not resp.content:
        return None, None

    buf = resp.content
    # Kiểm tra magic number PK\x03\x04 của file ZIP
    is_zip = len(buf) >= 4 and buf[0] == 0x50 and buf[1] == 0x4B and buf[2] == 0x03 and buf[3] == 0x04
    if is_zip:
        xml_text: str | None = None
        html_text: str | None = None
        with zipfile.ZipFile(BytesIO(buf)) as zf:
            for name in zf.namelist():
                lower = name.lower()
                if lower.endswith(".xml") and xml_text is None:
                    xml_text = zf.read(name).decode("utf-8-sig", errors="replace")
                elif lower.endswith(".html") and html_text is None:
                    html_text = zf.read(name).decode("utf-8-sig", errors="replace")
        return xml_text, html_text

    # Trường hợp trả về XML trực tiếp
    text = buf.decode("utf-8-sig", errors="replace")
    if text.lstrip().startswith("<"):
        return text, None
    return None, None


def split_date_range_monthly(from_date: date, to_date: date) -> list[tuple[date, date]]:
    """Chia nhỏ khoảng ngày thành các phân đoạn theo từng tháng (tối đa trong 1 tháng dương lịch)
    để tuân thủ quy định không quá 1 tháng / lần tra cứu của Cổng Tổng cục Thuế."""
    if from_date > to_date:
        return []
    chunks: list[tuple[date, date]] = []
    curr_start = from_date
    while curr_start <= to_date:
        _, last_day = calendar.monthrange(curr_start.year, curr_start.month)
        curr_month_end = date(curr_start.year, curr_start.month, last_day)
        curr_end = min(curr_month_end, to_date)
        chunks.append((curr_start, curr_end))
        curr_start = curr_end + timedelta(days=1)
    return chunks


def sync_gdt_purchase_invoices(
    db: Session,
    distributor_id: int,
    tax_credential_id: int,
    from_date: date,
    to_date: date,
    bearer_token: str,
    sync_products: bool = True,
    progress_callback: Any = None,
) -> dict[str, Any]:
    """Đồng bộ toàn bộ Hóa đơn điện tử mua vào (Có mã, Không mã, Máy tính tiền) từ Cổng Thuế
    và tự động tải + bóc tách XML hàng hóa lưu vào PostgreSQL."""
    norm_token = normalize_bearer_token(bearer_token)
    if not norm_token:
        raise PermissionError("CQT_TOKEN_EXPIRED")

    date_chunks = split_date_range_monthly(from_date, to_date)
    if not date_chunks:
        raise ValueError("Khoảng ngày tra cứu không hợp lệ (Ngày bắt đầu lớn hơn ngày kết thúc).")

    searches_to_run = [
        {"ttxly": "5", "is_mtt": False, "category": "CO_MA"},
        {"ttxly": "6", "is_mtt": False, "category": "KHONG_MA"},
        {"ttxly": "8", "is_mtt": True, "category": "MAY_TINH_TIEN"},
    ]

    page_size = 50
    all_raw_items: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    warnings: list[str] = []

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        for chunk_idx, (chunk_start, chunk_end) in enumerate(date_chunks):
            chunk_suffix = f" (tháng {chunk_start.month}/{chunk_start.year})" if len(date_chunks) > 1 else ""
            date_from_fmt = f"{chunk_start:%d/%m/%Y}T00:00:00"
            date_to_fmt = f"{chunk_end:%d/%m/%Y}T23:59:59"

            for job_idx, job in enumerate(searches_to_run):
                if chunk_idx > 0 or job_idx > 0:
                    time.sleep(1.0)
                ttxly = job["ttxly"]
                is_mtt = job["is_mtt"]
                category = job["category"]

                api_endpoint = f"{GDT_BASE_URL}/api/query/invoices/purchase"
                action_header = "T%C3%ACm%20ki%E1%BA%BFm%20(h%C3%B3a%20%C4%91%C6%A1n%20mua%20v%C3%A0o)"
                search_param = f"tdlap=ge={date_from_fmt};tdlap=le={date_to_fmt};ttxly=={ttxly}"

                state: str | None = None
                total_for_ttxly: int | None = None
                fetched_for_ttxly = 0

                cat_label = {
                    "CO_MA": "HĐ có mã CQT",
                    "KHONG_MA": "HĐ không mã",
                    "MAY_TINH_TIEN": "HĐ máy tính tiền",
                }.get(category, category)

                display_cat = f"{cat_label}{chunk_suffix}"

                if progress_callback:
                    progress_callback({
                        "step": "searching",
                        "category": display_cat,
                        "message": f"Đang tra cứu {display_cat}...",
                    })

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
                    url = f"{api_endpoint}?sort=tdlap:desc&size={page_size}{state_param}&search={search_param}"
                    try:
                        resp = _gdt_get(client, url, headers=headers)
                    except RuntimeError as exc:
                        warnings.append(f"{display_cat}: {exc}")
                        break

                    if resp.status_code == 401:
                        raise PermissionError("CQT_TOKEN_EXPIRED")
                    if resp.status_code != 200:
                        err_text = ""
                        try:
                            err_json = resp.json()
                            if isinstance(err_json, dict):
                                err_text = err_json.get("message") or err_json.get("details") or ""
                        except Exception:
                            err_text = ""
                        if err_text:
                            warnings.append(f"{display_cat}: Cổng Thuế phản hồi HTTP {resp.status_code} ({err_text})")
                        else:
                            warnings.append(f"{display_cat}: Cổng Thuế phản hồi HTTP {resp.status_code}")
                        break

                    data = resp.json()
                    page_datas = (
                        data.get("datas")
                        if isinstance(data, dict) and isinstance(data.get("datas"), list)
                        else data.get("data")
                        if isinstance(data, dict) and isinstance(data.get("data"), list)
                        else data
                        if isinstance(data, list)
                        else []
                    )
                    if isinstance(data, dict) and isinstance(data.get("total"), int) and total_for_ttxly is None:
                        total_for_ttxly = data["total"]

                    if not page_datas:
                        break

                    state = data.get("state") if isinstance(data, dict) and data.get("state") else None
                    new_count = 0
                    for it in page_datas:
                        if not isinstance(it, dict):
                            continue
                        fetched_for_ttxly += 1
                        key = str(
                            it.get("id")
                            or it.get("maHoaDon")
                            or f"{it.get('nbmst') or it.get('mst') or ''}_{it.get('khmshdon') or it.get('mauSo') or ''}_{it.get('khhdon') or it.get('kyHieu') or ''}_{it.get('shdon') or it.get('soHoaDon') or ''}"
                        )
                        if key not in seen_keys:
                            seen_keys.add(key)
                            it["_is_mtt"] = is_mtt
                            it["_ttxly"] = ttxly
                            it["_category"] = category
                            all_raw_items.append(it)
                            new_count += 1

                    if new_count == 0:
                        break
                    if total_for_ttxly is not None and fetched_for_ttxly >= total_for_ttxly:
                        break
                    if not state or len(page_datas) < page_size:
                        break

                if state and fetched_for_ttxly >= page_size * 50:
                    warnings.append(
                        f"{display_cat}: đã đạt giới hạn 50 trang; hãy thu hẹp khoảng ngày để đồng bộ đủ."
                    )

                if progress_callback:
                    progress_callback({
                        "step": "category_done",
                        "category": display_cat,
                        "found_in_category": fetched_for_ttxly,
                        "total_found": len(all_raw_items),
                        "message": f"{display_cat}: Tìm thấy {fetched_for_ttxly} hóa đơn",
                    })

        saved_invoices = 0
        xml_extracted_count = 0
        saved_invoice_ids: list[int] = []
        xml_download_jobs: list[tuple[PurchaseInvoice, dict[str, Any]]] = []
        identity_rows: list[tuple[str, str, str, str]] = []

        for raw in all_raw_items:
            nbmst = str(raw.get("nbmst") or raw.get("mst") or raw.get("mstban") or "").strip()
            khhdon = str(raw.get("khhdon") or raw.get("kyHieu") or "").strip()
            shdon = str(raw.get("shdon") or raw.get("soHoaDon") or raw.get("soHd") or "").strip()
            khmshdon = str(raw.get("khmshdon") or raw.get("mauSo") or "1").strip()
            if nbmst and khhdon and shdon:
                identity_rows.append((nbmst, khmshdon, khhdon, shdon))

        existing_by_identity: dict[tuple[str, str, str, str], PurchaseInvoice] = {}
        if identity_rows:
            existing_rows = db.scalars(
                select(PurchaseInvoice)
                .options(selectinload(PurchaseInvoice.items))
                .where(
                    PurchaseInvoice.distributor_id == distributor_id,
                    PurchaseInvoice.tax_credential_id == tax_credential_id,
                    tuple_(
                        PurchaseInvoice.seller_tax_code,
                        PurchaseInvoice.invoice_template,
                        PurchaseInvoice.invoice_symbol,
                        PurchaseInvoice.invoice_number,
                    ).in_(identity_rows),
                )
            ).all()
            existing_by_identity = {
                (
                    row.seller_tax_code,
                    row.invoice_template,
                    row.invoice_symbol,
                    row.invoice_number,
                ): row
                for row in existing_rows
            }

        for raw in all_raw_items:
            ext_id = str(raw.get("id") or raw.get("maHoaDon") or raw.get("hdonId") or "").strip() or None
            shdon = str(raw.get("shdon") or raw.get("soHoaDon") or raw.get("soHd") or "").strip()
            khhdon = str(raw.get("khhdon") or raw.get("kyHieu") or "").strip()
            khmshdon = str(raw.get("khmshdon") or raw.get("mauSo") or "1").strip()
            nbmst = str(raw.get("nbmst") or raw.get("mst") or raw.get("mstban") or "").strip()
            nbten = str(raw.get("nbten") or raw.get("tenNguoiBan") or raw.get("tenBan") or "").strip()
            nbdchi = str(raw.get("nbdchi") or "").strip() or None
            nmmst = str(raw.get("nmmst") or raw.get("mstmua") or "").strip() or None
            nmten = str(raw.get("nmten") or raw.get("tenNguoiMua") or "").strip() or None
            inv_date = _parse_invoice_datetime(raw.get("tdlap") or raw.get("ngayLap"))
            is_mtt = bool(raw.get("_is_mtt"))
            ttxly = str(raw.get("_ttxly") or raw.get("ttxly") or "5")
            category = str(raw.get("_category") or "CO_MA")

            amt_before = _safe_float(
                raw.get("tgtcthue") or raw.get("tongTienTruocThue") or raw.get("tttien") or raw.get("tongTien")
            )
            tax_amt = _safe_float(raw.get("tgtthue") or raw.get("tongThue") or raw.get("tgtTtban"))
            total_amt = _safe_float(raw.get("tgtttbso") or raw.get("tongTienSauThue") or (amt_before + tax_amt))

            if not (nbmst and khhdon and shdon):
                continue

            identity = (nbmst, khmshdon, khhdon, shdon)
            existing = existing_by_identity.get(identity)
            if existing is None:
                existing = PurchaseInvoice(
                    distributor_id=distributor_id,
                    tax_credential_id=tax_credential_id,
                    external_id=ext_id,
                    invoice_template=khmshdon,
                    invoice_symbol=khhdon,
                    invoice_number=shdon,
                    invoice_date=inv_date,
                    seller_tax_code=nbmst,
                    seller_name=nbten or nbmst,
                    seller_address=nbdchi,
                    buyer_tax_code=nmmst,
                    buyer_name=nmten,
                    invoice_category=category,
                    ttxly=ttxly,
                    is_mtt=is_mtt,
                    amount_before_tax=amt_before,
                    tax_amount=tax_amt,
                    total_amount=total_amt,
                    raw_metadata=raw,
                    synced_at=datetime.utcnow(),
                )
                db.add(existing)
                db.flush()
                existing_by_identity[identity] = existing
            else:
                existing.external_id = ext_id or existing.external_id
                existing.invoice_date = inv_date or existing.invoice_date
                existing.seller_name = nbten or existing.seller_name
                existing.seller_address = nbdchi or existing.seller_address
                existing.buyer_tax_code = nmmst or existing.buyer_tax_code
                existing.buyer_name = nmten or existing.buyer_name
                existing.invoice_category = category
                existing.ttxly = ttxly
                existing.is_mtt = is_mtt
                if amt_before > 0:
                    existing.amount_before_tax = amt_before
                if tax_amt > 0:
                    existing.tax_amount = tax_amt
                if total_amt > 0:
                    existing.total_amount = total_amt
                existing.raw_metadata = raw
                existing.synced_at = datetime.utcnow()

            if not existing.xml_downloaded or not existing.items:
                xml_download_jobs.append(
                    (
                        existing,
                        {
                            "nbmst": nbmst,
                            "khhdon": khhdon,
                            "shdon": shdon,
                            "khmshdon": khmshdon,
                            "is_mtt": is_mtt,
                        },
                    )
                )

            saved_invoices += 1
            if existing.id and existing.id not in saved_invoice_ids:
                saved_invoice_ids.append(existing.id)

        def download_job(params: dict[str, Any]) -> tuple[str | None, str | None]:
            with httpx.Client(timeout=30.0, follow_redirects=True) as download_client:
                return _download_and_extract_invoice_zip(
                    client=download_client,
                    bearer_token=norm_token,
                    **params,
                )

        if xml_download_jobs:
            if progress_callback:
                progress_callback({
                    "step": "xml_start",
                    "total_xml_jobs": len(xml_download_jobs),
                    "message": f"Bắt đầu tải và bóc tách {len(xml_download_jobs)} file XML...",
                })
            xml_done_count = 0
            with ThreadPoolExecutor(max_workers=GDT_MAX_XML_WORKERS) as executor:
                futures = {
                    executor.submit(download_job, params): existing
                    for existing, params in xml_download_jobs
                }
                for future in as_completed(futures):
                    xml_done_count += 1
                    if progress_callback and (xml_done_count % 5 == 0 or xml_done_count == len(xml_download_jobs)):
                        progress_callback({
                            "step": "xml_progress",
                            "completed": xml_done_count,
                            "total": len(xml_download_jobs),
                            "extracted": xml_extracted_count,
                            "message": f"Đang tải & bóc tách XML: {xml_done_count}/{len(xml_download_jobs)}",
                        })
                    existing = futures[future]
                    try:
                        xml_text, html_text = future.result()
                    except Exception as exc:
                        warnings.append(
                            f"HĐ {existing.invoice_number}: không tải được XML ({exc})"
                        )
                        continue
                    if not xml_text:
                        continue
                    existing.xml_content = xml_text
                    existing.html_content = html_text
                    existing.xml_downloaded = True
                    parsed_xml = parse_gdt_invoice_xml(xml_text)
                    if parsed_xml.get("seller_name"):
                        existing.seller_name = parsed_xml["seller_name"]
                    if parsed_xml.get("seller_address"):
                        existing.seller_address = parsed_xml["seller_address"]
                    if parsed_xml.get("buyer_tax_code"):
                        existing.buyer_tax_code = parsed_xml["buyer_tax_code"]
                    if parsed_xml.get("buyer_name"):
                        existing.buyer_name = parsed_xml["buyer_name"]
                    if parsed_xml.get("replaced_invoice_number"):
                        existing.replaced_invoice_number = parsed_xml["replaced_invoice_number"]
                    if parsed_xml.get("replaced_invoice_date"):
                        existing.replaced_invoice_date = parsed_xml["replaced_invoice_date"]
                    if parsed_xml.get("amount_before_tax", 0) > 0:
                        existing.amount_before_tax = parsed_xml["amount_before_tax"]
                    if parsed_xml.get("tax_amount", 0) > 0:
                        existing.tax_amount = parsed_xml["tax_amount"]
                    if parsed_xml.get("total_amount", 0) > 0:
                        existing.total_amount = parsed_xml["total_amount"]

                    existing.items.clear()
                    db.flush()
                    for item_dict in parsed_xml.get("items", []):
                        db.add(
                            PurchaseInvoiceItem(
                                purchase_invoice_id=existing.id,
                                line_number=item_dict["line_number"],
                                product_code=item_dict["product_code"] or None,
                                product_name=item_dict["product_name"] or "(Không tên)",
                                unit_name=item_dict["unit_name"] or None,
                                quantity=item_dict["quantity"],
                                unit_price=item_dict["unit_price"],
                                discount_amount=item_dict["discount_amount"],
                                amount_before_tax=item_dict["amount_before_tax"],
                                vat_rate=item_dict["vat_rate"] or None,
                            )
                        )
                    xml_extracted_count += 1

    cred = db.scalar(
        select(TaxAuthorityCredential).where(
            TaxAuthorityCredential.id == tax_credential_id,
            TaxAuthorityCredential.distributor_id == distributor_id,
        )
    )
    if cred:
        cred.last_synced_at = datetime.utcnow()

    if sync_products:
        try:
            from app.crud.product import sync_products_from_system_data
            db.flush()
            if saved_invoice_ids:
                sync_products_from_system_data(
                    db, invoice_ids=saved_invoice_ids, commit=False
                )
        except Exception as exc:
            warnings.append(f"Không đồng bộ được danh mục sản phẩm: {exc}")

    # Tự động cập nhật Công ty quản lý & liên kết SKU–Công ty từ Hóa đơn mua vào CQT
    if saved_invoice_ids:
        try:
            from app.crud.company import sync_companies_from_purchase_invoices
            db.flush()
            sync_companies_from_purchase_invoices(
                db,
                distributor_id=distributor_id,
                invoice_ids=saved_invoice_ids,
                commit=False,
            )
        except Exception as exc:
            warnings.append(f"Không đồng bộ được Công ty quản lý từ CQT: {exc}")

    if progress_callback:
        progress_callback({
            "step": "saving_db",
            "saved": saved_invoices,
            "xml_extracted": xml_extracted_count,
            "message": f"Đã lưu {saved_invoices} hóa đơn, bóc tách {xml_extracted_count} XML",
        })

    db.commit()
    return {
        "total_found": len(all_raw_items),
        "saved_invoices": saved_invoices,
        "xml_extracted_count": xml_extracted_count,
        "saved_invoice_ids": saved_invoice_ids,
        "warnings": warnings,
    }


def compute_purchase_goods_summary(invoices: list[PurchaseInvoice]) -> list[dict[str, Any]]:
    """Tổng hợp hàng hóa đầu vào theo đúng thuật toán Extension__New:
    - Tự động phát hiện các Số HĐ bị thay thế (replaced_invoice_number) trong danh sách.
    - Nếu hóa đơn nằm trong danh sách bị thay thế, nhân hệ số -1 để trừ lùi chênh lệch."""
    replaced_shds: set[str] = set()
    for inv in invoices:
        if inv.replaced_invoice_number:
            for part in inv.replaced_invoice_number.split("/"):
                clean_shd = part.strip()
                if clean_shd:
                    replaced_shds.add(clean_shd)

    summary_map: dict[str, dict[str, Any]] = {}
    for inv in invoices:
        is_replaced = (inv.invoice_number or "").strip() in replaced_shds
        multiplier = -1.0 if is_replaced else 1.0

        for item in inv.items:
            ten = (item.product_name or "").strip()
            if not ten:
                continue
            ma = (item.product_code or "").strip()
            dvt = (item.unit_name or "").strip()
            dg = float(item.unit_price or 0)
            key = f"{ma}_|_{ten}_|_{dvt}_|_{dg:.2f}"
            if key not in summary_map:
                summary_map[key] = {
                    "product_code": ma,
                    "product_name": ten,
                    "unit_name": dvt,
                    "unit_price": dg,
                    "total_quantity": 0.0,
                    "total_amount": 0.0,
                    "invoice_count": 0,
                    "sellers": set(),
                }
            summary_map[key]["total_quantity"] += float(item.quantity or 0) * multiplier
            summary_map[key]["total_amount"] += float(item.amount_before_tax or 0) * multiplier
            summary_map[key]["invoice_count"] += 1
            if inv.seller_name:
                summary_map[key]["sellers"].add(inv.seller_name)

    result: list[dict[str, Any]] = []
    for row in summary_map.values():
        result.append(
            {
                "product_code": row["product_code"],
                "product_name": row["product_name"],
                "unit_name": row["unit_name"],
                "unit_price": round(row["unit_price"], 2),
                "total_quantity": round(row["total_quantity"], 4),
                "total_amount": round(row["total_amount"], 2),
                "invoice_count": row["invoice_count"],
                "seller_names": ", ".join(sorted(row["sellers"])),
            }
        )
    return result
