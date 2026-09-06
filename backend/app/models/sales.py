from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer, Float, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List

from app.core.database import Base


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(15), default="PENDING")  # PENDING | APPROVED | DELIVERING | COMPLETED | CANCELLED
    payment_status: Mapped[str] = mapped_column(String(20), default="UNPAID")  # PAID | PARTIAL | UNPAID
    subtotal: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    discount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    total: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    amount_paid: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    payment_method: Mapped[str | None] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(10), default="WEB")  # WEB | MOBILE
    note: Mapped[str | None] = mapped_column(String(255))
    delivery_date: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    customer: Mapped["Customer"] = relationship(back_populates="sales_orders")
    employee: Mapped["Employee | None"] = relationship(back_populates="sales_orders")
    items: Mapped[List["SalesOrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    price: Mapped[float] = mapped_column(Numeric(14, 2))
    discount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    line_total: Mapped[float] = mapped_column(Numeric(14, 2))

    order: Mapped["SalesOrder"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()