from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.employee import Employee
from app.models.customer import Store, Customer
from app.models.finance import DebtLedgerEntry, DebtTransfer, CashReceipt, DeliveryReturn, DeliveryReturnItem
from app.models.inventory import (
    DeliveryAllocation, DeliveryRequest, DeliveryRequestEmployeeSummary,
    DeliveryRequestItem, DeliveryRequestOrder, DeliveryRequestOrderItem,
    InventoryLot, InventoryTransaction, WarehouseLocation,
)
from app.models.product import Product
from app.crud.npp import canonical_product_id


def _code(prefix: str) -> str:
    return f"{prefix}-{datetime.utcnow():%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"


def get_employee_balance(db: Session, employee_id: int) -> float:
    result = db.scalar(
        select(func.coalesce(func.sum(DebtLedgerEntry.amount), 0))
        .where(DebtLedgerEntry.party_type == "EMPLOYEE", DebtLedgerEntry.party_id == employee_id)
    )
    return float(result or 0.0)


def get_store_balance(db: Session, store_id: int) -> float:
    result = db.scalar(
        select(func.coalesce(func.sum(DebtLedgerEntry.amount), 0))
        .where(DebtLedgerEntry.party_type == "STORE", DebtLedgerEntry.party_id == store_id)
    )
    return float(result or 0.0)


def list_employee_debt_summaries(db: Session) -> list[dict]:
    employees = db.scalars(select(Employee).order_by(Employee.code)).all()
    
    # Query sums per employee
    ledger_sums = db.execute(
        select(
            DebtLedgerEntry.party_id,
            func.coalesce(func.sum(DebtLedgerEntry.amount), 0).label("current_debt"),
            func.coalesce(func.sum(
                case((DebtLedgerEntry.amount > 0, DebtLedgerEntry.amount), else_=0)
            ), 0).label("total_debit"),
            func.coalesce(func.sum(
                case((DebtLedgerEntry.amount < 0, func.abs(DebtLedgerEntry.amount)), else_=0)
            ), 0).label("total_credit"),
            func.max(DebtLedgerEntry.created_at).label("last_active_at"),
        )
        .where(DebtLedgerEntry.party_type == "EMPLOYEE")
        .group_by(DebtLedgerEntry.party_id)
    ).all()
    
    debt_map = {r.party_id: r for r in ledger_sums}
    pending_sums = db.execute(
        select(
            DeliveryRequestEmployeeSummary.employee_id,
            func.coalesce(func.sum(DeliveryRequestEmployeeSummary.amount), 0).label("pending_debt"),
        )
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestEmployeeSummary.delivery_request_id)
        .where(
            DeliveryRequestEmployeeSummary.employee_id.is_not(None),
            DeliveryRequest.status.in_(("SUBMITTED", "RECEIVED")),
        )
        .group_by(DeliveryRequestEmployeeSummary.employee_id)
    ).all()
    pending_debt_map = {row.employee_id: float(row.pending_debt) for row in pending_sums}
    
    results = []
    for emp in employees:
        stat = debt_map.get(emp.id)
        current_debt = float(stat.current_debt) if stat else 0.0
        total_debit = float(stat.total_debit) if stat else 0.0
        total_credit = float(stat.total_credit) if stat else 0.0
        last_active = stat.last_active_at if stat else None
        debt_limit = float(
            emp.debt_limit if emp.debt_limit is not None else 500000000.0
        )
        pending_delivery_debt = pending_debt_map.get(emp.id, 0.0)
        projected_debt = current_debt + pending_delivery_debt

        results.append({
            "employee_id": emp.id,
            "code": emp.code,
            "vinamilk_code": emp.vinamilk_code,
            "name": emp.name,
            "phone": emp.phone,
            "position": emp.position,
            "status": emp.status,
            "debt_limit": debt_limit,
            "current_debt": current_debt,
            "pending_delivery_debt": pending_delivery_debt,
            "projected_debt": projected_debt,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "is_over_limit": projected_debt > debt_limit,
            "last_active_at": last_active,
        })
    return results


def list_store_debt_summaries(db: Session) -> list[dict]:
    stores = db.scalars(select(Store).order_by(Store.code)).all()

    ledger_sums = db.execute(
        select(
            DebtLedgerEntry.party_id,
            func.coalesce(func.sum(DebtLedgerEntry.amount), 0).label("current_debt"),
            func.coalesce(func.sum(
                case((DebtLedgerEntry.amount > 0, DebtLedgerEntry.amount), else_=0)
            ), 0).label("total_debit"),
            func.coalesce(func.sum(
                case((DebtLedgerEntry.amount < 0, func.abs(DebtLedgerEntry.amount)), else_=0)
            ), 0).label("total_credit"),
            func.max(DebtLedgerEntry.created_at).label("last_active_at"),
        )
        .where(DebtLedgerEntry.party_type == "STORE")
        .group_by(DebtLedgerEntry.party_id)
    ).all()

    debt_map = {r.party_id: r for r in ledger_sums}

    # Count customers per store
    cust_counts = dict(
        db.execute(
            select(Customer.store_id, func.count(Customer.id))
            .where(Customer.store_id.isnot(None))
            .group_by(Customer.store_id)
        ).all()
    )

    results = []
    for st in stores:
        stat = debt_map.get(st.id)
        current_debt = float(stat.current_debt) if stat else 0.0
        total_debit = float(stat.total_debit) if stat else 0.0
        total_credit = float(stat.total_credit) if stat else 0.0
        last_active = stat.last_active_at if stat else None

        results.append({
            "store_id": st.id,
            "code": st.code,
            "name": st.name,
            "phone": st.phone,
            "owner_name": st.owner_name,
            "address": st.address,
            "city": st.city,
            "customer_count": cust_counts.get(st.id, 0),
            "current_debt": current_debt,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "last_active_at": last_active,
        })
    return results


