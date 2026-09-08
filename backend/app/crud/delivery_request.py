from datetime import datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.inventory import (
    DeliveryAllocation, DeliveryRequest, DeliveryRequestItem, InventoryLot,
    InventoryTransaction, Warehouse,
)
from app.models.product import Product
from app.schemas.delivery_request import DeliveryRequestCreate

ACTIVE_STATUSES = ("DRAFT", "SUBMITTED", "RECEIVED")


def _code() -> str:
    return f"DR-{datetime.utcnow():%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"


def _reserved_for_lot(db, lot_id: int, exclude_request_id=None) -> int:
    stmt = (select(func.coalesce(func.sum(DeliveryAllocation.allocated_quantity), 0))
            .join(DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id)
            .where(DeliveryAllocation.lot_id == lot_id,
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


def available_for_product(db: Session, warehouse_id: int, product_id: int) -> int:
    lot_stock = db.scalar(select(func.coalesce(func.sum(InventoryLot.quantity_on_hand), 0)).where(
        InventoryLot.warehouse_id == warehouse_id, InventoryLot.product_id == product_id,
    )) or 0
    return int(lot_stock) + _legacy_available(db, warehouse_id, product_id)


def _allocate(db: Session, request: DeliveryRequest, item: DeliveryRequestItem) -> None:
    # Rebuild reservations, using earliest expiry first. Null expiry is last.
    item.allocations.clear()
    remaining = item.quantity
    lots = db.scalars(select(InventoryLot).where(
        InventoryLot.warehouse_id == request.warehouse_id,
        InventoryLot.product_id == item.product_id,
        InventoryLot.quantity_on_hand > 0,
    ).order_by(InventoryLot.expiry_date.is_(None), InventoryLot.expiry_date, InventoryLot.id)
    .with_for_update()).all()
    for lot in lots:
        free = lot.quantity_on_hand - _reserved_for_lot(db, lot.id, request.id)
        if free <= 0:
            continue
        take = min(remaining, free)
        item.allocations.append(DeliveryAllocation(
            allocated_quantity=take, allocation_sequence=len(item.allocations) + 1,
            allocation_strategy="FEFO", lot_id=lot.id, location_id=lot.location_id,
            expiry_date=lot.expiry_date,
        ))
        remaining -= take
        if not remaining:
            break
    if remaining:
        legacy = _legacy_available(db, request.warehouse_id, item.product_id, request.id)
        if legacy >= remaining:
            item.allocations.append(DeliveryAllocation(
                allocated_quantity=remaining, allocation_sequence=len(item.allocations) + 1,
                allocation_strategy="LEGACY_STOCK"))
            remaining = 0
    if remaining:
        product = db.get(Product, item.product_id)
        raise ValueError(f"Sản phẩm {product.sku if product else item.product_id} không đủ tồn kho.")


def create(db: Session, payload: DeliveryRequestCreate) -> DeliveryRequest:
    if not db.get(Warehouse, payload.warehouse_id):
        raise ValueError("Không tìm thấy kho.")
    merged = {}
    employee_allocations = {}
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
    request = DeliveryRequest(code=_code(), warehouse_id=payload.warehouse_id,
                              note=payload.note, created_by=payload.created_by)
    try:
        db.add(request)
        db.flush()
        raw_quantities = {row.product_id: row.requested_quantity_raw for row in payload.items}
        for product_id, quantity in merged.items():
            item = DeliveryRequestItem(request_id=request.id, product_id=product_id, quantity=quantity,
                                       requested_quantity_raw=raw_quantities.get(product_id),
                                       employee_allocations=employee_allocations.get(product_id))
            db.add(item)
            db.flush()
        db.commit()
        return get(db, request.id)
    except Exception:
        db.rollback()
        raise


def get(db: Session, request_id: int):
    request = db.scalar(select(DeliveryRequest).options(
        selectinload(DeliveryRequest.items).selectinload(DeliveryRequestItem.allocations)
    ).where(DeliveryRequest.id == request_id))
    return _with_stock(db, request)


def list_(db: Session, status: str | None = None):
    stmt = select(DeliveryRequest).options(
        selectinload(DeliveryRequest.items)
    ).order_by(DeliveryRequest.created_at.desc())
    if status:
        stmt = stmt.where(DeliveryRequest.status == status.upper())
    # The list view only needs request metadata. Stock is loaded by the
    # detail endpoint to avoid one aggregate query per item over Neon.
    return list(db.scalars(stmt).all())


def _with_stock(db: Session, request: DeliveryRequest | None):
    if request is None:
        return None
    for item in request.items:
        available = _legacy_available(db, request.warehouse_id, item.product_id, request.id)
        lot_stock = db.scalar(select(func.coalesce(func.sum(InventoryLot.quantity_on_hand), 0)).where(
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
    expected = {"submit": "DRAFT", "receive": "SUBMITTED", "complete": "RECEIVED"}
    if action not in expected or request.status != expected[action]:
        raise ValueError(f"Không thể {action} khi yêu cầu đang ở trạng thái {request.status}.")
    now = datetime.utcnow()
    try:
        if action == "submit":
            for item in request.items:
                _allocate(db, request, item)
            request.status, request.submitted_at = "SUBMITTED", now
        elif action == "receive":
            request.status, request.received_at = "RECEIVED", now
        else:
            for item in request.items:
                for allocation in item.allocations:
                    qty = allocation.allocated_quantity
                    if allocation.lot_id:
                        lot = db.scalar(select(InventoryLot).where(
                            InventoryLot.id == allocation.lot_id).with_for_update())
                        if not lot or lot.quantity_on_hand < qty:
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


class DeliveryRequestCRUD:
    create = staticmethod(create)
    get = staticmethod(get)
    list_ = staticmethod(list_)
    transition = staticmethod(transition)
    available_for_product = staticmethod(available_for_product)


delivery_request = DeliveryRequestCRUD()
