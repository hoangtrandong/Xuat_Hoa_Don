from datetime import datetime
from math import isfinite
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from decimal import Decimal
import re

from app.models.inventory import (
    DeliveryAllocation, DeliveryRequest, DeliveryRequestItem, InventoryLot,
    InventoryTransaction, Warehouse, WarehouseLocation, DeliveryRequestEmployeeSummary,
    DeliveryRequestOrder,
)
from app.models.finance import DebtLedgerEntry
from app.models.employee import Employee
from app.models.product import Product

from app.schemas.delivery_request import DeliveryRequestCreate, FefoPlanItem, FefoPlanPick

ACTIVE_STATUSES = ("DRAFT", "SUBMITTED", "RECEIVED")


def _code() -> str:
    return f"DR-{datetime.utcnow():%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"


def _validated_employee_summaries(db: Session, summaries) -> list[dict[str, object]]:
    validated = []
    employee_codes = set()
    for summary in summaries or []:
        code = summary.employee_code.strip().upper()
        if not code:
            raise ValueError("Mã nhân viên ghi công nợ không được để trống.")
        if code in employee_codes:
            raise ValueError(f"Nhân viên {code} xuất hiện nhiều lần trong phần tổng hợp công nợ.")
        employee_codes.add(code)

        matches = db.scalars(select(Employee).where(func.upper(Employee.code) == code)).all()
        if not matches:
            raise ValueError(f"Không tìm thấy nhân viên {code} trong hệ thống.")
        if len(matches) > 1:
            raise ValueError(f"Mã nhân viên {code} không duy nhất trong hệ thống.")
        employee = matches[0]
        if summary.employee_id is not None and summary.employee_id != employee.id:
            raise ValueError(f"Mã nhân viên {code} không khớp với nhân viên được chọn.")

        amount = float(summary.amount)
        if not isfinite(amount) or amount < 0 or amount > 999999999999.99:
            raise ValueError(f"Số tiền công nợ của nhân viên {code} không hợp lệ.")
        validated.append({
            "employee_id": employee.id,
            "employee_code": employee.code,
            "employee_name": employee.name,
            "column_key": summary.column_key,
            "weight_ton": summary.weight_ton,
            "order_count": summary.order_count,
            "amount": amount,
        })
    return validated


def _reserved_for_position(
    db: Session,
    warehouse_id: int,
    product_id: int,
    location_id: int | None,
    expiry_date,
    exclude_request_id=None,
) -> int:
    stmt = (select(func.coalesce(func.sum(DeliveryAllocation.allocated_quantity), 0))
            .join(DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id)
            .where(DeliveryRequest.warehouse_id == warehouse_id,
                   DeliveryRequestItem.product_id == product_id,
                   DeliveryAllocation.location_id == location_id,
                   DeliveryAllocation.expiry_date == expiry_date,
                   DeliveryRequest.status.in_(ACTIVE_STATUSES)))
    if exclude_request_id:
        stmt = stmt.where(DeliveryRequest.id != exclude_request_id)
    return int(db.scalar(stmt) or 0)


def _legacy_available(db, warehouse_id, product_id, exclude_request_id=None):
    on_hand = db.scalar(select(func.coalesce(func.sum(InventoryTransaction.quantity), 0)).where(
        InventoryTransaction.warehouse_id == warehouse_id, InventoryTransaction.product_id == product_id,
        InventoryTransaction.lot_id.is_(None))) or 0
    reserved = (select(func.coalesce(func.sum(DeliveryAllocation.allocated_quantity), 0))
        .join(DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id)
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id)
        .where(DeliveryRequest.warehouse_id == warehouse_id,
               DeliveryRequest.status.in_(ACTIVE_STATUSES),
               DeliveryRequestItem.product_id == product_id,
               DeliveryAllocation.lot_id.is_(None)))
    if exclude_request_id:
        reserved = reserved.where(DeliveryRequest.id != exclude_request_id)
    return int(on_hand) - int(db.scalar(reserved) or 0)


def _available_at_location(
    db: Session,
    warehouse_id: int,
    product_id: int,
    location_id: int,
    exclude_request_id: int | None = None,
) -> int:
    """Return available quantity for a product at one location.

    Inventory lots are used as the current position balance, but lot identity is
    intentionally ignored. Legacy transactions without a lot remain supported.
    """
    lot_stock = db.scalar(select(func.coalesce(func.sum(
        InventoryLot.quantity_on_hand - InventoryLot.locked_quantity
    ), 0)).where(
        InventoryLot.warehouse_id == warehouse_id,
        InventoryLot.product_id == product_id,
        InventoryLot.location_id == location_id,
    )) or 0
    legacy_stock = db.scalar(select(func.coalesce(func.sum(InventoryTransaction.quantity), 0)).where(
        InventoryTransaction.warehouse_id == warehouse_id,
        InventoryTransaction.product_id == product_id,
        InventoryTransaction.location_id == location_id,
        InventoryTransaction.lot_id.is_(None),
    )) or 0
    reserved = (select(func.coalesce(func.sum(DeliveryAllocation.allocated_quantity), 0))
        .join(DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id)
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id)
        .where(DeliveryRequest.warehouse_id == warehouse_id,
               DeliveryRequest.status.in_(ACTIVE_STATUSES),
               DeliveryRequestItem.product_id == product_id,
               DeliveryAllocation.location_id == location_id))
    if exclude_request_id:
        reserved = reserved.where(DeliveryRequest.id != exclude_request_id)
    return max(0, int(lot_stock) + int(legacy_stock) - int(db.scalar(reserved) or 0))


