from sqlalchemy import text
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload, joinedload

from app.core.database import get_db
from app.models.customer import Company
from app.models.product import (
    Product, ProductCompany, ProductGroup, ProductGroupCompany, ProductGroupItem,
    DistributorProduct,
)
from app.schemas.product_group import (
    ProductCompanyAssignmentView,
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
    DistributorProductItem,
    DistributorProductCreate,
    DistributorProductUpdate,
    DistributorProductBulkDelete,
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


@router.get("/distributor-products", response_model=list[DistributorProductItem])
def list_distributor_products(db: Session = Depends(get_db)):
    """Danh sách mã sản phẩm NPP nội bộ (do người dùng upload / quản lý thủ công)."""
    items = (
        db.scalars(
            select(DistributorProduct)
            .options(joinedload(DistributorProduct.company))
            .order_by(DistributorProduct.id.desc())
        ).all()
    )
    return [
        DistributorProductItem(
            id=item.id,
            distributor_name=item.distributor_name or "Nhà Phân Phối Mai Gold",
            distributor_sku=item.distributor_sku,
            distributor_product_name=item.distributor_product_name,
            supplier=item.supplier or "Vinamilk",
            unit=item.unit or "HOP",
            company_id=item.company_id,
            company_code=item.company.code if item.company else None,
            company_name=item.company.name if item.company else None,
            status=item.status or "active",
        )
        for item in items
    ]


@router.get("/products/company-links", response_model=list[ProductCompanyManagementView])
def list_product_company_links(db: Session = Depends(get_db)):
    """Lấy danh sách mã sản phẩm NPP nội bộ để hiển thị và chọn SKU trong dropdown."""
    items = (
        db.scalars(
            select(DistributorProduct)
            .options(joinedload(DistributorProduct.company))
            .order_by(DistributorProduct.id.desc())
        ).all()
    )
    all_products = db.scalars(select(Product)).all()
    prod_by_npp = {p.npp_code.strip().upper(): p for p in all_products if p.npp_code}

    result: list[ProductCompanyManagementView] = []
    for item in items:
        clean_code = item.distributor_sku.strip().upper()
        # Chỉ liên kết khi có Product trong hệ thống thực sự được gán mã npp_code này
        matched_prod = prod_by_npp.get(clean_code)
        rep_sku = matched_prod.sku if matched_prod else ""
        rep_name = matched_prod.name if matched_prod else item.distributor_product_name

        companies = []
        if item.company:
            companies.append(ProductCompanyAssignmentView(
                id=item.id,
                company_id=item.company.id,
                company_code=item.company.code,
                company_name=item.company.name,
                role="MANAGER",
                status=item.status or "active",
                distributor_sku=item.distributor_sku,
                distributor_name=item.distributor_product_name,
            ))

        result.append(ProductCompanyManagementView(
            product_group_id=item.id,
            group_name=item.distributor_product_name,
            representative_sku=rep_sku,
            representative_name=rep_name,
            member_skus=[item.distributor_sku],
            member_names=[item.distributor_product_name],
            companies=companies,
            supplier=item.supplier or "Vinamilk",
            order_count=0,
            total_ordered_qty=0.0,
            unit_price=0.0,
            unit=item.unit or "HOP",
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


@router.post("/distributor-products", response_model=DistributorProductItem)
def create_distributor_product(payload: DistributorProductCreate, db: Session = Depends(get_db)):
    """Thêm mới 1 mã sản phẩm NPP nội bộ."""
    clean_sku = payload.distributor_sku.strip().upper()
    if not clean_sku or not payload.distributor_product_name.strip():
        raise HTTPException(status_code=400, detail="Mã SP NPP và Tên sản phẩm không được để trống.")

    existing = db.scalar(select(DistributorProduct).where(DistributorProduct.distributor_sku == clean_sku))
    if existing:
        raise HTTPException(status_code=400, detail=f"Mã sản phẩm NPP '{clean_sku}' đã tồn tại trong hệ thống.")

    # Kiểm tra company_id nếu có
    if payload.company_id:
        comp = db.get(Company, payload.company_id)
        if not comp:
            raise HTTPException(status_code=400, detail="Công ty quản lý không tồn tại.")

    new_prod = DistributorProduct(
        distributor_name=payload.distributor_name or "Nhà Phân Phối Mai Gold",
        distributor_sku=clean_sku,
        distributor_product_name=payload.distributor_product_name.strip(),
        supplier=payload.supplier or "Vinamilk",
        unit=payload.unit or "HOP",
        company_id=payload.company_id,
        status="active",
    )
    db.add(new_prod)
    db.commit()
    db.refresh(new_prod)

    return DistributorProductItem(
        id=new_prod.id,
        distributor_name=new_prod.distributor_name,
        distributor_sku=new_prod.distributor_sku,
        distributor_product_name=new_prod.distributor_product_name,
        supplier=new_prod.supplier,
        unit=new_prod.unit,
        company_id=new_prod.company_id,
        company_code=new_prod.company.code if new_prod.company else None,
        company_name=new_prod.company.name if new_prod.company else None,
        status=new_prod.status,
    )


@router.put("/distributor-products")
def update_distributor_product(payload: DistributorProductUpdate, db: Session = Depends(get_db)):
    """Chỉnh sửa thông tin mã sản phẩm NPP nội bộ & gán/gỡ công ty quản lý."""
    orig_sku = (payload.original_code or payload.distributor_sku).strip().upper()
    target_sku = payload.distributor_sku.strip().upper()

    item: DistributorProduct | None = None
    if payload.id:
        item = db.get(DistributorProduct, payload.id)
    if not item and orig_sku:
        item = db.scalar(select(DistributorProduct).where(DistributorProduct.distributor_sku == orig_sku))
    if not item and target_sku:
        item = db.scalar(select(DistributorProduct).where(DistributorProduct.distributor_sku == target_sku))

    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy mã sản phẩm NPP để cập nhật.")

    # Kiểm tra trùng mã nếu đổi SKU
    if target_sku != item.distributor_sku:
        dup = db.scalar(select(DistributorProduct).where(DistributorProduct.distributor_sku == target_sku, DistributorProduct.id != item.id))
        if dup:
            raise HTTPException(status_code=400, detail=f"Mã sản phẩm NPP '{target_sku}' đã được sử dụng bởi sản phẩm khác.")
        item.distributor_sku = target_sku

    if payload.distributor_product_name.strip():
        item.distributor_product_name = payload.distributor_product_name.strip()
    if payload.distributor_name:
        item.distributor_name = payload.distributor_name.strip()
    if payload.supplier:
        item.supplier = payload.supplier.strip()
    if payload.unit:
        item.unit = payload.unit.strip().upper()

    # Gán hoặc gỡ Công ty Quản lý
    if payload.company_id and payload.company_id > 0:
        comp = db.get(Company, payload.company_id)
        if comp:
            item.company_id = comp.id
        else:
            item.company_id = None
    else:
        item.company_id = None

    # Đồng bộ nếu có Product đang liên kết với npp_code cũ
    if orig_sku and orig_sku != target_sku:
        prods = db.scalars(select(Product).where(Product.npp_code == orig_sku)).all()
        for p in prods:
            p.npp_code = target_sku

    db.commit()
    db.refresh(item)

    return {
        "success": True,
        "message": f"Đã cập nhật mã sản phẩm NPP '{item.distributor_sku}' thành công.",
        "id": item.id,
        "distributor_sku": item.distributor_sku,
        "distributor_product_name": item.distributor_product_name,
        "company_id": item.company_id,
        "company_code": item.company.code if item.company else None,
        "company_name": item.company.name if item.company else None,
    }


@router.delete("/distributor-products/{id_or_code}")
def delete_distributor_product(id_or_code: str, db: Session = Depends(get_db)):
    """Xóa mã sản phẩm NPP nội bộ khỏi danh mục."""
    clean_val = id_or_code.strip()
    if not clean_val:
        raise HTTPException(status_code=400, detail="Mã sản phẩm không hợp lệ.")

    item: DistributorProduct | None = None
    if clean_val.isdigit():
        item = db.get(DistributorProduct, int(clean_val))
    if not item:
        item = db.scalar(select(DistributorProduct).where(DistributorProduct.distributor_sku == clean_val.upper()))

    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy mã sản phẩm NPP cần xóa.")

    sku_to_remove = item.distributor_sku
    db.delete(item)

    # Gỡ npp_code trong Product nếu có
    prods = db.scalars(select(Product).where(Product.npp_code == sku_to_remove)).all()
    for p in prods:
        p.npp_code = None

    db.commit()
    return {
        "success": True,
        "message": f"Đã xóa mã sản phẩm NPP '{sku_to_remove}' thành công.",
        "deleted_code": sku_to_remove,
    }


@router.post("/distributor-products/bulk-delete")
def bulk_delete_distributor_products(payload: DistributorProductBulkDelete, db: Session = Depends(get_db)):
    """Xóa hàng loạt nhiều mã SP NPP theo IDs hoặc Codes."""
    deleted_count = 0
    if payload.ids:
        items = db.scalars(select(DistributorProduct).where(DistributorProduct.id.in_(payload.ids))).all()
        for it in items:
            db.delete(it)
            deleted_count += 1
    elif payload.codes:
        clean_codes = [c.strip().upper() for c in payload.codes if c.strip()]
        items = db.scalars(select(DistributorProduct).where(DistributorProduct.distributor_sku.in_(clean_codes))).all()
        for it in items:
            db.delete(it)
            deleted_count += 1

    db.commit()
    return {
        "success": True,
        "message": f"Đã xóa thành công {deleted_count} mã sản phẩm NPP.",
        "deleted_count": deleted_count,
    }


@router.get("/distributor-products/template")
def download_distributor_product_template():
    """Tải file Excel mẫu để thêm / cập nhật danh sách mã sản phẩm NPP chuẩn 7 cột."""
    wb = Workbook()
    ws = wb.active
    ws.title = "DS_Ma_SP_NPP"
    
    headers = [
        "STT",
        "Nhà phân phối",
        "Mã SP NPP",
        "Tên Sản Phẩm NPP",
        "Nhà cung cấp",
        "Mã Công ty QL",
        "Tên Công ty QL",
    ]
    ws.append(headers)

    sample_rows = [
        [1, "Nhà Phân Phối Mai Gold", "01TD03", "Sữa tươi tiệt trùng có đường 180ml", "Vinamilk", "CT01", "Công ty TNHH Phân Phối Mai Gold"],
        [2, "Nhà Phân Phối Mai Gold", "07KD12", "Sữa chua ăn lựu đỏ 100g", "Vinamilk", "", ""],
        [3, "Nhà Phân Phối Mai Gold", "01SX11", "Sữa dinh dưỡng Optimum Gold 110ml", "Vinamilk", "", ""],
        [4, "Nhà Phân Phối Mai Gold", "02HD14", "Sữa chua ăn Có đường 100g", "Vinamilk", "CT02", "Công ty Cổ Phần Tiếp Vận Nam Việt"],
    ]
    for row in sample_rows:
        ws.append(row)

    # Định dạng độ rộng cột
    ws.column_dimensions["A"].width = 8
    ws.column_dimensions["B"].width = 28
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 44
    ws.column_dimensions["E"].width = 18
    ws.column_dimensions["F"].width = 18
    ws.column_dimensions["G"].width = 36

    output = BytesIO()
    wb.save(output)
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-danh-sach-ma-sp-npp.xlsx"'},
    )


@router.post("/distributor-products/upload")
def upload_distributor_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Upload file Excel để thêm mới và chỉnh sửa hàng loạt danh sách mã sản phẩm NPP.
    - Cột bắt buộc: Mã SP NPP, Tên Sản Phẩm NPP.
    - Khớp Mã Công ty QL với bảng Companies (nếu để trống -> để trống chưa gán).
    - Nếu Mã SP NPP đã có trong hệ thống -> Cập nhật thông tin (Bulk Edit).
    - Nếu chưa có -> Thêm mới.
    """
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel định dạng .xlsx hoặc .xls.")

    from datetime import datetime

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
        sku_idx = -1
        name_idx = -1
        dist_idx = -1
        supplier_idx = -1
        company_code_idx = -1

        for idx, h in enumerate(raw_headers):
            if any(k in h for k in ["mã sp npp", "mã sp", "distributor_sku", "sku", "ma_sp", "mã sản phẩm"]):
                sku_idx = idx
            elif any(k in h for k in ["tên sản phẩm npp", "tên sản phẩm", "tên sp", "distributor_name", "distributor_product_name", "ten_sp"]):
                name_idx = idx
            elif any(k in h for k in ["nhà phân phối", "distributor", "npp"]):
                dist_idx = idx
            elif any(k in h for k in ["nhà cung cấp", "supplier", "ncc"]):
                supplier_idx = idx
            elif any(k in h for k in ["mã công ty ql", "mã công ty", "company_code", "ma_cty", "mã cty"]):
                company_code_idx = idx

        if sku_idx == -1:
            sku_idx = 2 if len(raw_headers) > 2 else 0
        if name_idx == -1:
            name_idx = 3 if len(raw_headers) > 3 else 1

        # Cache danh sách công ty quản lý theo Mã Công ty QL (case-insensitive)
        all_companies = db.scalars(select(Company)).all()
        companies_by_code: dict[str, Company] = {
            c.code.strip().upper(): c for c in all_companies if c.code
        }

        # Cache danh sách sản phẩm NPP hiện có theo SKU
        existing_products = {
            p.distributor_sku.strip().upper(): p
            for p in db.scalars(select(DistributorProduct)).all()
        }

        added = 0
        updated = 0
        now = datetime.utcnow()

        for row_num, row in enumerate(rows[1:], start=2):
            if not row or all(v is None or str(v).strip() == "" for v in row):
                continue

            sku_val = str(row[sku_idx] or "").strip().upper() if sku_idx < len(row) and row[sku_idx] is not None else ""
            if not sku_val or "BẮT BUỘC" in sku_val or "MÃ SP" in sku_val:
                continue

            name_val = str(row[name_idx] or "").strip() if name_idx < len(row) and row[name_idx] is not None else ""
            if not name_val:
                name_val = f"Sản phẩm {sku_val}"

            dist_val = (
                str(row[dist_idx] or "").strip()
                if dist_idx != -1 and dist_idx < len(row) and row[dist_idx] is not None
                else "Nhà Phân Phối Mai Gold"
            )
            if not dist_val:
                dist_val = "Nhà Phân Phối Mai Gold"

            supplier_val = (
                str(row[supplier_idx] or "").strip()
                if supplier_idx != -1 and supplier_idx < len(row) and row[supplier_idx] is not None
                else "Vinamilk"
            )
            if not supplier_val:
                supplier_val = "Vinamilk"

            # Xử lý Mã Công ty QL: Khớp với bảng companies theo mã code
            company_id = None
            if company_code_idx != -1 and company_code_idx < len(row) and row[company_code_idx] is not None:
                raw_code = str(row[company_code_idx] or "").strip().upper()
                if raw_code and raw_code in companies_by_code:
                    company_id = companies_by_code[raw_code].id

            # Upsert
            if sku_val in existing_products:
                item = existing_products[sku_val]
                item.distributor_product_name = name_val
                item.distributor_name = dist_val
                item.supplier = supplier_val
                item.company_id = company_id
                item.updated_at = now
                updated += 1
            else:
                new_item = DistributorProduct(
                    distributor_name=dist_val,
                    distributor_sku=sku_val,
                    distributor_product_name=name_val,
                    supplier=supplier_val,
                    unit="HOP",
                    company_id=company_id,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_item)
                existing_products[sku_val] = new_item
                added += 1

        db.commit()
        return {
            "success": True,
            "message": f"Tải lên thành công: Đã thêm mới {added} mã và cập nhật {updated} mã sản phẩm NPP.",
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
