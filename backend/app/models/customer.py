from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Float, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List

from app.core.database import Base


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    type: Mapped[str] = mapped_column(String(20))  # DISTRIBUTOR | WHOLESALE | RETAIL | HORECA
    tier: Mapped[str] = mapped_column(String(5), default="B")  # A | B | C
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(120))
    citizen_id: Mapped[str | None] = mapped_column(String(20))
    tax_code: Mapped[str | None] = mapped_column(String(30))
    credit_limit: Mapped[float] = mapped_column(Float, default=0)
    current_debt: Mapped[float] = mapped_column(Float, default=0)
    visit_frequency: Mapped[int] = mapped_column(Integer, default=2)
    status: Mapped[str] = mapped_column(String(15), default="active")
    territory_id: Mapped[int | None] = mapped_column(ForeignKey("sales_territories.id"))
    route_id: Mapped[int | None] = mapped_column(ForeignKey("routes.id"))
    assigned_employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    addresses: Mapped[List["CustomerAddress"]] = relationship(back_populates="customer", cascade="all, delete-orphan")
    contacts: Mapped[List["CustomerContact"]] = relationship(back_populates="customer", cascade="all, delete-orphan")
    territory: Mapped["SalesTerritory | None"] = relationship(back_populates="customers")
    route: Mapped["Route | None"] = relationship(back_populates="customers")
    sales_orders: Mapped[List["SalesOrder"]] = relationship(back_populates="customer")


class CustomerAddress(Base):
    __tablename__ = "customer_addresses"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(40), default="Mặc định")
    address: Mapped[str] = mapped_column(String(255))
    district: Mapped[str] = mapped_column(String(80))
    city: Mapped[str] = mapped_column(String(80))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    customer: Mapped["Customer"] = relationship(back_populates="addresses")


class CustomerContact(Base):
    __tablename__ = "customer_contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(120))
    position: Mapped[str | None] = mapped_column(String(60))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)

    customer: Mapped["Customer"] = relationship(back_populates="contacts")