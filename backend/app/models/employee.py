from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Numeric
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
    debt_limit: Mapped[float] = mapped_column(Numeric(14, 2), default=50000000.00)
    vinamilk_code: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(15), default="active")
    join_date: Mapped[datetime | None] = mapped_column(DateTime)

    territory: Mapped["SalesTerritory | None"] = relationship(back_populates="employees")
    user: Mapped["User | None"] = relationship(back_populates="employee")
    sales_orders: Mapped[List["SalesOrder"]] = relationship(back_populates="employee")