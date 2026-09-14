from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from pydantic import Field


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
    document_date: Optional[datetime] = None
    lot_id: Optional[int] = None
    location_id: Optional[int] = None
    expiry_date: Optional[datetime] = None


class StockLevel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: int
    product_code: str
    product_name: str
    unit: str
    on_hand: int
    reserved: int
    available: int
    reorder_level: int
    lot_count: int = 0  # Số lô đang có hàng
    earliest_expiry: Optional[datetime] = None  # Hạn sử dụng gần nhất
    locations: Optional[str] = None  # Danh sách vị trí (phân cách dấu phẩy)


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
    lot_number: Optional[str] = None
    location_id: Optional[int] = None
    expiry_date: Optional[datetime] = None
    unit_cost: Optional[float] = None


class WarehouseLocation(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    warehouse_id: int
    code: str
    name: Optional[str] = None
    is_active: bool = True


class InventoryLot(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    warehouse_id: int
    location_id: Optional[int] = None
    product_id: int
    lot_number: Optional[str] = None
    expiry_date: Optional[datetime] = None
    quantity_on_hand: int
    unit_cost: Optional[float] = None


class InventoryImportItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    unit: Optional[str] = None
    lot_number: str
    expiry_date: datetime
    source_location_code: Optional[str] = None
    cartons: int = 0
    loose_boxes: int = 0
    quantity: int = Field(gt=0)
    allocations: List["InventoryImportAllocation"] = Field(default_factory=list)
    delivery_references: Optional[str] = None
    po_references: Optional[str] = None
    document_date: Optional[datetime] = None


class InventoryImportAllocation(BaseModel):
    location_id: int
    quantity: int = Field(gt=0)


class InventoryImportConfirm(BaseModel):
    warehouse_id: int
    items: List[InventoryImportItem] = Field(min_length=1)
    ref_code: Optional[str] = None
    delivery_references: Optional[str] = None
    document_date: Optional[datetime] = None
    note: Optional[str] = None
    created_by: Optional[str] = None