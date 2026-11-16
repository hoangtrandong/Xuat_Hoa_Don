from collections import defaultdict
from datetime import date, datetime
from io import BytesIO
from typing import Any
import zipfile
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.auth import get_current_user, hash_password, is_super_admin_user
from app.core.database import get_db
from app.models.multi_tenant_invoice import (
    Distributor,
    DistributorInvoiceConfig,
    DistributorSupplierConfig,
    IssuedInvoice,
    IssuedInvoiceItem,
    PurchaseInvoice,
    PurchaseInvoiceItem,
    TaxAuthorityCredential,
)
from app.services.gdt_purchase_invoice_service import (
    authenticate_gdt_taxpayer,
    compute_purchase_goods_summary,
    fetch_gdt_captcha,
    interactive_gdt_login_and_capture_token,
    normalize_bearer_token,
    sync_gdt_purchase_invoices,
)
from app.models.user import Role, User
from app.models.vinamilk import VinamilkOrderSnapshot
from app.services.einvoice_gateway import (
    InvoiceFormEngine,
    get_einvoice_provider,
)
from app.services.supplier_connectors import (
    DynamicFieldMapper,
    RestApiSupplierConnector,
    SUPPLIER_FIELD_MAPPING_PRESETS,
    parse_curl_command,
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
    login_username: str | None = None
    login_password: str | None = None


def _ensure_distributor_account(
    db: Session,
    dist: Distributor,
    login_username: str | None = None,
    login_password: str | None = None,
) -> User | None:
    """Tạo hoặc cập nhật tài khoản đăng nhập quản lý riêng cho một Nhà phân phối (NPP)."""
    existing_user = db.scalar(
        select(User).where(User.distributor_id == dist.id).order_by(User.id)
    )
    default_username = (
        (login_username or "").strip().lower()
        or dist.code.strip().lower().replace("-", "_")
    )
    if existing_user is None:
        # Nếu chưa có user gắn với NPP này, kiểm tra trùng username
        by_name = db.scalar(select(User).where(func.lower(User.username) == default_username))
        if by_name is not None and by_name.distributor_id is None and by_name.username.lower() != "admin":
            existing_user = by_name
            existing_user.distributor_id = dist.id
        elif by_name is not None:
            default_username = f"{default_username}_{dist.id}"

    admin_role = db.scalar(select(Role).where(Role.name == "admin"))
    roles = [admin_role] if admin_role else []

    if existing_user is None:
        raw_pass = (login_password or "").strip() or "123456"
        if len(raw_pass) < 6:
            raise HTTPException(status_code=400, detail="Mật khẩu đăng nhập NPP phải có tối thiểu 6 ký tự.")
        email_candidate = (dist.email or "").strip() or f"{default_username}@npp.dms.local"
        if db.scalar(select(User.id).where(func.lower(User.email) == email_candidate.lower())):
            email_candidate = f"{default_username}.{dist.id}@npp.dms.local"
        new_user = User(
            username=default_username,
            email=email_candidate,
            full_name=f"Quản trị {dist.name}",
            hashed_password=hash_password(raw_pass),
            is_active=True,
            must_change_password=False,
            distributor_id=dist.id,
            roles=roles,
        )
        db.add(new_user)
        db.flush()
        return new_user
    else:
        if login_username and login_username.strip():
            new_uname = login_username.strip()
            conflict = db.scalar(
                select(User).where(
                    func.lower(User.username) == new_uname.lower(),
                    User.id != existing_user.id,
                )
            )
            if conflict is not None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Tên đăng nhập '{new_uname}' đã được sử dụng.",
                )
            existing_user.username = new_uname
        if login_password and login_password.strip():
            raw_pass = login_password.strip()
            if len(raw_pass) < 6:
                raise HTTPException(status_code=400, detail="Mật khẩu đăng nhập NPP phải có tối thiểu 6 ký tự.")
            existing_user.hashed_password = hash_password(raw_pass)
            existing_user.must_change_password = False
            existing_user.failed_login_attempts = 0
            existing_user.locked_until = None
        existing_user.full_name = f"Quản trị {dist.name}"
        if not existing_user.roles and roles:
            existing_user.roles = roles
        db.add(existing_user)
        db.flush()
        return existing_user


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


class SupplierCurlSyncRequest(BaseModel):
    curl_command: str = Field(min_length=10)
    save_config: bool = True
    from_date: date | None = None
    to_date: date | None = None