def _reserved_for_lot(db: Session, lot_id: int, exclude_request_id: int | None = None) -> int:
    stmt = (select(func.coalesce(func.sum(DeliveryAllocation.allocated_quantity), 0))
        .join(DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id)
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id)
        .where(DeliveryAllocation.lot_id == lot_id,
               DeliveryRequest.status.in_(ACTIVE_STATUSES)))
    if exclude_request_id:
        stmt = stmt.where(DeliveryRequest.id != exclude_request_id)
    return int(db.scalar(stmt) or 0)


def available_for_product(db: Session, warehouse_id: int, product_id: int) -> int:
    lot_stock = db.scalar(select(func.coalesce(func.sum(
        InventoryLot.quantity_on_hand - InventoryLot.locked_quantity
    ), 0)).join(
        WarehouseLocation, WarehouseLocation.id == InventoryLot.location_id
    ).where(
        InventoryLot.warehouse_id == warehouse_id,
        InventoryLot.product_id == product_id,
        WarehouseLocation.is_active.is_(True),
    )) or 0
    return int(lot_stock) + _legacy_available(db, warehouse_id, product_id)


def _fefo_picks(
    db: Session,
    warehouse_id: int,
    product_id: int,
    quantity: int,
    exclude_request_id: int | None = None,
    for_update: bool = False,
) -> tuple[list[tuple[int | None, int | None, datetime | None, int, str]], int]:
    """Return FEFO picks ``(location_id, lot_id, expiry_date, take, strategy)`` and the
    remaining quantity not covered by lot-based stock.

    Lot ordering and per-position reservation mirror the logic used at submit time so a
    preview (POST /delivery-requests/plan) matches what submit will actually consume.
    With ``for_update`` the lot rows are locked, preserving the original submit-time
    behaviour. Only active warehouse locations are considered.
    """
    remaining = int(quantity)
    picks: list[tuple[int | None, int | None, datetime | None, int, str]] = []
    stmt = (
        select(InventoryLot)
        .join(WarehouseLocation, WarehouseLocation.id == InventoryLot.location_id)
        .where(
            InventoryLot.warehouse_id == warehouse_id,
            InventoryLot.product_id == product_id,
            InventoryLot.quantity_on_hand > 0,
            InventoryLot.quantity_on_hand > InventoryLot.locked_quantity,
            WarehouseLocation.is_active.is_(True),
        )
        .order_by(
            InventoryLot.expiry_date.is_(None),
            InventoryLot.expiry_date,
            InventoryLot.location_id,
            InventoryLot.id,
        )
    )
    if for_update:
        stmt = stmt.with_for_update()
    lots = db.scalars(stmt).all()
    positions: dict[tuple[int | None, datetime | None], list[InventoryLot]] = {}
    for lot in lots:
        positions.setdefault((lot.location_id, lot.expiry_date), []).append(lot)
    for (location_id, expiry_date), position_lots in positions.items():
        reserved = _reserved_for_position(
            db, warehouse_id, product_id, location_id, expiry_date, exclude_request_id
        )
        free = max(
            0,
            sum(lot.quantity_on_hand - lot.locked_quantity for lot in position_lots) - reserved,
        )
        for lot in position_lots:
            if free <= 0 or remaining <= 0:
                break
            take = min(remaining, lot.quantity_on_hand - lot.locked_quantity, free)
            if take <= 0:
                continue
            picks.append((location_id, lot.id, expiry_date, take, "FEFO"))
            remaining -= take
            free -= take
        if not remaining:
            break
    return picks, remaining


