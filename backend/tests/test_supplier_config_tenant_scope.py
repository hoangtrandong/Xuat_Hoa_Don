from io import BytesIO
from types import SimpleNamespace

import httpx
from openpyxl import Workbook
import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.multi_tenant_einvoice import _ensure_user_can_access_supplier_config
from app.services.supplier_connectors import fetch_vinamilk_orders


def _user(distributor_id: int | None, username: str = "tenant-user", roles=None):
    return SimpleNamespace(
        distributor_id=distributor_id,
        username=username,
        roles=roles or [],
    )


def test_supplier_config_scope_allows_own_distributor():
    _ensure_user_can_access_supplier_config(_user(2), 2)


def test_supplier_config_scope_rejects_another_distributor():
    with pytest.raises(HTTPException) as exc_info:
        _ensure_user_can_access_supplier_config(_user(2), 3)

    assert exc_info.value.status_code == 403


def test_supplier_config_scope_rejects_unassigned_non_admin():
    with pytest.raises(HTTPException) as exc_info:
        _ensure_user_can_access_supplier_config(_user(None), 2)

    assert exc_info.value.status_code == 403


def test_supplier_config_scope_allows_system_admin():
    admin = _user(None, username="admin")
    _ensure_user_can_access_supplier_config(admin, 2)


def _vinamilk_workbook() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Số đơn hàng", "Mã sản phẩm", "Số lượng"])
    sheet.append(["SO-001", "SKU-001", 12])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_vinamilk_accepts_direct_excel_export(monkeypatch):
    response = httpx.Response(
        200,
        content=_vinamilk_workbook(),
        headers={"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        request=httpx.Request("POST", "https://vinamilk.dmsone.vn/export"),
    )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.cookies = httpx.Cookies()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            return response

    monkeypatch.setattr("app.services.supplier_connectors.httpx.Client", FakeClient)
    config = SimpleNamespace(
        session_cookie="JSESSIONID=old",
        username="user",
        encrypted_secret="password",
    )

    rows = fetch_vinamilk_orders(
        config,
        from_date=__import__("datetime").date(2026, 1, 1),
        to_date=__import__("datetime").date(2026, 1, 2),
    )

    assert rows == [{"Số đơn hàng": "SO-001", "Mã sản phẩm": "SKU-001", "Số lượng": 12}]


def test_vinamilk_reauthenticates_when_export_returns_login_html(monkeypatch):
    html_response = httpx.Response(
        200,
        text="<html>Đăng nhập</html>",
        headers={"content-type": "text/html"},
        request=httpx.Request("POST", "https://vinamilk.dmsone.vn/login"),
    )
    json_response = httpx.Response(
        200,
        json={"path": "/exports/orders.xlsx"},
        request=httpx.Request("POST", "https://vinamilk.dmsone.vn/export"),
    )
    excel_response = httpx.Response(
        200,
        content=_vinamilk_workbook(),
        request=httpx.Request("GET", "https://vinamilk.dmsone.vn/exports/orders.xlsx"),
    )

    class FakeClient:
        calls = 0

        def __init__(self, *args, **kwargs):
            self.cookies = httpx.Cookies()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            FakeClient.calls += 1
            return html_response if FakeClient.calls == 1 else json_response

        def get(self, *args, **kwargs):
            return excel_response

    monkeypatch.setattr("app.services.supplier_connectors.httpx.Client", FakeClient)
    monkeypatch.setattr(
        "scripts.vinamilk_login.login_and_get_cookie",
        lambda username, password: "JSESSIONID=fresh",
    )
    config = SimpleNamespace(
        session_cookie="JSESSIONID=expired",
        username="user",
        encrypted_secret="password",
    )

    rows = fetch_vinamilk_orders(
        config,
        from_date=__import__("datetime").date(2026, 1, 1),
        to_date=__import__("datetime").date(2026, 1, 2),
    )

    assert config.session_cookie == "JSESSIONID=fresh"
    assert rows[0]["Số đơn hàng"] == "SO-001"
