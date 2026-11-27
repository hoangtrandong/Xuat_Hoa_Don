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
from app.models.product import Product, ProductUnit, ProductCategory, ProductCompany, InvoiceProduct
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


def resolve_invoice_products_map(db: Session, product_ids: set[int]) -> dict[int, InvoiceProduct]:
    """Ánh xạ mỗi product_id sang InvoiceProduct (Mã SP XHĐ) tương ứng.

    Ưu tiên Product.invoice_product_id; nếu chưa gán thì fallback sang ProductCompany.invoice_product_id (ưu tiên is_primary).
    """
    if not product_ids:
        return {}
    prod_ip_ids: dict[int, int] = {}
    for pid, ip_id in db.execute(
        select(Product.id, Product.invoice_product_id).where(
            Product.id.in_(product_ids),
            Product.invoice_product_id.is_not(None),
        )
    ).all():
        if ip_id is not None:
            prod_ip_ids[pid] = int(ip_id)

    missing_ids = product_ids - set(prod_ip_ids.keys())
    if missing_ids:
        pc_rows = db.execute(
            select(ProductCompany.product_id, ProductCompany.invoice_product_id, ProductCompany.is_primary)
            .where(
                ProductCompany.product_id.in_(missing_ids),
                ProductCompany.invoice_product_id.is_not(None),
            )
            .order_by(ProductCompany.is_primary.desc(), ProductCompany.id.asc())
        ).all()
        for pid, ip_id, _ in pc_rows:
            if pid not in prod_ip_ids and ip_id is not None:
                prod_ip_ids[pid] = int(ip_id)

    if not prod_ip_ids:
        return {}
    ip_objs = {
        ip.id: ip
        for ip in db.scalars(
            select(InvoiceProduct).where(InvoiceProduct.id.in_(set(prod_ip_ids.values())))
        ).all()
    }
    return {pid: ip_objs[ip_id] for pid, ip_id in prod_ip_ids.items() if ip_id in ip_objs}


def get_stock_levels(
    db: Session,
    warehouse_id: Optional[int] = None,
    category_id: Optional[int] = None,
) -> List[StockLevel]:
    """Tính tồn kho từ inventory_lots và gom/hiển thị theo Mã sản phẩm XHĐ (InvoiceProduct)."""
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
    rows = db.execute(stmt).all()

    directory = NppDirectory(db)
    visible_rows = [row for row in rows if not directory.is_secondary(row.product_id)]
    ip_by_product = resolve_invoice_products_map(db, {row.product_id for row in visible_rows})

    grouped_by_ip: dict[int, dict] = {}
    unmapped_levels: list[StockLevel] = []

    for row in visible_rows:
        on_hand = int(row.on_hand or 0)
        locked = int(row.locked_qty or 0)
        reserved = int(row.reserved_qty or 0)
        lot_count = int(row.lot_count or 0)
        loc_tokens = [tok.strip() for tok in (row.locations or "").split(",") if tok.strip()]

        ip = ip_by_product.get(row.product_id)
        if ip is not None:
            bucket = grouped_by_ip.get(ip.id)
            if bucket is None:
                grouped_by_ip[ip.id] = {
                    "product_id": row.product_id,
                    "invoice_product_id": ip.id,
                    "product_code": ip.code,
                    "product_name": ip.name,
                    "category_id": row.category_id,
                    "category_name": row.category_name,
                    "unit": ip.unit_name or row.unit,
                    "on_hand": on_hand,
                    "reserved": reserved,
                    "locked_quantity": locked,
                    "reorder_level": row.reorder_level or 20,
                    "lot_count": lot_count,
                    "earliest_expiry": row.earliest_expiry,
                    "locations": set(loc_tokens),
                }
            else:
                bucket["on_hand"] += on_hand
                bucket["reserved"] += reserved
                bucket["locked_quantity"] += locked
                bucket["lot_count"] += lot_count
                bucket["locations"].update(loc_tokens)
                if row.earliest_expiry is not None:
                    if bucket["earliest_expiry"] is None or row.earliest_expiry < bucket["earliest_expiry"]:
                        bucket["earliest_expiry"] = row.earliest_expiry
                if not bucket["category_name"] and row.category_name:
                    bucket["category_id"] = row.category_id
                    bucket["category_name"] = row.category_name
        else:
            npp_code, npp_name = directory.label(row.product_id, row.product_code, row.product_name)
            available = max(0, on_hand - locked - reserved)
            unmapped_levels.append(StockLevel(
                product_id=row.product_id,
                product_code=npp_code,
                product_name=npp_name,
                invoice_product_id=None,
                invoice_product_code=None,
                invoice_product_name=None,
                category_id=row.category_id,
                category_name=row.category_name,
                category=row.category_name,
                unit=row.unit,
                on_hand=on_hand,
                reserved=reserved,
                available=available,
                locked_quantity=locked,
                reorder_level=row.reorder_level or 20,
                lot_count=lot_count,
                earliest_expiry=row.earliest_expiry,
                locations=row.locations,
            ))

    # Bổ sung các Mã SP XHĐ đang active chưa gắn Product nào (tồn = 0) khi không lọc category
    if category_id is None:
        all_active_ips = db.scalars(
            select(InvoiceProduct).where(InvoiceProduct.status == "active").order_by(InvoiceProduct.code)
        ).all()
        for ip in all_active_ips:
            if ip.id not in grouped_by_ip:
                grouped_by_ip[ip.id] = {
                    "product_id": -ip.id,
                    "invoice_product_id": ip.id,
                    "product_code": ip.code,
                    "product_name": ip.name,
                    "category_id": None,
                    "category_name": ip.supplier or "SP Xuất HĐ",
                    "unit": ip.unit_name or "Hộp",
                    "on_hand": 0,
                    "reserved": 0,
                    "locked_quantity": 0,
                    "reorder_level": 20,
                    "lot_count": 0,
                    "earliest_expiry": None,
                    "locations": set(),
                }

    levels: list[StockLevel] = []
    for b in grouped_by_ip.values():
        available = max(0, b["on_hand"] - b["locked_quantity"] - b["reserved"])
        locs = ", ".join(sorted(b["locations"])) if b["locations"] else None
        levels.append(StockLevel(
            product_id=b["product_id"],
            product_code=b["product_code"],
            product_name=b["product_name"],
            invoice_product_id=b["invoice_product_id"],
            invoice_product_code=b["product_code"],
            invoice_product_name=b["product_name"],
            category_id=b["category_id"],
            category_name=b["category_name"],
            category=b["category_name"],
            unit=b["unit"],
            on_hand=b["on_hand"],
            reserved=b["reserved"],
            available=available,
            locked_quantity=b["locked_quantity"],
            reorder_level=b["reorder_level"],
            lot_count=b["lot_count"],
            earliest_expiry=b["earliest_expiry"],
            locations=locs,
        ))

    # Chỉ giữ các sản phẩm chưa gán SP XHĐ nếu thực sự có tồn kho hoặc chưa có SP XHĐ nào trong hệ thống
    if levels:
        levels.extend(lv for lv in unmapped_levels if lv.on_hand > 0 or lv.reserved > 0 or lv.locked_quantity > 0)
    else:
        levels.extend(unmapped_levels)

    levels.sort(key=lambda item: (item.product_code or "").upper())
    return levels


class InventoryCRUD:
    list_ = staticmethod(list_transactions)
    adjust = staticmethod(adjust_stock)
    stock_levels = staticmethod(get_stock_levels)


inventory_transaction = InventoryCRUD()