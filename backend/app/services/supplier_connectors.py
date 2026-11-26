from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
import hashlib
from io import BytesIO
import time
from typing import Any
import httpx
from openpyxl import load_workbook
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.multi_tenant_invoice import DistributorSupplierConfig
from app.models.vinamilk import VinamilkOrderSnapshot
from app.services.vinamilk_customer_code import normalize_vinamilk_customer_code
from app.services.supplier_secrets import decrypt_supplier_secret, encrypt_supplier_secret


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
    promotion_code: str | None = None
    promotion_name: str | None = None


class CanonicalOrder(BaseModel):
    """Mô hình Đơn hàng chuẩn hóa duy nhất (Canonical Order Model - CDM)."""

    supplier_code: str
    supplier_name: str | None = None
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
    order_discount: float = 0.0
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
            "supplier_name": "Nhà cung cấp",
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
        "supplier_name": "KiotViet (Web API / Hóa đơn bán hàng)",
        "connector_type": "REST_API",
        "api_endpoint_url": "https://api-man1.kiotviet.vn/api/invoices?format=json&$top=15",
        "auth_type": "BEARER_TOKEN",
        "field_mapping": {
            "order_number": "Code",
            "order_date": "PurchaseDate",
            "delivery_date": "CreatedDate",
            "customer_code": "CustomerCode",
            "customer_name": "CustomerName",
            "customer_tax_code": "CustomerTaxCode",
            "customer_address": "CustomerAddress",
            "product_code": "ProductCode",
            "product_name": "ProductName",
            "unit": "Unit",
            "quantity": "Quantity",
            "promo_quantity": "bonusQuantity",
            "unit_price": "Price",
            "discount_amount": "Discount",
            "vat_rate": "Tax",
            "line_total": "SubTotal",
            "staff_code": "SoldById",
            "staff_name": "SoldByGivenName",
        },
    },
    "NAZZY": {
        "supplier_name": "DMS Nazzy (NPP Mai Gold)",
        "connector_type": "REST_API",
        "api_endpoint_url": "http://dms21.nazzy.vn/handler/BillsHandler.ashx",
        "auth_type": "COOKIE",
        "field_mapping": {
            "order_number": "Code",
            "order_date": "BillsDate",
            "delivery_date": "CreateDate",
            "supplier_name": "GroupName",
            "customer_code": "CustomerCode",
            "customer_name": "CustomerName",
            "customer_tax_code": "CustomerTaxCode",
            "customer_address": "Address",
            "product_code": "ProductCode",
            "product_name": "ProductName",
            "unit": "UnitName",
            "quantity": "Amount",
            "promo_quantity": "promo_quantity",
            "unit_price": "PriceNow",
            "discount_amount": "Discount",
            "order_discount": "OrderDiscount",
            "vat_rate": "TaxPercent",
            "line_total": "TotalPrice",
            "staff_code": "SaleEmployeeCode",
            "staff_name": "SaleEmployeeName",
            "promotion_code": "PromotionCode",
            "promotion_name": "PromotionName",
        },
    },
}


def parse_curl_command(curl_str: str) -> dict[str, Any]:
    """Tự động phân tích lệnh bash cURL của Nazzy DMS hoặc NCC bất kỳ để lấy URL, Headers, Cookies và Query Params."""
    import re
    import urllib.parse

    result: dict[str, Any] = {
        "url": "",
        "headers": {},
        "cookies": "",
        "cookies_dict": {},
        "params": {},
    }
    cleaned = curl_str.replace("\\\r\n", " ").replace("\\\n", " ").strip()

    # 1. Trích xuất URL
    url_match = re.search(r"--url\s+['\"]([^'\"]+)['\"]", cleaned)
    if not url_match:
        url_match = re.search(r"curl\s+['\"]([^'\"]+)['\"]", cleaned)
    if not url_match:
        url_match = re.search(r"curl\s+([^\s]+)", cleaned)
    if url_match:
        full_url = url_match.group(1).strip()
        if "?" in full_url:
            base_url, query_str = full_url.split("?", 1)
            result["url"] = base_url
            parsed_params = urllib.parse.parse_qs(query_str)
            for k, v in parsed_params.items():
                result["params"][k] = v[0] if len(v) == 1 else v
        else:
            result["url"] = full_url

    # 2. Trích xuất Headers: -H 'Key: Value'
    headers_matches = re.findall(r"-H\s+['\"]([^'\"]+)['\"]", cleaned)
    for h in headers_matches:
        if ":" in h:
            k, v = h.split(":", 1)
            clean_k = k.strip()
            clean_v = v.strip()
            result["headers"][clean_k] = clean_v
            if clean_k.lower() == "cookie":
                result["cookies"] = clean_v

    # 3. Trích xuất Cookies từ -b '...'
    cookie_match = re.search(r"-b\s+['\"]([^'\"]+)['\"]", cleaned)
    if cookie_match:
        result["cookies"] = cookie_match.group(1).strip()

    if result["cookies"]:
        for part in result["cookies"].split(";"):
            if "=" in part:
                ck, cv = part.strip().split("=", 1)
                result["cookies_dict"][ck.strip()] = cv.strip()

    return result


def _extract_value(row: dict[str, Any], configured_key: str | None, fallback_keys: tuple[str, ...] = ()) -> Any:
    if configured_key:
        ck = configured_key.strip()
        candidates = [ck, ck.lower(), ck.upper(), ck.capitalize(), ck[:1].upper() + ck[1:]]
        for candidate in candidates:
            if candidate in row and row[candidate] is not None and str(row[candidate]).strip() != "":
                return row[candidate]
        # Hỗ trợ nested key dạng "customer.code" hoặc "Branch.Name"
        if "." in ck:
            cursor: Any = row
            for part in ck.split("."):
                if isinstance(cursor, dict):
                    matched_k = next((k for k in cursor if k.lower() == part.lower()), None)
                    cursor = cursor[matched_k] if matched_k else None
                else:
                    cursor = None
                    break
            if cursor is not None and str(cursor).strip() != "":
                return cursor
        # Case-insensitive direct match
        ck_lower = ck.lower()
        for k, v in row.items():
            if k.lower() == ck_lower and v is not None and str(v).strip() != "":
                return v
    for key in fallback_keys:
        if key in row and row[key] is not None and str(row[key]).strip() != "":
            return row[key]
        key_lower = key.lower()
        for k, v in row.items():
            if k.lower() == key_lower and v is not None and str(v).strip() != "":
                return v
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
        # Hỗ trợ định dạng ASP.NET JSON Date: /Date(1763596800000)/ hoặc /Date(1763596800000+0700)/
        if text.startswith("/Date(") and text.endswith(")/"):
            import re
            m = re.search(r"-?\d+", text)
            if m:
                try:
                    ms = int(m.group(0))
                    return (datetime.utcfromtimestamp(ms / 1000.0) + timedelta(hours=7)).date()
                except (ValueError, OSError, OverflowError):
                    pass
        for fmt in (
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%d-%m-%Y",
            "%Y/%m/%d",
            "%d/%m/%Y %H:%M:%S",
            "%d/%m/%Y %H:%M",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S",
            "%Y/%m/%d %H:%M:%S",
        ):
            try:
                return datetime.strptime(text[:19], fmt).date()
            except ValueError:
                continue
    return fallback or datetime.utcnow().date()


