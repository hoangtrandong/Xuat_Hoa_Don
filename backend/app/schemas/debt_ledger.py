from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class DebtLedgerEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    party_type: str
    party_id: int
    entry_type: str
    amount: float
    source_type: str
    source_id: Optional[int] = None
    source_code: Optional[str] = None
    document_date: Optional[datetime] = None
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime


class EmployeeDebtSummary(BaseModel):
    employee_id: int
    code: str
    vinamilk_code: Optional[str] = None
    name: str
    phone: Optional[str] = None
    position: Optional[str] = None
    status: str
    debt_limit: float = 500000000.0
    current_debt: float = 0.0
    pending_delivery_debt: float = 0.0
    projected_debt: float = 0.0
    total_debit: float = 0.0
    total_credit: float = 0.0
    is_over_limit: bool = False
    last_active_at: Optional[datetime] = None


class EmployeeDebtLimitChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    employee_id: Optional[int] = None
    employee_code: str
    old_limit: float
    new_limit: float
    reason: str
    changed_by: Optional[str] = None
    changed_at: datetime


class StoreDebtSummary(BaseModel):
    store_id: int
    code: str
    name: str
    phone: Optional[str] = None
    owner_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    customer_count: int = 0
    current_debt: float = 0.0
    total_debit: float = 0.0
    total_credit: float = 0.0
    last_active_at: Optional[datetime] = None


class CashReceiptCreate(BaseModel):
    party_type: str = Field(description="EMPLOYEE or STORE")
    party_id: int
    amount: float = Field(gt=0, description="Amount must be positive")
    settlement_date: Optional[date] = None
    note: Optional[str] = None


class CashReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    party_type: str
    party_id: int
    party_code: Optional[str] = None
    party_name: Optional[str] = None
    settlement_date: Optional[date] = None
    amount: float
    receipt_date: datetime
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime


class DebtTransferCreate(BaseModel):
    from_party_type: str = Field(description="EMPLOYEE or STORE")
    from_party_id: int = Field(gt=0)
    to_party_type: str = Field(description="EMPLOYEE or STORE")
    to_party_id: int = Field(gt=0)
    amount: float = Field(gt=0, description="Amount must be positive")
    reason: Optional[str] = None


class DebtTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    from_party_type: str
    from_party_id: int
    to_party_type: str
    to_party_id: int
    amount: float
    reason: Optional[str] = None
    created_at: datetime


class DeliveryReturnItemBase(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, description="Số lượng hộp/đơn vị trả về")
    cartons: int = 0
    loose_boxes: int = 0
    unit_price: float = 0.0
    amount: float = 0.0
    reason: Optional[str] = None
    location_id: Optional[int] = None


class DeliveryReturnItemCreate(DeliveryReturnItemBase):
    pass


class DeliveryReturnItemOut(DeliveryReturnItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    delivery_return_id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None
    location_code: Optional[str] = None


class DeliveryReturnCreate(BaseModel):
    delivery_request_id: int
    employee_id: int
    order_id: Optional[int] = None
    amount: Optional[float] = Field(default=0.0, ge=0)
    note: Optional[str] = None
    items: Optional[List[DeliveryReturnItemCreate]] = None
    restore_stock: bool = True


class DeliveryReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    delivery_request_id: int
    employee_id: int
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    order_id: Optional[int] = None
    order_number: Optional[str] = None
    amount: float
    status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    approved_by: Optional[str] = None
    created_at: datetime
    items: List[DeliveryReturnItemOut] = Field(default_factory=list)
