from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer, Float, Text, CheckConstraint, JSON
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
    locations: Mapped[List["WarehouseLocation"]] = relationship(back_populates="warehouse", cascade="all, delete-orphan")


class WarehouseLocation(Base):
    __tablename__ = "warehouse_locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str | None] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(default=True)

    warehouse: Mapped["Warehouse"] = relationship(back_populates="locations")
    lots: Mapped[List["InventoryLot"]] = relationship(back_populates="location")


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
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_lots.id"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_locations.id"))
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime)

    warehouse: Mapped["Warehouse"] = relationship(back_populates="transactions")
    product: Mapped["Product"] = relationship()
    lot: Mapped["InventoryLot | None"] = relationship(back_populates="transactions")
    location: Mapped["WarehouseLocation | None"] = relationship()


class InventoryLot(Base):
    __tablename__ = "inventory_lots"
    __table_args__ = (
        CheckConstraint("quantity_on_hand >= 0", name="ck_inventory_lot_qty_nonnegative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_locations.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    # Stock is identified by product, warehouse location, and expiry date.
    lot_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    unit_cost: Mapped[float | None] = mapped_column(Float)

    warehouse: Mapped["Warehouse"] = relationship()
    location: Mapped["WarehouseLocation | None"] = relationship(back_populates="lots")
    product: Mapped["Product"] = relationship()
    transactions: Mapped[List["InventoryTransaction"]] = relationship(back_populates="lot")


class DeliveryRequest(Base):
    """Warehouse delivery request; stock is consumed only on completion."""
    __tablename__ = "delivery_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", index=True)
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[str | None] = mapped_column(String(120))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    received_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    warehouse: Mapped["Warehouse"] = relationship()
    items: Mapped[List["DeliveryRequestItem"]] = relationship(
        back_populates="request", cascade="all, delete-orphan"
    )


class DeliveryRequestItem(Base):
    __tablename__ = "delivery_request_items"
    __table_args__ = (CheckConstraint("quantity >= 0", name="ck_delivery_item_qty_nonnegative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("delivery_requests.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    requested_quantity_raw: Mapped[str | None] = mapped_column(String(40), nullable=True)
    employee_allocations: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    request: Mapped["DeliveryRequest"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()
    allocations: Mapped[List["DeliveryAllocation"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", order_by="DeliveryAllocation.allocation_sequence"
    )

    @property
    def sku(self) -> str:
        return self.product.sku

    @property
    def product_name(self) -> str:
        return self.product.name


class DeliveryAllocation(Base):
    """A quantity reserved from one exact lot and warehouse location."""
    __tablename__ = "delivery_allocations"
    __table_args__ = (
        CheckConstraint("allocated_quantity > 0", name="ck_delivery_allocation_qty_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("delivery_request_items.id", ondelete="CASCADE"))
    allocated_quantity: Mapped[int] = mapped_column(Integer)
    allocation_sequence: Mapped[int] = mapped_column(Integer, default=1)
    allocation_strategy: Mapped[str] = mapped_column(String(30), default="DETERMINISTIC_STOCK")
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_lots.id"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_locations.id"))
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime)

    item: Mapped["DeliveryRequestItem"] = relationship(back_populates="allocations")
    lot: Mapped["InventoryLot | None"] = relationship()
    location: Mapped["WarehouseLocation | None"] = relationship()