def fetch_vinamilk_orders(
    config: DistributorSupplierConfig,
    from_date: date,
    to_date: date,
    *,
    progress_cb: Any = None,
) -> list[dict[str, Any]]:
    """Fetch Vinamilk DMS orders using its authenticated Excel-export flow."""
    from scripts.vinamilk_login import login_and_get_cookie

    def _report(msg: str, count: int = 0) -> None:
        if callable(progress_cb):
            try:
                progress_cb(msg, count)
            except Exception:
                pass

    endpoint = "https://vinamilk.dmsone.vn/sale-product/search-sale/export-excel"
    cookie = decrypt_supplier_secret(config.session_cookie)
    config.session_cookie = encrypt_supplier_secret(config.session_cookie)
    config.encrypted_secret = encrypt_supplier_secret(config.encrypted_secret)
    if not cookie:
        username = (config.username or "").strip()
        password = decrypt_supplier_secret(config.encrypted_secret)
        if not username or not password:
            raise RuntimeError(
                "Thiếu tài khoản hoặc mật khẩu Vinamilk DMS trong cấu hình nguồn. "
                "Vui lòng cập nhật thông tin đăng nhập rồi thử lại."
            )
        _report("Đang đăng nhập cổng Vinamilk DMS...")
        cookie = login_and_get_cookie(username, password)

    from_date_text = from_date.strftime("%d/%m/%Y")
    to_date_text = to_date.strftime("%d/%m/%Y")
    export_form = {
        "orderNumber": "",
        "refOrderNumber": "",
        "fromDate": from_date_text,
        "toDate": to_date_text,
        "deliveryDate": "",
        "customerCode": "",
        "customerName": "",
        "orderSource": "0",
        "priorityCode": "-1",
        "csvStatus": "",
        "xmlStatus": "",
        "saleStaff": "",
        "deliveryStaff": "",
        "orderType": "IN",
        "saleOrderType": "-1",
        "reportCode": "1790085269000",
        "reportFormId": "",
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://vinamilk.dmsone.vn/sale-product/search-sale/info",
        "Origin": "https://vinamilk.dmsone.vn",
    }

    def relogin() -> str:
        username = (config.username or "").strip()
        password = decrypt_supplier_secret(config.encrypted_secret)
        if not username or not password:
            raise RuntimeError(
                "Phiên đăng nhập Vinamilk đã hết hạn; cấu hình chưa có đủ "
                "tài khoản/mật khẩu để đăng nhập lại."
            )
        _report("Phiên đăng nhập hết hạn, đang đăng nhập lại Vinamilk DMS...")
        refreshed_cookie = login_and_get_cookie(username, password)
        config.session_cookie = encrypt_supplier_secret(refreshed_cookie)
        return refreshed_cookie

    def parse_workbook(content: bytes) -> list[dict[str, Any]]:
        _report("Đang đọc & chuẩn hóa file Excel đơn hàng Vinamilk...")
        try:
            workbook = load_workbook(BytesIO(content), data_only=True)
        except Exception as exc:
            raise RuntimeError("Vinamilk trả về file Excel không hợp lệ.") from exc
        worksheet = workbook.active
        column_names = [cell.value for cell in worksheet[1]]
        rows: list[dict[str, Any]] = []
        for values in worksheet.iter_rows(min_row=2, values_only=True):
            row = dict(zip(column_names, values))
            if not row.get("Số đơn hàng"):
                continue
            rows.append(
                {
                    key: value.isoformat() if hasattr(value, "isoformat") else value
                    for key, value in row.items()
                }
            )
        return rows

    vinamilk_timeout = httpx.Timeout(connect=15.0, read=45.0, write=15.0, pool=15.0)
    with httpx.Client(timeout=vinamilk_timeout, headers=headers, follow_redirects=True) as client:
        max_attempts = 3
        for attempt in range(max_attempts):
            cookie_values = {
                part.split("=", 1)[0].strip(): part.split("=", 1)[1].strip()
                for part in cookie.split(";")
                if "=" in part and part.split("=", 1)[0].strip()
            }
            client.cookies.clear()
            client.cookies.update(cookie_values)
            _report(
                f"Đang yêu cầu Vinamilk DMS xuất đơn ({from_date_text} → {to_date_text})..."
                if attempt == 0
                else f"Đang thử xuất lại đơn Vinamilk ({from_date_text} → {to_date_text})..."
            )
            try:
                response = client.post(endpoint, data=export_form)
            except httpx.TimeoutException as exc:
                raise RuntimeError(
                    "Hết thời gian chờ phản hồi từ Vinamilk DMS khi xuất đơn hàng (timeout). "
                    "Vui lòng thử lại hoặc thu hẹp khoảng ngày."
                ) from exc
            except httpx.HTTPError as exc:
                raise RuntimeError(f"Lỗi kết nối mạng tới Vinamilk DMS: {exc}") from exc
            response_headers = getattr(response, "headers", {})
            content_type = response_headers.get("content-type", "").lower()
            needs_login = (
                response.status_code in (401, 403)
                or response_headers.get("requires_auth") == "1"
                or "text/html" in content_type
                or "/login" in str(getattr(response, "url", "")).lower()
            )
            if needs_login and attempt < max_attempts - 1:
                cookie = relogin()
                time.sleep(0.25 * (attempt + 1))
                continue
            if response.status_code != 200:
                raise RuntimeError(
                    f"Vinamilk DMS trả về HTTP {response.status_code} khi xuất đơn hàng."
                )
            if response.content.startswith(b"PK\x03\x04"):
                config.session_cookie = encrypt_supplier_secret(cookie)
                return parse_workbook(response.content)

            try:
                export_result = response.json()
            except ValueError as exc:
                if attempt < max_attempts - 1:
                    cookie = relogin()
                    time.sleep(0.25 * (attempt + 1))
                    continue
                response_text = getattr(response, "text", "")
                preview = " ".join(response_text[:160].split())
                raise RuntimeError(
                    "Vinamilk DMS không trả về JSON hoặc file Excel hợp lệ "
                    f"(Content-Type: {content_type or 'không xác định'}, "
                    f"preview: {preview or 'rỗng'}) sau {max_attempts} lần thử."
                ) from exc
            if not isinstance(export_result, dict):
                raise RuntimeError("Vinamilk DMS trả về cấu trúc phản hồi không hợp lệ.")
            if export_result.get("hasData") is False and not export_result.get("path"):
                config.session_cookie = encrypt_supplier_secret(cookie)
                return []
            file_path = export_result.get("path")
            if not file_path:
                raise RuntimeError("Vinamilk DMS không cung cấp đường dẫn tải file đơn hàng.")

            file_url = (
                file_path
                if str(file_path).startswith("http")
                else f"https://vinamilk.dmsone.vn{file_path}"
            )
            _report("Đang tải file Excel đơn hàng từ Vinamilk DMS...")
            try:
                download_response = client.get(file_url)
            except httpx.TimeoutException as exc:
                raise RuntimeError(
                    "Hết thời gian tải file Excel từ Vinamilk DMS (timeout)."
                ) from exc
            except httpx.HTTPError as exc:
                raise RuntimeError(f"Lỗi mạng khi tải file từ Vinamilk DMS: {exc}") from exc
            if download_response.status_code != 200:
                raise RuntimeError(
                    "Không thể tải file đơn hàng từ Vinamilk DMS "
                    f"(HTTP {download_response.status_code})."
                )
            config.session_cookie = encrypt_supplier_secret(cookie)
            return parse_workbook(download_response.content)

    raise RuntimeError("Không thể tạo phiên đăng nhập hợp lệ với Vinamilk DMS.")


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
                    ("orderNumber", "Code", "so_don_hang", "orderNo", "DocNumber", "Số đơn hàng", "order_code"),
                )
                or f"{supplier_code}-ORD-{idx:04d}"
            ).strip()

            order_date = _to_date(
                _extract_value(
                    row,
                    field_mapping.get("order_date"),
                    ("orderDate", "BillsDate", "CreateDate", "ngay_dat", "DocDate", "Ngày đơn hàng", "created_at"),
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
            raw_customer_code = str(
                _extract_value(
                    row,
                    field_mapping.get("customer_code"),
                    ("customerCode", "ma_khach_hang", "outletCode", "CustID", "Mã KH"),
                )
                or f"KH-{supplier_code}-001"
            ).strip()
            customer_code = normalize_vinamilk_customer_code(raw_customer_code, supplier_code)
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

            supplier_name = str(
                _extract_value(
                    row,
                    field_mapping.get("supplier_name"),
                    ("supplierName", "ten_nha_cung_cap", "supplier", "Nhà cung cấp", "NCC"),
                )
                or supplier_code
            ).strip()

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
            raw_unit = _extract_value(
                row,
                field_mapping.get("unit"),
                ("unit", "don_vi_tinh", "uom", "Unit", "ĐVT"),
            )
            is_discount_only_line = (
                product_code.upper() == "CHIETKHAU"
                or product_name.casefold() in ("chiết khấu", "chiet khau")
            )
            unit = str(raw_unit).strip() if raw_unit is not None and str(raw_unit).strip() else ("" if is_discount_only_line else "Thùng")
            quantity = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("quantity"),
                    ("quantity", "Amount", "so_luong_ban", "billedQty", "OrderQty", "Số lượng"),
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
                    ("unitPrice", "PriceNow", "don_gia_chua_vat", "basePrice", "UnitPrice", "Giá bán", "Đơn giá"),
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
            order_discount = _to_float(
                _extract_value(
                    row,
                    field_mapping.get("order_discount"),
                    ("orderDiscount", "DiscountPromotion", "Chiết khấu đơn hàng"),
                ),
                0.0,
            )
            promotion_code = str(
                _extract_value(
                    row,
                    field_mapping.get("promotion_code"),
                    ("PromotionCode", "ProgramCode", "promotionCode", "Mã CTKM"),
                )
                or ""
            ).strip() or None
            promotion_name = str(
                _extract_value(
                    row,
                    field_mapping.get("promotion_name"),
                    ("PromotionName", "ProgramName", "promotionName", "Tên CTKM", "Tên Chương trình"),
                )
                or ""
            ).strip() or None

            if order_number not in orders_by_number:
                orders_by_number[order_number] = CanonicalOrder(
                    supplier_code=supplier_code.upper(),
                    supplier_name=supplier_name,
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
                    order_discount=order_discount,
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
                    promotion_code=promotion_code,
                    promotion_name=promotion_name,
                )
            )

        return list(orders_by_number.values())


def persist_canonical_orders_to_snapshots(
    db: Session,
    canonical_orders: list[CanonicalOrder],
    distributor_code: str | None = None,
    return_stats: bool = False,
) -> int | dict[str, Any]:
    """Lưu danh sách CanonicalOrder vào bảng VinamilkOrderSnapshot với cấu trúc chuẩn hóa
    để toàn bộ màn hình Đơn Hàng DMS, Tách/Gộp đơn và Xuất Hóa Đơn hoạt động đồng nhất.

    Tối ưu batch-prefetch theo remote_key (chunk 1000) để 5.000+ dòng chỉ mất ~1-2 giây
    thay vì N+1 SELECT từng dòng.
    """
    saved_rows = 0
    new_orders: set[str] = set()
    updated_orders: set[str] = set()
    new_lines = 0
    updated_lines = 0
    unchanged_lines = 0
    now_utc = datetime.utcnow()

    # Bước 1: Chuẩn bị toàn bộ dòng trong RAM (tránh lặp trùng remote_key trong cùng batch)
    prepared: dict[str, tuple[CanonicalOrder, CanonicalOrderItem, dict[str, Any]]] = {}
    valid_keys_by_order: dict[tuple[str, str], set[str]] = {}
    for order in canonical_orders:
        order_date_str = order.order_date.strftime("%d/%m/%Y")
        delivery_date_str = (order.delivery_date or order.order_date).strftime("%d/%m/%Y")
        order_proc_status = f"NCC:{order.supplier_code}"
        order_key_bucket = valid_keys_by_order.setdefault((order.order_number, order_proc_status), set())
        for line_idx, item in enumerate(order.items, start=1):
            key_seed = f"{distributor_code or 'DEFAULT'}|{order.supplier_code}|{order.order_number}|{item.product_code}|{line_idx}"
            remote_key = hashlib.sha1(key_seed.encode("utf-8")).hexdigest()
            order_key_bucket.add(remote_key)

            subtotal_val = round(item.quantity * item.unit_price)
            net_val = round(item.line_total if item.line_total > 0 else max(0.0, subtotal_val - item.discount_amount))

            normalized_payload: dict[str, Any] = {
                "Số đơn hàng": order.order_number,
                "Ngày tạo": order_date_str,
                "Ngày đơn hàng": order_date_str,
                "orderDate": order_date_str,
                "Ngày giao": delivery_date_str,
                "Ngày giao hàng": delivery_date_str,
                "deliveryDate": delivery_date_str,
                "Mã NPP": distributor_code or "",
                "Mã KH": order.customer_code,
                "Tên KH": order.customer_name,
                "Mã số thuế": order.customer_tax_code or "",
                "Địa chỉ": order.customer_address or "",
                "Mã sản phẩm": item.product_code,
                "Tên sản phẩm": item.product_name,
                "ĐVT": item.unit,
                "Số lượng": item.quantity,
                "Số lượng KM": item.promo_quantity,
                "Mã CTKM": item.promotion_code or "",
                "Tên CTKM": item.promotion_name or "",
                "Giá bán": item.unit_price,
                "Giá trị": subtotal_val,
                "Số tiền CK": item.discount_amount,
                "Chiết khấu đơn hàng": order.order_discount,
                "Thành tiền": net_val,
                "Thuế suất": item.vat_rate,
                "Mã NVBH": order.staff_code or "",
                "Tên NVBH": order.staff_name or "",
                "Trạng thái": order.status,
                "Nhà cung cấp": order.supplier_name or order.supplier_code,
                "Nguồn đồng bộ": order.supplier_code,
            }
            prepared[remote_key] = (order, item, normalized_payload)

    # Bước 2: Batch-prefetch toàn bộ bản ghi đã có trong DB theo từng lô 1000 khóa
    existing_by_key: dict[str, VinamilkOrderSnapshot] = {}
    all_keys = list(prepared.keys())
    chunk_size = 1000
    for start in range(0, len(all_keys), chunk_size):
        chunk = all_keys[start : start + chunk_size]
        rows = db.scalars(
            select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.remote_key.in_(chunk))
        ).all()
        for row in rows:
            existing_by_key[row.remote_key] = row

    # Bước 3: Đối soát trong RAM & gom danh sách insert mới
    to_insert: list[VinamilkOrderSnapshot] = []
    for remote_key, (order, item, normalized_payload) in prepared.items():
        existing = existing_by_key.get(remote_key)
        new_delivery = order.delivery_date or order.order_date
        if existing is None:
            to_insert.append(
                VinamilkOrderSnapshot(
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
                    delivery_date=new_delivery,
                    synced_from=order.order_date,
                    synced_to=order.order_date,
                    synced_at=now_utc,
                    raw_payload=normalized_payload,
                )
            )
            new_orders.add(order.order_number)
            new_lines += 1
            saved_rows += 1
        else:
            old_payload = existing.raw_payload if isinstance(existing.raw_payload, dict) else {}
            changed = (
                (existing.customer_code or "") != (order.customer_code or "")
                or (existing.customer_name or "") != (order.customer_name or "")
                or (existing.product_code or "") != (item.product_code or "")
                or (existing.product_name or "") != (item.product_name or "")
                or (existing.status or "") != (order.status or "")
                or existing.order_created_date != order.order_date
                or existing.delivery_date != new_delivery
                or old_payload != normalized_payload
            )
            if changed:
                existing.customer_code = order.customer_code
                existing.customer_name = order.customer_name
                existing.product_code = item.product_code
                existing.product_name = item.product_name
                existing.status = order.status
                existing.order_created_date = order.order_date
                existing.delivery_date = new_delivery
                existing.processing_status = f"NCC:{order.supplier_code}"
                existing.performed_by = distributor_code
                existing.synced_at = now_utc
                existing.raw_payload = normalized_payload
                if order.order_number not in new_orders:
                    updated_orders.add(order.order_number)
                updated_lines += 1
                saved_rows += 1
            else:
                unchanged_lines += 1

    if to_insert:
        db.add_all(to_insert)

    # Bước 3b: Dọn các dòng cũ dư thừa của các đơn vừa đồng bộ lại (tránh trùng dòng khi thay đổi cấu trúc/thứ tự dòng)
    deleted_stale_lines = 0
    if valid_keys_by_order:
        from sqlalchemy import delete as sa_delete

        synced_order_numbers = sorted({ord_num for ord_num, _ in valid_keys_by_order})
        stale_ids: list[int] = []
        for start in range(0, len(synced_order_numbers), 500):
            ord_chunk = synced_order_numbers[start : start + 500]
            stmt = select(
                VinamilkOrderSnapshot.id,
                VinamilkOrderSnapshot.order_number,
                VinamilkOrderSnapshot.processing_status,
                VinamilkOrderSnapshot.remote_key,
            ).where(
                VinamilkOrderSnapshot.order_number.in_(ord_chunk),
                VinamilkOrderSnapshot.is_synthetic.is_(False),
            )
            if distributor_code:
                stmt = stmt.where(VinamilkOrderSnapshot.performed_by == distributor_code)
            for snap_id, snap_ord_num, snap_proc, snap_rkey in db.execute(stmt).all():
                expected_keys = valid_keys_by_order.get((snap_ord_num, snap_proc or ""))
                if expected_keys is not None and snap_rkey not in expected_keys:
                    stale_ids.append(snap_id)
        if stale_ids:
            for start in range(0, len(stale_ids), 1000):
                id_chunk = stale_ids[start : start + 1000]
                res_del = db.execute(
                    sa_delete(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.id.in_(id_chunk))
                )
                deleted_stale_lines += res_del.rowcount or len(id_chunk)

    if new_lines > 0 or updated_lines > 0 or deleted_stale_lines > 0:
        db.flush()
        db.commit()
        try:
            from app.crud.customer import sync_customers_from_snapshots
            from app.crud.product import sync_products_from_system_data
            sync_customers_from_snapshots(db, commit=True)
            sync_products_from_system_data(db, commit=True)
        except Exception:
            db.rollback()

    if return_stats:
        return {
            "saved_rows": saved_rows,
            "new_orders": len(new_orders),
            "updated_orders": len(updated_orders),
            "new_lines": new_lines,
            "updated_lines": updated_lines,
            "unchanged_lines": unchanged_lines,
        }
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


