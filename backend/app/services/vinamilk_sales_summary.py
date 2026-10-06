"""Tổng hợp doanh số thực từ dữ liệu đơn hàng Vinamilk đã đồng bộ.

Doanh số thực = dòng đã cập nhật kho − dòng của đơn đã trả. Khoản trừ được ghi nhận theo ngày
của chính đơn bị trả (đơn cũ), nên đơn thay thế khác kỳ không làm lệch kỳ báo cáo của đơn cũ.
"""
from collections import defaultdict
from datetime import date
from typing import Any, Iterable

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.vinamilk import VinamilkOrderReplacement, VinamilkOrderSnapshot

GROUP_BY_VALUES = ("product", "customer", "staff", "day")
METRICS = ("sold_qty", "sold_promo_qty", "sold_value", "deducted_qty", "deducted_promo_qty", "deducted_value")


def _number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return 0.0


def _first(payload: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return value
    return None


def _line_amounts(payload: dict[str, Any]) -> tuple[float, float, float]:
    return (
        _number(_first(payload, ("Số lượng", "quantity", "qty"))),
        _number(_first(payload, ("Số lượng KM", "promotionQuantity", "freeQuantity"))),
        _number(_first(payload, ("Giá trị", "totalValue", "amount"))),
    )


def _blank_totals() -> dict[str, float]:
    return {metric: 0.0 for metric in METRICS}


def _with_net(totals: dict[str, float]) -> dict[str, float]:
    return {
        **totals,
        "net_qty": totals["sold_qty"] - totals["deducted_qty"],
        "net_promo_qty": totals["sold_promo_qty"] - totals["deducted_promo_qty"],
        "net_value": totals["sold_value"] - totals["deducted_value"],
    }


def _group_key(row: VinamilkOrderSnapshot, payload: dict[str, Any], group_by: str) -> tuple[str, str, str]:
    if group_by == "product":
        return (row.product_code or "", row.product_code or "", row.product_name or "")
    if group_by == "customer":
        return (row.customer_code or "", row.customer_code or "", row.customer_name or "")
    if group_by == "staff":
        code = str(_first(payload, ("Mã NVBH", "staffCode")) or "")
        return (code, code, str(_first(payload, ("Tên NVBH", "staffName")) or ""))
    day = row.order_created_date.isoformat() if row.order_created_date else ""
    return (day, day, "")


def _matches(value: str | None, query: str | None) -> bool:
    return not query or query.strip().lower() in (value or "").lower()


def build_sales_summary(
    db: Session,
    from_date: date,
    to_date: date,
    group_by: str = "product",
    customer: str | None = None,
    staff: str | None = None,
    product: str | None = None,
) -> dict[str, Any]:
    if group_by not in GROUP_BY_VALUES:
        raise ValueError(f"group_by phải là một trong {', '.join(GROUP_BY_VALUES)}.")

    replacements = {
        item.new_order_number: item.replaced_order_number
        for item in db.scalars(select(VinamilkOrderReplacement)).all()
    }
    replaced_orders: dict[str, list[str]] = defaultdict(list)
    for new_number, old_number in replacements.items():
        replaced_orders[old_number].append(new_number)
    linked_orders = set(replacements) | set(replaced_orders)

    in_range = and_(
        VinamilkOrderSnapshot.order_created_date >= from_date,
        VinamilkOrderSnapshot.order_created_date <= to_date,
    )
    # Lấy thêm dòng của các đơn có liên kết thay thế dù nằm ngoài kỳ để đối chiếu đơn cũ/đơn mới.
    scope = or_(in_range, VinamilkOrderSnapshot.order_number.in_(linked_orders)) if linked_orders else in_range
    rows = db.scalars(
        select(VinamilkOrderSnapshot).where(
            VinamilkOrderSnapshot.order_number.is_not(None),
            VinamilkOrderSnapshot.product_code.is_not(None),
            scope,
        )
    ).all()

    def in_period(row: VinamilkOrderSnapshot) -> bool:
        return row.order_created_date is not None and from_date <= row.order_created_date <= to_date

    def passes_filters(row: VinamilkOrderSnapshot, payload: dict[str, Any]) -> bool:
        staff_text = f"{_first(payload, ('Mã NVBH', 'staffCode')) or ''} {_first(payload, ('Tên NVBH', 'staffName')) or ''}"
        return (
            (_matches(row.customer_code, customer) or _matches(row.customer_name, customer))
            and _matches(staff_text, staff)
            and (_matches(row.product_code, product) or _matches(row.product_name, product))
        )

    groups: dict[str, dict[str, Any]] = {}
    totals = _blank_totals()
    orders: dict[str, dict[str, Any]] = {}
    unknown_rows = 0

    for row in rows:
        payload = row.raw_payload if isinstance(row.raw_payload, dict) else {}
        qty, promo_qty, value = _line_amounts(payload)
        order = orders.setdefault(row.order_number, {
            "order_number": row.order_number,
            "date": row.order_created_date.isoformat() if row.order_created_date else None,
            "customer_code": row.customer_code,
            "customer_name": row.customer_name,
            "warehouse_updated": False,
            "returned": False,
            "qty": 0.0,
            "promo_qty": 0.0,
            "value": 0.0,
            "in_scope": False,
        })
        order["qty"] += qty
        order["promo_qty"] += promo_qty
        order["value"] += value
        order["warehouse_updated"] = order["warehouse_updated"] or row.warehouse_updated is True
        order["returned"] = order["returned"] or row.returned is True

        if not in_period(row) or not passes_filters(row, payload):
            continue
        order["in_scope"] = True
        if row.warehouse_updated is not True:
            if row.warehouse_updated is None and row.returned is None:
                unknown_rows += 1
            continue
        is_deducted = row.returned is True
        key, code, name = _group_key(row, payload, group_by)
        group = groups.setdefault(key, {"key": key, "code": code, "name": name, **_blank_totals()})
        for target in (group, totals):
            target["sold_qty"] += qty
            target["sold_promo_qty"] += promo_qty
            target["sold_value"] += value
            if is_deducted:
                target["deducted_qty"] += qty
                target["deducted_promo_qty"] += promo_qty
                target["deducted_value"] += value

    pairs = []
    review = []
    for old_number, new_numbers in sorted(replaced_orders.items()):
        old = orders.get(old_number)
        for new_number in sorted(new_numbers):
            new = orders.get(new_number)
            if old is not None and old["in_scope"]:
                pairs.append({
                    "replaced_order_number": old_number,
                    "new_order_number": new_number,
                    "date": old["date"],
                    "customer_code": old["customer_code"],
                    "customer_name": old["customer_name"],
                    "replaced_qty": old["qty"],
                    "replaced_value": old["value"],
                    "new_qty": new["qty"] if new else None,
                    "new_value": new["value"] if new else None,
                    "diff_qty": (new["qty"] - old["qty"]) if new else None,
                    "diff_value": (new["value"] - old["value"]) if new else None,
                    "replaced_returned": bool(old["returned"]),
                    "new_found": new is not None,
                })
        if old is None or not old["in_scope"]:
            continue
        if not old["returned"]:
            review.append({
                "type": "replaced_not_returned",
                "message": "Đơn bị thay thế nhưng chưa có trạng thái Đã trả nên chưa bị trừ.",
                "order_number": old_number,
                "related_order_number": ", ".join(sorted(new_numbers)),
                "date": old["date"],
                "customer_code": old["customer_code"],
                "customer_name": old["customer_name"],
                "qty": old["qty"],
                "value": old["value"],
            })
    for new_number, old_number in sorted(replacements.items()):
        new = orders.get(new_number)
        if orders.get(old_number) is None and new is not None and new["in_scope"]:
            review.append({
                "type": "replaced_order_missing",
                "message": "Không tìm thấy đơn cũ trong dữ liệu đồng bộ.",
                "order_number": new_number,
                "related_order_number": old_number,
                "date": new["date"],
                "customer_code": new["customer_code"],
                "customer_name": new["customer_name"],
                "qty": new["qty"],
                "value": new["value"],
            })
    for order in orders.values():
        if order["in_scope"] and order["returned"] and order["order_number"] not in replaced_orders:
            review.append({
                "type": "returned_without_replacement",
                "message": "Đơn đã trả, chưa có đơn thay thế (trả hàng thuần).",
                "order_number": order["order_number"],
                "related_order_number": "",
                "date": order["date"],
                "customer_code": order["customer_code"],
                "customer_name": order["customer_name"],
                "qty": order["qty"],
                "value": order["value"],
            })
    review.sort(key=lambda item: (item["type"], item["date"] or "", item["order_number"]))

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "group_by": group_by,
        "totals": _with_net(totals),
        "groups": sorted((_with_net(group) | {"key": group["key"], "code": group["code"], "name": group["name"]}
                          for group in groups.values()), key=lambda item: item["key"], reverse=group_by == "day"),
        "pairs": pairs,
        "review": review,
        "unknown_state_rows": unknown_rows,
    }
