import unicodedata
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from pydantic import BaseModel
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.product import (
    Product,
    ProductCreate,
    ProductUpdate,
    PriceList,
    PriceListCreate,
    ProductCategoryOption,
    ProductUnitOption,
    ProductPagination,
    ProductStats,
    ProductCompanyConfigsUpdate,
    ProductCompanyNppCodeUpdate,
    ProductInvoiceProductUpdate,
)
from app.models.customer import Company as CompanyModel
from app.models.product import (
    InvoiceProduct,
    ProductCategory,
    ProductCompany,
    ProductUnit,
    ProductGroup,
    ProductGroupItem,
)
from app.models.product import Product as ProductModel
from app.models.multi_tenant_invoice import (
    Distributor,
    DistributorSupplierConfig,
    IssuedInvoice,
    IssuedInvoiceItem,
    PurchaseInvoice,
    PurchaseInvoiceItem,
)
from app.models.vinamilk import VinamilkOrderSnapshot
from app.crud import product as product_crud, price_list as pl_crud

router = APIRouter(prefix="/products", tags=["products"])


def _product_distributors(db: Session, product_codes: set[str]) -> dict[str, list[dict[str, str]]]:
    if not product_codes:
        return {}

    distributors = db.scalars(select(Distributor)).all()
    distributors_by_id = {item.id: item for item in distributors}
    distributors_by_code = {(item.code or "").strip().upper(): item for item in distributors if item.code}
    supplier_distributors: dict[str, set[str]] = {}
    for config in db.scalars(select(DistributorSupplierConfig)).all():
        distributor = distributors_by_id.get(config.distributor_id)
        if distributor and config.supplier_code:
            supplier_distributors.setdefault(config.supplier_code.strip().upper(), set()).add(distributor.code.upper())

    codes_by_product: dict[str, set[str]] = {}
    snapshots = db.execute(
        select(
            VinamilkOrderSnapshot.product_code,
            VinamilkOrderSnapshot.performed_by,
            VinamilkOrderSnapshot.processing_status,
            VinamilkOrderSnapshot.raw_payload,
        ).where(func.upper(VinamilkOrderSnapshot.product_code).in_(product_codes))
    ).all()
    for product_code, performed_by, processing_status, raw_payload in snapshots:
        raw = raw_payload if isinstance(raw_payload, dict) else {}
        payload_code = next(
            (str(value).strip().upper() for key, value in raw.items()
             if key.strip().casefold() in {"mã npp", "_distributor_code", "distributorcode", "distributor_code"}
             and value is not None and str(value).strip()),
            "",
        )
        distributor_code = payload_code or (performed_by or "").strip().upper()
        if distributor_code not in distributors_by_code:
            distributor_code = ""
        if not distributor_code:
            source = next(
                (str(value).strip().upper() for key, value in raw.items()
                 if key.strip().casefold() in {"nguồn đồng bộ", "_sync_source"}
                 and value is not None and str(value).strip()),
                "",
            )
            status_source = (processing_status or "").strip()
            if not source and status_source.upper().startswith("NCC:"):
                source = status_source.split(":", 1)[1].strip().upper()
            actor_key = (
                unicodedata.normalize("NFKD", (performed_by or "").strip())
                .encode("ascii", "ignore")
                .decode("ascii")
                .casefold()
            )
            if not source and actor_key == "he thong":
                source = "VINAMILK"
            candidates = supplier_distributors.get(source, set())
            if len(candidates) == 1:
                distributor_code = next(iter(candidates))
        if product_code and distributor_code:
            codes_by_product.setdefault(product_code.strip().upper(), set()).add(distributor_code)

    purchase_rows = db.execute(
        select(PurchaseInvoiceItem.product_code, PurchaseInvoice.distributor_id)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceItem.purchase_invoice_id)
        .where(func.upper(PurchaseInvoiceItem.product_code).in_(product_codes))
    ).all()
    for product_code, distributor_id in purchase_rows:
        distributor = distributors_by_id.get(distributor_id)
        if product_code and distributor:
            codes_by_product.setdefault(product_code.strip().upper(), set()).add(distributor.code.upper())

    issued_rows = db.execute(
        select(IssuedInvoiceItem.product_code, IssuedInvoice.distributor_id)
        .join(IssuedInvoice, IssuedInvoice.id == IssuedInvoiceItem.invoice_id)
        .where(func.upper(IssuedInvoiceItem.product_code).in_(product_codes))
    ).all()
    for product_code, distributor_id in issued_rows:
        distributor = distributors_by_id.get(distributor_id)
        if product_code and distributor:
            codes_by_product.setdefault(product_code.strip().upper(), set()).add(distributor.code.upper())

    return {
        product_code: [
            {"code": code, "name": distributors_by_code[code].name}
            for code in sorted(codes)
            if code in distributors_by_code
        ]
        for product_code, codes in codes_by_product.items()
    }


