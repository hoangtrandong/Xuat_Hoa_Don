from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
import time
from typing import Any
import uuid
import xml.etree.ElementTree as ET
import zipfile

import httpx
from sqlalchemy import select
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


def normalize_bearer_token(token: str) -> str:
    clean = (token or "").strip()
    if not clean:
        return ""
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

    base_url = (
        f"{GDT_BASE_URL}/api/sco-query/invoices"
        if is_mtt
        else f"{GDT_BASE_URL}/api/query/invoices"
    )
    export_action = (
        "Xu%E1%BA%A5t%20xml%20(h%C3%B3a%20%C4%91%C6%A1n%20m%C3%A1y%20t%C3%ADnh%20ti%E1%BB%81n%20mua%20v%C3%A0o)"
        if is_mtt
        else "Xu%E1%BA%A5t%20xml%20(h%C3%B3a%20%C4%91%C6%A1n%20mua%20v%C3%A0o)"
    )
    xml_url = f"{base_url}/export-xml?nbmst={nbmst}&khhdon={khhdon}&shdon={shdon}&khmshdon={khmshdon}"
    headers = {
        **DEFAULT_HEADERS,
        "Authorization": bearer_token,
        "request-id": str(uuid.uuid4()),
        "Action": export_action,
        "End-Point": "/tra-cuu/tra-cuu-hoa-don",
        "Referer": f"{GDT_BASE_URL}/tra-cuu/tra-cuu-hoa-don",
    }

    resp = client.get(xml_url, headers=headers)
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


def sync_gdt_purchase_invoices(
    db: Session,
    distributor_id: int,
    from_date: date,
    to_date: date,
    bearer_token: str,
) -> dict[str, Any]:
    """Đồng bộ toàn bộ Hóa đơn điện tử mua vào (Có mã, Không mã, Máy tính tiền) từ Cổng Thuế
    và tự động tải + bóc tách XML hàng hóa lưu vào PostgreSQL."""
    norm_token = normalize_bearer_token(bearer_token)
    if not norm_token:
        raise PermissionError("CQT_TOKEN_EXPIRED")

    date_from_fmt = f"{from_date:%d/%m/%Y}T00:00:00"
    date_to_fmt = f"{to_date:%d/%m/%Y}T23:59:59"

    searches_to_run = [
        {"ttxly": "5", "is_mtt": False, "category": "CO_MA"},
        {"ttxly": "6", "is_mtt": False, "category": "KHONG_MA"},
        {"ttxly": "8", "is_mtt": True, "category": "MAY_TINH_TIEN"},
    ]

    page_size = 50
    all_raw_items: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        for job_idx, job in enumerate(searches_to_run):
            if job_idx > 0:
                time.sleep(1.2)
            ttxly = job["ttxly"]
            is_mtt = job["is_mtt"]
            category = job["category"]

            base_url = (
                f"{GDT_BASE_URL}/api/sco-query/invoices"
                if is_mtt
                else f"{GDT_BASE_URL}/api/query/invoices"
            )
            api_endpoint = f"{base_url}/purchase"
            action_header = (
                "T%C3%ACm%20ki%E1%BA%BFm%20(h%C3%B3a%20%C4%91%C6%A1n%20m%C3%A1y%20t%C3%ADnh%20ti%E1%BB%81n%20mua%20v%C3%A0o)"
                if is_mtt
                else "T%C3%ACm%20ki%E1%BA%BFm%20(h%C3%B3a%20%C4%91%C6%A1n%20mua%20v%C3%A0o)"
            )
            search_param = f"tdlap=ge={date_from_fmt};tdlap=le={date_to_fmt};ttxly=={ttxly}"

            state: str | None = None
            total_for_ttxly: int | None = None
            fetched_for_ttxly = 0

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
                resp = client.get(url, headers=headers)

                if resp.status_code == 401:
                    raise PermissionError("CQT_TOKEN_EXPIRED")
                if resp.status_code != 200:
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

        saved_invoices = 0
        xml_extracted_count = 0

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

            existing = db.scalar(
                select(PurchaseInvoice)
                .options(selectinload(PurchaseInvoice.items))
                .where(
                    PurchaseInvoice.distributor_id == distributor_id,
                    PurchaseInvoice.seller_tax_code == nbmst,
                    PurchaseInvoice.invoice_template == khmshdon,
                    PurchaseInvoice.invoice_symbol == khhdon,
                    PurchaseInvoice.invoice_number == shdon,
                )
            )
            if existing is None:
                existing = PurchaseInvoice(
                    distributor_id=distributor_id,
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

            # Tải ZIP/XML và bóc tách dòng hàng hóa nếu chưa tải
            if not existing.xml_downloaded or not existing.items:
                try:
                    if xml_extracted_count > 0:
                        time.sleep(0.8)
                    xml_text, html_text = _download_and_extract_invoice_zip(
                        client=client,
                        bearer_token=norm_token,
                        nbmst=nbmst,
                        khhdon=khhdon,
                        shdon=shdon,
                        khmshdon=khmshdon,
                        is_mtt=is_mtt,
                    )
                    if xml_text:
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
                except Exception:
                    pass

            saved_invoices += 1

    cred = db.scalar(
        select(TaxAuthorityCredential).where(TaxAuthorityCredential.distributor_id == distributor_id)
    )
    if cred:
        cred.last_synced_at = datetime.utcnow()

    try:
        from app.crud.product import sync_products_from_system_data
        db.flush()
        sync_products_from_system_data(db, commit=False)
    except Exception:
        pass

    db.commit()
    return {
        "total_found": len(all_raw_items),
        "saved_invoices": saved_invoices,
        "xml_extracted_count": xml_extracted_count,
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
