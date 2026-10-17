from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class PaymentAllocationItemCreate(BaseModel):
    order_id: Optional[int] = None
    employee_id: Optional[int] = None
    settlement_date: Optional[date] = None
    store_id: Optional[int] = None
    amount: float
    note: Optional[str] = None


class BankReceiptCreate(BaseModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    ref_number: Optional[str] = None
    transaction_date: Optional[datetime] = None
    store_id: Optional[int] = None
    customer_id: Optional[int] = None
    amount: float
    description: Optional[str] = None


class BankReceiptAllocateRequest(BaseModel):
    allocations: List[PaymentAllocationItemCreate]


class PaymentAllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    bank_receipt_id: int
    order_id: Optional[int] = None
    order_number: Optional[str] = None
    employee_id: Optional[int] = None
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    store_id: Optional[int] = None
    settlement_date: Optional[date] = None
    amount: float
    allocation_date: datetime
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime


class BankReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    ref_number: Optional[str] = None
    transaction_date: datetime
    party_type: str
    store_id: Optional[int] = None
    store_code: Optional[str] = None
    store_name: Optional[str] = None
    customer_id: Optional[int] = None
    amount: float
    allocated_amount: float
    unallocated_amount: float
    status: str
    description: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    allocations: List[PaymentAllocationOut] = []


class AllocatableOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    delivery_request_id: int
    delivery_request_code: str
    order_date: Optional[date] = None
    order_number: str
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    employee_id: Optional[int] = None
    employee_code: str
    employee_name: Optional[str] = None
    total_amount: float
    allocated_amount: float
    remaining_amount: float
    payment_status: str


class AllocatableEmployeeDayOut(BaseModel):
    employee_id: int
    employee_code: str
    employee_name: Optional[str] = None
    settlement_date: date
    allocated_amount: float
    paid_bank: float
    remaining_employee_debt: float