def _allocate(db: Session, request: DeliveryRequest, item: DeliveryRequestItem) -> None:
    planned = item.planned_allocations or []
    if not planned:
        raise ValueError(f"Sản phẩm {item.sku} chưa được chỉ định vị trí lấy hàng.")

    planned_by_location: dict[int, int] = {}
    for allocation in planned:
        location_id = allocation.get("location_id") if isinstance(allocation, dict) else None
        lot_id = allocation.get("lot_id") if isinstance(allocation, dict) else None
        quantity = allocation.get("quantity") if isinstance(allocation, dict) else None
        if not isinstance(location_id, int) or not isinstance(quantity, int) or quantity <= 0:
            raise ValueError(f"Sản phẩm {item.sku} có phân bổ vị trí không hợp lệ.")
        location = db.get(WarehouseLocation, location_id)
        if not location or location.warehouse_id != request.warehouse_id or not location.is_active:
            raise ValueError(f"Vị trí lấy hàng của sản phẩm {item.sku} không hợp lệ.")
        if lot_id is not None:
            lot = db.get(InventoryLot, lot_id)
            if not lot or lot.warehouse_id != request.warehouse_id or lot.product_id != item.product_id or lot.location_id != location_id:
                raise ValueError(f"Lô được chỉ định của sản phẩm {item.sku} không hợp lệ.")
            if (lot.quantity_on_hand - lot.locked_quantity
                    - _reserved_for_lot(db, lot.id, request.id) < quantity):
                raise ValueError(f"Lô của sản phẩm {item.sku} tại vị trí {location.code} không còn đủ tồn.")
        elif _available_at_location(db, request.warehouse_id, item.product_id, location_id, request.id) < quantity:
            raise ValueError(f"Sản phẩm {item.sku} tại vị trí {location.code} không còn đủ tồn.")
        planned_by_location[location_id] = planned_by_location.get(location_id, 0) + quantity

    planned_quantity = sum(planned_by_location.values())
    if planned_quantity != item.quantity:
        raise ValueError(
            f"Sản phẩm {item.sku} phải được chỉ định đủ {item.quantity} đơn vị, "
            f"hiện mới chỉ định {planned_quantity}."
        )

    item.allocations.clear()
    for allocation in planned:
        location_id = allocation["location_id"]
        lot_id = allocation.get("lot_id")
        quantity = allocation["quantity"]
        item.allocations.append(DeliveryAllocation(
            allocated_quantity=quantity,
            allocation_sequence=len(item.allocations) + 1,
            allocation_strategy="FEFO" if lot_id is not None else "LOCATION_STOCK",
            lot_id=lot_id,
            location_id=location_id,
            expiry_date=(db.get(InventoryLot, lot_id).expiry_date if lot_id is not None else None),
        ))


def create(
    db: Session, payload: DeliveryRequestCreate, created_by: str | None = None
) -> DeliveryRequest:
    if not db.get(Warehouse, payload.warehouse_id):
        raise ValueError("Không tìm thấy kho.")
    merged = {}
    employee_allocations = {}
    planned_allocations = {}
    for row in payload.items:
        if not db.get(Product, row.product_id):
            raise ValueError(f"Không tìm thấy sản phẩm {row.product_id}.")
        if row.quantity <= 0 and not row.requested_quantity_raw:
            raise ValueError("Số lượng phải lớn hơn 0.")
        merged[row.product_id] = merged.get(row.product_id, 0) + row.quantity
        if row.employee_allocations:
            target = employee_allocations.setdefault(row.product_id, {})
            for employee, allocation in row.employee_allocations.items():
                if isinstance(allocation, dict):
                    existing = target.setdefault(employee, {})
                    existing["quantity"] = existing.get("quantity", 0) + int(allocation.get("quantity", 0))
                    for key in ("raw", "cartons", "boxes"):
                        if key in allocation:
                            existing[key] = allocation[key]
                else:
                    target[employee] = target.get(employee, 0) + int(allocation)
        if row.planned_allocations:
            planned_allocations.setdefault(row.product_id, []).extend(row.planned_allocations)
    employee_summaries = _validated_employee_summaries(db, payload.employee_summaries)
    request = DeliveryRequest(
        code=_code(),
        warehouse_id=payload.warehouse_id,
        note=payload.note,
        created_by=created_by if created_by is not None else payload.created_by,
    )
    try:
        db.add(request)
        db.flush()
        raw_quantities = {row.product_id: row.requested_quantity_raw for row in payload.items}
        for product_id, quantity in merged.items():
            item = DeliveryRequestItem(request_id=request.id, product_id=product_id, quantity=quantity,
                                       requested_quantity_raw=raw_quantities.get(product_id),
                                       employee_allocations=employee_allocations.get(product_id),
                                       planned_allocations=planned_allocations.get(product_id))
            db.add(item)
            db.flush()
        for summary_data in employee_summaries:
            db.add(DeliveryRequestEmployeeSummary(
                delivery_request_id=request.id,
                **summary_data,
            ))
        if employee_summaries:
            db.flush()

        emp_lookup = {e.code.upper(): e for e in db.scalars(select(Employee)).all()}
        for order_data in payload.orders or []:
            emp_id = order_data.employee_id
            if emp_id is None and order_data.employee_code:
                emp_obj = emp_lookup.get(order_data.employee_code.strip().upper())
                emp_id = emp_obj.id if emp_obj else None
            db.add(DeliveryRequestOrder(
                delivery_request_id=request.id,
                order_date=order_data.order_date,
                order_number=order_data.order_number,
                employee_id=emp_id,
                employee_code=order_data.employee_code.strip().upper(),
                employee_name=order_data.employee_name,
                customer_code=order_data.customer_code,
                customer_name=order_data.customer_name,
                amount=order_data.amount,
                payment_status=order_data.payment_status or "UNPAID",
                payment_method=order_data.payment_method,
                bank_ref=order_data.bank_ref,
                paid_at=order_data.paid_at,
                note=order_data.note,
            ))
        if payload.orders:
            db.flush()

        db.commit()
        return get(db, request.id)
    except Exception:
        db.rollback()
        raise


