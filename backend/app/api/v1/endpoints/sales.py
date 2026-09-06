from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.sales import SalesOrder, SalesOrderCreate
from app.crud import sales_order as crud

router = APIRouter(prefix="/sales-orders", tags=["sales"])


@router.get("/", response_model=List[SalesOrder])
def list_orders(skip: int = 0, limit: int = 100, customer_id: int | None = None, status: str | None = None, db: Session = Depends(get_db)):
    return crud.list_(db, skip=skip, limit=limit, customer_id=customer_id, status=status)


@router.post("/", response_model=SalesOrder, status_code=201)
def create_order(payload: SalesOrderCreate, db: Session = Depends(get_db)):
    return crud.create(db, payload)


@router.get("/{order_id}", response_model=SalesOrder)
def get_order(order_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, order_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Order not found")
    return obj