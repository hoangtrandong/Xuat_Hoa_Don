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
    sheet.append(["sku", "company_code", "role"])
    sheet.append(["01CX01", "001", "MANAGER"])
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
        required = {"sku", "company_code"}
        if not required.issubset(headers):
            raise HTTPException(status_code=400, detail="File cần có cột sku và company_code.")
        products = {product.sku: product for product in db.scalars(select(Product)).all()}
        companies = {company.code: company for company in db.scalars(select(Company)).all()}
        existing = {(link.product_id, link.company_id) for link in db.scalars(select(ProductCompany)).all()}
        added = 0
        skipped = 0
        errors: list[str] = []
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            sku = str(data.get("sku") or "").strip().upper()
            company_code = str(data.get("company_code") or "").strip()
            role = str(data.get("role") or "MANAGER").strip().upper()
            if not sku and not company_code:
                continue
            product = products.get(sku)
            company = companies.get(company_code)
            if not product or not company:
                errors.append(f"Dòng {row_number}: không tìm thấy SKU {sku} hoặc công ty {company_code}.")
                continue
            key = (product.id, company.id)
            if key in existing:
                skipped += 1
                continue
            db.add(ProductCompany(product_id=product.id, company_id=company.id, role=role))
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
    link = ProductGroupCompany(product_group_id=group_id, company_id=payload.company_id, role=payload.role.strip().upper())
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
    rows = db.execute(
        select(Product, ProductCompany, Company)
        .outerjoin(ProductCompany, ProductCompany.product_id == Product.id)
        .outerjoin(Company, Company.id == ProductCompany.company_id)
        .order_by(Product.sku, Company.name)
    ).all()
    result: dict[int, ProductCompanyManagementView] = {}
    for product, link, company in rows:
        item = result.setdefault(product.id, ProductCompanyManagementView(product_id=product.id, sku=product.sku, name=product.name))
        if link and company:
            item.companies.append({
                "id": link.id,
                "company_id": company.id,
                "company_name": company.name,
                "role": link.role,
                "status": link.status,
            })
    return list(result.values())


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
