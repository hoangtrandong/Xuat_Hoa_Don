from datetime import date
from types import SimpleNamespace

from app.services.supplier_connectors import (
    DynamicFieldMapper,
    SUPPLIER_FIELD_MAPPING_PRESETS,
    fetch_nazzy_orders,
)
from app.services.einvoice_gateway import _allocate_order_discounts


class FakeResponse:
    status_code = 200

    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


class FakeClient:
    def __init__(self, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, _url, *, params, **_kwargs):
        if params["t"] == "GetBillsOrderGetListV5":
            return FakeResponse({
                "Items": {
                    "TotalRecord": 1,
                    "Items": [{"BillsDepotId": 10, "Code": "26113454"}],
                },
            })
        return FakeResponse({
            "Info": {
                "Code": "26113454",
                "BillsDate": "2026-11-16T00:00:00",
                "TotalPrice": 91128000,
                "Discount": 0,
                "DiscountPromotion": 24000,
            },
            "Details": [
                {
                    "ProductCode": "NCNAK180-001",
                    "ProductName": "Thức uống ngũ cốc ăn kiêng",
                    "UnitName": "Thùng",
                    "Amount": 12,
                    "PriceNow": 396000,
                    "TotalPrice": 4752000,
                    "Discount": 0,
                },
                {
                    "ProductCode": "NCNSHDD180-001",
                    "ProductName": "Sữa hạt ngũ cốc dinh dưỡng",
                    "UnitName": "Thùng",
                    "Amount": 240,
                    "PriceNow": 360000,
                    "TotalPrice": 86400000,
                    "Discount": 0,
                },
            ],
            "Promotion": [
                {"ProductId": -1, "Price": 24000},
                {
                    "ProductId": 99,
                    "ProductCode": "GIFT001",
                    "ProductName": "Hàng tặng",
                    "UnitName": "Hộp",
                    "Amount": 6,
                    "PromotionAmount": 1,
                    "Price": 0,
                },
            ],
        })


def test_nazzy_order_discount_is_allocated_and_product_promotions_are_counted(monkeypatch):
    monkeypatch.setattr("app.services.supplier_connectors.httpx.Client", FakeClient)
    config = SimpleNamespace(
        api_endpoint_url="http://dms21.nazzy.vn/handler/BillsHandler.ashx",
        request_config={},
        username=None,
        encrypted_secret=None,
        session_cookie=None,
    )

    raw_rows = fetch_nazzy_orders(config, date(2026, 11, 16), date(2026, 11, 16), strict=True)
    order = DynamicFieldMapper.transform_rows_to_canonical(
        raw_rows,
        "NAZZY",
        {
            **SUPPLIER_FIELD_MAPPING_PRESETS["NAZZY"]["field_mapping"],
            "quantity": "Quantity",
            "unit_price": "Price",
        },
    )[0]

    assert order.order_discount == 24000
    assert [(item.quantity, item.unit_price, item.line_total, item.discount_amount) for item in order.items] == [
        (12, 396000, 4750749, 1251),
        (240, 360000, 86377251, 22749),
        (0, 0, 0, 0),
    ]
    assert order.items[2].promo_quantity == 6


def test_invoice_discount_allocation_preserves_order_discount_total():
    rows = [
        SimpleNamespace(
            id=1,
            order_number="26113454",
            raw_payload={
                "Số lượng": 12,
                "Giá bán": 396000,
                "Giá trị": 4752000,
                "Chiết khấu đơn hàng": 24000,
            },
        ),
        SimpleNamespace(
            id=2,
            order_number="26113454",
            raw_payload={
                "Số lượng": 240,
                "Giá bán": 360000,
                "Giá trị": 86400000,
                "Chiết khấu đơn hàng": 24000,
            },
        ),
    ]

    allocations = _allocate_order_discounts(rows)

    assert allocations == {1: 1251, 2: 22749}
    assert sum(allocations.values()) == 24000


def test_invoice_discount_allocation_does_not_duplicate_line_discounts():
    rows = [
        SimpleNamespace(
            id=1,
            order_number="26113454",
            raw_payload={
                "Số lượng": 12,
                "Giá bán": 396000,
                "Giá trị": 4752000,
                "Số tiền CK": 1251,
                "Chiết khấu đơn hàng": 24000,
            },
        ),
        SimpleNamespace(
            id=2,
            order_number="26113454",
            raw_payload={
                "Số lượng": 240,
                "Giá bán": 360000,
                "Giá trị": 86400000,
                "Số tiền CK": 22749,
                "Chiết khấu đơn hàng": 24000,
            },
        ),
    ]

    assert _allocate_order_discounts(rows) == {}
