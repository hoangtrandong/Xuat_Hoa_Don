from datetime import datetime, date, time, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from typing import Any, List
from zipfile import BadZipFile
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.schemas.inventory import (
    InventoryImportConfirm, InventoryImportItem, InventoryTransaction, StockLevel,
    StockAdjust, BulkDeleteStockRequest, Warehouse, WarehouseLocation, InventoryLot, InventoryLotDetail,
    InventoryTransferCreate, InventoryTransferResponse,
    SupplierGoodsDiscrepancyResponse, SupplierGoodsDiscrepancyHistory,
    SupplierGoodsDiscrepancySuggestion, SupplierGoodsDiscrepancyOffsetConfirm,
    SupplierGoodsDiscrepancyOffsetResponse,
)
from app.models.inventory import (
    InventoryLot as LotModel, InventoryTransaction as TransactionModel,
    Warehouse as WarehouseModel, WarehouseLocation as LocationModel,
    InventoryTransfer as TransferModel, DeliveryAllocation, DeliveryRequest,
    DeliveryRequestItem,
)
from app.models.product import (
    Product, ProductCategory, ProductCompany, ProductGroup, ProductGroupItem, ProductUnit, InvoiceProduct,
)
from app.crud import inventory as crud
from app.crud.npp import NppDirectory, canonical_product_id
from app.crud import supplier_discrepancy as discrepancy_crud
from uuid import uuid4

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _header(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _parse_expiry(value: Any, lot_number: str) -> datetime:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(f"Lot '{lot_number}' không có HSD.")
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    text = str(value).strip()
    for format_string in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d.%m.%Y", "%y%m%d"):
        try:
            return datetime.strptime(text, format_string)
        except ValueError:
            continue
    match = re.match(r"^(\d{6})(?:-|$)", lot_number.strip())
    if match:
        try:
            return datetime.strptime(match.group(1), "%y%m%d")
        except ValueError:
            pass
    raise ValueError(f"HSD '{text}' của lot '{lot_number}' không hợp lệ.")


def _parse_sku(item: Any) -> str:
    text = str(item or "").strip()
    if " - " in text:
        return text.split(" - ", 1)[0].strip().upper()
    if "-" in text:
        return text.split("-", 1)[0].strip().upper()
    return text.upper()


def _parse_import_datetime(value: Any) -> datetime | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    if isinstance(value, (int, float)):
        # Excel stores dates as days from 1899-12-30.
        return datetime(1899, 12, 30) + timedelta(days=float(value))
    text = str(value).strip()
    for format_string in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
                          "%d/%m/%Y", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M",
                          "%d-%m-%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
                          "%Y-%m-%d"):
        try:
            return datetime.strptime(text, format_string)
        except ValueError:
            continue
    raise ValueError(f"Ô H6 có thời gian không hợp lệ: '{text}'.")


def _parse_actual_quantity(value: Any, document_quantity: int, row_number: int) -> int:
    if value is None or (isinstance(value, str) and not value.strip()):
        return document_quantity
    if isinstance(value, bool):
        raise ValueError(f"Dòng {row_number}: S.Lượng thực nhận phải là số hộp.")
    try:
        decimal_quantity = Decimal(str(value))
        if not decimal_quantity.is_finite() or decimal_quantity != decimal_quantity.to_integral_value():
            raise ValueError
        quantity = int(decimal_quantity)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"Dòng {row_number}: S.Lượng thực nhận phải là số hộp.") from exc
    if quantity < 0:
        raise ValueError(f"Dòng {row_number}: S.Lượng thực nhận không được âm.")
    return quantity


