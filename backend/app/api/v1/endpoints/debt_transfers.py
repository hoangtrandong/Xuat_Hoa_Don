from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import debt_ledger as crud
from app.models.user import User
from app.schemas.debt_ledger import DebtTransferCreate, DebtTransferOut

router = APIRouter(prefix="/debt-transfers", tags=["debt-transfers"])


@router.get("", response_model=List[DebtTransferOut])
def get_debt_transfers(
    db: Session = Depends(get_db),
):
    return crud.list_debt_transfers(db)


@router.post("", response_model=DebtTransferOut)
def create_debt_transfer(
    payload: DebtTransferCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.create_debt_transfer(
            db,
            from_party_type=payload.from_party_type,
            from_party_id=payload.from_party_id,
            to_party_type=payload.to_party_type,
            to_party_id=payload.to_party_id,
            amount=payload.amount,
            reason=payload.reason,
            created_by=current_user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