def get_party_ledger(db: Session, party_type: str, party_id: int, limit: int = 150) -> list[DebtLedgerEntry]:
    return db.scalars(
        select(DebtLedgerEntry)
        .where(DebtLedgerEntry.party_type == party_type, DebtLedgerEntry.party_id == party_id)
        .order_by(DebtLedgerEntry.created_at.desc())
        .limit(limit)
    ).all()


def create_cash_receipt(
    db: Session,
    party_type: str,
    party_id: int,
    amount: float,
    note: str | None = None,
    created_by: str | None = None,
    settlement_date: date | None = None,
) -> CashReceipt:
    if amount <= 0:
        raise ValueError("Số tiền thu phải lớn hơn 0.")
    if party_type not in ("EMPLOYEE", "STORE"):
        raise ValueError("Đối tượng thu phải là EMPLOYEE hoặc STORE.")

    party_name = ""
    if party_type == "EMPLOYEE":
        emp = db.get(Employee, party_id)
        if not emp:
            raise ValueError("Không tìm thấy nhân viên.")
        party_name = f"{emp.code} - {emp.name}"
    else:
        st = db.get(Store, party_id)
        if not st:
            raise ValueError("Không tìm thấy cửa hàng.")
        party_name = f"{st.code} - {st.name}"

    if settlement_date is not None:
        if party_type != "EMPLOYEE":
            raise ValueError("Chỉ có thể gắn ngày quyết toán với phiếu nộp tiền của nhân viên.")
        employee = db.scalar(
            select(Employee).where(Employee.id == party_id).with_for_update()
        )
        if not employee:
            raise ValueError("Không tìm thấy nhân viên.")
        from app.crud.delivery_request import list_daily_settlements

        settlements = list_daily_settlements(db, settlement_date, settlement_date)
        employee_settlement = next(
            (
                row for row in settlements
                if row["employee_id"] == party_id
            ),
            None,
        )
        if employee_settlement is None:
            raise ValueError("Nhân viên không có quyết toán trong ngày đã chọn.")
        max_remittance = min(
            employee_settlement["remaining_employee_debt"],
            max(0.0, get_employee_balance(db, party_id)),
        )
        if amount > max_remittance + 0.01:
            raise ValueError("Số tiền nộp vượt quá công nợ còn phải quyết toán của nhân viên.")

    now = datetime.utcnow()
    receipt = CashReceipt(
        code=_code("CR"),
        party_type=party_type,
        party_id=party_id,
        settlement_date=settlement_date,
        amount=amount,
        receipt_date=now,
        note=note,
        created_by=created_by,
        created_at=now,
    )
    db.add(receipt)
    db.flush()

    db.add(DebtLedgerEntry(
        party_type=party_type,
        party_id=party_id,
        entry_type="CASH_RECEIPT",
        amount=-amount,
        source_type="CASH_RECEIPT",
        source_id=receipt.id,
        source_code=receipt.code,
        document_date=now,
        note=note or f"Thu tiền mặt phiếu {receipt.code} ({party_name})",
        created_by=created_by,
        created_at=now,
    ))
    db.commit()
    db.refresh(receipt)
    return receipt


def list_cash_receipts(db: Session, limit: int = 50) -> list[dict]:
    receipts = db.scalars(
        select(CashReceipt).order_by(CashReceipt.created_at.desc()).limit(limit)
    ).all()
    employee_ids = {
        receipt.party_id for receipt in receipts if receipt.party_type == "EMPLOYEE"
    }
    store_ids = {
        receipt.party_id for receipt in receipts if receipt.party_type == "STORE"
    }
    employees = {
        employee.id: employee
        for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all()
    } if employee_ids else {}
    stores = {
        store.id: store
        for store in db.scalars(select(Store).where(Store.id.in_(store_ids))).all()
    } if store_ids else {}

    result = []
    for receipt in receipts:
        party = employees.get(receipt.party_id) if receipt.party_type == "EMPLOYEE" else stores.get(receipt.party_id)
        result.append({
            "id": receipt.id,
            "code": receipt.code,
            "party_type": receipt.party_type,
            "party_id": receipt.party_id,
            "party_code": party.code if party else None,
            "party_name": party.name if party else None,
            "settlement_date": receipt.settlement_date,
            "amount": receipt.amount,
            "receipt_date": receipt.receipt_date,
            "note": receipt.note,
            "created_by": receipt.created_by,
            "created_at": receipt.created_at,
        })
    return result


def _check_recipient_credit_limit(
    db: Session,
    to_type: str,
    recipient,
    transfer_amount: Decimal,
    is_admin: bool = False,
    override_limit_reason: str | None = None,
) -> tuple[bool, float | None]:
    """Validate recipient debt/credit limit. Returns (overridden, limit_value)."""
    if to_type == "STORE":
        limit_val = getattr(recipient, "credit_limit", None)
        if limit_val is None or float(limit_val) <= 0:
            return False, None
        current = get_store_balance(db, recipient.id)
        projected = Decimal(str(current)) + transfer_amount
        if projected > Decimal(str(limit_val)) + Decimal("0.01"):
            if not is_admin or not (override_limit_reason or "").strip():
                raise ValueError(
                    f"Cửa hàng {recipient.code} vượt hạn mức công nợ "
                    f"({float(projected):,.0f}đ > {float(limit_val):,.0f}đ). Cần Admin duyệt vượt hạn mức kèm lý do."
                )
            return True, float(limit_val)
        return False, float(limit_val)

    limit_val = getattr(recipient, "debt_limit", None)
    if limit_val is None or float(limit_val) <= 0:
        return False, None
    current = get_employee_balance(db, recipient.id)
    projected = Decimal(str(current)) + transfer_amount
    if projected > Decimal(str(limit_val)) + Decimal("0.01"):
        if not is_admin or not (override_limit_reason or "").strip():
            raise ValueError(
                f"Nhân viên {recipient.code} vượt hạn mức công nợ "
                f"({float(projected):,.0f}đ > {float(limit_val):,.0f}đ). Cần Admin duyệt vượt hạn mức kèm lý do."
            )
        return True, float(limit_val)
    return False, float(limit_val)


