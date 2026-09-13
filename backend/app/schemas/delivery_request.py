from datetime import datetime
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, ConfigDict, Field


class DeliveryRequestItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(ge=0)
    requested_quantity_raw: Optional[str] = None
    employee_allocations: Optional[Dict[str, Any]] = None


class DeliveryRequestCreate(BaseModel):
    warehouse_id: int
    items: List[DeliveryRequestItemCreate] = Field(min_length=1)
    note: Optional[str] = None
    created_by: Optional[str] = None


class DeliveryPreviewItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    quantity: int
    requested_quantity_raw: Optional[str] = None
    available_quantity: int = 0
    shortage_quantity: int = 0
    employee_allocations: Optional[Dict[str, Any]] = None
    allocations: List["DeliveryAllocation"] = Field(default_factory=list)


class FefoPlanPick(BaseModel):
    location_code: Optional[str] = None
    lot_number: Optional[str] = None
    expiry_date: Optional[datetime] = None
    quantity: int
    allocation_strategy: str


class FefoPlanItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    quantity: int
    planned_quantity: int
    shortage_quantity: int
    picks: List[FefoPlanPick] = Field(default_factory=list)


class DeliveryAllocation(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    allocated_quantity: int
    allocation_sequence: int
    allocation_strategy: str
    lot_id: Optional[int] = None
    location_id: Optional[int] = None
    expiry_date: Optional[datetime] = None


class DeliveryRequestItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    quantity: int
    requested_quantity_raw: Optional[str] = None
    sku: str
    product_name: str
    available_quantity: int = 0
    shortage_quantity: int = 0
    allocations: List[DeliveryAllocation] = Field(default_factory=list)
    employee_allocations: Optional[Dict[str, Any]] = None


class DeliveryRequestItemList(BaseModel):
    """Lightweight item for list endpoints - avoids loading full Product/Allocation rows."""
    id: int
    product_id: int
    quantity: int
    requested_quantity_raw: Optional[str] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    available_quantity: int = 0
    shortage_quantity: int = 0


class DeliveryRequestList(BaseModel):
    """Lightweight request summary for list views - skips items.allocations."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    warehouse_id: int
    status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    submitted_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime
    items: List[DeliveryRequestItemList] = Field(default_factory=list)
    item_count: int = 0


class DeliveryRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    warehouse_id: int
    status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    submitted_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime
    items: List[DeliveryRequestItem] = Field(default_factory=list)
