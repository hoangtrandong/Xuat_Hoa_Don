from sqlalchemy import select, func
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from uuid import uuid4

from app.models.inventory import InventoryTransaction, Warehouse, InventoryLot
from app.models.product import Product, ProductUnit
from app.schemas.inventory import StockAdjust, StockLevel


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
    txn = InventoryTransaction(
        code=_generate_code(),
        type=obj_in.type,
        warehouse_id=obj_in.warehouse_id,
        product_id=obj_in.product_id,
        quantity=qty,
        ref_type=obj_in.ref_type or ("SO" if obj_in.type == "OUT" else "ADJ"),
        ref_code=obj_in.ref_code,
        note=obj_in.note,
        created_by=created_by,
        lot_id=lot.id if lot else None, location_id=obj_in.location_id,
        expiry_date=obj_in.expiry_date,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn


def get_stock_levels(db: Session, warehouse_id: Optional[int] = None) -> List[StockLevel]:
    transaction_join = InventoryTransaction.product_id == Product.id
    if warehouse_id is not None:
        transaction_join = (transaction_join & (InventoryTransaction.warehouse_id == warehouse_id))
    result = db.execute(
        select(
            Product.id.label("product_id"),
            Product.sku.label("product_code"),
            Product.name.label("product_name"),
            ProductUnit.name.label("unit"),
            Product.reorder_level,
            func.coalesce(func.sum(InventoryTransaction.quantity), 0).label("on_hand"),
        )
        .join(ProductUnit, ProductUnit.id == Product.unit_id)
        .outerjoin(InventoryTransaction, transaction_join)
        .group_by(Product.id, ProductUnit.name)
    )
    levels = []
    for row in result.all():
        on_hand = int(row.on_hand or 0)
        levels.append(StockLevel(
            product_id=row.product_id,
            product_code=row.product_code,
            product_name=row.product_name,
            unit=row.unit,
            on_hand=on_hand,
            reserved=0,
            available=on_hand,
            reorder_level=row.reorder_level or 20,
        ))
    return levels


class InventoryCRUD:
    list_ = staticmethod(list_transactions)
    adjust = staticmethod(adjust_stock)
    stock_levels = staticmethod(get_stock_levels)


inventory_transaction = InventoryCRUD()