def create_debt_transfer(
    db: Session,
    from_party_type: str,
    from_party_id: int,
    to_party_type: str,
    to_party_id: int,
    amount: float,
    reason: str | None = None,
    created_by: str | None = None,
    delivery_request_order_id: int | None = None,
    pod_image_url: str | None = None,
    require_approval: bool = False,
    is_admin: bool = False,
    override_limit_reason: str | None = None,
) -> DebtTransfer:
    if amount <= 0:
        raise ValueError("Số tiền chuyển phải lớn hơn 0.")
    from_type = from_party_type.upper()
    to_type = to_party_type.upper()
    if from_type not in ("EMPLOYEE", "STORE") or to_type not in ("EMPLOYEE", "STORE"):
        raise ValueError("Đối tượng chuyển và nhận chỉ có thể là nhân viên hoặc cửa hàng.")
    if (from_type, from_party_id) == (to_type, to_party_id):
        raise ValueError("Đối tượng chuyển và nhận công nợ phải khác nhau.")

    if require_approval and from_type == "EMPLOYEE" and to_type == "STORE":
        if not (pod_image_url or "").strip():
            raise ValueError("Chuyển công nợ từ nhân viên sang cửa hàng bắt buộc đính kèm ảnh ký nhận (POD).")

    def lock_party(party_type: str, party_id: int, action: str):
        model = Employee if party_type == "EMPLOYEE" else Store
        party = db.scalar(select(model).where(model.id == party_id).with_for_update())
        if not party:
            label = "nhân viên" if party_type == "EMPLOYEE" else "cửa hàng"
            raise ValueError(f"Không tìm thấy {label} {action} công nợ.")
        return party

    source = lock_party(from_type, from_party_id, "chuyển")
    recipient = lock_party(to_type, to_party_id, "nhận")
    source_balance = (
        get_employee_balance(db, from_party_id)
        if from_type == "EMPLOYEE"
        else get_store_balance(db, from_party_id)
    )
    transfer_amount = Decimal(str(amount))
    if transfer_amount > Decimal(str(max(0.0, source_balance))) + Decimal("0.01"):
        raise ValueError(
            f"Số tiền chuyển vượt công nợ hiện tại của bên chuyển ({max(0.0, source_balance):,.0f}đ)."
        )

    now = datetime.utcnow()
    if require_approval:
        transfer = DebtTransfer(
            code=_code("TRF"),
            from_party_type=from_type,
            from_party_id=from_party_id,
            to_party_type=to_type,
            to_party_id=to_party_id,
            from_employee_id=from_party_id if from_type == "EMPLOYEE" else None,
            to_store_id=to_party_id if to_type == "STORE" else None,
            delivery_request_order_id=delivery_request_order_id,
            pod_image_url=(pod_image_url or "").strip() or None,
            amount=transfer_amount,
            reason=reason,
            status="PENDING_APPROVAL",
            requested_by=created_by,
            created_at=now,
        )
        db.add(transfer)
        db.commit()
        db.refresh(transfer)
        return transfer

    overridden, _ = _check_recipient_credit_limit(
        db, to_type, recipient, transfer_amount, is_admin=is_admin, override_limit_reason=override_limit_reason
    )
    transfer = DebtTransfer(
        code=_code("TRF"),
        from_party_type=from_type,
        from_party_id=from_party_id,
        to_party_type=to_type,
        to_party_id=to_party_id,
        from_employee_id=from_party_id if from_type == "EMPLOYEE" else None,
        to_store_id=to_party_id if to_type == "STORE" else None,
        delivery_request_order_id=delivery_request_order_id,
        pod_image_url=(pod_image_url or "").strip() or None,
        amount=transfer_amount,
        reason=reason,
        status="COMPLETED",
        requested_by=created_by,
        approved_by=created_by,
        approved_at=now,
        override_limit_by=created_by if overridden else None,
        override_limit_reason=(override_limit_reason or "").strip() if overridden else None,
        created_at=now,
    )
    db.add(transfer)
    db.flush()

    from_code = source.code
    to_code = recipient.code
    db.add_all([
        DebtLedgerEntry(
            party_type=from_type,
            party_id=from_party_id,
            entry_type="TRANSFER_OUT",
            amount=-transfer_amount,
            source_type="DEBT_TRANSFER",
            source_id=transfer.id,
            source_code=transfer.code,
            document_date=now,
            note=f"Chuyển công nợ sang {to_type} {to_code}: {reason or ''}".strip(),
            created_by=created_by,
            created_at=now,
        ),
        DebtLedgerEntry(
            party_type=to_type,
            party_id=to_party_id,
            entry_type="TRANSFER_IN",
            amount=transfer_amount,
            source_type="DEBT_TRANSFER",
            source_id=transfer.id,
            source_code=transfer.code,
            document_date=now,
            note=f"Nhận công nợ từ {from_type} {from_code}: {reason or ''}".strip(),
            created_by=created_by,
            created_at=now,
        ),
    ])
    if delivery_request_order_id:
        order = db.get(DeliveryRequestOrder, delivery_request_order_id)
        if order:
            order.payment_status = "TRANSFERRED_DEBT"
            order.payment_method = "DEBT"
            order.paid_at = now
    db.commit()
    db.refresh(transfer)
    return transfer


