from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.audit import record_login_attempt
from app.core.auth import (
    AccountLockedError,
    authenticate_user,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.core.database import get_db
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


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


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
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
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    record_login_attempt(username=payload.username, success=True, ip_address=_client_ip(request), user=user)
    return TokenResponse(access_token=create_access_token(user), must_change_password=user.must_change_password)


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
