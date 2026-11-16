from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.multi_tenant_einvoice import _ensure_user_can_access_supplier_config


def _user(distributor_id: int | None, username: str = "tenant-user", roles=None):
    return SimpleNamespace(
        distributor_id=distributor_id,
        username=username,
        roles=roles or [],
    )


def test_supplier_config_scope_allows_own_distributor():
    _ensure_user_can_access_supplier_config(_user(2), 2)


def test_supplier_config_scope_rejects_another_distributor():
    with pytest.raises(HTTPException) as exc_info:
        _ensure_user_can_access_supplier_config(_user(2), 3)

    assert exc_info.value.status_code == 403


def test_supplier_config_scope_rejects_unassigned_non_admin():
    with pytest.raises(HTTPException) as exc_info:
        _ensure_user_can_access_supplier_config(_user(None), 2)

    assert exc_info.value.status_code == 403


def test_supplier_config_scope_allows_system_admin():
    admin = _user(None, username="admin")
    _ensure_user_can_access_supplier_config(admin, 2)