def approve_debt_transfer(
    db: Session,
    transfer_id: int,
    approved_by: str,
    is_admin: bool = False,
    override_limit_reason: str | None = None,
) -> DebtTransfer:
    transfer = db.scalar(select(DebtTransfer).where(DebtTransfer.id == transfer_id).with_for_update())
    if not transfer:
        raise ValueError("Không tìm thấy yêu cầu chuyển công nợ.")
    if transfer.status != "PENDING_APPROVAL":
        raise ValueError(f"Yêu cầu chuyển công nợ đang ở trạng thái {transfer.status}, không thể duyệt.")

    from_model = Employee if transfer.from_party_type == "EMPLOYEE" else Store
    to_model = Employee if transfer.to_party_type == "EMPLOYEE" else Store
    source = db.scalar(select(from_model).where(from_model.id == transfer.from_party_id).with_for_update())
    recipient = db.scalar(select(to_model).where(to_model.id == transfer.to_party_id).with_for_update())
    if not source or not recipient:
        raise ValueError("Không tìm thấy đối tượng chuyển hoặc nhận công nợ.")

    source_balance = (
        get_employee_balance(db, transfer.from_party_id)
        if transfer.from_party_type == "EMPLOYEE"
        else get_store_balance(db, transfer.from_party_id)
    )
    transfer_amount = Decimal(str(transfer.amount))
    if transfer_amount > Decimal(str(max(0.0, source_balance))) + Decimal("0.01"):
        raise ValueError(
            f"Số tiền chuyển vượt công nợ hiện tại của bên chuyển ({max(0.0, source_balance):,.0f}đ)."
        )

    overridden, _ = _check_recipient_credit_limit(
        db, transfer.to_party_type, recipient, transfer_amount,
        is_admin=is_admin, override_limit_reason=override_limit_reason,
    )

    now = datetime.utcnow()
    transfer.status = "COMPLETED"
    transfer.approved_by = approved_by
    transfer.approved_at = now
    if overridden:
        transfer.override_limit_by = approved_by
        transfer.override_limit_reason = (override_limit_reason or "").strip()

    db.add_all([
        DebtLedgerEntry(
            party_type=transfer.from_party_type,
            party_id=transfer.from_party_id,
            entry_type="TRANSFER_OUT",
            amount=-transfer_amount,
            source_type="DEBT_TRANSFER",
            source_id=transfer.id,
            source_code=transfer.code,
            document_date=now,
            note=f"Duyệt chuyển công nợ sang {transfer.to_party_type} {recipient.code}: {transfer.reason or ''}".strip(),
            created_by=approved_by,
            created_at=now,
        ),
        DebtLedgerEntry(
            party_type=transfer.to_party_type,
            party_id=transfer.to_party_id,
            entry_type="TRANSFER_IN",
            amount=transfer_amount,
            source_type="DEBT_TRANSFER",
            source_id=transfer.id,
            source_code=transfer.code,
            document_date=now,
            note=f"Duyệt nhận công nợ từ {transfer.from_party_type} {source.code}: {transfer.reason or ''}".strip(),
            created_by=approved_by,
            created_at=now,
        ),
    ])

    if transfer.delivery_request_order_id:
        order = db.get(DeliveryRequestOrder, transfer.delivery_request_order_id)
        if order:
            order.payment_status = "TRANSFERRED_DEBT"
            order.payment_method = "DEBT"
            order.paid_at = now
            if transfer.pod_image_url and not order.pod_image_url:
                order.pod_image_url = transfer.pod_image_url

    db.commit()
    db.refresh(transfer)
    return transfer


def reject_debt_transfer(
    db: Session,
    transfer_id: int,
    rejected_by: str,
    reject_reason: str,
) -> DebtTransfer:
    transfer = db.scalar(select(DebtTransfer).where(DebtTransfer.id == transfer_id).with_for_update())
    if not transfer:
        raise ValueError("Không tìm thấy yêu cầu chuyển công nợ.")
    if transfer.status != "PENDING_APPROVAL":
        raise ValueError(f"Yêu cầu chuyển công nợ đang ở trạng thái {transfer.status}, không thể từ chối.")
    transfer.status = "REJECTED"
    transfer.rejected_by = rejected_by
    transfer.rejected_at = datetime.utcnow()
    transfer.reject_reason = reject_reason.strip()
    db.commit()
    db.refresh(transfer)
    return transfer


def list_debt_transfers(db: Session, status: str | None = None) -> list[DebtTransfer]:
    stmt = select(DebtTransfer).order_by(DebtTransfer.created_at.desc())
    if status:
        stmt = stmt.where(DebtTransfer.status == status.upper())
    else:
        stmt = stmt.where(DebtTransfer.status == "COMPLETED")
    return db.scalars(stmt).all()


def _resolve_original_allocation_lot(
    db: Session,
    delivery_request_id: int,
    product_id: int,
) -> tuple[int | None, int | None, datetime | None]:
    """Trace original FEFO DeliveryAllocation for a product on a delivery request."""
    alloc = db.scalar(
        select(DeliveryAllocation)
        .join(DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id)
        .where(
            DeliveryRequestItem.request_id == delivery_request_id,
            DeliveryRequestItem.product_id == product_id,
            DeliveryAllocation.lot_id.is_not(None),
        )
        .order_by(DeliveryAllocation.allocation_sequence.asc())
    )
    if alloc:
        return alloc.lot_id, alloc.location_id, alloc.expiry_date
    return None, None, None


