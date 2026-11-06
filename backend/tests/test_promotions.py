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
    list_promotions,
    toggle_promotion_lock,
    update_promotion,
)
from app.core.database import Base
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
        product = Product(sku="PROMO-01", name="Product", category_id=category.id, unit_id=unit.id)
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
                trigger_type="CARTON",
                min_cartons=2,
                reward_type="FREE_QUANTITY",
                reward_value=3,
            )
        ],
    )


def test_promotion_crud_available_lock_and_clone(db):
    session, product_id = db
    admin = SimpleNamespace(username="admin", roles=[])
    created = create_promotion(_payload(product_id), session, admin)

    assert created.code.startswith("KM-")
    assert created.product_ids == [product_id]
    assert len(available_promotions(date(2026, 11, 4), session, admin)) == 1
    assert len(available_promotions(date(2026, 12, 1), session, admin)) == 0

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


def test_promotion_management_requires_admin(db):
    session, _ = db
    user = SimpleNamespace(username="sales", roles=[])
    with pytest.raises(HTTPException) as exc:
        list_promotions(session, user)
    assert exc.value.status_code == 403


def test_promotion_rules_validate_rewards():
    with pytest.raises(ValueError):
        PromotionRuleInput(
            trigger_type="AMOUNT",
            min_amount=50000,
            reward_type="DISCOUNT_PERCENT",
            reward_value=110,
        )
