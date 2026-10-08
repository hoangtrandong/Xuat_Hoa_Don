from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import debt_ledger as crud
from app.models.user import User
from app.schemas.debt_ledger import DebtTransferCreate, DebtTransferOut

router = APIRouter(prefix="/debt-transfers", tags=["debt-transfers"])


@router.get("", response_model=List[DebtTransferOut])
def get_debt_transfers(
    status: Optional[str] = Query(None, description="PENDING | APPROVED | REJECTED"),
    db: Session = Depends(get_db),
):
    return crud.list_debt_transfers(db, status=status)


@router.post("", response_model=DebtTransferOut)
def request_debt_transfer(
    payload: DebtTransferCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.create_debt_transfer(
            db,
            from_employee_id=payload.from_employee_id,
            to_store_id=payload.to_store_id,
            amount=payload.amount,
            reason=payload.reason,
            requested_by=current_user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