def plan(db: Session, payload: DeliveryRequestCreate) -> list[FefoPlanItem]:
    """Build a read-only FEFO plan grouped by location for admin confirmation."""
    if not db.get(Warehouse, payload.warehouse_id):
        raise ValueError("Không tìm thấy kho.")
    merged: dict[int, int] = {}
    for row in payload.items:
        if not db.get(Product, row.product_id):
            raise ValueError(f"Không tìm thấy sản phẩm {row.product_id}.")
        if row.quantity <= 0 and not row.requested_quantity_raw:
            raise ValueError("Số lượng phải lớn hơn 0.")
        merged[row.product_id] = merged.get(row.product_id, 0) + row.quantity

    products = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(merged.keys()))).all()
    }
    result: list[FefoPlanItem] = []
    for product_id, quantity in merged.items():
        product = products.get(product_id)
        pick_rows: list[FefoPlanPick] = []
        picks, remaining = _fefo_picks(db, payload.warehouse_id, product_id, quantity)
        for location_id, lot_id, expiry_date, take, strategy in picks:
            location = db.get(WarehouseLocation, location_id) if location_id is not None else None
            lot = db.get(InventoryLot, lot_id) if lot_id is not None else None
            pick_rows.append(FefoPlanPick(
                lot_id=lot_id,
                location_code=location.code if location else None,
                location_id=location_id,
                lot_number=lot.lot_number if lot else None,
                expiry_date=expiry_date,
                quantity=take,
                allocation_strategy=strategy,
            ))
        result.append(FefoPlanItem(
            product_id=product_id,
            sku=product.sku if product else str(product_id),
            product_name=product.name if product else "Chưa đăng ký",
            quantity=quantity,
            planned_quantity=quantity - remaining,
            shortage_quantity=remaining,
            picks=pick_rows,
        ))
    return result


def get(db: Session, request_id: int):
    request = db.scalar(select(DeliveryRequest).options(
        selectinload(DeliveryRequest.items)
        .selectinload(DeliveryRequestItem.allocations)
        .options(
            selectinload(DeliveryAllocation.location),
            selectinload(DeliveryAllocation.lot),
        ),
        selectinload(DeliveryRequest.employee_summaries),
        selectinload(DeliveryRequest.orders),
    ).where(DeliveryRequest.id == request_id))
    return _with_stock(db, request)


def list_(db: Session, status: str | None = None):
    """Lightweight list query for the queue/admin UI.

    Loads requests + their items + the related Product in a single joined
    select (no allocations needed for list views). This keeps the response
    small and avoids N+1 lazy loads on the @property sku/product_name fields
    and on the allocations relationship (which is only loaded by the detail
    endpoint via get()).
    """
    stmt = select(DeliveryRequest).options(
        selectinload(DeliveryRequest.items).selectinload(DeliveryRequestItem.product),
        selectinload(DeliveryRequest.employee_summaries),
    ).order_by(DeliveryRequest.created_at.desc())
    if status:
        stmt = stmt.where(DeliveryRequest.status == status.upper())
    return list(db.scalars(stmt).all())


def _with_stock(db: Session, request: DeliveryRequest | None):
    if request is None:
        return None
    for item in request.items:
        available = _legacy_available(db, request.warehouse_id, item.product_id, request.id)
        lot_stock = db.scalar(select(func.coalesce(func.sum(
            InventoryLot.quantity_on_hand - InventoryLot.locked_quantity
        ), 0)).join(
            WarehouseLocation, WarehouseLocation.id == InventoryLot.location_id
        ).where(
            InventoryLot.warehouse_id == request.warehouse_id,
            InventoryLot.product_id == item.product_id,
            WarehouseLocation.is_active.is_(True),
        )) or 0
        item.available_quantity = int(available + lot_stock)
        item.shortage_quantity = max(0, item.quantity - item.available_quantity)
    return request


