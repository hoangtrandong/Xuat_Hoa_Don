from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import debt_ledger as crud
from app.models.user import User
from app.schemas.debt_ledger import DebtTransferOut, DebtTransferAction

router = APIRouter(prefix="/debt-approvals", tags=["debt-approvals"])


@router.post("/transfers/{transfer_id}/approve", response_model=DebtTransferOut)
def approve_transfer(
    transfer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.approve_debt_transfer(db, transfer_id, approved_by=current_user.username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/transfers/{transfer_id}/reject", response_model=DebtTransferOut)
def reject_transfer(
    transfer_id: int,
    payload: DebtTransferAction = DebtTransferAction(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.reject_debt_transfer(
            db, transfer_id, approved_by=current_user.username, reason=payload.reason
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
