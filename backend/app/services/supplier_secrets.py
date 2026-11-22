"""Encryption helpers for supplier credentials stored in application database."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings

_PREFIX = "enc:v1:"


def _derive_fernet(raw_secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(raw_secret.encode("utf-8")).digest())
    return Fernet(key)


def _fernet() -> MultiFernet:
    """Ưu tiên dùng DATA_ENCRYPTION_KEY riêng cho mã hóa bí mật NCC/CQT;
    giữ SECRET_KEY làm fallback giải mã ngược tương thích khi xoay vòng khóa."""
    fernets: list[Fernet] = []
    data_key = (settings.DATA_ENCRYPTION_KEY or "").strip()
    if data_key and data_key != "change-me-in-production":
        fernets.append(_derive_fernet(data_key))

    secret = (settings.SECRET_KEY or "").strip()
    if secret and secret != "change-me-in-production":
        if secret != data_key:
            fernets.append(_derive_fernet(secret))

    if not fernets:
        raise RuntimeError(
            "DATA_ENCRYPTION_KEY hoặc SECRET_KEY phải được cấu hình trước khi lưu bí mật Nhà cung cấp."
        )
    return MultiFernet(fernets)


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
