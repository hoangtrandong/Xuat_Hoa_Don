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
    status: str = "active"


class EmployeeCreate(EmployeeBase):
    pass


class Employee(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    join_date: Optional[datetime]