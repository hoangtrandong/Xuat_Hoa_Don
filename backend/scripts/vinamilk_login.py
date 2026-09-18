"""
vinamilk_login.py — Tự động đăng nhập Vinamilk DMS One bằng Playwright.

Chạy:  python backend/scripts/vinamilk_login.py
Yêu cầu:  pip install playwright python-dotenv  &&  playwright install chromium

Luồng:
  1. Lấy username/password: Environment Variables → Windows Credential Manager → .env.local
  2. Mở Chromium headless → truy cập https://vinamilk.dmsone.vn/
  3. Điền username/password → click nút Đăng nhập
  4. Đợi menu "Bán Hàng" xuất hiện (đảm bảo đăng nhập thành công)
  5. Lấy toàn bộ cookies → tạo chuỗi Cookie header (JSESSIONID=...; _ga=...; ...)
  6. Khi chạy độc lập, ghi cookie vào .env.local; backend dùng trực tiếp giá trị trả về
"""

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from dotenv import dotenv_values, set_key

# win32cred chỉ có sẵn trên Windows — thử import, nếu lỗi thì bỏ qua (Linux/Render)
try:
    import win32cred
    _HAS_WIN32CRED = True
except ImportError:
    win32cred = None
    _HAS_WIN32CRED = False


# ---- Cấu hình ----
PROJECT_ROOT = Path(__file__).resolve().parent.parent       # thư mục backend/
ENV_FILE = PROJECT_ROOT / ".env.local"
LOGIN_URL = "https://vinamilk.dmsone.vn/"

# Tên "Generic Credential" trong Windows Credential Manager
CREDENTIAL_TARGET = "vinamilk_account"

LOGIN_TIMEOUT = 30_000
MENU_TIMEOUT = 15_000


def _load_from_windows_credmgr() -> tuple[str, str] | None:
    """Lấy thông tin đăng nhập từ Windows Credential Manager (giống script cũ)."""
    if not _HAS_WIN32CRED:
        return None
    try:
        creds = win32cred.CredRead(CREDENTIAL_TARGET, 1, 0)
        username = creds["UserName"]
        blob = creds["CredentialBlob"]
        try:
            password = blob.decode("utf-16")
        except (UnicodeDecodeError, AttributeError):
            password = blob.decode("utf-8") if isinstance(blob, bytes) else str(blob)
        if username and password:
            return username, password
    except Exception:
        pass
    return None


def load_credentials(env_path: Path) -> tuple[str, str]:
    """Lấy credentials portable cho Render/Linux và local Windows."""
    values = dotenv_values(env_path)
    username = os.environ.get("VINAMILK_USERNAME") or values.get("VINAMILK_USERNAME", "")
    password = os.environ.get("VINAMILK_PASSWORD") or values.get("VINAMILK_PASSWORD", "")
    if (not username or not password) and _HAS_WIN32CRED:
        result = _load_from_windows_credmgr()
        if result:
            return result

    if not username or not password:
        raise RuntimeError(
            "Thiếu VINAMILK_USERNAME / VINAMILK_PASSWORD. "
            f"Trên Windows có thể dùng Generic Credential '{CREDENTIAL_TARGET}'."
        )
    return username, password


def build_cookie_header(cookies: list[dict]) -> str:
    """Chuyển danh sách cookie dict thành chuỗi Cookie header."""
    parts = []
    for c in cookies:
        name = c.get("name", "")
        value = c.get("value", "")
        if name and value:
            parts.append(f"{name}={value}")
    return "; ".join(parts)


def login_and_get_cookie() -> str:
    """
    Mở Chromium headless, đăng nhập Vinamilk DMS One, trả về chuỗi Cookie header.
    Ném RuntimeError nếu đăng nhập thất bại.
    """
    username, password = load_credentials(ENV_FILE)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])

        try:
            context = browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = context.new_page()

            print(f"[vinamilk_login] Mở trang: {LOGIN_URL}")
            page.goto(LOGIN_URL, wait_until="networkidle")
            time.sleep(2)  # chờ JS render form

            # ---- Bước 1: Điền thông tin đăng nhập ----
            try:
                username_input = page.wait_for_selector(
                    "input#username, input#UserName, input[type='text']",
                    timeout=LOGIN_TIMEOUT,
                )
                page.evaluate(
                    "(el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }",
                    username_input,
                    username,
                )

                password_input = page.wait_for_selector(
                    "input#password, input#Password, input[type='password']",
                    timeout=LOGIN_TIMEOUT,
                )
                page.evaluate(
                    "(el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }",
                    password_input,
                    password,
                )

                print("[vinamilk_login] Điền thông tin. Click nút Đăng nhập...")
                page.click(
                    "input#btnLogin, input[type='submit'], button:has-text('Đăng nhập')",
                    timeout=LOGIN_TIMEOUT,
                )

            except PlaywrightTimeoutError:
                # Có thể đã đăng nhập từ lần truy cập trước (session cookie còn hạn)
                print("[vinamilk_login] Không tìm thấy form login — có thể đã đăng nhập sẵn.")

            # ---- Bước 2: Đợi menu "Bán Hàng" hiện ra ----
            try:
                page.wait_for_selector('//*[@id="424"]/a', timeout=MENU_TIMEOUT)
                print("[vinamilk_login] Đăng nhập thành công — menu 'Bán Hàng' đã xuất hiện.")
            except PlaywrightTimeoutError:
                raise RuntimeError(
                    "Đăng nhập thất bại — không thấy menu 'Bán Hàng' sau thời gian chờ. "
                    "Kiểm tra lại thông tin đăng nhập hoặc CAPTCHA."
                )

            # ---- Bước 3: Lấy toàn bộ cookies ----
            cookies = context.cookies()
            if not cookies:
                raise RuntimeError("Không lấy được cookie nào sau khi đăng nhập.")

            cookie_header = build_cookie_header(cookies)
            print(f"[vinamilk_login] Đã lấy {len(cookies)} cookie(s).")
            print(f"[vinamilk_login] Cookie header (ẩn giấu): {cookie_header[:60]}...")

            return cookie_header

        finally:
            browser.close()


def save_cookie_to_env(cookie_header: str, env_path: Path) -> None:
    """Ghi cookie vào .env.local, giữ nguyên các biến khác."""
    set_key(
        str(env_path),
        "VINAMILK_SESSION_COOKIE",
        cookie_header,
        quote_mode="never",
    )
    print(f"[vinamilk_login] Đã lưu VINAMILK_SESSION_COOKIE vào {env_path}")


def main() -> int:
    if not ENV_FILE.exists():
        print(f"[vinamilk_login] File {ENV_FILE} không tồn tại. Tạo file mẫu...")
        ENV_FILE.write_text(
            "# Cookie phiên đăng nhập DMS One (tự động cập nhật bởi vinamilk_login.py)\n"
            "VINAMILK_SESSION_COOKIE=\n",
            encoding="utf-8",
        )

    try:
        cookie = login_and_get_cookie()
        save_cookie_to_env(cookie, ENV_FILE)
        print("[vinamilk_login] Hoàn tất.")
        return 0
    except Exception as e:
        print(f"[vinamilk_login] Lỗi: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())