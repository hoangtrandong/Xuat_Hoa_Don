"""Tests for Gấu Đỏ (AsiaFoods - sales.asiafoods.vn) supplier connector and CMD cURL parser."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.supplier_connectors import (
    SUPPLIER_FIELD_MAPPING_PRESETS as SUPPLIER_PRESETS,
    DynamicFieldMapper,
    asiafoods_login_and_get_cookie,
    fetch_asiafoods_orders,
    parse_curl_command,
)


def test_parse_windows_cmd_curl_for_asiafoods():
    cmd_curl = (
        'curl --url ^"https://sales.asiafoods.vn/sale-product/search-sale/search^" ^\n'
        '  -H ^"Accept: application/json, text/javascript, */*; q=0.01^" ^\n'
        '  -b ^"JSESSIONID=8040B0C1D38825A07206126534121A05-n1^" ^\n'
        '  --data-raw ^"orderNumber=^&fromDate=17^%^2F11^%^2F2026^&toDate=29^%^2F11^%^2F2026^&lstShopId=3001^&orderType=IN^&page=1^&rows=20^"'
    )
    parsed = parse_curl_command(cmd_curl)
    assert parsed["url"] == "https://sales.asiafoods.vn/sale-product/search-sale/search"
    assert "JSESSIONID=8040B0C1D38825A07206126534121A05-n1" in parsed["cookies"]
    assert parsed["params"]["lstShopId"] == "3001"
    assert parsed["params"]["fromDate"] == "17/11/2026"
    assert parsed["params"]["toDate"] == "29/11/2026"
    assert parsed["params"]["orderType"] == "IN"


def test_fetch_asiafoods_orders_and_canonical_mapping():
    search_response = MagicMock(
        status_code=200,
        headers={"content-type": "application/json;charset=UTF-8"},
    )
    search_response.json.return_value = {
        "total": 1,
        "page": 1,
        "rows": [
            {
                "id": 13949179487973951,
                "orderNumber": "IN148605",
                "refOrderNumber": "V1261687973951",
                "orderDate": "2026-11-17T08:42:19",
                "deliveryDate": "2026-11-17T08:42:00",
                "customerCode": "1305277",
                "customerName": "Hiền Thịnh",
                "address": "Xóm 3, Xã Đô Lương, Tỉnh Nghệ An",
                "shopCode": "12528",
                "staffCode": "E-16503",
                "staffName": "Nguyễn Đình Đài",
                "deliveryCode": "12528G003",
                "deliveryName": "ANh Dụng",
                "totalDiscount": 15000,
                "totalValue": 760000,
            }
        ],
    }

    detail_response = MagicMock(
        status_code=200,
        headers={"content-type": "application/json;charset=UTF-8"},
    )
    detail_response.json.return_value = {
        "saleOrder": {"orderNumber": "IN148605", "customer": {"taxCode": "2901234567"}},
        "sale_order_lot": [
            {
                "productCode": "900001013",
                "productName": "Cháo Gấu Đỏ 50 gói HV Thịt Bằm",
                "uom1": "GOI",
                "convfact": 50,
                "quantity": 50,
                "price": 3100,
                "amount": 155000,
                "discountAmount": 3000,
                "isFreeItem": 0,
                "promotionZV": "TB196_CKDH_CGD_130988",
            },
            {
                "productCode": "900001014",
                "productName": "Cháo Gấu Đỏ 50 gói HV Thịt Gà",
                "uom1": "GOI",
                "convfact": 50,
                "quantity": 150,
                "price": 3100,
                "amount": 465000,
                "discountAmount": 9000,
                "isFreeItem": 0,
                "promotionZV": "TB196_CKDH_CGD_130988",
            },
            {
                "productCode": "900001018",
                "productName": "Cháo Gấu Đỏ 50 gói HV Chay",
                "uom1": "GOI",
                "convfact": 50,
                "quantity": 50,
                "price": 3100,
                "amount": 155000,
                "discountAmount": 3000,
                "isFreeItem": 0,
                "promotionZV": "TB196_CKDH_CGD_130988",
            },
        ],
        "order_detail_promotion": [
            {
                "productCode": "900001099",
                "productName": "Mì Gấu Đỏ Tặng",
                "uom1": "GOI",
                "quantity": 10,
                "price": 0,
                "amount": 0,
                "isFreeItem": 1,
            }
        ],
    }

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.__exit__.return_value = None
    mock_client.post.return_value = search_response
    mock_client.get.return_value = detail_response

    cfg = SimpleNamespace(
        supplier_code="GAUDO",
        supplier_name="Gấu Đỏ (AsiaFoods DMS)",
        api_endpoint_url="https://sales.asiafoods.vn/sale-product/search-sale/search",
        encrypted_secret="",
        session_cookie="JSESSIONID=8040B0C1D38825A07206126534121A05-n1",
        request_config={"lstShopId": "3001"},
        field_mapping=SUPPLIER_PRESETS["GAUDO"]["field_mapping"],
    )

    with patch("app.services.supplier_connectors.httpx.Client", return_value=mock_client):
        raw_rows = fetch_asiafoods_orders(cfg, date(2026, 11, 17), date(2026, 11, 29), strict=True)

    assert len(raw_rows) == 4
    canonical = DynamicFieldMapper.transform_rows_to_canonical(
        raw_rows=raw_rows,
        supplier_code="GAUDO",
        field_mapping=SUPPLIER_PRESETS["GAUDO"]["field_mapping"],
        distributor_code="NPP01",
    )
    assert len(canonical) == 1
    ord_obj = canonical[0]
    assert ord_obj.order_number == "IN148605"
    assert ord_obj.customer_code == "1305277"
    assert ord_obj.customer_name == "Hiền Thịnh"
    assert ord_obj.staff_code == "E-16503"
    assert ord_obj.staff_name == "Nguyễn Đình Đài"
    assert len(ord_obj.items) == 4
    paid_total = sum(it.line_total for it in ord_obj.items)
    assert paid_total == 760000
    promo_line = next(it for it in ord_obj.items if it.product_code == "900001099")
    assert promo_line.quantity == 0
    assert promo_line.promo_quantity == 10


def test_asiafoods_login_and_get_cookie():
    get_resp = MagicMock(
        status_code=200,
        text='<form action="/login"><input name="lt" value="LT-123"/><input name="_eventId" value="submit"/></form>',
    )
    post_resp = MagicMock(
        status_code=200,
        url="https://sales.asiafoods.vn/home",
        text="<html><body>Dashboard</body></html>",
    )
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.__exit__.return_value = None
    mock_client.get.return_value = get_resp
    mock_client.post.return_value = post_resp
    mock_client.cookies = {"JSESSIONID": "NEW-SESSION-999"}

    with patch("app.services.supplier_connectors.httpx.Client", return_value=mock_client):
        cookie = asiafoods_login_and_get_cookie("user_gd", "pass_gd", "https://sales.asiafoods.vn")
    assert cookie == "JSESSIONID=NEW-SESSION-999"
    posted_data = mock_client.post.call_args.kwargs["data"]
    assert posted_data["username"] == "user_gd"
    assert posted_data["password"] == "pass_gd"
    assert posted_data["lt"] == "LT-123"
