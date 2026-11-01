from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional


class StoreBase(BaseModel):
    code: str
    name: str
    phone: Optional[str] = None
    owner_name: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    route: Optional[str] = None
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
    route: Optional[str] = None
    status: Optional[str] = None


class Store(StoreBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
