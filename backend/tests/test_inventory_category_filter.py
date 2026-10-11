from unittest.mock import Mock
from app.api.v1.endpoints import inventory
from app.schemas.inventory import StockLevel


def test_stock_levels_endpoint_passes_category_id(monkeypatch):
    db = Mock()
    mock_get_stock_levels = Mock(return_value=[])
    monkeypatch.setattr(inventory.crud, "get_stock_levels", mock_get_stock_levels)

    result = inventory.stock_levels(warehouse_id=1, category_id=2, db=db)

    assert result == []
    mock_get_stock_levels.assert_called_once_with(db, warehouse_id=1, category_id=2)


def test_stock_level_schema_category_fields():
    item = StockLevel(
        product_id=10,
        product_code="SKU001",
        product_name="Product A",
        category_id=3,
        category_name="Beverages",
        category="Beverages",
        unit="Chai",
        on_hand=100,
        reserved=10,
        available=90,
        reorder_level=20,
    )
    data = item.model_dump()
    assert data["category_id"] == 3
    assert data["category_name"] == "Beverages"
    assert data["category"] == "Beverages"