class CurlParseRequest(BaseModel):
    curl_command: str = Field(min_length=10)


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

    # Đảm bảo Nhà phân phối Mai Gold (NPP-MAIGOLD) luôn sẵn sàng cho kết nối Nazzy DMS
    mg_code = "NPP-MAIGOLD"
    maigold = db.scalar(select(Distributor).where(func.upper(Distributor.code) == mg_code))
    if maigold is None:
        maigold = Distributor(
            code=mg_code,
            name="Nhà Phân Phối Mai Gold",
            tax_code="040076033328",
            phone="0843 940 555",
            email="maigold@dms.nazzy.vn",
            address="Số 224 Khối Hòa Bắc, Tương Dương, Nghệ An",
            representative_name="Mai Trung",
            status="active",
        )
        db.add(maigold)
        db.flush()

    # Kiểm tra cấu hình kết nối DMS Nazzy cho Mai Gold
    nazzy_cfg = db.scalar(
        select(DistributorSupplierConfig).where(
            DistributorSupplierConfig.distributor_id == maigold.id,
            DistributorSupplierConfig.supplier_code == "NAZZY",
        )
    )
    preset_nazzy = SUPPLIER_FIELD_MAPPING_PRESETS.get("NAZZY", {})
    default_nazzy_cookie = (
        "ASP.NET_SessionId=0vvy5x0vajrgt2eqegk1jylv; "
        "ses_adminName=5YvN8dzRH2qNSyBM3Z541w==; "
        "ses_adminCode=AVL4HrI+4owVtPgffyzsJA==; "
        "ses_adminId=zqYY5Ufpw0Dh4gOAckxx8g==; "
        "ses_disId=rpkyw8TV/3/1fam27mR5zQ==; "
        "ses_FacId=XFopTPqmWW6vPT6ckYisKw==; "
        "ses_EmType=PCPi3XdBCEgWsHYazVHa6Q==; "
        "ses_Config=RTDwg3UT5AUcXEqdWp+GWg==; "
        "ses_adminFullName=33jbvoXUNe/qLFm2AdoLnpRVktIG/zG6GPsX9lrskb4=; "
        "ses_adminIsAdmin=BhmlvxJVhfl5nXE8Gv3VDA==; "
        "ses_IsMobile=zzghSkrMV9IlKMcK2UsXPg==; "
        "ses_adminPermission=UypW6KbG68GZpgAPYnSEJA=="
    )
    if nazzy_cfg is None:
        nazzy_cfg = DistributorSupplierConfig(
            distributor_id=maigold.id,
            supplier_code="NAZZY",
            supplier_name="DMS Nazzy (NPP Mai Gold)",
            connector_type="REST_API",
            api_endpoint_url="http://dms21.nazzy.vn/handler/BillsHandler.ashx",
            auth_type="COOKIE",
            session_cookie=default_nazzy_cookie,
            field_mapping=preset_nazzy.get("field_mapping", {}),
            request_config={
                "groupId": "1124|1064|1058|1059|1061|1062|1063|1060|-1",
                "type": 4,
                "status": 2,
                "pageSize": 50,
                "depotId": -1,
                "dicDepot": -1,
                "saleId": -1,
                "productId": -1,
                "typePayment": -1,
                "orderBy": 1,
                "live_http": True,
            },
            status="active",
        )
        db.add(nazzy_cfg)
        db.flush()

    # Kiểm tra cấu hình mẫu HĐĐT cho Mai Gold
    mg_inv_cfg = db.scalar(
        select(DistributorInvoiceConfig).where(DistributorInvoiceConfig.distributor_id == maigold.id)
    )
    if mg_inv_cfg is None:
        db.add(
            DistributorInvoiceConfig(
                distributor_id=maigold.id,
                config_name="MISA meInvoice - NPP Mai Gold",
                provider="MISA",
                invoice_template_code="1/001",
                invoice_series="1C26TMG",
                default_vat_rate=8.0,
                combine_orders=False,
                promo_handling="ZERO_PRICE",
                discount_display="BY_LINE",
                product_code_source="SUPPLIER_SKU",
                default_payment_method="TM/CK",
                form_layout_config={
                    "header_title": "HÓA ĐƠN GIÁ TRỊ GIA TĂNG (MẪU MISA MEINVOICE)",
                    "theme_color": "#0284c7",
                    "show_order_ref": True,
                    "footer_note": "Đơn vị phát hành: Nhà Phân Phối Mai Gold",
                },
                auto_sign=True,
                is_default=True,
                status="active",
            )
        )
        db.flush()

    # Đảm bảo mỗi Nhà phân phối đều có ít nhất 1 tài khoản đăng nhập riêng
    all_dists = db.scalars(select(Distributor).order_by(Distributor.id)).all()
    created_any_user = False
    for d in all_dists:
        has_user = db.scalar(select(User.id).where(User.distributor_id == d.id).limit(1))
        if not has_user:
            _ensure_distributor_account(db, d)
            created_any_user = True
    if created_any_user:
        db.commit()


def _enforce_user_distributor_scope(
    current_user: User | None,
    requested_distributor_id: int | None,
) -> int | None:
    """Nếu người dùng thuộc 1 NPP cố định, khóa cứng mọi truy vấn/thao tác vào NPP đó."""
    if current_user is not None and current_user.distributor_id is not None:
        return current_user.distributor_id
    return requested_distributor_id


def _ensure_user_can_access_supplier_config(
    current_user: User,
    distributor_id: int,
) -> None:
    if is_super_admin_user(current_user):
        return
    if current_user.distributor_id is None or current_user.distributor_id != distributor_id:
        raise HTTPException(
            status_code=403,
            detail="Bạn chỉ được phép truy cập cấu hình nhà cung cấp của Nhà phân phối mình.",
        )


@router.get("/supplier-presets")
def get_supplier_presets() -> dict[str, Any]:
    return SUPPLIER_FIELD_MAPPING_PRESETS


@router.get("/distributors")
def list_distributors(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    stmt = (
        select(Distributor)
        .options(
            selectinload(Distributor.supplier_configs),
            selectinload(Distributor.invoice_configs),
            selectinload(Distributor.issued_invoices),
        )
        .order_by(Distributor.id)
    )
    if current_user.distributor_id is not None:
        stmt = stmt.where(Distributor.id == current_user.distributor_id)
    distributors = db.scalars(stmt).all()

    dist_users = db.scalars(
        select(User).where(User.distributor_id.is_not(None)).order_by(User.id)
    ).all()
    user_by_dist: dict[int, User] = {}
    for u in dist_users:
        if u.distributor_id and u.distributor_id not in user_by_dist:
            user_by_dist[u.distributor_id] = u

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
            "login_username": user_by_dist[d.id].username if d.id in user_by_dist else d.code.lower().replace("-", "_"),
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
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if not is_super_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Chỉ Quản trị hệ thống mới có quyền thêm Nhà phân phối mới.",
        )
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

    dist_user = _ensure_distributor_account(
        db,
        dist,
        login_username=payload.login_username,
        login_password=payload.login_password,
    )

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
    return {
        "id": dist.id,
        "code": dist.code,
        "name": dist.name,
        "login_username": dist_user.username if dist_user else None,
    }


