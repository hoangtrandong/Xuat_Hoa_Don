from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Float, Text, Enum
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
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    category: Mapped["ProductCategory"] = relationship(back_populates="products")
    unit: Mapped["ProductUnit"] = relationship(back_populates="products")
    price_list_items: Mapped[List["PriceListItem"]] = relationship(back_populates="product")


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