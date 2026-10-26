from sqlalchemy import select, func
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from uuid import uuid4

from app.models.inventory import (
    InventoryTransaction, Warehouse, InventoryLot, WarehouseLocation,
    DeliveryAllocation, DeliveryRequest, DeliveryRequestItem,
    InventoryTransfer, InventoryTransferItem,
)
from app.models.product import Product, ProductUnit, ProductCategory
from app.schemas.inventory import StockAdjust, StockLevel
from app.crud.finance import record_debt_on_sales_export
from app.crud.npp import NppDirectory, canonical_product_id


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


def create_location_transfer(db: Session, payload, created_by: str = "system") -> InventoryTransfer:
    if not db.get(Warehouse, payload.warehouse_id):
        raise ValueError("Không tìm thấy kho.")
    if not payload.items:
        raise ValueError("Phiếu điều chuyển phải có ít nhất một dòng.")
    transfer = InventoryTransfer(
        code=f"LTR-{datetime.utcnow():%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}",
        warehouse_id=payload.warehouse_id, note=payload.note, created_by=created_by,
    )
    for item in payload.items:
        source = db.get(WarehouseLocation, item.source_location_id)
        destination = db.get(WarehouseLocation, item.destination_location_id)
        if not source or source.warehouse_id != payload.warehouse_id or not source.is_active:
            raise ValueError("Vị trí nguồn không thuộc kho hoặc không hoạt động.")
        if not destination or destination.warehouse_id != payload.warehouse_id or not destination.is_active:
            raise ValueError("Vị trí đích không thuộc kho hoặc không hoạt động.")
        if item.source_location_id == item.destination_location_id:
            raise ValueError("Vị trí nguồn và đích phải khác nhau.")
        if item.lot_id:
            lots = [db.get(InventoryLot, item.lot_id)]
        else:
            lots = list(db.scalars(select(InventoryLot).where(
                InventoryLot.warehouse_id == payload.warehouse_id,
                InventoryLot.product_id == item.product_id,
                InventoryLot.location_id == item.source_location_id,
                InventoryLot.quantity_on_hand > 0,
            ).order_by(InventoryLot.expiry_date.asc().nulls_last(), InventoryLot.id)).all())
        lots = [lot for lot in lots if lot and lot.warehouse_id == payload.warehouse_id
                and lot.product_id == item.product_id and lot.location_id == item.source_location_id]
        remaining = item.quantity
        for lot in lots:
            if remaining <= 0:
                break
            allocated = min(remaining, lot.quantity_on_hand - lot.locked_quantity)
            transfer.items.append(InventoryTransferItem(
                product_id=item.product_id, lot_id=lot.id,
                source_location_id=item.source_location_id,
                destination_location_id=item.destination_location_id, quantity=allocated,
            ))
            remaining -= allocated
        if remaining:
            raise ValueError("Tồn theo mã hàng tại vị trí nguồn không đủ số lượng điều chuyển.")
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    return transfer


def confirm_location_transfer(db: Session, transfer_id: int) -> InventoryTransfer:
    transfer = db.get(InventoryTransfer, transfer_id)
    if not transfer:
        raise ValueError("Không tìm thấy phiếu điều chuyển.")
    if transfer.status != "DRAFT":
        raise ValueError("Chỉ phiếu nháp mới được xác nhận.")
    now = datetime.utcnow()
    transfer_code = transfer.code
    for item in transfer.items:
        source_lot = db.scalar(select(InventoryLot).where(
            InventoryLot.id == item.lot_id,
            InventoryLot.location_id == item.source_location_id,
        ).with_for_update())
        if not source_lot or source_lot.quantity_on_hand - source_lot.locked_quantity < item.quantity:
            raise ValueError("Tồn tại vị trí nguồn không đủ để điều chuyển.")
        destination_lot = db.scalar(select(InventoryLot).where(
            InventoryLot.warehouse_id == transfer.warehouse_id,
            InventoryLot.product_id == item.product_id,
            InventoryLot.location_id == item.destination_location_id,
            InventoryLot.lot_number == source_lot.lot_number,
            InventoryLot.expiry_date == source_lot.expiry_date,
        ).with_for_update())
        if not destination_lot:
            destination_lot = InventoryLot(
                warehouse_id=transfer.warehouse_id, product_id=item.product_id,
                location_id=item.destination_location_id, lot_number=source_lot.lot_number,
                expiry_date=source_lot.expiry_date, quantity_on_hand=0,
                unit_cost=source_lot.unit_cost,
            )
            db.add(destination_lot)
            db.flush()
        source_lot.quantity_on_hand -= item.quantity
        destination_lot.quantity_on_hand += item.quantity
        db.add_all([
            InventoryTransaction(
                code=f"{transfer_code}-OUT-{item.id}", type="LOCATION_TRANSFER_OUT",
                warehouse_id=transfer.warehouse_id, product_id=item.product_id,
                quantity=-item.quantity, ref_type="LOCATION_TRANSFER", ref_code=transfer_code,
                note=transfer.note, created_by=transfer.created_by, created_at=now,
                lot_id=source_lot.id, location_id=item.source_location_id,
                expiry_date=source_lot.expiry_date,
            ),
            InventoryTransaction(
                code=f"{transfer_code}-IN-{item.id}", type="LOCATION_TRANSFER_IN",
                warehouse_id=transfer.warehouse_id, product_id=item.product_id,
                quantity=item.quantity, ref_type="LOCATION_TRANSFER", ref_code=transfer_code,
                note=transfer.note, created_by=transfer.created_by, created_at=now,
                lot_id=destination_lot.id, location_id=item.destination_location_id,
                expiry_date=source_lot.expiry_date,
            ),
        ])
    transfer.status = "CONFIRMED"
    transfer.confirmed_at = now
    db.commit()
    db.refresh(transfer)
    return transfer


