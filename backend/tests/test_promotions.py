from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints.promotions import (
    available_promotions,
    clone_promotion,
    create_promotion,
    delete_promotion,
    get_promotion,
    list_promotions,
    toggle_promotion_lock,
    update_promotion,
)
from app.core.database import Base
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.product import Product, ProductCategory, ProductUnit
from app.schemas.promotion import PromotionInput, PromotionRuleInput


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = ProductCategory(code="CAT", name="Category")
        unit = ProductUnit(code="BOX", name="Box")
        session.add_all([category, unit])
        session.flush()
        product = Product(sku="PROMO-01", name="Product", category_id=category.id, unit_id=unit.id, supplier="Supplier A")
        session.add(product)
        session.commit()
        yield session, product.id
    engine.dispose()


def _payload(product_id: int) -> PromotionInput:
    return PromotionInput(
        name="Summer deal",
        description="Promotion test",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        product_ids=[product_id],
        rules=[
            PromotionRuleInput(
                trigger_type="QUANTITY",
                min_quantity=2,
                quantity_unit="CARTON",
                reward_type="FREE_QUANTITY",
                reward_value=3,
                reward_unit="BOX",
            )
        ],
    )


def test_promotion_crud_available_lock_and_clone(db):
    session, product_id = db
    admin = SimpleNamespace(username="admin", roles=[])
    created = create_promotion(_payload(product_id), session, admin)

    assert created.code.startswith("KM-")
    assert created.product_ids == [product_id]
    assert created.rules[0].trigger_type == "QUANTITY"
    assert created.rules[0].quantity_unit == "CARTON"
    assert created.rules[0].reward_unit == "BOX"
    details = get_promotion(created.id, session, admin)
    assert details.name == "Summer deal"
    assert details.product_ids == [product_id]
    assert len(details.rules) == 1
    assert details.rules[0].min_quantity == 2
    assert details.rules[0].reward_value == 3
    assert len(available_promotions(date(2026, 11, 4), db=session, current_user=admin)) == 1
    assert len(available_promotions(date(2026, 12, 1), db=session, current_user=admin)) == 0

    locked = toggle_promotion_lock(created.id, True, session, admin)
    assert locked.is_locked
    with pytest.raises(HTTPException) as exc:
        update_promotion(created.id, _payload(product_id), session, admin)
    assert exc.value.status_code == 409

    clone = clone_promotion(created.id, session, admin)
    assert clone.name == "Summer deal (Bản sao)"
    assert clone.is_active is False
    assert clone.product_ids == [product_id]
    delete_promotion(clone.id, session, admin)
    assert [promotion.id for promotion in list_promotions(session, admin)] == [created.id]


def test_authenticated_users_can_read_promotions_but_only_admins_can_create(db):
    session, product_id = db
    user = SimpleNamespace(username="sales", roles=[])
    assert list_promotions(session, user) == []
    with pytest.raises(HTTPException) as exc:
        create_promotion(_payload(product_id), session, user)
    assert exc.value.status_code == 403


def test_promotion_rules_validate_rewards():
    with pytest.raises(ValueError):
        PromotionRuleInput(
            trigger_type="AMOUNT",
            min_amount=50000,
            reward_type="DISCOUNT_PERCENT",
            reward_value=110,
        )


def test_promotion_can_target_supplier_and_customer_employee(db):
    session, _ = db
    admin = SimpleNamespace(username="admin", roles=[])
    session.add(Customer(code="0MD", name="Retail customer", type="RETAIL"))
    session.add(Employee(code="NV001", name="Sales representative", position="Sales", phone=""))
    session.commit()
    supplier_payload = _payload(1).model_copy(update={
        "product_scope": "SUPPLIER",
        "supplier": "Supplier A",
        "product_ids": [],
        "target_scope": "CUSTOMER_TYPE",
        "customer_type": "RETAIL",
        "employee_code": "NV001",
        "vat_rate": 8,
    })
    promotion = create_promotion(supplier_payload, session, admin)

    assert promotion.product_scope == "SUPPLIER"
    assert promotion.product_ids == []
    assert promotion.customer_type == "RETAIL"
    assert promotion.employee_code == "NV001"
    assert promotion.vat_rate == 8
    assert len(available_promotions(date(2026, 11, 4), "0MD", "NV001", session, admin)) == 1
    assert available_promotions(date(2026, 11, 4), "0MD", "NV002", session, admin) == []
