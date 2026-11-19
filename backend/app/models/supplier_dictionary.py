from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from typing import List, Optional

from app.core.database import Base


class SupplierDictionary(Base):
    __tablename__ = "supplier_dictionaries"

    id: Mapped[int] = mapped_column(primary_key=True)
    standard_name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    short_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tax_codes: Mapped[list] = mapped_column(JSON, default=list)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