@router.get("/template")
def download_product_template():
    from app.core.excel_templates import create_smart_template

    output = create_smart_template(
        sheet_title="San_Pham_CQT",
        headers=[
            "MST đầu vào (CQT)",
            "Mã SP đầu vào (CQT)",
            "Mã SP xuất HĐ",
            "Tên sản phẩm / Hàng hóa",
            "Ngành hàng",
            "ĐVT",
            "Nhà cung cấp",
            "Giá bán / ĐVT (VNĐ)",
            "Thuế suất VAT (%)",
            "Trạng thái",
        ],
        sub_guides=[
            "Tùy chọn. MST hoặc Mã Công ty QL (để gán riêng theo từng MST)",
            "Bắt buộc. Mã sản phẩm đầu vào CQT (VD: 01CX01)",
            "Tùy chọn. Mã SP xuất hóa đơn đã tạo trong Danh sách SP XHĐ",
            "Bắt buộc. Tên sản phẩm / hàng hóa đầy đủ",
            "Tùy chọn. Mã hoặc tên ngành hàng (VD: SUA, BKS...)",
            "Tùy chọn. ĐVT (VD: Hộp, Thùng, Lon, Cái...)",
            "Tùy chọn. Nhà cung cấp (VD: Vinamilk)",
            "Tùy chọn. Giá bán / ĐVT (VNĐ)",
            "Tùy chọn. 0, 5, 8, 10 hoặc KCT",
            "Chọn: Đang bán / Ngừng bán",
        ],
        sample_rows=[
            ["0101111111", "01CX01", "SP-XHD-01", "Sữa tươi tiệt trùng 100% Có đường 110ml", "SUA", "Hộp", "Vinamilk", 7500, "8%", "Đang bán"],
            ["0102222222", "01CX01", "SP-XHD-02", "Sữa tươi tiệt trùng 100% Có đường 110ml", "SUA", "Hộp", "Vinamilk", 7500, "8%", "Đang bán"],
        ],
        col_widths=[20, 22, 20, 40, 18, 14, 18, 20, 18, 16],
        guide_title="HƯỚNG DẪN NHẬP DANH MỤC SẢN PHẨM ĐẦU VÀO CQT",
        guide_sections=[
            ("1. Quy tắc chung:", [
                "• Dòng 1: Tiêu đề cột tiếng Việt chuẩn khớp với bảng Sản phẩm CQT. Dòng 2: Hướng dẫn mờ. Dữ liệu bắt đầu từ dòng 3.",
                "• Nếu Mã SP đầu vào (CQT) đã tồn tại, hệ thống sẽ cập nhật thông tin tương ứng.",
                "• Nếu có điền 'MST đầu vào (CQT)' và 'Mã SP xuất HĐ', hệ thống sẽ tự động gắn MST đó và gán riêng Mã SP xuất HĐ cho đúng cặp (Mã SP CQT + MST).",
                "• Nếu cùng 1 Mã SP CQT có nhiều MST, chỉ cần điền nhiều dòng với MST và Mã SP xuất HĐ tương ứng.",
            ]),
            ("2. Lưu ý về Mã SP xuất HĐ:", [
                "• Mã SP xuất HĐ cần được tạo sẵn trong mục 'Sản phẩm XHĐ' để hệ thống tự động liên kết.",
            ]),
        ],
        validations=[("J3:J500", '"Đang bán,Ngừng bán"', "Chọn trạng thái", "Chỉ chọn Đang bán hoặc Ngừng bán")],
    )
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-san-pham-cqt.xlsx"'},
    )


def _parse_upload_vat_rate(raw_val) -> float | None:
    if raw_val is None:
        return None
    s = str(raw_val).strip().upper().replace("%", "")
    if not s:
        return None
    if s in ("KCT", "KHONG CHIU THUE", "KHÔNG CHỊU THUẾ", "-1"):
        return -1.0
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


