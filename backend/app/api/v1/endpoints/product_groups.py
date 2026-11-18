from sqlalchemy import text
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.models.customer import Company
from app.models.product import Product, ProductCompany, ProductGroup, ProductGroupCompany, ProductGroupItem
from app.schemas.product_group import (
    ProductCompanyLinkView,
    ProductCompanyManagementView,
    ProductGroupCompanyLinkCreate,
    ProductGroupCompanyLinkView,
    ProductGroupDistributorCodeUpdate,
    ProductGroupCreate,
    ProductGroupItemAdd,
    ProductGroupItemView,
    ProductGroupRepresentativeUpdate,
    ProductGroupView,
)

router = APIRouter(prefix="/product-groups", tags=["product-groups"])


@router.get("/products/companies/template")
def download_product_company_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "SKU-Cong ty"
    sheet.append(["sku", "company_code", "distributor_sku", "distributor_name", "role"])
    sheet.append(["01CX01", "001", "NPP-01CX01-A", "Sản phẩm NPP A", "MANAGER"])
    output = BytesIO()
    workbook.save(output)
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-sku-cong-ty.xlsx"'},
    )


@router.post("/products/companies/upload")
def upload_product_company_links(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")
        headers = [str(value).strip().lower() if value is not None else "" for value in rows[0]]
        required = {"sku", "company_code", "distributor_sku"}
        if not required.issubset(headers):
            raise HTTPException(status_code=400, detail="File cần có cột sku và company_code.")
        products = {product.sku: product for product in db.scalars(select(Product)).all()}
        companies = {company.code: company for company in db.scalars(select(Company)).all()}
        group_items = db.scalars(select(ProductGroupItem).options(selectinload(ProductGroupItem.product), selectinload(ProductGroupItem.group))).all()
        groups = {item.product.sku: item.group for item in group_items}
        groups_by_name = {item.group.name.strip().casefold(): item.group for item in group_items}
        group_company_links = db.execute(
            select(ProductGroupCompany, Company)
            .join(Company, Company.id == ProductGroupCompany.company_id)
        ).all()
        groups_by_npp = {
            f"{company.code.casefold()}|{link.distributor_sku.strip().casefold()}": link.product_group_id
            for link, company in group_company_links
            if link.distributor_sku and company.code
        }
        existing = {(link.product_group_id, link.company_id) for link in db.scalars(select(ProductGroupCompany)).all()}
        added = 0
        skipped = 0
        errors: list[str] = []
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            sku = str(data.get("sku") or "").strip().upper()
            company_code = str(data.get("company_code") or "").strip()
            role = str(data.get("role") or "MANAGER").strip().upper()
            group_name = str(data.get("group_name") or "").strip()
            distributor_sku = str(data.get("distributor_sku") or "").strip()
            distributor_name = str(data.get("distributor_name") or "").strip() or None
            if not sku and not company_code:
                continue
            product = products.get(sku)
            company = companies.get(company_code)
            if not product or not company:
                errors.append(f"Dòng {row_number}: không tìm thấy SKU {sku} hoặc công ty {company_code}.")
                continue
            group_key = group_name.casefold() if group_name else f"{company_code.casefold()}|{distributor_sku.casefold()}"
            group = groups_by_name.get(group_key)
            if not group and not group_name:
                existing_group_id = groups_by_npp.get(group_key)
                group = db.get(ProductGroup, existing_group_id) if existing_group_id else None
            group = group or groups.get(sku)
            if not group:
                group = ProductGroup(name=group_name or f"SKU dùng chung {distributor_sku}", representative_product_id=product.id)
                db.add(group)
                db.flush()
                db.add(ProductGroupItem(product_group_id=group.id, product_id=product.id))
                groups[sku] = group
                groups_by_name[group_key] = group
            elif not db.scalar(select(ProductGroupItem).where(ProductGroupItem.product_group_id == group.id, ProductGroupItem.product_id == product.id)):
                if product.id in groups and groups[product.sku].id != group.id:
                    old_group = groups[product.sku]
                    old_items = db.scalars(select(ProductGroupItem).where(ProductGroupItem.product_group_id == old_group.id)).all()
                    old_links = db.scalars(select(ProductGroupCompany).where(ProductGroupCompany.product_group_id == old_group.id)).all()
                    if len(old_items) != 1 or old_links:
                        errors.append(f"Dòng {row_number}: SKU {sku} đã thuộc nhóm khác.")
                        continue
                    db.delete(old_items[0])
                db.add(ProductGroupItem(product_group_id=group.id, product_id=product.id))
                db.flush()
                groups[sku] = group
            if not group_name:
                groups_by_npp[group_key] = group.id
            key = (group.id, company.id)
            if key in existing:
                skipped += 1
                continue
            db.add(ProductGroupCompany(product_group_id=group.id, company_id=company.id, role=role, distributor_sku=distributor_sku, distributor_name=distributor_name))
            existing.add(key)
            added += 1
        if errors:
            db.rollback()
            raise HTTPException(status_code=400, detail="; ".join(errors[:10]))
        db.commit()
        return {"added": added, "skipped": skipped}
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Không thể đọc file Excel: {exc}") from exc


@router.post("/products/companies/assign-all")
def assign_companies_to_all_products(company_ids: list[int], db: Session = Depends(get_db)):
    if not company_ids:
        raise HTTPException(status_code=400, detail="Cần chọn ít nhất một công ty.")
    companies = db.scalars(select(Company).where(Company.id.in_(set(company_ids)))).all()
    if len(companies) != len(set(company_ids)):
        raise HTTPException(status_code=400, detail="Một hoặc nhiều công ty không tồn tại.")
    products = db.scalars(select(Product)).all()
    existing = {(link.product_id, link.company_id) for link in db.scalars(select(ProductCompany)).all()}
    added = 0
    for product in products:
        for company in companies:
            if (product.id, company.id) not in existing:
                db.add(ProductCompany(product_id=product.id, company_id=company.id, role="MANAGER"))
                added += 1
    db.commit()
    return {"products": len(products), "companies": len(companies), "added": added}


@router.post("/companies/assign-all")
def assign_companies_to_all_groups(company_ids: list[int], db: Session = Depends(get_db)):
    if not company_ids:
        raise HTTPException(status_code=400, detail="Cần chọn ít nhất một công ty.")
    companies = db.scalars(select(Company).where(Company.id.in_(set(company_ids)))).all()
    if len(companies) != len(set(company_ids)):
        raise HTTPException(status_code=400, detail="Một hoặc nhiều công ty không tồn tại.")
    products = db.scalars(select(Product).order_by(Product.sku)).all()
    grouped_product_ids = set(db.scalars(select(ProductGroupItem.product_id)).all())
    groups = db.scalars(select(ProductGroup)).all()
    for product in products:
        if product.id in grouped_product_ids:
            continue
        group = ProductGroup(name=f"Nhóm {product.sku}", representative_product_id=product.id)
        db.add(group)
        db.flush()
        db.add(ProductGroupItem(product_group_id=group.id, product_id=product.id))
        groups.append(group)
    existing = {(link.product_group_id, link.company_id) for link in db.scalars(select(ProductGroupCompany)).all()}
    added = 0
    for group in groups:
        for company in companies:
            if (group.id, company.id) not in existing:
                db.add(ProductGroupCompany(product_group_id=group.id, company_id=company.id, role="MANAGER"))
                added += 1
    db.commit()
    return {"groups": len(groups), "companies": len(companies), "added": added}


def _load_group(db: Session, group_id: int) -> ProductGroup:
    group = db.scalar(
        select(ProductGroup)
        .options(selectinload(ProductGroup.items))
        .where(ProductGroup.id == group_id)
    )
    if not group:
        raise HTTPException(status_code=404, detail="Product group not found")
    return group


@router.get("/", response_model=list[ProductGroupView])
def list_groups(db: Session = Depends(get_db)):
    return db.scalars(
        select(ProductGroup).options(selectinload(ProductGroup.items)).order_by(ProductGroup.name)
    ).all()


@router.post("/", response_model=ProductGroupView, status_code=201)
def create_group(payload: ProductGroupCreate, db: Session = Depends(get_db)):
    product_ids = set(payload.product_ids)
    product_ids.add(payload.representative_product_id)
    products = db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
    if len(products) != len(product_ids):
        raise HTTPException(status_code=400, detail="Một hoặc nhiều SKU không tồn tại.")
    existing = db.scalars(select(ProductGroupItem.product_id).where(ProductGroupItem.product_id.in_(product_ids))).all()
    if existing:
        raise HTTPException(status_code=409, detail=f"SKU đã thuộc nhóm khác: {', '.join(map(str, existing))}")

    group = ProductGroup(name=payload.name.strip(), representative_product_id=payload.representative_product_id)
    db.add(group)
    db.flush()
    db.add_all([
        ProductGroupItem(product_group_id=group.id, product_id=product_id)
        for product_id in product_ids
    ])
    db.commit()
    return _load_group(db, group.id)


@router.patch("/{group_id}/representative", response_model=ProductGroupView)
def change_representative(group_id: int, payload: ProductGroupRepresentativeUpdate, db: Session = Depends(get_db)):
    group = _load_group(db, group_id)
    if not any(item.product_id == payload.product_id for item in group.items):
        raise HTTPException(status_code=400, detail="SKU đại diện mới phải là thành viên của nhóm.")
    group.representative_product_id = payload.product_id
    db.commit()
    return _load_group(db, group_id)


@router.post("/{group_id}/items", response_model=ProductGroupItemView, status_code=201)
def add_group_item(group_id: int, payload: ProductGroupItemAdd, db: Session = Depends(get_db)):
    _load_group(db, group_id)
    if not db.get(Product, payload.product_id):
        raise HTTPException(status_code=404, detail="SKU not found")
    if db.scalar(select(ProductGroupItem).where(ProductGroupItem.product_id == payload.product_id)):
        raise HTTPException(status_code=409, detail="SKU đã thuộc một nhóm sản phẩm khác.")
    item = ProductGroupItem(product_group_id=group_id, product_id=payload.product_id, conversion_factor=payload.conversion_factor)
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="SKU đã thuộc một nhóm sản phẩm khác.") from None
    db.refresh(item)
    return item


