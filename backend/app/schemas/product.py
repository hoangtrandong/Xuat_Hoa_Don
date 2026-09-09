from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
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
    boxes_per_carton: int = Field(default=1, gt=0)
    status: str = "active"


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    category_id: Optional[int] = None
    unit_id: Optional[int] = None
    supplier: Optional[str] = None
    base_price: Optional[float] = None
    cost_price: Optional[float] = None
    reorder_level: Optional[int] = None
    boxes_per_carton: Optional[int] = Field(default=None, gt=0)
    status: Optional[str] = None


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