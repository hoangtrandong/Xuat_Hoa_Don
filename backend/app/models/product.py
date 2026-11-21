from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Float, Text, Enum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List, Optional

from app.core.database import Base


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(255))

    products: Mapped[List["Product"]] = relationship(back_populates="category")


class ProductUnit(Base):
    __tablename__ = "product_units"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)  # CAI, THUNG, HOP, KG
    name: Mapped[str] = mapped_column(String(40))

    products: Mapped[List["Product"]] = relationship(back_populates="unit")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("product_categories.id"))
    unit_id: Mapped[int] = mapped_column(ForeignKey("product_units.id"))
    supplier: Mapped[str | None] = mapped_column(String(120))
    barcode: Mapped[str | None] = mapped_column(String(50))
    base_price: Mapped[float] = mapped_column(Float, default=0)
    cost_price: Mapped[float] = mapped_column(Float, default=0)
    vat_rate: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0, 5, 8, 10; -1 = KCT; None = default
    vat_rate_source: Mapped[str | None] = mapped_column(String(20), default="MANUAL", nullable=True)  # PURCHASE_INVOICE | MANUAL
    reorder_level: Mapped[int] = mapped_column(Integer, default=20)
    # Number of boxes represented by one carton; quantities are stored in boxes.
    boxes_per_carton: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    sync_source: Mapped[str | None] = mapped_column(String(30), default="MANUAL", index=True, nullable=True)
    _npp_code: Mapped[str | None] = mapped_column("npp_code", String(50), nullable=True)
    internal_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    internal_unit: Mapped[str | None] = mapped_column(String(50), nullable=True)

    category: Mapped["ProductCategory"] = relationship(back_populates="products")
    unit: Mapped["ProductUnit"] = relationship(back_populates="products")
    price_list_items: Mapped[List["PriceListItem"]] = relationship(back_populates="product")
    group_items: Mapped[List["ProductGroupItem"]] = relationship(back_populates="product")
    company_links: Mapped[List["ProductCompany"]] = relationship(back_populates="product")

    @property
    def npp_code(self) -> str:
        if self._npp_code:
            return self._npp_code
        if hasattr(self, "_npp_code_cache") and self._npp_code_cache:
            return self._npp_code_cache
        group = self.group_items[0].group if self.group_items else None
        if group:
            for link in group.company_links:
                if link.distributor_sku:
                    return link.distributor_sku
            return group.representative_product.sku
        return self.sku

    @npp_code.setter
    def npp_code(self, value: str | None) -> None:
        self._npp_code = value.strip().upper() if value and str(value).strip() else None

    @property
    def npp_name(self) -> str:
        group = self.group_items[0].group if self.group_items else None
        return group.name if group else self.name

    @property
    def representative_product(self) -> "Product | None":
        if not self.group_items:
            return None
        return self.group_items[0].group.representative_product

    @property
    def representative_sku(self) -> str | None:
        cached = getattr(self, '_rep_sku_cache', None)
        if hasattr(self, '_rep_sku_cache'):
            return cached
        product = self.representative_product
        return product.sku if product else None

    @property
    def representative_name(self) -> str | None:
        cached = getattr(self, '_rep_name_cache', None)
        if hasattr(self, '_rep_name_cache'):
            return cached
        product = self.representative_product
        return product.name if product else None


class ProductGroup(Base):
    """A group of equivalent SKUs with one existing SKU as representative."""

    __tablename__ = "product_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    representative_product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    representative_product: Mapped["Product"] = relationship(foreign_keys=[representative_product_id])
    items: Mapped[List["ProductGroupItem"]] = relationship(back_populates="group", cascade="all, delete-orphan")
    company_links: Mapped[List["ProductGroupCompany"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class ProductGroupItem(Base):
    __tablename__ = "product_group_items"
    __table_args__ = (UniqueConstraint("product_id", name="uq_product_group_items_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_group_id: Mapped[int] = mapped_column(ForeignKey("product_groups.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    conversion_factor: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    group: Mapped["ProductGroup"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship(back_populates="group_items")


class ProductCompany(Base):
    __tablename__ = "product_companies"
    __table_args__ = (UniqueConstraint("product_id", "company_id", name="uq_product_companies_product_company"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), default="MANAGER")
    company_product_code: Mapped[str | None] = mapped_column(String(50))
    invoice_name_override: Mapped[str | None] = mapped_column(String(255))
    invoice_unit_name: Mapped[str | None] = mapped_column(String(50))
    conversion_num: Mapped[int] = mapped_column(Integer, default=1)
    conversion_den: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(25), default="MANUAL")  # PURCHASE_INVOICE | MANUAL
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    last_purchased_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_purchased_qty: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    product: Mapped["Product"] = relationship(back_populates="company_links")
    company: Mapped["Company"] = relationship(back_populates="product_links")


class ProductGroupCompany(Base):
    __tablename__ = "product_group_companies"
    __table_args__ = (UniqueConstraint("product_group_id", "company_id", name="uq_product_group_companies_group_company"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_group_id: Mapped[int] = mapped_column(ForeignKey("product_groups.id", ondelete="CASCADE"))
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), default="MANAGER")
    distributor_sku: Mapped[str | None] = mapped_column(String(50))
    distributor_name: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    group: Mapped["ProductGroup"] = relationship(back_populates="company_links")
    company: Mapped["Company"] = relationship(back_populates="product_group_links")


class PriceList(Base):
    __tablename__ = "price_lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    customer_type: Mapped[str] = mapped_column(String(20))  # ALL | RETAIL | TIER_A | HORECA
    effective_date: Mapped[datetime] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(String(255))

    items: Mapped[List["PriceListItem"]] = relationship(back_populates="price_list", cascade="all, delete-orphan")


class PriceListItem(Base):
    __tablename__ = "price_list_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    price_list_id: Mapped[int] = mapped_column(ForeignKey("price_lists.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    price: Mapped[float] = mapped_column(Float)

    price_list: Mapped["PriceList"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship(back_populates="price_list_items")


class DistributorProduct(Base):
    """Mã sản phẩm Nhà Phân Phối nội bộ do người dùng quản lý / upload."""
    __tablename__ = "distributor_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    distributor_name: Mapped[str] = mapped_column(String(200), default="Nhà Phân Phối Mai Gold")
    distributor_sku: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    distributor_product_name: Mapped[str] = mapped_column(String(255))
    supplier: Mapped[str] = mapped_column(String(100), default="Vinamilk")
    unit: Mapped[str | None] = mapped_column(String(30), default="HOP")
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company: Mapped[Optional["Company"]] = relationship(foreign_keys=[company_id])
