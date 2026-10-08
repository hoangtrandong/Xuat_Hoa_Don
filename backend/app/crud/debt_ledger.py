from datetime import datetime
from uuid import uuid4
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.customer import Store, Customer
from app.models.finance import DebtLedgerEntry, DebtTransfer, CashReceipt, DeliveryReturn
from app.models.inventory import DeliveryRequest


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
    
    results = []
    for emp in employees:
        stat = debt_map.get(emp.id)
        current_debt = float(stat.current_debt) if stat else 0.0
        total_debit = float(stat.total_debit) if stat else 0.0
        total_credit = float(stat.total_credit) if stat else 0.0
        last_active = stat.last_active_at if stat else None
        debt_limit = float(emp.debt_limit or 50000000.0)

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
            "total_debit": total_debit,
            "total_credit": total_credit,
            "is_over_limit": current_debt > debt_limit,
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
    db: Session, party_type: str, party_id: int, amount: float, note: str | None = None, created_by: str | None = None
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

    now = datetime.utcnow()
    receipt = CashReceipt(
        code=_code("CR"),
        party_type=party_type,
        party_id=party_id,
        amount=amount,
        receipt_date=now,
        note=note,
        created_by=created_by,
        created_at=now,
    )
    db.add(receipt)
    db.flush()

    # Credit debt ledger: negative amount reduces debt
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


def list_cash_receipts(db: Session, limit: int = 50) -> list[CashReceipt]:
    return db.scalars(
        select(CashReceipt).order_by(CashReceipt.created_at.desc()).limit(limit)
    ).all()


def create_debt_transfer(
    db: Session, from_employee_id: int, to_store_id: int, amount: float, reason: str | None = None, requested_by: str | None = None
) -> DebtTransfer:
    if amount <= 0:
        raise ValueError("Số tiền chuyển phải lớn hơn 0.")
    emp = db.get(Employee, from_employee_id)
    if not emp:
        raise ValueError("Không tìm thấy nhân viên chuyển nợ.")
    st = db.get(Store, to_store_id)
    if not st:
        raise ValueError("Không tìm thấy cửa hàng nhận nợ.")

    transfer = DebtTransfer(
        code=_code("TRF"),
        from_employee_id=from_employee_id,
        to_store_id=to_store_id,
        amount=amount,
        reason=reason,
        status="PENDING",
        requested_by=requested_by,
        created_at=datetime.utcnow(),
    )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    return transfer


def list_debt_transfers(db: Session, status: str | None = None) -> list[DebtTransfer]:
    stmt = select(DebtTransfer).order_by(DebtTransfer.created_at.desc())
    if status:
        stmt = stmt.where(DebtTransfer.status == status)
    return db.scalars(stmt).all()


def approve_debt_transfer(db: Session, transfer_id: int, approved_by: str | None = None) -> DebtTransfer:
    transfer = db.get(DebtTransfer, transfer_id)
    if not transfer:
        raise ValueError("Không tìm thấy phiếu chuyển công nợ.")
    if transfer.status != "PENDING":
        raise ValueError(f"Không thể duyệt phiếu đang ở trạng thái {transfer.status}.")

    emp = db.get(Employee, transfer.from_employee_id)
    st = db.get(Store, transfer.to_store_id)
    now = datetime.utcnow()

    # 1. Deduct debt from Employee (-amount)
    db.add(DebtLedgerEntry(
        party_type="EMPLOYEE",
        party_id=transfer.from_employee_id,
        entry_type="TRANSFER_OUT",
        amount=-transfer.amount,
        source_type="DEBT_TRANSFER",
        source_id=transfer.id,
        source_code=transfer.code,
        document_date=now,
        note=f"Chuyển nợ sang cửa hàng {st.code if st else ''} theo phiếu {transfer.code}",
        created_by=approved_by,
        created_at=now,
    ))

    # 2. Add debt to Store (+amount)
    db.add(DebtLedgerEntry(
        party_type="STORE",
        party_id=transfer.to_store_id,
        entry_type="TRANSFER_IN",
        amount=transfer.amount,
        source_type="DEBT_TRANSFER",
        source_id=transfer.id,
        source_code=transfer.code,
        document_date=now,
        note=f"Nhận nợ từ NV {emp.code if emp else ''} ({emp.name if emp else ''}) theo phiếu {transfer.code}",
        created_by=approved_by,
        created_at=now,
    ))

    transfer.status = "APPROVED"
    transfer.approved_by = approved_by
    transfer.approved_at = now

    db.commit()
    db.refresh(transfer)
    return transfer


def reject_debt_transfer(db: Session, transfer_id: int, approved_by: str | None = None, reason: str | None = None) -> DebtTransfer:
    transfer = db.get(DebtTransfer, transfer_id)
    if not transfer:
        raise ValueError("Không tìm thấy phiếu chuyển công nợ.")
    if transfer.status != "PENDING":
        raise ValueError(f"Không thể từ chối phiếu đang ở trạng thái {transfer.status}.")

    transfer.status = "REJECTED"
    transfer.approved_by = approved_by
    transfer.approved_at = datetime.utcnow()
    if reason:
        transfer.reason = (transfer.reason or "") + f" [Lý do từ chối: {reason}]"

    db.commit()
    db.refresh(transfer)
    return transfer


def create_delivery_return(
    db: Session, delivery_request_id: int, employee_id: int, amount: float, note: str | None = None,
    created_by: str | None = None, approved_by: str | None = None
) -> DeliveryReturn:
    if amount <= 0:
        raise ValueError("Giá trị hàng trả về phải lớn hơn 0.")
    dr = db.get(DeliveryRequest, delivery_request_id)
    if not dr:
        raise ValueError("Không tìm thấy phiếu xuất kho.")
    emp = db.get(Employee, employee_id)
    if not emp:
        raise ValueError("Không tìm thấy nhân viên.")

    now = datetime.utcnow()
    ret = DeliveryReturn(
        code=_code("RET"),
        delivery_request_id=delivery_request_id,
        employee_id=employee_id,
        amount=amount,
        status="APPROVED",
        note=note,
        created_by=created_by,
        approved_by=approved_by or created_by,
        created_at=now,
    )
    db.add(ret)
    db.flush()

    # Credit debt ledger: negative amount reduces employee debt
    db.add(DebtLedgerEntry(
        party_type="EMPLOYEE",
        party_id=employee_id,
        entry_type="RETURN",
        amount=-amount,
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


def list_delivery_returns(db: Session, limit: int = 50) -> list[DeliveryReturn]:
    return db.scalars(
        select(DeliveryReturn).order_by(DeliveryReturn.created_at.desc()).limit(limit)
    ).all()
