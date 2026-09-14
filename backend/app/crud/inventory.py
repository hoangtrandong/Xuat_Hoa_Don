from sqlalchemy import select, func
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from uuid import uuid4

from app.models.inventory import (
    InventoryTransaction, Warehouse, InventoryLot, WarehouseLocation,
    DeliveryAllocation, DeliveryRequest, DeliveryRequestItem,
)
from app.models.product import Product, ProductUnit
from app.schemas.inventory import StockAdjust, StockLevel
from app.crud.finance import record_debt_on_sales_export


def _generate_code() -> str:
    ts = datetime.utcnow()
    return f"ITT-{ts:%y%m%d}-{ts:%H%M%S}-{uuid4().hex[:6].upper()}"


def list_transactions(db: Session, skip: int = 0, limit: int = 100, product_id: Optional[int] = None, txn_type: Optional[str] = None) -> List[InventoryTransaction]:
    stmt = select(InventoryTransaction).order_by(InventoryTransaction.created_at.desc()).offset(skip).limit(limit)
    if product_id:
        stmt = stmt.where(InventoryTransaction.product_id == product_id)
    if txn_type:
        stmt = stmt.where(InventoryTransaction.type == txn_type)
    return list(db.execute(stmt).scalars().all())


def adjust_stock(db: Session, obj_in: StockAdjust, created_by: str = "system") -> InventoryTransaction:
    product = db.get(Product, obj_in.product_id)
    if not product:
        raise ValueError("Không tìm thấy sản phẩm.")
    if not db.get(Warehouse, obj_in.warehouse_id):
        raise ValueError("Không tìm thấy kho.")
    if obj_in.quantity < 1:
        raise ValueError("Số lượng phải lớn hơn 0.")
    qty = obj_in.quantity if obj_in.type in ("IN", "OPENING") else -obj_in.quantity
    lot = None
    if obj_in.lot_number is not None or obj_in.location_id is not None or obj_in.expiry_date is not None:
        lot = db.scalar(select(InventoryLot).where(
            InventoryLot.warehouse_id == obj_in.warehouse_id,
            InventoryLot.product_id == obj_in.product_id,
            InventoryLot.lot_number == obj_in.lot_number if obj_in.lot_number else InventoryLot.lot_number.is_(None),
            InventoryLot.location_id == obj_in.location_id,
            InventoryLot.expiry_date == obj_in.expiry_date,
        ).with_for_update())
        if not lot:
            lot = InventoryLot(
                warehouse_id=obj_in.warehouse_id, product_id=obj_in.product_id,
                lot_number=obj_in.lot_number, location_id=obj_in.location_id,
                expiry_date=obj_in.expiry_date, quantity_on_hand=0,
                unit_cost=obj_in.unit_cost)
            db.add(lot)
            db.flush()
        if obj_in.expiry_date is not None:
            lot.expiry_date = obj_in.expiry_date
        if qty < 0 and lot.quantity_on_hand < obj_in.quantity:
            raise ValueError("Số lượng xuất vượt quá tồn lô.")
        lot.quantity_on_hand += qty
    if obj_in.type in ("OUT", "ADJUST"):
        current_stock = db.scalar(
            select(func.coalesce(func.sum(InventoryTransaction.quantity), 0))
            .where(
                InventoryTransaction.product_id == obj_in.product_id,
                InventoryTransaction.warehouse_id == obj_in.warehouse_id,
            )
        )
        if obj_in.quantity > int(current_stock or 0):
            raise ValueError("Số lượng xuất vượt quá tồn kho.")
    ref_type = obj_in.ref_type or ("SO" if obj_in.type == "OUT" else "ADJ")
    txn = InventoryTransaction(
        code=_generate_code(),
        type=obj_in.type,
        warehouse_id=obj_in.warehouse_id,
        product_id=obj_in.product_id,
        quantity=qty,
        ref_type=ref_type,
        ref_code=obj_in.ref_code,
        note=obj_in.note,
        created_by=created_by,
        lot_id=lot.id if lot else None, location_id=obj_in.location_id,
        expiry_date=obj_in.expiry_date,
    )
    db.add(txn)
    db.flush()
    # Công nợ khách hàng: ghi khi thủ kho xuất kho thành công gắn đơn bán.
    if obj_in.type == "OUT" and (ref_type or "").upper() == "SO":
        record_debt_on_sales_export(db, obj_in.ref_code)
    db.commit()
    db.refresh(txn)
    return txn


