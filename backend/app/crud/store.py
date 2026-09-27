from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List, Optional

from app.models.customer import Store
from app.schemas.store import StoreCreate, StoreUpdate


def get(db: Session, store_id: int) -> Optional[Store]:
    return db.get(Store, store_id)


def get_by_code(db: Session, code: str) -> Optional[Store]:
    return db.query(Store).filter(Store.code == code).first()


def list_(db: Session, skip: int = 0, limit: int = 1000, status: Optional[str] = None) -> List[Store]:
    stmt = (
        select(Store)
        .order_by(Store.code)
        .offset(skip)
        .limit(limit)
    )
    if status:
        stmt = stmt.where(Store.status == status)
    return list(db.execute(stmt).scalars().all())


def create(db: Session, obj_in: StoreCreate) -> Store:
    store = Store(**obj_in.model_dump())
    db.add(store)
    db.commit()
    db.refresh(store)
    return store


def update(db: Session, store: Store, obj_in: StoreUpdate) -> Store:
    for field, value in obj_in.model_dump(exclude_unset=True).items():
        setattr(store, field, value)
    db.commit()
    db.refresh(store)
    return store


def delete(db: Session, store: Store) -> None:
    # SET NULL giữ nguyên mã KH; chỉ xóa hồ sơ cửa hàng.
    db.delete(store)
    db.commit()


class StoreCRUD:
    get = staticmethod(get)
    get_by_code = staticmethod(get_by_code)
    list_ = staticmethod(list_)
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)


store = StoreCRUD()