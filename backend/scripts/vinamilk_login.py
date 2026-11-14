"""
vinamilk_login.py — Tự động đăng nhập Vinamilk DMS One bằng HTTP client thuần (httpx).

Không phụ thuộc vào Playwright hay Chromium — hoạt động nhẹ, nhanh và ổn định trên mọi môi trường (Render, VPS, Docker, Windows).

Luồng:
  1. Lấy username/password: Database → Environment Variables → .env.local → Windows Credential Manager
  2. Gửi HTTP GET tới https://vinamilk.dmsone.vn/ để khởi tạo session cookie (JSESSIONID)
  3. Gửi HTTP POST tới https://vinamilk.dmsone.vn/login với username/password
  4. Kiểm tra phản hồi: redirect về /home và chứa menu Bán Hàng
  5. Trả về chuỗi Cookie header (JSESSIONID=...; ...)
  6. Lưu vào Database và .env.local để tái sử dụng
"""

import os
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values, set_key

# Khi stdout bị chuyển hướng (Windows, cp1252) print tiếng Việt sẽ ném UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

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


def configure_playwright_browser_path() -> None:
    """Giữ hàm này để tương thích ngược với các file import cũ; không còn cần Playwright."""
    pass


def _load_from_windows_credmgr() -> tuple[str, str] | None:
    """Lấy thông tin đăng nhập từ Windows Credential Manager."""
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
    """Lấy credentials: ưu tiên Database → Environment Variables → .env.local → Windows Credential Manager."""
    try:
        if str(PROJECT_ROOT) not in sys.path:
            sys.path.insert(0, str(PROJECT_ROOT))
        from app.services.vinamilk_credentials import load_db_credentials

        db_creds = load_db_credentials()
        if db_creds:
            return db_creds
    except Exception:
        pass

    values = dotenv_values(env_path) if env_path.exists() else {}
    username = os.environ.get("VINAMILK_USERNAME") or values.get("VINAMILK_USERNAME", "")
    password = os.environ.get("VINAMILK_PASSWORD") or values.get("VINAMILK_PASSWORD", "")
    if (not username or not password) and _HAS_WIN32CRED:
        result = _load_from_windows_credmgr()
        if result:
            return result

    if not username or not password:
        raise RuntimeError(
            "Thiếu tài khoản / mật khẩu Vinamilk DMS. "
            "Admin vui lòng bấm nút 'Tài khoản DMS' trên web để cập nhật."
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


def login_and_get_cookie(
    username_override: str | None = None,
    password_override: str | None = None,
) -> str:
    """
    Đăng nhập Vinamilk DMS One bằng HTTP client thuần (httpx), trả về chuỗi Cookie header.
    Ném RuntimeError nếu đăng nhập thất bại.
    """
    if username_override and password_override:
        username, password = username_override, password_override
    else:
        username, password = load_credentials(ENV_FILE)

    login_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }

    with httpx.Client(timeout=30.0, headers=login_headers, follow_redirects=True) as client:
        # Bước 1: Khởi tạo phiên và lấy token CSRF
        try:
            init_res = client.get(LOGIN_URL)
        except Exception as exc:
            raise RuntimeError(f"Không thể kết nối đến máy chủ Vinamilk DMS: {exc}") from exc

        if init_res.status_code != 200:
            raise RuntimeError(f"Lỗi khi tải trang đăng nhập Vinamilk DMS (HTTP {init_res.status_code})")

        import re
        token_match = re.search(r'name="token"\s+value="([^"]+)"', init_res.text)
        token_val = token_match.group(1) if token_match else None

        # Bước 2: Gửi thông tin đăng nhập kèm token
        login_data = {
            "username": username,
            "password": password,
            "lt": "",
            "_eventId": "submit",
            "submit": "Đăng nhập",
            "loginCount": "",
        }
        if token_val:
            login_data["token"] = token_val

        post_headers = {
            **login_headers,
            "Referer": LOGIN_URL,
            "Origin": "https://vinamilk.dmsone.vn",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        try:
            resp = client.post("https://vinamilk.dmsone.vn/login", data=login_data, headers=post_headers)
        except Exception as exc:
            raise RuntimeError(f"Lỗi gửi yêu cầu đăng nhập: {exc}") from exc

        # Bước 3: Kiểm tra tính hợp lệ của phản hồi
        # Nếu đăng nhập thành công, server redirect 302 -> /home
        if "home" in str(resp.url) or any(r.status_code == 302 for r in resp.history):
            cookies = [f"{k}={v}" for k, v in client.cookies.items() if v]
            if not cookies:
                raise RuntimeError("Đăng nhập thành công nhưng không lấy được cookie phiên.")
            return "; ".join(cookies)

        resp_text = resp.text
        if "không đúng" in resp_text or "kh&ocirc;ng đ&uacute;ng" in resp_text:
            raise RuntimeError("Đăng nhập thất bại: Tên đăng nhập hoặc mật khẩu Vinamilk DMS không đúng.")
        if "Mã bảo vệ" in resp_text or "capcha" in resp_text.lower():
            raise RuntimeError("Đăng nhập yêu cầu mã bảo vệ CAPTCHA. Vui lòng đăng nhập trên trình duyệt một lần để mở khóa.")

        if "Bán Hàng" not in resp_text and "424" not in resp_text:
            raise RuntimeError(f"Đăng nhập không thành công, URL phản hồi: {resp.url}")

        cookies = [f"{k}={v}" for k, v in client.cookies.items() if v]
        if not cookies:
            raise RuntimeError("Đăng nhập thành công nhưng không lấy được cookie phiên.")

        cookie_header = "; ".join(cookies)
        return cookie_header


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
