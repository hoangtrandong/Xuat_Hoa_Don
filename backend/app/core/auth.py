import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.database import get_db
from app.models.user import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
_PASSWORD_ITERATIONS = 310_000
_JWT_ALGORITHM = "HS256"
_MAX_FAILED_LOGIN_ATTEMPTS = 5
_LOGIN_LOCKOUT_MINUTES = 15
_RESOURCE_CODES = {
    "customers", "stores", "companies", "products", "product-groups",
    "sales-orders", "inventory", "employees", "payments", "debt",
    "delivery-requests", "sync", "users",
    "employee-debts", "store-debts", "cash-receipts", "debt-transfers",
    "delivery-returns", "bank-receipts", "employee-borrowing",
}


class AccountLockedError(Exception):
    """Raised when a user tries to log in while their account is temporarily locked."""

    def __init__(self, retry_after_minutes: int):
        self.retry_after_minutes = retry_after_minutes
        super().__init__(f"Account locked for {retry_after_minutes} more minute(s).")


def _signing_key() -> str:
    key = settings.SECRET_KEY
    if not key or key == "change-me-in-production" or len(key) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured with a strong SECRET_KEY.",
        )
    return key


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PASSWORD_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        _PASSWORD_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode().rstrip("="),
        base64.urlsafe_b64encode(digest).decode().rstrip("="),
    )


def verify_password(password: str, password_hash: str) -> bool:
    if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            import bcrypt

            return bcrypt.checkpw(password.encode(), password_hash.encode())
        except (ImportError, ValueError, TypeError):
            return False
    try:
        algorithm, rounds, salt_text, digest_text = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(rounds)
        if not 100_000 <= iterations <= 1_000_000:
            return False
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        expected = base64.urlsafe_b64decode(digest_text + "=" * (-len(digest_text) % 4))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_access_token(user: User) -> str:
    lifetime = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    if not 1 <= lifetime <= 10_080:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ACCESS_TOKEN_EXPIRE_MINUTES must be between 1 and 10080.",
        )
    expires = datetime.now(timezone.utc) + timedelta(minutes=lifetime)
    return jwt.encode(
        {"sub": str(user.id), "exp": expires},
        _signing_key(),
        algorithm=_JWT_ALGORITHM,
    )


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        return None
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if user.locked_until and user.locked_until > now:
        remaining_seconds = (user.locked_until - now).total_seconds()
        raise AccountLockedError(max(1, int(remaining_seconds // 60) + 1))
    if not user.is_active or not verify_password(password, user.hashed_password):
        if user.is_active:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= _MAX_FAILED_LOGIN_ATTEMPTS:
                user.locked_until = now + timedelta(minutes=_LOGIN_LOCKOUT_MINUTES)
            db.commit()
        return None
    if user.hashed_password.startswith(("$2a$", "$2b$", "$2y$")):
        user.hashed_password = hash_password(password)
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()
    return user


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, _signing_key(), algorithms=[_JWT_ALGORITHM])
        if "exp" not in payload:
            raise credentials_error
        subject = payload.get("sub")
        user_id = int(subject)
    except (JWTError, ValueError, TypeError):
        raise credentials_error
    user = db.scalar(
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user_id)
    )
    if not user or not user.is_active:
        raise credentials_error
    return user


def require_endpoint_permission(
    request: Request,
    user: User = Depends(get_current_user),
) -> User:
    request.state.user = user
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="PASSWORD_CHANGE_REQUIRED: Vui lòng đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.",
        )
    permission_code = permission_for_endpoint(request.url.path, request.method)
    check_permission(user, permission_code)
    return user


def permission_for_endpoint(path: str, method: str) -> str:
    parts = [part for part in path.split("/") if part]
    try:
        api_index = parts.index("v1")
        resource = parts[api_index + 1]
    except (ValueError, IndexError):
        raise HTTPException(status_code=403, detail="No permission is defined for this endpoint.")
    if resource not in _RESOURCE_CODES:
        raise HTTPException(status_code=403, detail="No permission is defined for this endpoint.")
    action = "read" if method.upper() == "GET" else "write"
    return f"{resource}:{action}"


def check_permission(user: User, permission_code: str) -> None:
    granted = {
        permission.code
        for role in user.roles
        for permission in role.permissions
    }
    if permission_code not in granted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied.")


def resolve_user_employee(db: Session, user: User):
    """Tra ve nhan vien cua tai khoan: uu tien lien ket employee_id, neu chua co thi
    lay nhan vien co ma trung ten dang nhap (quy uoc: ten dang nhap = ma NV)."""
    from sqlalchemy import func

    from app.models.employee import Employee

    if user is None:
        return None
    if user.employee is not None:
        return user.employee
    username = (user.username or "").strip()
    if not username:
        return None
    return db.scalar(select(Employee).where(func.upper(Employee.code) == username.upper()))