def _restore_item_to_lot(
    db: Session,
    warehouse_id: int,
    product_id: int,
    qty: int,
    unit_cost: float,
    item_condition: str,
    lot_id: int | None,
    location_id: int | None,
    expiry_date: datetime | None,
    ret_code: str,
    dr_code: str,
    created_by: str | None,
    now: datetime,
) -> tuple[int | None, int | None, datetime | None]:
    """Restore returned goods into InventoryLot (preserving FEFO). Damaged/expired items are locked."""
    target_lot = None
    if lot_id is not None:
        target_lot = db.scalar(
            select(InventoryLot).where(InventoryLot.id == lot_id).with_for_update()
        )
        if target_lot and (
            target_lot.warehouse_id != warehouse_id
            or target_lot.product_id != product_id
            or (location_id is not None and target_lot.location_id != location_id)
        ):
            target_lot = None

    if target_lot is None and location_id is not None:
        target_lot = db.scalar(
            select(InventoryLot)
            .where(
                InventoryLot.warehouse_id == warehouse_id,
                InventoryLot.product_id == product_id,
                InventoryLot.location_id == location_id,
                InventoryLot.expiry_date == expiry_date,
            )
            .with_for_update()
        )

    if target_lot is None and location_id is not None:
        target_lot = InventoryLot(
            warehouse_id=warehouse_id,
            location_id=location_id,
            product_id=product_id,
            expiry_date=expiry_date,
            quantity_on_hand=0,
            locked_quantity=0,
            unit_cost=unit_cost or None,
        )
        db.add(target_lot)
        db.flush()

    final_lot_id = None
    final_location_id = location_id
    final_expiry = expiry_date
    if target_lot is not None:
        target_lot.quantity_on_hand = int(target_lot.quantity_on_hand or 0) + qty
        if item_condition in ("DAMAGED", "EXPIRED"):
            target_lot.locked_quantity = int(target_lot.locked_quantity or 0) + qty
        final_lot_id = target_lot.id
        final_location_id = target_lot.location_id
        final_expiry = target_lot.expiry_date

    condition_tag = "" if item_condition == "GOOD" else f" [HÀNG {item_condition} - CÁCH LY]"
    txn_code = f"RET-TXN-{now:%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"
    db.add(InventoryTransaction(
        code=txn_code,
        type="IN",
        warehouse_id=warehouse_id,
        product_id=product_id,
        quantity=qty,
        unit_cost=unit_cost,
        lot_id=final_lot_id,
        location_id=final_location_id,
        expiry_date=final_expiry,
        ref_type="DELIVERY_RETURN",
        ref_code=ret_code,
        document_date=now,
        note=f"Nhập kho hàng trả về từ chuyến xe {dr_code} (Phiếu {ret_code}){condition_tag}",
        created_by=created_by,
        created_at=now,
    ))
    return final_lot_id, final_location_id, final_expiry


def _apply_return_settlement(
    db: Session,
    ret: DeliveryReturn,
    dr: DeliveryRequest,
    emp: Employee,
    target_order: DeliveryRequestOrder | None,
    good_credit_amount: float,
    total_returned_amount: float,
    note: str | None,
    acted_by: str | None,
    now: datetime,
) -> None:
    """Update order delivery/payment/einvoice status and credit debt ledger for GOOD returned value."""
    if target_order:
        orig_amt = float(target_order.amount or 0)
        prev_ret = float(target_order.returned_amount or 0)
        new_ret = prev_ret + total_returned_amount
        net_amt = max(0.0, orig_amt - new_ret)
        target_order.returned_amount = new_ret
        target_order.net_amount = net_amt

        if net_amt <= 0.01:
            target_order.delivery_status = "RETURNED_ALL"
            target_order.payment_method = "RETURN"
            target_order.payment_status = "RETURNED"
            target_order.paid_at = now
        else:
            target_order.delivery_status = "PARTIAL_DELIVERED"

        if target_order.einvoice_status == "ISSUED":
            target_order.einvoice_status = "ADJUSTMENT_REQUIRED"

        if note:
            target_order.note = (target_order.note or "") + (
                f" [Trả hàng: {note}]" if target_order.note else f"Trả hàng: {note}"
            )

    if good_credit_amount > 0:
        party_type = (ret.settlement_party_type or "EMPLOYEE").upper()
        party_id = ret.settlement_party_id or ret.employee_id
        db.add(DebtLedgerEntry(
            party_type=party_type,
            party_id=party_id,
            entry_type="RETURN",
            amount=-good_credit_amount,
            source_type="DELIVERY_RETURN",
            source_id=ret.id,
            source_code=ret.code,
            document_date=now,
            note=note or f"Trả hàng phiếu {ret.code} (gốc {dr.code}) - NV {emp.code}",
            created_by=acted_by,
            created_at=now,
        ))


