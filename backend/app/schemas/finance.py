from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List


class PaymentBase(BaseModel):
    customer_id: int
    amount: float
    method: str
    reference: Optional[str] = None


class PaymentCreate(PaymentBase):
    pass


class Payment(PaymentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    created_at: datetime


class Receivable(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    customer_id: int
    order_id: Optional[int] = None
    amount: float
    paid: float
    status: str
    due_date: Optional[datetime] = None
    created_at: datetime
    balance: float = 0
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    order_code: Optional[str] = None


class CustomerDebtSummary(BaseModel):
    customer_id: int
    customer_code: str
    customer_name: str
    phone: str
    credit_limit: float
    current_debt: float
    open_receivables: int


class DebtDashboard(BaseModel):
    total_debt: float
    customers_in_debt: int
    open_receivables: int
    customers: List[CustomerDebtSummary]
    recent_receivables: List[Receivable]
