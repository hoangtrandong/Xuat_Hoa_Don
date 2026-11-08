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
from app.models.customer import Customer, Store
from app.models.employee import Employee
from app.models.product import Product, ProductCategory, ProductUnit
from app.models.promotion import Promotion, PromotionItem, PromotionRule
from app.schemas.promotion import PromotionInput, PromotionRuleInput, RewardProductInput


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


def test_store_targeting_create_update_clone_and_available(db):
    session, product_id = db
    admin = SimpleNamespace(username="admin", roles=[])
    first = Store(code="STORE-A", name="Store A")
    second = Store(code="STORE-B", name="Store B")
    other = Store(code="STORE-C", name="Store C")
    session.add_all([first, second, other])
    session.flush()
    session.add_all([
        Customer(code="CA", name="A", type="RETAIL", store_id=first.id),
        Customer(code="CA2", name="A2", type="WHOLESALE", store_id=first.id),
        Customer(code="CB", name="B", type="RETAIL", store_id=second.id),
        Customer(code="CC", name="C", type="RETAIL", store_id=other.id),
        Customer(code="CN", name="No store", type="RETAIL"),
    ])
    session.commit()
    data = _payload(product_id).model_dump()
    data.update(target_scope="STORES", store_ids=[first.id, second.id])
    created = create_promotion(PromotionInput(**data), session, admin)
    assert created.store_ids == [first.id, second.id]
    for code in ("CA", "CA2", "CB"):
        assert [p.id for p in available_promotions(date(2026, 11, 4), code, db=session, current_user=admin)] == [created.id]
    for code in ("CC", "CN", None):
        assert available_promotions(date(2026, 11, 4), code, db=session, current_user=admin) == []
    cloned = clone_promotion(created.id, session, admin)
    assert cloned.store_ids == created.store_ids
    data["store_ids"] = [second.id, other.id]
    updated = update_promotion(created.id, PromotionInput(**data), session, admin)
    assert updated.store_ids == [second.id, other.id]
    assert available_promotions(date(2026, 11, 4), "CA", db=session, current_user=admin) == []
    assert [p.id for p in available_promotions(date(2026, 11, 4), "CC", db=session, current_user=admin)] == [created.id]
    data["store_ids"] = [999999]
    with pytest.raises(HTTPException, match="cửa hàng áp dụng không tồn tại"):
        create_promotion(PromotionInput(**data), session, admin)


@pytest.mark.parametrize("store_ids", [[], [1, 1], [0]])
def test_store_target_requires_valid_unique_store_ids(db, store_ids):
    _, product_id = db
    data = _payload(product_id).model_dump()
    data.update(target_scope="STORES", store_ids=store_ids)
    with pytest.raises(ValueError):
        PromotionInput(**data)


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
    assert details.product_min_quantities == {product_id: 1}
    assert len(details.rules) == 1
    assert details.rules[0].min_quantity == 2
    assert details.rules[0].reward_value == 3
    assert len(available_promotions(date(2026, 11, 4), db=session, current_user=admin)) == 1
    assert len(available_promotions(date(2026, 12, 1), db=session, current_user=admin)) == 0

    legacy = Promotion(
        code="KM-LEGACY-INVOICE",
        name="Legacy invoice amount",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        promotion_kind="INVOICE_AMOUNT",
        items=[PromotionItem(product_id=product_id)],
        rules=[PromotionRule(trigger_type="AMOUNT", min_amount=50000, reward_type="DISCOUNT_AMOUNT", reward_value=1000)],
    )
    session.add(legacy)
    session.commit()
    available = available_promotions(date(2026, 11, 4), db=session, current_user=admin)
    assert [promotion.id for promotion in available] == [created.id]

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
    assert [promotion.id for promotion in list_promotions(session, admin)] == [legacy.id, created.id]


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


def test_promotion_rules_validate_range_bounds():
    with pytest.raises(ValueError, match="Số lượng đến"):
        PromotionRuleInput(
            trigger_type="QUANTITY",
            min_quantity=5,
            max_quantity=4,
            reward_type="FREE_QUANTITY",
            reward_value=1,
        )
    with pytest.raises(ValueError, match="Giá trị đến"):
        PromotionRuleInput(
            trigger_type="AMOUNT",
            min_amount=50000,
            max_amount=40000,
            reward_type="DISCOUNT_AMOUNT",
            reward_value=1000,
        )