@router.delete("/{group_id}/items/{product_id}")
def remove_group_item(group_id: int, product_id: int, db: Session = Depends(get_db)):
    group = _load_group(db, group_id)
    if group.representative_product_id == product_id:
        raise HTTPException(status_code=400, detail="Hãy chọn SKU đại diện khác trước khi gỡ SKU này.")
    item = db.scalar(select(ProductGroupItem).where(ProductGroupItem.product_group_id == group_id, ProductGroupItem.product_id == product_id))
    if not item:
        raise HTTPException(status_code=404, detail="SKU không thuộc nhóm này.")
    db.delete(item)
    db.commit()
    return {"success": True}


@router.post("/{group_id}/companies", response_model=ProductGroupCompanyLinkView, status_code=201)
def link_group_company(group_id: int, payload: ProductGroupCompanyLinkCreate, db: Session = Depends(get_db)):
    _load_group(db, group_id)
    if not db.get(Company, payload.company_id):
        raise HTTPException(status_code=404, detail="Company not found")
    npp_code = (payload.distributor_sku or '').strip()
    if not npp_code:
        npp_code = db.execute(text("SELECT MIN(distributor_sku) FROM product_group_companies WHERE product_group_id = :g AND distributor_sku <> ''"), {'g': group_id}).scalar()
    if not npp_code:
        top = db.execute(text("SELECT MAX(CAST(distributor_sku AS INTEGER)) FROM product_group_companies WHERE distributor_sku ~ '^[0-9]{4}$'")).scalar()
        npp_code = f'{(top or 0) + 1:04d}'
    link = ProductGroupCompany(product_group_id=group_id, company_id=payload.company_id, role=payload.role.strip().upper(), distributor_sku=npp_code, distributor_name=payload.distributor_name)
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Công ty đã được gán vào nhóm này.") from None
    db.refresh(link)
    return link


