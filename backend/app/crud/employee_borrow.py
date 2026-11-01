from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.employee import Employee
from app.models.employee_borrow import EmployeeBorrowBatch, EmployeeBorrowEntry
from app.models.inventory import DeliveryRequest
from app.models.product import Product

CENT = Decimal("0.01")


def create_posted_batch(
    db: Session,
    *,
    import_hash: str,
    filename: str,
    entries: list[dict],
    created_by: str | None,
    source_request_id: int | None = None,
) -> EmployeeBorrowBatch:
    """Ghi nhận ngay các dòng Mượn Số (-SL, -Tiền) vào sổ Hàng vay mượn NVBH (status=POSTED)."""
    existing = db.scalar(
        select(EmployeeBorrowBatch).where(EmployeeBorrowBatch.import_hash == import_hash)
    )
    if existing:
        if existing.status == "PENDING":
            existing.status = "POSTED"
            existing.posted_at = datetime.utcnow()
            db.flush()
            return existing
        raise ValueError("File này đã được ghi nhận Mượn Số trước đó.")
    if not entries:
        raise ValueError("File không có dữ liệu đơn Mượn Số.")

    now = datetime.utcnow()
    batch = EmployeeBorrowBatch(
        import_hash=import_hash,
        filename=filename[:255],
        status="POSTED",
        created_by=created_by,
        posted_at=now,
    )
    db.add(batch)
    db.flush()
    for entry in entries:
        if entry["quantity"] >= 0 or entry["amount"] > 0:
            raise ValueError("Dòng Mượn Số phải có số lượng và thành tiền âm.")
        external_employee_code = (entry.get("external_employee_code") or "").strip().upper() or None
        if entry.get("employee_id") is None and external_employee_code is None:
            raise ValueError("Dòng Mượn Số thiếu mã nhân viên nội bộ hoặc mã NVBH trên DMS.")
        db.add(EmployeeBorrowEntry(
            batch_id=batch.id,
            employee_id=entry.get("employee_id"),
            external_employee_code=external_employee_code,
            external_employee_name=(entry.get("external_employee_name") or "").strip() or None,
            product_id=entry["product_id"],
            entry_type="BORROW",
            quantity=entry["quantity"],
            amount=entry["amount"],
            source_request_id=source_request_id,
            note=entry.get("note"),
            created_by=created_by,
            created_at=now,
        ))
    db.flush()
    return batch


def create_pending_batch(
    db: Session,
    *,
    import_hash: str,
    filename: str,
    entries: list[dict],
    created_by: str | None,
    source_request_id: int | None = None,
) -> EmployeeBorrowBatch:
    """Giữ hàm tương thích nhưng mặc định ghi nhận ngay Mượn Số (POSTED) theo nghiệp vụ mới."""
    return create_posted_batch(
        db,
        import_hash=import_hash,
        filename=filename,
        entries=entries,
        created_by=created_by,
        source_request_id=source_request_id,
    )


def rollback_request_borrows(db: Session, request_id: int) -> None:
    """Khi hủy hoặc xóa phiếu yêu cầu xuất kho chưa hoàn tất, hoàn tác các dòng Mượn Số gắn với phiếu đó."""
    entries = db.scalars(
        select(EmployeeBorrowEntry).where(
            EmployeeBorrowEntry.source_request_id == request_id,
            EmployeeBorrowEntry.entry_type == "BORROW",
        )
    ).all()
    if not entries:
        return
    batch_ids = {entry.batch_id for entry in entries if entry.batch_id is not None}
    for entry in entries:
        db.delete(entry)
    db.flush()
    for batch_id in batch_ids:
        remaining = db.scalar(
            select(func.count(EmployeeBorrowEntry.id)).where(EmployeeBorrowEntry.batch_id == batch_id)
        ) or 0
        if remaining == 0:
            batch = db.get(EmployeeBorrowBatch, batch_id)
            if batch:
                db.delete(batch)
    db.flush()


def confirm_batch(db: Session, batch_id: int) -> EmployeeBorrowBatch:
    batch = db.scalar(
        select(EmployeeBorrowBatch)
        .options(selectinload(EmployeeBorrowBatch.entries).joinedload(EmployeeBorrowEntry.employee),
                 selectinload(EmployeeBorrowBatch.entries).joinedload(EmployeeBorrowEntry.product))
        .where(EmployeeBorrowBatch.id == batch_id)
        .with_for_update()
    )
    if not batch:
        raise ValueError("Không tìm thấy lần ghi nhận hàng vay mượn.")
    if batch.status == "POSTED":
        return batch
    if batch.status != "PENDING":
        raise ValueError("Lần ghi nhận này đã được xử lý.")
    if not batch.entries:
        raise ValueError("Không có dòng hàng Mượn Số.")
    batch.status = "POSTED"
    batch.posted_at = datetime.utcnow()
    db.commit()
    return batch


def cancel_batch(db: Session, batch_id: int) -> None:
    batch = db.scalar(
        select(EmployeeBorrowBatch).where(EmployeeBorrowBatch.id == batch_id).with_for_update()
    )
    if not batch:
        raise ValueError("Không tìm thấy lần ghi nhận hàng vay mượn.")
    if batch.status != "PENDING":
        raise ValueError("Chỉ có thể hủy bản ghi đang chờ xác nhận.")
    db.delete(batch)
    db.commit()


