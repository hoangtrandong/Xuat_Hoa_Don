from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from dotenv import dotenv_values
from playwright.sync_api import sync_playwright
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.product import Product, ProductCategory, ProductUnit
from scripts.vinamilk_login import configure_playwright_browser_path, login_and_get_cookie

VINAMILK_PRODUCT_URL = "https://vinamilk.dmsone.vn/catalog/product/search"
PAGE_SIZE = 500


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
    return (local_cookie or settings.VINAMILK_SESSION_COOKIE).strip()


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


def _fetch_rows(page, cookie_header: str, page_number: int) -> dict[str, Any]:
    query = urlencode({
        "productCode": "",
        "productName": "",
        "lstcategory": "0,A,B,C,D,E,F,G,H,S,Z",
        "productType": "-1",
        "status": "1",
        "page": page_number,
        "rows": PAGE_SIZE,
    })
    response = page.goto(f"{VINAMILK_PRODUCT_URL}?{query}", wait_until="domcontentloaded", timeout=30_000)
    if response is None:
        raise RuntimeError("Vinamilk không trả về response sản phẩm.")
    content_type = response.headers.get("content-type", "")
    if response.status in (401, 403) or "json" not in content_type.lower():
        raise PermissionError("Phiên đăng nhập Vinamilk đã hết hạn hoặc response không phải JSON.")
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise RuntimeError("Cấu trúc response sản phẩm Vinamilk không hợp lệ.")
    return payload


def _persist_cookie(cookie_header: str) -> None:
    """Mã hóa và lưu cookie mới vào database để tái sử dụng."""
    if not cookie_header:
        return
    from app.services.vinamilk_credentials import save_db_session_cookie

    save_db_session_cookie(cookie_header)


def _fetch_all_pages(cookie_header: str) -> list[dict[str, Any]]:
    """Mở 1 browser context riêng và tải toàn bộ trang sản phẩm.

    Phải dùng context độc lập: không được gọi login_and_get_cookie() (sync_playwright khác)
    khi đang ở trong một context playwright, nếu không sẽ lỗi
    'Playwright Sync API inside the asyncio loop'.
    """
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        try:
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
            )
            context.add_cookies(_browser_cookies(cookie_header))
            page = context.new_page()
            first_payload = _fetch_rows(page, cookie_header, 1)
            rows = list(first_payload["rows"])
            total = int(first_payload.get("total") or len(rows))
            for page_number in range(2, (total + PAGE_SIZE - 1) // PAGE_SIZE + 1):
                rows.extend(_fetch_rows(page, cookie_header, page_number)["rows"])
            return rows
        finally:
            browser.close()


def _load_product_pages() -> list[dict[str, Any]]:
    cookie_header = _cookie_header()
    if cookie_header:
        try:
            return _fetch_all_pages(cookie_header)
        except PermissionError:
            pass

    cookie_header = login_and_get_cookie()
    _persist_cookie(cookie_header)
    return _fetch_all_pages(cookie_header)


def _number(value: Any, default: float = 0) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _get_or_create_unit(db: Session, code: str, cache: dict[str, ProductUnit]) -> ProductUnit:
    normalized = (code or "CAI").strip().upper()[:10]
    if normalized not in cache:
        unit = db.scalar(select(ProductUnit).where(ProductUnit.code == normalized))
        if unit is None:
            unit = ProductUnit(code=normalized, name=normalized)
            db.add(unit)
            db.flush()
        cache[normalized] = unit
    return cache[normalized]


def _get_or_create_category(db: Session, code: str, name: str | None, cache: dict[str, ProductCategory]) -> ProductCategory:
    normalized = (code or "VNM").strip().upper()[:20]
    if normalized not in cache:
        category = db.scalar(select(ProductCategory).where(ProductCategory.code == normalized))
        if category is None:
            category = ProductCategory(code=normalized, name=(name or normalized)[:120])
            db.add(category)
            db.flush()
        cache[normalized] = category
    return cache[normalized]


def fetch_all_products() -> list[dict[str, Any]]:
    """Tải toàn bộ sản phẩm từ Vinamilk DMS One (read-only, không ghi DB).

    Mỗi bản ghi có các field cần dùng: productCode, productName, catCode,
    uom1, convfact, barcode, status, price...
    """
    return _load_product_pages()


def sync_new_products(db: Session) -> dict[str, int]:
    rows = _load_product_pages()
    if not rows:
        raise RuntimeError("Vinamilk trả về danh sách sản phẩm rỗng; dừng đối soát để bảo vệ dữ liệu.")

    remote_skus = {
        str(row.get("productCode") or "").strip().upper()
        for row in rows
        if row.get("productCode")
    }
    existing_skus = set(db.scalars(select(Product.sku)).all())
    existing_vinamilk = list(db.scalars(select(Product).where(Product.supplier == "Vinamilk")).all())
    units = {unit.code: unit for unit in db.scalars(select(ProductUnit)).all()}
    categories = {category.code: category for category in db.scalars(select(ProductCategory)).all()}
    added = 0
    skipped = 0
    deactivated = 0
    reactivated = 0

    for product in existing_vinamilk:
        if product.sku not in remote_skus and product.status != "inactive":
            product.status = "inactive"
            deactivated += 1
        elif product.sku in remote_skus and product.status != "active":
            product.status = "active"
            reactivated += 1

    for row in rows:
        sku = str(row.get("productCode") or "").strip().upper()
        name = str(row.get("productName") or "").strip()
        if not sku or not name or sku in existing_skus:
            skipped += 1
            continue
        category = _get_or_create_category(db, str(row.get("catCode") or ""), row.get("catName"), categories)
        unit = _get_or_create_unit(db, str(row.get("uom1") or ""), units)
        product_status = "active" if row.get("status") in (1, "1", True) else "inactive"
        db.add(Product(
            sku=sku,
            name=name,
            category_id=category.id,
            unit_id=unit.id,
            supplier="Vinamilk",
            barcode=str(row.get("barcode") or "").strip() or None,
            base_price=_number(row.get("price") or row.get("priceEInovice")),
            boxes_per_carton=max(1, int(_number(row.get("convfact"), 1))),
            status=product_status,
        ))
        existing_skus.add(sku)
        added += 1

    db.commit()
    return {
        "fetched": len(rows),
        "added": added,
        "skipped": skipped,
        "deactivated": deactivated,
        "reactivated": reactivated,
    }
