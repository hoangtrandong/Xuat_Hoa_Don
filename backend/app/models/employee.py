from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Float, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List

from app.core.database import Base


class SalesTerritory(Base):
    __tablename__ = "sales_territories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    region: Mapped[str] = mapped_column(String(40))  # BAC | TRUNG | NAM

    customers: Mapped[List["Customer"]] = relationship(back_populates="territory")
    employees: Mapped[List["Employee"]] = relationship(back_populates="territory")


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    territory_id: Mapped[int | None] = mapped_column(ForeignKey("sales_territories.id"))
    visit_target: Mapped[int] = mapped_column(Integer, default=15)

    customers: Mapped[List["Customer"]] = relationship(back_populates="route")
    visits: Mapped[List["Visit"]] = relationship(back_populates="route")


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str] = mapped_column(String(30))  # RSM | TSM | SAS
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(120))
    territory_id: Mapped[int | None] = mapped_column(ForeignKey("sales_territories.id"))
    target: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[str] = mapped_column(String(15), default="active")
    join_date: Mapped[datetime | None] = mapped_column(DateTime)

    territory: Mapped["SalesTerritory | None"] = relationship(back_populates="employees")
    user: Mapped["User | None"] = relationship(back_populates="employee")
    sales_orders: Mapped[List["SalesOrder"]] = relationship(back_populates="employee")
    visits: Mapped[List["Visit"]] = relationship(back_populates="employee")


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    route_id: Mapped[int | None] = mapped_column(ForeignKey("routes.id"))
    visit_date: Mapped[datetime] = mapped_column(DateTime)
    checkin_lat: Mapped[float | None] = mapped_column(Float)
    checkin_lng: Mapped[float | None] = mapped_column(Float)
    has_order: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(String(255))

    employee: Mapped["Employee"] = relationship(back_populates="visits")
    route: Mapped["Route | None"] = relationship(back_populates="visits")