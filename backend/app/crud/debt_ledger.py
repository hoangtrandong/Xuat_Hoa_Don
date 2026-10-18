from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.employee import Employee
from app.models.customer import Store, Customer
from app.models.finance import DebtLedgerEntry, DebtTransfer, CashReceipt, DeliveryReturn, DeliveryReturnItem
from app.models.inventory import DeliveryRequest, DeliveryRequestEmployeeSummary, DeliveryRequestOrder, InventoryTransaction, WarehouseLocation
from app.models.product import Product


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


def create_debt_transfer(
    db: Session,
    from_party_type: str,
    from_party_id: int,
    to_party_type: str,
    to_party_id: int,
    amount: float,
    reason: str | None = None,
    created_by: str | None = None,
) -> DebtTransfer:
    if amount <= 0:
        raise ValueError("Số tiền chuyển phải lớn hơn 0.")
    from_type = from_party_type.upper()
    to_type = to_party_type.upper()
    if from_type not in ("EMPLOYEE", "STORE") or to_type not in ("EMPLOYEE", "STORE"):
        raise ValueError("Đối tượng chuyển và nhận chỉ có thể là nhân viên hoặc cửa hàng.")
    if (from_type, from_party_id) == (to_type, to_party_id):
        raise ValueError("Đối tượng chuyển và nhận công nợ phải khác nhau.")

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
    transfer = DebtTransfer(
        code=_code("TRF"),
        from_party_type=from_type,
        from_party_id=from_party_id,
        to_party_type=to_type,
        to_party_id=to_party_id,
        from_employee_id=from_party_id if from_type == "EMPLOYEE" else None,
        to_store_id=to_party_id if to_type == "STORE" else None,
        amount=transfer_amount,
        reason=reason,
        status="COMPLETED",
        requested_by=created_by,
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
    db.commit()
    db.refresh(transfer)
    return transfer


def list_debt_transfers(db: Session) -> list[DebtTransfer]:
    return db.scalars(
        select(DebtTransfer)
        .where(DebtTransfer.status == "COMPLETED")
        .order_by(DebtTransfer.created_at.desc())
    ).all()


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
) -> DeliveryReturn:
    dr = db.get(DeliveryRequest, delivery_request_id)
    if not dr:
        raise ValueError("Không tìm thấy phiếu xuất kho.")
    emp = db.get(Employee, employee_id)
    if not emp:
        raise ValueError("Không tìm thấy nhân viên.")

    target_order = None
    if order_id:
        target_order = db.get(DeliveryRequestOrder, order_id)
        if not target_order or target_order.delivery_request_id != delivery_request_id:
            raise ValueError("Không tìm thấy đơn hàng tương ứng trong chuyến xe này.")

    now = datetime.utcnow()
    total_amount = float(amount or 0.0)

    # Calculate item amounts and populate return items if provided
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

            if qty <= 0:
                raise ValueError("Số lượng hàng trả về phải lớn hơn 0.")
            prod = db.get(Product, p_id)
            if not prod:
                raise ValueError(f"Không tìm thấy sản phẩm {p_id}.")

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
        amount=total_amount,
        status="APPROVED",
        note=note,
        created_by=created_by,
        approved_by=approved_by or created_by,
        created_at=now,
    )
    db.add(ret)
    db.flush()

    # Create DeliveryReturnItems and restore physical inventory if requested
    for pit in prepared_items:
        ret_item = DeliveryReturnItem(
            delivery_return_id=ret.id,
            product_id=pit["product_id"],
            quantity=pit["quantity"],
            cartons=pit["cartons"],
            loose_boxes=pit["loose_boxes"],
            unit_price=pit["unit_price"],
            amount=pit["amount"],
            reason=pit["reason"],
            location_id=pit["location_id"],
        )
        db.add(ret_item)

        if restore_stock:
            # Physical inventory is restored back into warehouse
            txn_code = f"RET-TXN-{now:%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}"
            db.add(InventoryTransaction(
                code=txn_code,
                type="IN",
                warehouse_id=dr.warehouse_id,
                product_id=pit["product_id"],
                quantity=pit["quantity"],
                unit_cost=pit["unit_price"],
                location_id=pit["location_id"],
                ref_type="DELIVERY_RETURN",
                ref_code=ret.code,
                document_date=now,
                note=f"Nhập kho hàng trả về từ chuyến xe {dr.code} (Phiếu {ret.code})",
                created_by=created_by,
                created_at=now,
            ))

    # If linked to an order, mark the order as returned
    if target_order:
        target_order.payment_method = "RETURN"
        target_order.payment_status = "RETURNED"
        target_order.paid_at = now
        if note:
            target_order.note = (target_order.note or "") + (f" [Trả hàng: {note}]" if target_order.note else f"Trả hàng: {note}")

    # Credit debt ledger: negative amount reduces employee debt
    db.add(DebtLedgerEntry(
        party_type="EMPLOYEE",
        party_id=employee_id,
        entry_type="RETURN",
        amount=-total_amount,
        source_type="DELIVERY_RETURN",
        source_id=ret.id,
        source_code=ret.code,
        document_date=now,
        note=note or f"Trả hàng phiếu {ret.code} (gốc {dr.code}) - NV {emp.code}",
        created_by=created_by,
        created_at=now,
    ))

    db.commit()
    db.refresh(ret)
    return ret


def list_delivery_returns(
    db: Session,
    delivery_request_id: int | None = None,
    employee_id: int | None = None,
    limit: int = 50,
) -> list[DeliveryReturn]:
    stmt = (
        select(DeliveryReturn)
        .options(
            selectinload(DeliveryReturn.employee),
            selectinload(DeliveryReturn.order),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.product),
            selectinload(DeliveryReturn.items).selectinload(DeliveryReturnItem.location),
        )
        .order_by(DeliveryReturn.created_at.desc())
    )
    if delivery_request_id:
        stmt = stmt.where(DeliveryReturn.delivery_request_id == delivery_request_id)
    if employee_id:
        stmt = stmt.where(DeliveryReturn.employee_id == employee_id)
    return db.scalars(stmt.limit(limit)).all()
