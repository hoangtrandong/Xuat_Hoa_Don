from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import debt_ledger as crud
from app.models.user import User
from app.schemas.debt_ledger import (
    DebtTransferApproveRequest,
    DebtTransferCreate,
    DebtTransferOut,
    DebtTransferRejectRequest,
)

router = APIRouter(prefix="/debt-transfers", tags=["debt-transfers"])


def _is_admin_user(user: User) -> bool:
    username = (getattr(user, "username", None) or "").strip().lower()
    if username == "admin":
        return True
    return any(
        (getattr(role, "name", None) or "").strip().lower() == "admin"
        for role in (getattr(user, "roles", None) or [])
    )


@router.get("", response_model=List[DebtTransferOut])
def get_debt_transfers(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    return crud.list_debt_transfers(db, status=status)


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
            delivery_request_order_id=payload.delivery_request_order_id,
            pod_image_url=payload.pod_image_url,
            require_approval=payload.require_approval,
            is_admin=_is_admin_user(current_user),
            override_limit_reason=payload.override_limit_reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{transfer_id}/approve", response_model=DebtTransferOut)
def approve_debt_transfer(
    transfer_id: int,
    payload: DebtTransferApproveRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.approve_debt_transfer(
            db,
            transfer_id=transfer_id,
            approved_by=current_user.username,
            is_admin=_is_admin_user(current_user),
            override_limit_reason=payload.override_limit_reason if payload else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{transfer_id}/reject", response_model=DebtTransferOut)
def reject_debt_transfer(
    transfer_id: int,
    payload: DebtTransferRejectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return crud.reject_debt_transfer(
            db,
            transfer_id=transfer_id,
            rejected_by=current_user.username,
            reject_reason=payload.reject_reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
