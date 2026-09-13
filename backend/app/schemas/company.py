from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional


class CompanyBase(BaseModel):
    code: str
    name: str
    tax_code: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    status: str = "active"


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    tax_code: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    status: Optional[str] = None


class Company(CompanyBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    customer_count: int = 0