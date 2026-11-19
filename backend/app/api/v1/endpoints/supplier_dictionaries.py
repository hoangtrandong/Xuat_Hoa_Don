from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from typing import List

from app.core.database import get_db
from app.models.supplier_dictionary import SupplierDictionary
from app.models.product import Product
from app.schemas.supplier_dictionary import (
    SupplierDictionaryCreate,
    SupplierDictionaryUpdate,
    SupplierDictionaryResponse,
)

router = APIRouter(prefix="/supplier-dictionaries", tags=["supplier-dictionaries"])


@router.get("/", response_model=List[SupplierDictionaryResponse])
def list_supplier_dictionaries(db: Session = Depends(get_db)):
    """Lấy danh sách từ điển nhà cung cấp kèm số lượng SKU đang liên kết."""
    items = db.scalars(select(SupplierDictionary).order_by(SupplierDictionary.id.asc())).all()
    
    # Đếm số lượng SKU cho từng hãng
    counts = dict(
        db.execute(
            select(Product.supplier, func.count(Product.id))
            .group_by(Product.supplier)
        ).all()
    )

    results = []
    for item in items:
        resp = SupplierDictionaryResponse.model_validate(item)
        resp.sku_count = counts.get(item.standard_name, 0)
        results.append(resp)
    return results


@router.post("/", response_model=SupplierDictionaryResponse, status_code=status.HTTP_201_CREATED)
def create_supplier_dictionary(payload: SupplierDictionaryCreate, db: Session = Depends(get_db)):
    """Thêm nhà cung cấp chuẩn mới vào từ điển."""
    name_clean = payload.standard_name.strip()
    if not name_clean:
        raise HTTPException(status_code=400, detail="Tên nhà cung cấp chuẩn không được để trống.")
    
    existing = db.scalar(
        select(SupplierDictionary).where(func.lower(SupplierDictionary.standard_name) == name_clean.lower())
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"Nhà cung cấp '{name_clean}' đã tồn tại trong từ điển.")

    obj = SupplierDictionary(
        standard_name=name_clean,
        short_code=(payload.short_code or "").strip() or None,
        tax_codes=[t.strip() for t in payload.tax_codes if t.strip()],
        keywords=[k.strip() for k in payload.keywords if k.strip()],
        notes=(payload.notes or "").strip() or None,
        is_active=payload.is_active,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    resp = SupplierDictionaryResponse.model_validate(obj)
    resp.sku_count = 0
    return resp


@router.put("/{dict_id}", response_model=SupplierDictionaryResponse)
def update_supplier_dictionary(dict_id: int, payload: SupplierDictionaryUpdate, db: Session = Depends(get_db)):
    """Cập nhật thông tin từ điển nhà cung cấp."""
    obj = db.get(SupplierDictionary, dict_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp trong từ điển.")

    old_name = obj.standard_name

    if payload.standard_name is not None:
        name_clean = payload.standard_name.strip()
        if not name_clean:
            raise HTTPException(status_code=400, detail="Tên nhà cung cấp không được để trống.")
        existing = db.scalar(
            select(SupplierDictionary).where(
                func.lower(SupplierDictionary.standard_name) == name_clean.lower(),
                SupplierDictionary.id != dict_id,
            )
        )
        if existing:
            raise HTTPException(status_code=409, detail=f"Tên nhà cung cấp '{name_clean}' đã được dùng.")
        obj.standard_name = name_clean

    if payload.short_code is not None:
        obj.short_code = payload.short_code.strip() or None
    if payload.tax_codes is not None:
        obj.tax_codes = [t.strip() for t in payload.tax_codes if t.strip()]
    if payload.keywords is not None:
        obj.keywords = [k.strip() for k in payload.keywords if k.strip()]
    if payload.notes is not None:
        obj.notes = payload.notes.strip() or None
    if payload.is_active is not None:
        obj.is_active = payload.is_active

    # Nếu đổi standard_name, cập nhật luôn sang bảng products
    if payload.standard_name is not None and payload.standard_name != old_name:
        db.query(Product).filter(Product.supplier == old_name).update({"supplier": obj.standard_name})

    db.commit()
    db.refresh(obj)

    sku_count = db.scalar(
        select(func.count(Product.id)).where(Product.supplier == obj.standard_name)
    ) or 0

    resp = SupplierDictionaryResponse.model_validate(obj)
    resp.sku_count = sku_count
    return resp


@router.delete("/{dict_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier_dictionary(dict_id: int, db: Session = Depends(get_db)):
    """Xóa nhà cung cấp khỏi từ điển."""
    obj = db.get(SupplierDictionary, dict_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp trong từ điển.")
    db.delete(obj)
    db.commit()
    return None


@router.post("/apply-to-products")
def apply_dictionary_to_products(db: Session = Depends(get_db)):
    """Quét và chuẩn hóa lại toàn bộ nhà cung cấp của các sản phẩm hiện có theo từ điển."""
    from app.crud.product import normalize_all_products_suppliers
    updated_count = normalize_all_products_suppliers(db)
    return {"success": True, "updated_count": updated_count}