@router.delete("/{group_id}/companies/{company_id}")
def unlink_group_company(group_id: int, company_id: int, db: Session = Depends(get_db)):
    link = db.scalar(select(ProductGroupCompany).where(ProductGroupCompany.product_group_id == group_id, ProductGroupCompany.company_id == company_id))
    if not link:
        raise HTTPException(status_code=404, detail="Company is not linked to this group")
    db.delete(link)
    db.commit()
    return {"success": True}


@router.patch("/{group_id}/companies/distributor-code")
def update_group_distributor_code(
    group_id: int,
    payload: ProductGroupDistributorCodeUpdate,
    db: Session = Depends(get_db),
):
    group = _load_group(db, group_id)
    code = payload.distributor_sku.strip()
    name = payload.distributor_name.strip() if payload.distributor_name else None
    if not code:
        raise HTTPException(status_code=422, detail="Mã NPP không được để trống.")
    if code.isdigit() and len(code) != 4:
        raise HTTPException(status_code=422, detail="Mã NPP số phải gồm đúng 4 chữ số.")

    duplicate = db.scalar(
        select(ProductGroupCompany.product_group_id)
        .where(
            ProductGroupCompany.distributor_sku == code,
            ProductGroupCompany.product_group_id != group_id,
        )
        .limit(1)
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail=f"Mã NPP {code} đã được gán cho nhóm SKU khác.")

    links = db.scalars(
        select(ProductGroupCompany).where(ProductGroupCompany.product_group_id == group_id)
    ).all()
    if not links:
        raise HTTPException(status_code=400, detail="Nhóm SKU chưa được gán công ty; hãy gán công ty trước khi sửa mã NPP.")
    for link in links:
        link.distributor_sku = code
        link.distributor_name = name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Mã NPP {code} không thể lưu do bị trùng.") from None
    return {
        "product_group_id": group_id,
        "distributor_sku": code,
        "distributor_name": name,
        "companies_updated": len(links),
    }


