import httpx
import re

with httpx.Client(verify=False, timeout=15.0) as client:
    r_get = client.get("http://dms21.nazzy.vn/")
    vs = re.search(r'id="__VIEWSTATE"\s+value="([^"]+)"', r_get.text).group(1)
    ev = re.search(r'id="__EVENTVALIDATION"\s+value="([^"]+)"', r_get.text).group(1)
    payload = {
        "__VIEWSTATE": vs,
        "__VIEWSTATEGENERATOR": "C2EE9ABB",
        "__EVENTVALIDATION": ev,
        "txtDistributor": "MAITRUNG",
        "txtCode": "admin",
        "txtPassword": "123",
        "btnLogin": "Đăng nhập",
    }
    r = client.post("http://dms21.nazzy.vn/", data=payload)
    for line in r.text.split("\n"):
        if any(k in line.lower() for k in ["alert", "lỗi", "error", "sai", "không đúng", "mật khẩu", "thất bại", "script"]):
            print("Found line:", line.strip())
