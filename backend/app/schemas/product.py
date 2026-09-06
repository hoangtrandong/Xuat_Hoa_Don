from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List


class ProductBase(BaseModel):
    sku: str
    name: str
    category_id: int
    unit_id: int
    supplier: Optional[str] = None
    base_price: float = 0
    cost_price: float = 0
    reorder_level: int = 20
    status: str = "active"


class ProductCreate(ProductBase):
    pass


class ProductCategoryOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class ProductUnitOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class Product(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


class PriceListItem(BaseModel):
    product_id: int
    price: float


class PriceListBase(BaseModel):
    name: str
    customer_type: str = "ALL"
    effective_date: datetime
    note: Optional[str] = None


class PriceListCreate(PriceListBase):
    items: List[PriceListItem] = []


class PriceList(PriceListBase):
    model_config = ConfigDict(from_attributes=True)
    id: int