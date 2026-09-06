from datetime import date, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.customer import Customer


class SalesTerritory(Base):
    __tablename__ = "sales_territories"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    region: Mapped[str | None] = mapped_column(String(120))


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    position: Mapped[str] = mapped_column(String(80))
    territory_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales_territories.id"))
    user_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20), default="active")
    join_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    territory: Mapped[SalesTerritory | None] = relationship()
    kpi_rows: Mapped[list["EmployeeKpi"]] = relationship(back_populates="employee")


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    territory_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales_territories.id"))
    sales_rep_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("employees.id"))
    visit_target: Mapped[int] = mapped_column(Integer, default=0)
    color: Mapped[str | None] = mapped_column(String(16))
    sales_rep: Mapped[Employee | None] = relationship()


class RouteCustomer(Base):
    __tablename__ = "route_customers"

    route_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("routes.id", ondelete="CASCADE"), primary_key=True)
    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), primary_key=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    code: Mapped[str] = mapped_column(String(40), unique=True)
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("customers.id"))
    employee_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("employees.id"))
    route_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("routes.id"))
    check_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    check_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None]
    status: Mapped[str] = mapped_column(String(20), default="planned")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    customer: Mapped[Customer] = relationship()
    employee: Mapped[Employee] = relationship()


class EmployeeKpi(Base):
    __tablename__ = "employee_kpi"
    __table_args__ = (UniqueConstraint("employee_id", "period"),)

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    employee_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"))
    period: Mapped[str] = mapped_column(String(7))
    sales_target: Mapped[int] = mapped_column(BigInteger, default=0)
    sales_achieved: Mapped[int] = mapped_column(BigInteger, default=0)
    orders_count: Mapped[int] = mapped_column(Integer, default=0)
    new_customers_target: Mapped[int] = mapped_column(Integer, default=0)
    new_customers: Mapped[int] = mapped_column(Integer, default=0)
    visit_target: Mapped[int] = mapped_column(Integer, default=0)
    visits: Mapped[int] = mapped_column(Integer, default=0)
    employee: Mapped[Employee] = relationship(back_populates="kpi_rows")
