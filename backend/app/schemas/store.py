from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional


class StoreBase(BaseModel):
    code: str
    name: str
    phone: Optional[str] = None
    owner_name: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    status: str = "active"


class StoreCreate(StoreBase):
    pass


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    owner_name: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None


class Store(StoreBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    customer_count: int = 0


class StoreDetail(Store):
    """Cửa hàng kèm các mã khách hàng thuộc về nó."""
    customer_count: int = 0
    customers: list["CustomerBrief"] = Field(default_factory=list)


class CustomerBrief(BaseModel):
    id: int
    code: str
    name: str
    type: str = "RETAIL"
    status: str = "active"
    current_debt: float = 0
    store_id: Optional[int] = None
    company_code: Optional[str] = None
    company_name: Optional[str] = None