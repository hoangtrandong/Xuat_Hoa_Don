from datetime import date, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None]
    products: Mapped[list["Product"]] = relationship(back_populates="category")


class ProductUnit(Base):
    __tablename__ = "product_units"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(60))


class Product(Base):
    __tablename__ = "products"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("product_categories.id"))
    unit_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("product_units.id"))
    supplier: Mapped[str | None] = mapped_column(String(160))
    list_price: Mapped[int] = mapped_column(BigInteger, default=0)
    cost_price: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    category: Mapped[ProductCategory | None] = relationship(back_populates="products")
    unit: Mapped[ProductUnit | None] = relationship()


class PriceList(Base):
    __tablename__ = "price_lists"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    customer_type: Mapped[str | None] = mapped_column(String(80))
    effective_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    items: Mapped[list["PriceListItem"]] = relationship(back_populates="price_list")


class PriceListItem(Base):
    __tablename__ = "price_list_items"
    __table_args__ = (UniqueConstraint("price_list_id", "product_id"),)

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    price_list_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("price_lists.id", ondelete="CASCADE"))
    product_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("products.id"))
    price: Mapped[int] = mapped_column(BigInteger)
    price_list: Mapped[PriceList] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()
