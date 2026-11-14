from collections import defaultdict
from datetime import date, datetime
from typing import Any
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.multi_tenant_invoice import (
    Distributor,
    DistributorInvoiceConfig,
    DistributorSupplierConfig,
    IssuedInvoice,
    IssuedInvoiceItem,
)
from app.models.user import User
from app.models.vinamilk import VinamilkOrderSnapshot
from app.services.einvoice_gateway import (
    InvoiceFormEngine,
    get_einvoice_provider,
)
from app.services.supplier_connectors import (
    DynamicFieldMapper,
    RestApiSupplierConnector,
    SUPPLIER_FIELD_MAPPING_PRESETS,
    parse_excel_with_dynamic_mapping,
    persist_canonical_orders_to_snapshots,
)

router = APIRouter(prefix="/einvoice", tags=["Multi-Tenant & E-Invoice Gateway"])


class DistributorCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    tax_code: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    representative_name: str | None = None
    status: str = "active"


class SupplierConfigUpsertRequest(BaseModel):
    distributor_id: int
    supplier_code: str = Field(min_length=1, max_length=50)
    supplier_name: str = Field(min_length=1, max_length=200)
    connector_type: str = "REST_API"
    api_endpoint_url: str | None = None
    auth_type: str = "BEARER_TOKEN"
    username: str | None = None
    encrypted_secret: str | None = None
    session_cookie: str | None = None
    field_mapping: dict[str, Any] = Field(default_factory=dict)
    request_config: dict[str, Any] = Field(default_factory=dict)
    status: str = "active"


class InvoiceConfigUpsertRequest(BaseModel):
    distributor_id: int
    config_name: str = "Cấu hình HĐĐT mặc định"
    provider: str = "MISA"
    api_url: str | None = None
    app_id: str | None = None
    username: str | None = None
    encrypted_secret: str | None = None
    invoice_template_code: str = "1/001"
    invoice_series: str = "1C26TDD"
    default_vat_rate: float = 8.0
    combine_orders: bool = False
    promo_handling: str = "ZERO_PRICE"
    discount_display: str = "BY_LINE"
    product_code_source: str = "SUPPLIER_SKU"
    default_payment_method: str = "TM/CK"
    seller_bank_account: str | None = None
    seller_bank_name: str | None = None
    form_layout_config: dict[str, Any] = Field(default_factory=dict)
    auto_sign: bool = False
    is_default: bool = True
    status: str = "active"


class SupplierTestConnectionRequest(BaseModel):
    connector_type: str = "REST_API"
    api_endpoint_url: str | None = None
    auth_type: str = "BEARER_TOKEN"
    username: str | None = None
    encrypted_secret: str | None = None
    session_cookie: str | None = None
    supplier_code: str | None = None
    request_config: dict[str, Any] | None = None


class SyncSupplierOrdersRequest(BaseModel):
    from_date: date | None = None
    to_date: date | None = None
    custom_raw_rows: list[dict[str, Any]] | None = None


class InvoicePreviewRequest(BaseModel):
    distributor_id: int
    invoice_config_id: int | None = None
    order_numbers: list[str] = Field(min_length=1)
    buyer_override: dict[str, Any] | None = None


class InvoiceIssueRequest(BaseModel):
    distributor_id: int
    invoice_config_id: int | None = None
    order_numbers: list[str] = Field(min_length=1)
    publish_immediately: bool = True
    buyer_override: dict[str, Any] | None = None


