from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional


class ProductGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    representative_product_id: int
    product_ids: List[int] = []


class ProductGroupItemAdd(BaseModel):
    product_id: int
    conversion_factor: int = Field(default=1, gt=0)


class ProductGroupRepresentativeUpdate(BaseModel):
    product_id: int


class ProductGroupCompanyLinkCreate(BaseModel):
    company_id: int
    role: str = "MANAGER"


class ProductGroupItemView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    conversion_factor: int


class ProductGroupView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    representative_product_id: int
    status: str
    created_at: datetime
    items: List[ProductGroupItemView] = []


class ProductCompanyLinkView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    company_id: int
    role: str
    company_product_code: Optional[str] = None
    status: str


class ProductGroupCompanyLinkView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_group_id: int
    company_id: int
    role: str
    status: str


class ProductCompanyAssignmentView(BaseModel):
    id: int
    company_id: int
    company_name: str
    role: str
    status: str


class ProductCompanyManagementView(BaseModel):
    product_id: int
    sku: str
    name: str
    companies: List[ProductCompanyAssignmentView] = []