def create_delivery_return(
    db: Session,
    delivery_request_id: int,
    employee_id: int,
    amount: float = 0.0,
    order_id: int | None = None,
    items: list | None = None,
    restore_stock: bool = True,
    note: str | None = None,
    created_by: str | None = None,
    approved_by: str | None = None,
    auto_receive: bool = True,
    settlement_party_type: str = "EMPLOYEE",
    settlement_party_id: int | None = None,
    return_type: str = "STANDARD",
    replacement_order_number: str | None = None,
    commit: bool = True,
) -> DeliveryReturn:
    dr = db.get(DeliveryRequest, delivery_request_id)
    if not dr:
        raise ValueError("Không tìm thấy phiếu xuất kho.")
    emp = db.get(Employee, employee_id)
    if not emp:
        raise ValueError("Không tìm thấy nhân viên.")

    party_type = (settlement_party_type or "EMPLOYEE").upper()
    if party_type not in ("EMPLOYEE", "STORE"):
        raise ValueError("Đối tượng giảm trừ công nợ phải là EMPLOYEE hoặc STORE.")
    resolved_party_id = settlement_party_id or (employee_id if party_type == "EMPLOYEE" else None)
    if resolved_party_id is None:
        raise ValueError("Thiếu mã cửa hàng nhận giảm trừ công nợ.")

    target_order = None
    if order_id:
        target_order = db.get(DeliveryRequestOrder, order_id)
        if not target_order or target_order.delivery_request_id != delivery_request_id:
            raise ValueError("Không tìm thấy đơn hàng tương ứng trong chuyến xe này.")

    now = datetime.utcnow()
    total_amount = float(amount or 0.0)

    order_items_by_prod: dict[int, DeliveryRequestOrderItem] = {}
    if target_order:
        for oi in db.scalars(
            select(DeliveryRequestOrderItem).where(
                DeliveryRequestOrderItem.delivery_request_order_id == target_order.id
            )
        ).all():
            order_items_by_prod[oi.product_id] = oi

    prepared_items = []
    if items:
        calculated_items_total = 0.0
        for it in items:
            p_id = it.product_id if hasattr(it, "product_id") else it.get("product_id")
            qty = it.quantity if hasattr(it, "quantity") else it.get("quantity", 0)
            cartons = (it.cartons if hasattr(it, "cartons") else it.get("cartons", 0)) or 0
            loose_boxes = (it.loose_boxes if hasattr(it, "loose_boxes") else it.get("loose_boxes", 0)) or 0
            unit_price = float((it.unit_price if hasattr(it, "unit_price") else it.get("unit_price", 0.0)) or 0.0)
            item_amt = float((it.amount if hasattr(it, "amount") else it.get("amount", 0.0)) or 0.0)
            reason = it.reason if hasattr(it, "reason") else it.get("reason")
            loc_id = it.location_id if hasattr(it, "location_id") else it.get("location_id")
            lot_id = it.lot_id if hasattr(it, "lot_id") else it.get("lot_id")
            exp_date = it.expiry_date if hasattr(it, "expiry_date") else it.get("expiry_date")
            cond = ((it.item_condition if hasattr(it, "item_condition") else it.get("item_condition")) or "GOOD").upper()
            if cond not in ("GOOD", "DAMAGED", "EXPIRED"):
                raise ValueError(f"Tình trạng hàng trả không hợp lệ: {cond}.")

            if qty <= 0:
                raise ValueError("Số lượng hàng trả về phải lớn hơn 0.")
            prod = db.get(Product, p_id)
            if not prod:
                raise ValueError(f"Không tìm thấy sản phẩm {p_id}.")
            p_id = canonical_product_id(db, p_id)

            if p_id in order_items_by_prod:
                oi = order_items_by_prod[p_id]
                max_returnable = oi.ordered_qty - int(oi.returned_qty or 0)
                if qty > max_returnable:
                    raise ValueError(
                        f"Sản phẩm {prod.npp_code} trả về ({qty}) vượt quá số lượng có thể trả của đơn ({max_returnable})."
                    )

            if lot_id is None:
                orig_lot_id, orig_loc_id, orig_exp = _resolve_original_allocation_lot(db, delivery_request_id, p_id)
                if exp_date is None:
                    exp_date = orig_exp
                if cond == "GOOD" and (loc_id is None or loc_id == orig_loc_id):
                    lot_id = orig_lot_id
                    if loc_id is None:
                        loc_id = orig_loc_id
                elif loc_id is None:
                    loc_id = orig_loc_id

            if item_amt <= 0 and unit_price > 0:
                item_amt = qty * unit_price
            calculated_items_total += item_amt

            prepared_items.append({
                "product_id": p_id,
                "quantity": qty,
                "cartons": cartons,
                "loose_boxes": loose_boxes,
                "unit_price": unit_price,
                "amount": item_amt,
                "reason": reason,
                "location_id": loc_id,
                "lot_id": lot_id,
                "expiry_date": exp_date,
                "item_condition": cond,
            })

        if total_amount <= 0:
            total_amount = calculated_items_total

    if total_amount <= 0 and target_order:
        total_amount = float(target_order.amount)

    if total_amount <= 0:
        raise ValueError("Giá trị hàng trả về phải lớn hơn 0.")

    ret = DeliveryReturn(
        code=_code("RET"),
        delivery_request_id=delivery_request_id,
        employee_id=employee_id,
        order_id=order_id,
        return_type=(return_type or "STANDARD").upper(),
        replacement_order_number=(replacement_order_number or "").strip() or None,
        amount=total_amount,
        status="APPROVED" if auto_receive else "PENDING_WAREHOUSE",
        settlement_party_type=party_type,
        settlement_party_id=resolved_party_id,
        note=note,
        created_by=created_by,
        approved_by=(approved_by or created_by) if auto_receive else None,
        warehouse_received_by=(approved_by or created_by) if auto_receive else None,
        warehouse_received_at=now if auto_receive else None,
        created_at=now,
    )
    db.add(ret)
    db.flush()

    good_credit_amount = 0.0
    for pit in prepared_items:
        cond = pit["item_condition"]
        ret_item = DeliveryReturnItem(
            delivery_return_id=ret.id,
            product_id=pit["product_id"],
            quantity=pit["quantity"],
            actual_received_qty=pit["quantity"] if auto_receive else None,
            cartons=pit["cartons"],
            loose_boxes=pit["loose_boxes"],
            unit_price=pit["unit_price"],
            amount=pit["amount"],
            reason=pit["reason"],
            location_id=pit["location_id"],
            lot_id=pit["lot_id"],
            expiry_date=pit["expiry_date"],
            item_condition=cond,
            damage_resolution=("PENDING" if (auto_receive and cond != "GOOD") else None),
        )
        db.add(ret_item)

        if auto_receive:
            if pit["product_id"] in order_items_by_prod:
                oi = order_items_by_prod[pit["product_id"]]
                oi.returned_qty = int(oi.returned_qty or 0) + pit["quantity"]
                oi.delivered_qty = max(0, oi.ordered_qty - oi.returned_qty)

            if restore_stock:
                f_lot, f_loc, f_exp = _restore_item_to_lot(
                    db=db,
                    warehouse_id=dr.warehouse_id,
                    product_id=pit["product_id"],
                    qty=pit["quantity"],
                    unit_cost=pit["unit_price"],
                    item_condition=cond,
                    lot_id=pit["lot_id"],
                    location_id=pit["location_id"],
                    expiry_date=pit["expiry_date"],
                    ret_code=ret.code,
                    dr_code=dr.code,
                    created_by=created_by,
                    now=now,
                )
                ret_item.lot_id = f_lot
                ret_item.location_id = f_loc
                ret_item.expiry_date = f_exp

            if cond == "GOOD":
                good_credit_amount += pit["amount"]

    if auto_receive:
        if not prepared_items:
            good_credit_amount = total_amount
        _apply_return_settlement(
            db=db,
            ret=ret,
            dr=dr,
            emp=emp,
            target_order=target_order,
            good_credit_amount=good_credit_amount,
            total_returned_amount=total_amount,
            note=note,
            acted_by=created_by,
            now=now,
        )

    if commit:
        db.commit()
        db.refresh(ret)
    else:
        db.flush()
    return ret