def transition(db: Session, request_id: int, action: str):
    request = db.scalar(select(DeliveryRequest).options(
        selectinload(DeliveryRequest.items).selectinload(DeliveryRequestItem.allocations)
    ).where(DeliveryRequest.id == request_id).with_for_update())
    if not request:
        raise ValueError("Không tìm thấy yêu cầu xuất kho.")
    expected = {
        "submit": {"DRAFT"},
        "receive": {"SUBMITTED"},
        "complete": {"RECEIVED"},
        "cancel": {"DRAFT", "SUBMITTED", "RECEIVED"}
    }
    if action not in expected or request.status not in expected[action]:
        raise ValueError(f"Không thể {action} khi yêu cầu đang ở trạng thái {request.status}.")
    now = datetime.utcnow()
    try:
        if action == "submit":
            for item in request.items:
                _allocate(db, request, item)
            request.status, request.submitted_at = "SUBMITTED", now
        elif action == "receive":
            request.status, request.received_at = "RECEIVED", now
        elif action == "cancel":
            request.status, request.cancelled_at = "CANCELLED", now
        else:
            summaries = db.scalars(
                select(DeliveryRequestEmployeeSummary).where(
                    DeliveryRequestEmployeeSummary.delivery_request_id == request.id
                )
            ).all()
            for summary in summaries:
                amount = float(summary.amount)
                if not isfinite(amount) or amount < 0 or amount > 999999999999.99:
                    raise ValueError(
                        f"Không thể hoàn tất: số tiền công nợ của nhân viên {summary.employee_code} không hợp lệ."
                    )
                if amount > 0 and summary.employee_id is None:
                    raise ValueError(
                        "Không thể hoàn tất: có nhân viên ghi công nợ chưa được liên kết với nhân viên trong hệ thống."
                    )
            for item in request.items:
                for allocation in item.allocations:
                    qty = allocation.allocated_quantity
                    if allocation.lot_id:
                        lot = db.scalar(select(InventoryLot).where(
                            InventoryLot.id == allocation.lot_id).with_for_update())
                        if not lot or lot.quantity_on_hand - lot.locked_quantity < qty:
                            raise ValueError("Tồn kho lô không đủ để hoàn tất yêu cầu.")
                        lot.quantity_on_hand -= qty
                    db.add(InventoryTransaction(
                        code=f"ITT-{now:%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}",
                        type="OUT", warehouse_id=request.warehouse_id, product_id=item.product_id,
                        quantity=-qty, lot_id=allocation.lot_id, location_id=allocation.location_id,
                        expiry_date=allocation.expiry_date, ref_type="DR", ref_code=request.code,
                        note=request.note, created_by=request.created_by))

            # Record debt into ledger for each employee summary
            for summary in summaries:
                if summary.employee_id and summary.amount > 0:
                    existing_entry = db.scalar(
                        select(DebtLedgerEntry).where(
                            DebtLedgerEntry.source_type == "DELIVERY_REQUEST",
                            DebtLedgerEntry.source_id == request.id,
                            DebtLedgerEntry.party_type == "EMPLOYEE",
                            DebtLedgerEntry.party_id == summary.employee_id,
                            DebtLedgerEntry.entry_type == "DELIVERY_ISSUE",
                        )
                    )
                    if not existing_entry:
                        db.add(DebtLedgerEntry(
                            party_type="EMPLOYEE",
                            party_id=summary.employee_id,
                            entry_type="DELIVERY_ISSUE",
                            amount=summary.amount,
                            source_type="DELIVERY_REQUEST",
                            source_id=request.id,
                            source_code=request.code,
                            document_date=now,
                            note=f"Xuất hàng phiếu {request.code} ({summary.employee_code})",
                            created_by=request.created_by,
                        ))

            request.status, request.completed_at = "COMPLETED", now
        db.commit()
        return get(db, request_id)
    except Exception:
        db.rollback()
        raise


