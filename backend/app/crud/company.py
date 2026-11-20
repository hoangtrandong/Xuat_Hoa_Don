from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional

from app.models.customer import Company, Customer
from app.schemas.company import CompanyCreate, CompanyUpdate


def get(db: Session, company_id: int) -> Optional[Company]:
    comp = db.scalar(
        select(Company)
        .options(selectinload(Company.distributor))
        .where(Company.id == company_id)
    )
    if comp is not None:
        comp._customer_count = db.scalar(
            select(func.count(Customer.id)).where(Customer.company_id == comp.id)
        ) or 0
    return comp


def get_by_code(
    db: Session,
    code: str,
    distributor_id: Optional[int] = None,
) -> Optional[Company]:
    stmt = select(Company).where(Company.code == code)
    if distributor_id is not None:
        stmt = stmt.where(Company.distributor_id == distributor_id)
    else:
        stmt = stmt.where(Company.distributor_id.is_(None))
    return db.scalar(stmt)


def list_(
    db: Session,
    skip: int = 0,
    limit: int = 1000,
    status: Optional[str] = None,
    distributor_id: Optional[int] = None,
    q: Optional[str] = None,
) -> List[Company]:
    stmt = (
        select(Company)
        .options(selectinload(Company.distributor))
        .order_by(Company.distributor_id, Company.code)
        .offset(skip)
        .limit(limit)
    )
    if distributor_id is not None:
        stmt = stmt.where(Company.distributor_id == distributor_id)
    if status:
        stmt = stmt.where(Company.status == status)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Company.code.ilike(like),
                Company.name.ilike(like),
                Company.tax_code.ilike(like),
            )
        )
    companies = list(db.execute(stmt).scalars().all())
    if companies:
        ids = [c.id for c in companies]
        count_rows = db.execute(
            select(Customer.company_id, func.count(Customer.id))
            .where(Customer.company_id.in_(ids))
            .group_by(Customer.company_id)
        ).all()
        counts = {int(cid): int(cnt) for cid, cnt in count_rows if cid is not None}
        for c in companies:
            c._customer_count = counts.get(c.id, 0)
    return companies


def customer_count(db: Session, company: Company) -> int:
    return int(
        db.scalar(select(func.count(Customer.id)).where(Customer.company_id == company.id)) or 0
    )


def create(db: Session, obj_in: CompanyCreate) -> Company:
    company = Company(**obj_in.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    return get(db, company.id) or company


def update(db: Session, company: Company, obj_in: CompanyUpdate) -> Company:
    for field, value in obj_in.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    db.commit()
    db.refresh(company)
    return get(db, company.id) or company


def delete(db: Session, company: Company) -> None:
    db.delete(company)
    db.commit()


def customers_of_company(db: Session, company_id: int) -> List[Customer]:
    return list(
        db.execute(
            select(Customer)
            .options(selectinload(Customer.store))
            .where(Customer.company_id == company_id)
            .order_by(Customer.code)
        ).scalars().all()
    )


class CompanyCRUD:
    get = staticmethod(get)
    get_by_code = staticmethod(get_by_code)
    list_ = staticmethod(list_)
    customer_count = staticmethod(customer_count)
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)
    customers_of_company = staticmethod(customers_of_company)


company = CompanyCRUD()