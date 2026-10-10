from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional


class EmployeeBase(BaseModel):
    code: str
    name: str
    nickname: Optional[str] = None
    position: str = "Nhân viên kinh doanh"
    phone: str = ""
    email: Optional[str] = None
    territory_id: Optional[int] = None
    target: float = 0
    debt_limit: float = 50000000.0
    vinamilk_code: Optional[str] = None
    status: str = "active"


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeCreateRequest(EmployeeCreate):
    create_account: bool = False


class EmployeeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    nickname: Optional[str] = None
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

class EmployeeCreated(Employee):
    initial_username: Optional[str] = None
    initial_password: Optional[str] = None

