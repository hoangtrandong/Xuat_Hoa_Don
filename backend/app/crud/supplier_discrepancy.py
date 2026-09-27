from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.inventory import (
    InventoryLot,
    SupplierGoodsDiscrepancy,
    SupplierGoodsDiscrepancyOffset,
    SupplierGoodsDiscrepancySource,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def remaining_quantity(db: Session, discrepancy: SupplierGoodsDiscrepancy) -> int:
    if discrepancy.type == "SHORTAGE":
        offset_column = SupplierGoodsDiscrepancyOffset.shortage_id
    else:
        offset_column = SupplierGoodsDiscrepancyOffset.excess_id
    offset_quantity = db.scalar(
        select(func.coalesce(func.sum(SupplierGoodsDiscrepancyOffset.quantity), 0)).where(
            offset_column == discrepancy.id
        )
    )
    return discrepancy.quantity - int(offset_quantity or 0)


def _update_status(db: Session, discrepancy: SupplierGoodsDiscrepancy) -> None:
    remaining = remaining_quantity(db, discrepancy)
    if remaining <= 0:
        discrepancy.status = "RESOLVED"
    elif remaining < discrepancy.quantity:
        discrepancy.status = "PARTIAL"
    else:
        discrepancy.status = "OPEN"


def discrepancy_response(db: Session, discrepancy: SupplierGoodsDiscrepancy) -> dict:
    return {
        "id": discrepancy.id,
        "warehouse_id": discrepancy.warehouse_id,
        "product_id": discrepancy.product_id,
        "type": discrepancy.type,
        "document_quantity": discrepancy.document_quantity,
        "actual_quantity": discrepancy.actual_quantity,
        "quantity": discrepancy.quantity,
        "remaining_quantity": remaining_quantity(db, discrepancy),
        "lot_number": discrepancy.lot_number,
        "expiry_date": discrepancy.expiry_date,
        "invoice_number": discrepancy.invoice_number,
        "ref_code": discrepancy.ref_code,
        "document_date": discrepancy.document_date,
        "note": discrepancy.note,
        "created_by": discrepancy.created_by,
        "created_at": discrepancy.created_at,
        "status": discrepancy.status,
    }


def list_discrepancies(
    db: Session,
    warehouse_id: int | None = None,
    product_id: int | None = None,
    discrepancy_type: str | None = None,
    status: str | None = None,
) -> list[dict]:
    stmt = select(SupplierGoodsDiscrepancy).order_by(
        SupplierGoodsDiscrepancy.created_at.desc(), SupplierGoodsDiscrepancy.id.desc()
    )
    if warehouse_id is not None:
        stmt = stmt.where(SupplierGoodsDiscrepancy.warehouse_id == warehouse_id)
    if product_id is not None:
        stmt = stmt.where(SupplierGoodsDiscrepancy.product_id == product_id)
    if discrepancy_type is not None:
        stmt = stmt.where(SupplierGoodsDiscrepancy.type == discrepancy_type.upper())
    if status is not None:
        stmt = stmt.where(SupplierGoodsDiscrepancy.status == status.upper())
    return [discrepancy_response(db, row) for row in db.scalars(stmt).all()]


def discrepancy_history(db: Session, discrepancy_id: int) -> dict | None:
    discrepancy = db.get(SupplierGoodsDiscrepancy, discrepancy_id)
    if not discrepancy:
        return None
    sources = db.scalars(select(SupplierGoodsDiscrepancySource).where(
        SupplierGoodsDiscrepancySource.discrepancy_id == discrepancy_id
    ).order_by(SupplierGoodsDiscrepancySource.id)).all()
    offsets = db.scalars(select(SupplierGoodsDiscrepancyOffset).where(
        or_(
            SupplierGoodsDiscrepancyOffset.shortage_id == discrepancy_id,
            SupplierGoodsDiscrepancyOffset.excess_id == discrepancy_id,
        )
    ).order_by(
        SupplierGoodsDiscrepancyOffset.created_at, SupplierGoodsDiscrepancyOffset.id
    )).all()
    offset_history = []
    for offset in offsets:
        shortage = db.get(SupplierGoodsDiscrepancy, offset.shortage_id)
        excess = db.get(SupplierGoodsDiscrepancy, offset.excess_id)
        offset_history.append({
            "id": offset.id,
            "shortage_id": offset.shortage_id,
            "excess_id": offset.excess_id,
            "quantity": offset.quantity,
            "note": offset.note,
            "created_by": offset.created_by,
            "created_at": offset.created_at,
            "shortage_invoice_number": shortage.invoice_number if shortage else None,
            "excess_invoice_number": excess.invoice_number if excess else None,
        })
    return {
        "discrepancy": discrepancy_response(db, discrepancy),
        "sources": sources,
        "offsets": offset_history,
    }


def suggest_offsets(db: Session, discrepancy_id: int) -> list[dict]:
    discrepancy = db.get(SupplierGoodsDiscrepancy, discrepancy_id)
    if not discrepancy:
        raise ValueError("Không tìm thấy chênh lệch hàng nhà cung cấp.")
    current_remaining = remaining_quantity(db, discrepancy)
    if current_remaining <= 0:
        return []
    opposite_type = "EXCESS" if discrepancy.type == "SHORTAGE" else "SHORTAGE"
    candidates = db.scalars(select(SupplierGoodsDiscrepancy).where(
        SupplierGoodsDiscrepancy.id != discrepancy.id,
        SupplierGoodsDiscrepancy.warehouse_id == discrepancy.warehouse_id,
        SupplierGoodsDiscrepancy.product_id == discrepancy.product_id,
        SupplierGoodsDiscrepancy.type == opposite_type,
        SupplierGoodsDiscrepancy.status.in_(("OPEN", "PARTIAL")),
    ).order_by(SupplierGoodsDiscrepancy.created_at, SupplierGoodsDiscrepancy.id)).all()
    suggestions = []
    for candidate in candidates:
        candidate_remaining = remaining_quantity(db, candidate)
        if candidate_remaining <= 0:
            continue
        response = discrepancy_response(db, candidate)
        response["suggested_quantity"] = min(current_remaining, candidate_remaining)
        suggestions.append(response)
    return suggestions


def confirm_offset(db: Session, payload) -> SupplierGoodsDiscrepancyOffset:
    if payload.shortage_id == payload.excess_id:
        raise ValueError("Không thể cân trừ cùng một chênh lệch.")
    ids = sorted((payload.shortage_id, payload.excess_id))
    discrepancies = db.scalars(select(SupplierGoodsDiscrepancy).where(
        SupplierGoodsDiscrepancy.id.in_(ids)
    ).order_by(SupplierGoodsDiscrepancy.id).with_for_update()).all()
    by_id = {row.id: row for row in discrepancies}
    shortage = by_id.get(payload.shortage_id)
    excess = by_id.get(payload.excess_id)
    if not shortage or not excess:
        raise ValueError("Không tìm thấy chênh lệch cần cân trừ.")
    if shortage.type != "SHORTAGE" or excess.type != "EXCESS":
        raise ValueError("Cần chọn một chênh lệch thiếu và một chênh lệch thừa.")
    if remaining_quantity(db, shortage) <= 0 or remaining_quantity(db, excess) <= 0:
        raise ValueError("Chỉ có thể cân trừ chênh lệch còn số lượng.")
    if (shortage.product_id, shortage.warehouse_id) != (excess.product_id, excess.warehouse_id):
        raise ValueError("Chỉ có thể cân trừ cùng sản phẩm trong cùng kho.")
    if payload.quantity > min(remaining_quantity(db, shortage), remaining_quantity(db, excess)):
        raise ValueError("Số lượng cân trừ vượt quá số lượng chênh lệch còn lại.")

    sources = db.scalars(select(SupplierGoodsDiscrepancySource).where(
        SupplierGoodsDiscrepancySource.discrepancy_id == excess.id,
        SupplierGoodsDiscrepancySource.released_quantity < SupplierGoodsDiscrepancySource.quantity,
    ).order_by(SupplierGoodsDiscrepancySource.id).with_for_update()).all()
    remaining_to_release = payload.quantity
    for source in sources:
        release = min(
            remaining_to_release, source.quantity - source.released_quantity
        )
        if not release:
            continue
        lot = db.scalar(select(InventoryLot).where(
            InventoryLot.id == source.lot_id
        ).with_for_update())
        if not lot or lot.locked_quantity < release:
            raise ValueError("Số lượng hàng đang khóa không đủ để cân trừ.")
        source.released_quantity += release
        lot.locked_quantity -= release
        remaining_to_release -= release
        if not remaining_to_release:
            break
    if remaining_to_release:
        raise ValueError("Không tìm thấy đủ hàng đang khóa làm nguồn cân trừ.")

    offset = SupplierGoodsDiscrepancyOffset(
        shortage_id=shortage.id,
        excess_id=excess.id,
        quantity=payload.quantity,
        note=payload.note,
        created_by=payload.created_by,
        created_at=_utcnow(),
    )
    db.add(offset)
    db.flush()
    _update_status(db, shortage)
    _update_status(db, excess)
    db.commit()
    db.refresh(offset)
    return offset


def create_import_discrepancy(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    document_quantity: int,
    actual_quantity: int,
    lot_number: str,
    expiry_date,
    invoice_number: str | None,
    ref_code: str | None,
    document_date,
    note: str | None,
    created_by: str | None,
    allocated_lots: list[tuple[InventoryLot, int]],
) -> SupplierGoodsDiscrepancy | None:
    difference = actual_quantity - document_quantity
    if difference == 0:
        return None
    discrepancy = SupplierGoodsDiscrepancy(
        warehouse_id=warehouse_id,
        product_id=product_id,
        type="EXCESS" if difference > 0 else "SHORTAGE",
        document_quantity=document_quantity,
        actual_quantity=actual_quantity,
        quantity=abs(difference),
        lot_number=lot_number,
        expiry_date=expiry_date,
        invoice_number=invoice_number,
        ref_code=ref_code,
        document_date=document_date,
        note=note,
        created_by=created_by,
        created_at=_utcnow(),
        status="OPEN",
    )
    db.add(discrepancy)
    db.flush()
    if difference > 0:
        locked_remaining = difference
        for lot, allocated_quantity in allocated_lots:
            lock_quantity = min(locked_remaining, allocated_quantity)
            if lock_quantity <= 0:
                continue
            lot.locked_quantity += lock_quantity
            discrepancy.sources.append(SupplierGoodsDiscrepancySource(
                lot=lot, quantity=lock_quantity, released_quantity=0,
            ))
            locked_remaining -= lock_quantity
            if locked_remaining == 0:
                break
        if locked_remaining:
            raise ValueError("Phân bổ thực nhận không đủ để khóa số hàng thừa.")
    return discrepancy