@router.post("/upload")
def upload_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")
        raw_headers = [str(value).strip() if value is not None else "" for value in rows[0]]
        header_map = {
            "mst đầu vào (cqt)": "company_tax_code",
            "công ty / mst (cqt)": "company_tax_code",
            "mst đầu vào": "company_tax_code",
            "mst": "company_tax_code",
            "mã số thuế": "company_tax_code",
            "mã công ty": "company_tax_code",
            "mã sp đầu vào (cqt)": "sku",
            "mã sản phẩm đầu vào cqt": "sku",
            "mã sản phẩm (sku)": "sku",
            "mã sku": "sku",
            "ma sku": "sku",
            "mã sản phẩm": "sku",
            "sku": "sku",
            "mã sp xuất hđ": "invoice_product_code",
            "mã sp xhđ": "invoice_product_code",
            "mã sản phẩm xhđ": "invoice_product_code",
            "mã sản phẩm xuất hóa đơn": "invoice_product_code",
            "mã sp xuất hóa đơn": "invoice_product_code",
            "invoice_product_code": "invoice_product_code",
            "tên sản phẩm / hàng hóa": "name",
            "tên sản phẩm": "name",
            "ten san pham": "name",
            "tên sp": "name",
            "name": "name",
            "ngành hàng": "category_code",
            "mã danh mục": "category_code",
            "ma danh muc": "category_code",
            "danh mục ngành hàng": "category_code",
            "danh mục": "category_code",
            "category_code": "category_code",
            "đvt": "unit_code",
            "dvt": "unit_code",
            "đơn vị tính": "unit_code",
            "unit_code": "unit_code",
            "nhà cung cấp": "supplier",
            "nha cung cap": "supplier",
            "supplier": "supplier",
            "giá bán / đvt (vnđ)": "base_price",
            "giá bán / đvt": "base_price",
            "giá bán (vnđ)": "base_price",
            "giá bán": "base_price",
            "gia ban": "base_price",
            "đơn giá": "base_price",
            "base_price": "base_price",
            "thuế suất vat (%)": "vat_rate",
            "thuế suất vat": "vat_rate",
            "vat": "vat_rate",
            "vat_rate": "vat_rate",
            "giá vốn (vnđ)": "cost_price",
            "giá vốn": "cost_price",
            "gia von": "cost_price",
            "cost_price": "cost_price",
            "mức tồn tối thiểu": "reorder_level",
            "reorder_level": "reorder_level",
            "trạng thái": "status",
            "trang thai": "status",
            "status": "status",
            "quy cách (hộp/thùng)": "boxes_per_carton",
            "quy cách": "boxes_per_carton",
            "boxes_per_carton": "boxes_per_carton",
            "mã sku đại diện": "representative_sku",
            "representative_sku": "representative_sku",
            "tên sku đại diện": "representative_name",
            "representative_name": "representative_name",
        }
        headers = [header_map.get(h.lower(), h) for h in raw_headers]
        required = {"sku", "name"}
        if not required.issubset(headers):
            raise HTTPException(
                status_code=400,
                detail="Thiếu cột bắt buộc: 'Mã SP đầu vào (CQT)' và 'Tên sản phẩm / Hàng hóa'.",
            )

        categories = {item.code.upper(): item.id for item in db.query(ProductCategory).all() if item.code}
        categories.update({item.name.upper(): item.id for item in db.query(ProductCategory).all() if item.name})
        units = {item.code.upper(): item.id for item in db.query(ProductUnit).all() if item.code}
        units.update({item.name.upper(): item.id for item in db.query(ProductUnit).all() if item.name})
        default_category_id = next(iter(categories.values()), 1)
        default_unit_id = next(iter(units.values()), 1)

        products = {item.sku.strip().upper(): item for item in db.scalars(select(ProductModel)).all() if item.sku}

        # Nạp Công ty QL theo MST và Mã công ty để gán ProductCompany theo từng dòng
        companies_by_key: dict[str, CompanyModel] = {}
        for comp in db.scalars(select(CompanyModel)).all():
            if comp.tax_code and comp.tax_code.strip():
                companies_by_key[comp.tax_code.strip().upper()] = comp
            if comp.code and comp.code.strip():
                companies_by_key[comp.code.strip().upper()] = comp

        # Nạp Danh mục Sản phẩm XHĐ theo Mã để gán trực tiếp từ file Excel
        invoice_products_by_code: dict[str, InvoiceProduct] = {}
        for ip in db.scalars(select(InvoiceProduct)).all():
            if ip.code and ip.code.strip():
                invoice_products_by_code[ip.code.strip().upper()] = ip

        has_representative_columns = "representative_sku" in headers or "representative_name" in headers
        has_invoice_product_col = "invoice_product_code" in headers
        has_vat_col = "vat_rate" in headers
        imported = 0
        updated = 0
        mst_mapped = 0
        representative_updates: list[tuple[ProductModel, str, str]] = []

        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            sku = str(data.get("sku") or "").strip().upper()
            name = str(data.get("name") or "").strip()
            # Bỏ qua dòng hướng dẫn phụ nếu giữ nguyên dòng 2 mẫu
            if (
                "BẮT BUỘC" in sku
                or "MÃ SẢN PHẨM" in sku
                or "Tên sản phẩm" in name
                and "đầy đủ" in name
            ):
                continue
            category_code = str(data.get("category_code") or "").strip().upper()
            unit_code = str(data.get("unit_code") or "").strip().upper()
            if not sku or not name:
                raise HTTPException(
                    status_code=400,
                    detail=f"Dòng {row_number}: Mã SP đầu vào (CQT) và Tên sản phẩm / Hàng hóa là bắt buộc.",
                )

            product = products.get(sku)
            category_id = categories.get(category_code) or (product.category_id if product else default_category_id)
            unit_id = units.get(unit_code) or (product.unit_id if product else default_unit_id)

            status_val = str(data.get("status") or "").strip().lower()
            if status_val in ["active", "đang bán", "đang kinh doanh", "1", "true", ""]:
                clean_status = "active"
            else:
                clean_status = "inactive"

            raw_boxes = data.get("boxes_per_carton")
            try:
                boxes_val = (
                    max(1, int(float(raw_boxes)))
                    if raw_boxes is not None and str(raw_boxes).strip() != ""
                    else (product.boxes_per_carton if product else 1)
                )
            except (ValueError, TypeError):
                boxes_val = product.boxes_per_carton if product else 1

            raw_base_price = data.get("base_price")
            try:
                base_price_val = (
                    float(str(raw_base_price).replace(",", "").strip())
                    if raw_base_price is not None and str(raw_base_price).strip() != ""
                    else (product.base_price if product else 0.0)
                )
            except (ValueError, TypeError):
                base_price_val = product.base_price if product else 0.0

            raw_cost_price = data.get("cost_price")
            try:
                cost_price_val = (
                    float(str(raw_cost_price).replace(",", "").strip())
                    if raw_cost_price is not None and str(raw_cost_price).strip() != ""
                    else (product.cost_price if product else 0.0)
                )
            except (ValueError, TypeError):
                cost_price_val = product.cost_price if product else 0.0

            values_to_apply: dict = {
                "name": name,
                "category_id": category_id,
                "unit_id": unit_id,
                "supplier": str(data.get("supplier") or "").strip() or (product.supplier if product else "Vinamilk"),
                "base_price": base_price_val,
                "cost_price": cost_price_val,
                "reorder_level": int(data.get("reorder_level") or (product.reorder_level if product else 20)),
                "status": clean_status,
                "boxes_per_carton": boxes_val,
            }
            if has_vat_col and data.get("vat_rate") is not None and str(data.get("vat_rate")).strip() != "":
                parsed_vat = _parse_upload_vat_rate(data.get("vat_rate"))
                if parsed_vat is not None:
                    values_to_apply["vat_rate"] = parsed_vat
                    values_to_apply["vat_rate_source"] = "MANUAL"

            if product is None:
                product = ProductModel(sku=sku, **values_to_apply)
                db.add(product)
                db.flush()
                products[sku] = product
                imported += 1
            else:
                for field, value in values_to_apply.items():
                    setattr(product, field, value)
                updated += 1

            # Xử lý liên kết MST đầu vào (ProductCompany) & Mã SP xuất HĐ (InvoiceProduct)
            raw_mst_key = str(data.get("company_tax_code") or "").strip().upper()
            matched_comp = companies_by_key.get(raw_mst_key) if raw_mst_key else None
            raw_ip_code = str(data.get("invoice_product_code") or "").strip().upper() if has_invoice_product_col else ""
            matched_ip = invoice_products_by_code.get(raw_ip_code) if raw_ip_code else None

            if matched_comp is not None:
                pc_link = db.scalar(
                    select(ProductCompany).where(
                        ProductCompany.product_id == product.id,
                        ProductCompany.company_id == matched_comp.id,
                    )
                )
                if pc_link is None:
                    pc_link = ProductCompany(
                        product_id=product.id,
                        company_id=matched_comp.id,
                        role="MANAGER",
                        source="MANUAL",
                        status="active",
                    )
                    db.add(pc_link)
                    db.flush()
                if matched_ip is not None:
                    pc_link.invoice_product_id = matched_ip.id
                    pc_link.npp_code = matched_ip.code
                    mst_mapped += 1
                    db.flush()
                    _sync_product_fallback_invoice_product(db, product)
            elif matched_ip is not None:
                product.invoice_product_id = matched_ip.id
                product.npp_code = matched_ip.code
                product.internal_name = matched_ip.name
                product.internal_unit = matched_ip.unit_name
                for pc in db.scalars(select(ProductCompany).where(ProductCompany.product_id == product.id)).all():
                    pc.invoice_product_id = matched_ip.id
                    pc.npp_code = matched_ip.code
                mst_mapped += 1

            if has_representative_columns:
                representative_updates.append(
                    (
                        product,
                        str(data.get("representative_sku") or "").strip().upper(),
                        str(data.get("representative_name") or "").strip(),
                    )
                )

        if has_representative_columns:
            for product, representative_sku, representative_name in representative_updates:
                _apply_representative_upload(db, product, representative_sku, representative_name, products)
        db.commit()
        return {
            "imported": imported,
            "updated": updated,
            "mst_mapped": mst_mapped,
            "representative_updated": len(representative_updates),
        }
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Dữ liệu Excel không hợp lệ: {exc}") from exc
    except (InvalidFileException, BadZipFile, OSError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Không thể đọc file Excel: {exc}") from exc


def _apply_representative_upload(db: Session, product: ProductModel, representative_sku: str, representative_name: str, products: dict[str, ProductModel]) -> None:
    current_item = db.scalar(select(ProductGroupItem).where(ProductGroupItem.product_id == product.id))
    if not representative_sku:
        if not current_item:
            return
        group = current_item.group
        group_items = db.scalars(select(ProductGroupItem).where(ProductGroupItem.product_group_id == group.id)).all()
        if group.representative_product_id == product.id and len(group_items) > 1:
            raise HTTPException(status_code=400, detail=f"SKU {product.sku} đang là đại diện; hãy chọn đại diện mới trước khi xóa liên kết.")
        if len(group_items) == 1:
            db.delete(group)
        else:
            db.delete(current_item)
        return

    representative = products.get(representative_sku) or db.scalar(select(ProductModel).where(ProductModel.sku == representative_sku))
    if representative is None:
        raise HTTPException(status_code=400, detail=f"Không tìm thấy SKU đại diện {representative_sku} cho {product.sku}.")
    representative_item = db.scalar(select(ProductGroupItem).where(ProductGroupItem.product_id == representative.id))
    if current_item and representative_item and current_item.product_group_id != representative_item.product_group_id:
        raise HTTPException(status_code=400, detail=f"SKU {product.sku} và SKU đại diện {representative_sku} đang thuộc hai nhóm khác nhau.")
    group = current_item.group if current_item else (representative_item.group if representative_item else None)
    if group is None:
        group = ProductGroup(name=(representative_name or representative.name)[:200], representative_product_id=representative.id)
        db.add(group)
        db.flush()
    if representative_item is None and representative.id != product.id:
        db.add(ProductGroupItem(product_group_id=group.id, product_id=representative.id))
    if current_item is None and representative.id != product.id:
        db.add(ProductGroupItem(product_group_id=group.id, product_id=product.id))
    if current_item is None and representative.id == product.id:
        db.add(ProductGroupItem(product_group_id=group.id, product_id=product.id))
    group.representative_product_id = representative.id
    if representative_name:
        group.name = representative_name[:200]

@router.get("/categories/", response_model=List[ProductCategoryOption])
def list_categories(db: Session = Depends(get_db)):
    return db.query(ProductCategory).order_by(ProductCategory.code, ProductCategory.name).all()


@router.get("/units/", response_model=List[ProductUnitOption])
def list_units(db: Session = Depends(get_db)):
    return db.query(ProductUnit).order_by(ProductUnit.name).all()


@router.post("/sync-from-system")
def sync_products_from_system(db: Session = Depends(get_db)):
    """Đồng bộ toàn bộ Mã sản phẩm (SKU), Tên sản phẩm, ĐVT, Đơn giá và Nhà cung cấp
    từ các đơn hàng DMS và hóa đơn mua vào CQT đã đồng bộ về bảng products."""
    try:
        result = product_crud.sync_products_from_system_data(db, commit=True)
        return {"success": True, **result}
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Không thể đồng bộ danh mục SKU từ hệ thống: {exc}",
        ) from exc


