from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional

from app.models.product import Product, PriceList, PriceListItem, ProductGroup, ProductGroupItem
from app.schemas.product import ProductCreate, PriceListCreate


def get(db: Session, product_id: int) -> Optional[Product]:
    return db.get(Product, product_id)


def list_(db: Session, skip: int = 0, limit: int = 100, category_id: Optional[int] = None) -> List[Product]:
    stmt = select(Product).offset(skip).limit(limit)
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    products = list(db.execute(stmt).scalars().all())

    if not products:
        return products

    # Batch fetch representative SKU data with a single simple JOIN query.
    # Note: no IN-clause filtering — product_group_items is small, and passing
    # thousands of ids through text() params does not expand correctly and hangs.
    rep_rows = db.execute(text(
        "SELECT pgi.product_id, rp.sku AS rep_sku, rp.name AS rep_name "
        "FROM product_group_items pgi "
        "JOIN product_groups pg ON pg.id = pgi.product_group_id "
        "JOIN products rp ON rp.id = pg.representative_product_id"
    )).all()

    rep_map = {row.product_id: (row.rep_sku, row.rep_name) for row in rep_rows}
    for product in products:
        rep = rep_map.get(product.id)
        product._rep_sku_cache = rep[0] if rep else None
        product._rep_name_cache = rep[1] if rep else None

    return products


def create(db: Session, obj_in: ProductCreate) -> Product:
    data = obj_in.model_dump()
    if data.get("sku"):
        data["sku"] = str(data["sku"]).strip().upper()
    existing = db.execute(select(Product.id).where(Product.sku == data["sku"])).scalar_one_or_none()
    if existing:
        raise ValueError(f"SKU {data['sku']} đã tồn tại.")
    product = Product(**data)
    db.add(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError(f"SKU {data['sku']} đã tồn tại.") from None
    db.refresh(product)
    return product


def update(db: Session, product_id: int, obj_in) -> Optional[Product]:
    product = db.get(Product, product_id)
    if not product:
        return None
    
    # Check SKU uniqueness if updating SKU
    if obj_in.sku is not None and obj_in.sku.upper() != product.sku.upper():
        existing = db.query(Product).filter(Product.sku == obj_in.sku.upper()).first()
        if existing:
            raise ValueError(f"SKU {obj_in.sku} đã tồn tại")
    
    update_data = obj_in.model_dump(exclude_unset=True)
    
    # Normalize SKU to uppercase
    if "sku" in update_data and update_data["sku"]:
        update_data["sku"] = update_data["sku"].upper()
    
    for field, value in update_data.items():
        setattr(product, field, value)
    
    db.commit()
    db.refresh(product)
    return product


def delete(db: Session, product_id: int) -> bool:
    product = db.get(Product, product_id)
    if not product:
        return False
    db.delete(product)
    db.commit()
    return True


def bulk_delete(db: Session, product_ids: List[int]) -> int:
    deleted = 0
    for product_id in product_ids:
        product = db.get(Product, product_id)
        if product:
            db.delete(product)
            deleted += 1
    db.commit()
    return deleted


class ProductCRUD:
    get = staticmethod(get)
    list_ = staticmethod(list_)
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)
    bulk_delete = staticmethod(bulk_delete)


product = ProductCRUD()


def create_price_list(db: Session, obj_in: PriceListCreate) -> PriceList:
    data = obj_in.model_dump(exclude={"items"})
    pl = PriceList(**data)
    db.add(pl)
    db.flush()
    for item in obj_in.items:
        db.add(PriceListItem(price_list_id=pl.id, **item.model_dump()))
    db.commit()
    db.refresh(pl)
    return pl


def list_price_lists(db: Session) -> List[PriceList]:
    return list(db.execute(select(PriceList)).scalars().all())


class PriceListCRUD:
    create = staticmethod(create_price_list)
    list_ = staticmethod(list_price_lists)


price_list = PriceListCRUD()