def test_promotion_rejects_unsupported_total_amount_modes(db):
    session, product_id = db
    payload = _payload(product_id).model_dump()
    payload["promotion_kind"] = "INVOICE_AMOUNT"
    with pytest.raises(ValueError, match="chưa được hỗ trợ"):
        PromotionInput.model_validate(payload)

    payload["promotion_kind"] = "GENERAL"
    payload["applied_quantity_unit"] = "SECONDARY"
    with pytest.raises(ValueError, match="đơn vị tính chuẩn"):
        PromotionInput.model_validate(payload)


def test_promotion_form_metadata_and_reward_product_round_trip(db):
    session, product_id = db
    admin = SimpleNamespace(username="admin", roles=[])
    reward_product = Product(
        sku="PROMO-REWARD-02",
        name="Second reward product",
        category_id=session.get(Product, product_id).category_id,
        unit_id=session.get(Product, product_id).unit_id,
        supplier="Supplier A",
    )
    session.add(reward_product)
    session.commit()
    payload = _payload(product_id)
    payload.applied_quantity_unit = "STANDARD"
    payload.minimum_product_quantity = 3
    payload.product_min_quantities = {product_id: 5}
    payload.rules[0].reward_product_id = product_id
    payload.rules[0].reward_product_ids = [product_id, reward_product.id]
    payload.rules[0].reward_product_operator = "OR"
    payload.rules[0].max_quantity = 5

    created = create_promotion(payload, session, admin)
    assert created.promotion_kind == "GENERAL"
    assert created.applied_quantity_unit == "STANDARD"
    assert created.minimum_product_quantity == 3
    assert created.product_min_quantities == {product_id: 5}
    assert created.rules[0].reward_product_id == product_id
    assert created.rules[0].max_quantity == 5

    assert created.rules[0].reward_product_ids == [product_id, reward_product.id]
    assert created.rules[0].reward_product_operator == "OR"

    clone = clone_promotion(created.id, session, admin)
    assert clone.product_min_quantities == {product_id: 5}
    assert clone.rules[0].reward_product_id == product_id
    assert clone.rules[0].reward_product_ids == [product_id, reward_product.id]
    assert clone.rules[0].reward_product_operator == "OR"
    assert clone.rules[0].max_quantity == 5


def test_promotion_reward_product_and_or_groups_round_trip_and_clone(db):
    session, product_id = db
    admin = SimpleNamespace(username="admin", roles=[])
    category_id = session.get(Product, product_id).category_id
    unit_id = session.get(Product, product_id).unit_id
    alternative = Product(
        sku="PROMO-ALT",
        name="Alternative reward",
        category_id=category_id,
        unit_id=unit_id,
        supplier="Supplier A",
    )
    additional = Product(
        sku="PROMO-AND",
        name="Additional reward",
        category_id=category_id,
        unit_id=unit_id,
        supplier="Supplier A",
    )
    session.add_all([alternative, additional])
    session.commit()

    payload = _payload(product_id)
    payload.rules[0].reward_product_details = [
        [
            RewardProductInput(product_id=product_id, quantity=2, unit="BOX"),
            RewardProductInput(product_id=alternative.id, quantity=1, unit="CARTON"),
        ],
        [RewardProductInput(product_id=additional.id, quantity=4, unit="BOX")],
    ]
    created = create_promotion(payload, session, admin)

    assert created.rules[0].reward_product_groups == [[product_id, alternative.id], [additional.id]]
    expected_details = [
        [
            {"product_id": product_id, "quantity": 2, "unit": "BOX"},
            {"product_id": alternative.id, "quantity": 1, "unit": "CARTON"},
        ],
        [{"product_id": additional.id, "quantity": 4, "unit": "BOX"}],
    ]
    assert [
        [item.model_dump() for item in group]
        for group in created.rules[0].reward_product_details
    ] == expected_details
    clone = clone_promotion(created.id, session, admin)
    assert clone.rules[0].reward_product_groups == [[product_id, alternative.id], [additional.id]]
    assert [
        [item.model_dump() for item in group]
        for group in clone.rules[0].reward_product_details
    ] == expected_details


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
        "promotion_type": "ORDER",
        "promotion_kind": "GENERAL",
    })
    promotion = create_promotion(supplier_payload, session, admin)

    assert promotion.product_scope == "SUPPLIER"
    assert promotion.product_ids == []
    assert promotion.customer_type == "RETAIL"
    assert promotion.employee_code == "NV001"
    assert promotion.vat_rate == 8
    assert promotion.promotion_type == "ORDER"
    assert promotion.promotion_kind == "GENERAL"
    assert len(available_promotions(date(2026, 11, 4), "0MD", "NV001", session, admin)) == 1
    assert available_promotions(date(2026, 11, 4), "0MD", "NV002", session, admin) == []
