from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class InvoiceProductBase(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=255)
    unit_name: str = Field(default="Hộp", max_length=50)
    vat_rate: Optional[float] = None
    supplier: Optional[str] = Field(default="", max_length=120)
    note: Optional[str] = Field(default=None, max_length=300)
    status: str = Field(default="active", max_length=20)


class InvoiceProductCreate(InvoiceProductBase):
    distributor_id: Optional[int] = None


class InvoiceProductUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=60)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    unit_name: Optional[str] = Field(default=None, max_length=50)
    vat_rate: Optional[float] = None
    supplier: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=300)
    status: Optional[str] = Field(default=None, max_length=20)


class InvoiceProductItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    distributor_id: Optional[int] = None
    code: str
    name: str
    unit_name: str = "Hộp"
    vat_rate: Optional[float] = None
    supplier: str = ""
    note: Optional[str] = None
    status: str = "active"
    cqt_sku_count: int = 0
    dms_product_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class InvoiceProductBulkDelete(BaseModel):
    ids: List[int] = Field(default_factory=list)