def nazzy_login_and_get_cookie(
    distributor_code: str,
    username: str,
    password: str,
    base_url: str = "http://dms21.nazzy.vn",
) -> str:
    """Tự động đăng nhập vào web Nazzy DMS (http://dms21.nazzy.vn) bằng HTTP thuần.
    Sử dụng Mã Doanh Nghiệp (txtDistributor), Mã Nhân Viên (txtCode) và Mật Khẩu (txtPassword).
    Trả về chuỗi Cookie phiên chứa ASP.NET_SessionId, ses_adminId, ses_disId..."""
    import re
    clean_base = base_url.rstrip("/").split("/handler")[0].split("/Pages")[0]
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    with httpx.Client(verify=False, timeout=20.0, follow_redirects=False) as client:
        # 1. GET trang chủ để lấy ASP.NET ViewState & Session Cookie ban đầu
        r_get = client.get(f"{clean_base}/", headers=headers)
        if r_get.status_code not in (200, 302):
            raise RuntimeError(f"Không thể kết nối tới máy chủ Nazzy DMS ({clean_base}): HTTP {r_get.status_code}")

        html = r_get.text
        vs_m = re.search(r'id="__VIEWSTATE"\s+value="([^"]+)"', html)
        vsg_m = re.search(r'id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"', html)
        ev_m = re.search(r'id="__EVENTVALIDATION"\s+value="([^"]+)"', html)

        viewstate = vs_m.group(1) if vs_m else ""
        viewstategen = vsg_m.group(1) if vsg_m else "C2EE9ABB"
        eventval = ev_m.group(1) if ev_m else ""

        # 2. POST form đăng nhập
        payload = {
            "__VIEWSTATE": viewstate,
            "__VIEWSTATEGENERATOR": viewstategen,
            "__EVENTVALIDATION": eventval,
            "txtDistributor": distributor_code.strip(),
            "txtCode": username.strip(),
            "txtPassword": password.strip(),
            "btnLogin": "Đăng nhập",
        }
        post_headers = {
            **headers,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": f"{clean_base}/",
            "Origin": clean_base,
        }
        r_post = client.post(f"{clean_base}/", data=payload, headers=post_headers)

        cookies = [f"{k}={v}" for k, v in client.cookies.items() if v]

        has_auth_cookie = any("ses_adminId" in c or "ses_disId" in c or "ses_adminName" in c for c in cookies)
        if r_post.status_code in (302, 301) or has_auth_cookie:
            return "; ".join(cookies)

        err_msg = ""
        msg_m = re.search(r'<span[^>]+id="[^"]*lbMessage[^"]*"[^>]*>(?:<font[^>]*>)?([^<]+)', r_post.text, re.IGNORECASE)
        if msg_m:
            err_msg = msg_m.group(1).strip()
        raise RuntimeError(err_msg or "Nazzy DMS từ chối đăng nhập. Vui lòng kiểm tra lại Mã DN, Mã NV và Mật khẩu.")