@router.post("/products/{product_id}/companies", response_model=ProductCompanyLinkView, status_code=201)
def link_product_company(product_id: int, payload: ProductGroupCompanyLinkCreate, db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(status_code=404, detail="SKU not found")
    if not db.get(Company, payload.company_id):
        raise HTTPException(status_code=404, detail="Company not found")
    link = ProductCompany(product_id=product_id, company_id=payload.company_id, role=payload.role.strip().upper())
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Công ty đã được gán vào SKU này.") from None
    db.refresh(link)
    return link


@router.get("/products/{product_id}/companies", response_model=list[ProductCompanyLinkView])
def list_product_companies(product_id: int, db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(status_code=404, detail="SKU not found")
    return db.scalars(
        select(ProductCompany)
        .where(ProductCompany.product_id == product_id)
        .order_by(ProductCompany.role, ProductCompany.company_id)
    ).all()


@router.get("/products/company-links", response_model=list[ProductCompanyManagementView])
def list_product_company_links(db: Session = Depends(get_db)):
    from app.models.vinamilk import VinamilkOrderSnapshot
    from app.models.multi_tenant_invoice import Distributor
    from sqlalchemy import func

    # 1. Danh sách Nhà phân phối và Công ty
    distributors = db.scalars(select(Distributor)).all()
    default_dist = next((d for d in distributors if "MAIGOLD" in (d.code or "").upper()), None) or (distributors[0] if distributors else None)
    dist_id = default_dist.id if default_dist else 1
    dist_name = default_dist.name if default_dist else "Nhà Phân Phối Mai Gold"

    # 2. Toàn bộ mã sản phẩm đồng bộ từ web nhà cung cấp từ đơn hàng (SQL Aggregated - Fast & Scalable)
    agg_sql = text("""
        SELECT
            UPPER(TRIM(product_code)) as code,
            MAX(product_name) as name,
            COUNT(DISTINCT order_number) as order_count,
            COALESCE(MAX(raw_payload->>'ĐVT'), MAX(raw_payload->>'unit'), 'HOP') as unit,
            COALESCE(MAX(raw_payload->>'supplier'), 'Vinamilk') as supplier,
            COALESCE(MAX(CASE WHEN (raw_payload->>'Đơn giá') ~ '^[0-9.]+$' THEN CAST(raw_payload->>'Đơn giá' AS FLOAT) ELSE 0 END), 0.0) as price,
            COALESCE(SUM(CASE WHEN (raw_payload->>'Số lượng') ~ '^[0-9.]+$' THEN CAST(raw_payload->>'Số lượng' AS FLOAT) ELSE 0 END), 0.0) +
            COALESCE(SUM(CASE WHEN (raw_payload->>'Số lượng KM') ~ '^[0-9.]+$' THEN CAST(raw_payload->>'Số lượng KM' AS FLOAT) ELSE 0 END), 0.0) as total_qty
        FROM vinamilk_order_snapshots
        WHERE product_code IS NOT NULL AND TRIM(product_code) <> ''
        GROUP BY UPPER(TRIM(product_code))
    """)
    agg_rows = db.execute(agg_sql).mappings().all()

    dms_map: dict[str, dict] = {}
    for r in agg_rows:
        c = r["code"]
        dms_map[c] = {
            "code": c,
            "name": r["name"] or f"Sản phẩm {c}",
            "unit": r["unit"] or "HOP",
            "price": float(r["price"] or 0.0),
            "order_count": int(r["order_count"] or 0),
            "total_qty": float(r["total_qty"] or 0.0),
            "supplier": r["supplier"] or "Vinamilk",
        }

    # 3. Tra cứu sản phẩm SKU trong DB (nguồn CQT)
    all_products = db.scalars(select(Product)).all()
    prod_by_npp: dict[str, Product] = {}
    prod_by_sku: dict[str, Product] = {}
    for p in all_products:
        if p.sku:
            prod_by_sku[p.sku.strip().upper()] = p
        if p.npp_code:
            prod_by_npp[p.npp_code.strip().upper()] = p

    # 4. Nhóm ProductGroup hiện tại
    groups = db.scalars(
        select(ProductGroup).options(
            selectinload(ProductGroup.items).selectinload(ProductGroupItem.product),
            selectinload(ProductGroup.company_links).selectinload(ProductGroupCompany.company),
        )
    ).all()

    result: list[ProductCompanyManagementView] = []
    seen_dms_codes: set[str] = set()

    for group in groups:
        members = [item.product for item in group.items]
        companies = []
        for link in group.company_links:
            c_name = link.company.name if link.company else dist_name
            c_id = link.company.id if link.company else dist_id
            companies.append({
                "id": link.id,
                "company_id": c_id,
                "company_name": c_name,
                "role": link.role,
                "status": link.status,
                "distributor_sku": link.distributor_sku,
                "distributor_name": link.distributor_name,
            })
            if link.distributor_sku:
                seen_dms_codes.add(link.distributor_sku.strip().upper())

        representative = next((p for p in members if p.id == group.representative_product_id), None)
        rep_sku = representative.sku if representative else str(group.representative_product_id)
        rep_name = representative.name if representative else group.name

        # Tìm thông tin đơn hàng DMS tương ứng
        dms_info = next((dms_map[c] for c in dms_map if c == rep_sku or any(c == (l.get("distributor_sku") or "").upper() for l in companies)), None)

        result.append(ProductCompanyManagementView(
            product_group_id=group.id,
            group_name=group.name,
            representative_sku=rep_sku,
            representative_name=rep_name,
            member_skus=[p.sku for p in members],
            member_names=[p.name for p in members],
            companies=companies,
            supplier=dms_info.get("supplier") if dms_info else "Vinamilk",
            order_count=dms_info.get("order_count", 0) if dms_info else 0,
            total_ordered_qty=round(dms_info.get("total_qty", 0.0), 2) if dms_info else 0.0,
            unit_price=dms_info.get("price", 0.0) if dms_info else 0.0,
            unit=dms_info.get("unit") if dms_info else None,
        ))

    # 5. Bổ sung TOÀN BỘ các mã sản phẩm từ web NCC từ đơn hàng (chưa có trong ProductGroup)
    virtual_id = 900000
    for code, dms in sorted(dms_map.items()):
        if code in seen_dms_codes:
            continue
        virtual_id += 1

        # Kiểm tra xem mã này đã được gán vào SKU nào chưa
        matched_prod = prod_by_npp.get(code) or prod_by_sku.get(code)
        rep_sku = matched_prod.sku if matched_prod else "Chưa gán SKU CQT"
        rep_name = matched_prod.name if matched_prod else "Chờ đồng bộ HĐ CQT hoặc ghép mã"

        companies = [{
            "id": virtual_id,
            "company_id": dist_id,
            "company_name": dist_name,
            "role": "MANAGER",
            "status": "active",
            "distributor_sku": code,
            "distributor_name": dms["name"],
        }]

        result.append(ProductCompanyManagementView(
            product_group_id=virtual_id,
            group_name=dms["name"],
            representative_sku=rep_sku,
            representative_name=rep_name,
            member_skus=[code],
            member_names=[dms["name"]],
            companies=companies,
            supplier=dms["supplier"],
            order_count=dms["order_count"],
            total_ordered_qty=round(dms["total_qty"], 2),
            unit_price=round(dms["price"], 4),
            unit=dms["unit"],
        ))

    return result


@router.delete("/products/{product_id}/companies/{company_id}")
def unlink_product_company(product_id: int, company_id: int, db: Session = Depends(get_db)):
    link = db.scalar(
        select(ProductCompany).where(
            ProductCompany.product_id == product_id,
            ProductCompany.company_id == company_id,
        )
    )
    if not link:
        raise HTTPException(status_code=404, detail="Company is not linked to this SKU")
    db.delete(link)
    db.commit()
    return {"success": True}


from pydantic import BaseModel

class DistributorSkuMappingPayload(BaseModel):
    distributor_sku: str
    target_sku: str | None = None
    distributor_name: str | None = None


@router.post("/distributor-mapping")
def map_distributor_sku(payload: DistributorSkuMappingPayload, db: Session = Depends(get_db)):
    """Ghép hoặc cập nhật ánh xạ giữa Mã sản phẩm web NCC (Mã NPP) và Mã SKU CQT."""
    dms_code = payload.distributor_sku.strip().upper()
    target_sku = payload.target_sku.strip().upper() if payload.target_sku else None

    # Tìm sản phẩm CQT đích
    target_prod = None
    if target_sku:
        target_prod = db.scalar(select(Product).where(Product.sku == target_sku))
        if not target_prod:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy mã SKU CQT '{target_sku}'.")

    # Cập nhật Product nếu có
    if target_prod:
        target_prod.npp_code = dms_code
        db.commit()

    return {
        "success": True,
        "distributor_sku": dms_code,
        "mapped_sku": target_prod.sku if target_prod else None,
        "message": f"Đã ghép mã NPP '{dms_code}' với SKU CQT '{target_prod.sku}'." if target_prod else f"Đã lưu mã NPP '{dms_code}'."
    }


class DistributorProductUpdatePayload(BaseModel):
    original_code: str
    new_code: str
    distributor_name: str | None = None
    unit: str | None = None
    supplier: str | None = None


@router.put("/distributor-products")
def update_distributor_product(payload: DistributorProductUpdatePayload, db: Session = Depends(get_db)):
    """Chỉnh sửa thông tin mã sản phẩm NPP nội bộ."""
    orig = payload.original_code.strip().upper()
    new_c = payload.new_code.strip().upper()
    new_name = payload.distributor_name.strip() if payload.distributor_name else None
    unit = payload.unit.strip().upper() if payload.unit else None

    if not orig or not new_c:
        raise HTTPException(status_code=400, detail="Mã sản phẩm không được để trống.")

    from app.models.vinamilk import VinamilkOrderSnapshot

    # 1. Cập nhật trong ProductGroupCompany
    pg_links = db.scalars(select(ProductGroupCompany).where(ProductGroupCompany.distributor_sku == orig)).all()
    for link in pg_links:
        link.distributor_sku = new_c
        if new_name:
            link.distributor_name = new_name

    # 2. Cập nhật trong VinamilkOrderSnapshot
    snaps = db.scalars(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.product_code == orig)).all()
    for s in snaps:
        s.product_code = new_c
        if new_name:
            s.product_name = new_name
        if unit and isinstance(s.raw_payload, dict):
            raw = dict(s.raw_payload)
            raw["ĐVT"] = unit
            s.raw_payload = raw

    # 3. Cập nhật trong Product.npp_code nếu có ánh xạ
    prods = db.scalars(select(Product).where(Product.npp_code == orig)).all()
    for p in prods:
        p.npp_code = new_c

    db.commit()
    return {
        "success": True,
        "message": f"Đã cập nhật mã sản phẩm NPP '{orig}' thành '{new_c}'.",
        "original_code": orig,
        "new_code": new_c,
    }


@router.delete("/distributor-products/{code}")
def delete_distributor_product(code: str, db: Session = Depends(get_db)):
    """Xóa mã sản phẩm NPP nội bộ khỏi danh mục."""
    clean_code = code.strip().upper()
    if not clean_code:
        raise HTTPException(status_code=400, detail="Mã sản phẩm không hợp lệ.")

    from app.models.vinamilk import VinamilkOrderSnapshot

    # 1. Xóa trong ProductGroupCompany
    pg_links = db.scalars(select(ProductGroupCompany).where(ProductGroupCompany.distributor_sku == clean_code)).all()
    for link in pg_links:
        group_id = link.product_group_id
        db.delete(link)
        other_links = db.scalars(
            select(ProductGroupCompany).where(
                ProductGroupCompany.product_group_id == group_id,
                ProductGroupCompany.id != link.id,
            )
        ).all()
        if not other_links:
            items = db.scalars(select(ProductGroupItem).where(ProductGroupItem.product_group_id == group_id)).all()
            for it in items:
                db.delete(it)
            grp = db.get(ProductGroup, group_id)
            if grp:
                db.delete(grp)

    # 2. Xóa các bản ghi snapshot có mã này
    snaps = db.scalars(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.product_code == clean_code)).all()
    for s in snaps:
        db.delete(s)

    # 3. Gỡ npp_code trong Product nếu có
    prods = db.scalars(select(Product).where(Product.npp_code == clean_code)).all()
    for p in prods:
        p.npp_code = None

    db.commit()
    return {
        "success": True,
        "message": f"Đã xóa mã sản phẩm NPP '{clean_code}' thành công.",
        "deleted_code": clean_code,
    }


