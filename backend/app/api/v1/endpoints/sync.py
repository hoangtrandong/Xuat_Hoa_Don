import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from playwright.async_api import Browser, Error as PlaywrightError, async_playwright
from dotenv import dotenv_values
from app.core.config import settings
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

def read_cookie() -> str:
    if _runtime_cookie:
        return _runtime_cookie
    local_env = Path(__file__).resolve().parents[3] / ".env.local"
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
async def trigger_sync(request: VinamilkSearchRequest):
    session_cookie = read_cookie()

    form = request.model_dump()
    form["page"] = str(form["page"])
    form["rows"] = str(form["rows"])
    try:
        if not session_cookie:
            session_cookie = await refresh_cookie()
        result = await fetch_vinamilk(session_cookie, form)
        if result["status"] in (401, 403):
            session_cookie = await refresh_cookie()
            result = await fetch_vinamilk(session_cookie, form)
        if result["status"] >= 400:
            raise RuntimeError(f"Vinamilk trả về HTTP {result['status']}.")
        return json.loads(str(result["body"]))
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
