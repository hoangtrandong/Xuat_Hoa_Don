from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class VinamilkOrderAllocation(Base):
    __tablename__ = "vinamilk_order_allocations"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "company_id", name="uq_vnm_allocation_snapshot_company"),
        Index("ix_vnm_allocation_company", "company_id"),
        Index("ix_vnm_allocation_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("vinamilk_order_snapshots.id", ondelete="CASCADE"))
    order_number: Mapped[str] = mapped_column(String(120))
    line_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    product_code: Mapped[str] = mapped_column(String(120))
    allocated_quantity: Mapped[float] = mapped_column(Integer)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    company_code: Mapped[str] = mapped_column(String(40))
    company_name: Mapped[str] = mapped_column(String(200))
    distributor_sku: Mapped[str | None] = mapped_column(String(50), nullable=True)
    allocation_method: Mapped[str] = mapped_column(String(30), default="MANUAL_UPLOAD")
    status: Mapped[str] = mapped_column(String(20), default="CONFIRMED")
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
