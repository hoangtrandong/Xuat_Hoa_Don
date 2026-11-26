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
                {
                    "ProductId": -1,
                    "ProductName": "Chiết khấu",
                    "PromotionName": "Hỗ trợ bán hàng tháng 10",
                    "Price": 24000,
                },
                {
                    "ProductId": 99,
                    "ProductCode": "GIFT001",
                    "ProductName": "Hàng tặng",
                    "PromotionName": "Chương trình bán hàng sữa nước",
                    "UnitName": "Hộp",
                    "Amount": 6,
                    "PromotionAmount": 1,
                    "Price": 99768,
                },
            ],
        })


def test_nazzy_order_discount_is_separate_line_and_product_promotions_are_zero_value(monkeypatch):
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
    assert [(item.product_name, item.quantity, item.unit_price, item.line_total, item.discount_amount) for item in order.items] == [
        ("Thức uống ngũ cốc ăn kiêng", 12, 396000, 4752000, 0),
        ("Sữa hạt ngũ cốc dinh dưỡng", 240, 360000, 86400000, 0),
        ("Chiết khấu", 0, 0, 0, 24000),
        ("Hàng tặng (Hàng KM không thu tiền)", 0, 0, 0, 0),
    ]
    assert order.items[2].promotion_name == "Hỗ trợ bán hàng tháng 10"
    assert order.items[2].unit == ""
    assert order.items[3].promo_quantity == 6
    assert order.items[3].line_total == 0
    assert order.items[3].promotion_name == "Chương trình bán hàng sữa nước"


def test_persist_nazzy_orders_removes_stale_duplicate_lines_on_resync(monkeypatch):
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool
    import app.models  # noqa: F401
    from app.core.database import Base
    from app.models.vinamilk import VinamilkOrderSnapshot
    from app.services.supplier_connectors import persist_canonical_orders_to_snapshots

    monkeypatch.setattr("app.services.supplier_connectors.httpx.Client", FakeClient)
    config = SimpleNamespace(
        api_endpoint_url="http://dms21.nazzy.vn/handler/BillsHandler.ashx",
        request_config={},
        username=None,
        encrypted_secret=None,
        session_cookie=None,
    )
    raw_rows = fetch_nazzy_orders(config, date(2026, 11, 16), date(2026, 11, 16), strict=True)
    orders = DynamicFieldMapper.transform_rows_to_canonical(
        raw_rows, "NAZZY", SUPPLIER_FIELD_MAPPING_PRESETS["NAZZY"]["field_mapping"]
    )

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        # Giả lập dòng cũ từ lần đồng bộ trước (remote_key cũ ở line_idx khác)
        db.add(VinamilkOrderSnapshot(
            remote_key="old-stale-remote-key-for-gift",
            order_number="26113454",
            customer_code="KH-NAZZY",
            product_code="GIFT001",
            product_name="Hàng tặng (cũ)",
            processing_status="NCC:NAZZY",
            performed_by="NPP-MAIGOLD",
            is_synthetic=False,
            order_created_date=date(2026, 11, 16),
            synced_from=date(2026, 11, 16),
            synced_to=date(2026, 11, 16),
            raw_payload={"Số đơn hàng": "26113454", "Mã sản phẩm": "GIFT001"},
        ))
        db.commit()

        persist_canonical_orders_to_snapshots(db, orders, distributor_code="NPP-MAIGOLD")
        snaps = db.scalars(
            select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == "26113454")
        ).all()
        assert len(snaps) == 4
        assert all(s.remote_key != "old-stale-remote-key-for-gift" for s in snaps)
        ck_snap = next(s for s in snaps if s.product_code == "CHIETKHAU")
        assert ck_snap.raw_payload["ĐVT"] == ""
        assert ck_snap.raw_payload["Tên CTKM"] == "Hỗ trợ bán hàng tháng 10"
    engine.dispose()


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


