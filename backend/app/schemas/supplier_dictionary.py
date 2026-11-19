from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional


class SupplierDictionaryBase(BaseModel):
    standard_name: str
    short_code: Optional[str] = None
    tax_codes: List[str] = []
    keywords: List[str] = []
    notes: Optional[str] = None
    is_active: bool = True


class SupplierDictionaryCreate(SupplierDictionaryBase):
    pass


class SupplierDictionaryUpdate(BaseModel):
    standard_name: Optional[str] = None
    short_code: Optional[str] = None
    tax_codes: Optional[List[str]] = None
    keywords: Optional[List[str]] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierDictionaryResponse(SupplierDictionaryBase):
    id: int
    sku_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
