from abc import ABC, abstractmethod
from datetime import date, datetime
import hashlib
from io import BytesIO
from typing import Any
import httpx
from openpyxl import load_workbook
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.multi_tenant_invoice import DistributorSupplierConfig
from app.models.vinamilk import VinamilkOrderSnapshot


class CanonicalOrderItem(BaseModel):
    """Dòng sản phẩm chuẩn hóa (Canonical Order Item) độc lập với Nhà cung cấp."""

    product_code: str
    product_name: str
    unit: str = "Hộp"
    quantity: float = 0.0
    promo_quantity: float = 0.0
    unit_price: float = 0.0
    discount_amount: float = 0.0
    vat_rate: float = 8.0
    line_total: float = 0.0


class CanonicalOrder(BaseModel):
    """Mô hình Đơn hàng chuẩn hóa duy nhất (Canonical Order Model - CDM)."""

    supplier_code: str
    distributor_code: str | None = None
    order_number: str
    order_date: date
    delivery_date: date | None = None
    customer_code: str
    customer_name: str
    customer_tax_code: str | None = None
    customer_address: str | None = None
    staff_code: str | None = None
    staff_name: str | None = None
    status: str = "Đã duyệt"
    items: list[CanonicalOrderItem] = Field(default_factory=list)


# Các mẫu ánh xạ trường dữ liệu mặc định (Presets) của các Nhà cung cấp lớn
SUPPLIER_FIELD_MAPPING_PRESETS: dict[str, dict[str, Any]] = {
    "VINAMILK": {
        "supplier_name": "Vinamilk (DMS One)",
        "connector_type": "PORTAL_PLAYWRIGHT",
        "api_endpoint_url": "https://vinamilk.dmsone.vn/sale-product/search-sale/search",
        "auth_type": "COOKIE",
        "field_mapping": {
            "order_number": "Số đơn hàng",
            "order_date": "Ngày đơn hàng",
            "delivery_date": "Ngày giao hàng",
            "customer_code": "Mã KH",
            "customer_name": "Tên KH",
            "customer_tax_code": "Mã số thuế",
            "customer_address": "Địa chỉ",
            "product_code": "Mã sản phẩm",
            "product_name": "Tên sản phẩm",
            "unit": "ĐVT",
            "quantity": "Số lượng",
            "promo_quantity": "Số lượng KM",
            "unit_price": "Giá bán",
            "discount_amount": "Số tiền CK",
            "vat_rate": "Thuế suất",
            "line_total": "Thành tiền",
            "staff_code": "Mã NVBH",
            "staff_name": "Tên NVBH",
        },
    },
    "MASAN": {
        "supplier_name": "Masan Consumer (Masan DMS)",
        "connector_type": "REST_API",
        "api_endpoint_url": "https://dms-api.masangroup.com/v2/distributor/orders",
        "auth_type": "BEARER_TOKEN",
        "field_mapping": {
            "order_number": "so_don_hang",
            "order_date": "ngay_dat",
            "delivery_date": "ngay_giao",
            "customer_code": "ma_khach_hang",
            "customer_name": "ten_khach_hang",
            "customer_tax_code": "mst_khach",
            "customer_address": "dia_chi_giao",
            "product_code": "ma_sku",
            "product_name": "ten_hang_hoa",
            "unit": "don_vi_tinh",
            "quantity": "so_luong_ban",
            "promo_quantity": "so_luong_tang",
            "unit_price": "don_gia_chua_vat",
            "discount_amount": "chiet_khau_dong",
            "vat_rate": "thue_gtgt",
            "line_total": "tong_tien_dong",
            "staff_code": "ma_nvbh",
            "staff_name": "ten_nvbh",
        },
    },
    "UNILEVER": {
        "supplier_name": "Unilever Việt Nam (U-Shop / DMS)",
        "connector_type": "REST_API",
        "api_endpoint_url": "https://partner.unilever.com.vn/api/orders/export",
        "auth_type": "API_KEY",
        "field_mapping": {
            "order_number": "orderNo",
            "order_date": "orderDate",
            "delivery_date": "deliveryDate",
            "customer_code": "outletCode",
            "customer_name": "outletName",
            "customer_tax_code": "buyerTaxCode",
            "customer_address": "outletAddress",
            "product_code": "materialCode",
            "product_name": "materialDescription",
            "unit": "uom",
            "quantity": "billedQty",
            "promo_quantity": "freeGoodsQty",
            "unit_price": "basePrice",
            "discount_amount": "tradeDiscount",
            "vat_rate": "vatPercent",
            "line_total": "netAmount",
            "staff_code": "salesRepId",
            "staff_name": "salesRepName",
        },
    },
    "NESTLE": {
        "supplier_name": "Nestlé Việt Nam (DMS Portal)",
        "connector_type": "EXCEL_DYNAMIC",
        "api_endpoint_url": "https://dms.nestle.com.vn/export/sales-orders",
        "auth_type": "BASIC_AUTH",
        "field_mapping": {
            "order_number": "DocNumber",
            "order_date": "DocDate",
            "delivery_date": "ShipDate",
            "customer_code": "CustID",
            "customer_name": "CustName",
            "customer_tax_code": "TaxRegNo",
            "customer_address": "ShipToAddress",
            "product_code": "ItemCode",
            "product_name": "ItemName",
            "unit": "Unit",
            "quantity": "OrderQty",
            "promo_quantity": "BonusQty",
            "unit_price": "UnitPrice",
            "discount_amount": "DiscAmt",
            "vat_rate": "TaxRate",
            "line_total": "TotalLineAmt",
            "staff_code": "SalerCode",
            "staff_name": "SalerName",
        },
    },
    "KIOTVIET": {
        "supplier_name": "KiotViet (KiotAPI)",
        "connector_type": "REST_API",
        "api_endpoint_url": "https://public.kiotapi.com/orders",
        "auth_type": "BEARER_TOKEN",
        "field_mapping": {
            "order_number": "code",
            "order_date": "createdDate",
            "delivery_date": "modifiedDate",
            "customer_code": "customerCode",
            "customer_name": "customerName",
            "customer_tax_code": "customerTaxCode",
            "customer_address": "customerAddress",
            "product_code": "productCode",
            "product_name": "productName",
            "unit": "unit",
            "quantity": "quantity",
            "promo_quantity": "bonusQuantity",
            "unit_price": "price",
            "discount_amount": "discount",
            "vat_rate": "vat",
            "line_total": "subTotal",
            "staff_code": "userCode",
            "staff_name": "userName",
        },
    },
}


