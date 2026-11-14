from datetime import datetime
from typing import Any, List
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Distributor(Base):
    """Nhà phân phối (Tenant) trong mô hình Multi-Tenant."""

    __tablename__ = "distributors"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    tax_code: Mapped[str | None] = mapped_column(String(30), index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(String(255))
    representative_name: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    supplier_configs: Mapped[List["DistributorSupplierConfig"]] = relationship(
        back_populates="distributor", cascade="all, delete-orphan"
    )
    invoice_configs: Mapped[List["DistributorInvoiceConfig"]] = relationship(
        back_populates="distributor", cascade="all, delete-orphan"
    )
    issued_invoices: Mapped[List["IssuedInvoice"]] = relationship(
        back_populates="distributor", cascade="all, delete-orphan"
    )


class DistributorSupplierConfig(Base):
    """Cấu hình nguồn lấy dữ liệu đơn hàng của từng Nhà cung cấp (NCC) cho mỗi Nhà phân phối (NPP)."""

    __tablename__ = "distributor_supplier_configs"
    __table_args__ = (
        UniqueConstraint("distributor_id", "supplier_code", name="uq_dist_supplier_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    distributor_id: Mapped[int] = mapped_column(ForeignKey("distributors.id", ondelete="CASCADE"), index=True)
    supplier_code: Mapped[str] = mapped_column(String(50), index=True)  # VINAMILK, MASAN, UNILEVER, NESTLE...
    supplier_name: Mapped[str] = mapped_column(String(200))
    connector_type: Mapped[str] = mapped_column(
        String(40), default="REST_API"
    )  # PORTAL_PLAYWRIGHT | REST_API | EXCEL_DYNAMIC | WEBHOOK
    api_endpoint_url: Mapped[str | None] = mapped_column(String(500))
    auth_type: Mapped[str] = mapped_column(String(30), default="BEARER_TOKEN")  # COOKIE | BEARER_TOKEN | BASIC_AUTH | API_KEY | NONE
    username: Mapped[str | None] = mapped_column(String(120))
    encrypted_secret: Mapped[str | None] = mapped_column(Text)  # Password / API Key / Bearer Token
    session_cookie: Mapped[str | None] = mapped_column(Text)
    # Bản đồ ánh xạ trường dữ liệu động từ nguồn NCC -> Canonical Order Model
    field_mapping: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Các tham số request mặc định (headers, query params, root_data_path...)
    request_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="active")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    distributor: Mapped["Distributor"] = relationship(back_populates="supplier_configs")


class DistributorInvoiceConfig(Base):
    """Cấu hình cổng Hóa đơn điện tử & Form xuất hóa đơn riêng theo từng Nhà phân phối."""

    __tablename__ = "distributor_invoice_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    distributor_id: Mapped[int] = mapped_column(ForeignKey("distributors.id", ondelete="CASCADE"), index=True)
    config_name: Mapped[str] = mapped_column(String(160), default="Cấu hình mặc định")
    provider: Mapped[str] = mapped_column(
        String(40), default="MISA"
    )  # MISA | VIETTEL | VNPT | EASYINVOICE | BKAV
    api_url: Mapped[str | None] = mapped_column(String(500))
    app_id: Mapped[str | None] = mapped_column(String(120))
    username: Mapped[str | None] = mapped_column(String(120))
    encrypted_secret: Mapped[str | None] = mapped_column(Text)
    invoice_template_code: Mapped[str] = mapped_column(String(40), default="1/001")  # Mẫu số HĐ (VD: 1/001)
    invoice_series: Mapped[str] = mapped_column(String(40), default="1C26TDD")  # Ký hiệu HĐ (VD: 1C26TDD)
    default_vat_rate: Mapped[float] = mapped_column(Float, default=8.0)  # 0, 5, 8, 10 (%)
    combine_orders: Mapped[bool] = mapped_column(Boolean, default=False)  # Gộp nhiều đơn cùng KH thành 1 HĐ
    promo_handling: Mapped[str] = mapped_column(
        String(30), default="ZERO_PRICE"
    )  # ZERO_PRICE | DISCOUNT_LINE | NOTE_ONLY | EXCLUDE
    discount_display: Mapped[str] = mapped_column(
        String(30), default="BY_LINE"
    )  # BY_LINE | TOTAL_BOTTOM
    product_code_source: Mapped[str] = mapped_column(
        String(30), default="SUPPLIER_SKU"
    )  # SUPPLIER_SKU | DISTRIBUTOR_SKU
    default_payment_method: Mapped[str] = mapped_column(String(30), default="TM/CK")
    seller_bank_account: Mapped[str | None] = mapped_column(String(60))
    seller_bank_name: Mapped[str | None] = mapped_column(String(160))
    # Cấu hình giao diện/form hiển thị riêng của NPP (logo, tiêu đề, ghi chú chân trang, làm tròn...)
    form_layout_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    auto_sign: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    distributor: Mapped["Distributor"] = relationship(back_populates="invoice_configs")


class IssuedInvoice(Base):
    """Hóa đơn điện tử đã tạo nháp hoặc đã phát hành từ đơn hàng chuẩn hóa."""

    __tablename__ = "issued_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    distributor_id: Mapped[int] = mapped_column(ForeignKey("distributors.id", ondelete="CASCADE"), index=True)
    invoice_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("distributor_invoice_configs.id", ondelete="SET NULL"), nullable=True
    )
    provider: Mapped[str] = mapped_column(String(40))  # MISA | VIETTEL | VNPT | EASYINVOICE
    invoice_template_code: Mapped[str] = mapped_column(String(40))
    invoice_series: Mapped[str] = mapped_column(String(40))
    invoice_number: Mapped[str | None] = mapped_column(String(40), index=True)
    tax_authority_code: Mapped[str | None] = mapped_column(String(100))
    transaction_id: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(
        String(25), default="DRAFT", index=True
    )  # DRAFT | ISSUED | SIGNED | CANCELLED
    supplier_code: Mapped[str | None] = mapped_column(String(50), index=True)
    source_order_numbers: Mapped[list[str]] = mapped_column(JSON, default=list)
    buyer_code: Mapped[str | None] = mapped_column(String(80), index=True)
    buyer_name: Mapped[str] = mapped_column(String(255))
    buyer_legal_name: Mapped[str | None] = mapped_column(String(255))
    buyer_tax_code: Mapped[str | None] = mapped_column(String(40))
    buyer_address: Mapped[str | None] = mapped_column(String(255))
    buyer_email: Mapped[str | None] = mapped_column(String(120))
    payment_method: Mapped[str] = mapped_column(String(30), default="TM/CK")
    subtotal_before_tax: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    vat_rate: Mapped[float] = mapped_column(Float, default=8.0)
    vat_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    total_payment: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    amount_in_words: Mapped[str | None] = mapped_column(String(500))
    note: Mapped[str | None] = mapped_column(Text)
    provider_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    provider_response: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    issued_by: Mapped[str | None] = mapped_column(String(120))
    issued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    distributor: Mapped["Distributor"] = relationship(back_populates="issued_invoices")
    items: Mapped[List["IssuedInvoiceItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )


class IssuedInvoiceItem(Base):
    """Dòng hàng hóa chi tiết trên Hóa đơn điện tử."""

    __tablename__ = "issued_invoice_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("issued_invoices.id", ondelete="CASCADE"), index=True)
    line_number: Mapped[int] = mapped_column(Integer, default=1)
    item_type: Mapped[str] = mapped_column(
        String(25), default="NORMAL"
    )  # NORMAL | PROMOTION | DISCOUNT | NOTE
    product_code: Mapped[str] = mapped_column(String(80))
    product_name: Mapped[str] = mapped_column(String(255))
    unit_name: Mapped[str] = mapped_column(String(50), default="Hộp")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit_price: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    discount_rate: Mapped[float] = mapped_column(Float, default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    amount_before_tax: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    vat_rate: Mapped[float] = mapped_column(Float, default=8.0)
    vat_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    source_order_number: Mapped[str | None] = mapped_column(String(120))

    invoice: Mapped["IssuedInvoice"] = relationship(back_populates="items")
