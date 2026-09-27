from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import inventory


def test_supplier_discrepancy_list_accepts_partial_status(monkeypatch):
    db = Mock()
    list_discrepancies = Mock(return_value=[])
    monkeypatch.setattr(inventory.discrepancy_crud, "list_discrepancies", list_discrepancies)

    result = inventory.list_supplier_discrepancies(status="partial", db=db)

    assert result == []
    assert list_discrepancies.call_args.args[-1] == "partial"


def test_supplier_discrepancy_list_rejects_unknown_status():
    with pytest.raises(HTTPException) as exc_info:
        inventory.list_supplier_discrepancies(status="unknown", db=Mock())

    assert exc_info.value.status_code == 400
