from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_login_attempt
from app.core.auth import (
    AccountLockedError,
    authenticate_user,
    create_access_token,
    get_current_user,
    hash_password,
    is_super_admin_user,
    resolve_user_employee,
    verify_password,
)
from app.core.database import get_db
from app.models.multi_tenant_invoice import Distributor
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["authentication"])


class LoginRequest(BaseModel):
    company_code: str | None = None
    username: str
    password: str
    distributor_id: int | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False
    username: str | None = None
    full_name: str | None = None
    distributor_id: int | None = None
    distributor_code: str | None = None
    distributor_name: str | None = None
    distributor_tax_code: str | None = None
    is_super_admin: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, value: str) -> str:
        if len(value) < 12:
            raise ValueError("Password must contain at least 12 characters.")
        return value


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("/distributors")
def list_login_distributors(db: Session = Depends(get_db)) -> list[dict]:
    """Danh sách Nhà phân phối hiển thị trên màn hình Đăng nhập DMS."""
    from app.api.v1.endpoints.multi_tenant_einvoice import _ensure_default_distributors_seeded

    _ensure_default_distributors_seeded(db)
    distributors = db.scalars(
        select(Distributor).where(Distributor.status == "active").order_by(Distributor.id)
    ).all()
    return [
        {
            "id": d.id,
            "code": d.code,
            "name": d.name,
            "tax_code": d.tax_code or "",
        }
        for d in distributors
    ]


def _resolve_distributor_by_company_code(db: Session, company_code: str | None) -> Distributor | None:
    raw = (company_code or "").strip()
    if not raw or raw.upper() in {"ADMIN", "SYSTEM", "ALL", "ROOT"}:
        return None
    from app.api.v1.endpoints.multi_tenant_einvoice import _ensure_default_distributors_seeded

    _ensure_default_distributors_seeded(db)
    norm = raw.upper().replace("_", "-")
    distributors = db.scalars(select(Distributor).where(Distributor.status == "active")).all()
    for d in distributors:
        d_code = (d.code or "").strip().upper()
        d_code_norm = d_code.replace("_", "-")
        d_short = d_code_norm.removeprefix("NPP-")
        d_tax = (d.tax_code or "").strip()
        if (
            raw.upper() == d_code
            or norm == d_code_norm
            or norm == d_short
            or (d_tax and raw == d_tax)
        ):
            return d
    return None


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    raw_company = (payload.company_code or "").strip()
    target_dist: Distributor | None = None
    if raw_company and raw_company.upper() not in {"ADMIN", "SYSTEM", "ALL", "ROOT"}:
        target_dist = _resolve_distributor_by_company_code(db, raw_company)
        if target_dist is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Mã DN '{raw_company}' không tồn tại hoặc chưa kích hoạt.",
                headers={"WWW-Authenticate": "Bearer"},
            )
    elif payload.distributor_id is not None:
        target_dist = db.get(Distributor, payload.distributor_id)

    try:
        user = authenticate_user(db, payload.username, payload.password)
    except AccountLockedError as exc:
        record_login_attempt(username=payload.username, success=False, ip_address=_client_ip(request))
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=(
                f"Tài khoản tạm khóa do đăng nhập sai nhiều lần. "
                f"Vui lòng thử lại sau khoảng {exc.retry_after_minutes} phút."
            ),
        ) from exc
    if not user:
        record_login_attempt(username=payload.username, success=False, ip_address=_client_ip(request))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Mã NV hoặc mật khẩu không chính xác.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Kiểm tra phân quyền theo Mã DN / Nhà phân phối (NPP)
    target_dist_id = target_dist.id if target_dist else payload.distributor_id
    if (
        target_dist_id is not None
        and user.distributor_id is not None
        and user.distributor_id != target_dist_id
    ):
        assigned_code = user.distributor.code if user.distributor else f"ID #{user.distributor_id}"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Mã NV '{user.username}' thuộc Mã DN [{assigned_code}], không thuộc Mã DN đã nhập.",
        )

    eff_dist = user.distributor or target_dist

    record_login_attempt(username=payload.username, success=True, ip_address=_client_ip(request), user=user)
    return TokenResponse(
        access_token=create_access_token(user),
        must_change_password=user.must_change_password,
        username=user.username,
        full_name=user.full_name,
        distributor_id=eff_dist.id if eff_dist else user.distributor_id,
        distributor_code=eff_dist.code if eff_dist else None,
        distributor_name=eff_dist.name if eff_dist else None,
        distributor_tax_code=eff_dist.tax_code if eff_dist else None,
        is_super_admin=is_super_admin_user(user),
    )


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng.")
    current_user.hashed_password = hash_password(payload.new_password)
    current_user.must_change_password = False
    current_user.failed_login_attempts = 0
    current_user.locked_until = None
    db.commit()
    return {"detail": "Đổi mật khẩu thành công."}


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role_names = [role.name for role in (current_user.roles or []) if role and role.name]
    is_admin = (
        (current_user.username or "").strip().lower() == "admin"
        or any(r.strip().lower() == "admin" for r in role_names)
    )
    is_super_admin = is_super_admin_user(current_user)
    employee = resolve_user_employee(db, current_user)
    dist = current_user.distributor
    return {
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "employee_code": employee.code if employee else None,
        "employee_name": employee.name if employee else None,
        "distributor_id": current_user.distributor_id,
        "distributor_code": dist.code if dist else None,
        "distributor_name": dist.name if dist else None,
        "distributor_tax_code": dist.tax_code if dist else None,
        "roles": role_names,
        "is_admin": is_admin,
        "is_super_admin": is_super_admin,
    }
