from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional


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