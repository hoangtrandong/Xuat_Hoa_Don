from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer, Float, Text, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List

from app.core.database import Base


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str] = mapped_column(String(200))
    manager: Mapped[str | None] = mapped_column(String(120))

    transactions: Mapped[List["InventoryTransaction"]] = relationship(back_populates="warehouse")


class InventoryTransaction(Base):
    """Ledger ghi nhận mọi biến động tồn kho (double-entry style, 1 row = 1 biến động)."""
    __tablename__ = "inventory_transactions"
    __table_args__ = (CheckConstraint("quantity != 0", name="ck_txn_qty_nonzero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    type: Mapped[str] = mapped_column(String(10))  # OPENING | IN | OUT | ADJUST
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)  # + nhập / - xuất
    unit_cost: Mapped[float | None] = mapped_column(Float)
    ref_type: Mapped[str | None] = mapped_column(String(10))  # PO | SO | ADJ | OPENING
    ref_code: Mapped[str | None] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    warehouse: Mapped["Warehouse"] = relationship(back_populates="transactions")
    product: Mapped["Product"] = relationship()