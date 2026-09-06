from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List, Optional

from app.models.product import Product, PriceList, PriceListItem
from app.schemas.product import ProductCreate, PriceListCreate


def get(db: Session, product_id: int) -> Optional[Product]:
    return db.get(Product, product_id)


def list_(db: Session, skip: int = 0, limit: int = 100, category_id: Optional[int] = None) -> List[Product]:
    stmt = select(Product).offset(skip).limit(limit)
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    return list(db.execute(stmt).scalars().all())


def create(db: Session, obj_in: ProductCreate) -> Product:
    product = Product(**obj_in.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


class ProductCRUD:
    get = staticmethod(get)
    list_ = staticmethod(list_)
    create = staticmethod(create)


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