import httpx
import re

def test_nazzy_login(distributor: str, user_code: str, password: str):
    base_url = "http://dms21.nazzy.vn"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    with httpx.Client(verify=False, timeout=15.0, follow_redirects=False) as client:
        # Bước 1: GET trang chủ lấy token ASP.NET
        r_get = client.get(f"{base_url}/", headers=headers)
        html = r_get.text
        
        vs_m = re.search(r'id="__VIEWSTATE"\s+value="([^"]+)"', html)
        vsg_m = re.search(r'id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"', html)
        ev_m = re.search(r'id="__EVENTVALIDATION"\s+value="([^"]+)"', html)
        
        viewstate = vs_m.group(1) if vs_m else ""
        viewstategen = vsg_m.group(1) if vsg_m else ""
        eventval = ev_m.group(1) if ev_m else ""
        
        print("Got ASP.NET tokens:")
        print("  ViewState len:", len(viewstate))
        print("  ViewStateGen:", viewstategen)
        print("  EventVal len:", len(eventval))
        print("  Initial cookies:", dict(client.cookies))
        
        # Bước 2: POST form đăng nhập
        payload = {
            "__VIEWSTATE": viewstate,
            "__VIEWSTATEGENERATOR": viewstategen,
            "__EVENTVALIDATION": eventval,
            "txtDistributor": distributor,
            "txtCode": user_code,
            "txtPassword": password,
            "btnLogin": "Đăng nhập",
        }
        
        post_headers = {
            **headers,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": f"{base_url}/",
            "Origin": base_url,
        }
        
        r_post = client.post(f"{base_url}/", data=payload, headers=post_headers)
        print("POST Response status:", r_post.status_code)
        print("POST Response location:", r_post.headers.get("Location"))
        print("POST Response cookies:", dict(client.cookies))
        if r_post.status_code == 200:
            # Tìm thông báo lỗi trong html nếu có
            err_m = re.search(r'alert\(["\']([^"\']+)["\']\)', r_post.text)
            if err_m:
                print("Alert error:", err_m.group(1))
            msg_m = re.search(r'<span[^>]+id="[^"]*lbl[^"]*"[^>]*>([^<]+)</span>', r_post.text, re.IGNORECASE)
            if msg_m:
                print("Span message:", msg_m.group(1))

test_nazzy_login("MAITRUNG", "admin", "wrong_pass_test")
