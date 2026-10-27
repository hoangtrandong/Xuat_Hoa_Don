import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.product_groups import update_group_distributor_code
from app.core.database import Base
from app.models.customer import Company
from app.models.product import (
    Product,
    ProductCategory,
    ProductGroup,
    ProductGroupCompany,
    ProductGroupItem,
    ProductUnit,
)
from app.schemas.product_group import ProductGroupDistributorCodeUpdate


@pytest.fixture
def group_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        category = ProductCategory(code="NPPTEST", name="NPP test")
        unit = ProductUnit(code="NPPTEST", name="NPP test")
        db.add_all([category, unit])
        db.flush()
        product = Product(
            sku="NPPTEST01",
            name="NPP test product",
            category_id=category.id,
            unit_id=unit.id,
        )
        db.add(product)
        db.flush()
        group = ProductGroup(
            name=product.name,
            representative_product_id=product.id,
            items=[ProductGroupItem(product_id=product.id)],
        )
        company_a = Company(code="NPP-A", name="Company A")
        company_b = Company(code="NPP-B", name="Company B")
        db.add_all([group, company_a, company_b])
        db.flush()
        db.add_all([
            ProductGroupCompany(
                product_group_id=group.id,
                company_id=company_a.id,
                distributor_sku="0001",
                distributor_name="Old name",
            ),
            ProductGroupCompany(
                product_group_id=group.id,
                company_id=company_b.id,
                distributor_sku="0001",
                distributor_name="Old name",
            ),
        ])
        db.commit()
        yield db, group, company_a, company_b
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_update_distributor_code_updates_all_group_company_links(group_db):
    db, group, company_a, company_b = group_db

    result = update_group_distributor_code(
        group.id,
        ProductGroupDistributorCodeUpdate(
            distributor_sku=" 0002 ",
            distributor_name=" New product name ",
        ),
        db,
    )

    assert result["companies_updated"] == 2
    links = db.scalars(
        select(ProductGroupCompany)
        .where(ProductGroupCompany.product_group_id == group.id)
        .order_by(ProductGroupCompany.company_id)
    ).all()
    assert [link.company_id for link in links] == [company_a.id, company_b.id]
    assert {(link.distributor_sku, link.distributor_name) for link in links} == {
        ("0002", "New product name")
    }


def test_update_distributor_code_rejects_code_used_by_another_group(group_db):
    db, group, company_a, _ = group_db
    other_group = ProductGroup(
        name="Another group",
        representative_product_id=group.representative_product_id,
    )
    db.add(other_group)
    db.flush()
    db.add(
        ProductGroupCompany(
            product_group_id=other_group.id,
            company_id=company_a.id,
            distributor_sku="0003",
        )
    )
    db.commit()

    with pytest.raises(HTTPException) as error:
        update_group_distributor_code(
            group.id,
            ProductGroupDistributorCodeUpdate(distributor_sku="0003"),
            db,
        )

    assert error.value.status_code == 409
    assert db.scalar(
        select(ProductGroupCompany.distributor_sku).where(
            ProductGroupCompany.product_group_id == group.id
        )
    ) == "0001"


def test_update_distributor_code_rejects_numeric_code_with_wrong_width(group_db):
    db, group, _, _ = group_db

    with pytest.raises(HTTPException) as error:
        update_group_distributor_code(
            group.id,
            ProductGroupDistributorCodeUpdate(distributor_sku="12345"),
            db,
        )

    assert error.value.status_code == 422
