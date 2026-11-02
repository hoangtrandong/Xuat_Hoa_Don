from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class VinamilkOrderSnapshot(Base):
    __tablename__ = "vinamilk_order_snapshots"
    __table_args__ = (
        Index("ix_vnm_snapshot_order_number", "order_number"),
        Index("ix_vnm_snapshot_customer", "customer_code", "customer_name"),
        Index("ix_vnm_snapshot_product", "product_code", "product_name"),
        Index("ix_vnm_snapshot_created_date", "order_created_date"),
        Index("ix_vnm_snapshot_delivery_date", "delivery_date"),
        Index("ix_vnm_snapshot_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    remote_key: Mapped[str] = mapped_column(String(300), unique=True)
    order_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    original_order_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    product_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str | None] = mapped_column(String(80), nullable=True)
    processing_status: Mapped[str | None] = mapped_column(String(40), nullable=True, default=None)
    performed_by: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    warehouse_updated: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    returned: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    order_created_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    synced_from: Mapped[date] = mapped_column(Date)
    synced_to: Mapped[date] = mapped_column(Date)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class VinamilkSyncRun(Base):
    __tablename__ = "vinamilk_sync_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20))
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class VinamilkOrderReplacement(Base):
    __tablename__ = "vinamilk_order_replacements"

    new_order_number: Mapped[str] = mapped_column(String(120), primary_key=True)
    replaced_order_number: Mapped[str] = mapped_column(String(1000), nullable=False, index=True)
    replacement_type: Mapped[str] = mapped_column(String(20), nullable=False, default="MANUAL")
    performed_by: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class VinamilkOrderSplitRequest(Base):
    __tablename__ = "vinamilk_order_split_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_order_number: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", index=True)
    requested_by: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviewed_by: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    request_payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    preview_data: Mapped[dict[str, Any]] = mapped_column(JSON)
    result_order_numbers: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, default=None)
