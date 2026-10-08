from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.crud import debt_ledger as crud
from app.schemas.debt_ledger import StoreDebtSummary, DebtLedgerEntryOut

router = APIRouter(prefix="/store-debts", tags=["store-debts"])


@router.get("", response_model=List[StoreDebtSummary])
def get_store_debts(db: Session = Depends(get_db)):
    return crud.list_store_debt_summaries(db)


@router.get("/{store_id}/ledger", response_model=List[DebtLedgerEntryOut])
def get_store_ledger(store_id: int, limit: int = 150, db: Session = Depends(get_db)):
    return crud.get_party_ledger(db, party_type="STORE", party_id=store_id, limit=limit)