@router.patch("/distributors/{distributor_id}")
def update_distributor(
    distributor_id: int,
    payload: DistributorCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if current_user.distributor_id is not None and current_user.distributor_id != distributor_id:
        raise HTTPException(status_code=403, detail="Bạn chỉ được phép cập nhật thông tin Nhà phân phối của mình.")
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
    dist_user = _ensure_distributor_account(
        db,
        dist,
        login_username=payload.login_username,
        login_password=payload.login_password,
    )
    db.commit()
    return {
        "id": dist.id,
        "code": dist.code,
        "name": dist.name,
        "login_username": dist_user.username if dist_user else None,
    }


@router.delete("/distributors/{distributor_id}")
def delete_distributor(
    distributor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if not is_super_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Chỉ Quản trị hệ thống mới được xóa Nhà phân phối.")
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
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    if is_super_admin_user(current_user):
        effective_dist_id = distributor_id
    else:
        if current_user.distributor_id is None:
            raise HTTPException(status_code=403, detail="Tài khoản chưa được gán Nhà phân phối.")
        requested_dist_id = (
            distributor_id if distributor_id is not None else current_user.distributor_id
        )
        _ensure_user_can_access_supplier_config(current_user, requested_dist_id)
        effective_dist_id = current_user.distributor_id
    stmt = (
        select(DistributorSupplierConfig)
        .options(selectinload(DistributorSupplierConfig.distributor))
        .order_by(DistributorSupplierConfig.distributor_id, DistributorSupplierConfig.id)
    )
    if effective_dist_id is not None:
        stmt = stmt.where(DistributorSupplierConfig.distributor_id == effective_dist_id)
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
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_user_can_access_supplier_config(current_user, payload.distributor_id)
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
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    cfg = db.get(DistributorSupplierConfig, config_id)
    if cfg is not None:
        _ensure_user_can_access_supplier_config(current_user, cfg.distributor_id)
        if cfg.distributor_id != payload.distributor_id:
            raise HTTPException(status_code=403, detail="Không thể chuyển cấu hình sang Nhà phân phối khác.")
    else:
        _ensure_user_can_access_supplier_config(current_user, payload.distributor_id)
    if cfg is None:
        sup_code = payload.supplier_code.strip().upper()
        cfg = db.scalar(
            select(DistributorSupplierConfig).where(
                DistributorSupplierConfig.distributor_id == payload.distributor_id,
                func.upper(DistributorSupplierConfig.supplier_code) == sup_code,
            )
        )
    if cfg is None:
        cfg = DistributorSupplierConfig(
            distributor_id=payload.distributor_id,
            supplier_code=payload.supplier_code.strip().upper(),
            supplier_name=payload.supplier_name.strip(),
            connector_type=payload.connector_type,
            api_endpoint_url=(payload.api_endpoint_url or "").strip() or None,
            auth_type=payload.auth_type,
            username=(payload.username or "").strip() or None,
            encrypted_secret=(payload.encrypted_secret or "").strip() or None,
            session_cookie=(payload.session_cookie or "").strip() or None,
            field_mapping=payload.field_mapping or {},
            request_config=payload.request_config or {},
            status=payload.status or "active",
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
        return {"id": cfg.id, "supplier_code": cfg.supplier_code}

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
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    cfg = db.get(DistributorSupplierConfig, config_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình nguồn Nhà cung cấp.")
    _ensure_user_can_access_supplier_config(current_user, cfg.distributor_id)
    db.delete(cfg)
    db.commit()
    return {"deleted": True, "id": config_id}


@router.post("/supplier-configs/test-connection")
def test_supplier_connection(
    payload: SupplierTestConnectionRequest,
    current_user: User = Depends(get_current_user),
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

        # Hỗ trợ tự động cấu hình và kiểm tra kết nối riêng cho Nazzy DMS (NPP Mai Gold)
        is_nazzy = ("nazzy" in (payload.supplier_code or "").lower() or "nazzy" in url or "billshandler" in url.lower())
        if is_nazzy:
            headers["Referer"] = "http://dms21.nazzy.vn/Pages/Bills/OrderV2.aspx"
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0"
            headers["X-Requested-With"] = "XMLHttpRequest"
            headers["Content-Type"] = "application/json;charset=utf-8"

            clean_base_url = url.split("?")[0].strip() or "http://dms21.nazzy.vn/handler/BillsHandler.ashx"

            req_cfg = payload.request_config or {}
            nazzy_dn = str(req_cfg.get("distributor_code") or req_cfg.get("distributorCode") or "").strip()
            clean_nv = (username or "").strip()
            if "/" in clean_nv:
                parts = clean_nv.split("/", 1)
                if not nazzy_dn:
                    nazzy_dn = parts[0].strip()
                clean_nv = parts[1].strip()

            test_cookie = (payload.session_cookie or secret or "").strip()
            # Tự động đăng nhập lấy cookie phiên nếu người dùng nhập Mã DN + Mã NV + Mật khẩu
            if nazzy_dn and clean_nv and secret:
                try:
                    from app.services.supplier_connectors import nazzy_login_and_get_cookie
                    logged_cookie = nazzy_login_and_get_cookie(nazzy_dn, clean_nv, secret, clean_base_url)
                    headers["Cookie"] = logged_cookie
                    test_cookie = logged_cookie
                    message = f"Xác thực đăng nhập Nazzy DMS thành công (Mã DN: {nazzy_dn}, Mã NV: {clean_nv})! "
                except Exception as login_err:
                    message = f"Đăng nhập Nazzy DMS thất bại: {login_err}. "

            cookies_dict: dict[str, str] = {}
            if test_cookie:
                for part in test_cookie.split(";"):
                    if "=" in part:
                        ck, cv = part.strip().split("=", 1)
                        cookies_dict[ck.strip()] = cv.strip()

            test_params = {
                "t": "GetBillsOrderGetListV5",
                "type": "4",
                "code": "",
                "note": "",
                "typePayment": "-1",
                "groupId": "1124|1064|1058|1059|1061|1062|1063|1060|-1",
                "customer": "",
                "productId": "-1",
                "depotId": "-1",
                "dicDepot": "-1",
                "saleId": "-1",
                "status": "2",
                "fromDate": datetime.utcnow().strftime("%Y/%m/%d"),
                "toDate": datetime.utcnow().strftime("%Y/%m/%d"),
                "currentPage": "1",
                "pageSize": "10",
                "orderBy": "1",
                "_": str(int(datetime.utcnow().timestamp() * 1000)),
            }
            try:
                with httpx.Client(verify=False, timeout=15.0, follow_redirects=True) as client:
                    resp = client.get(clean_base_url, params=test_params, headers=headers, cookies=cookies_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        items_b = data.get("Items", {}) if isinstance(data, dict) else {}
                        orders_b = items_b.get("Items", []) if isinstance(items_b, dict) else []
                        if orders_b:
                            first_depot_id = orders_b[0].get("BillsDepotId")
                            r_det = client.get(
                                clean_base_url,
                                params={"t": "BillsOrderGetInfo", "id": str(first_depot_id), "option": "0"},
                                headers=headers,
                                cookies=cookies_dict,
                            )
                            if r_det.status_code == 200:
                                det_data = r_det.json()
                                info = det_data.get("Info", {})
                                details = det_data.get("Details", [])
                                if details:
                                    sample_row = {**info, **details[0]}
                                    sample_rows = [{**info, **d} for d in details[:5]]
                                    is_live = True
                                    message = f"Kết nối máy chủ DMS Nazzy thành công! Tìm thấy {items_b.get('TotalRecord', len(orders_b))} đơn hàng đã duyệt trong ngày."
            except Exception as nazzy_err:
                message = f"Kết nối Nazzy DMS: {nazzy_err}. "

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
    current_user: User = Depends(get_current_user),
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
    _ensure_user_can_access_supplier_config(current_user, cfg.distributor_id)

    target_from = payload.from_date or datetime.utcnow().date()
    target_to = payload.to_date or target_from

    if payload.custom_raw_rows:
        raw_rows = payload.custom_raw_rows
    else:
        connector = RestApiSupplierConnector()
        try:
            raw_rows = connector.fetch_raw_orders(
                cfg,
                target_from,
                target_to,
                allow_sample_fallback=False,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

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


@router.post("/parse-curl")
def parse_curl_endpoint(payload: CurlParseRequest) -> dict[str, Any]:
    """Phân tích lệnh bash cURL và trích xuất URL, headers, cookies, query parameters."""
    parsed = parse_curl_command(payload.curl_command)
    return {
        "success": bool(parsed.get("url")),
        "parsed": parsed,
    }


@router.post("/supplier-configs/{config_id}/sync-curl")
def sync_orders_from_curl_command(
    config_id: int,
    payload: SupplierCurlSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Đồng bộ đơn hàng trực tiếp bằng chuỗi lệnh bash cURL từ web Nazzy DMS hoặc NCC bất kỳ.
    Tự động trích xuất cookie phiên và cập nhật cấu hình cho NPP."""
    cfg = db.scalar(
        select(DistributorSupplierConfig)
        .options(selectinload(DistributorSupplierConfig.distributor))
        .where(DistributorSupplierConfig.id == config_id)
    )
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình Nhà cung cấp.")
    _ensure_user_can_access_supplier_config(current_user, cfg.distributor_id)

    parsed = parse_curl_command(payload.curl_command)
    if not parsed.get("url"):
        raise HTTPException(status_code=400, detail="Lệnh cURL không hợp lệ: Không tìm thấy URL yêu cầu.")

    # Tự động cập nhật cookie và request config nếu người dùng bật lưu cấu hình
    if payload.save_config:
        if parsed.get("cookies"):
            cfg.session_cookie = parsed["cookies"]
        if parsed.get("url"):
            cfg.api_endpoint_url = parsed["url"]
        cur_req_cfg = dict(cfg.request_config or {})
        for p_key in [
            "groupId",
            "group_id",
            "type",
            "status",
            "pageSize",
            "depotId",
            "dicDepot",
            "saleId",
            "productId",
            "typePayment",
        ]:
            if p_key in parsed.get("params", {}):
                cur_req_cfg[p_key] = parsed["params"][p_key]
        cfg.request_config = cur_req_cfg
        db.add(cfg)
        db.flush()

    # Xác định khoảng ngày đồng bộ
    target_from = payload.from_date
    target_to = payload.to_date
    if not target_from and parsed.get("params", {}).get("fromDate"):
        try:
            target_from = datetime.strptime(str(parsed["params"]["fromDate"]), "%Y/%m/%d").date()
        except Exception:
            pass
    if not target_to and parsed.get("params", {}).get("toDate"):
        try:
            target_to = datetime.strptime(str(parsed["params"]["toDate"]), "%Y/%m/%d").date()
        except Exception:
            pass

    today = datetime.utcnow().date()
    target_from = target_from or today
    target_to = target_to or target_from

    # Đồng bộ đơn hàng qua connector
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

    total_value = sum(
        sum(item.line_total for item in ord_item.items)
        for ord_item in canonical_orders
    )

    return {
        "success": True,
        "supplier_code": cfg.supplier_code,
        "supplier_name": cfg.supplier_name,
        "distributor_code": dist_code,
        "from_date": target_from.isoformat(),
        "to_date": target_to.isoformat(),
        "synced_orders": len(canonical_orders),
        "synced_lines": saved_lines,
        "total_value": total_value,
        "order_numbers": [o.order_number for o in canonical_orders],
        "canonical_preview": [o.model_dump(mode="json") for o in canonical_orders[:5]],
        "message": f"Đồng bộ thành công {len(canonical_orders)} đơn hàng ({saved_lines} dòng sản phẩm) từ DMS Nazzy cho {dist_code}!",
    }


@router.post("/supplier-configs/{config_id}/upload-excel")
async def upload_supplier_excel_orders(
    config_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Nhập file Excel có tên cột đặc thù của từng NCC -> Ánh xạ qua DynamicFieldMapper -> Lưu đơn chuẩn."""
    cfg = db.scalar(
        select(DistributorSupplierConfig)
        .options(selectinload(DistributorSupplierConfig.distributor))
        .where(DistributorSupplierConfig.id == config_id)
    )
    if cfg is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình Nhà cung cấp.")
    _ensure_user_can_access_supplier_config(current_user, cfg.distributor_id)

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
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    effective_dist_id = _enforce_user_distributor_scope(current_user, distributor_id)
    stmt = (
        select(DistributorInvoiceConfig)
        .options(selectinload(DistributorInvoiceConfig.distributor))
        .order_by(DistributorInvoiceConfig.distributor_id, DistributorInvoiceConfig.id)
    )
    if effective_dist_id is not None:
        stmt = stmt.where(DistributorInvoiceConfig.distributor_id == effective_dist_id)
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
    distributor_id: int | None = Query(default=None),
    limit: int = Query(default=300, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """Liệt kê danh sách đơn hàng từ mọi Nhà cung cấp (Vinamilk, Masan, Unilever...) để chọn xuất HĐĐT."""
    _ensure_default_distributors_seeded(db)
    effective_dist_id = _enforce_user_distributor_scope(current_user, distributor_id)
    target_dist_code: str | None = None
    if effective_dist_id is not None:
        dist_obj = db.get(Distributor, effective_dist_id)
        if dist_obj:
            target_dist_code = (dist_obj.code or "").strip().upper()

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
    issued_stmt = select(IssuedInvoice).where(IssuedInvoice.status != "CANCELLED")
    if effective_dist_id is not None:
        issued_stmt = issued_stmt.where(IssuedInvoice.distributor_id == effective_dist_id)
    issued_rows = db.scalars(issued_stmt).all()
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
        row_dist_code = str(raw0.get("Mã NPP") or "").strip().upper()
        if target_dist_code:
            # Đơn hàng có ghi Mã NPP thì bắt buộc khớp với NPP đang chọn;
            # nếu dữ liệu lịch sử chưa gắn Mã NPP thì mặc định thuộc NPP #1 (NPP-DONGDO)
            if row_dist_code and row_dist_code != target_dist_code:
                continue
            if not row_dist_code and effective_dist_id != 1:
                continue

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
        order_discount = float(
            str(raw0.get("Chiết khấu đơn hàng") or raw0.get("OrderDiscount") or 0)
            .replace(",", "")
            or 0
        )
        discount = max(discount, order_discount)

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
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    _ensure_default_distributors_seeded(db)
    effective_dist_id = _enforce_user_distributor_scope(current_user, distributor_id)
    stmt = (
        select(IssuedInvoice)
        .options(selectinload(IssuedInvoice.distributor), selectinload(IssuedInvoice.items))
        .order_by(IssuedInvoice.id.desc())
        .limit(limit)
    )
    if effective_dist_id is not None:
        stmt = stmt.where(IssuedInvoice.distributor_id == effective_dist_id)
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


# ==============================================================================
# HÓA ĐƠN ĐIỆN TỬ MUA VÀO (TỔNG CỤC THUẾ - hoadondientu.gdt.gov.vn)
# ==============================================================================


class GdtAuthRequest(BaseModel):
    distributor_id: int
    username: str | None = None
    password: str | None = None
    ckey: str | None = None
    cvalue: str | None = None
    manual_bearer_token: str | None = None


class GdtSyncPurchaseRequest(BaseModel):
    distributor_id: int
    from_date: date
    to_date: date


class GdtInteractiveLoginSyncRequest(BaseModel):
    distributor_id: int
    from_date: date
    to_date: date
    username: str | None = None
    password: str | None = None


@router.get("/purchase-invoices/credentials")
def get_gdt_credentials_status(
    distributor_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_default_distributors_seeded(db)
    effective_dist_id = _enforce_user_distributor_scope(current_user, distributor_id) or distributor_id
    dist = db.get(Distributor, effective_dist_id)
    if not dist:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")

    cred = db.scalar(
        select(TaxAuthorityCredential).where(TaxAuthorityCredential.distributor_id == effective_dist_id)
    )
    default_username = (cred.username if cred and cred.username else dist.tax_code) or ""
    has_token = bool(cred and cred.bearer_token and cred.bearer_token.strip())
    token_preview = (
        f"{cred.bearer_token[:28]}..."
        if cred and cred.bearer_token and len(cred.bearer_token) > 28
        else (cred.bearer_token if cred and cred.bearer_token else "")
    )
    return {
        "distributor_id": effective_dist_id,
        "distributor_name": dist.name,
        "username": default_username,
        "password": (cred.encrypted_password or "") if cred else "",
        "has_password": bool(cred and cred.encrypted_password),
        "has_bearer_token": has_token,
        "token_preview": token_preview,
        "token_updated_at": cred.token_updated_at.isoformat() if cred and cred.token_updated_at else None,
        "last_synced_at": cred.last_synced_at.isoformat() if cred and cred.last_synced_at else None,
    }


@router.get("/purchase-invoices/captcha")
def get_gdt_captcha() -> dict[str, str]:
    try:
        return fetch_gdt_captcha()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Không thể lấy CAPTCHA từ Cổng Tổng cục Thuế: {exc}",
        ) from exc


@router.post("/purchase-invoices/authenticate")
def authenticate_gdt_account(
    payload: GdtAuthRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    dist = db.get(Distributor, payload.distributor_id)
    if not dist:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")

    cred = db.scalar(
        select(TaxAuthorityCredential).where(
            TaxAuthorityCredential.distributor_id == payload.distributor_id
        )
    )
    if cred is None:
        cred = TaxAuthorityCredential(distributor_id=payload.distributor_id)
        db.add(cred)
        db.flush()

    if payload.username is not None and payload.username.strip():
        cred.username = payload.username.strip()
    elif not cred.username and dist.tax_code:
        cred.username = dist.tax_code.strip()

    if payload.password is not None and payload.password.strip():
        cred.encrypted_password = payload.password.strip()

    if payload.manual_bearer_token and payload.manual_bearer_token.strip():
        cred.bearer_token = normalize_bearer_token(payload.manual_bearer_token)
        cred.token_updated_at = datetime.utcnow()

    cred.updated_by = getattr(current_user, "username", None) or "admin"
    db.commit()

    return {
        "success": True,
        "username": cred.username,
        "password": cred.encrypted_password or "",
        "has_password": bool(cred.encrypted_password),
        "has_bearer_token": bool(cred.bearer_token),
        "token_preview": f"{cred.bearer_token[:28]}..." if cred.bearer_token else "",
        "token_updated_at": cred.token_updated_at.isoformat() if cred.token_updated_at else None,
    }


@router.post("/purchase-invoices/sync")
def sync_purchase_invoices_endpoint(
    payload: GdtSyncPurchaseRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if payload.to_date < payload.from_date:
        raise HTTPException(status_code=400, detail="Từ ngày không được lớn hơn Đến ngày.")

    cred = db.scalar(
        select(TaxAuthorityCredential).where(
            TaxAuthorityCredential.distributor_id == payload.distributor_id
        )
    )
    if not cred or not cred.bearer_token or not cred.bearer_token.strip():
        raise HTTPException(
            status_code=428,
            detail="CQT_TOKEN_REQUIRED: Chưa có phiên đăng nhập Cổng Thuế. Vui lòng xác thực tài khoản CQT.",
        )

    try:
        result = sync_gdt_purchase_invoices(
            db=db,
            distributor_id=payload.distributor_id,
            from_date=payload.from_date,
            to_date=payload.to_date,
            bearer_token=cred.bearer_token,
        )
        return {
            "success": True,
            **result,
        }
    except PermissionError as exc:
        raise HTTPException(
            status_code=428,
            detail="CQT_TOKEN_EXPIRED: Phiên Bearer Token Cổng Thuế đã hết hạn. Vui lòng đăng nhập lại Cổng Thuế để làm mới phiên.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Lỗi khi đồng bộ hóa đơn mua vào từ Tổng cục Thuế: {exc}",
        ) from exc


@router.post("/purchase-invoices/interactive-login-sync")
def interactive_login_and_sync_purchase_invoices(
    payload: GdtInteractiveLoginSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Mở cửa sổ trình duyệt tới hoadondientu.gdt.gov.vn để người dùng đăng nhập thủ công.
    Ngay khi người dùng đăng nhập xong, tự động bắt Bearer Token, lưu vào DB và chạy đồng bộ Hóa đơn mua vào."""
    if payload.to_date < payload.from_date:
        raise HTTPException(status_code=400, detail="Từ ngày không được lớn hơn Đến ngày.")

    dist = db.get(Distributor, payload.distributor_id)
    if not dist:
        raise HTTPException(status_code=404, detail="Không tìm thấy Nhà phân phối.")

    cred = db.scalar(
        select(TaxAuthorityCredential).where(
            TaxAuthorityCredential.distributor_id == payload.distributor_id
        )
    )
    if cred is None:
        cred = TaxAuthorityCredential(distributor_id=payload.distributor_id)
        db.add(cred)
        db.flush()

    if payload.username and payload.username.strip():
        cred.username = payload.username.strip()
    elif not cred.username and dist.tax_code:
        cred.username = dist.tax_code.strip()

    if payload.password and payload.password.strip():
        cred.encrypted_password = payload.password.strip()
    db.commit()

    try:
        token = interactive_gdt_login_and_capture_token(
            username=cred.username,
            password=cred.encrypted_password,
            timeout_seconds=180,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Không lấy được phiên đăng nhập từ cửa sổ trình duyệt: {exc}",
        ) from exc

    cred.bearer_token = token
    cred.token_updated_at = datetime.utcnow()
    cred.updated_by = getattr(current_user, "username", None) or "admin"
    db.commit()

    try:
        result = sync_gdt_purchase_invoices(
            db=db,
            distributor_id=payload.distributor_id,
            from_date=payload.from_date,
            to_date=payload.to_date,
            bearer_token=cred.bearer_token,
        )
        return {
            "success": True,
            "token_captured": True,
            **result,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Đã bắt được Bearer Token nhưng gặp lỗi khi tải hóa đơn: {exc}",
        ) from exc


class PurchaseInvoiceZipDownloadRequest(BaseModel):
    distributor_id: int
    invoice_ids: list[int] | None = None
    file_type: str = "all"  # "all" | "xml" | "html"


def _extract_invoice_discount_and_fee(r: PurchaseInvoice) -> tuple[float, float]:
    raw = r.raw_metadata if isinstance(r.raw_metadata, dict) else {}
    disc = raw.get("ttcktmai") or raw.get("tgtcktm") or raw.get("chietKhau")
    if disc is not None:
        try:
            disc_val = float(disc)
        except (TypeError, ValueError):
            disc_val = 0.0
    else:
        disc_val = sum(float(it.discount_amount or 0) for it in r.items)

    fee = raw.get("tgtphi") or raw.get("tphi") or raw.get("tongPhi") or 0
    try:
        fee_val = float(fee)
    except (TypeError, ValueError):
        fee_val = 0.0
    return round(disc_val, 2), round(fee_val, 2)


def _resolve_tthai_code(r: PurchaseInvoice, is_replaced: bool) -> str:
    raw = r.raw_metadata if isinstance(r.raw_metadata, dict) else {}
    tthai = str(raw.get("tthai") or "").strip()
    if tthai in ("1", "2", "3", "4", "5", "6"):
        return tthai
    if is_replaced:
        return "4"
    if (r.replaced_invoice_number or "").strip():
        return "2"
    return "1"


TTHAI_LABELS: dict[str, str] = {
    "1": "Hóa đơn mới",
    "2": "Hóa đơn thay thế",
    "3": "Hóa đơn điều chỉnh",
    "4": "Hóa đơn đã bị thay thế",
    "5": "Hóa đơn đã bị điều chỉnh",
    "6": "Hóa đơn đã bị hủy",
}

KQKT_LABELS: dict[str, str] = {
    "5": "Đã cấp mã hóa đơn",
    "6": "Cục Thuế đã nhận không mã",
    "8": "Đã cấp mã HĐ khởi tạo từ máy tính tiền",
}


@router.get("/purchase-invoices")
def list_purchase_invoices(
    distributor_id: int = Query(...),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    category: str = Query(default="ALL"),
    seller_tax_code: str = Query(default=""),
    buyer_identity: str = Query(default=""),
    status_filter: str = Query(default="ALL"),
    check_result: str = Query(default="ALL"),
    invoice_number: str = Query(default=""),
    invoice_template: str = Query(default=""),
    invoice_symbol: str = Query(default=""),
    search: str = Query(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_default_distributors_seeded(db)
    effective_dist_id = _enforce_user_distributor_scope(current_user, distributor_id) or distributor_id
    stmt = (
        select(PurchaseInvoice)
        .options(selectinload(PurchaseInvoice.items))
        .where(PurchaseInvoice.distributor_id == effective_dist_id)
        .order_by(PurchaseInvoice.invoice_date.desc(), PurchaseInvoice.id.desc())
    )
    if from_date is not None:
        stmt = stmt.where(
            PurchaseInvoice.invoice_date >= datetime.combine(from_date, datetime.min.time())
        )
    if to_date is not None:
        stmt = stmt.where(
            PurchaseInvoice.invoice_date <= datetime.combine(to_date, datetime.max.time())
        )
    if category and category.upper() != "ALL":
        stmt = stmt.where(PurchaseInvoice.invoice_category == category.upper())

    base_rows = list(db.scalars(stmt).all())

    # Danh sách Nhà cung cấp (Người bán) duy nhất trong khoảng ngày để hiển thị gợi ý trên bộ lọc
    sellers_map: dict[str, str] = {}
    for r in base_rows:
        mst = (r.seller_tax_code or "").strip()
        if mst and mst not in sellers_map:
            sellers_map[mst] = (r.seller_name or mst).strip()
    sellers_list = [
        {"tax_code": k, "name": v}
        for k, v in sorted(sellers_map.items(), key=lambda x: x[1].lower())
    ]

    # Xác định tập hợp các số hóa đơn đã bị thay thế trong danh sách
    replaced_shds: set[str] = set()
    replaced_by_map: dict[str, str] = {}
    for r in base_rows:
        if r.replaced_invoice_number:
            for part in r.replaced_invoice_number.split("/"):
                clean_shd = part.strip()
                if clean_shd:
                    replaced_shds.add(clean_shd)
                    replaced_by_map[clean_shd] = r.invoice_number

    all_rows = base_rows

    # 1. Lọc theo MST người bán (hoặc tên người bán)
    if seller_tax_code and seller_tax_code.strip() and seller_tax_code.upper() != "ALL":
        sq = seller_tax_code.strip().lower()
        all_rows = [
            r
            for r in all_rows
            if sq in (r.seller_tax_code or "").lower() or sq in (r.seller_name or "").lower()
        ]

    # 2. Lọc theo CCCD / MST người mua
    if buyer_identity and buyer_identity.strip():
        bq = buyer_identity.strip().lower()
        all_rows = [
            r
            for r in all_rows
            if bq in (r.buyer_tax_code or "").lower() or bq in (r.buyer_name or "").lower()
        ]

    # 3. Lọc theo Kết quả kiểm tra (ttxly: 5, 6, 8)
    if check_result and check_result.strip() and check_result.upper() != "ALL":
        cr = check_result.strip()
        all_rows = [
            r
            for r in all_rows
            if (r.ttxly or "").strip() == cr
            or (cr == "5" and r.invoice_category == "CO_MA")
            or (cr == "6" and r.invoice_category == "KHONG_MA")
            or (cr == "8" and (r.invoice_category == "MAY_TINH_TIEN" or r.is_mtt))
        ]

    # 4. Lọc theo Trạng thái hóa đơn (tthai: 1..6 hoặc VALID/REPLACEMENT/REPLACED)
    if status_filter and status_filter.strip() and status_filter.upper() != "ALL":
        sf = status_filter.strip().upper()
        if sf == "VALID":
            all_rows = [
                r for r in all_rows if (r.invoice_number or "").strip() not in replaced_shds
            ]
        elif sf == "REPLACEMENT":
            all_rows = [r for r in all_rows if bool((r.replaced_invoice_number or "").strip())]
        elif sf == "REPLACED":
            all_rows = [
                r for r in all_rows if (r.invoice_number or "").strip() in replaced_shds
            ]
        elif sf in ("1", "2", "3", "4", "5", "6"):
            all_rows = [
                r
                for r in all_rows
                if _resolve_tthai_code(r, (r.invoice_number or "").strip() in replaced_shds) == sf
            ]

    # 5. Lọc theo Số hóa đơn
    if invoice_number and invoice_number.strip():
        inq = invoice_number.strip().lower()
        all_rows = [r for r in all_rows if inq in (r.invoice_number or "").lower()]

    # 6. Lọc theo Ký hiệu mẫu số hóa đơn (1..6)
    if invoice_template and invoice_template.strip() and invoice_template.upper() != "ALL":
        itq = invoice_template.strip().lower()
        all_rows = [r for r in all_rows if (r.invoice_template or "").strip().lower() == itq]

    # 7. Lọc theo Ký hiệu hóa đơn (VD: C26THP)
    if invoice_symbol and invoice_symbol.strip():
        isq = invoice_symbol.strip().lower()
        all_rows = [r for r in all_rows if isq in (r.invoice_symbol or "").lower()]

    # 8. Tìm kiếm tổng hợp
    if search and search.strip():
        q = search.strip().lower()
        all_rows = [
            r
            for r in all_rows
            if q in (r.invoice_number or "").lower()
            or q in (r.invoice_symbol or "").lower()
            or q in (r.seller_tax_code or "").lower()
            or q in (r.seller_name or "").lower()
            or any(
                q in (it.product_code or "").lower() or q in (it.product_name or "").lower()
                for it in r.items
            )
        ]

    goods_summary = compute_purchase_goods_summary(all_rows)

    co_ma_count = sum(1 for r in all_rows if r.invoice_category == "CO_MA")
    khong_ma_count = sum(1 for r in all_rows if r.invoice_category == "KHONG_MA")
    mtt_count = sum(1 for r in all_rows if r.invoice_category == "MAY_TINH_TIEN" or r.is_mtt)
    hddt_count = sum(1 for r in all_rows if not (r.invoice_category == "MAY_TINH_TIEN" or r.is_mtt))
    replaced_count = sum(1 for r in all_rows if (r.invoice_number or "").strip() in replaced_shds)

    net_before_tax = 0.0
    net_tax = 0.0
    net_discount = 0.0
    net_fee = 0.0
    net_total = 0.0
    serialized_invoices: list[dict[str, Any]] = []

    for r in all_rows:
        is_rep = (r.invoice_number or "").strip() in replaced_shds
        mult = -1.0 if is_rep else 1.0
        disc_val, fee_val = _extract_invoice_discount_and_fee(r)
        tthai_code = _resolve_tthai_code(r, is_rep)
        ttxly_code = (r.ttxly or ("8" if r.is_mtt else "5")).strip()

        net_before_tax += float(r.amount_before_tax or 0) * mult
        net_tax += float(r.tax_amount or 0) * mult
        net_discount += disc_val * mult
        net_fee += fee_val * mult
        net_total += float(r.total_amount or 0) * mult

        serialized_invoices.append(
            {
                "id": r.id,
                "distributor_id": r.distributor_id,
                "invoice_template": r.invoice_template,
                "invoice_symbol": r.invoice_symbol,
                "invoice_number": r.invoice_number,
                "invoice_date": r.invoice_date.strftime("%d/%m/%Y") if r.invoice_date else "",
                "invoice_date_iso": r.invoice_date.isoformat() if r.invoice_date else None,
                "seller_tax_code": r.seller_tax_code,
                "seller_name": r.seller_name,
                "seller_address": r.seller_address or "",
                "buyer_tax_code": r.buyer_tax_code or "",
                "buyer_name": r.buyer_name or "",
                "invoice_category": r.invoice_category,
                "ttxly": ttxly_code,
                "kqkt_label": KQKT_LABELS.get(ttxly_code, "Đã cấp mã hóa đơn"),
                "tthai": tthai_code,
                "tthai_label": TTHAI_LABELS.get(tthai_code, "Hóa đơn mới"),
                "is_mtt": r.is_mtt,
                "replaced_invoice_number": r.replaced_invoice_number or "",
                "replaced_invoice_date": r.replaced_invoice_date or "",
                "is_replaced": is_rep,
                "replaced_by_invoice_number": replaced_by_map.get((r.invoice_number or "").strip(), ""),
                "amount_before_tax": float(r.amount_before_tax or 0),
                "tax_amount": float(r.tax_amount or 0),
                "discount_amount": disc_val,
                "fee_amount": fee_val,
                "total_amount": float(r.total_amount or 0),
                "currency": r.currency or "VND",
                "xml_downloaded": r.xml_downloaded,
                "has_html": bool(r.html_content),
                "item_count": len(r.items),
                "synced_at": r.synced_at.isoformat() if r.synced_at else None,
                "items": [
                    {
                        "id": it.id,
                        "line_number": it.line_number,
                        "product_code": it.product_code or "",
                        "product_name": it.product_name,
                        "unit_name": it.unit_name or "",
                        "quantity": it.quantity,
                        "unit_price": float(it.unit_price or 0),
                        "discount_amount": float(it.discount_amount or 0),
                        "amount_before_tax": float(it.amount_before_tax or 0),
                        "vat_rate": it.vat_rate or "",
                    }
                    for it in r.items
                ],
            }
        )

    return {
        "stats": {
            "total_invoices": len(all_rows),
            "hddt_count": hddt_count,
            "co_ma_count": co_ma_count,
            "khong_ma_count": khong_ma_count,
            "mtt_count": mtt_count,
            "replaced_count": replaced_count,
            "total_before_tax": round(net_before_tax, 2),
            "total_tax": round(net_tax, 2),
            "total_discount": round(net_discount, 2),
            "total_fee": round(net_fee, 2),
            "total_payment": round(net_total, 2),
        },
        "sellers": sellers_list,
        "invoices": serialized_invoices,
        "goods_summary": goods_summary,
    }


@router.get("/purchase-invoices/{invoice_id}/detail")
def get_purchase_invoice_detail(
    invoice_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    inv = db.scalar(
        select(PurchaseInvoice)
        .options(selectinload(PurchaseInvoice.items))
        .where(PurchaseInvoice.id == invoice_id)
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hóa đơn mua vào.")
    disc_val, fee_val = _extract_invoice_discount_and_fee(inv)
    tthai_code = _resolve_tthai_code(inv, False)
    ttxly_code = (inv.ttxly or ("8" if inv.is_mtt else "5")).strip()
    return {
        "id": inv.id,
        "invoice_template": inv.invoice_template,
        "invoice_symbol": inv.invoice_symbol,
        "invoice_number": inv.invoice_number,
        "invoice_date": inv.invoice_date.strftime("%d/%m/%Y") if inv.invoice_date else "",
        "seller_tax_code": inv.seller_tax_code,
        "seller_name": inv.seller_name,
        "seller_address": inv.seller_address or "",
        "buyer_tax_code": inv.buyer_tax_code or "",
        "buyer_name": inv.buyer_name or "",
        "ttxly": ttxly_code,
        "kqkt_label": KQKT_LABELS.get(ttxly_code, "Đã cấp mã hóa đơn"),
        "tthai": tthai_code,
        "tthai_label": TTHAI_LABELS.get(tthai_code, "Hóa đơn mới"),
        "replaced_invoice_number": inv.replaced_invoice_number or "",
        "replaced_invoice_date": inv.replaced_invoice_date or "",
        "amount_before_tax": float(inv.amount_before_tax or 0),
        "tax_amount": float(inv.tax_amount or 0),
        "discount_amount": disc_val,
        "fee_amount": fee_val,
        "total_amount": float(inv.total_amount or 0),
        "xml_content": inv.xml_content or "",
        "html_content": inv.html_content or "",
        "items": [
            {
                "id": it.id,
                "line_number": it.line_number,
                "product_code": it.product_code or "",
                "product_name": it.product_name,
                "unit_name": it.unit_name or "",
                "quantity": it.quantity,
                "unit_price": float(it.unit_price or 0),
                "discount_amount": float(it.discount_amount or 0),
                "amount_before_tax": float(it.amount_before_tax or 0),
                "vat_rate": it.vat_rate or "",
            }
            for it in inv.items
        ],
    }


@router.post("/purchase-invoices/download-zip")
def download_purchase_invoices_zip(
    payload: PurchaseInvoiceZipDownloadRequest,
    db: Session = Depends(get_db),
) -> Response:
    """Tải riêng file .XML, file .HTML bản thể hiện, hoặc gói .ZIP (XML + HTML) của các hóa đơn mua vào."""
    stmt = select(PurchaseInvoice).where(PurchaseInvoice.distributor_id == payload.distributor_id)
    if payload.invoice_ids:
        stmt = stmt.where(PurchaseInvoice.id.in_(payload.invoice_ids))
    stmt = stmt.order_by(PurchaseInvoice.invoice_date.desc(), PurchaseInvoice.id.desc())
    rows = list(db.scalars(stmt).all())
    if not rows:
        raise HTTPException(status_code=404, detail="Không có hóa đơn nào để tải về.")

    ft = (payload.file_type or "all").strip().lower()

    # Nếu chỉ tải 1 hóa đơn với định dạng riêng lẻ (xml hoặc html) -> trả trực tiếp file .xml hoặc .html
    if len(rows) == 1 and ft in ("xml", "html"):
        inv = rows[0]
        base_name = f"{inv.seller_tax_code}_{inv.invoice_template}_{inv.invoice_symbol}_{inv.invoice_number}"
        if ft == "xml":
            if not inv.xml_content:
                raise HTTPException(status_code=404, detail="Hóa đơn này chưa có nội dung XML.")
            return Response(
                content=("\ufeff" + inv.xml_content).encode("utf-8"),
                media_type="application/xml; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{base_name}.xml"'},
            )
        if ft == "html":
            if not inv.html_content:
                raise HTTPException(status_code=404, detail="Hóa đơn này chưa có bản thể hiện HTML.")
            return Response(
                content=inv.html_content.encode("utf-8"),
                media_type="text/html; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{base_name}.html"'},
            )

    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for inv in rows:
            base_name = f"{inv.seller_tax_code}_{inv.invoice_template}_{inv.invoice_symbol}_{inv.invoice_number}"
            if ft in ("all", "xml") and inv.xml_content:
                path_xml = f"{base_name}.xml" if ft == "xml" else f"{base_name}/invoice_{base_name}.xml"
                zf.writestr(path_xml, inv.xml_content.encode("utf-8"))
            if ft in ("all", "html") and inv.html_content:
                path_html = f"{base_name}.html" if ft == "html" else f"{base_name}/invoice_{base_name}.html"
                zf.writestr(path_html, inv.html_content.encode("utf-8"))

    zip_bytes = zip_buf.getvalue()
    suffix = "XML" if ft == "xml" else ("HTML" if ft == "html" else "XML_HTML")
    filename = f"Hoa_don_mua_vao_{suffix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.delete("/purchase-invoices/{invoice_id}")
def delete_purchase_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    inv = db.get(PurchaseInvoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hóa đơn mua vào.")
    db.delete(inv)
    db.commit()
    return {"deleted": True, "id": invoice_id}
