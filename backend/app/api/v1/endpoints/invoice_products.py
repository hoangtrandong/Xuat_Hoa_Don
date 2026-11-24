from datetime import datetime
from io import BytesIO
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from openpyxl import Workbook, load_workbook
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.auth import (
    ensure_entity_in_distributor_scope,
    get_current_user,
    resolve_distributor_scope,
)
from app.core.database import get_db
from app.models.customer import Company
from app.models.product import DistributorProduct, InvoiceProduct, Product, ProductCompany
from app.models.user import User
from app.schemas.invoice_product import (
    InvoiceProductBulkAssignCompany,
    InvoiceProductBulkDelete,
    InvoiceProductCreate,
    InvoiceProductItem,
    InvoiceProductUpdate,
)

router = APIRouter(prefix="/invoice-products", tags=["invoice-products"])


def _parse_vat_rate(raw_val) -> Optional[float]:
    if raw_val is None:
        return None
    s = str(raw_val).strip().upper().replace("%", "")
    if not s:
        return None
    if s in ("KCT", "KHONG CHIU THUE", "KHÔNG CHỊU THUẾ", "-1"):
        return -1.0
    try:
        v = float(s.replace(",", "."))
        return v
    except ValueError:
        return None


def _serialize_invoice_products(db: Session, items: list[InvoiceProduct]) -> list[InvoiceProductItem]:
    if not items:
        return []
    ids = [it.id for it in items]

    cqt_counts = dict(
        db.execute(
            select(Product.invoice_product_id, func.count(Product.id))
            .where(Product.invoice_product_id.in_(ids))
            .group_by(Product.invoice_product_id)
        ).all()
    )
    dms_counts = dict(
        db.execute(
            select(DistributorProduct.invoice_product_id, func.count(DistributorProduct.id))
            .where(DistributorProduct.invoice_product_id.in_(ids))
            .group_by(DistributorProduct.invoice_product_id)
        ).all()
    )

    return [
        InvoiceProductItem(
            id=it.id,
            distributor_id=it.distributor_id,
            code=it.code,
            name=it.name,
            unit_name=it.unit_name or "Hộp",
            vat_rate=it.vat_rate,
            supplier=it.supplier or "",
            default_company_id=it.default_company_id,
            default_company_code=it.default_company.code if it.default_company else None,
            default_company_name=(it.default_company.short_name or it.default_company.name) if it.default_company else None,
            note=it.note,
            status=it.status or "active",
            cqt_sku_count=int(cqt_counts.get(it.id, 0)),
            dms_product_count=int(dms_counts.get(it.id, 0)),
            created_at=it.created_at,
            updated_at=it.updated_at,
        )
        for it in items
    ]


