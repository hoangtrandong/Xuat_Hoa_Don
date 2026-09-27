from datetime import datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.inventory import (
    DeliveryAllocation, DeliveryRequest, DeliveryRequestItem, InventoryLot,
    InventoryTransaction, Warehouse, WarehouseLocation,
)
from app.models.product import Product
from app.schemas.delivery_request import DeliveryRequestCreate, FefoPlanItem, FefoPlanPick

ACTIVE_STATUSES = ("DRAFT", "SUBMITTED", "RECEIVED")


def _code() -> str:
    return f"DR-{datetime.utcnow():%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"


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
    ), 0)).where(
        InventoryLot.warehouse_id == warehouse_id, InventoryLot.product_id == product_id,
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
    behaviour.
    """
    remaining = int(quantity)
    picks: list[tuple[int | None, int | None, datetime | None, int, str]] = []
    stmt = select(InventoryLot).where(
        InventoryLot.warehouse_id == warehouse_id,
        InventoryLot.product_id == product_id,
        InventoryLot.quantity_on_hand > 0,
        InventoryLot.quantity_on_hand > InventoryLot.locked_quantity,
    ).order_by(
        InventoryLot.expiry_date.is_(None),
        InventoryLot.expiry_date,
        InventoryLot.location_id.is_(None),
        InventoryLot.location_id,
        InventoryLot.id,
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
        )
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
        selectinload(DeliveryRequest.items)
        .selectinload(DeliveryRequestItem.product)
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
        ), 0)).where(
            InventoryLot.warehouse_id == request.warehouse_id,
            InventoryLot.product_id == item.product_id,
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
            request.status, request.completed_at = "COMPLETED", now
        db.commit()
        return get(db, request_id)
    except Exception:
        db.rollback()
        raise


def update(db: Session, request_id: int, payload: DeliveryRequestCreate) -> DeliveryRequest:
    request = db.scalar(select(DeliveryRequest).options(
        selectinload(DeliveryRequest.items)
    ).where(DeliveryRequest.id == request_id).with_for_update())
    if not request:
        raise ValueError("Không tìm thấy yêu cầu xuất kho.")
    if request.status != "DRAFT":
        raise ValueError(f"Chỉ có thể cập nhật yêu cầu ở trạng thái DRAFT. Trạng thái hiện tại: {request.status}")
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

    try:
        request.warehouse_id = payload.warehouse_id
        request.note = payload.note
        
        # Delete old items
        for item in request.items:
            db.delete(item)
        db.flush()
        
        # Create new items
        raw_quantities = {row.product_id: row.requested_quantity_raw for row in payload.items}
        for product_id, quantity in merged.items():
            item = DeliveryRequestItem(request_id=request.id, product_id=product_id, quantity=quantity,
                                       requested_quantity_raw=raw_quantities.get(product_id),
                                       employee_allocations=employee_allocations.get(product_id),
                                       planned_allocations=planned_allocations.get(product_id))
            db.add(item)
        
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


class DeliveryRequestCRUD:
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)
    get = staticmethod(get)
    list_ = staticmethod(list_)
    plan = staticmethod(plan)
    transition = staticmethod(transition)
    available_for_product = staticmethod(available_for_product)


delivery_request = DeliveryRequestCRUD()