def receive_delivery_return(
    db: Session,
    return_id: int,
    received_by: str,
    items_payload: list | None = None,
    restore_stock: bool = True,
    note: str | None = None,
) -> DeliveryReturn:
    """Step 2 of 2-step Return: Warehouse verifies physical goods, restores InventoryLot (FEFO), credits GOOD debt."""
    ret = db.scalar(
        select(DeliveryReturn)
        .options(selectinload(DeliveryReturn.items))
        .where(DeliveryReturn.id == return_id)
        .with_for_update()
    )
    if not ret:
        raise ValueError("Không tìm thấy phiếu trả hàng.")
    if ret.status != "PENDING_WAREHOUSE":
        raise ValueError(f"Phiếu trả hàng đang ở trạng thái {ret.status}, không thể xác nhận nhập kho.")

    dr = db.get(DeliveryRequest, ret.delivery_request_id)
    emp = db.get(Employee, ret.employee_id)
    target_order = db.get(DeliveryRequestOrder, ret.order_id) if ret.order_id else None
    now = datetime.utcnow()

    override_map = {}
    for it in (items_payload or []):
        item_id = it.item_id if hasattr(it, "item_id") else it.get("item_id")
        override_map[item_id] = it

    order_items_by_prod: dict[int, DeliveryRequestOrderItem] = {}
    if target_order:
        for oi in db.scalars(
            select(DeliveryRequestOrderItem).where(
                DeliveryRequestOrderItem.delivery_request_order_id == target_order.id
            )
        ).all():
            order_items_by_prod[oi.product_id] = oi

    good_credit_amount = 0.0
    total_actual_amount = 0.0

    for item in ret.items:
        ov = override_map.get(item.id)
        actual_qty = item.quantity
        cond = (item.item_condition or "GOOD").upper()
        lot_id = item.lot_id
        loc_id = item.location_id
        exp_date = item.expiry_date

        if ov is not None:
            actual_qty = ov.actual_received_qty if hasattr(ov, "actual_received_qty") else ov.get("actual_received_qty", item.quantity)
            cond = ((ov.item_condition if hasattr(ov, "item_condition") else ov.get("item_condition")) or cond).upper()
            ov_lot = ov.lot_id if hasattr(ov, "lot_id") else ov.get("lot_id")
            ov_loc = ov.location_id if hasattr(ov, "location_id") else ov.get("location_id")
            ov_exp = ov.expiry_date if hasattr(ov, "expiry_date") else ov.get("expiry_date")
            if ov_lot is not None:
                lot_id = ov_lot
            if ov_loc is not None:
                loc_id = ov_loc
            if ov_exp is not None:
                exp_date = ov_exp

        if cond not in ("GOOD", "DAMAGED", "EXPIRED"):
            raise ValueError(f"Tình trạng hàng nhận không hợp lệ: {cond}.")
        if actual_qty < 0 or actual_qty > item.quantity:
            raise ValueError(f"Số lượng thực nhận ({actual_qty}) phải nằm trong khoảng 0..{item.quantity}.")

        item.actual_received_qty = actual_qty
        item.item_condition = cond

        unit_price = float(item.unit_price or 0)
        if unit_price <= 0 and item.quantity > 0:
            unit_price = float(item.amount or 0) / item.quantity
        actual_amt = round(actual_qty * unit_price, 2)
        total_actual_amount += actual_amt

        if actual_qty > 0:
            if item.product_id in order_items_by_prod:
                oi = order_items_by_prod[item.product_id]
                oi.returned_qty = int(oi.returned_qty or 0) + actual_qty
                oi.delivered_qty = max(0, oi.ordered_qty - oi.returned_qty)

            if restore_stock:
                f_lot, f_loc, f_exp = _restore_item_to_lot(
                    db=db,
                    warehouse_id=dr.warehouse_id,
                    product_id=item.product_id,
                    qty=actual_qty,
                    unit_cost=unit_price,
                    item_condition=cond,
                    lot_id=lot_id,
                    location_id=loc_id,
                    expiry_date=exp_date,
                    ret_code=ret.code,
                    dr_code=dr.code,
                    created_by=received_by,
                    now=now,
                )
                item.lot_id = f_lot
                item.location_id = f_loc
                item.expiry_date = f_exp

            if cond == "GOOD":
                good_credit_amount += actual_amt
            else:
                item.damage_resolution = "PENDING"

    if not ret.items:
        total_actual_amount = float(ret.amount or 0)
        good_credit_amount = total_actual_amount

    ret.status = "WAREHOUSE_RECEIVED"
    ret.warehouse_received_by = received_by
    ret.warehouse_received_at = now
    ret.approved_by = received_by
    if note:
        ret.note = f"{ret.note} | Kho nhận: {note}" if ret.note else f"Kho nhận: {note}"

    _apply_return_settlement(
        db=db,
        ret=ret,
        dr=dr,
        emp=emp,
        target_order=target_order,
        good_credit_amount=good_credit_amount,
        total_returned_amount=total_actual_amount,
        note=note or ret.note,
        acted_by=received_by,
        now=now,
    )

    # Nếu phiếu trả phát sinh từ nghiệp vụ thay thế đơn DMS, đánh dấu đơn cũ là đã trả trên snapshot
    # để báo cáo tổng hợp doanh số không tính trùng giữa đơn cũ và đơn mới.
    if ret.replacement_order_number and target_order and target_order.order_number:
        from app.models.vinamilk import VinamilkOrderSnapshot
        old_snapshots = db.scalars(
            select(VinamilkOrderSnapshot).where(
                VinamilkOrderSnapshot.order_number == target_order.order_number
            )
        ).all()
        for snap in old_snapshots:
            snap.returned = True

    db.commit()
    return db.scalar(
        select(DeliveryReturn)
        .options(
            selectinload(DeliveryReturn.delivery_request),
            selectinload(DeliveryReturn.employee),
            selectinload(DeliveryReturn.order),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.product),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.location),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.lot),
        )
        .where(DeliveryReturn.id == ret.id)
    )


