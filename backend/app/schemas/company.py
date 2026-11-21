from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional


class CompanyBase(BaseModel):
    distributor_id: Optional[int] = None
    code: str
    name: str
    short_name: Optional[str] = None
    tax_code: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    invoice_item_mode: str = "TAX_INPUT"  # TAX_INPUT | INTERNAL
    sync_source: str = "MANUAL"  # MANUAL | GDT_CQT
    status: str = "active"


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    distributor_id: Optional[int] = None
    name: Optional[str] = None
    short_name: Optional[str] = None
    tax_code: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    invoice_item_mode: Optional[str] = None
    status: Optional[str] = None


class Company(CompanyBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    customer_count: int = 0
    distributor_code: Optional[str] = None
    distributor_name: Optional[str] = None