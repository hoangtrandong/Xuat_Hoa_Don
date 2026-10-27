from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.models.vinamilk import VinamilkOrderReplacement, VinamilkOrderSnapshot
from app.services.vinamilk_sales_summary import build_sales_summary

D1, D2 = date(2026, 9, 30), date(2026, 10, 1)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    VinamilkOrderSnapshot.__table__.create(engine)
    VinamilkOrderReplacement.__table__.create(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def line(
    db,
    order,
    day,
    sku="SKU1",
    qty=10,
    value=1000,
    warehouse=True,
    returned=None,
    customer="C1",
    promotion_code=None,
    promotion_name=None,
    promotion_alias=False,
):
    payload = {
        "Số lượng": qty,
        "Số lượng KM": 0,
        "Giá trị": value,
        "Mã NVBH": "S1",
        "Tên NVBH": "Staff",
    }
    if promotion_code is not None:
        payload["promotionCode" if promotion_alias else "Mã CTKM"] = promotion_code
    if promotion_name is not None:
        payload["promotionName" if promotion_alias else "Tên CTKM"] = promotion_name
    db.add(VinamilkOrderSnapshot(
        remote_key=f"{order}-{sku}",
        order_number=order,
        product_code=sku,
        product_name=f"Name {sku}",
        customer_code=customer,
        customer_name=f"Customer {customer}",
        order_created_date=day,
        warehouse_updated=warehouse,
        returned=returned,
        synced_from=day,
        synced_to=day,
        raw_payload=payload,
    ))
    db.flush()


def link(db, new, old):
    db.add(VinamilkOrderReplacement(new_order_number=new, replaced_order_number=old))
    db.flush()


def test_returned_order_is_deducted_and_replacement_counts_as_sold(db):
    line(db, "OLD", D1, qty=10, value=1000, returned=True)
    line(db, "NEW", D2, qty=8, value=800)
    link(db, "NEW", "OLD")

    result = build_sales_summary(db, D1, D2)

    assert result["totals"]["sold_qty"] == 18
    assert result["totals"]["deducted_qty"] == 10
    assert result["totals"]["net_qty"] == 8
    assert result["totals"]["net_value"] == 800
    assert result["pairs"][0]["diff_qty"] == -2
    assert result["pairs"][0]["diff_value"] == -200


def test_deduction_stays_in_period_of_old_order(db):
    line(db, "OLD", D1, qty=10, value=1000, returned=True)
    line(db, "NEW", D2, qty=10, value=1000)
    link(db, "NEW", "OLD")

    september = build_sales_summary(db, D1, D1)
    october = build_sales_summary(db, D2, D2)

    assert september["totals"]["net_value"] == 0
    assert october["totals"]["net_value"] == 1000
    assert september["pairs"][0]["new_order_number"] == "NEW"
    assert october["pairs"] == []


def test_replaced_order_not_returned_is_warned_not_deducted(db):
    line(db, "OLD", D1, qty=10, value=1000, returned=False)
    line(db, "NEW", D1, qty=10, value=1000)
    link(db, "NEW", "OLD")

    result = build_sales_summary(db, D1, D1)

    assert result["totals"]["deducted_value"] == 0
    assert result["totals"]["net_value"] == 2000
    assert [item["type"] for item in result["review"]] == ["replaced_not_returned"]
    assert result["review"][0]["order_number"] == "OLD"


def test_pure_return_is_deducted_without_warning(db):
    line(db, "R1", D1, qty=5, value=500, returned=True)

    result = build_sales_summary(db, D1, D1)

    assert result["totals"]["net_value"] == 0
    assert result["review"] == []


def test_replacement_chain_deducts_each_returned_order_once(db):
    line(db, "A", D1, value=100, returned=True)
    line(db, "B", D1, value=100, returned=True)
    line(db, "C", D1, value=100)
    link(db, "B", "A")
    link(db, "C", "B")

    result = build_sales_summary(db, D1, D1)

    assert result["totals"]["sold_value"] == 300
    assert result["totals"]["deducted_value"] == 200
    assert result["totals"]["net_value"] == 100
    assert result["review"] == []


def test_lines_without_warehouse_update_are_not_counted(db):
    line(db, "X", D1, value=100, warehouse=False)
    line(db, "Y", D1, value=100, warehouse=None, returned=None)

    result = build_sales_summary(db, D1, D1)

    assert result["totals"]["sold_value"] == 0
    assert result["unknown_state_rows"] == 1


def test_group_by_and_filters(db):
    line(db, "O1", D1, sku="A", qty=1, value=10, customer="C1")
    line(db, "O1", D1, sku="B", qty=2, value=20, customer="C1")
    line(db, "O2", D2, sku="A", qty=3, value=30, customer="C2", returned=True)

    by_product = build_sales_summary(db, D1, D2, group_by="product")
    by_day = build_sales_summary(db, D1, D2, group_by="day")
    filtered = build_sales_summary(db, D1, D2, group_by="customer", customer="c2")

    products = {group["code"]: group for group in by_product["groups"]}
    assert products["A"]["net_qty"] == 1 and products["B"]["net_qty"] == 2
    assert [group["key"] for group in by_day["groups"]] == ["2026-10-01", "2026-09-30"]
    assert [group["code"] for group in filtered["groups"]] == ["C2"]
    assert filtered["totals"]["net_value"] == 0


def test_group_by_promotion_uses_code_and_name_and_deducts_returned_lines(db):
    line(
        db, "PROMO-1", D1, qty=4, value=400, promotion_code="CTKM01",
        promotion_name="Mua 4 tặng 1",
    )
    line(
        db, "PROMO-2", D1, sku="SKU2", qty=3, value=300, returned=True,
        promotion_code="CTKM02", promotion_name="Giảm giá sản phẩm",
    )
    line(db, "NO-PROMO", D1, sku="SKU3", qty=2, value=200)
    line(
        db, "ALIAS", D1, sku="SKU4", qty=1, value=100,
        promotion_code="CTKM03", promotion_name="CTKM alias", promotion_alias=True,
    )

    result = build_sales_summary(db, D1, D1, group_by="promotion")

    groups = {item["code"]: item for item in result["groups"]}
    assert groups["CTKM01"]["name"] == "Mua 4 tặng 1"
    assert groups["CTKM01"]["net_qty"] == 4
    assert groups["CTKM02"]["deducted_qty"] == 3
    assert groups["CTKM02"]["net_value"] == 0
    assert groups["Không có CTKM"]["net_qty"] == 2
    assert groups["CTKM03"]["net_value"] == 100
    assert result["totals"]["net_value"] == 700


def test_invalid_group_by_is_rejected(db):
    with pytest.raises(ValueError):
        build_sales_summary(db, D1, D1, group_by="other")
