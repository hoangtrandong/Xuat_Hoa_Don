from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.crud import debt_ledger as crud
from app.schemas.debt_ledger import EmployeeDebtSummary, DebtLedgerEntryOut

router = APIRouter(prefix="/employee-debts", tags=["employee-debts"])


@router.get("", response_model=List[EmployeeDebtSummary])
def get_employee_debts(db: Session = Depends(get_db)):
    return crud.list_employee_debt_summaries(db)


@router.get("/{employee_id}/ledger", response_model=List[DebtLedgerEntryOut])
def get_employee_ledger(employee_id: int, limit: int = 150, db: Session = Depends(get_db)):
    return crud.get_party_ledger(db, party_type="EMPLOYEE", party_id=employee_id, limit=limit)
