from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.employee import Employee
from app.models.employee_borrow import EmployeeBorrowBatch, EmployeeBorrowEntry
from app.models.inventory import DeliveryAllocation, DeliveryRequest, DeliveryRequestItem
from app.models.product import Product

CENT = Decimal("0.01")


def create_pending_batch(
    db: Session,
    *,
    import_hash: str,
    filename: str,
    entries: list[dict],
    created_by: str | None,
) -> EmployeeBorrowBatch:
    existing = db.scalar(
        select(EmployeeBorrowBatch).where(EmployeeBorrowBatch.import_hash == import_hash)
    )
    if existing:
        if existing.status == "PENDING":
            return existing
        raise ValueError("File này đã được ghi nhận trước đó.")
    if not entries:
        raise ValueError("File không có số lượng vay mượn từ các cột -X.")

    batch = EmployeeBorrowBatch(
        import_hash=import_hash,
        filename=filename[:255],
        status="PENDING",
        created_by=created_by,
    )
    db.add(batch)
    db.flush()
    for entry in entries:
        if entry["quantity"] >= 0 or entry["amount"] > 0:
            raise ValueError("Dòng vay mượn phải có số lượng và thành tiền âm.")
        db.add(EmployeeBorrowEntry(
            batch_id=batch.id,
            employee_id=entry["employee_id"],
            product_id=entry["product_id"],
            entry_type="BORROW",
            quantity=entry["quantity"],
            amount=entry["amount"],
            note=entry.get("note"),
            created_by=created_by,
        ))
    db.flush()
    return batch


def confirm_batch(db: Session, batch_id: int) -> EmployeeBorrowBatch:
    batch = db.scalar(
        select(EmployeeBorrowBatch)
        .options(selectinload(EmployeeBorrowBatch.entries).joinedload(EmployeeBorrowEntry.employee),
                 selectinload(EmployeeBorrowBatch.entries).joinedload(EmployeeBorrowEntry.product))
        .where(EmployeeBorrowBatch.id == batch_id)
        .with_for_update()
    )
    if not batch:
        raise ValueError("Không tìm thấy lần import hàng vay mượn.")
    if batch.status != "PENDING":
        raise ValueError("Lần import này đã được xác nhận hoặc hủy.")
    if not batch.entries:
        raise ValueError("Lần import không có dòng hàng vay mượn.")
    batch.status = "POSTED"
    batch.posted_at = datetime.utcnow()
    db.commit()
    return batch


def cancel_batch(db: Session, batch_id: int) -> None:
    batch = db.scalar(
        select(EmployeeBorrowBatch).where(EmployeeBorrowBatch.id == batch_id).with_for_update()
    )
    if not batch:
        raise ValueError("Không tìm thấy lần import hàng vay mượn.")
    if batch.status != "PENDING":
        raise ValueError("Chỉ có thể hủy lần import đang chờ xác nhận.")
    db.delete(batch)
    db.commit()


def _entry_out(entry: EmployeeBorrowEntry) -> dict:
    return {
        "id": entry.id,
        "entry_type": entry.entry_type,
        "employee_id": entry.employee_id,
        "employee_code": entry.employee.code,
        "employee_name": entry.employee.name,
        "product_id": entry.product_id,
        "product_code": entry.product.npp_code,
        "product_name": entry.product.npp_name,
        "quantity": entry.quantity,
        "amount": float(entry.amount),
        "batch_id": entry.batch_id,
        "source_request_id": entry.source_request_id,
        "source_entry_id": entry.source_entry_id,
        "note": entry.note,
        "created_by": entry.created_by,
        "created_at": entry.created_at,
    }