@router.get("/filter-options")
def get_product_filter_options(db: Session = Depends(get_db)):
    return product_crud.get_filter_options(db)


class CleanupNonCqtPayload(BaseModel):
    deactivate_referenced: bool = False


@router.get("/cleanup-non-cqt/preview")
def preview_cleanup_non_cqt_products(db: Session = Depends(get_db)):
    """Xem trước các mã Product không thuộc Hóa đơn mua vào CQT (không có MST đầu vào) trước khi dọn dẹp."""
    return product_crud.analyze_non_cqt_products(db)


@router.post("/cleanup-non-cqt")
def execute_cleanup_non_cqt_products(
    payload: CleanupNonCqtPayload,
    db: Session = Depends(get_db),
):
    """Dọn dẹp an toàn các mã Product không phải từ CQT: chỉ xóa các mã không có MST đầu vào,
    không xuất hiện trên Hóa đơn mua vào CQT và không có tham chiếu lịch sử đơn hàng/kho."""
    return product_crud.cleanup_non_cqt_products(
        db,
        deactivate_referenced=bool(payload.deactivate_referenced),
    )


def _product_managed_companies(db: Session, product_ids: list[int]) -> dict[int, list[dict]]:
    if not product_ids:
        return {}
    rows = db.execute(
        select(ProductCompany, CompanyModel)
        .join(CompanyModel, CompanyModel.id == ProductCompany.company_id)
        .where(ProductCompany.product_id.in_(product_ids))
        .order_by(
            ProductCompany.is_primary.desc(),
            ProductCompany.last_purchased_at.desc().nullslast(),
            ProductCompany.id.asc(),
        )
    ).all()
    ip_ids = {link.invoice_product_id for link, _ in rows if link.invoice_product_id}
    ip_map = _invoice_products_by_id(db, ip_ids)
    result: dict[int, list[dict]] = {}
    for link, comp in rows:
        ip = ip_map.get(link.invoice_product_id) if link.invoice_product_id else None
        result.setdefault(link.product_id, []).append(
            {
                "company_id": comp.id,
                "company_code": comp.code,
                "company_name": comp.name,
                "short_name": comp.short_name,
                "tax_code": comp.tax_code,
                "invoice_item_mode": comp.invoice_item_mode or "TAX_INPUT",
                "source": link.source or "MANUAL",
                "is_primary": bool(link.is_primary),
                "npp_code": (ip.code if ip else link.npp_code),
                "invoice_product_id": link.invoice_product_id,
                "invoice_product_code": ip.code if ip else None,
                "invoice_product_name": ip.name if ip else None,
                "invoice_product_unit": ip.unit_name if ip else None,
                "company_product_code": link.company_product_code,
                "invoice_name_override": link.invoice_name_override,
                "invoice_unit_name": link.invoice_unit_name,
                "conversion_num": int(link.conversion_num or 1),
                "conversion_den": int(link.conversion_den or 1),
                "total_purchased_qty": float(link.total_purchased_qty or 0.0),
                "last_purchased_at": link.last_purchased_at,
            }
        )
    return result