def get_stock_levels(db: Session, warehouse_id: Optional[int] = None) -> List[StockLevel]:
    """Tính tồn kho từ inventory_lots (ưu tiên) và inventory_transactions (fallback)."""
    # Subquery: tổng tồn theo lô từ inventory_lots
    lot_subquery = (
        select(
            InventoryLot.product_id,
            func.coalesce(func.sum(InventoryLot.quantity_on_hand), 0).label("lot_qty"),
            func.count(InventoryLot.id).label("lot_count"),
            func.min(InventoryLot.expiry_date).label("earliest_expiry"),
        )
        .where(InventoryLot.quantity_on_hand > 0)
        .group_by(InventoryLot.product_id)
    )
    if warehouse_id is not None:
        lot_subquery = lot_subquery.where(InventoryLot.warehouse_id == warehouse_id)
    lot_subquery = lot_subquery.subquery()

    # Subquery: danh sách vị trí duy nhất
    location_subquery = (
        select(
            InventoryLot.product_id,
            func.string_agg(
                func.distinct(WarehouseLocation.code), ", "
            ).label("locations"),
        )
        .join(WarehouseLocation, WarehouseLocation.id == InventoryLot.location_id)
        .where(InventoryLot.quantity_on_hand > 0)
        .group_by(InventoryLot.product_id)
    )
    if warehouse_id is not None:
        location_subquery = location_subquery.where(InventoryLot.warehouse_id == warehouse_id)
    location_subquery = location_subquery.subquery()

    # Aktywne yêu cầu, które rezerwują towar (te same statusy co w delivery_request.py)
    active_statuses = ("DRAFT", "SUBMITTED", "RECEIVED")
    # Subquery: ilość zarezerwowana przez aktywne yêu cầu (do policzenia stanu netto)
    reserved_subquery = (
        select(
            DeliveryRequestItem.product_id,
            func.coalesce(func.sum(DeliveryAllocation.allocated_quantity), 0).label("reserved_qty"),
        )
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id)
        .join(DeliveryAllocation, DeliveryAllocation.item_id == DeliveryRequestItem.id)
        .where(DeliveryRequest.status.in_(active_statuses))
    )
    if warehouse_id is not None:
        reserved_subquery = reserved_subquery.where(DeliveryRequest.warehouse_id == warehouse_id)
    reserved_subquery = reserved_subquery.group_by(DeliveryRequestItem.product_id).subquery()

    # Main query: join với products
    result = db.execute(
        select(
            Product.id.label("product_id"),
            Product.sku.label("product_code"),
            Product.name.label("product_name"),
            ProductUnit.name.label("unit"),
            Product.reorder_level,
            func.coalesce(lot_subquery.c.lot_qty, 0).label("on_hand"),
            func.coalesce(reserved_subquery.c.reserved_qty, 0).label("reserved_qty"),
            func.coalesce(lot_subquery.c.lot_count, 0).label("lot_count"),
            lot_subquery.c.earliest_expiry,
            location_subquery.c.locations,
        )
        .join(ProductUnit, ProductUnit.id == Product.unit_id)
        .outerjoin(lot_subquery, lot_subquery.c.product_id == Product.id)
        .outerjoin(location_subquery, location_subquery.c.product_id == Product.id)
        .outerjoin(reserved_subquery, reserved_subquery.c.product_id == Product.id)
        .order_by(Product.sku)
    )

    levels = []
    for row in result.all():
        on_hand = int(row.on_hand or 0)
        reserved = int(row.reserved_qty or 0)
        available = max(0, on_hand - reserved)
        levels.append(StockLevel(
            product_id=row.product_id,
            product_code=row.product_code,
            product_name=row.product_name,
            unit=row.unit,
            on_hand=on_hand,
            reserved=reserved,
            available=available,
            reorder_level=row.reorder_level or 20,
            lot_count=int(row.lot_count or 0),
            earliest_expiry=row.earliest_expiry,
            locations=row.locations,
        ))
    return levels


class InventoryCRUD:
    list_ = staticmethod(list_transactions)
    adjust = staticmethod(adjust_stock)
    stock_levels = staticmethod(get_stock_levels)


inventory_transaction = InventoryCRUD()