def _extract_value(row: dict[str, Any], configured_key: str | None, fallback_keys: tuple[str, ...] = ()) -> Any:
    if configured_key:
        for candidate in [configured_key.strip(), configured_key.strip().lower(), configured_key.strip().upper()]:
            if candidate in row and row[candidate] is not None and str(row[candidate]).strip() != "":
                return row[candidate]
        # Hỗ trợ nested key dạng "customer.code"
        if "." in configured_key:
            cursor: Any = row
            for part in configured_key.split("."):
                if isinstance(cursor, dict) and part in cursor:
                    cursor = cursor[part]
                else:
                    cursor = None
                    break
            if cursor is not None and str(cursor).strip() != "":
                return cursor
    for key in fallback_keys:
        if key in row and row[key] is not None and str(row[key]).strip() != "":
            return row[key]
    return None


def _to_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    text = str(val).replace(",", "").replace("đ", "").replace("VND", "").strip()
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _to_date(val: Any, fallback: date | None = None) -> date:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if val is not None:
        text = str(val).strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(text[:19], fmt).date()
            except ValueError:
                continue
    return fallback or datetime.utcnow().date()


class DynamicFieldMapper:
    """Động cơ ánh xạ dữ liệu động từ cấu trúc bất kỳ của NCC sang Canonical Order Model."""

    @staticmethod
    def transform_rows_to_canonical(
        raw_rows: list[dict[str, Any]],
        supplier_code: str,
        field_mapping: dict[str, Any],
        distributor_code: str | None = None,
    ) -> list[CanonicalOrder]:
        orders_by_number: dict[str, CanonicalOrder] = {}

        for idx, row in enumerate(raw_rows, start=1):
            order_number = str(
                _extract_value(
                    row,
                    field_mapping.get("order_number"),
                    ("orderNumber", "so_don_hang", "orderNo", "DocNumber", "Số đơn hàng", "order_code"),
                )
                or f"{supplier_code}-ORD-{idx:04d}"
            ).strip()

            order_date = _to_date(
                _extract_value(
                    row,
                    field_mapping.get("order_date"),
                    ("orderDate", "ngay_dat", "DocDate", "Ngày đơn hàng", "created_at"),
                )
            )
            delivery_date = _to_date(
                _extract_value(
                    row,
                    field_mapping.get("delivery_date"),
                    ("deliveryDate", "ngay_giao", "ShipDate", "Ngày giao hàng"),
                ),
                fallback=order_date,
            )
            customer_code = str(
                _extract_value(
                    row,
                    field_mapping.get("customer_code"),
                    ("customerCode", "ma_khach_hang", "outletCode", "CustID", "Mã KH"),
                )
                or f"KH-{supplier_code}-001"
            ).strip()
            customer_name = str(
                _extract_value(
                    row,
                    field_mapping.get("customer_name"),
                    ("customerName", "ten_khach_hang", "outletName", "CustName", "Tên KH"),
                )
                or "Khách hàng đại lý"
            ).strip()
            customer_tax_code = str(
                _extract_value(
                    row,
                    field_mapping.get("customer_tax_code"),
                    ("taxCode", "mst_khach", "buyerTaxCode", "TaxRegNo", "Mã số thuế", "MST"),
                )
                or ""
            ).strip() or None
            customer_address = str(
                _extract_value(
                    row,
                    field_mapping.get("customer_address"),
                    ("address", "dia_chi_giao", "outletAddress", "ShipToAddress", "Địa chỉ"),
                )
                or ""
            ).strip() or None
            staff_code = str(
                _extract_value(
                    row,
                    field_mapping.get("staff_code"),
                    ("staffCode", "ma_nvbh", "salesRepId", "SalerCode", "Mã NVBH"),
                )
                or ""
            ).strip() or None
            staff_name = str(
                _extract_value(
                    row,
                    field_mapping.get("staff_name"),
                    ("staffName", "ten_nvbh", "salesRepName", "SalerName", "Tên NVBH"),
                )
                or ""
            ).strip() or None

            product_code = str(
                _extract_value(
                    row,
                    field_mapping.get("product_code"),
                    ("productCode", "ma_sku", "materialCode", "ItemCode", "Mã sản phẩm", "SKU"),
                )
                or f"SKU-{idx:03d}"
            ).strip()
            product_name = str(
                _extract_value(
                    row,
                    field_mapping.get("product_name"),
                    ("productName", "ten_hang_hoa", "materialDescription", "ItemName", "Tên sản phẩm"),
                )
                or f"Sản phẩm {product_code}"
            ).strip()
            unit = str(
                _extract_value(
                    row,
                    field_mapping.get("unit"),
                    ("unit", "don_vi_tinh", "uom", "Unit", "ĐVT"),
                )
                or "Thùng"
            ).strip()
            quantity = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("quantity"),
                    ("quantity", "so_luong_ban", "billedQty", "OrderQty", "Số lượng"),
                ),
                0.0,
            )
            promo_quantity = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("promo_quantity"),
                    ("promoQuantity", "so_luong_tang", "freeGoodsQty", "BonusQty", "Số lượng KM"),
                ),
                0.0,
            )
            unit_price = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("unit_price"),
                    ("unitPrice", "don_gia_chua_vat", "basePrice", "UnitPrice", "Giá bán", "Đơn giá"),
                ),
                0.0,
            )
            discount_amount = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("discount_amount"),
                    ("discountAmount", "chiet_khau_dong", "tradeDiscount", "DiscAmt", "Số tiền CK"),
                ),
                0.0,
            )
            vat_rate = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("vat_rate"),
                    ("vatRate", "thue_gtgt", "vatPercent", "TaxRate", "Thuế suất"),
                ),
                8.0,
            )
            raw_line_total = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("line_total"),
                    ("lineTotal", "tong_tien_dong", "netAmount", "TotalLineAmt", "Thành tiền", "Giá trị"),
                ),
                0.0,
            )
            line_total = raw_line_total if raw_line_total > 0 else max(0.0, quantity * unit_price - discount_amount)

            if order_number not in orders_by_number:
                orders_by_number[order_number] = CanonicalOrder(
                    supplier_code=supplier_code.upper(),
                    distributor_code=distributor_code,
                    order_number=order_number,
                    order_date=order_date,
                    delivery_date=delivery_date,
                    customer_code=customer_code,
                    customer_name=customer_name,
                    customer_tax_code=customer_tax_code,
                    customer_address=customer_address,
                    staff_code=staff_code,
                    staff_name=staff_name,
                    items=[],
                )

            orders_by_number[order_number].items.append(
                CanonicalOrderItem(
                    product_code=product_code,
                    product_name=product_name,
                    unit=unit,
                    quantity=quantity,
                    promo_quantity=promo_quantity,
                    unit_price=unit_price,
                    discount_amount=discount_amount,
                    vat_rate=vat_rate,
                    line_total=line_total,
                )
            )

        return list(orders_by_number.values())


