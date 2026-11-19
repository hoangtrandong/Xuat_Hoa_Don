"""Quản lý thông tin đăng nhập và phiên làm việc Vinamilk DMS One trong Database (có mã hóa)."""

from __future__ import annotations

import base64
import hashlib
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from dotenv import dotenv_values
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.vinamilk import VinamilkCredential
from app.services.supplier_secrets import decrypt_supplier_secret, encrypt_supplier_secret

_ENV_LOCAL = Path(__file__).resolve().parents[2] / ".env.local"


def _fernet() -> Fernet:
    raw_secret = (settings.SECRET_KEY or "dms-default-secret-key").encode("utf-8")
    key_bytes = hashlib.sha256(raw_secret).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt_vinamilk_password(password: str) -> str:
    return _fernet().encrypt(password.encode("utf-8")).decode("utf-8")


def decrypt_vinamilk_password(encrypted_password: str) -> str:
    try:
        return _fernet().decrypt(encrypted_password.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Không thể giải mã mật khẩu Vinamilk trong database (SECRET_KEY có thể đã thay đổi).") from exc


def get_db_credential(db: Session | None = None) -> VinamilkCredential | None:
    if db is not None:
        return db.get(VinamilkCredential, 1)
    try:
        with SessionLocal() as session:
            return session.get(VinamilkCredential, 1)
    except Exception:
        return None


def load_db_credentials(db: Session | None = None) -> tuple[str, str] | None:
    """Đọc username & password từ bảng vinamilk_credentials nếu đã cấu hình."""
    record = get_db_credential(db)
    if not record or not record.username or not record.encrypted_password:
        return None
    try:
        password = decrypt_vinamilk_password(record.encrypted_password)
        if record.username.strip() and password:
            return record.username.strip(), password
    except Exception:
        return None
    return None


def load_db_session_cookie(db: Session | None = None) -> str:
    record = get_db_credential(db)
    if record and record.session_cookie:
        return decrypt_supplier_secret(record.session_cookie)
    return ""


def save_db_session_cookie(cookie: str, db: Session | None = None) -> None:
    if not cookie:
        return
    if db is not None:
        record = db.get(VinamilkCredential, 1)
        if record is not None:
            record.session_cookie = encrypt_supplier_secret(cookie)
            db.commit()
        return
    with SessionLocal() as session:
        record = session.get(VinamilkCredential, 1)
        if record is not None:
            record.session_cookie = encrypt_supplier_secret(cookie)
            session.commit()


def upsert_db_credentials(
    db: Session,
    username: str,
    password: str | None = None,
    updated_by: str | None = None,
    session_cookie: str | None = None,
) -> VinamilkCredential:
    clean_username = username.strip()
    if not clean_username:
        raise ValueError("Tài khoản (username) Vinamilk DMS không được để trống.")

    record = db.get(VinamilkCredential, 1)
    now = datetime.utcnow()

    if record is None:
        if not password:
            raise ValueError("Vui lòng nhập mật khẩu Vinamilk DMS cho lần cấu hình đầu tiên.")
        record = VinamilkCredential(
            id=1,
            username=clean_username,
            encrypted_password=encrypt_vinamilk_password(password),
            session_cookie=encrypt_supplier_secret(session_cookie),
            updated_by=updated_by,
            updated_at=now,
        )
        db.add(record)
    else:
        username_changed = record.username != clean_username
        record.username = clean_username
        if password:
            record.encrypted_password = encrypt_vinamilk_password(password)
        if session_cookie is not None:
            record.session_cookie = encrypt_supplier_secret(session_cookie)
        elif password or username_changed:
            # Xóa cookie cũ khi đổi mật khẩu hoặc đổi username mà chưa lấy cookie mới
            record.session_cookie = None
        if updated_by:
            record.updated_by = updated_by
        record.updated_at = now

    db.commit()
    db.refresh(record)
    return record


def get_credentials_status(db: Session) -> dict[str, Any]:
    """Trả về thông tin hiển thị cho giao diện (không bao giờ trả về mật khẩu)."""
    record = db.get(VinamilkCredential, 1)
    if record and record.username and record.encrypted_password:
        return {
            "username": record.username,
            "has_password": True,
            "source": "DATABASE",
            "has_session_cookie": bool(record.session_cookie),
            "updated_by": record.updated_by,
            "updated_at": record.updated_at,
        }

    values = dotenv_values(_ENV_LOCAL)
    env_username = (os.environ.get("VINAMILK_USERNAME") or values.get("VINAMILK_USERNAME") or "").strip()
    env_password = os.environ.get("VINAMILK_PASSWORD") or values.get("VINAMILK_PASSWORD") or ""
    if env_username:
        return {
            "username": env_username,
            "has_password": bool(env_password),
            "source": "ENVIRONMENT",
            "has_session_cookie": bool(
                os.environ.get("VINAMILK_SESSION_COOKIE") or values.get("VINAMILK_SESSION_COOKIE")
            ),
            "updated_by": None,
            "updated_at": None,
        }

    return {
        "username": "",
        "has_password": False,
        "source": "NONE",
        "has_session_cookie": False,
        "updated_by": None,
        "updated_at": None,
    }
