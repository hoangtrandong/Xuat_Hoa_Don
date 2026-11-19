"""Encryption helpers for supplier credentials stored in application database."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    secret = (settings.SECRET_KEY or "").encode("utf-8")
    if not secret or settings.SECRET_KEY == "change-me-in-production":
        raise RuntimeError("SECRET_KEY phải được cấu hình trước khi lưu bí mật Nhà cung cấp.")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt_supplier_secret(value: str | None) -> str | None:
    clean_value = (value or "").strip()
    if not clean_value:
        return None
    if clean_value.startswith(_PREFIX):
        return clean_value
    token = _fernet().encrypt(clean_value.encode("utf-8")).decode("ascii")
    return f"{_PREFIX}{token}"


def decrypt_supplier_secret(value: str | None) -> str:
    clean_value = (value or "").strip()
    if not clean_value:
        return ""
    if not clean_value.startswith(_PREFIX):
        return clean_value
    try:
        token = clean_value[len(_PREFIX) :]
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError) as exc:
        raise RuntimeError(
            "Không thể giải mã bí mật Nhà cung cấp. Kiểm tra SECRET_KEY của môi trường."
        ) from exc


def is_encrypted_supplier_secret(value: str | None) -> bool:
    return bool(value and value.startswith(_PREFIX))
