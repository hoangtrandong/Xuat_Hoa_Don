"""Chuẩn hóa mã khách hàng đồng bộ từ Vinamilk DMS (mặc định lấy 3 ký tự cuối)."""

from __future__ import annotations

_PRESERVE_PREFIXES = ("NVGH-", "NVBH-", "KH-")
_PRESERVE_EXACT = {"NVBH", "KH_LE", "KH-LE", "DEFAULT"}


def is_vinamilk_supplier(supplier_code: str | None) -> bool:
    """Kiểm tra nguồn dữ liệu có phải Vinamilk không (mặc định True nếu rỗng/None)."""
    sup = (supplier_code or "VINAMILK").strip().upper()
    return sup == "VINAMILK" or "VINAMILK" in sup


def normalize_vinamilk_customer_code(
    code: str | None,
    supplier_code: str | None = "VINAMILK",
) -> str:
    """Lấy 3 ký tự cuối của mã khách hàng khi dữ liệu đến từ Vinamilk.

    - Giữ nguyên các mã nội bộ / placeholder (`NVGH-*`, `NVBH-*`, `KH-*`, `DEFAULT`, `KH_LE`).
    - Giữ nguyên nếu nguồn không phải Vinamilk.
    - VD: `MG200310CR` -> `0CR`, `MG2003100J` -> `00J`, `00J` -> `00J`.
    """
    cleaned = (code or "").strip()
    if not cleaned:
        return ""
    if not is_vinamilk_supplier(supplier_code):
        return cleaned
    upper = cleaned.upper()
    if upper.startswith(_PRESERVE_PREFIXES) or upper in _PRESERVE_EXACT:
        return cleaned
    return cleaned[-3:] if len(cleaned) > 3 else cleaned
