from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List


class SalesOrderItemCreate(BaseModel):
    product_id: int
    quantity: int
    price: float
    discount: float = 0


class SalesOrderItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    quantity: int
    price: float
    discount: float
    line_total: float


class SalesOrderBase(BaseModel):
    customer_id: int
    warehouse_id: int
    payment_method: Optional[str] = None
    note: Optional[str] = None


class SalesOrderCreate(SalesOrderBase):
    items: List[SalesOrderItemCreate]


class SalesOrder(SalesOrderBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    status: str
    payment_status: str
    subtotal: float
    discount: float
    total: float
    amount_paid: float
    source: str
    delivery_date: Optional[datetime]
    created_at: datetime
    items: List[SalesOrderItem] = []

class CustomerProductSummary(BaseModel):
    customer_id: int
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    product_id: int
    product_sku: Optional[str] = None
    product_name: Optional[str] = None
    total_quantity: int
    total_amount: float
