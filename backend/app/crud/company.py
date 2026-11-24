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


def _make_short_company_name(full_name: str | None) -> str | None:
    if not full_name:
        return None
    s = " ".join(str(full_name).strip().split())
    prefixes = (
        "CÔNG TY TRÁCH NHIỆM HỮU HẠN MỘT THÀNH VIÊN ",
        "CONG TY TRACH NHIEM HUU HAN MOT THANH VIEN ",
        "CÔNG TY TRÁCH NHIỆM HỮU HẠN ",
        "CONG TY TRACH NHIEM HUU HAN ",
        "CÔNG TY TNHH MTV ",
        "CONG TY TNHH MTV ",
        "CÔNG TY TNHH ",
        "CONG TY TNHH ",
        "CÔNG TY CỔ PHẦN ",
        "CONG TY CO PHAN ",
        "CÔNG TY CP ",
        "CONG TY CP ",
        "DOANH NGHIỆP TƯ NHÂN ",
        "DOANH NGHIEP TU NHAN ",
        "HỘ KINH DOANH ",
        "HO KINH DOANH ",
    )
    upper = s.upper()
    for pref in prefixes:
        if upper.startswith(pref):
            trimmed = s[len(pref):].strip()
            if trimmed:
                return trimmed[:120]
    return s[:120]


