from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload
from typing import Any, List, Optional

from app.models.customer import Company, Customer, CustomerAddress, CustomerCompany, Store
from app.models.employee import Employee
from app.models.vinamilk import VinamilkOrderSnapshot
from app.schemas.customer import CustomerCreate, CustomerUpdate


def _extract_raw_str(raw: dict[str, Any], keys: tuple[str, ...]) -> str:
    for k in keys:
        val = raw.get(k)
        if val is not None and str(val).strip():
            return str(val).strip()
    return ""


def sync_customers_from_snapshots(
    db: Session,
    commit: bool = True,
    distributor_id: int | None = None,
) -> int:
    """Tự động khởi tạo Khách hàng trong bảng customers từ các đơn hàng đã đồng bộ (vinamilk_order_snapshots)
    nếu mã khách hàng đó chưa tồn tại trong danh mục của NPP tương ứng."""
    missing_snapshots = db.scalars(
        select(VinamilkOrderSnapshot)
        .where(
            VinamilkOrderSnapshot.customer_code.is_not(None),
            func.trim(VinamilkOrderSnapshot.customer_code) != "",
        )
        .order_by(VinamilkOrderSnapshot.id.desc())
    ).all()

    if not missing_snapshots:
        return 0

    from app.models.multi_tenant_invoice import Distributor

    dist_id_by_code = {
        (d.code or "").strip().upper(): d.id
        for d in db.scalars(select(Distributor)).all()
        if d.code
    }

    existing_keys = {
        (c_dist_id, (code or "").strip().upper())
        for c_dist_id, code in db.execute(select(Customer.distributor_id, Customer.code)).all()
        if code
    }
    created_count = 0
    for snap in missing_snapshots:
        raw_code = (snap.customer_code or "").strip()
        if not raw_code:
            continue
        clean_code = raw_code[:20]
        upper_code = clean_code.upper()
        if upper_code.startswith(("NVGH-", "NVBH-")) or upper_code == "NVBH":
            continue

        raw = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
        row_dist_code = _extract_raw_str(raw, ("Mã NPP", "distributorCode")).upper()
        resolved_dist_id = distributor_id or dist_id_by_code.get(row_dist_code)
        if (resolved_dist_id, upper_code) in existing_keys:
            continue
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
            distributor_id=resolved_dist_id,
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
        existing_keys.add((resolved_dist_id, upper_code))
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
            selectinload(Customer.company_links).selectinload(CustomerCompany.company),
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
            selectinload(Customer.company_links).selectinload(CustomerCompany.company),
            selectinload(Customer.addresses),
        )
        .order_by(Customer.distributor_id, Customer.code)
        .offset(skip)
        .limit(limit)
    )
    if distributor_id is not None:
        stmt = stmt.where(Customer.distributor_id == distributor_id)
    if company_id is not None:
        stmt = stmt.where(
            or_(
                Customer.company_id == company_id,
                Customer.company_links.any(CustomerCompany.company_id == company_id),
            )
        )
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


def _normalize_company_ids(
    company_ids: Optional[List[int]],
    company_id: Optional[int],
) -> List[int]:
    """Chuẩn hóa danh sách company_ids (giữ thứ tự, bỏ trùng). Nếu company_id có mặt thì ưu tiên đứng đầu."""
    ordered: list[int] = []
    seen: set[int] = set()
    if company_ids is not None:
        for cid in company_ids:
            if cid is not None and cid not in seen:
                seen.add(cid)
                ordered.append(int(cid))
        if company_id is not None and company_id not in seen:
            ordered.insert(0, int(company_id))
        elif company_id is not None and company_id in seen:
            ordered = [int(company_id)] + [cid for cid in ordered if cid != int(company_id)]
    elif company_id is not None:
        ordered.append(int(company_id))
    return ordered


def sync_customer_companies(
    db: Session,
    customer: Customer,
    company_ids: List[int],
) -> None:
    """Đồng bộ bảng customer_companies và cột customer.company_id (công ty chính)."""
    deduped: list[int] = []
    seen: set[int] = set()
    for cid in company_ids:
        if cid is not None and cid not in seen:
            seen.add(int(cid))
            deduped.append(int(cid))

    primary_id = deduped[0] if deduped else None
    customer.company_id = primary_id

    existing_links = list(
        db.scalars(select(CustomerCompany).where(CustomerCompany.customer_id == customer.id)).all()
    )
    existing_by_cid = {link.company_id: link for link in existing_links}
    desired_set = set(deduped)

    for link in existing_links:
        if link.company_id not in desired_set:
            db.delete(link)

    for cid in deduped:
        is_primary = cid == primary_id
        if cid in existing_by_cid:
            existing_by_cid[cid].is_primary = is_primary
        else:
            db.add(
                CustomerCompany(
                    customer_id=customer.id,
                    company_id=cid,
                    is_primary=is_primary,
                )
            )
    db.flush()


def validate_customer_links(
    db: Session,
    distributor_id: Optional[int],
    company_id: Optional[int],
    store_id: Optional[int],
    company_ids: Optional[List[int]] = None,
) -> None:
    """Ngăn chặn liên kết chéo Tenant (KH thuộc NPP A gắn Công ty/Cửa hàng của NPP B)."""
    all_company_ids = _normalize_company_ids(company_ids, company_id)
    for cid in all_company_ids:
        comp = db.get(Company, cid)
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
    raw_company_ids = data.pop("company_ids", None)
    resolved_company_ids = _normalize_company_ids(raw_company_ids, data.get("company_id"))
    data["company_id"] = resolved_company_ids[0] if resolved_company_ids else None
    validate_customer_links(
        db,
        data.get("distributor_id"),
        data.get("company_id"),
        data.get("store_id"),
        company_ids=resolved_company_ids,
    )
    manager_code, manager_name = resolve_manager_assignment(db, data.get("manager_code"))
    data["manager_code"] = manager_code
    data["manager_name"] = manager_name
    customer = Customer(**data)
    db.add(customer)
    db.flush()
    if resolved_company_ids:
        sync_customer_companies(db, customer, resolved_company_ids)
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
    has_company_ids = "company_ids" in data
    raw_company_ids = data.pop("company_ids", None)
    has_company_id = "company_id" in data

    next_dist_id = data.get("distributor_id", customer.distributor_id)
    next_store_id = data.get("store_id", customer.store_id)

    if has_company_ids:
        resolved_company_ids = _normalize_company_ids(
            raw_company_ids or [],
            data.get("company_id") if has_company_id else None,
        )
        data["company_id"] = resolved_company_ids[0] if resolved_company_ids else None
    elif has_company_id:
        cid = data.get("company_id")
        resolved_company_ids = [int(cid)] if cid is not None else []
    else:
        resolved_company_ids = None

    validate_customer_links(
        db,
        next_dist_id,
        data.get("company_id", customer.company_id),
        next_store_id,
        company_ids=resolved_company_ids if resolved_company_ids is not None else customer.company_ids,
    )
    if "manager_code" in data:
        data["manager_code"], data["manager_name"] = resolve_manager_assignment(db, data["manager_code"])
    for field, value in data.items():
        setattr(customer, field, value)
    if resolved_company_ids is not None:
        sync_customer_companies(db, customer, resolved_company_ids)
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
    sync_customer_companies = staticmethod(sync_customer_companies)


customer = CustomerCRUD()