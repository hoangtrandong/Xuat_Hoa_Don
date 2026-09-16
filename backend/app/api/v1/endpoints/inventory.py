from datetime import datetime, date, time, timedelta
from io import BytesIO
import re
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Any, List
from zipfile import BadZipFile
from app.core.database import get_db
from app.schemas.inventory import (
    InventoryImportConfirm, InventoryImportItem, InventoryTransaction, StockLevel,
    StockAdjust, Warehouse, WarehouseLocation, InventoryLot,
    InventoryTransferCreate, InventoryTransferResponse,
)
from app.models.inventory import (
    InventoryLot as LotModel, InventoryTransaction as TransactionModel,
    Warehouse as WarehouseModel, WarehouseLocation as LocationModel,
    InventoryTransfer as TransferModel,
)
from app.models.product import Product
from app.crud import inventory as crud
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
        unit_index = headers.index("đvt") if "đvt" in headers else None
        price_index = headers.index("đơn giá") if "đơn giá" in headers else None
        amount_index = headers.index("thành tiền") if "thành tiền" in headers else None
        note_index = headers.index("ghi chú") if "ghi chú" in headers else None
        invoice_number = str(rows[7][1] or "").strip() if len(rows) > 7 and len(rows[7]) > 1 else None
        invoice_number = invoice_number or None
        document_date = _parse_import_datetime(rows[7][7] if len(rows) > 7 and len(rows[7]) > 7 else None)
        products = {product.sku.upper(): product for product in db.scalars(select(Product)).all()}
        grouped: dict[tuple[str, str], dict[str, Any]] = {}
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
            try:
                quantity = int(values[indexes["số lượng"]])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Dòng {row_number}: S.Lượng phải là số hộp.") from exc
            if quantity <= 0:
                raise ValueError(f"Dòng {row_number}: S.Lượng phải lớn hơn 0.")
            expiry_date = _parse_expiry(values[indexes["hạn sử dụng"]], lot_number)
            key = (sku, lot_number, expiry_date)
            item = grouped.setdefault(key, {
                "product_id": product.id, "sku": product.sku, "product_name": product.name,
                "unit": values[unit_index] if unit_index is not None and unit_index < len(values) else None,
                "lot_number": lot_number, "expiry_date": expiry_date,
                "cartons": 0, "loose_boxes": 0, "quantity": 0, "allocations": [],
                "delivery_references": None, "po_references": None,
                "document_date": document_date,
                "invoice_number": invoice_number,
                "unit_price": float(values[price_index] or 0) if price_index is not None and price_index < len(values) else None,
                "amount": float(values[amount_index] or 0) if amount_index is not None and amount_index < len(values) else None,
                "note": str(values[note_index]).strip() if note_index is not None and note_index < len(values) and values[note_index] is not None else None,
            })
            item["quantity"] += quantity
        return [InventoryImportItem(**item) for item in grouped.values()]
    except HTTPException:
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/confirm", response_model=List[InventoryTransaction], status_code=201)
def confirm_inventory_import(payload: InventoryImportConfirm, db: Session = Depends(get_db)):
    if not db.get(WarehouseModel, payload.warehouse_id):
        raise HTTPException(status_code=400, detail="Không tìm thấy kho.")
    transaction_time = datetime.utcnow()
    created: list[TransactionModel] = []
    try:
        for item in payload.items:
            if not db.get(Product, item.product_id):
                raise ValueError(f"Không tìm thấy sản phẩm {item.sku}.")
            total_allocated = sum(allocation.quantity for allocation in item.allocations)
            if total_allocated != item.quantity:
                raise ValueError(f"{item.sku} / {item.lot_number}: phân bổ {total_allocated}/{item.quantity} hộp.")
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
                    created_by=payload.created_by,
                    created_at=transaction_time,
                    document_date=payload.document_date,
                )
                db.add(transaction)
                created.append(transaction)
        db.commit()
        for transaction in created:
            db.refresh(transaction)
        return created
    except (ValueError, TypeError) as exc:
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


@router.get("/stock-levels/", response_model=List[StockLevel])
def stock_levels(warehouse_id: int | None = None, db: Session = Depends(get_db)):
    return crud.get_stock_levels(db, warehouse_id=warehouse_id)


@router.post("/adjust/", response_model=InventoryTransaction, status_code=201)
def adjust_stock(payload: StockAdjust, db: Session = Depends(get_db)):
    try:
        return crud.adjust_stock(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/transfers/", response_model=InventoryTransferResponse, status_code=201)
def create_location_transfer(payload: InventoryTransferCreate, db: Session = Depends(get_db)):
    try:
        return crud.create_location_transfer(db, payload)
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