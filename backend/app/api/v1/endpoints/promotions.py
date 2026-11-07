from datetime import date, datetime, time, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.customer import Customer
from app.models.product import Product
from app.models.promotion import Promotion, PromotionItem, PromotionRule
from app.models.user import User
from app.schemas.promotion import PromotionInput, PromotionOutput, PromotionStatusUpdate

router = APIRouter(prefix="/promotions", tags=["Promotions"])


def _require_admin(user: User) -> None:
    roles = getattr(user, "roles", None) or []
    if (getattr(user, "username", "") or "").strip().lower() == "admin":
        return
    if not any((getattr(role, "name", "") or "").strip().lower() == "admin" for role in roles):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý chương trình khuyến mãi.")


def _load_promotion(db: Session, promotion_id: int) -> Promotion:
    promotion = db.scalar(
        select(Promotion)
        .options(selectinload(Promotion.rules), selectinload(Promotion.items))
        .where(Promotion.id == promotion_id)
    )
    if promotion is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy chương trình khuyến mãi.")
    return promotion


def _to_output(promotion: Promotion) -> PromotionOutput:
    return PromotionOutput(
        id=promotion.id,
        code=promotion.code,
        name=promotion.name,
        description=promotion.description,
        start_date=promotion.start_date,
        end_date=promotion.end_date,
        is_active=promotion.is_active,
        is_locked=promotion.is_locked,
        promotion_type=promotion.promotion_type,
        promotion_kind=promotion.promotion_kind,
        target_scope=promotion.target_scope,
        customer_type=promotion.customer_type,
        employee_code=promotion.employee_code,
        vat_rate=promotion.vat_rate,
        product_scope=promotion.product_scope,
        supplier=promotion.supplier,
        applied_quantity_unit=promotion.applied_quantity_unit,
        minimum_product_quantity=promotion.minimum_product_quantity,
        product_ids=[item.product_id for item in promotion.items],
        product_min_quantities={item.product_id: item.min_quantity for item in promotion.items},
        rules=promotion.rules,
    )


def _new_code() -> str:
    return f"KM-{datetime.now():%y%m%d}-{uuid4().hex[:6].upper()}"


def _replace_details(db: Session, promotion: Promotion, payload: PromotionInput) -> None:
    product_ids = set(payload.product_ids)
    if product_ids:
        existing_products = set(db.scalars(select(Product.id).where(Product.id.in_(product_ids))).all())
        if existing_products != product_ids:
            raise HTTPException(status_code=400, detail="Một hoặc nhiều sản phẩm áp dụng không tồn tại.")
        if payload.product_scope == "SUPPLIER":
            selected_suppliers = {
                (supplier or "").strip().casefold()
                for supplier in db.scalars(select(Product.supplier).where(Product.id.in_(product_ids))).all()
            }
            if selected_suppliers != {(payload.supplier or "").strip().casefold()}:
                raise HTTPException(status_code=400, detail="Sản phẩm đã chọn không khớp nhà cung cấp.")
    elif payload.product_scope == "SUPPLIER":
        supplier_exists = db.scalar(select(Product.id).where(Product.supplier == payload.supplier).limit(1))
        if supplier_exists is None:
            raise HTTPException(status_code=400, detail="Không tìm thấy sản phẩm thuộc nhà cung cấp đã chọn.")

    if payload.employee_code:
        from app.models.employee import Employee

        employee = db.scalar(select(Employee).where(Employee.code == payload.employee_code, Employee.status == "active"))
        if employee is None:
            raise HTTPException(status_code=400, detail="Nhân viên áp dụng không tồn tại hoặc không hoạt động.")

    reward_product_ids = {rule.reward_product_id for rule in payload.rules if rule.reward_product_id is not None}
    if reward_product_ids:
        existing_reward_products = set(
            db.scalars(select(Product.id).where(Product.id.in_(reward_product_ids))).all()
        )
        if existing_reward_products != reward_product_ids:
            raise HTTPException(status_code=400, detail="Một hoặc nhiều sản phẩm khuyến mại không tồn tại.")

    promotion.name = payload.name.strip()
    promotion.description = payload.description
    promotion.start_date = payload.start_date
    promotion.end_date = payload.end_date
    promotion.is_active = payload.is_active
    promotion.promotion_type = payload.promotion_type
    promotion.promotion_kind = payload.promotion_kind
    promotion.target_scope = payload.target_scope
    promotion.customer_type = payload.customer_type
    promotion.employee_code = payload.employee_code
    promotion.vat_rate = payload.vat_rate
    promotion.product_scope = payload.product_scope
    promotion.supplier = payload.supplier.strip() if payload.supplier else None
    promotion.applied_quantity_unit = payload.applied_quantity_unit
    promotion.minimum_product_quantity = payload.minimum_product_quantity
    promotion.items = [
        PromotionItem(
            product_id=product_id,
            min_quantity=max(1, payload.product_min_quantities.get(product_id, 1)),
        )
        for product_id in sorted(product_ids)
    ]
    promotion.rules = [
        PromotionRule(
            trigger_type=rule.trigger_type,
            min_qty=rule.min_quantity or 1,
            min_cartons=rule.min_quantity if rule.quantity_unit == "CARTON" else None,
            min_quantity=rule.min_quantity,
            quantity_unit=rule.quantity_unit,
            min_amount=rule.min_amount,
            reward_type=rule.reward_type,
            reward_value=rule.reward_value,
            free_quantity=int(rule.reward_value) if rule.reward_type == "FREE_QUANTITY" else 0,
            reward_unit=rule.reward_unit,
            discount_amount=rule.reward_value if rule.reward_type == "DISCOUNT_AMOUNT" else 0,
            discount_percent=rule.reward_value if rule.reward_type == "DISCOUNT_PERCENT" else 0,
            reward_product_id=rule.reward_product_id,
        )
        for rule in payload.rules
    ]