def _invoice_products_by_id(db: Session, invoice_product_ids: set[int]) -> dict[int, InvoiceProduct]:
    clean_ids = [i for i in invoice_product_ids if i]
    if not clean_ids:
        return {}
    rows = db.scalars(select(InvoiceProduct).where(InvoiceProduct.id.in_(clean_ids))).all()
    return {row.id: row for row in rows}


def _cqt_invoice_unit_maps(
    db: Session, skus: set[str]
) -> tuple[dict[tuple[str, str], str], dict[str, str]]:
    """Lấy ĐVT gốc mới nhất từ Hóa đơn mua vào CQT theo (SKU, buyer_tax_code) và theo SKU."""
    by_sku_tax: dict[tuple[str, str], str] = {}
    by_sku: dict[str, str] = {}
    if not skus:
        return by_sku_tax, by_sku
    try:
        from app.models.multi_tenant_invoice import PurchaseInvoice, PurchaseInvoiceItem

        rows = db.execute(
            select(
                func.upper(func.trim(PurchaseInvoiceItem.product_code)),
                func.trim(PurchaseInvoice.buyer_tax_code),
                PurchaseInvoiceItem.unit_name,
            )
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceItem.purchase_invoice_id)
            .where(
                PurchaseInvoiceItem.product_code.is_not(None),
                func.upper(func.trim(PurchaseInvoiceItem.product_code)).in_(skus),
                PurchaseInvoiceItem.unit_name.is_not(None),
                func.trim(PurchaseInvoiceItem.unit_name) != "",
            )
            .order_by(PurchaseInvoice.invoice_date.desc(), PurchaseInvoiceItem.id.desc())
        ).all()
        for sku_key, buyer_tax, unit_name in rows:
            clean_unit = (unit_name or "").strip()
            if not sku_key or not clean_unit:
                continue
            sku_str = str(sku_key)
            tax_str = (str(buyer_tax) if buyer_tax else "").strip()
            if tax_str and (sku_str, tax_str) not in by_sku_tax:
                by_sku_tax[(sku_str, tax_str)] = clean_unit
            if sku_str not in by_sku:
                by_sku[sku_str] = clean_unit
    except Exception:
        pass
    return by_sku_tax, by_sku


def _enrich_invoice_product_fields(data: dict, prod: ProductModel, ip_map: dict[int, InvoiceProduct]) -> dict:
    ip = ip_map.get(prod.invoice_product_id) if prod.invoice_product_id else None
    data["invoice_product_id"] = prod.invoice_product_id
    data["invoice_product_code"] = ip.code if ip else None
    data["invoice_product_name"] = ip.name if ip else None
    data["invoice_product_unit"] = ip.unit_name if ip else None
    return data