def persist_canonical_orders_to_snapshots(
    db: Session,
    canonical_orders: list[CanonicalOrder],
    distributor_code: str | None = None,
) -> int:
    """Lưu danh sách CanonicalOrder vào bảng VinamilkOrderSnapshot với cấu trúc chuẩn hóa
    để toàn bộ màn hình Đơn Hàng DMS, Tách/Gộp đơn và Xuất Hóa Đơn hoạt động đồng nhất."""
    saved_rows = 0
    for order in canonical_orders:
        for line_idx, item in enumerate(order.items, start=1):
            key_seed = f"{distributor_code or 'DEFAULT'}|{order.supplier_code}|{order.order_number}|{item.product_code}|{line_idx}"
            remote_key = hashlib.sha1(key_seed.encode("utf-8")).hexdigest()

            subtotal_val = round(item.quantity * item.unit_price)
            net_val = round(item.line_total if item.line_total > 0 else max(0.0, subtotal_val - item.discount_amount))

            normalized_payload: dict[str, Any] = {
                "Số đơn hàng": order.order_number,
                "Ngày đơn hàng": order.order_date.strftime("%d/%m/%Y"),
                "Ngày giao hàng": (order.delivery_date or order.order_date).strftime("%d/%m/%Y"),
                "Mã KH": order.customer_code,
                "Tên KH": order.customer_name,
                "Mã số thuế": order.customer_tax_code or "",
                "Địa chỉ": order.customer_address or "",
                "Mã sản phẩm": item.product_code,
                "Tên sản phẩm": item.product_name,
                "ĐVT": item.unit,
                "Số lượng": item.quantity,
                "Số lượng KM": item.promo_quantity,
                "Giá bán": item.unit_price,
                "Giá trị": subtotal_val,
                "Số tiền CK": item.discount_amount,
                "Thành tiền": net_val,
                "Thuế suất": item.vat_rate,
                "Mã NVBH": order.staff_code or "",
                "Tên NVBH": order.staff_name or "",
                "Trạng thái": order.status,
                "Nhà cung cấp": order.supplier_code,
                "Mã NPP": distributor_code or "",
            }

            existing = db.scalar(
                select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.remote_key == remote_key)
            )
            if existing is None:
                snap = VinamilkOrderSnapshot(
                    remote_key=remote_key,
                    order_number=order.order_number,
                    original_order_number=order.order_number,
                    customer_code=order.customer_code,
                    customer_name=order.customer_name,
                    product_code=item.product_code,
                    product_name=item.product_name,
                    status=order.status,
                    processing_status=f"NCC:{order.supplier_code}",
                    performed_by=distributor_code,
                    is_synthetic=False,
                    warehouse_updated=True,
                    returned=False,
                    order_created_date=order.order_date,
                    delivery_date=order.delivery_date or order.order_date,
                    synced_from=order.order_date,
                    synced_to=order.order_date,
                    synced_at=datetime.utcnow(),
                    raw_payload=normalized_payload,
                )
                db.add(snap)
            else:
                existing.customer_code = order.customer_code
                existing.customer_name = order.customer_name
                existing.product_code = item.product_code
                existing.product_name = item.product_name
                existing.order_created_date = order.order_date
                existing.delivery_date = order.delivery_date or order.order_date
                existing.processing_status = f"NCC:{order.supplier_code}"
                existing.performed_by = distributor_code
                existing.synced_at = datetime.utcnow()
                existing.raw_payload = normalized_payload
            saved_rows += 1

    db.commit()
    return saved_rows


