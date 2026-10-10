from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.product import Product, ProductCreate, ProductUpdate, PriceList, PriceListCreate, ProductCategoryOption, ProductUnitOption
from app.models.product import ProductCategory, ProductUnit, ProductGroup, ProductGroupItem
from app.models.product import Product as ProductModel
from app.crud import product as product_crud, price_list as pl_crud

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/template")
def download_product_template():
    from app.core.excel_templates import create_smart_template

    output = create_smart_template(
        sheet_title="SKU",
        headers=[
            "sku", "name", "category_code", "unit_code", "supplier",
            "base_price", "cost_price", "reorder_level", "status", "boxes_per_carton",
            "representative_sku", "representative_name",
        ],
        sub_guides=[
            "Bắt buộc. Mã sản phẩm (VD: 01CX01)",
            "Bắt buộc. Tên sản phẩm đầy đủ",
            "Bắt buộc. Mã ngành hàng (VD: BKS, SUA, BOT...)",
            "Bắt buộc. Mã ĐVT (VD: CAI, HOP, THUNG...)",
            "Tùy chọn. Nhà cung cấp (VD: Vinamilk)",
            "Giá bán niêm yết (VNĐ)",
            "Giá vốn nhập kho (VNĐ)",
            "Mức tồn tối thiểu cảnh báo đặt hàng",
            "Chọn: active / inactive",
            "Quy cách: Số hộp/gói trong 1 thùng",
            "Tùy chọn. Mã SKU đại diện quy đổi",
            "Tùy chọn. Tên SKU đại diện quy đổi",
        ],
        sample_rows=[
            ["01CX01", "Sữa tươi tiệt trùng 100% Có đường 110ml", "SUA", "HOP", "Vinamilk", 7500, 6800, 50, "active", 48, "", ""],
            ["02HD14", "Sữa chua ăn Có đường 100g", "SUA", "HOP", "Vinamilk", 8000, 7200, 30, "active", 48, "", ""],
        ],
        col_widths=[16, 36, 18, 16, 18, 18, 18, 16, 16, 18, 20, 26],
        guide_title="HƯỚNG DẪN NHẬP DANH MỤC SẢN PHẨM (SKU)",
        guide_sections=[
            ("1. Quy tắc chung:", [
                "• Dòng 1: Tiêu đề cột (tiếng Anh chuẩn). Dòng 2: Hướng dẫn mờ. Dữ liệu bắt đầu từ dòng 3.",
                "• Nếu SKU đã có, hệ thống cập nhật giá, quy cách và thông tin liên quan.",
                "• Nếu SKU chưa có, hệ thống tạo mới sản phẩm.",
            ]),
            ("2. Quy cách quy đổi Thùng / Hộp (boxes_per_carton):", [
                "• Trường 'boxes_per_carton' dùng để quy đổi tự động giữa Thùng và Hộp/Gói trong Phiếu giao xuất kho.",
            ]),
        ],
        validations=[("I3:I500", '"active,inactive"', "Chọn trạng thái", "Chỉ chọn active hoặc inactive")],
    )
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-sku.xlsx"'},
    )


@router.post("/upload")
def upload_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")
        headers = [str(value).strip() if value is not None else "" for value in rows[0]]
        required = {"sku", "name", "category_code", "unit_code"}
        if not required.issubset(headers):
            raise HTTPException(status_code=400, detail=f"Thiếu cột bắt buộc: {', '.join(sorted(required - set(headers)))}")
        categories = {item.code: item.id for item in db.query(ProductCategory).all()}
        units = {item.code: item.id for item in db.query(ProductUnit).all()}
        products = {item.sku: item for item in db.scalars(select(ProductModel)).all()}
        has_representative_columns = "representative_sku" in headers or "representative_name" in headers
        imported = 0
        updated = 0
        representative_updates: list[tuple[ProductModel, str, str]] = []
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            sku = str(data.get("sku") or "").strip()
            name = str(data.get("name") or "").strip()
            # Bỏ qua dòng hướng dẫn phụ nếu giữ nguyên dòng 2 mẫu
            if "Bắt buộc" in sku or "Mã sản phẩm" in sku or "Tên sản phẩm đầy đủ" in name:
                continue
            category_code = str(data.get("category_code") or "").strip().upper()
            unit_code = str(data.get("unit_code") or "").strip().upper()
            if not sku or not name:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: SKU và tên sản phẩm là bắt buộc.")
            if category_code not in categories or unit_code not in units:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: category_code hoặc unit_code không tồn tại.")
            product = products.get(sku)
            values_to_apply = {
                "name": str(data["name"]).strip(),
                "category_id": categories[category_code],
                "unit_id": units[unit_code],
                "supplier": str(data.get("supplier") or "").strip() or None,
                "base_price": float(data.get("base_price") or 0),
                "cost_price": float(data.get("cost_price") or 0),
                "reorder_level": int(data.get("reorder_level") or 20),
                "status": str(data.get("status") or "active").strip(),
                "boxes_per_carton": max(1, int(data.get("boxes_per_carton") or 1)),
            }
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
            if has_representative_columns:
                representative_updates.append((product, str(data.get("representative_sku") or "").strip().upper(), str(data.get("representative_name") or "").strip()))

        if has_representative_columns:
            for product, representative_sku, representative_name in representative_updates:
                _apply_representative_upload(db, product, representative_sku, representative_name, products)
        db.commit()
        return {"imported": imported, "updated": updated, "representative_updated": len(representative_updates)}
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
    return db.query(ProductCategory).order_by(ProductCategory.name).all()


@router.get("/units/", response_model=List[ProductUnitOption])
def list_units(db: Session = Depends(get_db)):
    return db.query(ProductUnit).order_by(ProductUnit.name).all()


@router.get("/", response_model=List[Product])
def list_products(skip: int = 0, limit: int = 100, category_id: int | None = None, db: Session = Depends(get_db)):
    return product_crud.list_(db, skip=skip, limit=limit, category_id=category_id)


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
    return obj


@router.patch("/{product_id}", response_model=Product)
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)):
    try:
        obj = product_crud.update(db, product_id, payload)
        if not obj:
            raise HTTPException(status_code=404, detail="Product not found")
        return obj
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    success = product_crud.delete(db, product_id)
    if not success:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"success": True, "message": "Product deleted"}


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