@router.get("/paged", response_model=ProductPagination)
def list_products_paged(
    page: int = 1,
    page_size: int = 50,
    search: str | None = None,
    category_id: int | None = None,
    supplier: str | None = None,
    unit: str | None = None,
    status: str | None = None,
    distributor_code: str | None = None,
    company_id: int | None = None,
    company_tax_code: str | None = None,
    has_internal_code: bool | None = None,
    sort_field: str = "code",
    sort_order: str = "asc",
    expand_by_mst: bool = True,
    db: Session = Depends(get_db),
):
    if not expand_by_mst:
        items, total, stats_dict = product_crud.list_paged(
            db,
            page=page,
            page_size=page_size,
            search=search,
            category_id=category_id,
            supplier=supplier,
            unit=unit,
            status=status,
            distributor_code=distributor_code,
            company_id=company_id,
            company_tax_code=company_tax_code,
            has_internal_code=has_internal_code,
            sort_field=sort_field,
            sort_order=sort_order,
        )
        sku_set = {product.sku.strip().upper() for product in items if product.sku}
        distributor_map = _product_distributors(db, sku_set)
        managed_companies_map = _product_managed_companies(db, [product.id for product in items])
        ip_map = _invoice_products_by_id(db, {product.invoice_product_id for product in items if product.invoice_product_id})
        _, cqt_unit_by_sku = _cqt_invoice_unit_maps(db, sku_set)
        total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1

        return {
            "items": [
                _enrich_invoice_product_fields(
                    {
                        **Product.model_validate(product).model_dump(),
                        **(
                            {"unit_name": cqt_unit_by_sku[product.sku.strip().upper()]}
                            if product.sku and product.sku.strip().upper() in cqt_unit_by_sku
                            else {}
                        ),
                        "distributors": distributor_map.get(product.sku.strip().upper(), []),
                        "managed_companies": managed_companies_map.get(product.id, []),
                        "row_key": f"{product.id}:0",
                        "mst_count": len(managed_companies_map.get(product.id, [])),
                    },
                    product,
                    ip_map,
                )
                for product in items
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "stats": stats_dict,
        }

    row_tuples, total, stats_dict = product_crud.list_paged_by_mst(
        db,
        page=page,
        page_size=page_size,
        search=search,
        category_id=category_id,
        supplier=supplier,
        unit=unit,
        status=status,
        distributor_code=distributor_code,
        company_id=company_id,
        company_tax_code=company_tax_code,
        has_internal_code=has_internal_code,
        sort_field=sort_field,
        sort_order=sort_order,
    )
    unique_skus = {prod.sku.strip().upper() for prod, _, _ in row_tuples if prod.sku}
    unique_ids = list({prod.id for prod, _, _ in row_tuples})
    distributor_map = _product_distributors(db, unique_skus)
    managed_companies_map = _product_managed_companies(db, unique_ids)
    cqt_unit_by_sku_tax, cqt_unit_by_sku = _cqt_invoice_unit_maps(db, unique_skus)
    ip_ids: set[int] = set()
    for prod, pc_link, _ in row_tuples:
        if prod.invoice_product_id:
            ip_ids.add(prod.invoice_product_id)
        if pc_link is not None and pc_link.invoice_product_id:
            ip_ids.add(pc_link.invoice_product_id)
    ip_map = _invoice_products_by_id(db, ip_ids)
    total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1

    # Cache base product dump per product_id để tránh validate lặp khi 1 SKU có nhiều MST
    base_dump_cache: dict[int, dict] = {}
    serialized_items: list[dict] = []
    for prod, pc_link, comp in row_tuples:
        if prod.id not in base_dump_cache:
            base_dump_cache[prod.id] = _enrich_invoice_product_fields(
                Product.model_validate(prod).model_dump(), prod, ip_map
            )
        base_data = dict(base_dump_cache[prod.id])
        managed_list = managed_companies_map.get(prod.id, [])
        if pc_link is not None and comp is not None:
            row_ip = ip_map.get(pc_link.invoice_product_id) if pc_link.invoice_product_id else None
            row_npp = (row_ip.code if row_ip else (pc_link.npp_code or "")).strip().upper() or None
            has_conv = bool(
                (pc_link.conversion_num and pc_link.conversion_num != 1)
                or (pc_link.conversion_den and pc_link.conversion_den != 1)
                or (pc_link.invoice_unit_name or "").strip()
                or (pc_link.invoice_name_override or "").strip()
            )
            base_data.update(
                {
                    "npp_code": row_npp,
                    "invoice_product_id": pc_link.invoice_product_id,
                    "invoice_product_code": row_ip.code if row_ip else None,
                    "invoice_product_name": row_ip.name if row_ip else None,
                    "invoice_product_unit": row_ip.unit_name if row_ip else None,
                    "internal_name": row_ip.name if row_ip else None,
                    "internal_unit": row_ip.unit_name if row_ip else None,
                    "row_key": f"{prod.id}:{comp.id}",
                    "row_company_id": comp.id,
                    "row_company_code": comp.code,
                    "row_company_name": comp.name,
                    "row_company_short_name": comp.short_name,
                    "row_company_tax_code": comp.tax_code,
                    "row_company_is_primary": bool(pc_link.is_primary),
                    "row_company_npp_code": row_npp,
                    "row_company_purchased_qty": float(pc_link.total_purchased_qty or 0.0),
                    "row_company_has_conversion": has_conv,
                    "mst_count": len(managed_list),
                }
            )
        else:
            row_npp = (prod._npp_code or "").strip().upper() or None
            base_data.update(
                {
                    "npp_code": row_npp,
                    "row_key": f"{prod.id}:0",
                    "row_company_id": None,
                    "row_company_code": None,
                    "row_company_name": None,
                    "row_company_short_name": None,
                    "row_company_tax_code": None,
                    "row_company_is_primary": None,
                    "row_company_npp_code": None,
                    "row_company_purchased_qty": None,
                    "row_company_has_conversion": False,
                    "mst_count": len(managed_list),
                }
            )
        sku_upper = (prod.sku or "").strip().upper()
        comp_tax = (comp.tax_code or "").strip() if comp is not None else ""
        cqt_unit = (
            cqt_unit_by_sku_tax.get((sku_upper, comp_tax))
            if comp_tax
            else None
        ) or cqt_unit_by_sku.get(sku_upper)
        if cqt_unit:
            base_data["unit_name"] = cqt_unit
        base_data["distributors"] = distributor_map.get(sku_upper, [])
        base_data["managed_companies"] = managed_list
        serialized_items.append(base_data)

    return {
        "items": serialized_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "stats": stats_dict,
    }


@router.get("/", response_model=List[Product])
def list_products(skip: int = 0, limit: int = 100, category_id: int | None = None, db: Session = Depends(get_db)):
    products = product_crud.list_(db, skip=skip, limit=limit, category_id=category_id)
    distributor_map = _product_distributors(db, {product.sku.strip().upper() for product in products if product.sku})
    managed_companies_map = _product_managed_companies(db, [product.id for product in products])
    return [
        {
            **Product.model_validate(product).model_dump(),
            "distributors": distributor_map.get(product.sku.strip().upper(), []),
            "managed_companies": managed_companies_map.get(product.id, []),
        }
        for product in products
    ]


@router.post("/", response_model=Product, status_code=201)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    try:
        return product_crud.create(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{product_id}", response_model=Product)
def get_product(product_id: int, db: Session = Depends(get_db)):
    obj = product_crud.get(db, product_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Product not found")
    managed_companies_map = _product_managed_companies(db, [obj.id])
    return {
        **Product.model_validate(obj).model_dump(),
        "managed_companies": managed_companies_map.get(obj.id, []),
    }


@router.patch("/{product_id}", response_model=Product)
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)):
    try:
        obj = product_crud.update(db, product_id, payload)
        if not obj:
            raise HTTPException(status_code=404, detail="Product not found")
        managed_companies_map = _product_managed_companies(db, [obj.id])
        return {
            **Product.model_validate(obj).model_dump(),
            "managed_companies": managed_companies_map.get(obj.id, []),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{product_id}/company-configs")
def update_product_company_configs(
    product_id: int,
    payload: ProductCompanyConfigsUpdate,
    db: Session = Depends(get_db),
):
    """Cập nhật danh sách Công ty quản lý, Mã/Tên xuất HĐ ghi đè và Quy đổi quy cách cho 1 SKU."""
    product = product_crud.get(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm.")

    existing_links = db.scalars(
        select(ProductCompany).where(ProductCompany.product_id == product_id)
    ).all()
    existing_by_company = {link.company_id: link for link in existing_links}
    incoming_company_ids = {item.company_id for item in payload.configs}

    # Xóa các link thủ công không còn trong danh sách gửi lên (giữ lại link CQT nếu người dùng không bỏ)
    for comp_id, link in list(existing_by_company.items()):
        if comp_id not in incoming_company_ids:
            db.delete(link)

    # Đảm bảo chỉ có tối đa 1 is_primary = True
    primary_assigned = False
    for item in payload.configs:
        is_prim = bool(item.is_primary) and not primary_assigned
        if is_prim:
            primary_assigned = True
        clean_npp = (item.npp_code or "").strip().upper() or None
        link = existing_by_company.get(item.company_id)
        if link is None:
            link = ProductCompany(
                product_id=product_id,
                company_id=item.company_id,
                role="MANAGER",
                npp_code=clean_npp,
                source="MANUAL",
                is_primary=is_prim,
                company_product_code=(item.company_product_code or "").strip() or None,
                invoice_name_override=(item.invoice_name_override or "").strip() or None,
                invoice_unit_name=(item.invoice_unit_name or "").strip() or None,
                conversion_num=max(1, int(item.conversion_num or 1)),
                conversion_den=max(1, int(item.conversion_den or 1)),
                status="active",
            )
            db.add(link)
        else:
            link.is_primary = is_prim
            link.npp_code = clean_npp
            link.company_product_code = (item.company_product_code or "").strip() or None
            link.invoice_name_override = (item.invoice_name_override or "").strip() or None
            link.invoice_unit_name = (item.invoice_unit_name or "").strip() or None
            link.conversion_num = max(1, int(item.conversion_num or 1))
            link.conversion_den = max(1, int(item.conversion_den or 1))
            if (
                link.company_product_code
                or link.invoice_name_override
                or link.invoice_unit_name
                or link.conversion_num != 1
                or link.conversion_den != 1
            ):
                link.source = "MANUAL"

    db.flush()
    # Đồng bộ lại Product._npp_code theo dòng MST chính (hoặc dòng MST đầu tiên có mã NPP)
    _sync_product_fallback_npp_code(db, product)
    db.commit()
    return {
        "ok": True,
        "product_id": product_id,
        "managed_companies": _product_managed_companies(db, [product_id]).get(product_id, []),
    }


def _sync_product_fallback_npp_code(db: Session, product: ProductModel) -> None:
    """Giữ Product._npp_code đồng bộ với mã NPP của MST chính (hoặc MST đầu tiên có gán mã NPP)."""
    links = db.scalars(
        select(ProductCompany)
        .where(ProductCompany.product_id == product.id)
        .order_by(
            ProductCompany.is_primary.desc(),
            ProductCompany.last_purchased_at.desc().nullslast(),
            ProductCompany.id.asc(),
        )
    ).all()
    if not links:
        return
    primary_code = next(((l.npp_code or "").strip().upper() for l in links if (l.npp_code or "").strip()), None)
    product.npp_code = primary_code


@router.patch("/{product_id}/companies/{company_id}/npp-code")
def update_product_company_npp_code(
    product_id: int,
    company_id: int,
    payload: ProductCompanyNppCodeUpdate,
    db: Session = Depends(get_db),
):
    """Gán / cập nhật Mã NPP nội bộ riêng cho từng cặp (SKU CQT, MST đầu vào)."""
    product = product_crud.get(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm.")
    link = db.scalar(
        select(ProductCompany).where(
            ProductCompany.product_id == product_id,
            ProductCompany.company_id == company_id,
        )
    )
    if not link:
        raise HTTPException(status_code=404, detail="Không tìm thấy liên kết SKU với MST đầu vào này.")

    npp_val = (payload.npp_code or "").strip().upper() or None
    link.npp_code = npp_val
    db.flush()
    _sync_product_fallback_npp_code(db, product)
    db.commit()
    return {
        "ok": True,
        "product_id": product_id,
        "company_id": company_id,
        "npp_code": npp_val,
        "product_npp_code": product._npp_code,
    }


def _sync_product_fallback_invoice_product(db: Session, product: ProductModel) -> None:
    """Giữ Product.invoice_product_id và Product._npp_code đồng bộ với MST chính (hoặc MST đầu tiên có gán)."""
    links = db.scalars(
        select(ProductCompany)
        .where(ProductCompany.product_id == product.id)
        .order_by(
            ProductCompany.is_primary.desc(),
            ProductCompany.last_purchased_at.desc().nullslast(),
            ProductCompany.id.asc(),
        )
    ).all()
    if not links:
        return
    primary_link = next((l for l in links if l.invoice_product_id is not None), None)
    if primary_link is not None and primary_link.invoice_product_id is not None:
        ip = db.get(InvoiceProduct, primary_link.invoice_product_id)
        product.invoice_product_id = primary_link.invoice_product_id
        if ip is not None:
            product.npp_code = ip.code
            product.internal_name = ip.name
            product.internal_unit = ip.unit_name
        else:
            product.npp_code = (primary_link.npp_code or "").strip().upper() or None
    else:
        product.invoice_product_id = None
        primary_code = next(((l.npp_code or "").strip().upper() for l in links if (l.npp_code or "").strip()), None)
        product.npp_code = primary_code
        if not primary_code:
            product.internal_name = None
            product.internal_unit = None


@router.patch("/{product_id}/invoice-product")
def assign_product_invoice_product(
    product_id: int,
    payload: ProductInvoiceProductUpdate,
    db: Session = Depends(get_db),
):
    """Gán hoặc gỡ Sản phẩm xuất hóa đơn chuẩn cho 1 SKU đầu vào CQT (riêng theo từng MST hoặc toàn bộ MST)."""
    product = product_crud.get(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm SKU.")

    ip: InvoiceProduct | None = None
    if payload.invoice_product_id is not None:
        ip = db.get(InvoiceProduct, payload.invoice_product_id)
        if not ip:
            raise HTTPException(status_code=404, detail="Không tìm thấy Sản phẩm xuất hóa đơn.")

    if payload.company_id is not None and not payload.apply_all_companies:
        link = db.scalar(
            select(ProductCompany).where(
                ProductCompany.product_id == product.id,
                ProductCompany.company_id == payload.company_id,
            )
        )
        if not link:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy liên kết giữa SKU CQT này và Công ty / MST đã chọn.",
            )
        link.invoice_product_id = ip.id if ip else None
        link.npp_code = ip.code if ip else None
        db.flush()
        _sync_product_fallback_invoice_product(db, product)
    else:
        product.invoice_product_id = ip.id if ip else None
        product.npp_code = ip.code if ip else None
        product.internal_name = ip.name if ip else None
        product.internal_unit = ip.unit_name if ip else None
        for pc in db.scalars(select(ProductCompany).where(ProductCompany.product_id == product.id)).all():
            pc.invoice_product_id = ip.id if ip else None
            pc.npp_code = ip.code if ip else None

    db.commit()
    db.refresh(product)
    return {
        "ok": True,
        "product_id": product.id,
        "company_id": payload.company_id,
        "apply_all_companies": bool(payload.apply_all_companies or payload.company_id is None),
        "invoice_product_id": ip.id if ip else None,
        "invoice_product_code": ip.code if ip else None,
        "invoice_product_name": ip.name if ip else None,
        "invoice_product_unit": ip.unit_name if ip else None,
        "npp_code": ip.code if ip else None,
    }


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    success = product_crud.delete(db, product_id)
    if not success:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"success": True, "message": "Product deleted"}


class BulkAssignProductCompanyPayload(BaseModel):
    product_ids: List[int]
    company_id: int
    set_as_primary: bool = True


@router.post("/bulk-assign-company")
def bulk_assign_product_company(
    payload: BulkAssignProductCompanyPayload,
    db: Session = Depends(get_db),
):
    """Gán hàng loạt Công ty quản lý chính cho danh sách SKU (phục vụ NPP quản lý theo Sản phẩm)."""
    if not payload.product_ids:
        raise HTTPException(status_code=400, detail="Chưa chọn sản phẩm nào.")
    comp = db.get(CompanyModel, payload.company_id)
    if not comp:
        raise HTTPException(status_code=404, detail="Không tìm thấy Công ty quản lý.")

    existing_links = db.scalars(
        select(ProductCompany).where(ProductCompany.product_id.in_(payload.product_ids))
    ).all()
    links_by_prod: dict[int, list[ProductCompany]] = {}
    for link in existing_links:
        links_by_prod.setdefault(link.product_id, []).append(link)

    updated = 0
    for pid in set(payload.product_ids):
        prod_links = links_by_prod.get(pid, [])
        if payload.set_as_primary:
            for l in prod_links:
                l.is_primary = False
        matched = next((l for l in prod_links if l.company_id == comp.id), None)
        if matched is None:
            db.add(
                ProductCompany(
                    product_id=pid,
                    company_id=comp.id,
                    role="MANAGER",
                    source="MANUAL",
                    is_primary=payload.set_as_primary,
                    status="active",
                )
            )
        else:
            if payload.set_as_primary:
                matched.is_primary = True
            matched.status = "active"
        updated += 1

    db.commit()
    return {
        "ok": True,
        "updated": updated,
        "company_id": comp.id,
        "company_name": comp.short_name or comp.name,
    }


@router.post("/bulk-delete")
def bulk_delete_products(product_ids: List[int], db: Session = Depends(get_db)):
    if not product_ids:
        raise HTTPException(status_code=400, detail="No product IDs provided")
    deleted = product_crud.bulk_delete(db, product_ids)
    return {"success": True, "deleted": deleted}


@router.get("/price-lists/", response_model=List[PriceList], tags=["price-lists"])
def list_price_lists(db: Session = Depends(get_db)):
    return pl_crud.list_(db)


@router.post("/price-lists/", response_model=PriceList, status_code=201)
def create_price_list(payload: PriceListCreate, db: Session = Depends(get_db)):
    return pl_crud.create(db, payload)