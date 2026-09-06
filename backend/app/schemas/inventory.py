from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional


class InventoryTransaction(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    type: str
    warehouse_id: int
    product_id: int
    quantity: int
    ref_type: Optional[str]
    ref_code: Optional[str]
    note: Optional[str]
    created_by: Optional[str]
    created_at: datetime


class StockLevel(BaseModel):
    product_id: int
    product_code: str
    product_name: str
    unit: str
    on_hand: int
    reserved: int
    available: int
    reorder_level: int


class Warehouse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    location: Optional[str] = None
    manager: Optional[str] = None


class StockAdjust(BaseModel):
    type: str  # IN | OUT | ADJUST
    warehouse_id: int
    product_id: int
    quantity: int
    ref_type: Optional[str] = None
    ref_code: Optional[str] = None
    note: Optional[str] = None