def update(db: Session, request_id: int, payload: DeliveryRequestCreate) -> DeliveryRequest:
    request = db.scalar(select(DeliveryRequest).options(
        selectinload(DeliveryRequest.items),
        selectinload(DeliveryRequest.employee_summaries),
        selectinload(DeliveryRequest.orders),
    ).where(DeliveryRequest.id == request_id).with_for_update())
    if not request:
        raise ValueError("Không tìm thấy yêu cầu xuất kho.")
    if request.status != "DRAFT":
        raise ValueError(f"Chỉ có thể cập nhật yêu cầu ở trạng thái DRAFT. Trạng thái hiện tại: {request.status}")
    if not db.get(Warehouse, payload.warehouse_id):
        raise ValueError("Không tìm thấy kho.")
    if request.employee_summaries and payload.employee_summaries is None:
        raise ValueError(
            "Phiếu có công nợ nhân viên; cần gửi lại bảng tổng hợp công nợ đã xác nhận khi cập nhật."
        )
    employee_summaries = _validated_employee_summaries(db, payload.employee_summaries)
    if request.employee_summaries and not employee_summaries:
        raise ValueError("Không thể xóa toàn bộ bảng tổng hợp công nợ khỏi phiếu đã có nhân viên.")

    merged = {}
    employee_allocations = {}
    planned_allocations = {}
    for row in payload.items:
        if not db.get(Product, row.product_id):
            raise ValueError(f"Không tìm thấy sản phẩm {row.product_id}.")
        if row.quantity <= 0 and not row.requested_quantity_raw:
            raise ValueError("Số lượng phải lớn hơn 0.")
        merged[row.product_id] = merged.get(row.product_id, 0) + row.quantity
        if row.employee_allocations:
            target = employee_allocations.setdefault(row.product_id, {})
            for employee, allocation in row.employee_allocations.items():
                if isinstance(allocation, dict):
                    existing = target.setdefault(employee, {})
                    existing["quantity"] = existing.get("quantity", 0) + int(allocation.get("quantity", 0))
                    for key in ("raw", "cartons", "boxes"):
                        if key in allocation:
                            existing[key] = allocation[key]
                else:
                    target[employee] = target.get(employee, 0) + int(allocation)
        if row.planned_allocations:
            planned_allocations.setdefault(row.product_id, []).extend(row.planned_allocations)

    try:
        request.warehouse_id = payload.warehouse_id
        request.note = payload.note
        
        request.items.clear()
        db.flush()

        if payload.employee_summaries is not None:
            request.employee_summaries.clear()
        
        # Create new items
        raw_quantities = {row.product_id: row.requested_quantity_raw for row in payload.items}
        for product_id, quantity in merged.items():
            request.items.append(DeliveryRequestItem(
                product_id=product_id,
                quantity=quantity,
                requested_quantity_raw=raw_quantities.get(product_id),
                employee_allocations=employee_allocations.get(product_id),
                planned_allocations=planned_allocations.get(product_id),
            ))
        if payload.employee_summaries is not None:
            request.employee_summaries.extend(
                DeliveryRequestEmployeeSummary(**summary_data)
                for summary_data in employee_summaries
            )

        if payload.orders is not None:
            request.orders.clear()
            emp_lookup = {e.code.upper(): e for e in db.scalars(select(Employee)).all()}
            for order_data in payload.orders:
                emp_id = order_data.employee_id
                if emp_id is None and order_data.employee_code:
                    emp_obj = emp_lookup.get(order_data.employee_code.strip().upper())
                    emp_id = emp_obj.id if emp_obj else None
                request.orders.append(DeliveryRequestOrder(
                    order_date=order_data.order_date,
                    order_number=order_data.order_number,
                    employee_id=emp_id,
                    employee_code=order_data.employee_code.strip().upper(),
                    employee_name=order_data.employee_name,
                    customer_code=order_data.customer_code,
                    customer_name=order_data.customer_name,
                    amount=order_data.amount,
                    payment_status=order_data.payment_status or "UNPAID",
                    payment_method=order_data.payment_method,
                    bank_ref=order_data.bank_ref,
                    paid_at=order_data.paid_at,
                    note=order_data.note,
                ))
        
        db.commit()
        return get(db, request.id)
    except Exception:
        db.rollback()
        raise


def delete(db: Session, request_id: int):
    request = db.scalar(select(DeliveryRequest).where(DeliveryRequest.id == request_id).with_for_update())
    if not request:
        raise ValueError("Không tìm thấy yêu cầu xuất kho.")
    if request.status != "DRAFT":
        raise ValueError(f"Chỉ có thể xóa yêu cầu ở trạng thái DRAFT. Trạng thái hiện tại: {request.status}")
    
    try:
        db.delete(request)
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise


