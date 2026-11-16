import httpx
import re

def nazzy_login_and_get_cookie(distributor_code: str, username: str, password: str, base_url: str = 'http://dms21.nazzy.vn') -> str:
    clean_base = base_url.rstrip('/').split('/handler')[0].split('/Pages')[0]
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
    with httpx.Client(verify=False, timeout=20.0, follow_redirects=False) as client:
        r_get = client.get(f'{clean_base}/', headers=headers)
        html = r_get.text
        vs_m = re.search(r'id="__VIEWSTATE"\s+value="([^"]+)"', html)
        vsg_m = re.search(r'id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"', html)
        ev_m = re.search(r'id="__EVENTVALIDATION"\s+value="([^"]+)"', html)
        viewstate = vs_m.group(1) if vs_m else ''
        viewstategen = vsg_m.group(1) if vsg_m else 'C2EE9ABB'
        eventval = ev_m.group(1) if ev_m else ''
        payload = {
            '__VIEWSTATE': viewstate,
            '__VIEWSTATEGENERATOR': viewstategen,
            '__EVENTVALIDATION': eventval,
            'txtDistributor': distributor_code.strip(),
            'txtCode': username.strip(),
            'txtPassword': password.strip(),
            'btnLogin': 'Đăng nhập',
        }
        post_headers = {
            **headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': f'{clean_base}/',
            'Origin': clean_base,
        }
        r_post = client.post(f'{clean_base}/', data=payload, headers=post_headers)
        cookies = [f'{k}={v}' for k, v in client.cookies.items() if v]
        has_auth_cookie = any('ses_adminId' in c or 'ses_disId' in c or 'ses_adminName' in c for c in cookies)
        if r_post.status_code in (302, 301) or has_auth_cookie:
            return '; '.join(cookies)
        err_msg = ''
        msg_m = re.search(r'<span[^>]+id="[^"]*lbMessage[^"]*"[^>]*>(?:<font[^>]*>)?([^<]+)', r_post.text, re.IGNORECASE)
        if msg_m:
            err_msg = msg_m.group(1).strip()
        raise RuntimeError(err_msg or 'Nazzy DMS từ chối đăng nhập. Vui lòng kiểm tra lại Mã DN, Mã NV và Mật khẩu.')

try:
    nazzy_login_and_get_cookie('MAITRUNG', 'admin', 'test_password_123')
except Exception as e:
    print('Caught expected error from Nazzy DMS:', e)
