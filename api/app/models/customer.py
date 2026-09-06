from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    customer_type: Mapped[str] = mapped_column(String(40))
    tier: Mapped[str] = mapped_column(String(8), default="C")
    status: Mapped[str] = mapped_column(String(20), default="active")
    route_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("routes.id"))
    sales_rep_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("employees.id"))
    debit_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    total_spend: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    addresses: Mapped[list["CustomerAddress"]] = relationship(back_populates="customer")
    contacts: Mapped[list["CustomerContact"]] = relationship(back_populates="customer")


class CustomerAddress(Base):
    __tablename__ = "customer_addresses"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"))
    line: Mapped[str] = mapped_column(String(200))
    district: Mapped[str | None] = mapped_column(String(80))
    city: Mapped[str | None] = mapped_column(String(80), default="TP.HCM")
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)
    customer: Mapped[Customer] = relationship(back_populates="addresses")


class CustomerContact(Base):
    __tablename__ = "customer_contacts"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(160))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)
    customer: Mapped[Customer] = relationship(back_populates="contacts")
