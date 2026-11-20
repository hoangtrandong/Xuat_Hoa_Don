from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Float, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List

from app.core.database import Base


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        UniqueConstraint("distributor_id", "code", name="uq_customers_distributor_code"),
        Index("ix_customers_dist_company", "distributor_id", "company_id"),
        Index("ix_customers_dist_status", "distributor_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    distributor_id: Mapped[int | None] = mapped_column(
        ForeignKey("distributors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    type: Mapped[str] = mapped_column(String(20))  # DISTRIBUTOR | WHOLESALE | RETAIL | HORECA
    tier: Mapped[str] = mapped_column(String(5), default="B")  # A | B | C
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120))
    citizen_id: Mapped[str | None] = mapped_column(String(20))
    tax_code: Mapped[str | None] = mapped_column(String(30))
    credit_limit: Mapped[float] = mapped_column(Float, default=0)
    current_debt: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(15), default="active")
    territory_id: Mapped[int | None] = mapped_column(ForeignKey("sales_territories.id"))
    staff_code: Mapped[str | None] = mapped_column(String(50), index=True)
    staff_name: Mapped[str | None] = mapped_column(String(160))
    manager_code: Mapped[str | None] = mapped_column(String(50), index=True)
    manager_name: Mapped[str | None] = mapped_column(String(160))
    # Phát sinh Phase 2: 1 cửa hàng → nhiều mã KH; mã KH quản lý bởi 1 công ty xuất hóa đơn.
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"), index=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    distributor: Mapped["Distributor | None"] = relationship("Distributor")
    addresses: Mapped[List["CustomerAddress"]] = relationship(back_populates="customer", cascade="all, delete-orphan")
    contacts: Mapped[List["CustomerContact"]] = relationship(back_populates="customer", cascade="all, delete-orphan")
    territory: Mapped["SalesTerritory | None"] = relationship(back_populates="customers")
    sales_orders: Mapped[List["SalesOrder"]] = relationship(back_populates="customer")
    store: Mapped["Store | None"] = relationship(back_populates="customers")
    company: Mapped["Company | None"] = relationship(back_populates="customers")

    @property
    def distributor_code(self) -> str | None:
        return self.distributor.code if self.distributor else None

    @property
    def distributor_name(self) -> str | None:
        return self.distributor.name if self.distributor else None

    @property
    def store_code(self) -> str | None:
        return self.store.code if self.store else None

    @property
    def store_name(self) -> str | None:
        return self.store.name if self.store else None

    @property
    def store_route(self) -> str | None:
        return self.store.route if self.store else None

    @property
    def company_code(self) -> str | None:
        return self.company.code if self.company else None

    @property
    def company_name(self) -> str | None:
        return self.company.name if self.company else None

    @property
    def address(self) -> str | None:
        if self.addresses:
            default_addr = next((a for a in self.addresses if a.is_default and a.address), None)
            if default_addr:
                return default_addr.address
            first_addr = next((a for a in self.addresses if a.address), None)
            if first_addr:
                return first_addr.address
        return self.store.address if self.store and self.store.address else None


class Store(Base):
    """Cửa hàng / điểm bán vật lý."""

    __tablename__ = "stores"
    __table_args__ = (
        UniqueConstraint("distributor_id", "code", name="uq_stores_distributor_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    distributor_id: Mapped[int | None] = mapped_column(
        ForeignKey("distributors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    owner_name: Mapped[str | None] = mapped_column(String(120))
    # Lưu ý: KHÔNG lưu MST ở cấp cửa hàng. MST nằm ở mã khách hàng (customers.tax_code)
    # vì 1 cửa hàng có thể có nhiều mã KH với các MST khác nhau.
    address: Mapped[str | None] = mapped_column(String(255))
    district: Mapped[str | None] = mapped_column(String(80))
    city: Mapped[str | None] = mapped_column(String(80))
    route: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    distributor: Mapped["Distributor | None"] = relationship("Distributor")
    customers: Mapped[List["Customer"]] = relationship(back_populates="store")

    @property
    def distributor_code(self) -> str | None:
        return self.distributor.code if self.distributor else None

    @property
    def distributor_name(self) -> str | None:
        return self.distributor.name if self.distributor else None


class Company(Base):
    """Công ty quản lý / công ty xuất hóa đơn (công ty con của đơn vị phân phối)."""

    __tablename__ = "companies"
    __table_args__ = (
        UniqueConstraint("distributor_id", "code", name="uq_companies_distributor_code"),
        Index("ix_companies_dist_status", "distributor_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    distributor_id: Mapped[int | None] = mapped_column(
        ForeignKey("distributors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    tax_code: Mapped[str | None] = mapped_column(String(30), index=True)  # MST — KHÔNG unique
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(15), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    distributor: Mapped["Distributor | None"] = relationship("Distributor")
    customers: Mapped[List["Customer"]] = relationship(back_populates="company")
    product_links: Mapped[List["ProductCompany"]] = relationship(back_populates="company")
    product_group_links: Mapped[List["ProductGroupCompany"]] = relationship(back_populates="company")

    @property
    def distributor_code(self) -> str | None:
        return self.distributor.code if self.distributor else None

    @property
    def distributor_name(self) -> str | None:
        return self.distributor.name if self.distributor else None

    @property
    def customer_count(self) -> int:
        precomputed = getattr(self, "_customer_count", None)
        if precomputed is not None:
            return int(precomputed)
        return len(self.customers)


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