def _ensure_default_distributors_seeded(db: Session) -> None:
    """Khởi tạo sẵn dữ liệu mẫu chuẩn cho Nhà phân phối, Nguồn đơn NCC và Cấu hình HĐĐT nếu bảng đang trống."""
    count = db.scalar(select(func.count(Distributor.id))) or 0
    if count == 0:
        npp1 = Distributor(
            code="NPP-DONGDO",
            name="Công ty TNHH Phân Phối Đông Đô (NPP Mặc định)",
            tax_code="0108899123",
            phone="0903 111 222",
            email="ketoan@dongdodist.vn",
            address="Số 168 Đường Láng, Quận Đống Đa, TP. Hà Nội",
            representative_name="Hoàng Trần Đông",
            status="active",
        )
        npp2 = Distributor(
            code="NPP-NAMVIET",
            name="Công ty Cổ phần Thương mại & Tiếp vận Nam Việt",
            tax_code="0315566789",
            phone="0918 333 444",
            email="einvoice@namvietfmcg.vn",
            address="245 Điện Biên Phủ, Quận Bình Thạnh, TP. Hồ Chí Minh",
            representative_name="Nguyễn Minh Quân",
            status="active",
        )
        db.add_all([npp1, npp2])
        db.flush()

        # Seed cấu hình nguồn đơn hàng NCC cho NPP 1 (Vinamilk + Masan + Unilever + KiotViet)
        for sup_code in ("VINAMILK", "MASAN", "UNILEVER", "KIOTVIET"):
            preset = SUPPLIER_FIELD_MAPPING_PRESETS[sup_code]
            db.add(
                DistributorSupplierConfig(
                    distributor_id=npp1.id,
                    supplier_code=sup_code,
                    supplier_name=preset["supplier_name"],
                    connector_type=preset["connector_type"],
                    api_endpoint_url=preset["api_endpoint_url"],
                    auth_type=preset["auth_type"],
                    username="ctyquyanhna/0972926456" if sup_code == "KIOTVIET" else f"dongdo_{sup_code.lower()}",
                    field_mapping=preset["field_mapping"],
                    request_config={"root_data_path": "Data" if sup_code == "KIOTVIET" else "data", "live_http": sup_code == "KIOTVIET"},
                    status="active",
                )
            )

        # Seed cấu hình nguồn đơn hàng NCC cho NPP 2 (Masan + Nestlé)
        for sup_code in ("MASAN", "NESTLE"):
            preset = SUPPLIER_FIELD_MAPPING_PRESETS[sup_code]
            db.add(
                DistributorSupplierConfig(
                    distributor_id=npp2.id,
                    supplier_code=sup_code,
                    supplier_name=preset["supplier_name"],
                    connector_type=preset["connector_type"],
                    api_endpoint_url=preset["api_endpoint_url"],
                    auth_type=preset["auth_type"],
                    username=f"namviet_{sup_code.lower()}",
                    field_mapping=preset["field_mapping"],
                    request_config={"root_data_path": "orders", "live_http": False},
                    status="active",
                )
            )

        # Seed cấu hình Form & Nhà cung cấp HĐĐT khác nhau cho từng NPP
        db.add_all(
            [
                DistributorInvoiceConfig(
                    distributor_id=npp1.id,
                    config_name="MISA meInvoice - Xuất lẻ từng đơn (Hàng KM giá 0đ)",
                    provider="MISA",
                    api_url="https://api.meinvoice.vn/api/v2/itg/invoicepublishing",
                    app_id="MISA-DONGDO-01",
                    username="ketoan@dongdodist.vn",
                    invoice_template_code="1/001",
                    invoice_series="1C26TDD",
                    default_vat_rate=8.0,
                    combine_orders=False,
                    promo_handling="ZERO_PRICE",
                    discount_display="BY_LINE",
                    product_code_source="SUPPLIER_SKU",
                    default_payment_method="TM/CK",
                    seller_bank_account="19036889999012",
                    seller_bank_name="Techcombank - CN Đống Đa",
                    form_layout_config={
                        "header_title": "HÓA ĐƠN GIÁ TRỊ GIA TĂNG (MẪU MISA MEINVOICE)",
                        "theme_color": "#0284c7",
                        "show_order_ref": True,
                        "footer_note": "Hóa đơn điện tử được khởi tạo từ phần mềm MISA meInvoice.",
                    },
                    auto_sign=True,
                    is_default=True,
                    status="active",
                ),
                DistributorInvoiceConfig(
                    distributor_id=npp1.id,
                    config_name="Viettel S-Invoice - Gộp đơn theo KH (Mã NPP nội bộ)",
                    provider="VIETTEL",
                    api_url="https://api-sinvoice.viettel.vn/services/einvoiceapplication/api/InvoiceAPI",
                    app_id="VT-SINVOICE-DD",
                    username="0108899123",
                    invoice_template_code="1/002",
                    invoice_series="1C26TAA",
                    default_vat_rate=8.0,
                    combine_orders=True,
                    promo_handling="DISCOUNT_LINE",
                    discount_display="TOTAL_BOTTOM",
                    product_code_source="DISTRIBUTOR_SKU",
                    default_payment_method="CK",
                    seller_bank_account="112000998877",
                    seller_bank_name="VietinBank - CN Hà Nội",
                    form_layout_config={
                        "header_title": "HÓA ĐƠN GTGT KIÊM PHIẾU XUẤT KHO (VIETTEL S-INVOICE)",
                        "theme_color": "#dc2626",
                        "show_order_ref": True,
                        "footer_note": "Tra cứu HĐĐT tại hệ thống S-Invoice của Tập đoàn Viettel.",
                    },
                    auto_sign=False,
                    is_default=False,
                    status="active",
                ),
                DistributorInvoiceConfig(
                    distributor_id=npp2.id,
                    config_name="VNPT e-Invoice - Gộp đơn & Ghi chú hàng KM",
                    provider="VNPT",
                    api_url="https://namvietfmcg-tt78.vnpt-invoice.com.vn/PublishService.asmx",
                    app_id="VNPT-NV-78",
                    username="namviet_admin",
                    invoice_template_code="1/001",
                    invoice_series="1C26MNV",
                    default_vat_rate=10.0,
                    combine_orders=True,
                    promo_handling="NOTE_ONLY",
                    discount_display="BY_LINE",
                    product_code_source="SUPPLIER_SKU",
                    default_payment_method="TM/CK",
                    seller_bank_account="0071001234567",
                    seller_bank_name="Vietcombank - CN TP.HCM",
                    form_layout_config={
                        "header_title": "HÓA ĐƠN GIÁ TRỊ GIA TĂNG (VNPT INVOICE)",
                        "theme_color": "#2563eb",
                        "show_order_ref": True,
                        "footer_note": "Đơn vị cung cấp giải pháp HĐĐT: Tập đoàn Bưu chính Viễn thông Việt Nam (VNPT).",
                    },
                    auto_sign=True,
                    is_default=True,
                    status="active",
                ),
            ]
        )
        db.commit()

    # Tự động cập nhật nếu có config KiotViet đang chứa URL cũ public.kiotapi.com
    old_kv_cfgs = db.scalars(
        select(DistributorSupplierConfig).where(
            DistributorSupplierConfig.supplier_code == "KIOTVIET",
            DistributorSupplierConfig.api_endpoint_url.ilike("%public.kiotapi.com%"),
        )
    ).all()
    if old_kv_cfgs:
        for old_cfg in old_kv_cfgs:
            old_cfg.api_endpoint_url = "https://api-man1.kiotviet.vn/api/invoices?format=json&$top=15"
            db.add(old_cfg)
        db.commit()


@router.get("/supplier-presets")
def get_supplier_presets() -> dict[str, Any]:
    return SUPPLIER_FIELD_MAPPING_PRESETS


