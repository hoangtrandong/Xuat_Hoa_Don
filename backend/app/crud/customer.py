from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload
from typing import Any, List, Optional

from app.models.customer import Company, Customer, CustomerAddress, Store
from app.models.employee import Employee
from app.models.vinamilk import VinamilkOrderSnapshot
from app.schemas.customer import CustomerCreate, CustomerUpdate


def _extract_raw_str(raw: dict[str, Any], keys: tuple[str, ...]) -> str:
    for k in keys:
        val = raw.get(k)
        if val is not None and str(val).strip():
            return str(val).strip()
    return ""


def sync_customers_from_snapshots(db: Session, commit: bool = True) -> int:
    """Tự động khởi tạo Khách hàng trong bảng customers từ các đơn hàng đã đồng bộ (vinamilk_order_snapshots)
    nếu mã khách hàng đó chưa tồn tại trong danh mục."""
    missing_snapshots = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(
            VinamilkOrderSnapshot.customer_code.is_not(None),
            func.trim(VinamilkOrderSnapshot.customer_code) != "",
            ~func.upper(func.trim(VinamilkOrderSnapshot.customer_code)).in_(
                select(func.upper(func.trim(Customer.code))).where(Customer.code.is_not(None))
            ),
        )
        .order_by(VinamilkOrderSnapshot.id.desc())
    ).all()

    if not missing_snapshots:
        return 0

    from app.models.multi_tenant_invoice import Distributor

    default_mg_id = db.scalar(
        select(Distributor.id)
        .where(
            or_(
                func.upper(Distributor.code) == "NPP-MAIGOLD",
                func.lower(Distributor.name).like("%mai gold%"),
            )
        )
        .order_by(Distributor.id)
    )

    existing_upper = {
        (code or "").strip().upper()
        for code in db.scalars(select(Customer.code)).all()
        if code
    }
    created_count = 0
    for snap in missing_snapshots:
        raw_code = (snap.customer_code or "").strip()
        if not raw_code:
            continue
        clean_code = raw_code[:20]
        upper_code = clean_code.upper()
        if upper_code in existing_upper:
            continue
        if upper_code.startswith(("NVGH-", "NVBH-")) or upper_code == "NVBH":
            continue

        raw = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
        name = (
            (snap.customer_name or "").strip()
            or _extract_raw_str(raw, ("Tên KH", "customerName", "shopName"))
            or clean_code
        )[:160]
        address = _extract_raw_str(raw, ("Địa chỉ", "customerAddress", "address", "shipTo"))[:255]
        tax_code = _extract_raw_str(raw, ("Mã số thuế", "customerTaxCode", "taxCode", "MST"))[:30] or None
        phone = _extract_raw_str(raw, ("Điện thoại", "phone", "CustomerPhone", "Phone", "SDT"))[:30] or None
        staff_code = _extract_raw_str(raw, ("Mã NVBH", "staffCode", "salesStaffCode"))[:50] or None
        staff_name = _extract_raw_str(raw, ("Tên NVBH", "staffName", "salesStaffName"))[:160] or None

        new_cust = Customer(
            distributor_id=default_mg_id,
            code=clean_code,
            name=name,
            type="RETAIL",
            tier="B",
            phone=phone,
            status="active",
            tax_code=tax_code,
            staff_code=staff_code,
            staff_name=staff_name,
        )
        db.add(new_cust)
        if address:
            db.flush()
            db.add(
                CustomerAddress(
                    customer_id=new_cust.id,
                    label="Địa chỉ DMS",
                    address=address,
                    district="",
                    city="",
                    is_default=True,
                )
            )
        existing_upper.add(upper_code)
        created_count += 1

    if created_count > 0 and commit:
        db.commit()
    return created_count


def get(db: Session, customer_id: int) -> Optional[Customer]:
    return db.scalar(
        select(Customer)
        .options(
            selectinload(Customer.distributor),
            selectinload(Customer.store),
            selectinload(Customer.company),
            selectinload(Customer.addresses),
        )
        .where(Customer.id == customer_id)
    )


def get_by_code(
    db: Session,
    code: str,
    distributor_id: Optional[int] = None,
) -> Optional[Customer]:
    stmt = select(Customer).where(Customer.code == code)
    if distributor_id is not None:
        stmt = stmt.where(Customer.distributor_id == distributor_id)
    else:
        stmt = stmt.where(Customer.distributor_id.is_(None))
    return db.scalar(stmt)


