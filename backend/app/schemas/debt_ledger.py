from datetime import datetime
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
    note: Optional[str] = None


class CashReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    party_type: str
    party_id: int
    amount: float
    receipt_date: datetime
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime


class DebtTransferCreate(BaseModel):
    from_employee_id: int
    to_store_id: int
    amount: float = Field(gt=0, description="Amount must be positive")
    reason: Optional[str] = None


class DebtTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    from_employee_id: int
    to_store_id: int
    amount: float
    reason: Optional[str] = None
    status: str
    requested_by: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    created_at: datetime


class DebtTransferAction(BaseModel):
    reason: Optional[str] = None


class DeliveryReturnCreate(BaseModel):
    delivery_request_id: int
    employee_id: int
    amount: float = Field(gt=0, description="Return value must be positive")
    note: Optional[str] = None


class DeliveryReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    delivery_request_id: int
    employee_id: int
    amount: float
    status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    approved_by: Optional[str] = None
    created_at: datetime
