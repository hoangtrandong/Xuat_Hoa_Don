from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Float, Numeric, Text, Integer, UniqueConstraint
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
    """Transfer debt from an employee to a store."""
    __tablename__ = "debt_transfers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    from_employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    to_store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"), index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)  # PENDING | APPROVED | REJECTED
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
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)  # PENDING | APPROVED | CANCELLED
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    delivery_request: Mapped["DeliveryRequest"] = relationship()
    employee: Mapped["Employee"] = relationship()