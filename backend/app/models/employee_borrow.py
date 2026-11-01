from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EmployeeBorrowBatch(Base):
    __tablename__ = "employee_borrow_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_hash: Mapped[str] = mapped_column(String(64), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(12), default="PENDING", index=True)
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime)

    entries: Mapped[list["EmployeeBorrowEntry"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class EmployeeBorrowEntry(Base):
    __tablename__ = "employee_borrow_entries"
    __table_args__ = (
        CheckConstraint("quantity != 0", name="ck_employee_borrow_entry_quantity_nonzero"),
        CheckConstraint(
            "employee_id IS NOT NULL OR external_employee_code IS NOT NULL",
            name="ck_employee_borrow_entry_employee_identity",
        ),
        CheckConstraint(
            "(entry_type = 'BORROW' AND quantity < 0 AND amount <= 0) OR "
            "(entry_type = 'OFFSET' AND quantity > 0 AND amount >= 0)",
            name="ck_employee_borrow_entry_sign",
        ),
        UniqueConstraint("source_entry_id", "source_request_id", name="uq_employee_borrow_request_offset"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee_borrow_batches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"), nullable=True, index=True)
    external_employee_code: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    external_employee_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    entry_type: Mapped[str] = mapped_column(String(10), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    source_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee_borrow_entries.id"), nullable=True, index=True
    )
    source_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("delivery_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    batch: Mapped[EmployeeBorrowBatch | None] = relationship(back_populates="entries")
    employee: Mapped["Employee | None"] = relationship()
    product: Mapped["Product"] = relationship()
    source_entry: Mapped["EmployeeBorrowEntry | None"] = relationship(
        remote_side=[id], foreign_keys=[source_entry_id]
    )
