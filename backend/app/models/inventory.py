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
    type: Mapped[str] = mapped_column(String(30))  # OPENING | IN | OUT | ADJUST | LOCATION_TRANSFER_*
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)  # + nhập / - xuất
    unit_cost: Mapped[float | None] = mapped_column(Float)
    ref_type: Mapped[str | None] = mapped_column(String(30))  # PO | SO | ADJ | OPENING | LOCATION_TRANSFER
    ref_code: Mapped[str | None] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    document_date: Mapped[datetime | None] = mapped_column(DateTime)
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
        CheckConstraint(
            "locked_quantity >= 0 AND locked_quantity <= quantity_on_hand",
            name="ck_inventory_lot_locked_qty",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_locations.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    # Stock is identified by product, warehouse location, and expiry date.
    lot_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    locked_quantity: Mapped[int] = mapped_column(Integer, default=0)
    unit_cost: Mapped[float | None] = mapped_column(Float)

    warehouse: Mapped["Warehouse"] = relationship()
    location: Mapped["WarehouseLocation | None"] = relationship(back_populates="lots")
    product: Mapped["Product"] = relationship()
    transactions: Mapped[List["InventoryTransaction"]] = relationship(back_populates="lot")


class SupplierGoodsDiscrepancy(Base):
    __tablename__ = "supplier_goods_discrepancies"
    __table_args__ = (
        CheckConstraint("document_quantity > 0", name="ck_supplier_discrepancy_document_qty"),
        CheckConstraint("actual_quantity >= 0", name="ck_supplier_discrepancy_actual_qty"),
        CheckConstraint("quantity > 0", name="ck_supplier_discrepancy_qty"),
        CheckConstraint("type IN ('SHORTAGE', 'EXCESS')", name="ck_supplier_discrepancy_type"),
        CheckConstraint(
            "(type = 'SHORTAGE' AND actual_quantity < document_quantity "
            "AND quantity = document_quantity - actual_quantity) OR "
            "(type = 'EXCESS' AND actual_quantity > document_quantity "
            "AND quantity = actual_quantity - document_quantity)",
            name="ck_supplier_discrepancy_difference",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    type: Mapped[str] = mapped_column(String(10), index=True)
    document_quantity: Mapped[int] = mapped_column(Integer)
    actual_quantity: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    lot_number: Mapped[str | None] = mapped_column(String(80))
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime)
    invoice_number: Mapped[str | None] = mapped_column(String(120), index=True)
    ref_code: Mapped[str | None] = mapped_column(String(40))
    document_date: Mapped[datetime | None] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(15), default="OPEN", index=True)

    warehouse: Mapped["Warehouse"] = relationship()
    product: Mapped["Product"] = relationship()
    sources: Mapped[List["SupplierGoodsDiscrepancySource"]] = relationship(
        back_populates="discrepancy", cascade="all, delete-orphan"
    )
    shortage_offsets: Mapped[List["SupplierGoodsDiscrepancyOffset"]] = relationship(
        back_populates="shortage", foreign_keys="SupplierGoodsDiscrepancyOffset.shortage_id"
    )
    excess_offsets: Mapped[List["SupplierGoodsDiscrepancyOffset"]] = relationship(
        back_populates="excess", foreign_keys="SupplierGoodsDiscrepancyOffset.excess_id"
    )


class SupplierGoodsDiscrepancySource(Base):
    __tablename__ = "supplier_goods_discrepancy_sources"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_supplier_discrepancy_source_qty"),
        CheckConstraint("released_quantity >= 0 AND released_quantity <= quantity",
                        name="ck_supplier_discrepancy_source_released_qty"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    discrepancy_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_goods_discrepancies.id", ondelete="CASCADE"), index=True
    )
    lot_id: Mapped[int] = mapped_column(ForeignKey("inventory_lots.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    released_quantity: Mapped[int] = mapped_column(Integer, default=0)

    discrepancy: Mapped["SupplierGoodsDiscrepancy"] = relationship(back_populates="sources")
    lot: Mapped["InventoryLot"] = relationship()


class SupplierGoodsDiscrepancyOffset(Base):
    __tablename__ = "supplier_goods_discrepancy_offsets"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_supplier_discrepancy_offset_qty"),
        CheckConstraint("shortage_id != excess_id", name="ck_supplier_discrepancy_offset_distinct"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shortage_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_goods_discrepancies.id", ondelete="CASCADE"), index=True
    )
    excess_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_goods_discrepancies.id", ondelete="CASCADE"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    shortage: Mapped["SupplierGoodsDiscrepancy"] = relationship(
        back_populates="shortage_offsets", foreign_keys=[shortage_id]
    )
    excess: Mapped["SupplierGoodsDiscrepancy"] = relationship(
        back_populates="excess_offsets", foreign_keys=[excess_id]
    )


class InventoryTransfer(Base):
    __tablename__ = "inventory_transfers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", index=True)
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)

    items: Mapped[List["InventoryTransferItem"]] = relationship(
        back_populates="transfer", cascade="all, delete-orphan"
    )


class InventoryTransferItem(Base):
    __tablename__ = "inventory_transfer_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_transfer_item_qty_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    transfer_id: Mapped[int] = mapped_column(ForeignKey("inventory_transfers.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    lot_id: Mapped[int] = mapped_column(ForeignKey("inventory_lots.id"))
    source_location_id: Mapped[int] = mapped_column(ForeignKey("warehouse_locations.id"))
    destination_location_id: Mapped[int] = mapped_column(ForeignKey("warehouse_locations.id"))
    quantity: Mapped[int] = mapped_column(Integer)

    transfer: Mapped["InventoryTransfer"] = relationship(back_populates="items")
    lot: Mapped["InventoryLot"] = relationship()


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
    planned_allocations: Mapped[list | None] = mapped_column(JSON, nullable=True)

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

    @property
    def boxes_per_carton(self) -> int:
        return max(1, self.product.boxes_per_carton or 1)


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

    @property
    def location_code(self) -> str | None:
        return self.location.code if self.location else None

    @property
    def lot_number(self) -> str | None:
        return self.lot.lot_number if self.lot else None