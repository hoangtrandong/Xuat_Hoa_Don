from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator
from typing import Any, Optional, List
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
    invoice_product_id: Optional[int] = None
    invoice_product_code: Optional[str] = None
    invoice_product_name: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    category: Optional[str] = None
    unit: str
    on_hand: int
    reserved: int
    available: int
    locked_quantity: int = 0
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


class BulkDeleteStockRequest(BaseModel):
    warehouse_id: Optional[int] = None
    product_ids: List[int] = Field(default_factory=list)
    invoice_product_ids: List[int] = Field(default_factory=list)
    note: Optional[str] = None


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
    locked_quantity: int = 0
    unit_cost: Optional[float] = None


class InventoryLotDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    warehouse_id: int
    location_id: Optional[int] = None
    location_code: Optional[str] = None
    location_name: Optional[str] = None
    product_id: int
    product_code: str
    product_name: str
    invoice_product_id: Optional[int] = None
    invoice_product_code: Optional[str] = None
    invoice_product_name: Optional[str] = None
    unit: str
    lot_number: Optional[str] = None
    expiry_date: Optional[datetime] = None
    quantity_on_hand: int
    locked_quantity: int = 0
    reserved_quantity: int = 0
    available_quantity: int = 0
    unit_cost: Optional[float] = None


class InventoryImportItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    unit: Optional[str] = None
    lot_number: str
    expiry_date: datetime
    source_location_code: Optional[str] = None
    boxes_per_carton: int = Field(default=1, gt=0)
    cartons: int = 0
    loose_boxes: int = 0
    quantity: int = Field(gt=0)
    actual_qty: Optional[int] = Field(default=None, ge=0)
    allocations: List["InventoryImportAllocation"] = Field(default_factory=list)
    delivery_references: Optional[str] = None
    po_references: Optional[str] = None
    document_date: Optional[datetime] = None
    invoice_number: Optional[str] = None
    unit_price: Optional[float] = None
    amount: Optional[float] = None
    note: Optional[str] = None

    @field_validator("actual_qty", mode="before")
    @classmethod
    def actual_quantity_must_not_be_boolean(cls, value: Any) -> Any:
        if isinstance(value, bool):
            raise ValueError("actual_qty must be a non-negative integer.")
        return value


class InventoryImportAllocation(BaseModel):
    location_id: int
    quantity: int = Field(gt=0)


class InventoryImportConfirm(BaseModel):
    warehouse_id: int
    items: List[InventoryImportItem] = Field(min_length=1)
    ref_code: Optional[str] = None
    invoice_number: Optional[str] = None
    delivery_references: Optional[str] = None
    document_date: Optional[datetime] = None
    note: Optional[str] = None
    created_by: Optional[str] = None


class SupplierGoodsDiscrepancyResponse(BaseModel):
    id: int
    warehouse_id: int
    warehouse_name: Optional[str] = None
    product_id: int
    product_sku: Optional[str] = None
    product_name: Optional[str] = None
    supplier: Optional[str] = None
    type: str
    document_quantity: int
    actual_quantity: int
    quantity: int
    remaining_quantity: int
    lot_number: Optional[str]
    expiry_date: Optional[datetime]
    invoice_number: Optional[str]
    ref_code: Optional[str]
    document_date: Optional[datetime]
    note: Optional[str]
    created_by: Optional[str]
    created_at: datetime
    status: str

    model_config = ConfigDict(from_attributes=True)


class SupplierGoodsDiscrepancySourceResponse(BaseModel):
    id: int
    lot_id: int
    quantity: int
    released_quantity: int

    model_config = ConfigDict(from_attributes=True)


class SupplierGoodsDiscrepancyOffsetResponse(BaseModel):
    id: int
    shortage_id: int
    excess_id: int
    quantity: int
    note: Optional[str]
    created_by: Optional[str]
    created_at: datetime
    shortage_invoice_number: Optional[str] = None
    excess_invoice_number: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class SupplierGoodsDiscrepancyHistory(BaseModel):
    discrepancy: SupplierGoodsDiscrepancyResponse
    sources: List[SupplierGoodsDiscrepancySourceResponse] = Field(default_factory=list)
    offsets: List[SupplierGoodsDiscrepancyOffsetResponse] = Field(default_factory=list)


class SupplierGoodsDiscrepancySuggestion(SupplierGoodsDiscrepancyResponse):
    suggested_quantity: int


class SupplierGoodsDiscrepancyOffsetConfirm(BaseModel):
    shortage_id: int
    excess_id: int
    quantity: int = Field(gt=0)
    note: Optional[str] = None
    created_by: Optional[str] = None


class InventoryTransferItemCreate(BaseModel):
    product_id: int
    lot_id: Optional[int] = None
    source_location_id: int
    destination_location_id: int
    quantity: int = Field(gt=0)


class InventoryTransferCreate(BaseModel):
    warehouse_id: int
    items: List[InventoryTransferItemCreate] = Field(min_length=1)
    note: Optional[str] = None
    created_by: Optional[str] = None


class InventoryTransferItemResponse(InventoryTransferItemCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class InventoryTransferResponse(BaseModel):
    id: int
    code: str
    warehouse_id: int
    status: str
    note: Optional[str]
    created_by: Optional[str]
    created_at: datetime
    confirmed_at: Optional[datetime]
    items: List[InventoryTransferItemResponse]

    model_config = ConfigDict(from_attributes=True)