@router.get("", response_model=List[InvoiceProductItem])
@router.get("/", response_model=List[InvoiceProductItem])
def list_invoice_products(
    distributor_id: Optional[int] = None,
    search: Optional[str] = None,
    supplier: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Danh sách Sản phẩm xuất hóa đơn (dùng chung cho mọi Công ty QL thuộc 1 Nhà phân phối)."""
    scoped_dist_id = resolve_distributor_scope(current_user, distributor_id)
    stmt = (
        select(InvoiceProduct)
        .options(joinedload(InvoiceProduct.default_company))
        .order_by(InvoiceProduct.code.asc(), InvoiceProduct.id.desc())
    )
    if scoped_dist_id is not None:
        stmt = stmt.where(
            (InvoiceProduct.distributor_id == scoped_dist_id)
            | (InvoiceProduct.distributor_id.is_(None))
        )
    if supplier and supplier.strip() and supplier.strip().upper() != "ALL":
        stmt = stmt.where(InvoiceProduct.supplier == supplier.strip())
    if search and search.strip():
        q = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            func.lower(InvoiceProduct.code).like(q)
            | func.lower(InvoiceProduct.name).like(q)
            | func.lower(InvoiceProduct.supplier).like(q)
        )

    items = list(db.scalars(stmt).all())
    return _serialize_invoice_products(db, items)


@router.post("", response_model=InvoiceProductItem, status_code=201)
@router.post("/", response_model=InvoiceProductItem, status_code=201)
def create_invoice_product(
    payload: InvoiceProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scoped_dist_id = resolve_distributor_scope(current_user, payload.distributor_id)
    clean_code = payload.code.strip().upper()
    clean_name = payload.name.strip()
    if not clean_code or not clean_name:
        raise HTTPException(status_code=400, detail="Mã SP xuất hóa đơn và Tên SP xuất hóa đơn không được để trống.")

    dup_stmt = select(InvoiceProduct).where(func.upper(InvoiceProduct.code) == clean_code)
    if scoped_dist_id is not None:
        dup_stmt = dup_stmt.where(InvoiceProduct.distributor_id == scoped_dist_id)
    else:
        dup_stmt = dup_stmt.where(InvoiceProduct.distributor_id.is_(None))
    if db.scalar(dup_stmt):
        raise HTTPException(status_code=400, detail=f"Mã SP xuất hóa đơn '{clean_code}' đã tồn tại.")

    target_company_id = payload.default_company_id if (payload.default_company_id and payload.default_company_id > 0) else None
    if target_company_id is not None:
        comp = db.get(Company, target_company_id)
        if not comp:
            raise HTTPException(status_code=400, detail="Công ty quản lý không tồn tại.")
        ensure_entity_in_distributor_scope(current_user, comp.distributor_id)

    item = InvoiceProduct(
        distributor_id=scoped_dist_id,
        code=clean_code,
        name=clean_name,
        unit_name=(payload.unit_name or "Hộp").strip() or "Hộp",
        vat_rate=payload.vat_rate,
        supplier=(payload.supplier or "").strip(),
        default_company_id=target_company_id,
        note=(payload.note or "").strip() or None,
        status=(payload.status or "active").strip() or "active",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize_invoice_products(db, [item])[0]


@router.put("/{item_id}", response_model=InvoiceProductItem)
def update_invoice_product(
    item_id: int,
    payload: InvoiceProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.get(InvoiceProduct, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm xuất hóa đơn.")
    ensure_entity_in_distributor_scope(current_user, item.distributor_id)

    if payload.code is not None:
        clean_code = payload.code.strip().upper()
        if not clean_code:
            raise HTTPException(status_code=400, detail="Mã SP xuất hóa đơn không được để trống.")
        dup_stmt = select(InvoiceProduct).where(
            func.upper(InvoiceProduct.code) == clean_code,
            InvoiceProduct.id != item.id,
        )
        if item.distributor_id is not None:
            dup_stmt = dup_stmt.where(InvoiceProduct.distributor_id == item.distributor_id)
        else:
            dup_stmt = dup_stmt.where(InvoiceProduct.distributor_id.is_(None))
        if db.scalar(dup_stmt):
            raise HTTPException(status_code=400, detail=f"Mã SP xuất hóa đơn '{clean_code}' đã tồn tại.")
        item.code = clean_code

    if payload.name is not None:
        clean_name = payload.name.strip()
        if not clean_name:
            raise HTTPException(status_code=400, detail="Tên SP xuất hóa đơn không được để trống.")
        item.name = clean_name
    if payload.unit_name is not None:
        item.unit_name = payload.unit_name.strip() or "Hộp"
    if "vat_rate" in payload.model_fields_set:
        item.vat_rate = payload.vat_rate
    if payload.supplier is not None:
        item.supplier = payload.supplier.strip()
    if "default_company_id" in payload.model_fields_set:
        if payload.default_company_id and payload.default_company_id > 0:
            comp = db.get(Company, payload.default_company_id)
            if not comp:
                raise HTTPException(status_code=400, detail="Công ty quản lý không tồn tại.")
            ensure_entity_in_distributor_scope(current_user, comp.distributor_id)
            item.default_company_id = comp.id
        else:
            item.default_company_id = None
    if "note" in payload.model_fields_set:
        item.note = (payload.note or "").strip() or None
    if payload.status is not None:
        item.status = payload.status.strip() or "active"

    item.updated_at = datetime.utcnow()
    db.flush()

    # Đồng bộ ngược sang các bảng liên kết để luôn nhất quán
    linked_dms = db.scalars(
        select(DistributorProduct).where(DistributorProduct.invoice_product_id == item.id)
    ).all()
    for dp in linked_dms:
        dp.invoice_product_code = item.code
        dp.invoice_product_name = item.name

    linked_prods = db.scalars(
        select(Product).where(Product.invoice_product_id == item.id)
    ).all()
    for prod in linked_prods:
        prod.npp_code = item.code
        prod.internal_name = item.name
        prod.internal_unit = item.unit_name
        for pc in db.scalars(select(ProductCompany).where(ProductCompany.product_id == prod.id)).all():
            pc.npp_code = item.code

    db.commit()
    db.refresh(item)
    return _serialize_invoice_products(db, [item])[0]


@router.delete("/{item_id}")
def delete_invoice_product(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.get(InvoiceProduct, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm xuất hóa đơn.")
    ensure_entity_in_distributor_scope(current_user, item.distributor_id)

    # Gỡ liên kết trên products và distributor_products
    for dp in db.scalars(select(DistributorProduct).where(DistributorProduct.invoice_product_id == item.id)).all():
        dp.invoice_product_id = None
        dp.invoice_product_code = None
        dp.invoice_product_name = None
    for prod in db.scalars(select(Product).where(Product.invoice_product_id == item.id)).all():
        prod.invoice_product_id = None

    code = item.code
    db.delete(item)
    db.commit()
    return {"success": True, "message": f"Đã xóa sản phẩm xuất hóa đơn '{code}'."}


@router.post("/bulk-delete")
def bulk_delete_invoice_products(
    payload: InvoiceProductBulkDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not payload.ids:
        return {"success": True, "deleted_count": 0}
    stmt = select(InvoiceProduct).where(InvoiceProduct.id.in_(payload.ids))
    if current_user.distributor_id is not None:
        stmt = stmt.where(InvoiceProduct.distributor_id == current_user.distributor_id)
    items = list(db.scalars(stmt).all())
    ids = [it.id for it in items]
    if ids:
        for dp in db.scalars(select(DistributorProduct).where(DistributorProduct.invoice_product_id.in_(ids))).all():
            dp.invoice_product_id = None
            dp.invoice_product_code = None
            dp.invoice_product_name = None
        for prod in db.scalars(select(Product).where(Product.invoice_product_id.in_(ids))).all():
            prod.invoice_product_id = None
        for it in items:
            db.delete(it)
        db.commit()
    return {
        "success": True,
        "deleted_count": len(items),
        "message": f"Đã xóa {len(items)} sản phẩm xuất hóa đơn.",
    }


@router.post("/bulk-assign-company")
def bulk_assign_company_to_invoice_products(
    payload: InvoiceProductBulkAssignCompany,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Gán (hoặc gỡ) Công ty quản lý mặc định hàng loạt cho danh sách Sản phẩm XHĐ."""
    if not payload.ids:
        raise HTTPException(status_code=400, detail="Chưa chọn sản phẩm XHĐ nào.")

    target_comp: Company | None = None
    if payload.company_id is not None and payload.company_id > 0:
        target_comp = db.get(Company, payload.company_id)
        if not target_comp:
            raise HTTPException(status_code=404, detail="Không tìm thấy Công ty quản lý.")
        ensure_entity_in_distributor_scope(current_user, target_comp.distributor_id)

    stmt = select(InvoiceProduct).where(InvoiceProduct.id.in_(payload.ids))
    if current_user.distributor_id is not None:
        stmt = stmt.where(
            (InvoiceProduct.distributor_id == current_user.distributor_id)
            | (InvoiceProduct.distributor_id.is_(None))
        )
    items = list(db.scalars(stmt).all())
    now = datetime.utcnow()
    for it in items:
        it.default_company_id = target_comp.id if target_comp else None
        it.updated_at = now
    db.commit()

    return {
        "success": True,
        "updated_count": len(items),
        "company_id": target_comp.id if target_comp else None,
        "company_name": (target_comp.short_name or target_comp.name) if target_comp else None,
        "message": (
            f"Đã gán Công ty QL '{target_comp.short_name or target_comp.name}' cho {len(items)} Sản phẩm XHĐ."
            if target_comp
            else f"Đã gỡ Công ty QL mặc định khỏi {len(items)} Sản phẩm XHĐ."
        ),
    }


@router.get("/template")
def download_invoice_product_template():
    """Tải file Excel mẫu để thêm mới / cập nhật hàng loạt Danh sách SP xuất hóa đơn."""
    wb = Workbook()
    ws = wb.active
    ws.title = "DS_SP_Xuat_Hoa_Don"

    headers = [
        "STT",
        "Mã SP Xuất Hóa Đơn",
        "Tên SP Xuất Hóa Đơn",
        "ĐVT Xuất HĐ",
        "Thuế suất VAT (%)",
        "Nhà cung cấp",
        "Mã Công ty QL",
        "Ghi chú",
    ]
    ws.append(headers)

    sample_rows = [
        [1, "01TD03", "Sữa tươi tiệt trùng có đường Vinamilk 180ml", "Hộp", 8, "Vinamilk", "CT01", "Đơn vị nhỏ nhất"],
        [2, "07KD12", "Sữa chua ăn Vinamilk có đường 100g", "Hộp", 8, "Vinamilk", "CT01", ""],
        [3, "NZ001", "Nước giải khát Nazzy 330ml", "Lon", 10, "Nazzy", "CT02", ""],
    ]
    for row in sample_rows:
        ws.append(row)

    ws.column_dimensions["A"].width = 8
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 44
    ws.column_dimensions["D"].width = 16
    ws.column_dimensions["E"].width = 18
    ws.column_dimensions["F"].width = 20
    ws.column_dimensions["G"].width = 18
    ws.column_dimensions["H"].width = 28

    output = BytesIO()
    wb.save(output)
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-danh-sach-sp-xuat-hoa-don.xlsx"'},
    )