@router.get("", response_model=list[PromotionOutput])
def list_promotions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    promotions = db.scalars(
        select(Promotion)
        .options(selectinload(Promotion.rules), selectinload(Promotion.items))
        .order_by(Promotion.start_date.desc(), Promotion.id.desc())
    ).all()
    return [_to_output(promotion) for promotion in promotions]


@router.get("/available", response_model=list[PromotionOutput])
def available_promotions(
    on_date: date | None = None,
    customer_code: str | None = None,
    employee_code: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_date = on_date or date.today()
    day_start = datetime.combine(target_date, time.min)
    day_end = day_start + timedelta(days=1)
    customer = None
    if customer_code:
        customer = db.scalar(select(Customer).where(Customer.code == customer_code))
        if customer is None:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy khách hàng {customer_code}.")
    promotions = db.scalars(
        select(Promotion)
        .options(selectinload(Promotion.rules), selectinload(Promotion.items))
        .where(
            Promotion.is_active.is_(True),
            Promotion.is_locked.is_(False),
            Promotion.promotion_type == "ORDER",
            Promotion.start_date < day_end,
            Promotion.end_date >= day_start,
        )
        .order_by(Promotion.name)
    ).all()
    promotions = [
        promotion
        for promotion in promotions
        if (promotion.target_scope != "CUSTOMER_TYPE" or customer is None or promotion.customer_type == customer.type)
        and (
            not promotion.employee_code
            or (promotion.employee_code.strip().casefold() == (employee_code or "").strip().casefold())
        )
    ]
    return [_to_output(promotion) for promotion in promotions]


@router.post("", response_model=PromotionOutput, status_code=status.HTTP_201_CREATED)
def create_promotion(
    payload: PromotionInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    promotion = Promotion(
        code=_new_code(),
        name=payload.name.strip(),
        description=payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
        is_active=payload.is_active,
        promotion_type=payload.promotion_type,
        promotion_kind=payload.promotion_kind,
        target_scope=payload.target_scope,
        customer_type=payload.customer_type,
        employee_code=payload.employee_code,
        vat_rate=payload.vat_rate,
        product_scope=payload.product_scope,
        supplier=payload.supplier,
        applied_quantity_unit=payload.applied_quantity_unit,
        minimum_product_quantity=payload.minimum_product_quantity,
    )
    _replace_details(db, promotion, payload)
    db.add(promotion)
    db.commit()
    return _to_output(_load_promotion(db, promotion.id))


@router.get("/{promotion_id}", response_model=PromotionOutput)
def get_promotion(
    promotion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    return _to_output(_load_promotion(db, promotion_id))


@router.put("/{promotion_id}", response_model=PromotionOutput)
def update_promotion(
    promotion_id: int,
    payload: PromotionInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    promotion = _load_promotion(db, promotion_id)
    if promotion.is_locked:
        raise HTTPException(status_code=409, detail="Chương trình đang bị khóa, hãy mở khóa trước khi sửa.")
    _replace_details(db, promotion, payload)
    db.commit()
    return _to_output(_load_promotion(db, promotion_id))


@router.patch("/{promotion_id}/status", response_model=PromotionOutput)
def update_promotion_status(
    promotion_id: int,
    payload: PromotionStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    promotion = _load_promotion(db, promotion_id)
    promotion.is_active = payload.is_active
    db.commit()
    return _to_output(_load_promotion(db, promotion_id))


@router.patch("/{promotion_id}/lock", response_model=PromotionOutput)
def toggle_promotion_lock(
    promotion_id: int,
    locked: bool,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    promotion = _load_promotion(db, promotion_id)
    promotion.is_locked = locked
    db.commit()
    return _to_output(_load_promotion(db, promotion_id))


@router.post("/{promotion_id}/clone", response_model=PromotionOutput, status_code=status.HTTP_201_CREATED)
def clone_promotion(
    promotion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    original = _load_promotion(db, promotion_id)
    clone = Promotion(
        code=_new_code(),
        name=f"{original.name} (Bản sao)",
        description=original.description,
        start_date=original.start_date,
        end_date=original.end_date,
        is_active=False,
        is_locked=False,
        promotion_type=original.promotion_type,
        promotion_kind=original.promotion_kind,
        target_scope=original.target_scope,
        customer_type=original.customer_type,
        employee_code=original.employee_code,
        vat_rate=original.vat_rate,
        product_scope=original.product_scope,
        supplier=original.supplier,
        applied_quantity_unit=original.applied_quantity_unit,
        minimum_product_quantity=original.minimum_product_quantity,
        items=[
            PromotionItem(product_id=item.product_id, min_quantity=item.min_quantity)
            for item in original.items
        ],
        rules=[
            PromotionRule(
                min_qty=rule.min_qty,
                discount_percent=rule.discount_percent,
                discount_amount=rule.discount_amount,
                trigger_type=rule.trigger_type,
                min_cartons=rule.min_cartons,
                min_quantity=rule.min_quantity,
                quantity_unit=rule.quantity_unit,
                min_amount=rule.min_amount,
                free_quantity=rule.free_quantity,
                reward_unit=rule.reward_unit,
                reward_type=rule.reward_type,
                reward_value=rule.reward_value,
                reward_product_id=rule.reward_product_id,
            )
            for rule in original.rules
        ],
    )
    db.add(clone)
    db.commit()
    return _to_output(_load_promotion(db, clone.id))


@router.delete("/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_promotion(
    promotion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    promotion = _load_promotion(db, promotion_id)
    db.delete(promotion)
    db.commit()
    return None