def test_nazzy_session_expired_html_triggers_relogin(monkeypatch):
    calls = {"list": 0, "relogin": 0}

    class ExpiringClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def get(self, _url, *, params, **_kwargs):
            if params["t"] == "GetBillsOrderGetListV5":
                calls["list"] += 1
                if calls["list"] == 1:
                    return SimpleNamespace(
                        status_code=200,
                        text="<html><body><input id='txtPassword'/><input id='btnLogin'/></body></html>",
                    )
                return FakeResponse({
                    "Items": {
                        "TotalRecord": 1,
                        "Items": [{"BillsDepotId": 10, "Code": "26113454"}],
                    }
                })
            return FakeClient().get(_url, params=params)

    def fake_login(_dist, _user, _pwd, _base):
        calls["relogin"] += 1
        return "ASP.NET_SessionId=fresh; ses_adminId=1"

    monkeypatch.setattr("app.services.supplier_connectors.httpx.Client", ExpiringClient)
    monkeypatch.setattr("app.services.supplier_connectors.nazzy_login_and_get_cookie", fake_login)
    monkeypatch.setattr("app.services.supplier_connectors.decrypt_supplier_secret", lambda v: v or "")
    monkeypatch.setattr("app.services.supplier_connectors.encrypt_supplier_secret", lambda v: v or "")

    config = SimpleNamespace(
        api_endpoint_url="http://dms21.nazzy.vn/handler/BillsHandler.ashx",
        request_config={"distributor_code": "MAITRUNG"},
        username="NV01",
        encrypted_secret="secret123",
        session_cookie="ASP.NET_SessionId=expired",
    )

    rows = fetch_nazzy_orders(config, date(2026, 11, 16), date(2026, 11, 16), strict=True)
    assert len(rows) == 4
    assert calls["list"] == 2
    assert calls["relogin"] == 2


def test_grouped_orders_paginates_all_pages_and_includes_nazzy_for_maigold(monkeypatch):
    from app.api.v1.endpoints import sync as sync_ep

    page_calls = []

    def fake_list_local(*, skip, limit, distributor_code, **_kwargs):
        page_calls.append((skip, limit, distributor_code))
        if skip == 0:
            # Trang 1: toàn đơn Vinamilk (bị giới hạn 10_000 dòng SQL, nhưng sau lọc chỉ còn 1 dòng)
            return {
                "rows": [{
                    "_local_id": 1,
                    "_snapshot_order_number": "VNM-001",
                    "_distributor_code": "NPP-MAIGOLD",
                    "NPP": "Nhà Phân Phối Mai Gold",
                    "Nguồn đồng bộ": "VINAMILK",
                    "Nhà cung cấp": "Vinamilk",
                    "totalValue": 100000,
                    "totalDiscount": 0,
                }],
                "total": 1,
                "snapshot_total": 1,
                "snapshot_count": 1,
                "raw_snapshot_total": 2,
                "raw_snapshot_count": 1,
                "last_synced_at": None,
            }
        # Trang 2: đơn Nazzy nằm sau trang 1
        return {
            "rows": [{
                "_local_id": 2,
                "_snapshot_order_number": "NAZ-001",
                "_distributor_code": "NPP-MAIGOLD",
                "NPP": "Nhà Phân Phối Mai Gold",
                "Nguồn đồng bộ": "NAZZY",
                "Nhà cung cấp": "Việt Đài",
                "_processing_status": "NCC:NAZZY",
                "totalValue": 250000,
                "totalDiscount": 0,
            }],
            "total": 1,
            "snapshot_total": 1,
            "snapshot_count": 1,
            "raw_snapshot_total": 2,
            "raw_snapshot_count": 1,
            "last_synced_at": None,
        }

    monkeypatch.setattr(sync_ep, "list_local_vinamilk_orders", fake_list_local)

    result = sync_ep.list_grouped_vinamilk_orders(
        from_date=date(2026, 11, 1),
        to_date=date(2026, 11, 22),
        distributor_code="NPP-MAIGOLD",
        skip=0,
        limit=20,
        db=None,
        current_user=None,
    )

    assert len(page_calls) == 2
    order_nums = {row["orderNumber"] for row in result["rows"]}
    assert order_nums == {"VNM-001", "NAZ-001"}
    assert "NAZZY" in result["suppliers"]
