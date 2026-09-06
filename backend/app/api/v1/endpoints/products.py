from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.product import Product, ProductCreate, PriceList, PriceListCreate, ProductCategoryOption, ProductUnitOption
from app.models.product import ProductCategory, ProductUnit
from app.models.product import Product as ProductModel
from app.crud import product as product_crud, price_list as pl_crud

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/template")
def download_product_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "SKU"
    sheet.append(["sku", "name", "category_code", "unit_code", "supplier", "base_price", "cost_price", "reorder_level", "status"])
    sheet.append(["SKU-NEW", "Ten san pham", "BKS", "CAI", "", 0, 0, 20, "active"])
    output = BytesIO()
    workbook.save(output)
    return Response(content=output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="mau-sku.xlsx"'})


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
        imported = 0
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            sku = str(data.get("sku") or "").strip()
            category_code = str(data.get("category_code") or "").strip().upper()
            unit_code = str(data.get("unit_code") or "").strip().upper()
            if not sku or not str(data.get("name") or "").strip():
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: SKU và tên sản phẩm là bắt buộc.")
            if db.query(ProductModel).filter(ProductModel.sku == sku).first():
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: SKU {sku} đã tồn tại.")
            if category_code not in categories or unit_code not in units:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: category_code hoặc unit_code không tồn tại.")
            db.add(ProductModel(
                sku=sku, name=str(data["name"]).strip(), category_id=categories[category_code], unit_id=units[unit_code],
                supplier=str(data.get("supplier") or "").strip() or None, base_price=float(data.get("base_price") or 0),
                cost_price=float(data.get("cost_price") or 0), reorder_level=int(data.get("reorder_level") or 20),
                status=str(data.get("status") or "active").strip(),
            ))
            imported += 1
        db.commit()
        return {"imported": imported}
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Dữ liệu Excel không hợp lệ: {exc}") from exc
    except (InvalidFileException, BadZipFile, OSError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Không thể đọc file Excel: {exc}") from exc

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
    return product_crud.create(db, payload)


@router.get("/{product_id}", response_model=Product)
def get_product(product_id: int, db: Session = Depends(get_db)):
    obj = product_crud.get(db, product_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Product not found")
    return obj


@router.get("/price-lists/", response_model=List[PriceList], tags=["price-lists"])
def list_price_lists(db: Session = Depends(get_db)):
    return pl_crud.list_(db)


@router.post("/price-lists/", response_model=PriceList, status_code=201)
def create_price_list(payload: PriceListCreate, db: Session = Depends(get_db)):
    return pl_crud.create(db, payload)