def get_settlement(db: Session, request_id: int) -> dict:
    req = db.scalar(
        select(DeliveryRequest).options(
            selectinload(DeliveryRequest.employee_summaries),
            selectinload(DeliveryRequest.orders),
        ).where(DeliveryRequest.id == request_id)
    )
    if not req:
        raise ValueError("Không tìm thấy yêu cầu xuất kho.")
    
    total_orders_count = len(req.orders)
    orders_total_amount = sum(float(o.amount) for o in req.orders)
    summaries_total_amount = sum(float(s.amount) for s in req.employee_summaries)
    total_amount = orders_total_amount if orders_total_amount > 0 else summaries_total_amount

    total_paid_bank = sum(float(o.amount) for o in req.orders if o.payment_method == "BANK" and o.payment_status in ("PAID", "PAID_BANK"))
    total_paid_cash = sum(float(o.amount) for o in req.orders if o.payment_method == "CASH" and o.payment_status in ("PAID", "PAID_CASH"))
    total_transferred_debt = sum(float(o.amount) for o in req.orders if o.payment_method == "DEBT" or o.payment_status == "TRANSFERRED_DEBT")
    total_returned = sum(float(o.amount) for o in req.orders if o.payment_method == "RETURN" or o.payment_status == "RETURNED")
    total_unpaid = sum(float(o.amount) for o in req.orders if o.payment_status in ("UNPAID", "PENDING"))

    emp_settlements = []
    for s in req.employee_summaries:
        emp_orders = [o for o in req.orders if o.employee_code == s.employee_code]
        emp_orders_amt = sum(float(o.amount) for o in emp_orders)
        emp_bank = sum(float(o.amount) for o in emp_orders if o.payment_method == "BANK" and o.payment_status in ("PAID", "PAID_BANK"))
        emp_cash = sum(float(o.amount) for o in emp_orders if o.payment_method == "CASH" and o.payment_status in ("PAID", "PAID_CASH"))
        emp_debt = sum(float(o.amount) for o in emp_orders if o.payment_method == "DEBT" or o.payment_status == "TRANSFERRED_DEBT")
        emp_ret = sum(float(o.amount) for o in emp_orders if o.payment_method == "RETURN" or o.payment_status == "RETURNED")
        emp_unpaid = sum(float(o.amount) for o in emp_orders if o.payment_status in ("UNPAID", "PENDING"))

        allocated = float(s.amount)
        remaining_cash_to_turn_in = max(0.0, allocated - emp_bank - emp_debt - emp_ret)

        emp_settlements.append({
            "employee_id": s.employee_id,
            "employee_code": s.employee_code,
            "employee_name": s.employee_name,
            "allocated_amount": allocated,
            "orders_count": len(emp_orders),
            "orders_amount": emp_orders_amt,
            "paid_bank": emp_bank,
            "paid_cash": emp_cash,
            "transferred_debt": emp_debt,
            "returned": emp_ret,
            "unpaid": emp_unpaid,
            "remaining_cash_to_turn_in": remaining_cash_to_turn_in,
            "difference": emp_orders_amt - allocated,
        })

    return {
        "request_id": req.id,
        "request_code": req.code,
        "request_status": req.status,
        "warehouse_id": req.warehouse_id,
        "total_orders_count": total_orders_count,
        "total_amount": total_amount,
        "total_paid_bank": total_paid_bank,
        "total_paid_cash": total_paid_cash,
        "total_transferred_debt": total_transferred_debt,
        "total_returned": total_returned,
        "total_unpaid": total_unpaid,
        "difference": orders_total_amount - summaries_total_amount,
        "employee_settlements": emp_settlements,
        "orders": req.orders,
    }


def settle_order_pay(
    db: Session,
    request_id: int,
    order_id: int,
    payment_method: str,
    paid_amount: float | None = None,
    bank_ref: str | None = None,
    note: str | None = None,
    created_by: str | None = None,
) -> DeliveryRequestOrder:
    order = db.scalar(
        select(DeliveryRequestOrder).where(
            DeliveryRequestOrder.delivery_request_id == request_id,
            DeliveryRequestOrder.id == order_id,
        ).with_for_update()
    )
    if not order:
        raise ValueError("Không tìm thấy đơn hàng trong phiếu xuất.")

    method_upper = (payment_method or "BANK").upper()
    order.payment_method = method_upper
    if method_upper in ("BANK", "CASH"):
        order.payment_status = f"PAID_{method_upper}"
    elif method_upper == "DEBT":
        order.payment_status = "TRANSFERRED_DEBT"
    elif method_upper == "RETURN":
        order.payment_status = "RETURNED"
    else:
        order.payment_status = "PAID"

    if bank_ref:
        order.bank_ref = bank_ref
    if note:
        order.note = note
    order.paid_at = datetime.utcnow()

    if order.employee_id and float(order.amount) > 0 and method_upper in ("BANK", "CASH"):
        entry_type = "BANK_RECEIPT" if method_upper == "BANK" else "CASH_RECEIPT"
        amt_deduct = paid_amount if (paid_amount is not None and paid_amount > 0) else float(order.amount)

        existing = db.scalar(
            select(DebtLedgerEntry).where(
                DebtLedgerEntry.party_type == "EMPLOYEE",
                DebtLedgerEntry.party_id == order.employee_id,
                DebtLedgerEntry.source_type == "DELIVERY_ORDER",
                DebtLedgerEntry.source_id == order.id,
                DebtLedgerEntry.entry_type == entry_type,
            )
        )
        if not existing:
            db.add(DebtLedgerEntry(
                party_type="EMPLOYEE",
                party_id=order.employee_id,
                entry_type=entry_type,
                amount=-Decimal(str(amt_deduct)),
                source_type="DELIVERY_ORDER",
                source_id=order.id,
                source_code=order.order_number,
                document_date=datetime.utcnow(),
                note=f"Quyết toán {method_upper}: đơn {order.order_number} ({order.customer_name or order.customer_code})" + (f" - Ref: {bank_ref}" if bank_ref else ""),
                created_by=created_by,
            ))

    db.commit()
    return order


