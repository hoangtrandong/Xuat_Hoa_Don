from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import List, Optional


class CustomerBase(BaseModel):
    code: str
    name: str
    type: str = "RETAIL"
    tier: str = "B"
    phone: str
    email: Optional[str] = None
    citizen_id: Optional[str] = None
    tax_code: Optional[str] = None
    credit_limit: float = 0
    visit_frequency: int = 2
    status: str = "active"
    territory_id: Optional[int] = None
    route_id: Optional[int] = None
    assigned_employee_id: Optional[int] = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    tier: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    citizen_id: Optional[str] = None
    tax_code: Optional[str] = None
    credit_limit: Optional[float] = None
    status: Optional[str] = None
    assigned_employee_id: Optional[int] = None


class Customer(CustomerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    current_debt: float = 0
    created_at: datetime