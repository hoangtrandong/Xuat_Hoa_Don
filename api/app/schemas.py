from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    customer_type: str
    tier: str
    status: str
    debit_balance: int
    total_spend: int
    created_at: datetime


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    supplier: str | None
    list_price: int
    cost_price: int
    status: str
    category_name: str | None = None
    unit_name: str | None = None


class InventoryOut(BaseModel):
    product_code: str
    product_name: str
    warehouse_code: str
    warehouse_name: str
    on_hand: int
    reserved: int
    available: int
    reorder_point: int


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    status: str
    payment_status: str
    total: int
    source: str
    created_at: datetime
    customer_name: str | None = None


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    position: str
    status: str
    phone: str | None
    email: str | None