@router.post("/upload")
def upload_invoice_products(
    file: UploadFile = File(...),
    distributor_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload Excel thêm mới / cập nhật hàng loạt Danh sách SP xuất hóa đơn (upsert theo distributor_id + code)."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel định dạng .xlsx hoặc .xls.")

    scoped_dist_id = resolve_distributor_scope(current_user, distributor_id)

    try:
        content = file.file.read()
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
        sheet = wb.active
        rows = list(sheet.iter_rows(values_only=True))
        if not rows or len(rows) < 2:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu để xử lý.")

        raw_headers = [str(c or "").strip().lower() for c in rows[0]]
        code_idx = -1
        name_idx = -1
        unit_idx = -1
        vat_idx = -1
        supplier_idx = -1
        company_code_idx = -1
        note_idx = -1

        for idx, h in enumerate(raw_headers):
            if any(k in h for k in ["mã công ty ql", "mã công ty", "company_code", "ma_cty", "mã cty"]):
                if company_code_idx == -1:
                    company_code_idx = idx
            elif any(k in h for k in ["mã sp xuất hóa đơn", "mã sản phẩm xuất hóa đơn", "mã sp xuất hđ", "mã sp", "code", "sku", "mã hàng"]):
                if code_idx == -1:
                    code_idx = idx
            elif any(k in h for k in ["tên sp xuất hóa đơn", "tên sản phẩm xuất hóa đơn", "tên sp", "tên sản phẩm", "tên hàng", "name"]):
                if name_idx == -1:
                    name_idx = idx
            elif any(k in h for k in ["đvt", "đơn vị", "unit"]):
                if unit_idx == -1:
                    unit_idx = idx
            elif any(k in h for k in ["vat", "thuế suất", "thuế"]):
                if vat_idx == -1:
                    vat_idx = idx
            elif any(k in h for k in ["nhà cung cấp", "ncc", "supplier"]):
                if supplier_idx == -1:
                    supplier_idx = idx
            elif any(k in h for k in ["ghi chú", "note"]):
                if note_idx == -1:
                    note_idx = idx

        if code_idx == -1:
            code_idx = 1 if len(raw_headers) > 1 else 0
        if name_idx == -1:
            name_idx = 2 if len(raw_headers) > 2 else 1

        comp_stmt = select(Company)
        if scoped_dist_id is not None:
            comp_stmt = comp_stmt.where(
                (Company.distributor_id == scoped_dist_id) | (Company.distributor_id.is_(None))
            )
        companies_by_code = {
            c.code.strip().upper(): c for c in db.scalars(comp_stmt).all() if c.code
        }

        existing_stmt = select(InvoiceProduct)
        if scoped_dist_id is not None:
            existing_stmt = existing_stmt.where(InvoiceProduct.distributor_id == scoped_dist_id)
        else:
            existing_stmt = existing_stmt.where(InvoiceProduct.distributor_id.is_(None))
        existing_map = {it.code.strip().upper(): it for it in db.scalars(existing_stmt).all()}

        added = 0
        updated = 0
        now = datetime.utcnow()

        for row in rows[1:]:
            if not row or all(v is None or str(v).strip() == "" for v in row):
                continue
            code_val = str(row[code_idx] or "").strip().upper() if code_idx < len(row) and row[code_idx] is not None else ""
            if not code_val or "MÃ SP" in code_val:
                continue
            name_val = str(row[name_idx] or "").strip() if name_idx < len(row) and row[name_idx] is not None else ""
            if not name_val:
                name_val = code_val
            unit_val = (
                str(row[unit_idx] or "").strip()
                if unit_idx != -1 and unit_idx < len(row) and row[unit_idx] is not None
                else "Hộp"
            ) or "Hộp"
            vat_val = _parse_vat_rate(row[vat_idx]) if (vat_idx != -1 and vat_idx < len(row)) else None
            supplier_val = (
                str(row[supplier_idx] or "").strip()
                if supplier_idx != -1 and supplier_idx < len(row) and row[supplier_idx] is not None
                else ""
            )
            default_comp_id = None
            if company_code_idx != -1 and company_code_idx < len(row) and row[company_code_idx] is not None:
                raw_comp_code = str(row[company_code_idx] or "").strip().upper()
                if raw_comp_code and raw_comp_code in companies_by_code:
                    default_comp_id = companies_by_code[raw_comp_code].id
            note_val = (
                str(row[note_idx] or "").strip() or None
                if note_idx != -1 and note_idx < len(row) and row[note_idx] is not None
                else None
            )

            if code_val in existing_map:
                item = existing_map[code_val]
                item.name = name_val
                if unit_idx != -1:
                    item.unit_name = unit_val
                if vat_idx != -1 and vat_val is not None:
                    item.vat_rate = vat_val
                if supplier_idx != -1 and supplier_val:
                    item.supplier = supplier_val
                if company_code_idx != -1 and default_comp_id is not None:
                    item.default_company_id = default_comp_id
                if note_idx != -1:
                    item.note = note_val
                item.updated_at = now
                updated += 1
            else:
                new_item = InvoiceProduct(
                    distributor_id=scoped_dist_id,
                    code=code_val,
                    name=name_val,
                    unit_name=unit_val,
                    vat_rate=vat_val,
                    supplier=supplier_val,
                    default_company_id=default_comp_id,
                    note=note_val,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_item)
                existing_map[code_val] = new_item
                added += 1

        db.commit()
        return {
            "success": True,
            "added": added,
            "updated": updated,
            "total_processed": added + updated,
            "message": f"Tải lên thành công: Thêm mới {added} và cập nhật {updated} SP xuất hóa đơn.",
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Lỗi khi đọc file Excel: {str(exc)}")