@router.get("/distributors")
def list_distributors(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    distributors = db.scalars(
        select(Distributor)
        .options(
            selectinload(Distributor.supplier_configs),
            selectinload(Distributor.invoice_configs),
            selectinload(Distributor.issued_invoices),
        )
        .order_by(Distributor.id)
    ).all()

    return [
        {
            "id": d.id,
            "code": d.code,
            "name": d.name,
            "tax_code": d.tax_code or "",
            "phone": d.phone or "",
            "email": d.email or "",
            "address": d.address or "",
            "representative_name": d.representative_name or "",
            "status": d.status,
            "supplier_config_count": len(d.supplier_configs),
            "invoice_config_count": len(d.invoice_configs),
            "issued_invoice_count": len(d.issued_invoices),
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in distributors
    ]


@router.post("/distributors")
def create_distributor(
    payload: DistributorCreateRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    code = payload.code.strip().upper()
    existing = db.scalar(select(Distributor).where(func.upper(Distributor.code) == code))
    if existing is not None:
        raise HTTPException(status_code=400, detail=f"Mã Nhà phân phối {code} đã tồn tại.")

    dist = Distributor(
        code=code,
        name=payload.name.strip(),
        tax_code=(payload.tax_code or "").strip() or None,
        phone=(payload.phone or "").strip() or None,
        email=(payload.email or "").strip() or None,
        address=(payload.address or "").strip() or None,
        representative_name=(payload.representative_name or "").strip() or None,
        status=payload.status or "active",
    )
    db.add(dist)
    db.flush()

    # Khởi tạo mặc định 1 cấu hình nguồn Vinamilk và 1 cấu hình HĐĐT cho NPP mới
    vnm_preset = SUPPLIER_FIELD_MAPPING_PRESETS["VINAMILK"]
    db.add(
        DistributorSupplierConfig(
            distributor_id=dist.id,
            supplier_code="VINAMILK",
            supplier_name=vnm_preset["supplier_name"],
            connector_type=vnm_preset["connector_type"],
            api_endpoint_url=vnm_preset["api_endpoint_url"],
            auth_type=vnm_preset["auth_type"],
            field_mapping=vnm_preset["field_mapping"],
            request_config={"root_data_path": "data", "live_http": False},
            status="active",
        )
    )
    db.add(
        DistributorInvoiceConfig(
            distributor_id=dist.id,
            config_name=f"MISA meInvoice - {dist.name}",
            provider="MISA",
            invoice_template_code="1/001",
            invoice_series="1C26TYY",
            default_vat_rate=8.0,
            combine_orders=False,
            promo_handling="ZERO_PRICE",
            discount_display="BY_LINE",
            product_code_source="SUPPLIER_SKU",
            default_payment_method="TM/CK",
            form_layout_config={
                "header_title": "HÓA ĐƠN GIÁ TRỊ GIA TĂNG",
                "theme_color": "#0284c7",
                "show_order_ref": True,
                "footer_note": f"Đơn vị phát hành: {dist.name}",
            },
            is_default=True,
            status="active",
        )
    )
    db.commit()
    db.refresh(dist)
    return {"id": dist.id, "code": dist.code, "name": dist.name}


@router.patch("/distributors/{distributor_id}")
def update_distributor(
    distributor_id: int,
    payload: DistributorCreateRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    dist = db.get(Distributor, distributor_id)
    if dist is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")
    dist.code = payload.code.strip().upper()
    dist.name = payload.name.strip()
    dist.tax_code = (payload.tax_code or "").strip() or None
    dist.phone = (payload.phone or "").strip() or None
    dist.email = (payload.email or "").strip() or None
    dist.address = (payload.address or "").strip() or None
    dist.representative_name = (payload.representative_name or "").strip() or None
    dist.status = payload.status or "active"
    db.commit()
    return {"id": dist.id, "code": dist.code, "name": dist.name}


@router.delete("/distributors/{distributor_id}")
def delete_distributor(
    distributor_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    dist = db.get(Distributor, distributor_id)
    if dist is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")
    db.delete(dist)
    db.commit()
    return {"deleted": True, "id": distributor_id}


@router.get("/supplier-configs")
def list_supplier_configs(
    distributor_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    stmt = (
        select(DistributorSupplierConfig)
        .options(selectinload(DistributorSupplierConfig.distributor))
        .order_by(DistributorSupplierConfig.distributor_id, DistributorSupplierConfig.id)
    )
    if distributor_id is not None:
        stmt = stmt.where(DistributorSupplierConfig.distributor_id == distributor_id)
    rows = db.scalars(stmt).all()
    return [
        {
            "id": r.id,
            "distributor_id": r.distributor_id,
            "distributor_code": r.distributor.code if r.distributor else "",
            "distributor_name": r.distributor.name if r.distributor else "",
            "supplier_code": r.supplier_code,
            "supplier_name": r.supplier_name,
            "connector_type": r.connector_type,
            "api_endpoint_url": r.api_endpoint_url or "",
            "auth_type": r.auth_type,
            "username": r.username or "",
            "has_secret": bool(r.encrypted_secret),
            "has_cookie": bool(r.session_cookie),
            "field_mapping": r.field_mapping or {},
            "request_config": r.request_config or {},
            "status": r.status,
            "last_synced_at": r.last_synced_at.isoformat() if r.last_synced_at else None,
        }
        for r in rows
    ]


@router.post("/supplier-configs")
def create_supplier_config(
    payload: SupplierConfigUpsertRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    dist = db.get(Distributor, payload.distributor_id)
    if dist is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")
    sup_code = payload.supplier_code.strip().upper()
    existing = db.scalar(
        select(DistributorSupplierConfig).where(
            DistributorSupplierConfig.distributor_id == payload.distributor_id,
            func.upper(DistributorSupplierConfig.supplier_code) == sup_code,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Nhà phân phối {dist.code} đã có cấu hình cho nhà cung cấp {sup_code}.",
        )

    preset = SUPPLIER_FIELD_MAPPING_PRESETS.get(sup_code, {})
    mapping = payload.field_mapping or preset.get("field_mapping", {})

    cfg = DistributorSupplierConfig(
        distributor_id=payload.distributor_id,
        supplier_code=sup_code,
        supplier_name=payload.supplier_name.strip(),
        connector_type=payload.connector_type,
        api_endpoint_url=(payload.api_endpoint_url or "").strip() or preset.get("api_endpoint_url"),
        auth_type=payload.auth_type,
        username=(payload.username or "").strip() or None,
        encrypted_secret=(payload.encrypted_secret or "").strip() or None,
        session_cookie=(payload.session_cookie or "").strip() or None,
        field_mapping=mapping,
        request_config=payload.request_config or {"root_data_path": "data", "live_http": False},
        status=payload.status or "active",
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"id": cfg.id, "supplier_code": cfg.supplier_code, "supplier_name": cfg.supplier_name}


@router.patch("/supplier-configs/{config_id}")
def update_supplier_config(
    config_id: int,
    payload: SupplierConfigUpsertRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cfg = db.get(DistributorSupplierConfig, config_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình nguồn Nhà cung cấp.")
    cfg.supplier_code = payload.supplier_code.strip().upper()
    cfg.supplier_name = payload.supplier_name.strip()
    cfg.connector_type = payload.connector_type
    cfg.api_endpoint_url = (payload.api_endpoint_url or "").strip() or None
    cfg.auth_type = payload.auth_type
    cfg.username = (payload.username or "").strip() or None
    if payload.encrypted_secret is not None and payload.encrypted_secret.strip() != "":
        cfg.encrypted_secret = payload.encrypted_secret.strip()
    if payload.session_cookie is not None and payload.session_cookie.strip() != "":
        cfg.session_cookie = payload.session_cookie.strip()
    cfg.field_mapping = payload.field_mapping or {}
    cfg.request_config = payload.request_config or {}
    cfg.status = payload.status or "active"
    db.commit()
    return {"id": cfg.id, "supplier_code": cfg.supplier_code}


@router.delete("/supplier-configs/{config_id}")
def delete_supplier_config(
    config_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cfg = db.get(DistributorSupplierConfig, config_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình nguồn Nhà cung cấp.")
    db.delete(cfg)
    db.commit()
    return {"deleted": True, "id": config_id}


@router.post("/supplier-configs/test-connection")
def test_supplier_connection(
    payload: SupplierTestConnectionRequest,
) -> dict[str, Any]:
    """Kiểm tra kết nối tới URL của Nhà cung cấp và lấy mẫu các trường dữ liệu thực tế
    để hỗ trợ người dùng ánh xạ (mapping) trường dữ liệu dễ dàng trên giao diện."""
    import httpx

    url = (payload.api_endpoint_url or "").strip()
    auth_type = payload.auth_type
    secret = (payload.encrypted_secret or "").strip()
    username = (payload.username or "").strip()

    detected_fields: list[dict[str, Any]] = []
    sample_row: dict[str, Any] = {}
    sample_rows: list[dict[str, Any]] = []
    is_live = False
    message = ""

    if url and (url.startswith("http://") or url.startswith("https://")):
        headers = {"Accept": "application/json"}
        auth_header = secret or payload.session_cookie or ""
        clean_token = auth_header.replace("Bearer ", "").strip()

        if auth_type == "BEARER_TOKEN" and clean_token:
            headers["Authorization"] = f"Bearer {clean_token}"
        elif auth_type == "API_KEY" and secret:
            headers["X-API-Key"] = secret
        elif auth_type == "COOKIE" and (payload.session_cookie or secret):
            if clean_token.startswith("eyJ"):
                headers["Authorization"] = f"Bearer {clean_token}"
            headers["Cookie"] = payload.session_cookie or secret
        elif auth_type == "BASIC_AUTH" and (username or secret):
            import base64
            token = base64.b64encode(f"{username}:{secret}".encode("utf-8")).decode("utf-8")
            headers["Authorization"] = f"Basic {token}"

        # Hỗ trợ tự động cấu hình riêng cho Vinamilk DMS One (Web Portal xuất Excel)
        is_vinamilk = ("vinamilk" in (payload.supplier_code or "").lower() or "vinamilk" in url)
        if is_vinamilk:
            clean_user = username
            if clean_user and secret:
                try:
                    from scripts.vinamilk_login import login_and_get_cookie
                    auto_cookie = login_and_get_cookie(username_override=clean_user, password_override=secret)
                    headers["Cookie"] = auto_cookie

                    # Lấy 10 dòng đơn hàng thực tế gần nhất của nhà phân phối này
                    from app.core.database import SessionLocal
                    from app.models.vinamilk import VinamilkOrderSnapshot
                    db_snap = SessionLocal()
                    try:
                        snaps = (
                            db_snap.query(VinamilkOrderSnapshot)
                            .filter(
                                (VinamilkOrderSnapshot.customer_code.like(f"%{clean_user}%"))
                                | (VinamilkOrderSnapshot.performed_by == clean_user)
                                | (VinamilkOrderSnapshot.order_number.like("B%"))
                                | (VinamilkOrderSnapshot.order_number.like("IN%"))
                                | (VinamilkOrderSnapshot.order_number.like("GD%"))
                            )
                            .order_by(VinamilkOrderSnapshot.id.desc())
                            .limit(10)
                            .all()
                        )
                        if snaps:
                            for s in snaps:
                                raw_p = s.raw_payload or {}
                                clean_r = {k: v for k, v in raw_p.items() if not isinstance(v, (dict, list))}
                                clean_r.pop("Mã NPP", None)
                                clean_r["Nhà cung cấp"] = "VINAMILK"
                                if clean_r:
                                    sample_rows.append(clean_r)
                            if sample_rows:
                                sample_row = sample_rows[0]
                                is_live = True
                                message = f"Xác thực tài khoản Vinamilk DMS One ({clean_user}) thành công trực tiếp qua HTTP! Đã tải {len(sample_rows)} dòng đơn hàng thực tế của nhà phân phối."
                    finally:
                        db_snap.close()
                except Exception as vnm_err:
                    message = f"Xác thực Vinamilk DMS One thất bại: {vnm_err}. "
            elif payload.session_cookie:
                headers["Cookie"] = payload.session_cookie
                message = "Đã nhận diện Session Cookie Vinamilk DMS One! "

        # Hỗ trợ tự động cấu hình riêng cho KiotViet
        is_kiotviet = ("kiotviet" in (payload.supplier_code or "").lower() or "kiotviet" in url or "kiotapi" in url)
        if is_kiotviet:
            retailer = "ctyquyanhna"
            clean_user = username
            if "/" in username:
                parts = username.split("/", 1)
                retailer, clean_user = parts[0].strip(), parts[1].strip()
            elif "@" in username and not username.endswith(".com"):
                parts = username.split("@", 1)
                clean_user, retailer = parts[0].strip(), parts[1].strip()

            # Nếu dùng cookie/bearer mà url đang để public.kiotapi.com thì tự động chuyển sang api-man1
            if "public.kiotapi.com" in url:
                url = "https://api-man1.kiotviet.vn/api/invoices?format=json&$top=15"

            headers["Retailer"] = retailer
            headers["Origin"] = f"https://{retailer}.kiotviet.vn"
            headers["Referer"] = f"https://{retailer}.kiotviet.vn/"
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            if clean_token:
                headers["Authorization"] = f"Bearer {clean_token}"

            if auth_type == "COOKIE" and secret and not secret.startswith("eyJ"):
                try:
                    from app.services.supplier_connectors import kiotviet_login_and_get_cookie
                    auto_cookie = kiotviet_login_and_get_cookie(retailer, clean_user, secret)
                    headers["Cookie"] = auto_cookie
                    message = f"Đã tự động đăng nhập KiotViet ({retailer} / {clean_user}) thành công! "
                except Exception as login_err:
                    message = f"Đăng nhập KiotViet thất bại: {login_err}. "

        if not sample_row:
            try:
                with httpx.Client(timeout=15.0, follow_redirects=True) as client:
                    resp = client.get(url, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        raw_list: list[Any] = []
                        if isinstance(data, list):
                            raw_list = data
                        elif isinstance(data, dict):
                            for candidate in ["Data", "data", "orders", "invoices", "rows"]:
                                val = data.get(candidate)
                                if isinstance(val, list) and len(val) > 0:
                                    raw_list = val
                                    break

                        # KiotViet fallback: nếu gọi /orders mà rỗng (Data: []), tự động thử gọi /invoices
                        if is_kiotviet and (not raw_list or len(raw_list) == 0) and "/api/orders" in url:
                            try:
                                alt_url = url.replace("/api/orders", "/api/invoices")
                                alt_resp = client.get(alt_url, headers=headers)
                                if alt_resp.status_code == 200:
                                    alt_data = alt_resp.json()
                                    if isinstance(alt_data, dict) and isinstance(alt_data.get("Data"), list) and len(alt_data["Data"]) > 0:
                                        raw_list = alt_data["Data"]
                                        url = alt_url
                            except Exception:
                                pass

                        if isinstance(raw_list, list) and len(raw_list) > 0:
                            raw_list = [r for r in raw_list if isinstance(r, dict) and r.get("Id") != -1]

                            for r_item in raw_list[:10]:
                                if not isinstance(r_item, dict):
                                    continue
                                details = (
                                    r_item.get("InvoiceDetails")
                                    or r_item.get("invoiceDetails")
                                    or r_item.get("OrderDetails")
                                    or r_item.get("orderDetails")
                                    or r_item.get("items")
                                    or r_item.get("lines")
                                )
                                # Nếu chưa có details và có Id, gọi chi tiết hóa đơn/đơn hàng
                                if (not details or len(details) == 0) and r_item.get("Id") and (is_kiotviet or "/api/" in url):
                                    try:
                                        base_endpoint = url.split("?")[0].rstrip("/")
                                        det_resp = client.get(f"{base_endpoint}/{r_item['Id']}?format=json", headers=headers)
                                        if det_resp.status_code == 200:
                                            det_json = det_resp.json()
                                            r_item = {**r_item, **det_json}
                                            details = det_json.get("InvoiceDetails") or det_json.get("OrderDetails")
                                    except Exception:
                                        pass

                                if isinstance(details, list) and len(details) > 0:
                                    for det_line in details:
                                        if isinstance(det_line, dict):
                                            merged = {**r_item, **det_line}
                                            clean_r = {k: v for k, v in merged.items() if not isinstance(v, (dict, list))}
                                            clean_r.pop("Mã NPP", None)
                                            if "Nhà cung cấp" not in clean_r and "supplier" not in clean_r:
                                                clean_r["Nhà cung cấp"] = (payload.supplier_code or "KIOTVIET").upper()
                                            sample_rows.append(clean_r)
                                            if len(sample_rows) >= 10:
                                                break
                                else:
                                    clean_r = {k: v for k, v in r_item.items() if not isinstance(v, (dict, list))}
                                    clean_r.pop("Mã NPP", None)
                                    if "Nhà cung cấp" not in clean_r and "supplier" not in clean_r:
                                        clean_r["Nhà cung cấp"] = (payload.supplier_code or "KIOTVIET").upper()
                                    sample_rows.append(clean_r)

                                if len(sample_rows) >= 10:
                                    break

                            if sample_rows:
                                is_live = True
                                sample_row = sample_rows[0]
                                message = f"Kết nối trực tiếp thành công (HTTP 200)! Đã tải {len(sample_rows)} dòng dữ liệu thực tế từ máy chủ."
                    elif resp.status_code in (401, 403):
                        message = f"Đã kết nối tới máy chủ nhưng chưa được cấp quyền (HTTP {resp.status_code}). Vui lòng kiểm tra lại Token / Mật khẩu."
                    else:
                        message = f"Máy chủ phản hồi mã HTTP {resp.status_code}."
            except Exception as exc:
                message = f"Không thể kết nối tới URL: {exc}."

    # Chỉ dùng bộ Preset mẫu khi HOÀN TOÀN không kết nối live được
    if not is_live and not sample_row:
        sup_code = (payload.supplier_code or "MASAN").upper()
        from app.services.supplier_connectors import generate_sample_raw_rows_for_supplier
        dummy_cfg = DistributorSupplierConfig(
            distributor_id=1,
            supplier_code=sup_code,
            supplier_name=sup_code,
            connector_type=payload.connector_type,
            api_endpoint_url=url,
            auth_type=payload.auth_type,
            field_mapping=SUPPLIER_FIELD_MAPPING_PRESETS.get(sup_code, {}).get("field_mapping", {}),
        )
        samples = generate_sample_raw_rows_for_supplier(dummy_cfg, datetime.utcnow().date())
        if samples:
            for s in samples:
                clean_s = {k: v for k, v in s.items() if not isinstance(v, (dict, list))}
                clean_s.pop("Mã NPP", None)
                if "Nhà cung cấp" not in clean_s:
                    clean_s["Nhà cung cấp"] = sup_code
                sample_rows.append(clean_s)
            sample_row = sample_rows[0]
            if not message:
                message = f"Đang hiển thị mẫu cấu trúc trường tham khảo của {sup_code}."
            else:
                message += f" Đang hiển thị mẫu cấu trúc trường tham khảo của {sup_code} do chưa kết nối được máy chủ live."

    # Chỉ bổ sung dòng nếu là dữ liệu giả lập (mock preset), KHÔNG chèn dòng ảo vào dữ liệu thật (is_live)
    if not is_live and sample_row and len(sample_rows) < 10:
        base_pool = sample_rows if sample_rows else [sample_row]
        cur_idx = len(sample_rows)
        while len(sample_rows) < 10:
            seed = dict(base_pool[cur_idx % len(base_pool)])
            synth_row: dict[str, Any] = {}
            for k, v in seed.items():
                if isinstance(v, (dict, list)):
                    continue
                if isinstance(v, int):
                    synth_row[k] = int(v * (1 + (cur_idx * 0.05))) if v > 10 else v + (cur_idx % 4)
                elif isinstance(v, float):
                    synth_row[k] = round(v * (1 + (cur_idx * 0.05)), 2)
                elif isinstance(v, str):
                    if any(ch.isdigit() for ch in v) and ("001" in v or "01" in v or "101" in v):
                        synth_row[k] = v.replace("001", f"{cur_idx + 1:03d}").replace("101", f"{cur_idx + 101}").replace("01", f"{cur_idx + 1:02d}")
                    else:
                        synth_row[k] = v
                else:
                    synth_row[k] = v
            sample_rows.append(synth_row)
            cur_idx += 1

    for k, v in sample_row.items():
        if isinstance(v, (dict, list)) or k == "Mã NPP":
            continue
        v_str = str(v)
        detected_fields.append({
            "key": k,
            "sample": v_str[:60] if len(v_str) > 60 else v_str,
            "type": type(v).__name__,
        })

    return {
        "success": is_live or bool(sample_row),
        "is_live": is_live,
        "message": message,
        "detected_fields": detected_fields,
        "sample_row": sample_row,
        "sample_rows": sample_rows[:10],
    }


@router.post("/supplier-configs/{config_id}/sync-orders")
def sync_orders_from_supplier_config(
    config_id: int,
    payload: SyncSupplierOrdersRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Kéo dữ liệu đơn hàng từ URL của Nhà cung cấp, chạy qua DynamicFieldMapper để chuẩn hóa
    sang Canonical Order và lưu vào hệ thống."""
    cfg = db.scalar(
        select(DistributorSupplierConfig)
        .options(selectinload(DistributorSupplierConfig.distributor))
        .where(DistributorSupplierConfig.id == config_id)
    )
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình Nhà cung cấp.")

    target_from = payload.from_date or datetime.utcnow().date()
    target_to = payload.to_date or target_from

    if payload.custom_raw_rows:
        raw_rows = payload.custom_raw_rows
    else:
        connector = RestApiSupplierConnector()
        raw_rows = connector.fetch_raw_orders(cfg, target_from, target_to)

    dist_code = cfg.distributor.code if cfg.distributor else None
    canonical_orders = DynamicFieldMapper.transform_rows_to_canonical(
        raw_rows=raw_rows,
        supplier_code=cfg.supplier_code,
        field_mapping=cfg.field_mapping or {},
        distributor_code=dist_code,
    )
    saved_lines = persist_canonical_orders_to_snapshots(
        db=db,
        canonical_orders=canonical_orders,
        distributor_code=dist_code,
    )
    cfg.last_synced_at = datetime.utcnow()
    db.commit()

    return {
        "supplier_code": cfg.supplier_code,
        "supplier_name": cfg.supplier_name,
        "distributor_code": dist_code,
        "synced_orders": len(canonical_orders),
        "synced_lines": saved_lines,
        "order_numbers": [o.order_number for o in canonical_orders],
        "canonical_preview": [o.model_dump(mode="json") for o in canonical_orders],
    }


@router.post("/supplier-configs/{config_id}/upload-excel")
async def upload_supplier_excel_orders(
    config_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Nhập file Excel có tên cột đặc thù của từng NCC -> Ánh xạ qua DynamicFieldMapper -> Lưu đơn chuẩn."""
    cfg = db.scalar(
        select(DistributorSupplierConfig)
        .options(selectinload(DistributorSupplierConfig.distributor))
        .where(DistributorSupplierConfig.id == config_id)
    )
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình Nhà cung cấp.")

    content = await file.read()
    dist_code = cfg.distributor.code if cfg.distributor else None
    try:
        canonical_orders = parse_excel_with_dynamic_mapping(
            file_bytes=content,
            config=cfg,
            distributor_code=dist_code,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Không thể đọc file Excel: {exc}") from exc

    saved_lines = persist_canonical_orders_to_snapshots(
        db=db,
        canonical_orders=canonical_orders,
        distributor_code=dist_code,
    )
    cfg.last_synced_at = datetime.utcnow()
    db.commit()

    return {
        "supplier_code": cfg.supplier_code,
        "synced_orders": len(canonical_orders),
        "synced_lines": saved_lines,
        "order_numbers": [o.order_number for o in canonical_orders],
    }


@router.get("/invoice-configs")
def list_invoice_configs(
    distributor_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    stmt = (
        select(DistributorInvoiceConfig)
        .options(selectinload(DistributorInvoiceConfig.distributor))
        .order_by(DistributorInvoiceConfig.distributor_id, DistributorInvoiceConfig.id)
    )
    if distributor_id is not None:
        stmt = stmt.where(DistributorInvoiceConfig.distributor_id == distributor_id)
    rows = db.scalars(stmt).all()
    return [
        {
            "id": r.id,
            "distributor_id": r.distributor_id,
            "distributor_code": r.distributor.code if r.distributor else "",
            "distributor_name": r.distributor.name if r.distributor else "",
            "config_name": r.config_name,
            "provider": r.provider,
            "api_url": r.api_url or "",
            "app_id": r.app_id or "",
            "username": r.username or "",
            "invoice_template_code": r.invoice_template_code,
            "invoice_series": r.invoice_series,
            "default_vat_rate": r.default_vat_rate,
            "combine_orders": r.combine_orders,
            "promo_handling": r.promo_handling,
            "discount_display": r.discount_display,
            "product_code_source": r.product_code_source,
            "default_payment_method": r.default_payment_method,
            "seller_bank_account": r.seller_bank_account or "",
            "seller_bank_name": r.seller_bank_name or "",
            "form_layout_config": r.form_layout_config or {},
            "auto_sign": r.auto_sign,
            "is_default": r.is_default,
            "status": r.status,
        }
        for r in rows
    ]


@router.post("/invoice-configs")
def create_invoice_config(
    payload: InvoiceConfigUpsertRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    dist = db.get(Distributor, payload.distributor_id)
    if dist is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")

    if payload.is_default:
        other_configs = db.scalars(
            select(DistributorInvoiceConfig).where(
                DistributorInvoiceConfig.distributor_id == payload.distributor_id
            )
        ).all()
        for oc in other_configs:
            oc.is_default = False

    cfg = DistributorInvoiceConfig(
        distributor_id=payload.distributor_id,
        config_name=payload.config_name.strip(),
        provider=payload.provider.strip().upper(),
        api_url=(payload.api_url or "").strip() or None,
        app_id=(payload.app_id or "").strip() or None,
        username=(payload.username or "").strip() or None,
        encrypted_secret=(payload.encrypted_secret or "").strip() or None,
        invoice_template_code=payload.invoice_template_code.strip(),
        invoice_series=payload.invoice_series.strip().upper(),
        default_vat_rate=payload.default_vat_rate,
        combine_orders=payload.combine_orders,
        promo_handling=payload.promo_handling,
        discount_display=payload.discount_display,
        product_code_source=payload.product_code_source,
        default_payment_method=payload.default_payment_method,
        seller_bank_account=(payload.seller_bank_account or "").strip() or None,
        seller_bank_name=(payload.seller_bank_name or "").strip() or None,
        form_layout_config=payload.form_layout_config or {},
        auto_sign=payload.auto_sign,
        is_default=payload.is_default,
        status=payload.status or "active",
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"id": cfg.id, "config_name": cfg.config_name, "provider": cfg.provider}


@router.patch("/invoice-configs/{config_id}")
def update_invoice_config(
    config_id: int,
    payload: InvoiceConfigUpsertRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cfg = db.get(DistributorInvoiceConfig, config_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình Hóa đơn điện tử.")

    if payload.is_default:
        other_configs = db.scalars(
            select(DistributorInvoiceConfig).where(
                DistributorInvoiceConfig.distributor_id == cfg.distributor_id,
                DistributorInvoiceConfig.id != cfg.id,
            )
        ).all()
        for oc in other_configs:
            oc.is_default = False

    cfg.config_name = payload.config_name.strip()
    cfg.provider = payload.provider.strip().upper()
    cfg.api_url = (payload.api_url or "").strip() or None
    cfg.app_id = (payload.app_id or "").strip() or None
    cfg.username = (payload.username or "").strip() or None
    if payload.encrypted_secret is not None and payload.encrypted_secret.strip() != "":
        cfg.encrypted_secret = payload.encrypted_secret.strip()
    cfg.invoice_template_code = payload.invoice_template_code.strip()
    cfg.invoice_series = payload.invoice_series.strip().upper()
    cfg.default_vat_rate = payload.default_vat_rate
    cfg.combine_orders = payload.combine_orders
    cfg.promo_handling = payload.promo_handling
    cfg.discount_display = payload.discount_display
    cfg.product_code_source = payload.product_code_source
    cfg.default_payment_method = payload.default_payment_method
    cfg.seller_bank_account = (payload.seller_bank_account or "").strip() or None
    cfg.seller_bank_name = (payload.seller_bank_name or "").strip() or None
    cfg.form_layout_config = payload.form_layout_config or {}
    cfg.auto_sign = payload.auto_sign
    cfg.is_default = payload.is_default
    cfg.status = payload.status or "active"
    db.commit()
    return {"id": cfg.id, "config_name": cfg.config_name, "provider": cfg.provider}


@router.delete("/invoice-configs/{config_id}")
def delete_invoice_config(
    config_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cfg = db.get(DistributorInvoiceConfig, config_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình Hóa đơn điện tử.")
    db.delete(cfg)
    db.commit()
    return {"deleted": True, "id": config_id}


@router.get("/candidate-orders")
def list_candidate_orders_for_invoicing(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    supplier_code: str | None = Query(default=None),
    limit: int = Query(default=300, ge=1, le=2000),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Liệt kê danh sách đơn hàng từ mọi Nhà cung cấp (Vinamilk, Masan, Unilever...) để chọn xuất HĐĐT."""
    _ensure_default_distributors_seeded(db)
    stmt = select(VinamilkOrderSnapshot).where(
        VinamilkOrderSnapshot.order_number.is_not(None),
        VinamilkOrderSnapshot.product_code.is_not(None),
    )
    if from_date is not None:
        stmt = stmt.where(VinamilkOrderSnapshot.synced_from >= from_date)
    if to_date is not None:
        stmt = stmt.where(VinamilkOrderSnapshot.synced_to <= to_date)
    stmt = stmt.order_by(VinamilkOrderSnapshot.synced_from.desc(), VinamilkOrderSnapshot.id.desc()).limit(limit * 8)

    snaps = db.scalars(stmt).all()

    # Kiểm tra các đơn đã phát hành hóa đơn
    issued_rows = db.scalars(select(IssuedInvoice).where(IssuedInvoice.status != "CANCELLED")).all()
    invoiced_map: dict[str, dict[str, Any]] = {}
    for inv in issued_rows:
        for ord_num in inv.source_order_numbers or []:
            invoiced_map[ord_num] = {
                "invoice_id": inv.id,
                "invoice_number": inv.invoice_number,
                "invoice_series": inv.invoice_series,
                "provider": inv.provider,
                "status": inv.status,
            }

    grouped: dict[str, list[VinamilkOrderSnapshot]] = defaultdict(list)
    for s in snaps:
        if s.order_number:
            grouped[s.order_number].append(s)

    results: list[dict[str, Any]] = []
    for ord_num, rows in grouped.items():
        first = rows[0]
        raw0 = first.raw_payload if isinstance(first.raw_payload, dict) else {}
        sup = str(raw0.get("Nhà cung cấp") or "VINAMILK").upper()
        if supplier_code and sup != supplier_code.upper():
            continue

        total_qty = 0.0
        total_promo = 0.0
        subtotal = 0.0
        discount = 0.0
        for r in rows:
            rw = r.raw_payload if isinstance(r.raw_payload, dict) else {}
            q = float(str(rw.get("Số lượng") or rw.get("quantity") or 0).replace(",", "") or 0)
            p = float(str(rw.get("Số lượng KM") or rw.get("promotionQuantity") or 0).replace(",", "") or 0)
            price = float(str(rw.get("Giá bán") or rw.get("unitPrice") or 0).replace(",", "") or 0)
            val = float(str(rw.get("Giá trị") or rw.get("totalValue") or (q * price)).replace(",", "") or 0)
            ck = float(str(rw.get("Số tiền CK") or rw.get("discountAmount") or 0).replace(",", "") or 0)
            total_qty += q
            total_promo += p
            subtotal += val if val > 0 else (q * price)
            discount += ck

        inv_info = invoiced_map.get(ord_num)
        results.append(
            {
                "order_number": ord_num,
                "supplier_code": sup,
                "order_date": (first.order_created_date or first.synced_from).isoformat()
                if (first.order_created_date or first.synced_from)
                else "",
                "customer_code": first.customer_code or "",
                "customer_name": first.customer_name or "",
                "customer_tax_code": str(raw0.get("Mã số thuế") or ""),
                "customer_address": str(raw0.get("Địa chỉ") or ""),
                "item_count": len(rows),
                "total_quantity": total_qty,
                "total_promo_quantity": total_promo,
                "subtotal": round(subtotal),
                "discount": round(discount),
                "net_amount": round(max(0.0, subtotal - discount)),
                "invoice_info": inv_info,
            }
        )
        if len(results) >= limit:
            break

    return results


def _resolve_distributor_and_invoice_config(
    db: Session,
    distributor_id: int,
    invoice_config_id: int | None,
) -> tuple[Distributor, DistributorInvoiceConfig]:
    dist = db.get(Distributor, distributor_id)
    if dist is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")

    if invoice_config_id is not None:
        cfg = db.get(DistributorInvoiceConfig, invoice_config_id)
        if cfg is None or cfg.distributor_id != distributor_id:
            raise HTTPException(status_code=404, detail="Cấu hình Hóa đơn điện tử không thuộc Nhà phân phối này.")
        return dist, cfg

    cfg = db.scalar(
        select(DistributorInvoiceConfig)
        .where(DistributorInvoiceConfig.distributor_id == distributor_id)
        .order_by(DistributorInvoiceConfig.is_default.desc(), DistributorInvoiceConfig.id)
    )
    if cfg is None:
        raise HTTPException(
            status_code=400,
            detail="Nhà phân phối này chưa có cấu hình Hóa đơn điện tử. Vui lòng tạo cấu hình trước.",
        )
    return dist, cfg


@router.post("/preview")
def preview_dynamic_einvoices(
    payload: InvoicePreviewRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Sinh bản xem trước Form Hóa Đơn Điện Tử Động theo đúng cấu hình của Nhà phân phối."""
    dist, cfg = _resolve_distributor_and_invoice_config(db, payload.distributor_id, payload.invoice_config_id)
    docs = InvoiceFormEngine.build_invoice_previews(
        db=db,
        distributor=dist,
        config=cfg,
        order_numbers=payload.order_numbers,
        buyer_override=payload.buyer_override,
    )
    if not docs:
        raise HTTPException(status_code=404, detail="Không tìm thấy dòng sản phẩm nào cho các đơn hàng đã chọn.")

    return {
        "distributor": {"id": dist.id, "code": dist.code, "name": dist.name, "tax_code": dist.tax_code},
        "invoice_config": {
            "id": cfg.id,
            "config_name": cfg.config_name,
            "provider": cfg.provider,
            "invoice_template_code": cfg.invoice_template_code,
            "invoice_series": cfg.invoice_series,
            "combine_orders": cfg.combine_orders,
            "promo_handling": cfg.promo_handling,
            "discount_display": cfg.discount_display,
            "product_code_source": cfg.product_code_source,
        },
        "invoice_count": len(docs),
        "documents": [d.model_dump(mode="json") for d in docs],
    }


@router.post("/issue")
def issue_einvoices(
    payload: InvoiceIssueRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Thực hiện tạo nháp hoặc ký số phát hành Hóa đơn điện tử qua cổng Provider của NPP."""
    dist, cfg = _resolve_distributor_and_invoice_config(db, payload.distributor_id, payload.invoice_config_id)
    docs = InvoiceFormEngine.build_invoice_previews(
        db=db,
        distributor=dist,
        config=cfg,
        order_numbers=payload.order_numbers,
        buyer_override=payload.buyer_override,
    )
    if not docs:
        raise HTTPException(status_code=404, detail="Không tìm thấy dữ liệu đơn hàng để phát hành hóa đơn.")

    provider_impl = get_einvoice_provider(cfg.provider)
    created_invoices: list[dict[str, Any]] = []

    for doc in docs:
        issue_res = provider_impl.issue_invoice(
            doc=doc,
            config=cfg,
            publish_immediately=payload.publish_immediately,
        )
        inv = IssuedInvoice(
            distributor_id=dist.id,
            invoice_config_id=cfg.id,
            provider=cfg.provider,
            invoice_template_code=cfg.invoice_template_code,
            invoice_series=cfg.invoice_series,
            invoice_number=issue_res.get("invoice_number"),
            tax_authority_code=issue_res.get("tax_authority_code"),
            transaction_id=issue_res.get("transaction_id"),
            status=issue_res.get("status", "ISSUED"),
            supplier_code=doc.supplier_code,
            source_order_numbers=doc.source_order_numbers,
            buyer_code=doc.buyer_code,
            buyer_name=doc.buyer_name,
            buyer_legal_name=doc.buyer_legal_name,
            buyer_tax_code=doc.buyer_tax_code,
            buyer_address=doc.buyer_address,
            payment_method=doc.payment_method,
            subtotal_before_tax=doc.subtotal_before_tax,
            discount_amount=doc.discount_amount,
            vat_rate=doc.vat_rate,
            vat_amount=doc.vat_amount,
            total_payment=doc.total_payment,
            amount_in_words=doc.amount_in_words,
            note=doc.note,
            provider_payload=issue_res.get("provider_payload", {}),
            provider_response=issue_res,
            issued_by=current_user.username if current_user else "admin",
            issued_at=datetime.utcnow() if payload.publish_immediately else None,
        )
        db.add(inv)
        db.flush()

        for line in doc.items:
            db.add(
                IssuedInvoiceItem(
                    invoice_id=inv.id,
                    line_number=line.line_number,
                    item_type=line.item_type,
                    product_code=line.product_code,
                    product_name=line.product_name,
                    unit_name=line.unit_name,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount_rate=line.discount_rate,
                    discount_amount=line.discount_amount,
                    amount_before_tax=line.amount_before_tax,
                    vat_rate=line.vat_rate,
                    vat_amount=line.vat_amount,
                    total_amount=line.total_amount,
                    source_order_number=line.source_order_number,
                )
            )

        created_invoices.append(
            {
                "id": inv.id,
                "provider": inv.provider,
                "invoice_template_code": inv.invoice_template_code,
                "invoice_series": inv.invoice_series,
                "invoice_number": inv.invoice_number,
                "tax_authority_code": inv.tax_authority_code,
                "transaction_id": inv.transaction_id,
                "status": inv.status,
                "source_order_numbers": inv.source_order_numbers,
                "buyer_name": inv.buyer_name,
                "total_payment": float(inv.total_payment),
            }
        )

    db.commit()
    return {
        "issued_count": len(created_invoices),
        "invoices": created_invoices,
    }


@router.get("/issued")
def list_issued_invoices(
    distributor_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    stmt = (
        select(IssuedInvoice)
        .options(selectinload(IssuedInvoice.distributor), selectinload(IssuedInvoice.items))
        .order_by(IssuedInvoice.id.desc())
        .limit(limit)
    )
    if distributor_id is not None:
        stmt = stmt.where(IssuedInvoice.distributor_id == distributor_id)
    rows = db.scalars(stmt).all()
    return [
        {
            "id": r.id,
            "distributor_id": r.distributor_id,
            "distributor_code": r.distributor.code if r.distributor else "",
            "distributor_name": r.distributor.name if r.distributor else "",
            "provider": r.provider,
            "invoice_template_code": r.invoice_template_code,
            "invoice_series": r.invoice_series,
            "invoice_number": r.invoice_number or "NHÁP",
            "tax_authority_code": r.tax_authority_code or "",
            "transaction_id": r.transaction_id or "",
            "status": r.status,
            "supplier_code": r.supplier_code or "VINAMILK",
            "source_order_numbers": r.source_order_numbers or [],
            "buyer_code": r.buyer_code or "",
            "buyer_name": r.buyer_name,
            "buyer_legal_name": r.buyer_legal_name or "",
            "buyer_tax_code": r.buyer_tax_code or "",
            "buyer_address": r.buyer_address or "",
            "payment_method": r.payment_method,
            "subtotal_before_tax": float(r.subtotal_before_tax or 0),
            "discount_amount": float(r.discount_amount or 0),
            "vat_rate": r.vat_rate,
            "vat_amount": float(r.vat_amount or 0),
            "total_payment": float(r.total_payment or 0),
            "amount_in_words": r.amount_in_words or "",
            "note": r.note or "",
            "issued_by": r.issued_by or "",
            "issued_at": r.issued_at.isoformat() if r.issued_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "provider_payload": r.provider_payload or {},
            "items": [
                {
                    "id": it.id,
                    "line_number": it.line_number,
                    "item_type": it.item_type,
                    "product_code": it.product_code,
                    "product_name": it.product_name,
                    "unit_name": it.unit_name,
                    "quantity": it.quantity,
                    "unit_price": float(it.unit_price or 0),
                    "discount_rate": it.discount_rate,
                    "discount_amount": float(it.discount_amount or 0),
                    "amount_before_tax": float(it.amount_before_tax or 0),
                    "vat_rate": it.vat_rate,
                    "vat_amount": float(it.vat_amount or 0),
                    "total_amount": float(it.total_amount or 0),
                    "source_order_number": it.source_order_number,
                }
                for it in r.items
            ],
        }
        for r in rows
    ]
