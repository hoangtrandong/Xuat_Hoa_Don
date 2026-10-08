from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import debt_ledger as crud
from app.models.user import User
from app.schemas.debt_ledger import CashReceiptCreate, CashReceiptOut

router = APIRouter(prefix="/cash-receipts", tags=["cash-receipts"])


@router.get("", response_model=List[CashReceiptOut])
def get_cash_receipts(limit: int = 50, db: Session = Depends(get_db)):
    return crud.list_cash_receipts(db, limit=limit)


@router.post("", response_model=CashReceiptOut)
def create_cash_receipt(
    payload: CashReceiptCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.create_cash_receipt(
            db,
            party_type=payload.party_type,
            party_id=payload.party_id,
            amount=payload.amount,
            note=payload.note,
            created_by=current_user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
