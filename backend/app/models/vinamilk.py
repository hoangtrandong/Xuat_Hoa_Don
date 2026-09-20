from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Index, Integer, JSON, String, Text
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
