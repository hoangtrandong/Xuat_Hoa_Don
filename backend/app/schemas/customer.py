from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import List, Optional


class CustomerBase(BaseModel):
    code: str
    name: str
    type: str = "RETAIL"
    tier: str = "B"
    email: Optional[str] = None
    citizen_id: Optional[str] = None
    tax_code: Optional[str] = None
    credit_limit: float = 0
    status: str = "active"
    territory_id: Optional[int] = None
    staff_code: Optional[str] = None
    staff_name: Optional[str] = None
    manager_code: Optional[str] = None
    manager_name: Optional[str] = None
    # Phase 2: thuộc cửa hàng + công ty quản lý / xuất hóa đơn
    store_id: Optional[int] = None
    company_id: Optional[int] = None


class CustomerCreate(CustomerBase):
    store_route: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    tier: Optional[str] = None
    email: Optional[str] = None
    citizen_id: Optional[str] = None
    tax_code: Optional[str] = None
    credit_limit: Optional[float] = None
    status: Optional[str] = None
    staff_code: Optional[str] = None
    staff_name: Optional[str] = None
    manager_code: Optional[str] = None
    store_id: Optional[int] = None
    company_id: Optional[int] = None
    store_route: Optional[str] = None


class Customer(CustomerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    current_debt: float = 0
    created_at: datetime
    # Chỉ đọc: điền từ quan hệ store / company để giao diện hiển thị nhanh.
    store_code: Optional[str] = None
    store_name: Optional[str] = None
    store_route: Optional[str] = None
    company_code: Optional[str] = None
    company_name: Optional[str] = None