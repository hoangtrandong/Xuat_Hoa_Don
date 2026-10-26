from datetime import date, datetime
from typing import List
from sqlalchemy import Date, String, DateTime, ForeignKey, Float, Numeric, Text, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    method: Mapped[str] = mapped_column(String(20))  # CASH | TRANSFER | COD
    reference: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    customer: Mapped["Customer"] = relationship()


class Receivable(Base):
    __tablename__ = "receivables"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("sales_orders.id"))
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    due_date: Mapped[datetime | None] = mapped_column(DateTime)
    paid: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[str] = mapped_column(String(15), default="OPEN")  # OPEN | PARTIAL | PAID | OVERDUE
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    customer: Mapped["Customer"] = relationship()


class DebtLedgerEntry(Base):
    """Immutable ledger of debt debits and credits for Employees and Stores."""
    __tablename__ = "debt_ledger_entries"
    __table_args__ = (
        UniqueConstraint(
            "source_type", "source_id", "party_type", "party_id", "entry_type",
            name="uq_debt_ledger_source_party_entry",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    party_type: Mapped[str] = mapped_column(String(20), index=True)  # EMPLOYEE | STORE
    party_id: Mapped[int] = mapped_column(Integer, index=True)
    entry_type: Mapped[str] = mapped_column(String(30), index=True)  # DELIVERY_ISSUE | CASH_RECEIPT | BANK_RECEIPT | TRANSFER_OUT | TRANSFER_IN | RETURN | ADJUSTMENT | REVERSAL
    amount: Mapped[float] = mapped_column(Numeric(14, 2))  # Positive = +debt, Negative = -debt
    source_type: Mapped[str] = mapped_column(String(30))  # DELIVERY_REQUEST | CASH_RECEIPT | DEBT_TRANSFER | DELIVERY_RETURN | MANUAL
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    document_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DebtTransfer(Base):
    """Immediate transfer of debt between an employee or a store."""
    __tablename__ = "debt_transfers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    from_party_type: Mapped[str] = mapped_column(String(20), index=True)
    from_party_id: Mapped[int] = mapped_column(Integer, index=True)
    to_party_type: Mapped[str] = mapped_column(String(20), index=True)
    to_party_id: Mapped[int] = mapped_column(Integer, index=True)
    from_employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"), nullable=True, index=True)
    to_store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"), nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="COMPLETED", index=True)
    requested_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()


class CashReceipt(Base):
    """Cash collected from employee or store."""
    __tablename__ = "cash_receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    party_type: Mapped[str] = mapped_column(String(20), index=True)  # EMPLOYEE | STORE
    party_id: Mapped[int] = mapped_column(Integer, index=True)
    settlement_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    receipt_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DeliveryReturn(Base):
    """Goods return recorded against a delivery request and employee."""
    __tablename__ = "delivery_returns"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    delivery_request_id: Mapped[int] = mapped_column(ForeignKey("delivery_requests.id"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("delivery_request_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    status: Mapped[str] = mapped_column(String(20), default="APPROVED", index=True)  # PENDING | APPROVED | CANCELLED
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    delivery_request: Mapped["DeliveryRequest"] = relationship()
    employee: Mapped["Employee"] = relationship()
    order: Mapped["DeliveryRequestOrder | None"] = relationship()
    items: Mapped[List["DeliveryReturnItem"]] = relationship(back_populates="return_record", cascade="all, delete-orphan")

    @property
    def employee_code(self) -> str | None:
        return self.employee.code if self.employee else None

    @property
    def employee_name(self) -> str | None:
        return self.employee.name if self.employee else None

    @property
    def order_number(self) -> str | None:
        return self.order.order_number if self.order else None


class DeliveryReturnItem(Base):
    __tablename__ = "delivery_return_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_return_id: Mapped[int] = mapped_column(ForeignKey("delivery_returns.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    cartons: Mapped[int] = mapped_column(Integer, default=0)
    loose_boxes: Mapped[int] = mapped_column(Integer, default=0)
    unit_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse_locations.id", ondelete="SET NULL"), nullable=True)

    return_record: Mapped["DeliveryReturn"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()
    location: Mapped["WarehouseLocation | None"] = relationship()

    @property
    def sku(self) -> str | None:
        return self.product.npp_code if self.product else None

    @property
    def product_name(self) -> str | None:
        return self.product.npp_name if self.product else None

    @property
    def location_code(self) -> str | None:
        return self.location.code if self.location else None


class BankReceipt(Base):
    """Tiền chuyển khoản từ Ngân hàng (Cửa hàng / Khách hàng thanh toán)."""
    __tablename__ = "bank_receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    bank_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    account_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ref_number: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    transaction_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    party_type: Mapped[str] = mapped_column(String(20), default="STORE", index=True)  # STORE | CUSTOMER
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)

    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    allocated_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    unallocated_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[str] = mapped_column(String(20), default="UNALLOCATED", index=True)  # UNALLOCATED | PARTIALLY_ALLOCATED | FULLY_ALLOCATED

    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    store: Mapped["Store | None"] = relationship()
    customer: Mapped["Customer | None"] = relationship()
    allocations: Mapped[List["PaymentAllocation"]] = relationship(back_populates="bank_receipt", cascade="all, delete-orphan")

    @property
    def store_code(self) -> str | None:
        return self.store.code if self.store else None

    @property
    def store_name(self) -> str | None:
        return self.store.name if self.store else None


class PaymentAllocation(Base):
    """Bút toán phân bổ gạch nợ chi tiết từ BankReceipt sang Đơn hàng / Nhân viên / Cửa hàng."""
    __tablename__ = "payment_allocations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    bank_receipt_id: Mapped[int] = mapped_column(ForeignKey("bank_receipts.id", ondelete="CASCADE"), index=True)

    order_id: Mapped[int | None] = mapped_column(ForeignKey("delivery_request_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"), nullable=True, index=True)
    settlement_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)

    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    allocation_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    bank_receipt: Mapped["BankReceipt"] = relationship(back_populates="allocations")
    order: Mapped["DeliveryRequestOrder | None"] = relationship()
    employee: Mapped["Employee | None"] = relationship()
    store: Mapped["Store | None"] = relationship()

    @property
    def order_number(self) -> str | None:
        return self.order.order_number if self.order else None

    @property
    def employee_code(self) -> str | None:
        return self.employee.code if self.employee else (self.order.employee_code if self.order else None)

    @property
    def employee_name(self) -> str | None:
        return self.employee.name if self.employee else (self.order.employee_name if self.order else None)