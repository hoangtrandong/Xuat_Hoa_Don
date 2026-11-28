from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any
import zipfile

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
import xlrd
from xlutils.copy import copy as xl_copy

from app.models.customer import Company, Customer, CustomerCompany
from app.models.multi_tenant_invoice import Distributor, IssuedInvoice
from app.models.product import DistributorProduct, InvoiceProduct, Product, ProductCompany
from app.models.vinamilk import VinamilkOrderSnapshot
from app.services.vinamilk_customer_code import is_vinamilk_supplier, normalize_vinamilk_customer_code

VIETTEL_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[1] / "templates" / "viettel_sinvoice_template.xls"
)

SUPPORTED_PROVIDERS = {
    "VIETTEL": {
        "code": "VIETTEL",
        "name": "Viettel S-Invoice (Mẫu C26TTD .xls)",
        "ext": "xls",
        "media_type": "application/vnd.ms-excel",
    },
    "MISA": {
        "code": "MISA",
        "name": "MISA meInvoice (Mẫu nhập khẩu .xlsx)",
        "ext": "xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "VNPT": {
        "code": "VNPT",
        "name": "VNPT Invoice (Mẫu nhập khẩu .xlsx)",
        "ext": "xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "EASYINVOICE": {
        "code": "EASYINVOICE",
        "name": "EasyInvoice (Mẫu nhập khẩu .xlsx)",
        "ext": "xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
}


def _to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _clean_identifier(value: str | None) -> str:
    if not value:
        return ""
    return "".join(ch for ch in str(value).strip() if ch.isalnum() or ch == "-").upper()


def resolve_invoice_item_presentation(
    *,
    prod: Product | None,
    comp: Company | None,
    link: ProductCompany | None,
    raw_code: str,
    raw_name: str,
    raw_unit: str,
    distributor_invoice_code: str | None = None,
    distributor_invoice_name: str | None = None,
) -> dict[str, Any]:
    """Phân giải Mã hàng, Tên hàng, ĐVT xuất hóa đơn và Tỷ lệ quy đổi quy cách.

    Thứ tự ưu tiên:
    1. Ghi đè riêng trên ProductCompany (mã/tên/ĐVT xuất HĐ & tỷ lệ conversion_num/conversion_den).
    2. Chính sách của Công ty quản lý (Company.invoice_item_mode):
       - INTERNAL : ưu tiên Mã nội bộ (npp_code), Tên nội bộ (internal_name), ĐVT nội bộ (internal_unit).
       - TAX_INPUT: ưu tiên Mã & Tên đầu vào CQT (sku, name, unit).
    """
    warning: str | None = None
    mode = (comp.invoice_item_mode or "TAX_INPUT").upper() if comp else "TAX_INPUT"

    base_code = prod.sku if prod else raw_code
    base_name = prod.name if prod else (raw_name or "Hàng hóa chưa đăng ký")
    base_unit = (prod.unit.name if (prod and prod.unit) else None) or raw_unit or "THUNG"

    if prod is not None and mode == "INTERNAL":
        internal_code = (
            (link.npp_code or "").strip() if (link is not None and (link.npp_code or "").strip()) else (prod._npp_code or "").strip()
        )
        if internal_code:
            resolved_code = internal_code
        else:
            resolved_code = base_code
            warning = (
                f"Công ty {comp.code if comp else ''} xuất theo Mã nội bộ nhưng SKU {prod.sku} chưa gán Mã nội bộ (tạm dùng mã đầu vào)."
            )
        resolved_name = (prod.internal_name or "").strip() or base_name
        resolved_unit = (prod.internal_unit or "").strip() or base_unit
    else:
        resolved_code = base_code
        resolved_name = base_name
        resolved_unit = base_unit

    conv_num = 1
    conv_den = 1
    if link is not None:
        if (link.company_product_code or "").strip():
            resolved_code = link.company_product_code.strip()
        if (link.invoice_name_override or "").strip():
            resolved_name = link.invoice_name_override.strip()
        if (link.invoice_unit_name or "").strip():
            resolved_unit = link.invoice_unit_name.strip()
        conv_num = max(1, int(link.conversion_num or 1))
        conv_den = max(1, int(link.conversion_den or 1))

    manual_invoice_code = (distributor_invoice_code or "").strip().upper()
    if manual_invoice_code:
        resolved_code = manual_invoice_code

    manual_invoice_name = (distributor_invoice_name or "").strip()
    if manual_invoice_name:
        resolved_name = manual_invoice_name

    is_converted = (conv_num != conv_den) or (resolved_unit.strip().lower() != base_unit.strip().lower())
    return {
        "product_code": resolved_code,
        "product_name": resolved_name,
        "unit_name": resolved_unit,
        "source_unit": base_unit,
        "conversion_num": conv_num,
        "conversion_den": conv_den,
        "conversion_ratio": f"{conv_num}/{conv_den}" if conv_num != conv_den else None,
        "is_converted": is_converted,
        "naming_mode": mode,
        "warning": warning,
    }


def consolidate_dms_orders_for_invoicing(
    db: Session,
    *,
    from_date: date,
    to_date: date,
    date_field: str = "order_created_date",
    distributor_id: int | None = None,
    company_id: int | None = None,
    supplier_code: str | None = None,
    default_vat_rate: float = 8.0,
    exclude_invoiced: bool = True,
) -> dict[str, Any]:
    """Tổng hợp & gom đơn hàng DMS theo ngày thành các nhóm hóa đơn dự kiến.

    Quy tắc gom:
    - Cùng Công ty quản lý (`company_id`) VÀ chung MST (ưu tiên 1) hoặc chung CCCD (ưu tiên 2)
      -> gom thành 1 hóa đơn hợp nhất, cộng gộp dòng hàng theo mã SKU CQT.
    - Kiểm tra điều kiện bắt buộc (Pre-flight Validation):
      + Khách hàng phải đã đăng ký trong danh mục `customers`
      + Khách hàng phải có MST hoặc CCCD
      + Khách hàng phải đã gán Công ty quản lý (`company_id`)
      + Sản phẩm trên đơn phải đã đăng ký trong danh mục `products`
      Nếu thiếu bất kỳ thông tin nào -> đánh dấu `is_valid = False` kèm danh sách cảnh báo cụ thể
      và không cho phép xuất file cho đến khi đăng ký đầy đủ.
    """
    target_dist_code: str | None = None
    allocation_mode = "BY_CUSTOMER"
    if distributor_id is not None:
        dist_obj = db.get(Distributor, distributor_id)
        if dist_obj:
            target_dist_code = (dist_obj.code or "").strip().upper()
            allocation_mode = (dist_obj.company_allocation_mode or "BY_CUSTOMER").upper()

    # 1. Truy vấn đơn hàng DMS trong khoảng ngày đã chọn
    date_expr = (
        func.coalesce(
            VinamilkOrderSnapshot.delivery_date,
            VinamilkOrderSnapshot.order_created_date,
            VinamilkOrderSnapshot.synced_from,
        )
        if date_field == "delivery_date"
        else func.coalesce(
            VinamilkOrderSnapshot.order_created_date,
            VinamilkOrderSnapshot.synced_from,
        )
    )

    stmt = (
        select(VinamilkOrderSnapshot)
        .where(
            VinamilkOrderSnapshot.order_number.is_not(None),
            VinamilkOrderSnapshot.product_code.is_not(None),
            date_expr >= from_date,
            date_expr <= to_date,
        )
        .order_by(VinamilkOrderSnapshot.order_number.asc(), VinamilkOrderSnapshot.id.asc())
    )
    snapshots = list(db.scalars(stmt).all())

    # Lọc bỏ các đơn đồng bộ từ nguồn NCC đã bị xóa cấu hình khỏi NPP (VD: NCC:NAZZY sau khi xóa Nazzy)
    from app.models.multi_tenant_invoice import DistributorSupplierConfig

    cfg_stmt = select(DistributorSupplierConfig.supplier_code)
    if distributor_id is not None:
        cfg_stmt = cfg_stmt.where(DistributorSupplierConfig.distributor_id == distributor_id)
    configured_supplier_codes = {
        (code or "").strip().upper()
        for code in db.scalars(cfg_stmt).all()
        if (code or "").strip()
    }
    if snapshots:
        non_external_sources = {"", "VINAMILK", "TỰ TẠO", "TÁCH/GỘP"}
        filtered_snaps: list[VinamilkOrderSnapshot] = []
        for snap in snapshots:
            ps = (snap.processing_status or "").strip().upper()
            payload = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
            payload_src = str(
                payload.get("Nguồn đồng bộ") or payload.get("_sync_source") or ""
            ).strip().upper()
            sup = ps.split(":", 1)[1].strip() if ps.startswith("NCC:") else ""
            effective_sup = sup or payload_src
            if (
                effective_sup
                and effective_sup not in non_external_sources
                and effective_sup not in configured_supplier_codes
            ):
                continue
            filtered_snaps.append(snap)
        snapshots = filtered_snaps

    # 2. Lấy danh sách số đơn đã xuất hóa đơn (nếu bật lọc)
    invoiced_orders: set[str] = set()
    if exclude_invoiced:
        issued_stmt = select(IssuedInvoice.source_order_numbers).where(
            IssuedInvoice.status != "CANCELLED"
        )
        if distributor_id is not None:
            issued_stmt = issued_stmt.where(IssuedInvoice.distributor_id == distributor_id)
        for src_nums in db.scalars(issued_stmt).all():
            if isinstance(src_nums, list):
                for num in src_nums:
                    if num:
                        invoiced_orders.add(str(num).strip())

    # 3. Nạp danh mục Khách hàng (kèm Công ty quản lý N-N & Địa chỉ) và Sản phẩm (zero N+1)
    cust_stmt = select(Customer).options(
        selectinload(Customer.company),
        selectinload(Customer.company_links).selectinload(CustomerCompany.company),
        selectinload(Customer.addresses),
        selectinload(Customer.store),
    )
    if distributor_id is not None:
        cust_stmt = cust_stmt.where(
            (Customer.distributor_id == distributor_id) | (Customer.distributor_id.is_(None))
        )
    customer_map: dict[str, Customer] = {}
    for c in db.scalars(cust_stmt).all():
        key = (c.code or "").strip().upper()
        if not key:
            continue
        # Ưu tiên bản ghi khớp chính xác distributor_id
        if key not in customer_map or (
            distributor_id is not None and c.distributor_id == distributor_id
        ):
            customer_map[key] = c

    prod_map: dict[str, Product] = {}
    all_products = db.scalars(
        select(Product).options(
            selectinload(Product.unit),
            selectinload(Product.invoice_product),
        )
    ).all()
    for p in all_products:
        if p.sku:
            prod_map[p.sku.strip().upper()] = p
        if p._npp_code:
            prod_map[p._npp_code.strip().upper()] = p

    # Nạp Danh mục Sản phẩm Xuất Hóa Đơn chuẩn (Single Source of Truth theo NPP, kèm Công ty QL mặc định)
    ip_stmt = select(InvoiceProduct).options(selectinload(InvoiceProduct.default_company))
    if distributor_id is not None:
        ip_stmt = ip_stmt.where(
            (InvoiceProduct.distributor_id == distributor_id)
            | (InvoiceProduct.distributor_id.is_(None))
        )
    invoice_product_by_code: dict[str, InvoiceProduct] = {}
    for ip in db.scalars(ip_stmt).all():
        code_u = (ip.code or "").strip().upper()
        if not code_u:
            continue
        if code_u not in invoice_product_by_code or (
            distributor_id is not None and ip.distributor_id == distributor_id
        ):
            invoice_product_by_code[code_u] = ip

    # Nạp Danh sách Mã SP DMS kèm liên kết SP xuất hóa đơn, Công ty QL & tỷ lệ quy đổi
    dms_product_map: dict[tuple[str, int | None], DistributorProduct] = {}
    distributor_invoice_profile_map: dict[tuple[str, int | None], tuple[str, str]] = {}
    dp_stmt = select(DistributorProduct).options(
        selectinload(DistributorProduct.invoice_product).selectinload(InvoiceProduct.default_company),
        selectinload(DistributorProduct.company),
    )
    if distributor_id is not None:
        dp_stmt = dp_stmt.where(
            (DistributorProduct.distributor_id == distributor_id)
            | (DistributorProduct.distributor_id.is_(None))
        )
    distributor_products = list(db.scalars(dp_stmt).all())
    # Ưu tiên bản ghi khớp chính xác distributor_id hơn bản ghi legacy (distributor_id=None)
    distributor_products.sort(key=lambda dp: 0 if dp.distributor_id is None else 1)
    for distributor_product in distributor_products:
        sku = (distributor_product.distributor_sku or "").strip().upper()
        invoice_code = (
            distributor_product.invoice_product.code
            if distributor_product.invoice_product
            else (distributor_product.invoice_product_code or "")
        ).strip().upper()
        invoice_name = (
            distributor_product.invoice_product.name
            if distributor_product.invoice_product
            else (distributor_product.invoice_product_name or "")
        ).strip()
        if sku:
            key = (sku, distributor_product.company_id)
            dms_product_map[key] = distributor_product
            distributor_invoice_profile_map[key] = (invoice_code, invoice_name)
            if distributor_product.company_id is not None and (sku, None) not in dms_product_map:
                dms_product_map[(sku, None)] = distributor_product
            if distributor_product.company_id is not None and (sku, None) not in distributor_invoice_profile_map:
                distributor_invoice_profile_map[(sku, None)] = (invoice_code, invoice_name)

    # Nạp sẵn bảng ProductCompany (kèm Company & InvoiceProduct) 1 lần để phân giải Công ty quản lý & Quy đổi quy cách (zero N+1)
    pc_links = db.scalars(
        select(ProductCompany)
        .options(
            selectinload(ProductCompany.company),
            selectinload(ProductCompany.invoice_product),
        )
        .order_by(ProductCompany.is_primary.desc(), ProductCompany.last_purchased_at.desc().nullslast())
    ).all()
    prod_company_map: dict[tuple[int, int], ProductCompany] = {}
    prod_primary_company: dict[int, Company] = {}
    prod_by_id = {p.id: p for p in all_products}
    for link in pc_links:
        prod_company_map[(link.product_id, link.company_id)] = link
        if link.npp_code and link.product_id in prod_by_id:
            prod_map.setdefault(link.npp_code.strip().upper(), prod_by_id[link.product_id])
        if link.company is not None and link.product_id not in prod_primary_company:
            if distributor_id is None or link.company.distributor_id in (None, distributor_id):
                prod_primary_company[link.product_id] = link.company

    # 4. Gom nhóm theo (company_id, identity_type, identity_value)
    groups_acc: dict[str, dict[str, Any]] = {}
    companies_seen: dict[int, dict[str, Any]] = {}

    for snap in snapshots:
        order_num = (snap.order_number or "").strip()
        if not order_num:
            continue
        if exclude_invoiced and order_num in invoiced_orders:
            continue

        raw = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
        row_dist_code = str(raw.get("Mã NPP") or "").strip().upper()
        if target_dist_code and row_dist_code and row_dist_code != target_dist_code:
            continue

        sup = str(raw.get("Nhà cung cấp") or "VINAMILK").strip().upper()
        if supplier_code and sup != supplier_code.strip().upper():
            continue

        cust_code_raw = (snap.customer_code or "").strip()
        is_vnm = is_vinamilk_supplier(sup)
        cust_code_normalized = normalize_vinamilk_customer_code(cust_code_raw, sup) if cust_code_raw else ""
        cust_code_key = cust_code_raw.upper()
        cust_code_norm_key = cust_code_normalized.upper()

        # Với Vinamilk: LUÔN ưu tiên tra bản ghi mã 3 ký tự cuối (VD: MG200310CR -> 0CR) trước
        # để không bị dính vào bản ghi mã dài cũ thiếu MST/CCCD.
        customer: Customer | None = None
        if is_vnm and cust_code_norm_key:
            customer = customer_map.get(cust_code_norm_key)
        if customer is None and cust_code_key:
            customer = customer_map.get(cust_code_key)
        if customer is None and cust_code_norm_key and cust_code_norm_key != cust_code_key:
            customer = customer_map.get(cust_code_norm_key)
        # Nếu tìm thấy bản ghi mã dài nhưng thiếu MST & CCCD, thử kiểm tra bản ghi 3 ký tự cuối xem có đủ thông tin hơn không
        if (
            customer is not None
            and len(cust_code_key) > 3
            and cust_code_norm_key
            and cust_code_norm_key != cust_code_key
            and not (customer.tax_code or "").strip()
            and not (customer.citizen_id or "").strip()
        ):
            short_cust = customer_map.get(cust_code_norm_key)
            if short_cust is not None and ((short_cust.tax_code or "").strip() or (short_cust.citizen_id or "").strip()):
                customer = short_cust

        # Mã KH hiển thị/gom: với Vinamilk luôn chuẩn hóa 3 ký tự cuối
        cust_code_effective = (
            cust_code_normalized
            if (is_vnm and cust_code_normalized)
            else (customer.code if customer is not None else cust_code_raw)
        )

        # Nếu lọc theo distributor_id và dòng snapshot không có "Mã NPP" thì kiểm tra qua customer.distributor_id
        if (
            distributor_id is not None
            and not row_dist_code
            and customer is not None
            and customer.distributor_id is not None
            and customer.distributor_id != distributor_id
        ):
            continue

        raw_prod_code = (snap.product_code or "").strip().upper()
        prod = prod_map.get(raw_prod_code)
        npp_lookup_sku = ((prod._npp_code or prod.sku) if prod else raw_prod_code).strip().upper()

        # Phân giải trước Sản phẩm XHĐ (để lấy Công ty QL mặc định gắn trên Sản phẩm XHĐ khi chế độ BY_PRODUCT / HYBRID)
        pre_dp: DistributorProduct | None = (
            dms_product_map.get((raw_prod_code, company_id))
            or dms_product_map.get((raw_prod_code, None))
            or dms_product_map.get((npp_lookup_sku, None))
        )
        pre_ip: InvoiceProduct | None = None
        if pre_dp is not None:
            if pre_dp.invoice_product is not None:
                pre_ip = pre_dp.invoice_product
            elif (pre_dp.invoice_product_code or "").strip():
                pre_ip = invoice_product_by_code.get(pre_dp.invoice_product_code.strip().upper())
        if pre_ip is None and prod is not None and prod.invoice_product is not None:
            pre_ip = prod.invoice_product
        if pre_ip is None and raw_prod_code:
            pre_ip = invoice_product_by_code.get(raw_prod_code)

        # Phân giải Công ty quản lý theo chiến lược của Nhà phân phối (BY_CUSTOMER | BY_PRODUCT | HYBRID)
        cust_companies: list[Company] = []
        if customer:
            seen_cids: set[int] = set()
            for link in customer.company_links or []:
                if link.company is not None and link.company.id not in seen_cids:
                    seen_cids.add(link.company.id)
                    cust_companies.append(link.company)
            if customer.company is not None and customer.company.id not in seen_cids:
                cust_companies.insert(0, customer.company)

        # Công ty theo Sản phẩm: ưu tiên Công ty QL mặc định trên Sản phẩm XHĐ -> ProductCompany -> DistributorProduct.company
        prod_comp: Company | None = (
            (pre_ip.default_company if (pre_ip and pre_ip.default_company) else None)
            or (prod_primary_company.get(prod.id) if prod else None)
            or (pre_dp.company if (pre_dp and pre_dp.company) else None)
        )
        cust_comp: Company | None = None
        if cust_companies:
            if company_id is not None:
                cust_comp = next((c for c in cust_companies if c.id == company_id), None)
            if cust_comp is None and prod_comp is not None:
                cust_comp = next((c for c in cust_companies if c.id == prod_comp.id), None)
            if cust_comp is None:
                cust_comp = cust_companies[0]

        allocation_source = "UNASSIGNED"
        if allocation_mode == "BY_PRODUCT":
            comp = prod_comp
            allocation_source = "BY_PRODUCT" if prod_comp else "UNASSIGNED"
        elif allocation_mode == "HYBRID_PRODUCT_FIRST":
            if prod_comp is not None:
                comp = prod_comp
                allocation_source = "BY_PRODUCT"
            elif cust_comp is not None:
                comp = cust_comp
                allocation_source = "BY_CUSTOMER"
            else:
                comp = None
        elif allocation_mode == "HYBRID_CUSTOMER_FIRST":
            if cust_comp is not None:
                comp = cust_comp
                allocation_source = "BY_CUSTOMER"
            elif prod_comp is not None:
                comp = prod_comp
                allocation_source = "BY_PRODUCT"
            else:
                comp = None
        else:
            comp = cust_comp
            allocation_source = "BY_CUSTOMER" if cust_comp else "UNASSIGNED"
        comp_id = comp.id if comp else None

        if company_id is not None and comp_id != company_id:
            continue

        if comp is not None:
            companies_seen[comp.id] = {
                "id": comp.id,
                "code": comp.code,
                "name": comp.name,
                "tax_code": comp.tax_code or "",
            }

        tax_code = _clean_identifier(customer.tax_code if customer else None)
        citizen_id = _clean_identifier(customer.citizen_id if customer else None)

        if tax_code:
            identity_type = "TAX_CODE"
            identity_value = tax_code
        elif citizen_id:
            identity_type = "CITIZEN_ID"
            identity_value = citizen_id
        else:
            identity_type = "MISSING_ID"
            identity_value = (cust_code_effective or cust_code_key).upper() or f"ORDER_{order_num}"

        group_key = f"{comp_id or 'NO_COMPANY'}::{identity_type}::{identity_value}"

        if group_key not in groups_acc:
            buyer_name = (
                (customer.name if customer else None)
                or (snap.customer_name or "").strip()
                or cust_code_raw
                or "Khách hàng chưa đăng ký"
            )
            buyer_address = (
                (customer.address if customer else None)
                or str(raw.get("Địa chỉ") or raw.get("customerAddress") or "").strip()
            )
            buyer_email = (customer.email if customer else None) or ""
            buyer_phone = (customer.phone if customer else None) or str(
                raw.get("Điện thoại") or raw.get("Số điện thoại") or ""
            ).strip()

            groups_acc[group_key] = {
                "group_key": group_key,
                "company_id": comp_id,
                "company_code": comp.code if comp else "",
                "company_name": comp.name if comp else "",
                "company_tax_code": (comp.tax_code or "") if comp else "",
                "identity_type": identity_type,
                "identity_value": identity_value if identity_type != "MISSING_ID" else "",
                "buyer_name": buyer_name,
                "buyer_tax_code": tax_code,
                "buyer_citizen_id": citizen_id,
                "buyer_address": buyer_address,
                "buyer_email": buyer_email,
                "buyer_phone": buyer_phone,
                "customer_codes": set(),
                "order_numbers": set(),
                "suppliers": set(),
                "missing_customers": set(),
                "missing_companies": set(),
                "missing_tax_or_cccd": set(),
                "missing_products": {},  # raw_code -> product_name
                "missing_invoice_products": {},  # dms_code -> product_name (chưa gán SP xuất HĐ)
                "warnings": set(),
                "allocation_sources": set(),
                "company_invoice_item_mode": (comp.invoice_item_mode or "TAX_INPUT") if comp else "TAX_INPUT",
                "items_acc": {},
            }

        grp = groups_acc[group_key]
        if cust_code_effective:
            grp["customer_codes"].add(cust_code_effective)
        grp["order_numbers"].add(order_num)
        grp["suppliers"].add(sup)
        if allocation_source != "UNASSIGNED":
            grp["allocation_sources"].add(allocation_source)

        # Kiểm tra điều kiện đăng ký Khách hàng & Công ty quản lý (theo chế độ phân bổ của NPP)
        if customer is None:
            grp["missing_customers"].add(cust_code_effective or f"(Đơn {order_num})")
        else:
            if not tax_code and not citizen_id:
                grp["missing_tax_or_cccd"].add(f"{customer.code} ({customer.name})")

        if comp is None:
            if allocation_mode in ("BY_PRODUCT", "HYBRID_PRODUCT_FIRST"):
                grp["missing_companies"].add(
                    f"SKU {raw_prod_code or '(Trống)'} ({prod.name if prod else (snap.product_name or 'Chưa đặt tên')})"
                )
            elif customer is not None:
                grp["missing_companies"].add(f"{customer.code} ({customer.name})")

        # Tra cứu Mã SP DMS -> Sản phẩm xuất hóa đơn chuẩn (Single Source of Truth) + tỷ lệ quy đổi
        npp_lookup_sku = ((prod._npp_code or prod.sku) if prod else raw_prod_code).strip().upper()
        dp_obj: DistributorProduct | None = None
        if comp is not None:
            dp_obj = (
                dms_product_map.get((raw_prod_code, comp.id))
                or dms_product_map.get((npp_lookup_sku, comp.id))
            )
        if dp_obj is None:
            dp_obj = (
                dms_product_map.get((raw_prod_code, None))
                or dms_product_map.get((npp_lookup_sku, None))
            )

        resolved_ip: InvoiceProduct | None = None
        if dp_obj is not None:
            if dp_obj.invoice_product is not None:
                resolved_ip = dp_obj.invoice_product
            elif (dp_obj.invoice_product_code or "").strip():
                resolved_ip = invoice_product_by_code.get(dp_obj.invoice_product_code.strip().upper())
        if resolved_ip is None and prod is not None and comp is not None:
            pc_for_ip = prod_company_map.get((prod.id, comp.id))
            if pc_for_ip is not None and pc_for_ip.invoice_product is not None:
                resolved_ip = pc_for_ip.invoice_product
        if resolved_ip is None and prod is not None and prod.invoice_product is not None:
            resolved_ip = prod.invoice_product
        if resolved_ip is None and raw_prod_code:
            resolved_ip = invoice_product_by_code.get(raw_prod_code)

        raw_unit_str = (
            (dp_obj.unit if (dp_obj and dp_obj.unit) else None)
            or str(raw.get("ĐVT") or raw.get("unit") or "").strip()
            or (prod.unit.name if (prod and prod.unit) else "THUNG")
        )

        if resolved_ip is not None:
            conv_num = max(1, int(dp_obj.conversion_num or 1)) if dp_obj is not None else 1
            conv_den = max(1, int(dp_obj.conversion_den or 1)) if dp_obj is not None else 1
            cqt_sku = resolved_ip.code.strip().upper()
            cqt_name = resolved_ip.name.strip()
            cqt_unit = (resolved_ip.unit_name or "Hộp").strip() or "Hộp"
            pres = {
                "product_code": cqt_sku,
                "product_name": cqt_name,
                "unit_name": cqt_unit,
                "source_unit": raw_unit_str,
                "conversion_num": conv_num,
                "conversion_den": conv_den,
                "conversion_ratio": f"{conv_num}/{conv_den}" if conv_num != conv_den else None,
                "is_converted": (conv_num != conv_den) or (cqt_unit.lower() != raw_unit_str.lower()),
                "naming_mode": "INVOICE_PRODUCT",
                "warning": None,
            }
        else:
            # Chưa gán Mã SP xuất hóa đơn -> đánh dấu lỗi chặn xuất hóa đơn
            grp["missing_invoice_products"][raw_prod_code or "(Trống)"] = (
                (dp_obj.distributor_product_name if dp_obj else None)
                or snap.product_name
                or (prod.name if prod else "Sản phẩm chưa đặt tên")
            )
            pc_link = prod_company_map.get((prod.id, comp.id)) if (prod and comp) else None
            dp_profile = None
            if comp is not None:
                dp_profile = (
                    distributor_invoice_profile_map.get((npp_lookup_sku, comp.id))
                    or distributor_invoice_profile_map.get((raw_prod_code, comp.id))
                )
            if dp_profile is None:
                dp_profile = (
                    distributor_invoice_profile_map.get((npp_lookup_sku, None))
                    or distributor_invoice_profile_map.get((raw_prod_code, None))
                )
            dp_inv_code = dp_profile[0] if dp_profile else None
            dp_inv_name = dp_profile[1] if dp_profile else None
            pres = resolve_invoice_item_presentation(
                prod=prod,
                comp=comp,
                link=pc_link,
                raw_code=raw_prod_code,
                raw_name=snap.product_name or "",
                raw_unit=raw_unit_str,
                distributor_invoice_code=dp_inv_code,
                distributor_invoice_name=dp_inv_name,
            )
            if pres["warning"]:
                grp["warnings"].add(pres["warning"])
            cqt_sku = pres["product_code"]
            cqt_name = pres["product_name"]
            cqt_unit = pres["unit_name"]
            conv_num = pres["conversion_num"]
            conv_den = pres["conversion_den"]

        qty = _to_float(raw.get("Số lượng") or raw.get("quantity"), 0.0)
        promo_qty = _to_float(raw.get("Số lượng KM") or raw.get("promotionQuantity"), 0.0)
        price = _to_float(raw.get("Giá bán") or raw.get("unitPrice") or raw.get("price"), 0.0)
        raw_val = _to_float(
            raw.get("Thành tiền") or raw.get("Giá trị") or raw.get("amount") or raw.get("totalValue"),
            0.0,
        )
        discount = _to_float(raw.get("Số tiền CK") or raw.get("discountAmount"), 0.0)

        if qty > 0 or raw_val > 0:
            line_amount = raw_val if raw_val > 0 else round(qty * price, 2)
            net_before_tax = max(0.0, round(line_amount - discount, 2))
            # Lấy thuế suất VAT: ưu tiên trên SP xuất hóa đơn -> SKU CQT -> mặc định
            sku_vat = (
                resolved_ip.vat_rate
                if (resolved_ip is not None and resolved_ip.vat_rate is not None)
                else (prod.vat_rate if (prod is not None and prod.vat_rate is not None) else None)
            )
            is_vat_exempt = sku_vat is not None and float(sku_vat) < 0
            line_vat_rate = 0.0 if is_vat_exempt else (float(sku_vat) if sku_vat is not None else float(default_vat_rate))
            item_key = f"{cqt_sku}::{cqt_unit}::{line_vat_rate}::SALE"
            if item_key not in grp["items_acc"]:
                grp["items_acc"][item_key] = {
                    "product_code": cqt_sku,
                    "source_product_code": raw_prod_code or (prod.sku if prod else ""),
                    "product_name": cqt_name,
                    "unit_name": cqt_unit,
                    "source_unit": pres["source_unit"],
                    "conversion_num": conv_num,
                    "conversion_den": conv_den,
                    "conversion_ratio": pres["conversion_ratio"],
                    "is_converted": pres["is_converted"],
                    "is_promo": False,
                    "is_registered": resolved_ip is not None,
                    "source_quantity": 0.0,
                    "quantity": 0.0,
                    "discount_amount": 0.0,
                    "amount_before_tax": 0.0,
                    "vat_rate": line_vat_rate,
                    "vat_label": "KCT" if is_vat_exempt else f"{int(line_vat_rate) if line_vat_rate.is_integer() else line_vat_rate}%",
                }
            it = grp["items_acc"][item_key]
            it["source_quantity"] += qty
            it["quantity"] += (qty * conv_num) / conv_den
            it["discount_amount"] += discount
            it["amount_before_tax"] += net_before_tax

        if promo_qty > 0:
            promo_key = f"{cqt_sku}::{cqt_unit}::PROMO"
            if promo_key not in grp["items_acc"]:
                grp["items_acc"][promo_key] = {
                    "product_code": cqt_sku,
                    "source_product_code": prod.sku if prod else raw_prod_code,
                    "product_name": f"{cqt_name} (Hàng khuyến mại không thu tiền)",
                    "unit_name": cqt_unit,
                    "source_unit": pres["source_unit"],
                    "conversion_num": conv_num,
                    "conversion_den": conv_den,
                    "conversion_ratio": pres["conversion_ratio"],
                    "is_converted": pres["is_converted"],
                    "is_promo": True,
                    "is_registered": prod is not None,
                    "source_quantity": 0.0,
                    "quantity": 0.0,
                    "discount_amount": 0.0,
                    "amount_before_tax": 0.0,
                    "vat_rate": 0.0,
                }
            grp["items_acc"][promo_key]["source_quantity"] += promo_qty
            grp["items_acc"][promo_key]["quantity"] += (promo_qty * conv_num) / conv_den

    # 5. Hoàn thiện danh sách nhóm, tính tổng và tổng hợp lỗi kiểm tra + Đối chiếu Tồn kho Thuế theo MST
    from app.services.tax_inventory_service import compute_tax_inventory_by_mst

    tax_inv_snapshot = compute_tax_inventory_by_mst(db, distributor_id=distributor_id, page_size=0)
    tax_balance_lookup: dict[tuple[str, str], float] = dict(tax_inv_snapshot["balance_lookup"])
    sku_positive_by_mst: dict[str, list[dict[str, Any]]] = tax_inv_snapshot["sku_positive_by_mst"]

    result_groups: list[dict[str, Any]] = []
    valid_count = 0
    invalid_count = 0
    total_orders_set: set[str] = set()
    total_customers_set: set[str] = set()
    grand_before_tax = 0.0
    grand_vat = 0.0
    grand_payment = 0.0

    for grp in groups_acc.values():
        validation_errors: list[str] = []
        missing_flags: list[str] = []

        if grp["missing_customers"]:
            missing_flags.append("CUSTOMER")
            codes_str = ", ".join(sorted(grp["missing_customers"]))
            validation_errors.append(
                f"Chưa đăng ký thông tin Khách hàng cho mã KH: {codes_str}"
            )
        if grp["missing_companies"]:
            missing_flags.append("COMPANY")
            codes_str = ", ".join(sorted(grp["missing_companies"]))
            mode_label = (
                "theo Mã Sản phẩm"
                if allocation_mode in ("BY_PRODUCT", "HYBRID_PRODUCT_FIRST")
                else "theo Mã Khách hàng"
            )
            validation_errors.append(
                f"Chưa gán Công ty quản lý ({mode_label}) cho: {codes_str}"
            )
        if grp["missing_tax_or_cccd"]:
            missing_flags.append("TAX_OR_CCCD")
            codes_str = ", ".join(sorted(grp["missing_tax_or_cccd"]))
            validation_errors.append(
                f"Thiếu cả Mã số thuế (MST) và CCCD cho: {codes_str}"
            )
        if grp["missing_invoice_products"]:
            missing_flags.append("INVOICE_PRODUCT")
            prods_str = ", ".join(
                f"{code} ({name})" for code, name in sorted(grp["missing_invoice_products"].items())
            )
            validation_errors.append(
                f"Mã SP DMS chưa gán Mã SP xuất hóa đơn (vui lòng gán tại Danh sách mã SP DMS trước khi xuất): {prods_str}"
            )
        if grp["missing_products"]:
            missing_flags.append("PRODUCT")
            prods_str = ", ".join(
                f"{code} ({name})" for code, name in sorted(grp["missing_products"].items())
            )
            validation_errors.append(
                f"Sản phẩm chưa đăng ký trong danh mục sản phẩm: {prods_str}"
            )

        items_list: list[dict[str, Any]] = []
        grp_before_tax = 0.0
        grp_vat = 0.0
        grp_payment = 0.0
        for idx, it in enumerate(
            sorted(
                grp["items_acc"].values(),
                key=lambda x: (x["is_promo"], x["product_code"]),
            ),
            start=1,
        ):
            qty = round(float(it["quantity"]), 4)
            src_qty = round(float(it.get("source_quantity", qty)), 4)
            amt = round(float(it["amount_before_tax"]), 2)
            unit_price = round(amt / qty, 2) if qty > 0 else 0.0
            vat_rate = float(it["vat_rate"])
            vat_amt = round(amt * vat_rate / 100.0, 2)
            total_amt = round(amt + vat_amt, 2)

            if it.get("conversion_den", 1) > 1 and abs(qty - round(qty)) > 1e-4:
                grp["warnings"].add(
                    f"SKU {it['product_code']}: quy đổi {src_qty} {it.get('source_unit', '')} theo tỷ lệ {it.get('conversion_ratio')} ra số lẻ ({qty} {it['unit_name']})."
                )

            # Kiểm tra Tồn kho Thuế theo (MST Công ty xuất, Mã SP xuất hóa đơn) theo ĐVT nhỏ nhất đã quy đổi
            comp_mst = (grp.get("company_tax_code") or "").strip()
            inv_sku_upper = (it["product_code"] or it.get("source_product_code") or "").strip().upper()
            tax_balance_qty: float | None = None
            is_tax_negative = False
            if comp_mst and inv_sku_upper:
                tax_balance_qty = tax_balance_lookup.get((comp_mst, inv_sku_upper), 0.0)
                projected_bal = round(tax_balance_qty - qty, 4)
                # Trừ lũy kế để các nhóm hóa đơn tiếp theo trong cùng đợt gom thấy đúng tồn còn lại
                tax_balance_lookup[(comp_mst, inv_sku_upper)] = projected_bal
                if projected_bal < -1e-6:
                    is_tax_negative = True
                    others = [
                        f"{x['tax_code']} (+{x['balance_qty']})"
                        for x in sku_positive_by_mst.get(inv_sku_upper, [])
                        if x["tax_code"] != comp_mst
                    ]
                    other_hint = f" | MST khác đang tồn: {', '.join(others[:2])}" if others else ""
                    grp["warnings"].add(
                        f"Âm kho thuế MST {comp_mst} - Mã SP xuất HĐ {inv_sku_upper}: tồn khả dụng {tax_balance_qty}, sắp xuất {qty} {it['unit_name']} (thiếu {round(abs(projected_bal), 4)}){other_hint}."
                    )

            items_list.append(
                {
                    "line_number": idx,
                    "product_code": it["product_code"],
                    "source_product_code": it["source_product_code"],
                    "product_name": it["product_name"],
                    "unit_name": it["unit_name"],
                    "source_unit": it.get("source_unit", it["unit_name"]),
                    "source_quantity": src_qty,
                    "conversion_ratio": it.get("conversion_ratio"),
                    "is_converted": bool(it.get("is_converted")),
                    "is_promo": it["is_promo"],
                    "is_registered": it["is_registered"],
                    "quantity": qty,
                    "unit_price": unit_price,
                    "discount_amount": round(float(it["discount_amount"]), 2),
                    "amount_before_tax": amt,
                    "vat_rate": vat_rate,
                    "vat_label": it.get("vat_label", f"{int(vat_rate) if float(vat_rate).is_integer() else vat_rate}%"),
                    "vat_amount": vat_amt,
                    "total_amount": total_amt,
                    "tax_balance_qty": tax_balance_qty,
                    "is_tax_stock_negative": is_tax_negative,
                }
            )
            grp_before_tax += amt
            grp_vat += vat_amt
            grp_payment += total_amt

        if not items_list:
            continue

        is_valid = len(validation_errors) == 0
        if is_valid:
            valid_count += 1
        else:
            invalid_count += 1

        cust_codes = sorted(grp["customer_codes"])
        ord_nums = sorted(grp["order_numbers"])
        total_orders_set.update(ord_nums)
        total_customers_set.update(cust_codes)
        grand_before_tax += grp_before_tax
        grand_vat += grp_vat
        grand_payment += grp_payment

        require_bank_transfer = round(grp_payment, 2) >= 20_000_000.0
        if require_bank_transfer:
            grp["warnings"].add(
                "Tổng thanh toán >= 20.000.000đ: Bắt buộc thanh toán không dùng tiền mặt (CK) để đủ điều kiện khấu trừ thuế GTGT."
            )

        result_groups.append(
            {
                "group_key": grp["group_key"],
                "is_valid": is_valid,
                "validation_errors": validation_errors,
                "warnings": sorted(grp["warnings"]),
                "missing_flags": missing_flags,
                "require_bank_transfer": require_bank_transfer,
                "company_id": grp["company_id"],
                "company_code": grp["company_code"],
                "company_invoice_item_mode": grp["company_invoice_item_mode"],
                "allocation_source": (
                    sorted(grp["allocation_sources"])[0]
                    if len(grp["allocation_sources"]) == 1
                    else ("HYBRID" if len(grp["allocation_sources"]) > 1 else "UNASSIGNED")
                ),
                "company_name": grp["company_name"],
                "company_tax_code": grp["company_tax_code"],
                "identity_type": grp["identity_type"],
                "identity_value": grp["identity_value"],
                "buyer_name": grp["buyer_name"],
                "buyer_tax_code": grp["buyer_tax_code"],
                "buyer_citizen_id": grp["buyer_citizen_id"],
                "buyer_address": grp["buyer_address"],
                "buyer_email": grp["buyer_email"],
                "buyer_phone": grp["buyer_phone"],
                "customer_codes": cust_codes,
                "customer_count": len(cust_codes),
                "order_numbers": ord_nums,
                "order_count": len(ord_nums),
                "suppliers": sorted(grp["suppliers"]),
                "item_count": len(items_list),
                "items": items_list,
                "subtotal_before_tax": round(grp_before_tax, 2),
                "vat_amount": round(grp_vat, 2),
                "total_payment": round(grp_payment, 2),
            }
        )

    # Sắp xếp: nhóm thiếu thông tin lên trước hoặc sắp theo Công ty quản lý -> giá trị
    result_groups.sort(
        key=lambda g: (
            g["is_valid"],  # False (thiếu thông tin) hiện trước để kế toán thấy ngay
            g["company_code"] or "ZZZ",
            -g["total_payment"],
        )
    )

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "date_field": date_field,
        "distributor_id": distributor_id,
        "company_allocation_mode": allocation_mode,
        "default_vat_rate": float(default_vat_rate),
        "summary": {
            "total_groups": len(result_groups),
            "valid_groups": valid_count,
            "invalid_groups": invalid_count,
            "total_orders": len(total_orders_set),
            "total_customers": len(total_customers_set),
            "total_before_tax": round(grand_before_tax, 2),
            "total_vat": round(grand_vat, 2),
            "total_payment": round(grand_payment, 2),
            "companies": sorted(companies_seen.values(), key=lambda c: c["code"]),
        },
        "groups": result_groups,
    }