def _clean_str(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"[^A-Za-z0-9]", "", str(s)).upper()


def match_statements(
    db: Session,
    request_id: int,
    statements: list,
    auto_confirm: bool = False,
    created_by: str | None = None,
) -> dict:
    req = db.scalar(
        select(DeliveryRequest).options(
            selectinload(DeliveryRequest.orders)
        ).where(DeliveryRequest.id == request_id)
    )
    if not req:
        raise ValueError("Không tìm thấy yêu cầu xuất kho.")

    orders = req.orders
    order_by_clean_num = {_clean_str(o.order_number): o for o in orders if o.order_number}

    results = []
    matched_count = 0
    auto_confirmed_count = 0

    for stmt in statements:
        ref_no = getattr(stmt, "ref_number", None) or (stmt.get("ref_number") if isinstance(stmt, dict) else None)
        desc = getattr(stmt, "description", "") or (stmt.get("description", "") if isinstance(stmt, dict) else "")
        amount = float(getattr(stmt, "amount", 0.0) if hasattr(stmt, "amount") else (stmt.get("amount", 0.0) if isinstance(stmt, dict) else 0.0))

        clean_desc = _clean_str(desc)
        matched_order = None
        confidence = 0.0
        msg = ""

        # 1. Match by order number in description
        for clean_num, o in order_by_clean_num.items():
            if len(clean_num) >= 4 and clean_num in clean_desc:
                matched_order = o
                confidence = 1.0
                msg = f"Khớp chính xác số đơn hàng {o.order_number}"
                break

        # 2. Match by customer code and exact amount
        if not matched_order:
            for o in orders:
                if o.customer_code:
                    clean_cust = _clean_str(o.customer_code)
                    if len(clean_cust) >= 2 and clean_cust in clean_desc and abs(float(o.amount) - amount) < 1.0:
                        matched_order = o
                        confidence = 0.85
                        msg = f"Khớp mã khách hàng {o.customer_code} và số tiền {amount:,.0f}đ"
                        break

        # 3. Match by customer name and exact amount
        if not matched_order:
            for o in orders:
                if o.customer_name and len(o.customer_name) >= 3:
                    clean_name = _clean_str(o.customer_name)
                    if clean_name and clean_name in clean_desc and abs(float(o.amount) - amount) < 1.0:
                        matched_order = o
                        confidence = 0.75
                        msg = f"Khớp tên khách hàng '{o.customer_name}' và số tiền {amount:,.0f}đ"
                        break

        if matched_order:
            matched_count += 1
            already_paid = matched_order.payment_status in ("PAID", "PAID_BANK", "PAID_CASH")
            if auto_confirm and not already_paid and confidence >= 0.8:
                settle_order_pay(
                    db,
                    request_id=request_id,
                    order_id=matched_order.id,
                    payment_method="BANK",
                    paid_amount=amount,
                    bank_ref=ref_no,
                    note=f"Khớp tự động từ sao kê: {desc}",
                    created_by=created_by,
                )
                auto_confirmed_count += 1
                already_paid = True
                msg += " (Đã tự động xác nhận)"

            results.append({
                "statement_ref": ref_no,
                "statement_amount": amount,
                "statement_description": desc,
                "order_id": matched_order.id,
                "order_number": matched_order.order_number,
                "customer_code": matched_order.customer_code,
                "customer_name": matched_order.customer_name,
                "employee_code": matched_order.employee_code,
                "order_amount": float(matched_order.amount),
                "matched": True,
                "confidence": confidence,
                "message": msg,
                "already_paid": already_paid,
            })
        else:
            results.append({
                "statement_ref": ref_no,
                "statement_amount": amount,
                "statement_description": desc,
                "order_id": None,
                "order_number": None,
                "customer_code": None,
                "customer_name": None,
                "employee_code": None,
                "order_amount": None,
                "matched": False,
                "confidence": 0.0,
                "message": "Không tìm thấy đơn hàng khớp với giao dịch",
                "already_paid": False,
            })

    return {
        "total_statements": len(statements),
        "matched_count": matched_count,
        "unmatched_count": len(statements) - matched_count,
        "auto_confirmed_count": auto_confirmed_count,
        "matches": results,
    }


class DeliveryRequestCRUD:
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)
    get = staticmethod(get)
    list_ = staticmethod(list_)
    plan = staticmethod(plan)
    transition = staticmethod(transition)
    available_for_product = staticmethod(available_for_product)
    get_settlement = staticmethod(get_settlement)
    settle_order_pay = staticmethod(settle_order_pay)
    match_statements = staticmethod(match_statements)


delivery_request = DeliveryRequestCRUD()