def _entry_out(entry: EmployeeBorrowEntry) -> dict:
    employee = entry.employee
    return {
        "id": entry.id,
        "entry_type": entry.entry_type,
        "employee_id": entry.employee_id,
        "employee_code": entry.external_employee_code or (employee.code if employee else ""),
        "employee_name": entry.external_employee_name or (employee.name if employee else ""),
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
            EmployeeBorrowEntry.external_employee_code,
            EmployeeBorrowEntry.external_employee_name,
            EmployeeBorrowEntry.product_id,
            func.sum(EmployeeBorrowEntry.quantity),
            func.sum(EmployeeBorrowEntry.amount),
        )
        .outerjoin(EmployeeBorrowBatch, EmployeeBorrowBatch.id == EmployeeBorrowEntry.batch_id)
        .where(posted_batch)
        .group_by(
            EmployeeBorrowEntry.employee_id,
            EmployeeBorrowEntry.external_employee_code,
            EmployeeBorrowEntry.external_employee_name,
            EmployeeBorrowEntry.product_id,
        )
    ).all()
    employee_ids = {row[0] for row in rows if row[0] is not None}
    product_ids = {row[3] for row in rows}
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

    # Gom nhóm theo (mã NVBH chuẩn hóa, product_id) để tổng hợp chính xác số dư Mượn Số + Trả Số
    merged_balances: dict[tuple[str, int], dict] = {}
    for employee_id, external_code, external_name, product_id, quantity, amount in rows:
        quantity = int(quantity or 0)
        amount = Decimal(amount or 0)
        employee = employees.get(employee_id)
        product = products[product_id]
        emp_code = (external_code or (employee.code if employee else "")).strip().upper()
        emp_name = (external_name or (employee.name if employee else "")).strip()
        key = (emp_code or f"ID:{employee_id}", product_id)
        current = merged_balances.get(key)
        if current is None:
            merged_balances[key] = {
                "employee_id": employee_id,
                "employee_code": emp_code,
                "employee_name": emp_name,
                "product_id": product_id,
                "product_code": product.npp_code,
                "product_name": product.npp_name,
                "quantity": quantity,
                "amount": amount,
            }
        else:
            current["quantity"] += quantity
            current["amount"] += amount
            if current["employee_id"] is None and employee_id is not None:
                current["employee_id"] = employee_id
            if not current["employee_name"] and emp_name:
                current["employee_name"] = emp_name

    balances = [
        {
            **item,
            "amount": float(item["amount"]),
        }
        for item in merged_balances.values()
        if item["quantity"] != 0 or item["amount"] != 0
    ]
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
    """Khi Thủ kho hoàn tất xuất kho thực tế: ghi nhận và bù trừ các dòng Trả Số (+SL, +Tiền) của NVBH."""
    if not request.items:
        return
    posted_batch = (
        (EmployeeBorrowEntry.batch_id.is_(None))
        | (EmployeeBorrowBatch.status == "POSTED")
    )
    for item in request.items:
        for return_offset in item.borrowed_employee_offsets or []:
            staff_code = str(return_offset.get("external_employee_code") or "").strip().upper()
            staff_name = (return_offset.get("external_employee_name") or "").strip() or None
            employee_id = return_offset.get("employee_id")
            quantity_to_offset = int(return_offset.get("quantity") or 0)
            amount_to_offset = Decimal(str(return_offset.get("amount") or 0))
            if not staff_code or quantity_to_offset <= 0:
                continue
            identity_filter = [EmployeeBorrowEntry.external_employee_code == staff_code]
            if employee_id is not None:
                identity_filter.append(EmployeeBorrowEntry.employee_id == int(employee_id))
            borrow_entries = db.scalars(
                select(EmployeeBorrowEntry)
                .outerjoin(EmployeeBorrowBatch, EmployeeBorrowBatch.id == EmployeeBorrowEntry.batch_id)
                .where(
                    or_(*identity_filter),
                    EmployeeBorrowEntry.product_id == item.product_id,
                    EmployeeBorrowEntry.entry_type == "BORROW",
                    posted_batch,
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
                offset_amount = min(offset_amount, amount_to_offset)
                db.add(EmployeeBorrowEntry(
                    employee_id=borrowed.employee_id or (int(employee_id) if employee_id is not None else None),
                    external_employee_code=borrowed.external_employee_code or staff_code,
                    external_employee_name=borrowed.external_employee_name or staff_name,
                    product_id=item.product_id,
                    entry_type="OFFSET",
                    quantity=offset_quantity,
                    amount=offset_amount,
                    source_entry_id=borrowed.id,
                    source_request_id=request.id,
                    note=f"Trả Số khi xuất kho phiếu {request.code}",
                    created_by=request.created_by,
                    created_at=now,
                ))
                quantity_to_offset -= offset_quantity
                amount_to_offset -= offset_amount

            # Nếu vẫn còn số lượng Trả Số (ví dụ mượn từ trước hoặc chưa có bản ghi Mượn Số trước đó),
            # vẫn ghi nhận đầy đủ dòng Trả Số (+SL, +Tiền) vào sổ Hàng vay mượn NVBH khi hoàn tất xuất kho.
            if quantity_to_offset > 0:
                db.add(EmployeeBorrowEntry(
                    employee_id=int(employee_id) if employee_id is not None else None,
                    external_employee_code=staff_code,
                    external_employee_name=staff_name,
                    product_id=item.product_id,
                    entry_type="OFFSET",
                    quantity=quantity_to_offset,
                    amount=max(Decimal("0"), amount_to_offset).quantize(CENT, rounding=ROUND_HALF_UP),
                    source_entry_id=None,
                    source_request_id=request.id,
                    note=f"Trả Số khi xuất kho phiếu {request.code}",
                    created_by=request.created_by,
                    created_at=now,
                ))
