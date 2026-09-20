from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Float, Text, Enum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List

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
    reorder_level: Mapped[int] = mapped_column(Integer, default=20)
    # Number of boxes represented by one carton; quantities are stored in boxes.
    boxes_per_carton: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    category: Mapped["ProductCategory"] = relationship(back_populates="products")
    unit: Mapped["ProductUnit"] = relationship(back_populates="products")
    price_list_items: Mapped[List["PriceListItem"]] = relationship(back_populates="product")
    group_items: Mapped[List["ProductGroupItem"]] = relationship(back_populates="product")
    company_links: Mapped[List["ProductCompany"]] = relationship(back_populates="product")

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