def _build_viettel_sinvoice_xls(
    groups: list[dict[str, Any]],
    custom_note: str = "",
) -> BytesIO:
    if not VIETTEL_TEMPLATE_PATH.exists():
        raise FileNotFoundError(
            f"Không tìm thấy file mẫu Viettel S-Invoice tại {VIETTEL_TEMPLATE_PATH}"
        )

    rb = xlrd.open_workbook(str(VIETTEL_TEMPLATE_PATH), formatting_info=True)
    wb = xl_copy(rb)
    ws = wb.get_sheet(0)

    for c in range(45):
        ws.write(10, c, "")

    current_row = 10
    for group_idx, grp in enumerate(groups, start=1):
        buyer_code = grp["customer_codes"][0] if grp["customer_codes"] else f"KH_{group_idx}"
        buyer_name = grp["buyer_name"]
        buyer_addr = grp["buyer_address"] or "Nghệ An"
        buyer_phone = grp["buyer_phone"] or ""
        buyer_email = grp["buyer_email"] or ""
        buyer_tax = grp["buyer_tax_code"] or ""
        buyer_cccd = grp["buyer_citizen_id"] or ""

        note_parts = []
        if custom_note.strip():
            note_parts.append(custom_note.strip())
        if buyer_cccd and not buyer_tax:
            note_parts.append(f"CCCD: {buyer_cccd}")
        if grp["order_numbers"]:
            note_parts.append(f"Gom đơn DMS: {', '.join(grp['order_numbers'])}")
        note_text = " | ".join(note_parts)

        for it in grp["items"]:
            ws.write(current_row, 1, str(group_idx))
            ws.write(current_row, 3, buyer_code)
            ws.write(current_row, 4, buyer_name)
            ws.write(current_row, 5, buyer_addr)
            if buyer_phone:
                ws.write(current_row, 6, buyer_phone)
            if buyer_email:
                ws.write(current_row, 7, buyer_email)
            if buyer_tax:
                ws.write(current_row, 8, buyer_tax)
                ws.write(current_row, 12, buyer_name)
            elif buyer_cccd:
                ws.write(current_row, 10, buyer_cccd)

            ws.write(current_row, 25, "TM/CK")
            ws.write(current_row, 26, "1")
            ws.write(current_row, 27, "VND")
            ws.write(current_row, 28, 1)
            ws.write(current_row, 31, "2" if it["is_promo"] else "1")
            ws.write(current_row, 33, it["product_code"])
            ws.write(current_row, 34, it["product_name"])
            ws.write(current_row, 38, it["unit_name"])
            ws.write(current_row, 39, it["quantity"])
            ws.write(current_row, 40, it["unit_price"])
            ws.write(current_row, 41, it["amount_before_tax"])
            ws.write(current_row, 42, str(int(it["vat_rate"]) if float(it["vat_rate"]).is_integer() else it["vat_rate"]))
            ws.write(current_row, 43, it["vat_amount"])
            ws.write(current_row, 44, note_text)
            current_row += 1

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def _build_standard_xlsx(
    groups: list[dict[str, Any]],
    provider: str,
    custom_note: str = "",
) -> BytesIO:
    wb = Workbook()
    ws = wb.active
    ws.title = f"HD_{provider}"[:31]

    if provider == "MISA":
        headers = [
            "Nhóm hóa đơn (*)",
            "Công ty quản lý",
            "Mã khách hàng",
            "Tên đơn vị / Khách hàng (*)",
            "Mã số thuế",
            "Số CCCD",
            "Địa chỉ",
            "Email nhận HĐ",
            "Hình thức TT",
            "Tính chất",
            "Mã hàng (*)",
            "Tên hàng hóa, dịch vụ (*)",
            "ĐVT",
            "Số lượng",
            "Đơn giá",
            "Thành tiền chưa thuế",
            "Thuế suất GTGT (%)",
            "Tiền thuế GTGT",
            "Tổng tiền thanh toán",
            "Ghi chú / Số đơn DMS",
        ]
    elif provider == "VNPT":
        headers = [
            "STT Hóa đơn",
            "Công ty xuất HĐ",
            "Mã KH",
            "Tên KH / Đơn vị",
            "MST",
            "CCCD",
            "Địa chỉ",
            "Email",
            "HTTT",
            "Loại dòng",
            "Mã sản phẩm",
            "Tên sản phẩm",
            "ĐVT",
            "Số lượng",
            "Đơn giá",
            "Thành tiền",
            "Thuế suất (%)",
            "Tiền thuế",
            "Tổng cộng",
            "Ghi chú",
        ]
    else:  # EASYINVOICE
        headers = [
            "Số thứ tự HĐ",
            "Công ty quản lý",
            "Mã KH",
            "Tên khách hàng",
            "Mã số thuế",
            "CCCD",
            "Địa chỉ",
            "Email",
            "Phương thức TT",
            "Tính chất HH",
            "Mã HH",
            "Tên HH/DV",
            "Đơn vị tính",
            "Số lượng",
            "Đơn giá",
            "Thành tiền trước thuế",
            "Thuế suất GTGT",
            "Tiền thuế GTGT",
            "Tổng cộng tiền TT",
            "Diễn giải / Đơn DMS",
        ]

    header_fill = PatternFill(start_color="14263D", end_color="14263D", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=10)
    thin_side = Side(style="thin", color="CBD5E1")
    border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    ws.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
    ws.row_dimensions[1].height = 26

    for group_idx, grp in enumerate(groups, start=1):
        buyer_code = ", ".join(grp["customer_codes"])
        note_parts = []
        if custom_note.strip():
            note_parts.append(custom_note.strip())
        if grp["order_numbers"]:
            note_parts.append(f"Đơn DMS: {', '.join(grp['order_numbers'])}")
        note_text = " | ".join(note_parts)

        for it in grp["items"]:
            row_vals = [
                group_idx,
                f"{grp['company_code']} - {grp['company_name']}" if grp["company_code"] else "",
                buyer_code,
                grp["buyer_name"],
                grp["buyer_tax_code"],
                grp["buyer_citizen_id"],
                grp["buyer_address"],
                grp["buyer_email"],
                "TM/CK",
                "Khuyến mại" if it["is_promo"] else "Hàng hóa, dịch vụ",
                it["product_code"],
                it["product_name"],
                it["unit_name"],
                it["quantity"],
                it["unit_price"],
                it["amount_before_tax"],
                it["vat_rate"],
                it["vat_amount"],
                it["total_amount"],
                note_text,
            ]
            ws.append(row_vals)
            row_idx = ws.max_row
            for col_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=row_idx, column=col_idx)
                cell.border = border
                if col_idx in (14, 15, 16, 18, 19):
                    cell.number_format = "#,##0.##"
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif col_idx in (1, 13, 17):
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                else:
                    cell.alignment = Alignment(vertical="center")

    col_widths = [14, 24, 18, 30, 16, 16, 32, 22, 12, 16, 16, 34, 10, 12, 14, 18, 14, 16, 18, 34]
    for idx, width in enumerate(col_widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = width

    ws.freeze_panes = "A2"
    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def export_consolidated_groups(
    groups: list[dict[str, Any]],
    *,
    provider: str = "VIETTEL",
    custom_note: str = "",
    split_by_company: bool = True,
) -> tuple[BytesIO, str, str]:
    """Xuất các nhóm hóa đơn đã gom ra file theo định dạng của nhà cung cấp HĐĐT.

    Trả về: (buffer, filename, media_type)
    """
    prov = (provider or "VIETTEL").strip().upper()
    if prov not in SUPPORTED_PROVIDERS:
        raise ValueError(f"Chưa hỗ trợ mẫu Hóa đơn điện tử '{prov}'.")

    if not groups:
        raise ValueError("Chưa chọn nhóm hóa đơn nào để xuất file.")

    invalid_groups = [g for g in groups if not g.get("is_valid")]
    if invalid_groups:
        first_err = invalid_groups[0]["validation_errors"][0]
        raise ValueError(
            f"Có {len(invalid_groups)} nhóm hóa đơn chưa đủ thông tin bắt buộc. "
            f"Vui lòng đăng ký đầy đủ Sản phẩm / Khách hàng / Công ty quản lý trước khi xuất. ({first_err})"
        )

    meta = SUPPORTED_PROVIDERS[prov]
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    by_company: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g in groups:
        comp_key = g.get("company_code") or "KHONG_CTY"
        by_company[comp_key].append(g)

    def _render_single(grp_list: list[dict[str, Any]]) -> BytesIO:
        if prov == "VIETTEL":
            return _build_viettel_sinvoice_xls(grp_list, custom_note=custom_note)
        return _build_standard_xlsx(grp_list, provider=prov, custom_note=custom_note)

    if len(by_company) == 1 or not split_by_company:
        comp_tag = next(iter(by_company.keys())) if len(by_company) == 1 else "ALL"
        buf = _render_single(groups)
        filename = f"HD_{prov}_{comp_tag}_{stamp}.{meta['ext']}"
        return buf, filename, meta["media_type"]

    # Nhiều Công ty quản lý -> đóng gói file ZIP, mỗi công ty 1 file riêng
    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for comp_code, comp_groups in sorted(by_company.items()):
            file_buf = _render_single(comp_groups)
            inner_name = f"HD_{prov}_{comp_code}_{stamp}.{meta['ext']}"
            zf.writestr(inner_name, file_buf.getvalue())
    zip_buf.seek(0)
    return zip_buf, f"HD_{prov}_TheoCongTy_{stamp}.zip", "application/zip"
