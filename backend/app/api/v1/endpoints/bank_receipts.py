from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_db
from app.crud import bank_receipt as crud
from app.crud.bank_receipt import DuplicateBankReceiptError
from app.models.user import User
from app.schemas.bank_receipt import (
    AllocatableEmployeeDayOut,
    AllocatableOrderOut,
    AllocatableStoreDebtOut,
    BankReceiptAllocateRequest,
    BankReceiptCreate,
    BankReceiptOut,
)

router = APIRouter(prefix="/bank-receipts", tags=["bank-receipts"])


@router.post("", response_model=BankReceiptOut)
def create_bank_receipt(
    payload: BankReceiptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Tạo phiếu thu tiền chuyển khoản từ ngân hàng."""
    try:
        return crud.create_bank_receipt(db, payload, created_by=current_user.username)
    except DuplicateBankReceiptError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("", response_model=List[BankReceiptOut])
def list_bank_receipts(
    status: Optional[str] = None,
    store_id: Optional[int] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lấy danh sách các khoản tiền chuyển khoản ngân hàng."""
    return crud.list_bank_receipts(
        db,
        status=status,
        store_id=store_id,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
    )


@router.get("/{receipt_id}", response_model=BankReceiptOut)
def get_bank_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    receipt = crud.get_bank_receipt(db, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiếu chuyển khoản.")
    return receipt


@router.get("/{receipt_id}/allocatable-orders", response_model=List[AllocatableOrderOut])
def get_allocatable_orders(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lấy danh sách các đơn hàng còn nợ của Cửa hàng (thuộc các chuyến/ngày khác nhau) có thể gạch nợ."""
    receipt = crud.get_bank_receipt(db, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiếu chuyển khoản.")

    return crud.get_allocatable_orders_for_store(
        db,
        store_id=receipt.store_id,
        customer_code=receipt.customer.code if receipt.customer else None,
    )


@router.get(
    "/{receipt_id}/allocatable-employee-days",
    response_model=List[AllocatableEmployeeDayOut],
)
def get_allocatable_employee_days(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lấy công nợ còn lại theo ngày/nhân viên có đơn thuộc cửa hàng chuyển tiền."""
    receipt = crud.get_bank_receipt(db, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiếu chuyển khoản.")

    return crud.get_allocatable_employee_days_for_store(
        db,
        store_id=receipt.store_id,
        customer_code=receipt.customer.code if receipt.customer else None,
    )


@router.get(
    "/{receipt_id}/allocatable-store-debt",
    response_model=Optional[AllocatableStoreDebtOut],
)
def get_allocatable_store_debt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    receipt = crud.get_bank_receipt(db, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiếu chuyển khoản.")
    return crud.get_allocatable_store_debt(db, receipt.store_id)


@router.post("/{receipt_id}/allocate", response_model=BankReceiptOut)
def allocate_bank_receipt(
    receipt_id: int,
    payload: BankReceiptAllocateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Phân bổ số tiền chuyển khoản của Cửa hàng cho nhiều đơn hàng / nhân viên giao hàng."""
    try:
        return crud.allocate_bank_receipt(
            db,
            receipt_id=receipt_id,
            allocations=payload.allocations,
            created_by=current_user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{receipt_id}/allocations/{allocation_id}", response_model=BankReceiptOut)
def cancel_allocation(
    receipt_id: int,
    allocation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hủy một dòng phân bổ gạch nợ (phục hồi trạng thái đơn và nợ nhân viên)."""
    try:
        return crud.cancel_allocation(db, receipt_id=receipt_id, allocation_id=allocation_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