def sync_companies_from_purchase_invoices(
    db: Session,
    *,
    distributor_id: Optional[int] = None,
    invoice_ids: Optional[List[int]] = None,
    commit: bool = True,
) -> dict:
    """Tự động đồng bộ Công ty quản lý (Company) và liên kết SKU–Công ty (ProductCompany)
    từ dữ liệu Hóa đơn mua vào CQT (PurchaseInvoice.buyer_tax_code / buyer_name)."""
    from app.models.multi_tenant_invoice import (
        PurchaseInvoice,
        PurchaseInvoiceItem,
        TaxAuthorityCredential,
    )
    from app.models.product import Product, ProductCompany

    inv_stmt = (
        select(PurchaseInvoice, TaxAuthorityCredential.username)
        .outerjoin(
            TaxAuthorityCredential,
            TaxAuthorityCredential.id == PurchaseInvoice.tax_credential_id,
        )
    )
    if distributor_id is not None:
        inv_stmt = inv_stmt.where(PurchaseInvoice.distributor_id == distributor_id)
    if invoice_ids is not None:
        if not invoice_ids:
            return {"companies_created": 0, "companies_updated": 0, "sku_links_upserted": 0}
        inv_stmt = inv_stmt.where(PurchaseInvoice.id.in_(invoice_ids))

    inv_rows = db.execute(inv_stmt).all()
    if not inv_rows:
        return {"companies_created": 0, "companies_updated": 0, "sku_links_upserted": 0}

    # 1. Gom thông tin pháp nhân mua vào theo (distributor_id, tax_code)
    buyer_map: dict[tuple[int, str], dict] = {}
    invoice_buyer_key: dict[int, tuple[int, str]] = {}
    for inv, cred_username in inv_rows:
        tax_code = (inv.buyer_tax_code or cred_username or "").strip()
        if not tax_code:
            continue
        dist_id = inv.distributor_id
        key = (dist_id, tax_code)
        invoice_buyer_key[inv.id] = key
        buyer_name = (inv.buyer_name or "").strip()
        existing_entry = buyer_map.get(key)
        if existing_entry is None:
            buyer_map[key] = {"name": buyer_name}
        elif buyer_name and (not existing_entry["name"] or len(buyer_name) > len(existing_entry["name"])):
            existing_entry["name"] = buyer_name

    if not buyer_map:
        return {"companies_created": 0, "companies_updated": 0, "sku_links_upserted": 0}

    dist_ids = list({k[0] for k in buyer_map.keys()})
    existing_companies = db.scalars(
        select(Company).where(Company.distributor_id.in_(dist_ids))
    ).all()
    by_dist_tax: dict[tuple[int, str], Company] = {}
    by_dist_code: dict[tuple[int, str], Company] = {}
    for c in existing_companies:
        if c.distributor_id is None:
            continue
        if c.tax_code:
            by_dist_tax.setdefault((c.distributor_id, c.tax_code.strip()), c)
        if c.code:
            by_dist_code[(c.distributor_id, c.code.strip().upper())] = c

    companies_created = 0
    companies_updated = 0
    resolved_company: dict[tuple[int, str], Company] = {}

    for (dist_id, tax_code), info in buyer_map.items():
        buyer_name = info["name"] or f"Công ty MST {tax_code}"
        comp = by_dist_tax.get((dist_id, tax_code)) or by_dist_code.get((dist_id, tax_code.upper()))
        if comp is None:
            code_candidate = tax_code[:40]
            suffix = 1
            while (dist_id, code_candidate.upper()) in by_dist_code:
                code_candidate = f"{tax_code[:34]}_{suffix}"
                suffix += 1
            comp = Company(
                distributor_id=dist_id,
                code=code_candidate,
                name=buyer_name[:200],
                short_name=_make_short_company_name(buyer_name),
                tax_code=tax_code[:30],
                invoice_item_mode="TAX_INPUT",
                sync_source="GDT_CQT",
                status="active",
            )
            db.add(comp)
            db.flush()
            by_dist_tax[(dist_id, tax_code)] = comp
            by_dist_code[(dist_id, code_candidate.upper())] = comp
            companies_created += 1
        else:
            changed = False
            if not comp.tax_code:
                comp.tax_code = tax_code[:30]
                changed = True
            if buyer_name and (
                not comp.name
                or comp.name.startswith("Công ty MST ")
                or comp.sync_source == "GDT_CQT"
            ):
                if comp.name != buyer_name[:200]:
                    comp.name = buyer_name[:200]
                    changed = True
            if not comp.short_name and comp.name:
                comp.short_name = _make_short_company_name(comp.name)
                changed = True
            if changed:
                companies_updated += 1
        resolved_company[(dist_id, tax_code)] = comp

    # 2. Liên kết SKU <-> Company trong bảng product_companies từ các dòng PurchaseInvoiceItem
    inv_ids_list = list(invoice_buyer_key.keys())
    item_rows = db.execute(
        select(
            PurchaseInvoiceItem.purchase_invoice_id,
            PurchaseInvoiceItem.product_code,
            PurchaseInvoiceItem.quantity,
            PurchaseInvoice.invoice_date,
        )
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceItem.purchase_invoice_id)
        .where(
            PurchaseInvoiceItem.purchase_invoice_id.in_(inv_ids_list),
            PurchaseInvoiceItem.product_code.is_not(None),
        )
    ).all()

    sku_set = {
        (code or "").strip().upper()[:30]
        for _, code, _, _ in item_rows
        if (code or "").strip()
    }
    sku_links_upserted = 0
    if sku_set:
        products_by_sku = {
            p.sku.strip().upper(): p
            for p in db.scalars(
                select(Product).where(func.upper(Product.sku).in_(list(sku_set)))
            ).all()
            if p.sku
        }
        prod_ids = [p.id for p in products_by_sku.values()]
        if prod_ids:
            existing_links = db.scalars(
                select(ProductCompany).where(ProductCompany.product_id.in_(prod_ids))
            ).all()
            link_map: dict[tuple[int, int], ProductCompany] = {
                (l.product_id, l.company_id): l for l in existing_links
            }
            products_with_primary = {
                l.product_id for l in existing_links if l.is_primary
            }

            agg: dict[tuple[int, int], dict] = {}
            for inv_id, code, qty, inv_date in item_rows:
                sku = (code or "").strip().upper()[:30]
                prod = products_by_sku.get(sku)
                bkey = invoice_buyer_key.get(inv_id)
                comp = resolved_company.get(bkey) if bkey else None
                if not prod or not comp:
                    continue
                pair = (prod.id, comp.id)
                rec = agg.get(pair)
                q_val = float(qty or 0.0)
                if rec is None:
                    agg[pair] = {"qty": q_val, "last_date": inv_date}
                else:
                    rec["qty"] += q_val
                    if inv_date and (rec["last_date"] is None or inv_date > rec["last_date"]):
                        rec["last_date"] = inv_date

            for (prod_id, comp_id), stats in agg.items():
                link = link_map.get((prod_id, comp_id))
                if link is None:
                    is_primary = prod_id not in products_with_primary
                    prod_obj = next((p for p in products_by_sku.values() if p.id == prod_id), None)
                    inherited_npp = (
                        (prod_obj._npp_code or "").strip().upper() or None
                        if (is_primary and prod_obj is not None)
                        else None
                    )
                    link = ProductCompany(
                        product_id=prod_id,
                        company_id=comp_id,
                        role="MANAGER",
                        npp_code=inherited_npp,
                        source="PURCHASE_INVOICE",
                        is_primary=is_primary,
                        last_purchased_at=stats["last_date"],
                        total_purchased_qty=round(stats["qty"], 4),
                        status="active",
                    )
                    db.add(link)
                    link_map[(prod_id, comp_id)] = link
                    if is_primary:
                        products_with_primary.add(prod_id)
                    sku_links_upserted += 1
                else:
                    # Không ghi đè cấu hình thủ công (MANUAL), chỉ bổ sung số liệu mua vào CQT
                    if stats["last_date"] and (
                        link.last_purchased_at is None or stats["last_date"] > link.last_purchased_at
                    ):
                        link.last_purchased_at = stats["last_date"]
                    if invoice_ids is None:
                        link.total_purchased_qty = round(stats["qty"], 4)
                    else:
                        link.total_purchased_qty = round(
                            float(link.total_purchased_qty or 0.0) + stats["qty"], 4
                        )
                    sku_links_upserted += 1

    if commit:
        db.commit()
    else:
        db.flush()

    return {
        "companies_created": companies_created,
        "companies_updated": companies_updated,
        "sku_links_upserted": sku_links_upserted,
    }


class CompanyCRUD:
    get = staticmethod(get)
    get_by_code = staticmethod(get_by_code)
    list_ = staticmethod(list_)
    customer_count = staticmethod(customer_count)
    create = staticmethod(create)
    sync_companies_from_purchase_invoices = staticmethod(sync_companies_from_purchase_invoices)
    update = staticmethod(update)
    delete = staticmethod(delete)
    customers_of_company = staticmethod(customers_of_company)


company = CompanyCRUD()