def list_ledger(db: Session) -> dict:
    posted_batch = (
        (EmployeeBorrowEntry.batch_id.is_(None))
        | (EmployeeBorrowBatch.status == "POSTED")
    )
    rows = db.execute(
        select(
            EmployeeBorrowEntry.employee_id,
            EmployeeBorrowEntry.product_id,
            func.sum(EmployeeBorrowEntry.quantity),
            func.sum(EmployeeBorrowEntry.amount),
        )
        .outerjoin(EmployeeBorrowBatch, EmployeeBorrowBatch.id == EmployeeBorrowEntry.batch_id)
        .where(posted_batch)
        .group_by(EmployeeBorrowEntry.employee_id, EmployeeBorrowEntry.product_id)
    ).all()
    employee_ids = {row[0] for row in rows}
    product_ids = {row[1] for row in rows}
    employees = {
        employee.id: employee for employee in db.scalars(
            select(Employee).where(Employee.id.in_(employee_ids))
        ).all()
    } if employee_ids else {}
    products = {
        product.id: product for product in db.scalars(
            select(Product).where(Product.id.in_(product_ids))
        ).all()
    } if product_ids else {}
    balances = []
    for employee_id, product_id, quantity, amount in rows:
        quantity = int(quantity or 0)
        amount = Decimal(amount or 0)
        if quantity == 0 and amount == 0:
            continue
        employee = employees[employee_id]
        product = products[product_id]
        balances.append({
            "employee_id": employee_id,
            "employee_code": employee.code,
            "employee_name": employee.name,
            "product_id": product_id,
            "product_code": product.npp_code,
            "product_name": product.npp_name,
            "quantity": quantity,
            "amount": float(amount),
        })
    balances.sort(key=lambda row: (row["employee_code"], row["product_code"]))

    history = db.scalars(
        select(EmployeeBorrowEntry)
        .options(joinedload(EmployeeBorrowEntry.employee), joinedload(EmployeeBorrowEntry.product))
        .outerjoin(EmployeeBorrowBatch, EmployeeBorrowBatch.id == EmployeeBorrowEntry.batch_id)
        .where(posted_batch)
        .order_by(EmployeeBorrowEntry.created_at.desc(), EmployeeBorrowEntry.id.desc())
        .limit(500)
    ).unique().all()
    batches = db.scalars(
        select(EmployeeBorrowBatch)
        .where(EmployeeBorrowBatch.status == "PENDING")
        .order_by(EmployeeBorrowBatch.created_at.desc())
    ).all()
    return {
        "balances": balances,
        "entries": [_entry_out(entry) for entry in history],
        "pending_batches": [
            {
                "id": batch.id,
                "filename": batch.filename,
                "created_by": batch.created_by,
                "created_at": batch.created_at,
                "entries": [
                    _entry_out(entry)
                    for entry in db.scalars(
                        select(EmployeeBorrowEntry)
                        .options(joinedload(EmployeeBorrowEntry.employee), joinedload(EmployeeBorrowEntry.product))
                        .where(EmployeeBorrowEntry.batch_id == batch.id)
                        .order_by(EmployeeBorrowEntry.id)
                    ).unique().all()
                ],
            }
            for batch in batches
        ],
    }


def offset_completed_delivery(db: Session, request: DeliveryRequest, now: datetime) -> None:
    if not request.items:
        return
    employee_by_code = {
        employee.code.upper(): employee
        for employee in db.scalars(select(Employee)).all()
    }
    for item in request.items:
        actual_quantity = sum(allocation.allocated_quantity for allocation in item.allocations)
        remaining_shipped = actual_quantity
        employee_allocations = item.employee_allocations or {}
        for employee_code, allocation in employee_allocations.items():
            if remaining_shipped <= 0:
                break
            employee = employee_by_code.get(str(employee_code).strip().upper())
            if not employee:
                continue
            if isinstance(allocation, dict):
                try:
                    employee_quantity = int(allocation.get("quantity", 0))
                except (TypeError, ValueError):
                    continue
            else:
                try:
                    employee_quantity = int(allocation)
                except (TypeError, ValueError):
                    continue
            if employee_quantity <= 0:
                continue
            assigned_quantity = min(employee_quantity, remaining_shipped)
            remaining_shipped -= assigned_quantity
            quantity_to_offset = assigned_quantity
            borrow_entries = db.scalars(
                select(EmployeeBorrowEntry)
                .join(EmployeeBorrowBatch, EmployeeBorrowBatch.id == EmployeeBorrowEntry.batch_id)
                .where(
                    EmployeeBorrowEntry.employee_id == employee.id,
                    EmployeeBorrowEntry.product_id == item.product_id,
                    EmployeeBorrowEntry.entry_type == "BORROW",
                    EmployeeBorrowBatch.status == "POSTED",
                )
                .order_by(EmployeeBorrowEntry.created_at, EmployeeBorrowEntry.id)
                .with_for_update()
            ).all()
            for borrowed in borrow_entries:
                if quantity_to_offset <= 0:
                    break
                previous = db.execute(
                    select(
                        func.coalesce(func.sum(EmployeeBorrowEntry.quantity), 0),
                        func.coalesce(func.sum(EmployeeBorrowEntry.amount), 0),
                    ).where(EmployeeBorrowEntry.source_entry_id == borrowed.id)
                ).one()
                outstanding_quantity = abs(borrowed.quantity) - int(previous[0] or 0)
                outstanding_amount = abs(Decimal(borrowed.amount)) - Decimal(previous[1] or 0)
                if outstanding_quantity <= 0:
                    continue
                offset_quantity = min(quantity_to_offset, outstanding_quantity)
                if offset_quantity == outstanding_quantity:
                    offset_amount = max(Decimal("0"), outstanding_amount)
                else:
                    offset_amount = (
                        abs(Decimal(borrowed.amount)) * Decimal(offset_quantity) / abs(borrowed.quantity)
                    ).quantize(CENT, rounding=ROUND_HALF_UP)
                    offset_amount = min(offset_amount, max(Decimal("0"), outstanding_amount))
                db.add(EmployeeBorrowEntry(
                    employee_id=employee.id,
                    product_id=item.product_id,
                    entry_type="OFFSET",
                    quantity=offset_quantity,
                    amount=offset_amount,
                    source_entry_id=borrowed.id,
                    source_request_id=request.id,
                    note=f"Bù trừ xuất kho thực tế phiếu {request.code}",
                    created_by=request.created_by,
                    created_at=now,
                ))
                quantity_to_offset -= offset_quantity