def fetch_nazzy_orders(
    config: DistributorSupplierConfig,
    from_date: date,
    to_date: date,
    *,
    strict: bool = False,
    progress_cb: Any = None,
    skip_existing_order_numbers: set[str] | None = None,
    existing_order_fingerprints: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Tự động đồng bộ đơn hàng từ DMS Nazzy (http://dms21.nazzy.vn) của NPP Mai Gold.
    Hỗ trợ tự động đăng nhập HTTP bằng Mã DN + Mã NV + Mật khẩu, phân trang, đa luồng
    dùng chung Keep-Alive pool, và báo tiến trình chi tiết theo thời gian thực."""
    def _report(stage: str, count: int = 0) -> None:
        if callable(progress_cb):
            try:
                progress_cb(stage, count)
            except Exception:
                pass

    raw_url = config.api_endpoint_url or "http://dms21.nazzy.vn/handler/BillsHandler.ashx"
    base_url = raw_url.split("?")[0].strip()

    req_cfg = config.request_config or {}
    dist_code = str(req_cfg.get("distributor_code") or req_cfg.get("distributorCode") or "").strip()
    clean_user = (config.username or "").strip()
    if "/" in clean_user:
        parts = clean_user.split("/", 1)
        if not dist_code:
            dist_code = parts[0].strip()
        clean_user = parts[1].strip()

    secret = decrypt_supplier_secret(config.encrypted_secret)
    cookie_str = decrypt_supplier_secret(config.session_cookie)
    config.encrypted_secret = encrypt_supplier_secret(secret)
    config.session_cookie = encrypt_supplier_secret(cookie_str)

    # Tự động đăng nhập qua HTTP nếu chưa có Cookie hoặc người dùng cập nhật mật khẩu mới
    if dist_code and clean_user and secret:
        _report("Đang đăng nhập máy chủ Nazzy DMS...", 0)
        try:
            new_cookie = nazzy_login_and_get_cookie(dist_code, clean_user, secret, base_url)
            cookie_str = new_cookie
            config.session_cookie = encrypt_supplier_secret(new_cookie)
        except Exception as login_exc:
            if not cookie_str and strict:
                raise RuntimeError(f"Đăng nhập Nazzy DMS thất bại: {login_exc}") from login_exc

    headers: dict[str, str] = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Content-Type": "application/json;charset=utf-8",
        "Pragma": "no-cache",
        "Referer": "http://dms21.nazzy.vn/Pages/Bills/OrderV2.aspx",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
        ),
        "X-Requested-With": "XMLHttpRequest",
    }
    cookies: dict[str, str] = {}
    if cookie_str:
        for part in cookie_str.split(";"):
            if "=" in part:
                ck, cv = part.strip().split("=", 1)
                cookies[ck.strip()] = cv.strip()

    req_cfg = config.request_config or {}
    group_id = str(
        req_cfg.get("groupId")
        or req_cfg.get("group_id")
        or "1124|1064|1058|1059|1061|1062|1063|1060|-1"
    )
    type_val = req_cfg.get("type", 4)
    status_val = req_cfg.get("status", 2)
    # Nazzy SQL Server xử lý nặng theo pageSize -> mặc định 100 đơn/trang (tự hạ về 50 nếu timeout)
    raw_ps = int(req_cfg.get("pageSize") or 100)
    page_size = min(150, max(50, raw_ps if raw_ps != 50 else 100))

    from_str = from_date.strftime("%Y/%m/%d")
    to_str = to_date.strftime("%Y/%m/%d")

    all_order_summaries: list[dict[str, Any]] = []
    seen_summary_ids: set[str] = set()

    http_limits = httpx.Limits(max_connections=8, max_keepalive_connections=8)
    list_timeout = httpx.Timeout(45.0, connect=10.0)
    detail_timeout = httpx.Timeout(25.0, connect=10.0)

    with httpx.Client(
        verify=False,
        timeout=list_timeout,
        limits=http_limits,
        follow_redirects=True,
    ) as client:
        class _NazzySessionExpiredError(RuntimeError):
            pass

        def _is_login_html(resp_obj: Any) -> bool:
            text_val = getattr(resp_obj, "text", None)
            if not isinstance(text_val, str):
                return False
            sample = text_val[:2000].lower()
            return ("<html" in sample or "<!doctype" in sample) and (
                "txtpassword" in sample or "btnlogin" in sample or "__viewstate" in sample
            )

        def _fetch_list_page(page_num: int, ps: int) -> tuple[int, list[dict[str, Any]]]:
            params = {
                "t": "GetBillsOrderGetListV5",
                "type": str(type_val),
                "code": "",
                "note": "",
                "typePayment": "-1",
                "groupId": group_id,
                "customer": "",
                "productId": "-1",
                "depotId": str(req_cfg.get("depotId", -1)),
                "dicDepot": str(req_cfg.get("dicDepot", -1)),
                "saleId": str(req_cfg.get("saleId", -1)),
                "status": str(status_val),
                "fromDate": from_str,
                "toDate": to_str,
                "currentPage": str(page_num),
                "pageSize": str(ps),
                "orderBy": "1",
                "_": str(int(datetime.utcnow().timestamp() * 1000)),
            }
            resp = client.get(base_url, params=params, headers=headers, cookies=cookies)
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code} khi lấy danh sách đơn Nazzy trang {page_num}.")
            if _is_login_html(resp):
                raise _NazzySessionExpiredError(
                    "Phiên đăng nhập Nazzy DMS đã hết hạn. Vui lòng kiểm tra Mã DN / Mã NV / Mật khẩu hoặc cập nhật Cookie mới."
                )
            try:
                data = resp.json()
            except Exception as json_exc:
                raise _NazzySessionExpiredError(
                    "Nazzy DMS trả về dữ liệu không phải JSON (có thể phiên đăng nhập đã hết hạn)."
                ) from json_exc
            if not isinstance(data, dict):
                raise RuntimeError("Dữ liệu trả về từ Nazzy không đúng định dạng.")
            items_block = data.get("Items")
            if not isinstance(items_block, dict):
                if data.get("IsLogin") is False or data.get("Status") in (-1, 401):
                    raise _NazzySessionExpiredError(
                        str(data.get("Message") or "Phiên đăng nhập Nazzy DMS đã hết hạn.")
                    )
                raise RuntimeError("Dữ liệu trả về từ Nazzy không có danh sách đơn hàng hợp lệ.")
            return int(items_block.get("TotalRecord") or 0), (items_block.get("Items") or [])

        # Tải danh sách tuần tự từng trang (tránh ASP.NET Session Lock trên IIS gây timeout khi gọi song song)
        total_records = 0
        current_page = 1
        relogged_once = False
        while True:
            _report(
                f"Đang tải danh sách đơn Nazzy trang {current_page} ({page_size} đơn/trang)...",
                len(all_order_summaries),
            )
            page_items: list[dict[str, Any]] = []
            try:
                page_total, page_items = _fetch_list_page(current_page, page_size)
                if page_total > 0:
                    total_records = page_total
            except _NazzySessionExpiredError as sess_exc:
                if not relogged_once and dist_code and clean_user and secret:
                    relogged_once = True
                    _report("Phiên Nazzy hết hạn — đang tự động đăng nhập lại...", len(all_order_summaries))
                    new_cookie = nazzy_login_and_get_cookie(dist_code, clean_user, secret, base_url)
                    config.session_cookie = encrypt_supplier_secret(new_cookie)
                    cookies.clear()
                    for part in new_cookie.split(";"):
                        if "=" in part:
                            ck, cv = part.strip().split("=", 1)
                            cookies[ck.strip()] = cv.strip()
                    continue
                if strict:
                    raise RuntimeError(str(sess_exc)) from sess_exc
                break
            except httpx.TimeoutException as exc:
                if page_size > 50:
                    page_size = 50
                    current_page = max(1, (len(all_order_summaries) // page_size) + 1)
                    _report(
                        f"Máy chủ Nazzy phản hồi chậm — tự động hạ xuống 50 đơn/trang (trang {current_page})...",
                        len(all_order_summaries),
                    )
                    continue
                if strict and not all_order_summaries:
                    raise RuntimeError(f"Không thể lấy danh sách đơn Nazzy: {exc}") from exc
                _report(f"Trang {current_page} Nazzy bị quá thời gian — dừng tải danh sách với {len(all_order_summaries)} đơn đã lấy.", len(all_order_summaries))
                break
            except Exception as exc:
                if strict and not all_order_summaries:
                    raise RuntimeError(f"Không thể lấy danh sách đơn Nazzy: {exc}") from exc
                break

            if not page_items:
                break

            for item in page_items:
                key = str(item.get("BillsDepotId") or item.get("Code") or len(seen_summary_ids))
                if key not in seen_summary_ids:
                    seen_summary_ids.add(key)
                    all_order_summaries.append(item)

            _report(
                f"Đã tải danh sách {len(all_order_summaries)}/{total_records or len(all_order_summaries)} đơn Nazzy...",
                len(all_order_summaries),
            )
            if total_records > 0 and len(all_order_summaries) >= total_records:
                break
            if total_records == 0 and len(page_items) < page_size:
                break
            current_page += 1
            if current_page > 30:
                break

        if not all_order_summaries:
            _report("Nazzy trả về 0 đơn hàng trong khoảng ngày đã chọn.", 0)
            return []

        # Lọc bỏ các đơn lịch sử (trước ngày to_date) đã có trong CSDL VÀ không đổi tổng tiền / khách hàng.
        # Nếu đơn cũ có thay đổi giá trị, chiết khấu hoặc khách hàng -> vẫn tự động tải lại chi tiết để cập nhật.
        summaries_to_fetch = all_order_summaries
        if existing_order_fingerprints or skip_existing_order_numbers:
            filtered: list[dict[str, Any]] = []
            skipped_count = 0
            changed_historical = 0
            for ord_sum in all_order_summaries:
                ord_code = str(ord_sum.get("Code") or "").strip()
                raw_dt = ord_sum.get("BillsDate") or ord_sum.get("CreateDate")
                ord_date = _to_date(raw_dt, fallback=to_date) if raw_dt else None
                is_historical = ord_date is not None and ord_date < to_date
                if ord_code and is_historical:
                    fp = existing_order_fingerprints.get(ord_code) if existing_order_fingerprints else None
                    if fp is not None:
                        remote_total = float(ord_sum.get("TotalPrice") or 0.0)
                        remote_cust = str(ord_sum.get("CustomerCode") or "").strip().upper()
                        db_total = float(fp.get("total_amount") or 0.0)
                        db_gross = float(fp.get("gross_amount") or 0.0)
                        db_cust = str(fp.get("customer_code") or "").strip().upper()
                        # Khớp tổng tiền (theo thành tiền hoặc tổng trước CK trong sai số làm tròn 10đ) và cùng mã KH
                        total_matches = (
                            abs(remote_total - db_total) <= 10.0
                            or abs(remote_total - db_gross) <= 10.0
                        )
                        cust_matches = (not remote_cust) or (not db_cust) or (remote_cust == db_cust)
                        if total_matches and cust_matches:
                            skipped_count += 1
                            continue
                        changed_historical += 1
                    elif skip_existing_order_numbers and ord_code in skip_existing_order_numbers:
                        skipped_count += 1
                        continue
                filtered.append(ord_sum)
            summaries_to_fetch = filtered
            if skipped_count > 0 or changed_historical > 0:
                extra = f" (phát hiện {changed_historical} đơn cũ thay đổi cần tải lại)" if changed_historical > 0 else ""
                _report(
                    f"Bỏ qua {skipped_count}/{len(all_order_summaries)} đơn lịch sử không đổi{extra} — tải chi tiết {len(summaries_to_fetch)} đơn...",
                    0,
                )

        if not summaries_to_fetch:
            return []

        total_orders = len(summaries_to_fetch)
        _report(f"Đang tải chi tiết 0/{total_orders} đơn Nazzy...", 0)

        # Dùng chung 1 httpx.Client Keep-Alive với 4 luồng vừa phải (tránh nghẽn ASP.NET Session Lock) + retry 1 lần
        def _fetch_order_detail(ord_sum: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
            depot_id = ord_sum.get("BillsDepotId")
            if not depot_id:
                return [], "Thiếu BillsDepotId"
            det_data: dict[str, Any] | None = None
            last_err: str | None = None
            for attempt in range(2):
                try:
                    r_det = client.get(
                        base_url,
                        params={"t": "BillsOrderGetInfo", "id": str(depot_id), "option": "0"},
                        headers=headers,
                        cookies=cookies,
                        timeout=detail_timeout,
                    )
                    if r_det.status_code != 200:
                        last_err = f"HTTP {r_det.status_code}"
                        continue
                    det_data = r_det.json()
                    last_err = None
                    break
                except Exception as exc:
                    last_err = str(exc)
                    if attempt == 0:
                        time.sleep(0.5)
            if not isinstance(det_data, dict):
                return [], last_err or "Phản hồi chi tiết rỗng"

            info = det_data.get("Info") or {}
            details = det_data.get("Details") or []
            promotions = det_data.get("Promotion") or []

            def _is_cash_discount_promo(p: dict[str, Any]) -> bool:
                prod_id = p.get("ProductId")
                if prod_id is not None:
                    try:
                        if int(prod_id) <= 0:
                            return True
                    except (TypeError, ValueError):
                        pass
                p_name = str(p.get("ProductName") or "").strip().casefold()
                return p_name in ("chiết khấu", "chiet khau")

            def _promo_cash_value(p: dict[str, Any]) -> float:
                for key in ("Price", "Amount", "PromotionAmount", "TotalPrice", "Discount"):
                    val = p.get(key)
                    if val is not None:
                        try:
                            num = float(val)
                            if num > 0:
                                return num
                        except (TypeError, ValueError):
                            pass
                return 0.0

            def _promo_program_name(p: dict[str, Any]) -> str:
                for key in ("PromotionName", "ProgramName", "PromotionTitle", "Title", "Name"):
                    val = str(p.get(key) or "").strip()
                    if val:
                        return val
                return ""

            def _promo_program_code(p: dict[str, Any]) -> str:
                for key in ("PromotionCode", "ProgramCode"):
                    val = str(p.get(key) or "").strip()
                    if val:
                        return val
                return ""

            cash_discount_promos: list[tuple[dict[str, Any], float]] = []
            for p in promotions:
                if _is_cash_discount_promo(p):
                    val = _promo_cash_value(p)
                    if val > 0:
                        cash_discount_promos.append((p, val))

            cash_discount_total = sum(val for _, val in cash_discount_promos)
            order_discount = float(info.get("DiscountPromotion") or cash_discount_total or 0.0)
            header_data = {
                "Code": info.get("Code") or ord_sum.get("Code"),
                "BillsDate": info.get("BillsDate") or ord_sum.get("BillsDate"),
                "CreateDate": info.get("CreateDate") or ord_sum.get("CreateDate"),
                "CustomerCode": str(info.get("CustomerCode") or ord_sum.get("CustomerCode") or "KH-NAZZY").strip(),
                "CustomerName": info.get("CustomerName") or ord_sum.get("CustomerName"),
                "CustomerTaxCode": info.get("CustomerTaxCode") or "",
                "Address": info.get("Address") or ord_sum.get("Address") or "",
                "Phone": info.get("Phone") or "",
                "GroupName": info.get("GroupName") or ord_sum.get("GroupName") or "NAZZY",
                "SaleEmployeeCode": info.get("SaleEmployeeCode") or "",
                "SaleEmployeeName": info.get("SaleEmployeeName") or "",
                "DictDepotName": info.get("DictDepotName") or ord_sum.get("DictDepotName") or "Kho Mai Gold",
                "DepotName": info.get("DepotName") or ord_sum.get("DepotName") or "",
                "OrderTotalPrice": float(info.get("TotalPrice") or ord_sum.get("TotalPrice") or 0.0),
                "OrderDiscount": order_discount,
            }

            order_rows: list[dict[str, Any]] = []

            # 1. Các dòng sản phẩm đặt hàng (kể cả dòng Trưng bày giữ nguyên như trên Nazzy)
            for line in details:
                line_price = float(line.get("TotalPrice") or 0.0)
                line_discount = float(line.get("Discount") or 0.0)

                order_rows.append({
                    **header_data,
                    "ProductCode": str(line.get("ProductCode") or f"SP-{line.get('ProductId')}").strip(),
                    "ProductName": line.get("ProductName") or "Sản phẩm Nazzy",
                    "UnitName": line.get("UnitName") or "Thùng",
                    "Amount": float(line.get("Amount") or 0.0),
                    "promo_quantity": 0.0,
                    "PriceNow": float(line.get("PriceNow") or line.get("Price") or 0.0),
                    "Discount": line_discount,
                    "TaxPercent": float(line.get("TaxPercent") or 8.0),
                    "TotalPrice": max(0.0, line_price - line_discount),
                    "PromotionCode": "",
                    "PromotionName": "",
                })

            # 2. Các dòng khuyến mại chiết khấu tiền -> tạo thành dòng riêng với sản phẩm là "Chiết khấu"
            if cash_discount_promos:
                for p, discount_val in cash_discount_promos:
                    order_rows.append({
                        **header_data,
                        "ProductCode": str(p.get("ProductCode") or "CHIETKHAU").strip(),
                        "ProductName": str(p.get("ProductName") or "Chiết khấu").strip(),
                        "UnitName": str(p.get("UnitName") or "").strip(),
                        "Amount": 0.0,
                        "promo_quantity": 0.0,
                        "PriceNow": 0.0,
                        "Discount": discount_val,
                        "TaxPercent": 0.0,
                        "TotalPrice": 0.0,
                        "PromotionCode": _promo_program_code(p),
                        "PromotionName": _promo_program_name(p),
                    })
            elif order_discount > 0:
                order_rows.append({
                    **header_data,
                    "ProductCode": "CHIETKHAU",
                    "ProductName": "Chiết khấu",
                    "UnitName": "",
                    "Amount": 0.0,
                    "promo_quantity": 0.0,
                    "PriceNow": 0.0,
                    "Discount": order_discount,
                    "TaxPercent": 0.0,
                    "TotalPrice": 0.0,
                    "PromotionCode": "",
                    "PromotionName": "",
                })

            # 3. Các dòng hàng tặng khuyến mại hiện vật (bỏ qua giá trị tham khảo ở cột Thành tiền -> luôn để 0đ)
            for p in promotions:
                if not _is_cash_discount_promo(p) and float(p.get("Amount") or p.get("PromotionAmount") or 0) > 0:
                    p_qty = float(p.get("Amount") or p.get("PromotionAmount") or 0)
                    order_rows.append({
                        **header_data,
                        "ProductCode": str(p.get("ProductCode") or f"KM-{p.get('ProductId')}").strip(),
                        "ProductName": f"{p.get('ProductName', 'Hàng khuyến mại')} (Hàng KM không thu tiền)",
                        "UnitName": p.get("UnitName") or "Hộp",
                        "Amount": 0.0,
                        "promo_quantity": p_qty,
                        "PriceNow": 0.0,
                        "Discount": 0.0,
                        "TaxPercent": float(p.get("PromotionVATPercent") or 0.0),
                        "TotalPrice": 0.0,
                        "PromotionCode": _promo_program_code(p),
                        "PromotionName": _promo_program_name(p),
                    })

            return order_rows, None

        flat_results: list[dict[str, Any]] = []
        completed_orders = 0
        failed_details = 0
        last_detail_err: str | None = None
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(_fetch_order_detail, item) for item in summaries_to_fetch]
            for f in as_completed(futures):
                completed_orders += 1
                res, err = f.result()
                if res:
                    flat_results.extend(res)
                elif err:
                    failed_details += 1
                    last_detail_err = err
                if completed_orders == total_orders or completed_orders % 10 == 0:
                    err_note = f", {failed_details} lỗi" if failed_details else ""
                    _report(
                        f"Đang tải chi tiết đơn Nazzy {completed_orders}/{total_orders} ({len(flat_results)} dòng{err_note})...",
                        len(flat_results),
                    )

        if total_orders > 0 and not flat_results and failed_details > 0 and strict:
            raise RuntimeError(
                f"Không tải được chi tiết đơn Nazzy ({failed_details}/{total_orders} đơn lỗi): {last_detail_err}"
            )

    return flat_results


class RestApiSupplierConnector(BaseSupplierConnector):
    """Connector kết nối REST API của các Nhà cung cấp (Nazzy, Masan, Unilever, KiotViet...)."""

    def fetch_raw_orders(
        self,
        config: DistributorSupplierConfig,
        from_date: date,
        to_date: date,
        *,
        allow_sample_fallback: bool = True,
        progress_cb: Any = None,
        skip_existing_order_numbers: set[str] | None = None,
        existing_order_fingerprints: dict[str, dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        is_vinamilk = (
            config.supplier_code.upper() == "VINAMILK"
            or "vinamilk.dmsone.vn" in (config.api_endpoint_url or "").lower()
        )
        if is_vinamilk:
            return fetch_vinamilk_orders(config, from_date, to_date, progress_cb=progress_cb)

        # Tự động ưu tiên xử lý chuyên biệt cho Nazzy DMS (NPP Mai Gold)
        is_nazzy = (
            config.supplier_code.upper() == "NAZZY"
            or "nazzy" in (config.api_endpoint_url or "").lower()
            or "BillsHandler" in (config.api_endpoint_url or "")
        )
        if is_nazzy:
            return fetch_nazzy_orders(
                config,
                from_date,
                to_date,
                strict=not allow_sample_fallback,
                progress_cb=progress_cb,
                skip_existing_order_numbers=skip_existing_order_numbers,
                existing_order_fingerprints=existing_order_fingerprints,
            )
        headers: dict[str, str] = {"Accept": "application/json"}
        secret = decrypt_supplier_secret(config.encrypted_secret)
        session_cookie = decrypt_supplier_secret(config.session_cookie)
        config.encrypted_secret = encrypt_supplier_secret(secret)
        config.session_cookie = encrypt_supplier_secret(session_cookie)
        clean_token = secret.replace("Bearer ", "").strip()

        if config.auth_type == "BEARER_TOKEN" and clean_token:
            headers["Authorization"] = f"Bearer {clean_token}"
        elif config.auth_type == "API_KEY" and secret:
            headers["X-API-Key"] = secret
        elif config.auth_type == "COOKIE" and (session_cookie or secret):
            if clean_token.startswith("eyJ"):
                headers["Authorization"] = f"Bearer {clean_token}"
            headers["Cookie"] = session_cookie or secret

        # Tự động tối ưu riêng cho KiotViet (Web API)
        is_kiotviet = config.supplier_code.upper() == "KIOTVIET" or "kiotviet" in (config.api_endpoint_url or "").lower()
        if is_kiotviet:
            retailer = "ctyquyanhna"
            clean_user = config.username or ""
            if "/" in clean_user:
                parts = clean_user.split("/", 1)
                retailer, clean_user = parts[0].strip(), parts[1].strip()
            elif "@" in clean_user and not clean_user.endswith(".com"):
                parts = clean_user.split("@", 1)
                clean_user, retailer = parts[0].strip(), parts[1].strip()

            headers["Retailer"] = retailer
            headers["Origin"] = f"https://{retailer}.kiotviet.vn"
            headers["Referer"] = f"https://{retailer}.kiotviet.vn/"
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

            if config.auth_type == "COOKIE" and not session_cookie and clean_user and secret and not secret.startswith("eyJ"):
                try:
                    cookie = kiotviet_login_and_get_cookie(retailer, clean_user, secret)
                    config.session_cookie = encrypt_supplier_secret(cookie)
                    headers["Cookie"] = cookie
                except Exception:
                    pass

        req_cfg = config.request_config or {}
        # Hỗ trợ tự động gọi API thật nếu có URL HTTP/HTTPS
        endpoint_url = config.api_endpoint_url
        if endpoint_url and "public.kiotapi.com" in endpoint_url and is_kiotviet:
            endpoint_url = "https://api-man1.kiotviet.vn/api/invoices?format=json&$top=30"

        if endpoint_url and (endpoint_url.startswith("http://") or endpoint_url.startswith("https://")):
            if req_cfg.get("retailer"):
                headers["Retailer"] = str(req_cfg["retailer"]).strip()

            try:
                with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                    resp = client.get(
                        endpoint_url,
                        params={"fromDate": from_date.isoformat(), "toDate": to_date.isoformat()},
                        headers=headers,
                    )
                    if resp.status_code != 200:
                        raise RuntimeError(f"HTTP {resp.status_code} khi kết nối nguồn Nhà cung cấp.")
                    data = resp.json()
                    raw_list: list[Any] = []
                    if isinstance(data, list):
                        raw_list = data
                    elif isinstance(data, dict):
                        root_key = req_cfg.get("root_data_path", "data")
                        raw_list = (
                            data.get("Data")
                            or data.get(root_key)
                            or data.get("orders")
                            or data.get("invoices")
                            or data.get("rows")
                            or []
                        )
                    elif not allow_sample_fallback:
                        raise RuntimeError("Nguồn Nhà cung cấp trả về dữ liệu không đúng định dạng danh sách.")

                    # Bỏ qua hàng tổng kết Id == -1 của KiotViet
                    if isinstance(raw_list, list):
                        raw_list = [r for r in raw_list if isinstance(r, dict) and r.get("Id") != -1]

                    if not isinstance(raw_list, list):
                        raise RuntimeError("Nguồn Nhà cung cấp không trả về danh sách đơn hàng.")

                    # Tự động làm phẳng (Flatten) nếu đơn hàng chứa mảng chi tiết (như InvoiceDetails của KiotViet)
                    flat_rows: list[dict[str, Any]] = []
                    for item in raw_list:
                        if isinstance(item, dict):
                            # Nếu là KiotViet và chưa có chi tiết, gọi API xem chi tiết hóa đơn
                            if is_kiotviet and item.get("Id") and not item.get("InvoiceDetails") and not item.get("OrderDetails"):
                                try:
                                    base_endpoint = endpoint_url.split("?")[0].rstrip("/")
                                    r_detail = client.get(f"{base_endpoint}/{item['Id']}?format=json", headers=headers)
                                    if r_detail.status_code == 200:
                                        item = r_detail.json()
                                except Exception:
                                    pass

                            details = (
                                item.get("InvoiceDetails")
                                or item.get("invoiceDetails")
                                or item.get("OrderDetails")
                                or item.get("orderDetails")
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
                    if flat_rows or not allow_sample_fallback:
                        return flat_rows
            except Exception as exc:
                if not allow_sample_fallback:
                    raise RuntimeError(f"Không thể đồng bộ nguồn Nhà cung cấp: {exc}") from exc
                # Fallback dữ liệu mẫu nếu API endpoint không phản hồi hoặc đang trong môi trường demo/offline
                pass
                # Fallback dữ liệu mẫu nếu API endpoint không phản hồi hoặc đang trong môi trường demo/offline
                pass
        elif not allow_sample_fallback:
            raise RuntimeError("Cấu hình nguồn Nhà cung cấp chưa có URL HTTP hợp lệ.")

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

    if sup == "NAZZY":
        return [
            {
                f_order: "26113337",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "10129223",
                f_cname: "Võ Hạ",
                f_ctax: "040076033328",
                f_caddr: "Số nhà 224, khối Hòa Bắc, Xã Tương Dương, Nghệ An",
                f_pcode: "323105",
                f_pname: "Bánh Marshmallow Phủ Sô Cô La Nextar 392g",
                f_unit: "Thùng",
                f_qty: 1,
                f_promo: 0,
                f_price: 328000,
                f_disc: 24000,
                f_vat: 8,
                f_total: 304000,
                f_scode: "BH001",
                f_sname: "Giao hàng",
            },
            {
                f_order: "26113337",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "10129223",
                f_cname: "Võ Hạ",
                f_ctax: "040076033328",
                f_caddr: "Số nhà 224, khối Hòa Bắc, Xã Tương Dương, Nghệ An",
                f_pcode: "320029",
                f_pname: "Bánh kem xốp phô mai-Richeese Nabati Cheese Cream Wafer 330g",
                f_unit: "Thùng",
                f_qty: 1,
                f_promo: 0,
                f_price: 240000,
                f_disc: 24000,
                f_vat: 8,
                f_total: 216000,
                f_scode: "BH001",
                f_sname: "Giao hàng",
            },
            {
                f_order: "26113338",
                f_date: date_str,
                f_deliv: date_str,
                f_ccode: "10129224",
                f_cname: "Lam Giang",
                f_ctax: "040191033257",
                f_caddr: "Số 212 Khối Hòa Nam, Xã Tương Dương, Nghệ An",
                f_pcode: "320935",
                f_pname: "Bánh Xốp Nhân Kem Goguma - Nabati Goguma Cream Wafer 110g",
                f_unit: "Thùng",
                f_qty: 3,
                f_promo: 0,
                f_price: 209712,
                f_disc: 77136,
                f_vat: 8,
                f_total: 552000,
                f_scode: "BH001",
                f_sname: "Giao hàng",
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