def cancel_delivery_return(
    db: Session,
    return_id: int,
    cancelled_by: str,
    reason: str | None = None,
) -> DeliveryReturn:
    """Hủy phiếu yêu cầu trả hàng đang ở trạng thái CHỜ THỦ KHO NHẬN (chưa nhập kho, chưa trừ công nợ)."""
    ret = db.scalar(
        select(DeliveryReturn)
        .options(
            selectinload(DeliveryReturn.delivery_request),
            selectinload(DeliveryReturn.employee),
            selectinload(DeliveryReturn.order),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.product),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.location),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.lot),
        )
        .where(DeliveryReturn.id == return_id)
        .with_for_update()
    )
    if not ret:
        raise ValueError("Không tìm thấy phiếu trả hàng.")
    if ret.status != "PENDING_WAREHOUSE":
        raise ValueError(f"Chỉ có thể hủy phiếu trả hàng đang ở trạng thái CHỜ THỦ KHO NHẬN (hiện tại: {ret.status}).")

    now = datetime.utcnow()
    ret.status = "CANCELLED"
    ret.rejected_by = cancelled_by
    ret.rejected_at = now
    ret.reject_reason = (reason or "").strip() or "Hủy yêu cầu trả hàng"

    if ret.return_type == "ORDER_REPLACEMENT" and ret.replacement_order_number:
        from app.models.vinamilk import VinamilkOrderReplacement
        rep = db.get(VinamilkOrderReplacement, ret.replacement_order_number)
        if rep and getattr(rep, "replacement_type", "MANUAL") not in ("SPLIT", "MERGE"):
            if not ret.order or rep.replaced_order_number == ret.order.order_number:
                db.delete(rep)
        if ret.order and ret.order.delivery_status == "PARTIAL_DELIVERED" and float(ret.order.returned_amount or 0) <= 0:
            ret.order.delivery_status = "PENDING"

    db.commit()
    db.refresh(ret)
    return ret


def resolve_damaged_return_item(
    db: Session,
    return_id: int,
    item_id: int,
    resolution: str,
    resolved_by: str,
    note: str | None = None,
) -> DeliveryReturnItem:
    """Admin decision for DAMAGED/EXPIRED returned goods: CHARGE_EMPLOYEE or COMPANY_ABSORB."""
    res = resolution.strip().upper()
    if res not in ("CHARGE_EMPLOYEE", "COMPANY_ABSORB"):
        raise ValueError("Phương án xử lý hàng hỏng chỉ chấp nhận CHARGE_EMPLOYEE hoặc COMPANY_ABSORB.")

    ret = db.get(DeliveryReturn, return_id)
    if not ret or ret.status not in ("WAREHOUSE_RECEIVED", "APPROVED"):
        raise ValueError("Phiếu trả hàng chưa được thủ kho xác nhận nhập kho.")

    item = db.scalar(
        select(DeliveryReturnItem)
        .where(
            DeliveryReturnItem.id == item_id,
            DeliveryReturnItem.delivery_return_id == return_id,
        )
        .with_for_update()
    )
    if not item:
        raise ValueError("Không tìm thấy dòng hàng trả tương ứng.")
    if item.item_condition == "GOOD":
        raise ValueError("Dòng hàng ở tình trạng GOOD không thuộc diện xử lý hàng hỏng.")
    if item.damage_resolution in ("CHARGE_EMPLOYEE", "COMPANY_ABSORB"):
        raise ValueError(f"Dòng hàng hỏng này đã được xử lý ({item.damage_resolution}).")

    now = datetime.utcnow()
    item.damage_resolution = res
    item.resolved_by = resolved_by
    item.resolved_at = now
    item.resolution_note = note

    if res == "COMPANY_ABSORB":
        qty = item.actual_received_qty if item.actual_received_qty is not None else item.quantity
        unit_price = float(item.unit_price or 0)
        if unit_price <= 0 and item.quantity > 0:
            unit_price = float(item.amount or 0) / item.quantity
        absorb_amt = round(qty * unit_price, 2)
        if absorb_amt > 0:
            db.add(DebtLedgerEntry(
                party_type="EMPLOYEE",
                party_id=ret.employee_id,
                entry_type="RETURN",
                amount=-absorb_amt,
                source_type="DELIVERY_RETURN_DAMAGE",
                source_id=item.id,
                source_code=ret.code,
                document_date=now,
                note=note or f"Miễn trừ công nợ hàng hỏng ({ret.code})",
                created_by=resolved_by,
                created_at=now,
            ))

    db.commit()
    db.refresh(item)
    return item


def list_delivery_returns(
    db: Session,
    delivery_request_id: int | None = None,
    employee_id: int | None = None,
    status: str | None = None,
    return_type: str | None = None,
    search: str | None = None,
    limit: int = 100,
) -> list[DeliveryReturn]:
    stmt = (
        select(DeliveryReturn)
        .options(
            selectinload(DeliveryReturn.delivery_request),
            selectinload(DeliveryReturn.employee),
            selectinload(DeliveryReturn.order),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.product),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.location),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.lot),
        )
        .order_by(DeliveryReturn.created_at.desc())
    )
    if delivery_request_id:
        stmt = stmt.where(DeliveryReturn.delivery_request_id == delivery_request_id)
    if employee_id:
        stmt = stmt.where(DeliveryReturn.employee_id == employee_id)
    if status:
        stmt = stmt.where(DeliveryReturn.status == status.upper())
    if return_type:
        stmt = stmt.where(DeliveryReturn.return_type == return_type.upper())
    rows = db.scalars(stmt.limit(limit if not search else max(limit * 3, 300))).all()
    if search and search.strip():
        q = search.strip().lower()
        rows = [
            r for r in rows
            if q in (r.code or "").lower()
            or q in (r.order_number or "").lower()
            or q in (r.replacement_order_number or "").lower()
            or q in (r.delivery_request_code or "").lower()
            or q in (r.employee_code or "").lower()
            or q in (r.employee_name or "").lower()
            or q in (r.customer_code or "").lower()
            or q in (r.customer_name or "").lower()
            or any(q in (it.sku or "").lower() or q in (it.product_name or "").lower() for it in r.items)
        ][:limit]
    return rows
