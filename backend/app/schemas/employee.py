from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional


class EmployeeBase(BaseModel):
    code: str
    name: str
    position: str = "SAS"
    phone: str
    email: Optional[str] = None
    territory_id: Optional[int] = None
    target: float = 0
    debt_limit: float = 50000000.0
    vinamilk_code: Optional[str] = None
    status: str = "active"


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    territory_id: Optional[int] = None
    target: Optional[float] = None
    debt_limit: Optional[float] = None
    vinamilk_code: Optional[str] = None
    status: Optional[str] = None


class Employee(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    join_date: Optional[datetime]
    account_username: Optional[str] = None