from datetime import datetime, date, time, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl import load_workbook
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
    StockAdjust, Warehouse, WarehouseLocation, InventoryLot, InventoryLotDetail,
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
from app.models.product import Product, ProductUnit
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