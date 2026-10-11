from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import debt_ledger as crud
from app.models.user import User
from app.schemas.debt_ledger import DeliveryReturnCreate, DeliveryReturnOut

router = APIRouter(prefix="/delivery-returns", tags=["delivery-returns"])


@router.get("", response_model=List[DeliveryReturnOut])
def get_delivery_returns(
    delivery_request_id: Optional[int] = None,
    employee_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    return crud.list_delivery_returns(
        db,
        delivery_request_id=delivery_request_id,
        employee_id=employee_id,
        limit=limit,
    )


@router.post("", response_model=DeliveryReturnOut)
def create_delivery_return(
    payload: DeliveryReturnCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.create_delivery_return(
            db,
            delivery_request_id=payload.delivery_request_id,
            employee_id=payload.employee_id,
            amount=payload.amount or 0.0,
            order_id=payload.order_id,
            items=payload.items,
            restore_stock=payload.restore_stock,
            note=payload.note,
            created_by=current_user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

