from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.schemas.sales import SalesOrder, SalesOrderChangeCustomerRequest, SalesOrderCreate
from app.crud import sales_order as crud

router = APIRouter(prefix="/sales-orders", tags=["sales"])


@router.get("/", response_model=List[SalesOrder])
def list_orders(skip: int = 0, limit: int = 100, customer_id: int | None = None, status: str | None = None, db: Session = Depends(get_db)):
    return crud.list_(db, skip=skip, limit=limit, customer_id=customer_id, status=status)


@router.post("/", response_model=SalesOrder, status_code=201)
def create_order(payload: SalesOrderCreate, db: Session = Depends(get_db)):
    return crud.create(db, payload)


from datetime import datetime
from app.schemas.sales import CustomerProductSummary

@router.get("/reports/product-summary", response_model=List[CustomerProductSummary])
def product_summary_by_customer(
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    db: Session = Depends(get_db)
):
    """
    Thống kê tổng hợp danh sách sản phẩm (số lượng, thành tiền) theo từng khách hàng.
    """
    return crud.get_product_summary_by_customer(db, from_date=from_date, to_date=to_date)


@router.get("/{order_id}", response_model=SalesOrder)
def get_order(order_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, order_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Order not found")
    return obj


@router.patch("/{order_id}/customer", response_model=SalesOrder)
def change_order_customer(
    order_id: int,
    payload: SalesOrderChangeCustomerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.change_customer(db, order_id=order_id, customer_id=payload.customer_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
