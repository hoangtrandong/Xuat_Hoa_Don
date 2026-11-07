from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer, Float, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List

from app.core.database import Base


class Promotion(Base):
    __tablename__ = "promotions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(String(255))
    start_date: Mapped[datetime] = mapped_column(DateTime)
    end_date: Mapped[datetime] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    promotion_type: Mapped[str] = mapped_column(String(20), default="ORDER")
    target_scope: Mapped[str] = mapped_column(String(20), default="ALL")
    customer_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    employee_code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    vat_rate: Mapped[float] = mapped_column(Float, default=0)
    product_scope: Mapped[str] = mapped_column(String(20), default="SELECTED")
    supplier: Mapped[str | None] = mapped_column(String(120), nullable=True)

    rules: Mapped[List["PromotionRule"]] = relationship(back_populates="promotion", cascade="all, delete-orphan")
    items: Mapped[List["PromotionItem"]] = relationship(back_populates="promotion", cascade="all, delete-orphan")


class PromotionRule(Base):
    __tablename__ = "promotion_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    promotion_id: Mapped[int] = mapped_column(ForeignKey("promotions.id", ondelete="CASCADE"))
    min_qty: Mapped[int] = mapped_column(Integer, default=1)
    discount_percent: Mapped[float] = mapped_column(Float, default=0)
    discount_amount: Mapped[float] = mapped_column(Float, default=0)
    trigger_type: Mapped[str] = mapped_column(String(20), default="CARTON")
    min_cartons: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_unit: Mapped[str] = mapped_column(String(10), default="CARTON")
    min_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    free_quantity: Mapped[int] = mapped_column(Integer, default=0)
    reward_unit: Mapped[str] = mapped_column(String(10), default="BOX")
    reward_type: Mapped[str] = mapped_column(String(30), default="FREE_QUANTITY")
    reward_value: Mapped[float] = mapped_column(Float, default=0)

    promotion: Mapped["Promotion"] = relationship(back_populates="rules")


class PromotionItem(Base):
    __tablename__ = "promotion_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    promotion_id: Mapped[int] = mapped_column(ForeignKey("promotions.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))

    promotion: Mapped["Promotion"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()