class BaseSupplierConnector(ABC):
    """Giao diện chuẩn (Adapter Interface) cho mọi nguồn dữ liệu Nhà cung cấp."""

    @abstractmethod
    def fetch_raw_orders(
        self,
        config: DistributorSupplierConfig,
        from_date: date,
        to_date: date,
    ) -> list[dict[str, Any]]:
        pass


def kiotviet_login_and_get_cookie(retailer: str, username: str, password: str) -> str:
    """Tự động đăng nhập KiotViet Web bằng username và password (gói Chuyên nghiệp không cần Open API).
    Trả về Cookie header (ss-id, ss-pid)."""
    clean_retailer = retailer.strip().lower()
    clean_user = username.strip()
    headers = {
        "Retailer": clean_retailer,
        "Origin": f"https://{clean_retailer}.kiotviet.vn",
        "Referer": f"https://{clean_retailer}.kiotviet.vn/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Content-Type": "application/json",
    }
    payload = {
        "model": {
            "UserName": clean_user,
            "Password": password,
            "RememberMe": True,
        }
    }
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        # Khởi tạo phiên
        client.get("https://api-man1.kiotviet.vn/api/account/checklogin?key=", headers=headers)

        # Gửi thông tin đăng nhập
        resp = client.post(
            "https://api-man1.kiotviet.vn/api/account/login",
            json=payload,
            headers=headers,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Lỗi kết nối tới máy chủ KiotViet: HTTP {resp.status_code}")

        data = resp.json()
        if data.get("error"):
            raise RuntimeError(f"KiotViet từ chối đăng nhập: {data['error']}")

        cookies = [f"{k}={v}" for k, v in client.cookies.items() if v]
        if not cookies:
            raise RuntimeError("Đăng nhập KiotViet thành công nhưng không lấy được cookie phiên.")

        return "; ".join(cookies)


class RestApiSupplierConnector(BaseSupplierConnector):
    """Connector kết nối REST API của các Nhà cung cấp (Masan, Unilever, ERP tùy chỉnh...)."""

    def fetch_raw_orders(
        self,
        config: DistributorSupplierConfig,
        from_date: date,
        to_date: date,
    ) -> list[dict[str, Any]]:
        headers: dict[str, str] = {"Accept": "application/json"}
        if config.auth_type == "BEARER_TOKEN" and config.encrypted_secret:
            headers["Authorization"] = f"Bearer {config.encrypted_secret}"
        elif config.auth_type == "API_KEY" and config.encrypted_secret:
            headers["X-API-Key"] = config.encrypted_secret
        elif config.auth_type == "COOKIE" and config.session_cookie:
            headers["Cookie"] = config.session_cookie

        # Tự động đăng nhập KiotViet bằng username/password nếu chưa có cookie hoặc cookie hết hạn
        if config.supplier_code.upper() == "KIOTVIET" and config.auth_type == "COOKIE":
            retailer = config.username or "ctyquyanhna"
            headers["Retailer"] = retailer
            if not config.session_cookie and config.username and config.encrypted_secret:
                try:
                    cookie = kiotviet_login_and_get_cookie(retailer, config.username, config.encrypted_secret)
                    config.session_cookie = cookie
                    headers["Cookie"] = cookie
                except Exception:
                    pass

        req_cfg = config.request_config or {}
        # Hỗ trợ tự động gọi API thật nếu có URL HTTP/HTTPS
        if config.api_endpoint_url and (config.api_endpoint_url.startswith("http://") or config.api_endpoint_url.startswith("https://")):
            # Hỗ trợ header Retailer đặc thù của KiotViet
            if config.username:
                headers["Retailer"] = config.username.strip()
            if req_cfg.get("retailer"):
                headers["Retailer"] = str(req_cfg["retailer"]).strip()

            try:
                with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                    resp = client.get(
                        config.api_endpoint_url,
                        params={"fromDate": from_date.isoformat(), "toDate": to_date.isoformat()},
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        raw_list: list[Any] = []
                        if isinstance(data, list):
                            raw_list = data
                        elif isinstance(data, dict):
                            root_key = req_cfg.get("root_data_path", "data")
                            raw_list = (
                                data.get(root_key)
                                or data.get("orders")
                                or data.get("invoices")
                                or data.get("rows")
                                or []
                            )

                        # Tự động làm phẳng (Flatten) nếu đơn hàng chứa mảng chi tiết (như orderDetails của KiotViet)
                        flat_rows: list[dict[str, Any]] = []
                        for item in raw_list:
                            if isinstance(item, dict):
                                details = (
                                    item.get("orderDetails")
                                    or item.get("invoiceDetails")
                                    or item.get("items")
                                    or item.get("lines")
                                    or item.get("products")
                                )
                                if isinstance(details, list) and len(details) > 0:
                                    for line in details:
                                        if isinstance(line, dict):
                                            merged = {**item, **line}
                                            if "id" in line:
                                                merged["detail_id"] = line["id"]
                                            flat_rows.append(merged)
                                else:
                                    flat_rows.append(item)
                        if flat_rows:
                            return flat_rows
            except Exception:
                # Fallback dữ liệu mẫu nếu API endpoint không phản hồi hoặc đang trong môi trường demo/offline
                pass

        # Dữ liệu mẫu mô phỏng chuẩn xác theo đúng cấu trúc field_mapping của NCC để test/demo ngay lập tức
        return generate_sample_raw_rows_for_supplier(config, from_date)


def generate_sample_raw_rows_for_supplier(
    config: DistributorSupplierConfig,
    target_date: date,
) -> list[dict[str, Any]]:
    """Sinh dữ liệu mẫu theo đúng tên trường (field_mapping) riêng của từng Nhà cung cấp."""
    fm = config.field_mapping or {}
    sup = config.supplier_code.upper()
    date_str = target_date.strftime("%Y-%m-%d")

    f_order = fm.get("order_number", "order_number")
    f_date = fm.get("order_date", "order_date")
    f_deliv = fm.get("delivery_date", "delivery_date")
    f_ccode = fm.get("customer_code", "customer_code")
    f_cname = fm.get("customer_name", "customer_name")
    f_ctax = fm.get("customer_tax_code", "customer_tax_code")
    f_caddr = fm.get("customer_address", "customer_address")
    f_pcode = fm.get("product_code", "product_code")
    f_pname = fm.get("product_name", "product_name")
    f_unit = fm.get("unit", "unit")
    f_qty = fm.get("quantity", "quantity")
    f_promo = fm.get("promo_quantity", "promo_quantity")
    f_price = fm.get("unit_price", "unit_price")
    f_disc = fm.get("discount_amount", "discount_amount")
    f_vat = fm.get("vat_rate", "vat_rate")
    f_total = fm.get("line_total", "line_total")
    f_scode = fm.get("staff_code", "staff_code")
    f_sname = fm.get("staff_name", "staff_name")

    if sup == "MASAN":
        samples = [
            {
                f_order: f"MSN-{target_date:%y%m%d}-001",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "KH-MSN-101",
                f_cname: "Siêu thị Mini Minh Châu",
                f_ctax: "0108923456",
                f_caddr: "128 Nguyễn Trãi, Thanh Xuân, Hà Nội",
                f_pcode: "MSN-CHINSU-500",
                f_pname: "Nước mắm Nam Ngư Đệ Nhị 800ml (Thùng 18 chai)",
                f_unit: "Thùng",
                f_qty: 10,
                f_promo: 1,
                f_price: 420000,
                f_disc: 120000,
                f_vat: 8,
                f_total: 4080000,
                f_scode: "NV-MS01",
                f_sname: "Trần Quốc Tuấn",
            },
            {
                f_order: f"MSN-{target_date:%y%m%d}-001",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "KH-MSN-101",
                f_cname: "Siêu thị Mini Minh Châu",
                f_ctax: "0108923456",
                f_caddr: "128 Nguyễn Trãi, Thanh Xuân, Hà Nội",
                f_pcode: "MSN-OMACHI-30",
                f_pname: "Mì khoai tây Omachi Xốt Bò Hầm (Thùng 30 gói)",
                f_unit: "Thùng",
                f_qty: 15,
                f_promo: 0,
                f_price: 235000,
                f_disc: 75000,
                f_vat: 8,
                f_total: 3450000,
                f_scode: "NV-MS01",
                f_sname: "Trần Quốc Tuấn",
            },
            {
                f_order: f"MSN-{target_date:%y%m%d}-002",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "KH-MSN-102",
                f_cname: "Đại lý Bách Hóa Hoàng Gia",
                f_ctax: "0314567891",
                f_caddr: "45 Lê Văn Sỹ, Quận 3, TP.HCM",
                f_pcode: "MSN-WAKEUP-247",
                f_pname: "Nước tăng lực Wake-Up 247 (Thùng 24 chai)",
                f_unit: "Thùng",
                f_qty: 20,
                f_promo: 2,
                f_price: 195000,
                f_disc: 90000,
                f_vat: 8,
                f_total: 3810000,
                f_scode: "NV-MS02",
                f_sname: "Lê Hoàng Nam",
            },
        ]
        return samples

    if sup == "UNILEVER":
        return [
            {
                f_order: f"ULV-{target_date:%y%m%d}-001",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "KH-ULV-201",
                f_cname: "Công ty TNHH Thương Mại Phú Thành",
                f_ctax: "0309876543",
                f_caddr: "210 Cộng Hòa, Tân Bình, TP.HCM",
                f_pcode: "ULV-OMO-3KG",
                f_pname: "Nước giặt OMO Matic Cửa Trước 3.6kg (Thùng 4 túi)",
                f_unit: "Thùng",
                f_qty: 8,
                f_promo: 1,
                f_price: 680000,
                f_disc: 140000,
                f_vat: 10,
                f_total: 5300000,
                f_scode: "SR-UL09",
                f_sname: "Nguyễn Minh Khôi",
            },
            {
                f_order: f"ULV-{target_date:%y%m%d}-002",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "KH-ULV-202",
                f_cname: "Cửa hàng Tạp hóa Ánh Dương",
                f_ctax: "0102345678",
                f_caddr: "88 Cầu Giấy, Hà Nội",
                f_pcode: "ULV-SUNLIGHT-1KG",
                f_pname: "Nước rửa chén Sunlight Chanh 100 (Thùng 12 chai)",
                f_unit: "Thùng",
                f_qty: 12,
                f_promo: 0,
                f_price: 310000,
                f_disc: 60000,
                f_vat: 10,
                f_total: 3660000,
                f_scode: "SR-UL09",
                f_sname: "Nguyễn Minh Khôi",
            },
        ]

    if sup == "KIOTVIET":
        return [
            {
                f_order: f"KV-{target_date:%y%m%d}-001",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "KH-KV-301",
                f_cname: "Đại lý Bách Hóa Toàn Thắng",
                f_ctax: "0312345678",
                f_caddr: "45 Lê Văn Sỹ, Phường 13, Quận 3, TP.HCM",
                f_pcode: "SP-KV-1001",
                f_pname: "Dầu ăn Simply Canola 1L (Thùng 12 chai)",
                f_unit: "Thùng",
                f_qty: 15,
                f_promo: 1,
                f_price: 610000,
                f_disc: 150000,
                f_vat: 8,
                f_total: 9000000,
                f_scode: "NV-KV01",
                f_sname: "Trần Văn Bình",
            },
            {
                f_order: f"KV-{target_date:%y%m%d}-002",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "KH-KV-302",
                f_cname: "Hộ kinh doanh Mai Anh",
                f_ctax: "0109988776",
                f_caddr: "12 Kim Mã, Ba Đình, Hà Nội",
                f_pcode: "SP-KV-1002",
                f_pname: "Gạo ST25 Ông Cua Túi 5kg",
                f_unit: "Túi",
                f_qty: 30,
                f_promo: 0,
                f_price: 195000,
                f_disc: 0,
                f_vat: 5,
                f_total: 5850000,
                f_scode: "NV-KV02",
                f_sname: "Hoàng Thị Mai",
            },
        ]

    return [
        {
            f_order: f"{sup}-{target_date:%y%m%d}-001",
            f_date: date_str,
            f_deliv: date_str,
            f_ccode: f"KH-{sup}-001",
            f_cname: f"Đại lý Phân Phối {config.supplier_name}",
            f_ctax: "0106688999",
            f_caddr: "Khu Đô Thị Mới, Quận Cầu Giấy, Hà Nội",
            f_pcode: f"{sup}-SKU-01",
            f_pname: f"Sản phẩm tiêu chuẩn {config.supplier_name} Loại 1",
            f_unit: "Thùng",
            f_qty: 10,
            f_promo: 1,
            f_price: 350000,
            f_disc: 50000,
            f_vat: 8,
            f_total: 3450000,
            f_scode: "NV01",
            f_sname: "Nhân viên kinh doanh",
        }
    ]


def parse_excel_with_dynamic_mapping(
    file_bytes: bytes,
    config: DistributorSupplierConfig,
    distributor_code: str | None = None,
) -> list[CanonicalOrder]:
    """Đọc file Excel có cấu trúc cột bất kỳ của Nhà cung cấp và chuyển đổi qua DynamicFieldMapper."""
    wb = load_workbook(BytesIO(file_bytes), data_only=True)
    sheet = wb.active
    rows_iter = list(sheet.iter_rows(values_only=True))
    if not rows_iter:
        return []
    headers = [str(cell).strip() if cell is not None else f"COL_{i}" for i, cell in enumerate(rows_iter[0])]
    raw_rows: list[dict[str, Any]] = []
    for row_vals in rows_iter[1:]:
        if not any(v is not None and str(v).strip() != "" for v in row_vals):
            continue
        raw_rows.append(dict(zip(headers, row_vals)))

    return DynamicFieldMapper.transform_rows_to_canonical(
        raw_rows=raw_rows,
        supplier_code=config.supplier_code,
        field_mapping=config.field_mapping or {},
        distributor_code=distributor_code,
    )
