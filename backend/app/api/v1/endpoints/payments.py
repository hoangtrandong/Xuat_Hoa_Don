from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.finance import Payment, PaymentCreate
from app.crud import payment as crud

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("/", response_model=List[Payment])
def list_payments(skip: int = 0, limit: int = 100, customer_id: int | None = None, db: Session = Depends(get_db)):
    return crud.list_(db, skip=skip, limit=limit, customer_id=customer_id)


@router.post("/", response_model=Payment, status_code=201)
def create_payment(payload: PaymentCreate, db: Session = Depends(get_db)):
    return crud.create(db, payload)