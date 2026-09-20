from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.models.customer import Company
from app.models.product import Product, ProductCompany, ProductGroup, ProductGroupCompany, ProductGroupItem
from app.schemas.product_group import (
    ProductCompanyLinkView,
    ProductGroupCompanyLinkCreate,
    ProductGroupCompanyLinkView,
    ProductGroupCreate,
    ProductGroupItemAdd,
    ProductGroupItemView,
    ProductGroupRepresentativeUpdate,
    ProductGroupView,
)

router = APIRouter(prefix="/product-groups", tags=["product-groups"])


def _load_group(db: Session, group_id: int) -> ProductGroup:
    group = db.scalar(
        select(ProductGroup)
        .options(selectinload(ProductGroup.items))
        .where(ProductGroup.id == group_id)
    )
    if not group:
        raise HTTPException(status_code=404, detail="Product group not found")
    return group


@router.get("/", response_model=list[ProductGroupView])
def list_groups(db: Session = Depends(get_db)):
    return db.scalars(
        select(ProductGroup).options(selectinload(ProductGroup.items)).order_by(ProductGroup.name)
    ).all()


@router.post("/", response_model=ProductGroupView, status_code=201)
def create_group(payload: ProductGroupCreate, db: Session = Depends(get_db)):
    product_ids = set(payload.product_ids)
    product_ids.add(payload.representative_product_id)
    products = db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
    if len(products) != len(product_ids):
        raise HTTPException(status_code=400, detail="Một hoặc nhiều SKU không tồn tại.")
    existing = db.scalars(select(ProductGroupItem.product_id).where(ProductGroupItem.product_id.in_(product_ids))).all()
    if existing:
        raise HTTPException(status_code=409, detail=f"SKU đã thuộc nhóm khác: {', '.join(map(str, existing))}")

    group = ProductGroup(name=payload.name.strip(), representative_product_id=payload.representative_product_id)
    db.add(group)
    db.flush()
    db.add_all([
        ProductGroupItem(product_group_id=group.id, product_id=product_id)
        for product_id in product_ids
    ])
    db.commit()
    return _load_group(db, group.id)


@router.patch("/{group_id}/representative", response_model=ProductGroupView)
def change_representative(group_id: int, payload: ProductGroupRepresentativeUpdate, db: Session = Depends(get_db)):
    group = _load_group(db, group_id)
    if not any(item.product_id == payload.product_id for item in group.items):
        raise HTTPException(status_code=400, detail="SKU đại diện mới phải là thành viên của nhóm.")
    group.representative_product_id = payload.product_id
    db.commit()
    return _load_group(db, group_id)


@router.post("/{group_id}/items", response_model=ProductGroupItemView, status_code=201)
def add_group_item(group_id: int, payload: ProductGroupItemAdd, db: Session = Depends(get_db)):
    _load_group(db, group_id)
    if not db.get(Product, payload.product_id):
        raise HTTPException(status_code=404, detail="SKU not found")
    if db.scalar(select(ProductGroupItem).where(ProductGroupItem.product_id == payload.product_id)):
        raise HTTPException(status_code=409, detail="SKU đã thuộc một nhóm sản phẩm khác.")
    item = ProductGroupItem(product_group_id=group_id, product_id=payload.product_id, conversion_factor=payload.conversion_factor)
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="SKU đã thuộc một nhóm sản phẩm khác.") from None
    db.refresh(item)
    return item


@router.delete("/{group_id}/items/{product_id}")
def remove_group_item(group_id: int, product_id: int, db: Session = Depends(get_db)):
    group = _load_group(db, group_id)
    if group.representative_product_id == product_id:
        raise HTTPException(status_code=400, detail="Hãy chọn SKU đại diện khác trước khi gỡ SKU này.")
    item = db.scalar(select(ProductGroupItem).where(ProductGroupItem.product_group_id == group_id, ProductGroupItem.product_id == product_id))
    if not item:
        raise HTTPException(status_code=404, detail="SKU không thuộc nhóm này.")
    db.delete(item)
    db.commit()
    return {"success": True}


@router.post("/{group_id}/companies", response_model=ProductGroupCompanyLinkView, status_code=201)
def link_group_company(group_id: int, payload: ProductGroupCompanyLinkCreate, db: Session = Depends(get_db)):
    _load_group(db, group_id)
    if not db.get(Company, payload.company_id):
        raise HTTPException(status_code=404, detail="Company not found")
    link = ProductGroupCompany(product_group_id=group_id, company_id=payload.company_id, role=payload.role.strip().upper())
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Công ty đã được gán vào nhóm này.") from None
    db.refresh(link)
    return link


@router.delete("/{group_id}/companies/{company_id}")
def unlink_group_company(group_id: int, company_id: int, db: Session = Depends(get_db)):
    link = db.scalar(select(ProductGroupCompany).where(ProductGroupCompany.product_group_id == group_id, ProductGroupCompany.company_id == company_id))
    if not link:
        raise HTTPException(status_code=404, detail="Company is not linked to this group")
    db.delete(link)
    db.commit()
    return {"success": True}


@router.post("/products/{product_id}/companies", response_model=ProductCompanyLinkView, status_code=201)
def link_product_company(product_id: int, payload: ProductGroupCompanyLinkCreate, db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(status_code=404, detail="SKU not found")
    if not db.get(Company, payload.company_id):
        raise HTTPException(status_code=404, detail="Company not found")
    link = ProductCompany(product_id=product_id, company_id=payload.company_id, role=payload.role.strip().upper())
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Công ty đã được gán vào SKU này.") from None
    db.refresh(link)
    return link