def adjust_stock(db: Session, obj_in: StockAdjust, created_by: str = "system") -> InventoryTransaction:
    obj_in = obj_in.model_copy(update={"product_id": canonical_product_id(db, obj_in.product_id)})
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
        if qty < 0 and lot.quantity_on_hand - lot.locked_quantity < obj_in.quantity:
            raise ValueError("Số lượng xuất vượt quá tồn khả dụng của lô.")
        lot.quantity_on_hand += qty
    if obj_in.type in ("OUT", "ADJUST"):
        current_stock = db.scalar(
            select(func.coalesce(func.sum(InventoryTransaction.quantity), 0))
            .where(
                InventoryTransaction.product_id == obj_in.product_id,
                InventoryTransaction.warehouse_id == obj_in.warehouse_id,
            )
        )
        locked_stock = db.scalar(
            select(func.coalesce(func.sum(InventoryLot.locked_quantity), 0)).where(
                InventoryLot.product_id == obj_in.product_id,
                InventoryLot.warehouse_id == obj_in.warehouse_id,
            )
        )
        if obj_in.quantity > int(current_stock or 0) - int(locked_stock or 0):
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


def get_stock_levels(
    db: Session,
    warehouse_id: Optional[int] = None,
    category_id: Optional[int] = None,
) -> List[StockLevel]:
    """Tính tồn kho từ inventory_lots (ưu tiên) và inventory_transactions (fallback)."""
    # Subquery: tổng tồn theo lô từ inventory_lots (chỉ tính các vị trí đang hoạt động)
    lot_subquery = (
        select(
            InventoryLot.product_id,
            func.coalesce(func.sum(InventoryLot.quantity_on_hand), 0).label("lot_qty"),
            func.coalesce(func.sum(InventoryLot.locked_quantity), 0).label("locked_qty"),
            func.count(InventoryLot.id).label("lot_count"),
            func.min(InventoryLot.expiry_date).label("earliest_expiry"),
        )
        .join(WarehouseLocation, WarehouseLocation.id == InventoryLot.location_id)
        .where(
            InventoryLot.quantity_on_hand > 0,
            WarehouseLocation.is_active.is_(True),
        )
        .group_by(InventoryLot.product_id)
    )
    if warehouse_id is not None:
        lot_subquery = lot_subquery.where(InventoryLot.warehouse_id == warehouse_id)
    lot_subquery = lot_subquery.subquery()

    # Subquery: danh sách vị trí duy nhất (chỉ tính các vị trí đang hoạt động)
    location_subquery = (
        select(
            InventoryLot.product_id,
            func.string_agg(
                func.distinct(WarehouseLocation.code), ", "
            ).label("locations"),
        )
        .join(WarehouseLocation, WarehouseLocation.id == InventoryLot.location_id)
        .where(
            InventoryLot.quantity_on_hand > 0,
            WarehouseLocation.is_active.is_(True),
        )
        .group_by(InventoryLot.product_id)
    )
    if warehouse_id is not None:
        location_subquery = location_subquery.where(InventoryLot.warehouse_id == warehouse_id)
    location_subquery = location_subquery.subquery()

    # Các yêu cầu xuất hàng đang hoạt động giữ chỗ hàng hóa (cùng trạng thái với delivery_request.py)
    active_statuses = ("DRAFT", "SUBMITTED", "RECEIVED")
    # Subquery: số lượng đã giữ chỗ bởi các yêu cầu xuất đang hoạt động (để tính tồn khả dụng)
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

    # Main query: join với products & categories
    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku.label("product_code"),
            Product.name.label("product_name"),
            Product.category_id.label("category_id"),
            ProductCategory.name.label("category_name"),
            ProductUnit.name.label("unit"),
            Product.reorder_level,
            func.coalesce(lot_subquery.c.lot_qty, 0).label("on_hand"),
            func.coalesce(lot_subquery.c.locked_qty, 0).label("locked_qty"),
            func.coalesce(reserved_subquery.c.reserved_qty, 0).label("reserved_qty"),
            func.coalesce(lot_subquery.c.lot_count, 0).label("lot_count"),
            lot_subquery.c.earliest_expiry,
            location_subquery.c.locations,
        )
        .join(ProductUnit, ProductUnit.id == Product.unit_id)
        .outerjoin(ProductCategory, ProductCategory.id == Product.category_id)
        .outerjoin(lot_subquery, lot_subquery.c.product_id == Product.id)
        .outerjoin(location_subquery, location_subquery.c.product_id == Product.id)
        .outerjoin(reserved_subquery, reserved_subquery.c.product_id == Product.id)
    )
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    stmt = stmt.order_by(Product.sku)
    result = db.execute(stmt)

    directory = NppDirectory(db)
    levels = []
    for row in result.all():
        # Chỉ SKU đại diện của nhóm đứng đại diện cho mã NPP trong tồn kho.
        if directory.is_secondary(row.product_id):
            continue
        npp_code, npp_name = directory.label(row.product_id, row.product_code, row.product_name)
        on_hand = int(row.on_hand or 0)
        locked = int(row.locked_qty or 0)
        reserved = int(row.reserved_qty or 0)
        available = max(0, on_hand - locked - reserved)
        levels.append(StockLevel(
            product_id=row.product_id,
            product_code=npp_code,
            product_name=npp_name,
            category_id=row.category_id,
            category_name=row.category_name,
            category=row.category_name,
            unit=row.unit,
            on_hand=on_hand,
            reserved=reserved,
            available=available,
            locked_quantity=locked,
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