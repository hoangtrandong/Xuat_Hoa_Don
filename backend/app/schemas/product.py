from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List


class ProductBase(BaseModel):
    sku: str
    npp_code: Optional[str] = None
    internal_name: Optional[str] = None
    internal_unit: Optional[str] = None
    name: str
    category_id: int
    unit_id: int
    supplier: Optional[str] = None
    base_price: float = 0
    cost_price: float = 0
    vat_rate: Optional[float] = None
    reorder_level: int = 20
    boxes_per_carton: Optional[int] = Field(default=1)
    status: str = "active"


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    sku: Optional[str] = None
    npp_code: Optional[str] = None
    internal_name: Optional[str] = None
    internal_unit: Optional[str] = None
    name: Optional[str] = None
    category_id: Optional[int] = None
    unit_id: Optional[int] = None
    supplier: Optional[str] = None
    base_price: Optional[float] = None
    cost_price: Optional[float] = None
    vat_rate: Optional[float] = None
    vat_rate_source: Optional[str] = None
    reorder_level: Optional[int] = None
    boxes_per_carton: Optional[int] = Field(default=None, gt=0)
    status: Optional[str] = None


class ProductCategoryOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: Optional[str] = None
    name: str


class ProductUnitOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: Optional[str] = None
    name: str


class ProductDistributor(BaseModel):
    code: str
    name: str


class ProductManagedCompany(BaseModel):
    company_id: int
    company_code: str
    company_name: str
    short_name: Optional[str] = None
    tax_code: Optional[str] = None
    invoice_item_mode: str = "TAX_INPUT"
    source: str = "MANUAL"
    is_primary: bool = False
    company_product_code: Optional[str] = None
    invoice_name_override: Optional[str] = None
    invoice_unit_name: Optional[str] = None
    conversion_num: int = 1
    conversion_den: int = 1
    total_purchased_qty: float = 0
    last_purchased_at: Optional[datetime] = None


class ProductCompanyConfigItem(BaseModel):
    company_id: int
    is_primary: bool = False
    company_product_code: Optional[str] = None
    invoice_name_override: Optional[str] = None
    invoice_unit_name: Optional[str] = None
    conversion_num: int = Field(default=1, ge=1)
    conversion_den: int = Field(default=1, ge=1)


class ProductCompanyConfigsUpdate(BaseModel):
    configs: List[ProductCompanyConfigItem] = Field(default_factory=list)


class Product(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    barcode: Optional[str] = None
    npp_code: Optional[str] = None
    internal_name: Optional[str] = None
    internal_unit: Optional[str] = None
    representative_sku: Optional[str] = None
    representative_name: Optional[str] = None
    category_code: Optional[str] = None
    category_name: Optional[str] = None
    unit_code: Optional[str] = None
    unit_name: Optional[str] = None
    order_count: int = 0
    total_ordered_qty: float = 0
    purchase_invoice_count: int = 0
    total_purchased_qty: float = 0
    sync_source: str = "MANUAL"
    vat_rate: Optional[float] = None
    vat_rate_source: Optional[str] = None
    distributors: List[ProductDistributor] = Field(default_factory=list)
    managed_companies: List[ProductManagedCompany] = Field(default_factory=list)


class ProductStats(BaseModel):
    total: int = 0
    active_count: int = 0
    priced_count: int = 0
    zero_price_count: int = 0
    supplier_count: int = 0


class ProductPagination(BaseModel):
    items: List[Product]
    total: int
    page: int
    page_size: int
    total_pages: int
    stats: Optional[ProductStats] = None


class PriceListItem(BaseModel):
    product_id: int
    price: float


class PriceListBase(BaseModel):
    name: str
    customer_type: str = "ALL"
    effective_date: datetime
    note: Optional[str] = None


class PriceListCreate(PriceListBase):
    items: List[PriceListItem] = []


class PriceList(PriceListBase):
    model_config = ConfigDict(from_attributes=True)
    id: int