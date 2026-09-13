from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional

from app.models.customer import Company, Customer
from app.schemas.company import CompanyCreate, CompanyUpdate


def get(db: Session, company_id: int) -> Optional[Company]:
    return db.get(Company, company_id)


def get_by_code(db: Session, code: str) -> Optional[Company]:
    return db.query(Company).filter(Company.code == code).first()


def list_(db: Session, skip: int = 0, limit: int = 1000, status: Optional[str] = None) -> List[Company]:
    stmt = (
        select(Company)
        .options(selectinload(Company.customers))
        .order_by(Company.code)
        .offset(skip)
        .limit(limit)
    )
    if status:
        stmt = stmt.where(Company.status == status)
    return list(db.execute(stmt).scalars().all())


def customer_count(db: Session, company: Company) -> int:
    return len(company.customers)


def create(db: Session, obj_in: CompanyCreate) -> Company:
    company = Company(**obj_in.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


def update(db: Session, company: Company, obj_in: CompanyUpdate) -> Company:
    for field, value in obj_in.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    db.commit()
    db.refresh(company)
    return company


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