@router.post("/import/upload", response_model=List[InventoryImportItem])
def upload_inventory_import(warehouse_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not db.get(WarehouseModel, warehouse_id):
        raise HTTPException(status_code=400, detail="Không tìm thấy kho.")
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        sheet = workbook.worksheets[0]
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) < 16:
            raise ValueError("File Excel không có dữ liệu từ dòng 16.")
        headers = [_header(value) for value in rows[14]]
        required = {"tên sản phẩm", "lot", "hạn sử dụng", "số lượng"}
        if not required.issubset(headers):
            raise ValueError("File phải có các cột Tên Sản Phẩm, Lot, Hạn sử dụng và Số Lượng ở dòng 15.")
        indexes = {name: headers.index(name) for name in required}
        actual_quantity_headers = (
            "actual_qty", "số lượng thực nhận", "sl thực nhận",
            "s.lượng thực nhận", "thực nhận", "số lượng thực tế",
        )
        actual_quantity_index = next(
            (headers.index(name) for name in actual_quantity_headers if name in headers),
            None,
        )
        unit_index = headers.index("đvt") if "đvt" in headers else None
        price_index = headers.index("đơn giá") if "đơn giá" in headers else None
        amount_index = headers.index("thành tiền") if "thành tiền" in headers else None
        note_index = headers.index("ghi chú") if "ghi chú" in headers else None
        invoice_number = str(rows[7][1] or "").strip() if len(rows) > 7 and len(rows[7]) > 1 else None
        invoice_number = invoice_number or None
        document_date = _parse_import_datetime(rows[7][7] if len(rows) > 7 and len(rows[7]) > 7 else None)
        products = {product.sku.upper(): product for product in db.scalars(select(Product)).all()}
        products_by_id = {product.id: product for product in products.values()}
        directory = NppDirectory(db)
        grouped: dict[tuple[int, str, datetime], dict[str, Any]] = {}
        for row_number, values in enumerate(rows[15:], 16):
            if not any(value is not None and str(value).strip() for value in values):
                continue
            sku = _parse_sku(values[indexes["tên sản phẩm"]] if indexes["tên sản phẩm"] < len(values) else None)
            lot_number = str(values[indexes["lot"]] if indexes["lot"] < len(values) else "").strip()
            if not sku or not lot_number:
                continue
            product = products.get(sku)
            if not product:
                raise ValueError(f"Dòng {row_number}: không tìm thấy mã sản phẩm {sku}.")
            canonical_id = directory.canonical(product.id)
            if canonical_id is None:
                raise ValueError(f"Dòng {row_number}: SKU {sku} chưa thuộc nhóm mã NPP. Hãy gán mã NPP trước.")
            npp_product = products_by_id[canonical_id]
            npp_code, npp_name = directory.label(canonical_id, npp_product.sku, npp_product.name)
            try:
                quantity = int(values[indexes["số lượng"]])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Dòng {row_number}: S.Lượng phải là số hộp.") from exc
            if quantity <= 0:
                raise ValueError(f"Dòng {row_number}: S.Lượng phải lớn hơn 0.")
            actual_quantity = _parse_actual_quantity(
                values[actual_quantity_index]
                if actual_quantity_index is not None and actual_quantity_index < len(values)
                else None,
                quantity,
                row_number,
            )
            expiry_date = _parse_expiry(values[indexes["hạn sử dụng"]], lot_number)
            key = (canonical_id, lot_number, expiry_date)
            item = grouped.setdefault(key, {
                "product_id": canonical_id, "sku": npp_code, "product_name": npp_name,
                "unit": values[unit_index] if unit_index is not None and unit_index < len(values) else None,
                "lot_number": lot_number, "expiry_date": expiry_date,
                "boxes_per_carton": max(1, int(product.boxes_per_carton or 1)),
                "cartons": 0, "loose_boxes": 0, "quantity": 0, "actual_qty": 0,
                "allocations": [],
                "delivery_references": None, "po_references": None,
                "document_date": document_date,
                "invoice_number": invoice_number,
                "unit_price": float(values[price_index] or 0) if price_index is not None and price_index < len(values) else None,
                "amount": float(values[amount_index] or 0) if amount_index is not None and amount_index < len(values) else None,
                "note": str(values[note_index]).strip() if note_index is not None and note_index < len(values) and values[note_index] is not None else None,
            })
            item["quantity"] += quantity
            item["actual_qty"] += actual_quantity
            item["cartons"], item["loose_boxes"] = divmod(
                item["quantity"], item["boxes_per_carton"],
            )
        return [InventoryImportItem(**item) for item in grouped.values()]
    except HTTPException:
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/confirm", response_model=List[InventoryTransaction], status_code=201)
def confirm_inventory_import(
    payload: InventoryImportConfirm,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = getattr(current_user, "username", None) or payload.created_by
    if not db.get(WarehouseModel, payload.warehouse_id):
        raise HTTPException(status_code=400, detail="Không tìm thấy kho.")
    transaction_time = datetime.utcnow()
    created: list[TransactionModel] = []
    try:
        for item in payload.items:
            item = item.model_copy(update={"product_id": canonical_product_id(db, item.product_id)})
            actual_quantity = item.actual_qty if item.actual_qty is not None else item.quantity
            total_allocated = sum(allocation.quantity for allocation in item.allocations)
            if total_allocated != actual_quantity:
                raise ValueError(
                    f"{item.sku} / {item.lot_number}: phân bổ {total_allocated}/{actual_quantity} hộp thực nhận."
                )
            allocated_lots = []
            for allocation in item.allocations:
                location = db.get(LocationModel, allocation.location_id)
                if not location or location.warehouse_id != payload.warehouse_id or not location.is_active:
                    raise ValueError(f"Vị trí {allocation.location_id} không thuộc kho hoặc không hoạt động.")
                lot = db.scalar(select(LotModel).where(
                    LotModel.warehouse_id == payload.warehouse_id,
                    LotModel.product_id == item.product_id,
                    LotModel.location_id == allocation.location_id,
                    LotModel.lot_number == item.lot_number,
                    LotModel.expiry_date == item.expiry_date,
                ).with_for_update())
                if not lot:
                    lot = LotModel(
                        warehouse_id=payload.warehouse_id, product_id=item.product_id,
                        location_id=allocation.location_id, lot_number=item.lot_number,
                        expiry_date=item.expiry_date, quantity_on_hand=0,
                    )
                    db.add(lot)
                    db.flush()
                lot.quantity_on_hand += allocation.quantity
                allocated_lots.append((lot, allocation.quantity))
                transaction = TransactionModel(
                    code=f"ITT-{transaction_time:%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}",
                    type="IN", warehouse_id=payload.warehouse_id, product_id=item.product_id,
                    quantity=allocation.quantity, lot_id=lot.id, location_id=allocation.location_id,
                    expiry_date=item.expiry_date, unit_cost=item.unit_price,
                    ref_type="INVOICE", ref_code=payload.invoice_number or payload.ref_code,
                    note=payload.note or (
                        f"Hóa đơn {payload.invoice_number or payload.ref_code or '-'} - "
                        f"{item.sku} - {item.lot_number}" +
                        (f" - {item.note}" if item.note else "")
                    ),
                    created_by=actor,
                    created_at=transaction_time,
                    document_date=payload.document_date,
                )
                db.add(transaction)
                created.append(transaction)
            discrepancy_crud.create_import_discrepancy(
                db,
                warehouse_id=payload.warehouse_id,
                product_id=item.product_id,
                document_quantity=item.quantity,
                actual_quantity=actual_quantity,
                lot_number=item.lot_number,
                expiry_date=item.expiry_date,
                invoice_number=payload.invoice_number or item.invoice_number,
                ref_code=payload.ref_code,
                document_date=payload.document_date or item.document_date,
                note=item.note or payload.note,
                created_by=actor,
                allocated_lots=allocated_lots,
            )
        db.commit()
        for transaction in created:
            db.refresh(transaction)
        return created
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/supplier-discrepancies/",
    response_model=List[SupplierGoodsDiscrepancyResponse],
)
def list_supplier_discrepancies(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    discrepancy_type: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    if discrepancy_type and discrepancy_type.upper() not in {"SHORTAGE", "EXCESS"}:
        raise HTTPException(status_code=400, detail="Loại chênh lệch phải là SHORTAGE hoặc EXCESS.")
    if status and status.upper() not in {"OPEN", "PARTIAL", "RESOLVED"}:
        raise HTTPException(status_code=400, detail="Trạng thái phải là OPEN, PARTIAL hoặc RESOLVED.")
    return discrepancy_crud.list_discrepancies(
        db, warehouse_id, product_id, discrepancy_type, status
    )


@router.get(
    "/supplier-discrepancies/{discrepancy_id}/history",
    response_model=SupplierGoodsDiscrepancyHistory,
)
def supplier_discrepancy_history(discrepancy_id: int, db: Session = Depends(get_db)):
    history = discrepancy_crud.discrepancy_history(db, discrepancy_id)
    if history is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy chênh lệch hàng nhà cung cấp.")
    return history


@router.get(
    "/supplier-discrepancies/{discrepancy_id}/offset-suggestions",
    response_model=List[SupplierGoodsDiscrepancySuggestion],
)
def supplier_discrepancy_offset_suggestions(
    discrepancy_id: int, db: Session = Depends(get_db)
):
    try:
        return discrepancy_crud.suggest_offsets(db, discrepancy_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/supplier-discrepancies/offsets/confirm",
    response_model=SupplierGoodsDiscrepancyOffsetResponse,
    status_code=201,
)
def confirm_supplier_discrepancy_offset(
    payload: SupplierGoodsDiscrepancyOffsetConfirm,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        actor = getattr(current_user, "username", None) or payload.created_by
        return discrepancy_crud.confirm_offset(
            db, payload.model_copy(update={"created_by": actor})
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/opening-stock/template")
def download_opening_stock_template():
    """Tải file Excel mẫu để upload khởi tạo tồn kho đầu kỳ theo Mã SP XHĐ."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Ton_Dau_Ky"

    headers = [
        "STT",
        "Mã SP XHĐ",
        "Tên sản phẩm",
        "Vị trí kho",
        "Số lô",
        "Hạn sử dụng",
        "Số lượng tồn đầu",
        "Ghi chú",
    ]
    ws.append(headers)
    ws.append([1, "01TD03", "Sữa tươi tiệt trùng có đường 180ml", "A1-01", "LOT-202611", "31/12/2026", 480, "Tồn đầu kỳ"])
    ws.append([2, "07KD12", "Sữa chua ăn 100g", "A1-02", "LOT-202611B", "15/01/2027", 240, "Tồn đầu kỳ"])

    widths = {"A": 8, "B": 18, "C": 38, "D": 16, "E": 18, "F": 16, "G": 18, "H": 24}
    for col, width in widths.items():
        ws.column_dimensions[col].width = width

    out = BytesIO()
    wb.save(out)
    return Response(
        content=out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-ton-kho-dau-ky.xlsx"'},
    )


def _ensure_canonical_product_for_invoice_product(
    db: Session,
    ip: InvoiceProduct,
    default_cat: ProductCategory | None,
    units_by_name: dict[str, ProductUnit],
    default_unit: ProductUnit | None,
) -> Product:
    """Tìm Product gắn với InvoiceProduct; nếu chưa có thì tự tạo Product đại diện + ProductGroup."""
    prod = db.scalar(select(Product).where(Product.invoice_product_id == ip.id).limit(1))
    if prod is None:
        pc_pid = db.scalar(
            select(ProductCompany.product_id)
            .where(ProductCompany.invoice_product_id == ip.id)
            .order_by(ProductCompany.is_primary.desc(), ProductCompany.id.asc())
            .limit(1)
        )
        if pc_pid is not None:
            prod = db.get(Product, pc_pid)
    if prod is None:
        prod = db.scalar(select(Product).where(func.upper(Product.sku) == ip.code.strip().upper()).limit(1))
        if prod is not None and prod.invoice_product_id is None:
            prod.invoice_product_id = ip.id
    if prod is None:
        unit_obj = units_by_name.get((ip.unit_name or "").strip().lower()) or default_unit
        if unit_obj is None:
            unit_obj = db.scalars(select(ProductUnit).order_by(ProductUnit.id)).first()
        if unit_obj is None:
            unit_obj = ProductUnit(code="HOP", name="Hộp")
            db.add(unit_obj)
            db.flush()
            units_by_name["hộp"] = unit_obj
        cat_obj = default_cat or db.scalars(select(ProductCategory).order_by(ProductCategory.id)).first()
        if cat_obj is None:
            cat_obj = ProductCategory(code="MACDINH", name="Mặc định")
            db.add(cat_obj)
            db.flush()
        prod = Product(
            sku=ip.code.strip().upper(),
            name=ip.name.strip(),
            category_id=cat_obj.id,
            unit_id=unit_obj.id,
            boxes_per_carton=1,
            base_price=0.0,
            status="active",
            invoice_product_id=ip.id,
            _npp_code=ip.code.strip().upper(),
        )
        db.add(prod)
        db.flush()

    # Đảm bảo thuộc ProductGroup để FEFO / adjust_stock hoạt động mượt
    existing_group = db.scalar(
        select(ProductGroupItem.product_group_id).where(ProductGroupItem.product_id == prod.id).limit(1)
    )
    if existing_group is None:
        grp = ProductGroup(name=ip.name.strip(), representative_product_id=prod.id)
        db.add(grp)
        db.flush()
        db.add(ProductGroupItem(product_group_id=grp.id, product_id=prod.id))
        db.flush()
    return prod


@router.post("/opening-stock/upload")
def upload_opening_stock(
    warehouse_id: int,
    mode: str = "ADD",
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload Excel khởi tạo tồn kho đầu kỳ theo Mã SP XHĐ (tự tạo vị trí kho & lô FEFO)."""
    if not db.get(WarehouseModel, warehouse_id):
        raise HTTPException(status_code=400, detail="Không tìm thấy kho.")
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel định dạng .xlsx hoặc .xls.")

    actor = getattr(current_user, "username", None) or "system"
    clean_mode = (mode or "ADD").strip().upper()
    if clean_mode not in ("ADD", "REPLACE"):
        clean_mode = "ADD"

    try:
        wb = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows or len(rows) < 2:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")

        raw_headers = [_header(c) for c in rows[0]]
        code_idx = -1
        loc_idx = -1
        lot_idx = -1
        expiry_idx = -1
        qty_idx = -1
        note_idx = -1

        for idx, h in enumerate(raw_headers):
            if any(k in h for k in ["mã sp xhđ", "mã sp xuất", "mã xuất hóa đơn", "mã sp", "mã hàng", "sku", "invoice_product_code", "code"]):
                if code_idx == -1:
                    code_idx = idx
            elif any(k in h for k in ["vị trí", "location", "kệ", "bin"]):
                loc_idx = idx
            elif any(k in h for k in ["số lô", "lô", "lot"]):
                lot_idx = idx
            elif any(k in h for k in ["hạn sử dụng", "hsd", "expiry", "exp"]):
                expiry_idx = idx
            elif any(k in h for k in ["số lượng", "tồn đầu", "sl", "quantity", "qty"]):
                qty_idx = idx
            elif any(k in h for k in ["ghi chú", "note"]):
                note_idx = idx

        if code_idx == -1:
            code_idx = 1 if len(raw_headers) > 1 else 0
        if qty_idx == -1:
            raise HTTPException(status_code=400, detail="File Excel thiếu cột 'Số lượng tồn đầu' (hoặc 'Số lượng').")

        all_ips = {
            ip.code.strip().upper(): ip
            for ip in db.scalars(select(InvoiceProduct)).all()
            if ip.code
        }
        all_products = db.scalars(select(Product)).all()
        products_by_sku = {p.sku.strip().upper(): p for p in all_products if p.sku}
        products_by_npp = {p._npp_code.strip().upper(): p for p in all_products if p._npp_code}

        default_cat = db.scalars(select(ProductCategory).order_by(ProductCategory.id)).first()
        all_units = db.scalars(select(ProductUnit).order_by(ProductUnit.id)).all()
        units_by_name = {u.name.strip().lower(): u for u in all_units if u.name}
        default_unit = all_units[0] if all_units else None

        existing_locations = {
            loc.code.strip().upper(): loc
            for loc in db.scalars(
                select(LocationModel).where(LocationModel.warehouse_id == warehouse_id)
            ).all()
            if loc.code
        }
        default_location = next((loc for loc in existing_locations.values() if loc.is_active), None)
        created_locations: list[str] = []

        def get_or_create_location(loc_code_raw: str) -> LocationModel:
            nonlocal default_location
            clean_loc = loc_code_raw.strip().upper()
            if clean_loc:
                loc = existing_locations.get(clean_loc)
                if loc is None:
                    loc = LocationModel(
                        warehouse_id=warehouse_id,
                        code=clean_loc,
                        name=f"Vị trí {clean_loc}",
                        is_active=True,
                    )
                    db.add(loc)
                    db.flush()
                    existing_locations[clean_loc] = loc
                    created_locations.append(clean_loc)
                elif not loc.is_active:
                    loc.is_active = True
                return loc
            if default_location is None:
                default_location = LocationModel(
                    warehouse_id=warehouse_id,
                    code="KHO-CHINH",
                    name="Vị trí mặc định",
                    is_active=True,
                )
                db.add(default_location)
                db.flush()
                existing_locations["KHO-CHINH"] = default_location
                created_locations.append("KHO-CHINH")
            return default_location

        now = datetime.utcnow()
        batch_ref = f"OPEN-{now:%y%m%d%H%M%S}"
        imported_rows = 0
        total_quantity = 0
        errors: list[str] = []
        cleared_products: set[int] = set()

        for row_num, row in enumerate(rows[1:], start=2):
            if not row or all(v is None or str(v).strip() == "" for v in row):
                continue
            code_val = str(row[code_idx] or "").strip().upper() if code_idx < len(row) and row[code_idx] is not None else ""
            if not code_val or "MÃ SP" in code_val:
                continue

            raw_qty = row[qty_idx] if qty_idx < len(row) else None
            try:
                qty = int(float(str(raw_qty).replace(",", "").strip())) if raw_qty not in (None, "") else 0
            except (TypeError, ValueError):
                errors.append(f"Dòng {row_num} ({code_val}): Số lượng không hợp lệ ({raw_qty}).")
                continue
            if qty <= 0:
                continue

            ip_obj = all_ips.get(code_val)
            prod: Product | None = None
            if ip_obj is not None:
                prod = _ensure_canonical_product_for_invoice_product(
                    db, ip_obj, default_cat, units_by_name, default_unit
                )
            else:
                prod = products_by_sku.get(code_val) or products_by_npp.get(code_val)

            if prod is None:
                errors.append(f"Dòng {row_num}: Không tìm thấy Mã SP XHĐ '{code_val}' trong danh mục.")
                continue

            target_pid = canonical_product_id(db, prod.id) if db.scalar(
                select(ProductGroupItem.id).where(ProductGroupItem.product_id == prod.id).limit(1)
            ) else prod.id

            loc_raw = str(row[loc_idx] or "").strip() if loc_idx != -1 and loc_idx < len(row) and row[loc_idx] is not None else ""
            location = get_or_create_location(loc_raw)

            lot_number = (
                str(row[lot_idx] or "").strip()
                if lot_idx != -1 and lot_idx < len(row) and row[lot_idx] is not None
                else ""
            ) or "OPENING"

            expiry_dt: datetime | None = None
            if expiry_idx != -1 and expiry_idx < len(row) and row[expiry_idx] not in (None, ""):
                try:
                    expiry_dt = _parse_expiry(row[expiry_idx], lot_number)
                except ValueError as exc:
                    errors.append(f"Dòng {row_num} ({code_val}): {exc}")
                    continue

            note_val = (
                str(row[note_idx] or "").strip()
                if note_idx != -1 and note_idx < len(row) and row[note_idx] is not None
                else ""
            ) or "Khởi tạo tồn kho đầu kỳ từ Excel"

            if clean_mode == "REPLACE" and target_pid not in cleared_products:
                old_lots = db.scalars(
                    select(LotModel).where(
                        LotModel.warehouse_id == warehouse_id,
                        LotModel.product_id == target_pid,
                        LotModel.quantity_on_hand > 0,
                    )
                ).all()
                for old_lot in old_lots:
                    if old_lot.quantity_on_hand > 0:
                        db.add(TransactionModel(
                            code=f"RST-{now:%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}",
                            type="ADJUST",
                            warehouse_id=warehouse_id,
                            product_id=target_pid,
                            quantity=-old_lot.quantity_on_hand,
                            ref_type="OPENING_REPLACE",
                            ref_code=batch_ref,
                            note="Xóa tồn cũ để nạp lại tồn đầu kỳ",
                            created_by=actor,
                            created_at=now,
                            lot_id=old_lot.id,
                            location_id=old_lot.location_id,
                            expiry_date=old_lot.expiry_date,
                        ))
                        old_lot.quantity_on_hand = 0
                        old_lot.locked_quantity = 0
                cleared_products.add(target_pid)

            lot = db.scalar(
                select(LotModel).where(
                    LotModel.warehouse_id == warehouse_id,
                    LotModel.product_id == target_pid,
                    LotModel.location_id == location.id,
                    LotModel.lot_number == lot_number,
                    LotModel.expiry_date == expiry_dt if expiry_dt is not None else LotModel.expiry_date.is_(None),
                )
            )
            if lot is None:
                lot = LotModel(
                    warehouse_id=warehouse_id,
                    product_id=target_pid,
                    location_id=location.id,
                    lot_number=lot_number,
                    expiry_date=expiry_dt,
                    quantity_on_hand=0,
                )
                db.add(lot)
                db.flush()

            lot.quantity_on_hand += qty
            db.add(TransactionModel(
                code=f"OPN-{now:%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}",
                type="OPENING",
                warehouse_id=warehouse_id,
                product_id=target_pid,
                quantity=qty,
                ref_type="OPENING",
                ref_code=batch_ref,
                note=note_val,
                created_by=actor,
                created_at=now,
                lot_id=lot.id,
                location_id=location.id,
                expiry_date=expiry_dt,
            ))
            imported_rows += 1
            total_quantity += qty

        if imported_rows == 0 and errors:
            db.rollback()
            raise HTTPException(status_code=400, detail="; ".join(errors[:5]))

        db.commit()
        return {
            "success": True,
            "batch_code": batch_ref,
            "imported_rows": imported_rows,
            "total_quantity": total_quantity,
            "created_locations": created_locations,
            "errors": errors[:20],
            "message": f"Đã khởi tạo tồn đầu kỳ thành công: {imported_rows} dòng (tổng {total_quantity:,} đvt).",
        }
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Không thể đọc file Excel: {exc}") from exc


@router.post("/stock/bulk-delete")
def bulk_delete_stock(
    payload: BulkDeleteStockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Xóa tồn kho hàng loạt cho các sản phẩm (hoặc Mã SP XHĐ) được chọn."""
    target_product_ids: set[int] = {pid for pid in payload.product_ids if pid and pid > 0}

    if payload.invoice_product_ids:
        ip_ids = [ip_id for ip_id in payload.invoice_product_ids if ip_id and ip_id > 0]
        if ip_ids:
            for pid in db.scalars(select(Product.id).where(Product.invoice_product_id.in_(ip_ids))).all():
                target_product_ids.add(pid)
            for pid in db.scalars(select(ProductCompany.product_id).where(ProductCompany.invoice_product_id.in_(ip_ids))).all():
                target_product_ids.add(pid)

    if not target_product_ids:
        return {
            "success": True,
            "cleared_products": 0,
            "cleared_lots": 0,
            "cleared_quantity": 0,
            "skipped": [],
            "message": "Không có tồn kho nào cần xóa cho các sản phẩm đã chọn.",
        }

    lot_stmt = select(LotModel).where(
        LotModel.product_id.in_(target_product_ids),
        LotModel.quantity_on_hand > 0,
    )
    if payload.warehouse_id is not None:
        lot_stmt = lot_stmt.where(LotModel.warehouse_id == payload.warehouse_id)
    lots = db.scalars(lot_stmt).all()

    if not lots:
        return {
            "success": True,
            "cleared_products": 0,
            "cleared_lots": 0,
            "cleared_quantity": 0,
            "skipped": [],
            "message": "Các sản phẩm đã chọn hiện có tồn kho bằng 0.",
        }

    lot_ids = [lot.id for lot in lots]
    reserved_lot_ids = set(
        db.scalars(
            select(DeliveryAllocation.lot_id)
            .join(DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id)
            .where(
                DeliveryAllocation.lot_id.in_(lot_ids),
                DeliveryRequest.status.in_(("DRAFT", "SUBMITTED", "RECEIVED")),
            )
        ).all()
    )

    actor = getattr(current_user, "username", None) or "system"
    now = datetime.utcnow()
    ref_code = f"DEL-{now:%y%m%d%H%M%S}"
    note_text = (payload.note or "").strip() or "Xóa tồn kho hàng loạt"

    cleared_products: set[int] = set()
    cleared_lots = 0
    cleared_quantity = 0
    skipped: list[str] = []

    for lot in lots:
        if lot.id in reserved_lot_ids:
            skipped.append(f"Lô #{lot.id} ({lot.lot_number or 'N/A'}) đang được giữ chỗ bởi phiếu xuất chưa hoàn tất.")
            continue
        qty = int(lot.quantity_on_hand or 0)
        if qty <= 0:
            continue
        db.add(TransactionModel(
            code=f"CLR-{now:%y%m%d%H%M%S}-{uuid4().hex[:6].upper()}",
            type="ADJUST",
            warehouse_id=lot.warehouse_id,
            product_id=lot.product_id,
            quantity=-qty,
            ref_type="BULK_DELETE",
            ref_code=ref_code,
            note=note_text,
            created_by=actor,
            created_at=now,
            lot_id=lot.id,
            location_id=lot.location_id,
            expiry_date=lot.expiry_date,
        ))
        lot.quantity_on_hand = 0
        lot.locked_quantity = 0
        cleared_products.add(lot.product_id)
        cleared_lots += 1
        cleared_quantity += qty

    db.commit()
    return {
        "success": True,
        "cleared_products": len(cleared_products),
        "cleared_lots": cleared_lots,
        "cleared_quantity": cleared_quantity,
        "skipped": skipped,
        "message": f"Đã xóa tồn kho của {len(cleared_products)} sản phẩm ({cleared_lots} lô, tổng {cleared_quantity:,} đvt)."
        + (f" Bỏ qua {len(skipped)} lô đang giữ chỗ." if skipped else ""),
    }


@router.get("/warehouses/", response_model=List[Warehouse])
def list_warehouses(db: Session = Depends(get_db)):
    return db.query(WarehouseModel).order_by(WarehouseModel.id).all()


@router.get("/transactions/", response_model=List[InventoryTransaction])
def list_transactions(skip: int = 0, limit: int = 100, product_id: int | None = None, txn_type: str | None = None, db: Session = Depends(get_db)):
    return crud.list_transactions(db, skip=skip, limit=limit, product_id=product_id, txn_type=txn_type)


@router.get("/locations/", response_model=List[WarehouseLocation])
def list_locations(warehouse_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(LocationModel).order_by(LocationModel.code)
    if warehouse_id is not None:
        query = query.filter(LocationModel.warehouse_id == warehouse_id)
    return query.all()


@router.get("/lots/", response_model=List[InventoryLot])
def list_lots(warehouse_id: int | None = None, product_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(LotModel).filter(LotModel.quantity_on_hand > 0).order_by(LotModel.expiry_date, LotModel.id)
    if warehouse_id is not None:
        query = query.filter(LotModel.warehouse_id == warehouse_id)
    if product_id is not None:
        query = query.filter(LotModel.product_id == product_id)
    return query.all()


@router.get("/lot-details/", response_model=List[InventoryLotDetail])
def list_lot_details(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Return stock by lot/location with active delivery reservations."""
    query = db.query(LotModel).filter(LotModel.quantity_on_hand > 0)
    if warehouse_id is not None:
        query = query.filter(LotModel.warehouse_id == warehouse_id)
    if product_id is not None:
        query = query.filter(LotModel.product_id == product_id)
    lots = query.order_by(LotModel.expiry_date, LotModel.id).all()
    if not lots:
        return []

    lot_ids = [lot.id for lot in lots]
    reservation_rows = db.query(
        DeliveryAllocation.lot_id,
        func.coalesce(func.sum(DeliveryAllocation.allocated_quantity), 0),
    ).join(
        DeliveryRequestItem, DeliveryRequestItem.id == DeliveryAllocation.item_id,
    ).join(
        DeliveryRequest, DeliveryRequest.id == DeliveryRequestItem.request_id,
    ).filter(
        DeliveryAllocation.lot_id.in_(lot_ids),
        DeliveryRequest.status.in_(("DRAFT", "SUBMITTED", "RECEIVED")),
    ).group_by(DeliveryAllocation.lot_id).all()
    reserved_by_lot = {lot_id: int(quantity) for lot_id, quantity in reservation_rows}
    products = {
        product.id: product
        for product in db.query(Product).filter(Product.id.in_({lot.product_id for lot in lots})).all()
    }
    units = {
        unit.id: unit
        for unit in db.query(ProductUnit).filter(
            ProductUnit.id.in_({product.unit_id for product in products.values()})
        ).all()
    } if products else {}
    location_ids = {lot.location_id for lot in lots if lot.location_id is not None}
    locations = {
        location.id: location
        for location in db.query(LocationModel).filter(LocationModel.id.in_(location_ids)).all()
    } if location_ids else {}

    directory = NppDirectory(db)
    ip_by_product = crud.resolve_invoice_products_map(db, set(products.keys()))
    result_lots: list[InventoryLotDetail] = []
    for lot in lots:
        ip = ip_by_product.get(lot.product_id)
        if ip is not None:
            p_code = ip.code
            p_name = ip.name
            p_unit = ip.unit_name or (
                units[products[lot.product_id].unit_id].name
                if lot.product_id in products and products[lot.product_id].unit_id in units
                else ""
            )
        else:
            p_code = (
                directory.label(lot.product_id, products[lot.product_id].sku, products[lot.product_id].name)[0]
                if lot.product_id in products else str(lot.product_id)
            )
            p_name = (
                directory.label(lot.product_id, products[lot.product_id].sku, products[lot.product_id].name)[1]
                if lot.product_id in products else "Sản phẩm"
            )
            p_unit = (
                units[products[lot.product_id].unit_id].name
                if lot.product_id in products and products[lot.product_id].unit_id in units
                else ""
            )
        result_lots.append(
            InventoryLotDetail(
                id=lot.id,
                warehouse_id=lot.warehouse_id,
                location_id=lot.location_id,
                location_code=locations[lot.location_id].code if lot.location_id in locations else None,
                location_name=locations[lot.location_id].name if lot.location_id in locations else None,
                product_id=lot.product_id,
                product_code=p_code,
                product_name=p_name,
                invoice_product_id=ip.id if ip else None,
                invoice_product_code=ip.code if ip else None,
                invoice_product_name=ip.name if ip else None,
                unit=p_unit,
                lot_number=lot.lot_number,
                expiry_date=lot.expiry_date,
                quantity_on_hand=lot.quantity_on_hand,
                locked_quantity=lot.locked_quantity,
                reserved_quantity=reserved_by_lot.get(lot.id, 0),
                available_quantity=max(
                    0, lot.quantity_on_hand - lot.locked_quantity - reserved_by_lot.get(lot.id, 0)
                ),
                unit_cost=lot.unit_cost,
            )
        )
    return result_lots


@router.get("/stock-levels/", response_model=List[StockLevel])
def stock_levels(
    warehouse_id: int | None = None,
    category_id: int | None = None,
    db: Session = Depends(get_db),
):
    return crud.get_stock_levels(db, warehouse_id=warehouse_id, category_id=category_id)


@router.post("/adjust/", response_model=InventoryTransaction, status_code=201)
def adjust_stock(
    payload: StockAdjust,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return crud.adjust_stock(
            db, payload, created_by=getattr(current_user, "username", None) or "system"
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/transfers/", response_model=InventoryTransferResponse, status_code=201)
def create_location_transfer(
    payload: InventoryTransferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return crud.create_location_transfer(
            db, payload,
            created_by=getattr(current_user, "username", None) or payload.created_by or "system",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/transfers/{transfer_id}/confirm", response_model=InventoryTransferResponse)
def confirm_location_transfer(transfer_id: int, db: Session = Depends(get_db)):
    try:
        return crud.confirm_location_transfer(db, transfer_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/transfers/", response_model=List[InventoryTransferResponse])
def list_location_transfers(db: Session = Depends(get_db)):
    return db.query(TransferModel).order_by(TransferModel.created_at.desc()).all()