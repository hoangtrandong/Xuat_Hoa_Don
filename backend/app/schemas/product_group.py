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
    distributor_sku: Optional[str] = None
    distributor_name: Optional[str] = None


class ProductGroupDistributorCodeUpdate(BaseModel):
    distributor_sku: str = Field(min_length=4, max_length=50)
    distributor_name: Optional[str] = Field(default=None, max_length=200)


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
    distributor_sku: Optional[str] = None
    distributor_name: Optional[str] = None
    status: str


class ProductCompanyAssignmentView(BaseModel):
    id: int
    company_id: Optional[int] = None
    company_code: Optional[str] = None
    company_name: Optional[str] = None
    role: str = "MANAGER"
    status: str = "active"
    distributor_sku: Optional[str] = None
    distributor_name: Optional[str] = None


class ProductCompanyManagementView(BaseModel):
    product_group_id: int
    group_name: str
    representative_sku: str
    representative_name: str
    member_skus: List[str] = []
    member_names: List[str] = []
    companies: List[ProductCompanyAssignmentView] = []
    supplier: Optional[str] = None
    order_count: int = 0
    total_ordered_qty: float = 0.0
    unit_price: float = 0.0
    unit: Optional[str] = None


class SalesManagerInfo(BaseModel):
    code: str
    employee_id: Optional[int] = None
    employee_code: Optional[str] = None
    vinamilk_code: Optional[str] = None
    name: Optional[str] = None
    nickname: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    matched: bool = False


class DistributorProductItem(BaseModel):
    id: int
    distributor_id: Optional[int] = None
    distributor_name: str
    distributor_sku: str
    distributor_product_name: str
    invoice_product_id: Optional[int] = None
    invoice_product_code: Optional[str] = None
    invoice_product_name: Optional[str] = None
    invoice_product_unit: Optional[str] = None
    invoice_product_vat_rate: Optional[float] = None
    conversion_num: int = 1
    conversion_den: int = 1
    supplier: str
    unit: Optional[str] = "HOP"
    unit_price: float = 0.0
    boxes_per_carton: int = 1
    sales_manager_codes: List[str] = []
    sales_managers: List[SalesManagerInfo] = []
    company_id: Optional[int] = None
    company_code: Optional[str] = None
    company_name: Optional[str] = None
    status: str = "active"


class DistributorProductCreate(BaseModel):
    distributor_id: Optional[int] = None
    distributor_name: Optional[str] = ""
    distributor_sku: str
    distributor_product_name: str
    invoice_product_id: Optional[int] = None
    invoice_product_code: Optional[str] = None
    invoice_product_name: Optional[str] = None
    conversion_num: int = Field(default=1, ge=1)
    conversion_den: int = Field(default=1, ge=1)
    supplier: Optional[str] = ""
    unit: Optional[str] = "HOP"
    unit_price: float = Field(default=0.0, ge=0.0)
    boxes_per_carton: int = Field(default=1, ge=1)
    sales_manager_codes: Optional[List[str] | str] = None
    company_id: Optional[int] = None


class DistributorProductUpdate(BaseModel):
    id: Optional[int] = None
    distributor_id: Optional[int] = None
    original_code: Optional[str] = None
    distributor_sku: str
    distributor_product_name: str
    invoice_product_id: Optional[int] = None
    invoice_product_code: Optional[str] = None
    invoice_product_name: Optional[str] = None
    conversion_num: int = Field(default=1, ge=1)
    conversion_den: int = Field(default=1, ge=1)
    distributor_name: Optional[str] = ""
    supplier: Optional[str] = ""
    unit: Optional[str] = "HOP"
    unit_price: Optional[float] = Field(default=None, ge=0.0)
    boxes_per_carton: Optional[int] = Field(default=None, ge=1)
    sales_manager_codes: Optional[List[str] | str] = None
    company_id: Optional[int] = None


class DistributorProductInvoiceMappingUpdate(BaseModel):
    invoice_product_id: Optional[int] = None
    conversion_num: Optional[int] = Field(default=None, ge=1)
    conversion_den: Optional[int] = Field(default=None, ge=1)


class DistributorProductManagersUpdate(BaseModel):
    sales_manager_codes: List[str] | str = []


class DistributorProductBulkDelete(BaseModel):
    ids: Optional[List[int]] = None
    codes: Optional[List[str]] = None

