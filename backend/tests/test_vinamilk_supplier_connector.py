from datetime import date
from io import BytesIO
from types import SimpleNamespace

from openpyxl import Workbook

from app.services.supplier_connectors import RestApiSupplierConnector


class FakeResponse:
    def __init__(self, status_code, *, data=None, content=b""):
        self.status_code = status_code
        self._data = data
        self.content = content

    def json(self):
        return self._data


class FakeClient:
    instance = None

    def __init__(self, **_kwargs):
        self.cookies = {}
        self.post_calls = []
        self.responses = [
            FakeResponse(403),
            FakeResponse(200, data={"path": "/exports/orders.xlsx"}),
        ]
        self.download_response = FakeResponse(200, content=_build_workbook())
        FakeClient.instance = self

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def post(self, url, *, data):
        self.post_calls.append((url, data.copy(), self.cookies.copy()))
        return self.responses.pop(0)

    def get(self, url):
        assert url == "https://vinamilk.dmsone.vn/exports/orders.xlsx"
        return self.download_response


def _build_workbook():
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["Số đơn hàng", "Tên sản phẩm", "Số lượng"])
    worksheet.append(["VM-001", "Sữa tươi", 4])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_vinamilk_connector_logs_in_and_retries_expired_session(monkeypatch):
    logins = []

    def fake_login(username, password):
        logins.append((username, password))
        return "JSESSIONID=fresh"

    monkeypatch.setattr("scripts.vinamilk_login.login_and_get_cookie", fake_login)
    monkeypatch.setattr("app.services.supplier_connectors.httpx.Client", FakeClient)
    config = SimpleNamespace(
        supplier_code="VINAMILK",
        api_endpoint_url="https://vinamilk.dmsone.vn/sale-product/search-sale/search",
        username="dms-user",
        encrypted_secret="dms-password",
        session_cookie="JSESSIONID=expired",
    )

    rows = RestApiSupplierConnector().fetch_raw_orders(
        config,
        date(2026, 11, 17),
        date(2026, 11, 18),
        allow_sample_fallback=False,
    )

    assert logins == [("dms-user", "dms-password")]
    assert len(FakeClient.instance.post_calls) == 2
    assert FakeClient.instance.post_calls[0][0].endswith("/export-excel")
    assert FakeClient.instance.post_calls[1][2] == {"JSESSIONID": "fresh"}
    assert FakeClient.instance.post_calls[1][1]["fromDate"] == "17/11/2026"
    assert FakeClient.instance.post_calls[1][1]["toDate"] == "18/11/2026"
    assert config.session_cookie == "JSESSIONID=fresh"
    assert rows == [{"Số đơn hàng": "VM-001", "Tên sản phẩm": "Sữa tươi", "Số lượng": 4}]
