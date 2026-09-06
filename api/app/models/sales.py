from datetime import date, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.catalog import Product
from app.models.customer import Customer


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(40), unique=True)
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("customers.id"))
    sales_rep_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("employees.id"))
    warehouse_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("warehouses.id"))
    visit_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("visits.id"))
    status: Mapped[str] = mapped_column(String(30), default="draft")
    payment_status: Mapped[str] = mapped_column(String(30), default="unpaid")
    payment_method: Mapped[str | None] = mapped_column(String(40))
    subtotal: Mapped[int] = mapped_column(BigInteger, default=0)
    discount: Mapped[int] = mapped_column(BigInteger, default=0)
    total: Mapped[int] = mapped_column(BigInteger, default=0)
    amount_paid: Mapped[int] = mapped_column(BigInteger, default=0)
    source: Mapped[str] = mapped_column(String(20), default="web")
    note: Mapped[str | None]
    delivery_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    customer: Mapped[Customer] = relationship()
    items: Mapped[list["SalesOrderItem"]] = relationship(back_populates="order")


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    order_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales_orders.id", ondelete="CASCADE"))
    product_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[int] = mapped_column(BigInteger)
    discount_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    line_total: Mapped[int] = mapped_column(BigInteger)
    order: Mapped[SalesOrder] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()


class SalesReturn(Base):
    __tablename__ = "sales_returns"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(40), unique=True)
    order_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales_orders.id"))
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("customers.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    amount: Mapped[int] = mapped_column(BigInteger, default=0)
    reason: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    items: Mapped[list["SalesReturnItem"]] = relationship(back_populates="ret")


class SalesReturnItem(Base):
    __tablename__ = "sales_return_items"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    return_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales_returns.id", ondelete="CASCADE"))
    product_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[int] = mapped_column(BigInteger)
    ret: Mapped[SalesReturn] = relationship(back_populates="items")
