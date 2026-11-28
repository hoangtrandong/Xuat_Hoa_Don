from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import debt_ledger as crud
from app.models.user import User
from app.services import order_replacement_return as replacement_service
from app.schemas.debt_ledger import (
    DeliveryReturnCancelRequest,
    DeliveryReturnCreate,
    DeliveryReturnDamageResolveRequest,
    DeliveryReturnItemOut,
    DeliveryReturnOut,
    DeliveryReturnReceiveRequest,
    EligibleNewOrderOut,
    EligibleOldOrderOut,
    OldOrderReplacementContextOut,
    ReplacementReturnCreateRequest,
    ReplacementReturnPreviewOut,
    ReplacementReturnPreviewRequest,
)

router = APIRouter(prefix="/delivery-returns", tags=["delivery-returns"])


def _is_admin_user(user: User) -> bool:
    username = (getattr(user, "username", None) or "").strip().lower()
    if username == "admin":
        return True
    return any(
        (getattr(role, "name", None) or "").strip().lower() == "admin"
        for role in (getattr(user, "roles", None) or [])
    )


@router.get("", response_model=List[DeliveryReturnOut])
def get_delivery_returns(
    delivery_request_id: Optional[int] = None,
    employee_id: Optional[int] = None,
    status: Optional[str] = None,
    return_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    return crud.list_delivery_returns(
        db,
        delivery_request_id=delivery_request_id,
        employee_id=employee_id,
        status=status,
        return_type=return_type,
        search=search,
        limit=limit,
    )


@router.get("/eligible-old-orders", response_model=List[EligibleOldOrderOut])
def get_eligible_old_orders(
    search: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    return replacement_service.list_eligible_old_orders(db, search=search, limit=limit)


@router.get("/eligible-new-orders", response_model=List[EligibleNewOrderOut])
def get_eligible_new_orders(
    search: Optional[str] = None,
    customer_code: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    return replacement_service.list_eligible_new_orders(
        db,
        search=search,
        customer_code=customer_code,
        limit=limit,
    )


@router.get("/old-order-context/{order_number}", response_model=OldOrderReplacementContextOut)
def get_old_order_replacement_context(
    order_number: str,
    db: Session = Depends(get_db),
):
    return replacement_service.get_old_order_replacement_context(db, old_order_number=order_number)


@router.post("/preview-replacement", response_model=ReplacementReturnPreviewOut)
def preview_replacement_return(
    payload: ReplacementReturnPreviewRequest,
    db: Session = Depends(get_db),
):
    try:
        return replacement_service.preview_replacement_return(
            db,
            old_delivery_request_order_id=payload.old_delivery_request_order_id,
            old_order_number=payload.old_order_number,
            new_order_number=payload.new_order_number,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/from-replacement", response_model=DeliveryReturnOut)
def create_replacement_return(
    payload: ReplacementReturnCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return replacement_service.create_replacement_return(
            db,
            old_delivery_request_order_id=payload.old_delivery_request_order_id,
            old_order_number=payload.old_order_number,
            new_order_number=payload.new_order_number,
            created_by=current_user.username,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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
            auto_receive=payload.auto_receive,
            settlement_party_type=payload.settlement_party_type,
            settlement_party_id=payload.settlement_party_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{return_id}/receive", response_model=DeliveryReturnOut)
def receive_delivery_return(
    return_id: int,
    payload: DeliveryReturnReceiveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.receive_delivery_return(
            db,
            return_id=return_id,
            received_by=current_user.username,
            items_payload=payload.items,
            restore_stock=payload.restore_stock,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{return_id}/cancel", response_model=DeliveryReturnOut)
def cancel_delivery_return(
    return_id: int,
    payload: DeliveryReturnCancelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.cancel_delivery_return(
            db,
            return_id=return_id,
            cancelled_by=current_user.username,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{return_id}/items/{item_id}/resolve-damage", response_model=DeliveryReturnItemOut)
def resolve_damaged_item(
    return_id: int,
    item_id: int,
    payload: DeliveryReturnDamageResolveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được duyệt đền bù/miễn trừ hàng hỏng.")
    try:
        return crud.resolve_damaged_return_item(
            db,
            return_id=return_id,
            item_id=item_id,
            resolution=payload.resolution,
            resolved_by=current_user.username,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