@router.get("/distributor-products/template")
def download_distributor_product_template():
    """Tải file Excel mẫu để thêm danh sách mã sản phẩm NPP."""
    wb = Workbook()
    ws = wb.active
    ws.title = "DS_Ma_SP_NPP"
    ws.append(["Mã SP NPP", "Tên sản phẩm", "ĐVT", "Nhà cung cấp", "Nhà phân phối"])
    ws.append(["01TD03", "Sữa tươi tiệt trùng có đường 180ml", "HOP", "Vinamilk", "Nhà Phân Phối Mai Gold"])
    ws.append(["07KD12", "Sữa chua ăn lựu đỏ 100g", "HOP", "Vinamilk", "Nhà Phân Phối Mai Gold"])
    ws.append(["01SX11", "Sữa dinh dưỡng Optimum Gold 110ml", "HOP", "Vinamilk", "Nhà Phân Phối Mai Gold"])

    # Định dạng độ rộng cột
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 42
    ws.column_dimensions["C"].width = 12
    ws.column_dimensions["D"].width = 20
    ws.column_dimensions["E"].width = 26

    output = BytesIO()
    wb.save(output)
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-danh-sach-ma-sp-npp.xlsx"'},
    )


@router.post("/distributor-products/upload")
def upload_distributor_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload file Excel để thêm / cập nhật danh sách mã sản phẩm NPP vào hệ thống."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel định dạng .xlsx hoặc .xls.")

    import uuid
    from datetime import datetime
    from app.models.vinamilk import VinamilkOrderSnapshot

    try:
        content = file.file.read()
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
        sheet = wb.active
        rows = list(sheet.iter_rows(values_only=True))
        if not rows or len(rows) < 2:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu để xử lý.")

        # Chuẩn hóa headers
        raw_headers = [str(c or "").strip().lower() for c in rows[0]]

        # Tìm index các cột
        code_idx = -1
        name_idx = -1
        unit_idx = -1
        supplier_idx = -1
        dist_idx = -1

        for idx, h in enumerate(raw_headers):
            if any(k in h for k in ["mã sp npp", "mã sp", "distributor_sku", "sku", "mã sản phẩm", "ma_sp"]):
                code_idx = idx
            elif any(k in h for k in ["tên sản phẩm", "tên sp", "distributor_name", "name", "ten_sp", "sản phẩm"]):
                name_idx = idx
            elif any(k in h for k in ["đvt", "unit", "đơn vị tính", "dvt"]):
                unit_idx = idx
            elif any(k in h for k in ["nhà cung cấp", "supplier", "ncc"]):
                supplier_idx = idx
            elif any(k in h for k in ["nhà phân phối", "distributor", "npp"]):
                dist_idx = idx

        if code_idx == -1:
            code_idx = 0  # Mặc định cột đầu tiên là Mã SP NPP

        added = 0
        updated = 0
        now = datetime.utcnow()

        # Cache existing snapshot products
        existing_snaps = {
            (s.product_code or "").strip().upper(): s
            for s in db.scalars(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.product_code.is_not(None))).all()
        }

        # Cache existing product group company links
        existing_links = {
            (l.distributor_sku or "").strip().upper(): l
            for l in db.scalars(select(ProductGroupCompany).where(ProductGroupCompany.distributor_sku.is_not(None))).all()
        }

        for row_num, row in enumerate(rows[1:], start=2):
            if not row or all(v is None or str(v).strip() == "" for v in row):
                continue

            code_val = str(row[code_idx] or "").strip().upper() if code_idx < len(row) else ""
            if not code_val:
                continue

            name_val = str(row[name_idx] or "").strip() if name_idx != -1 and name_idx < len(row) and row[name_idx] is not None else ""
            if not name_val:
                name_val = f"Sản phẩm {code_val}"

            unit_val = str(row[unit_idx] or "").strip().upper() if unit_idx != -1 and unit_idx < len(row) and row[unit_idx] is not None else "HOP"
            supplier_val = str(row[supplier_idx] or "").strip() if supplier_idx != -1 and supplier_idx < len(row) and row[supplier_idx] is not None else "Vinamilk"
            dist_val = str(row[dist_idx] or "").strip() if dist_idx != -1 and dist_idx < len(row) and row[dist_idx] is not None else "Nhà Phân Phối Mai Gold"

            # Cập nhật hoặc thêm vào ProductGroupCompany nếu có link
            if code_val in existing_links:
                link = existing_links[code_val]
                link.distributor_name = name_val

            # Cập nhật hoặc thêm vào VinamilkOrderSnapshot
            if code_val in existing_snaps:
                snap = existing_snaps[code_val]
                snap.product_name = name_val
                raw = dict(snap.raw_payload) if isinstance(snap.raw_payload, dict) else {}
                raw["ĐVT"] = unit_val
                raw["supplier"] = supplier_val
                raw["Sản phẩm"] = name_val
                snap.raw_payload = raw
                updated += 1
            else:
                new_snap = VinamilkOrderSnapshot(
                    remote_key=f"MANUAL_{code_val}_{uuid.uuid4().hex[:8]}",
                    is_synthetic=True,
                    product_code=code_val,
                    product_name=name_val,
                    status="active",
                    synced_from=now,
                    synced_to=now,
                    synced_at=now,
                    raw_payload={
                        "ĐVT": unit_val,
                        "supplier": supplier_val,
                        "Sản phẩm": name_val,
                        "is_manual": True,
                    },
                )
                db.add(new_snap)
                existing_snaps[code_val] = new_snap
                added += 1

        db.commit()
        return {
            "success": True,
            "message": f"Tải lên thành công: Đã thêm mới {added} mã và cập nhật {updated} mã SP NPP.",
            "added": added,
            "updated": updated,
            "total_processed": added + updated,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Lỗi khi đọc file Excel: {str(e)}")
