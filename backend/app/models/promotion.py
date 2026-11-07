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
    promotion_kind: Mapped[str] = mapped_column(String(30), default="GENERAL")
    target_scope: Mapped[str] = mapped_column(String(20), default="ALL")
    customer_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    employee_code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    vat_rate: Mapped[float] = mapped_column(Float, default=0)
    product_scope: Mapped[str] = mapped_column(String(20), default="SELECTED")
    supplier: Mapped[str | None] = mapped_column(String(120), nullable=True)
    applied_quantity_unit: Mapped[str] = mapped_column(String(20), default="STANDARD")
    minimum_product_quantity: Mapped[int] = mapped_column(Integer, default=1)

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
    max_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_unit: Mapped[str] = mapped_column(String(10), default="CARTON")
    min_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    free_quantity: Mapped[int] = mapped_column(Integer, default=0)
    reward_unit: Mapped[str] = mapped_column(String(10), default="BOX")
    reward_type: Mapped[str] = mapped_column(String(30), default="FREE_QUANTITY")
    reward_value: Mapped[float] = mapped_column(Float, default=0)
    reward_product_operator: Mapped[str] = mapped_column(String(3), default="AND")
    reward_product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    reward_product_links: Mapped[List["PromotionRuleRewardProduct"]] = relationship(
        back_populates="promotion_rule",
        cascade="all, delete-orphan",
        order_by="PromotionRuleRewardProduct.group_index, PromotionRuleRewardProduct.product_id",
    )

    promotion: Mapped["Promotion"] = relationship(back_populates="rules")
    reward_product: Mapped["Product | None"] = relationship(foreign_keys=[reward_product_id])

    @property
    def reward_product_ids(self) -> list[int]:
        if self.reward_product_links:
            return [link.product_id for link in self.reward_product_links]
        return [self.reward_product_id] if self.reward_product_id is not None else []

    @property
    def reward_product_groups(self) -> list[list[int]]:
        groups: dict[int, list[int]] = {}
        for link in self.reward_product_links:
            groups.setdefault(link.group_index, []).append(link.product_id)
        if groups:
            return list(groups.values())
        if self.reward_product_id is not None:
            return [[self.reward_product_id]]
        return []

    @property
    def reward_product_details(self) -> list[list[dict[str, int | str]]]:
        groups: dict[int, list[dict[str, int | str]]] = {}
        for link in self.reward_product_links:
            groups.setdefault(link.group_index, []).append({
                "product_id": link.product_id,
                "quantity": link.quantity,
                "unit": link.unit,
            })
        if groups:
            return list(groups.values())
        if self.reward_product_id is not None:
            return [[{
                "product_id": self.reward_product_id,
                "quantity": int(self.reward_value or self.free_quantity or 1),
                "unit": self.reward_unit or "BOX",
            }]]
        return []

class PromotionRuleRewardProduct(Base):
    __tablename__ = "promotion_rule_reward_products"

    promotion_rule_id: Mapped[int] = mapped_column(
        ForeignKey("promotion_rules.id", ondelete="CASCADE"),
        primary_key=True,
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"),
        primary_key=True,
    )
    group_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit: Mapped[str] = mapped_column(String(10), nullable=False, default="BOX")

    promotion_rule: Mapped["PromotionRule"] = relationship(back_populates="reward_product_links")


class PromotionItem(Base):
    __tablename__ = "promotion_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    promotion_id: Mapped[int] = mapped_column(ForeignKey("promotions.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    min_quantity: Mapped[int] = mapped_column(Integer, default=1)

    promotion: Mapped["Promotion"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()