def list_(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    distributor_id: Optional[int] = None,
    company_id: Optional[int] = None,
    q: Optional[str] = None,
) -> List[Customer]:
    if distributor_id is None:
        try:
            sync_customers_from_snapshots(db, commit=True)
        except Exception:
            db.rollback()
    stmt = (
        select(Customer)
        .options(
            selectinload(Customer.distributor),
            selectinload(Customer.store),
            selectinload(Customer.company),
            selectinload(Customer.addresses),
        )
        .order_by(Customer.distributor_id, Customer.code)
        .offset(skip)
        .limit(limit)
    )
    if distributor_id is not None:
        stmt = stmt.where(Customer.distributor_id == distributor_id)
    if company_id is not None:
        stmt = stmt.where(Customer.company_id == company_id)
    if status:
        stmt = stmt.where(Customer.status == status)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Customer.code.ilike(like),
                Customer.name.ilike(like),
                Customer.tax_code.ilike(like),
                Customer.phone.ilike(like),
            )
        )
    return list(db.execute(stmt).scalars().all())


def validate_customer_links(
    db: Session,
    distributor_id: Optional[int],
    company_id: Optional[int],
    store_id: Optional[int],
) -> None:
    """Ngăn chặn liên kết chéo Tenant (KH thuộc NPP A gắn Công ty/Cửa hàng của NPP B)."""
    if company_id is not None:
        comp = db.get(Company, company_id)
        if comp is None:
            raise ValueError("Công ty quản lý không tồn tại.")
        if distributor_id is not None and comp.distributor_id is not None and comp.distributor_id != distributor_id:
            raise ValueError("Công ty quản lý được chọn không thuộc cùng Nhà phân phối với khách hàng.")
    if store_id is not None:
        store = db.get(Store, store_id)
        if store is None:
            raise ValueError("Cửa hàng không tồn tại.")
        if distributor_id is not None and store.distributor_id is not None and store.distributor_id != distributor_id:
            raise ValueError("Cửa hàng được chọn không thuộc cùng Nhà phân phối với khách hàng.")


def resolve_manager_assignment(db: Session, manager_code: str | None) -> tuple[str | None, str | None]:
    code = (manager_code or "").strip().upper()
    if not code:
        return None, None
    if not code.startswith("NV"):
        raise ValueError("Mã NVQL phải bắt đầu bằng NV.")
    employee = db.scalar(select(Employee).where(func.upper(Employee.code) == code))
    if employee is None:
        raise ValueError(f"Không tìm thấy nhân viên có mã {code}.")
    return employee.code, employee.name


def create(db: Session, obj_in: CustomerCreate) -> Customer:
    data = obj_in.model_dump()
    store_route = data.pop("store_route", None)
    validate_customer_links(db, data.get("distributor_id"), data.get("company_id"), data.get("store_id"))
    manager_code, manager_name = resolve_manager_assignment(db, data.get("manager_code"))
    data["manager_code"] = manager_code
    data["manager_name"] = manager_name
    customer = Customer(**data)
    db.add(customer)
    if customer.store_id and store_route is not None:
        store = db.get(Store, customer.store_id)
        if store:
            store.route = store_route.strip() or None
    db.commit()
    db.refresh(customer)
    return get(db, customer.id) or customer


def update(db: Session, customer: Customer, obj_in: CustomerUpdate) -> Customer:
    data = obj_in.model_dump(exclude_unset=True)
    store_route = data.pop("store_route", None)
    next_dist_id = data.get("distributor_id", customer.distributor_id)
    next_company_id = data.get("company_id", customer.company_id)
    next_store_id = data.get("store_id", customer.store_id)
    validate_customer_links(db, next_dist_id, next_company_id, next_store_id)
    if "manager_code" in data:
        data["manager_code"], data["manager_name"] = resolve_manager_assignment(db, data["manager_code"])
    for field, value in data.items():
        setattr(customer, field, value)
    if customer.store_id and store_route is not None:
        store = db.get(Store, customer.store_id)
        if store:
            store.route = store_route.strip() or None
    db.commit()
    db.refresh(customer)
    return get(db, customer.id) or customer


def delete(db: Session, customer: Customer) -> None:
    if customer.sales_orders:
        raise ValueError("Không thể xóa khách hàng đã phát sinh đơn hàng.")
    db.delete(customer)
    db.commit()


class CustomerCRUD:
    get = staticmethod(get)
    get_by_code = staticmethod(get_by_code)
    list_ = staticmethod(list_)
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)
    sync_customers_from_snapshots = staticmethod(sync_customers_from_snapshots)
    resolve_manager_assignment = staticmethod(resolve_manager_assignment)


customer = CustomerCRUD()