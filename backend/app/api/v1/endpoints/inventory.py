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
from app.crud import inventory_transaction as crud
from uuid import uuid4

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _header(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _parse_expiry(lot_number: str) -> datetime:
    match = re.match(r"^(\d{6})(?:-|$)", lot_number.strip())
    if not match:
        raise ValueError(f"Lot '{lot_number}' không có ngày HSD dạng yymmdd.")
    try:
        return datetime.strptime(match.group(1), "%y%m%d")
    except ValueError as exc:
        raise ValueError(f"Lot '{lot_number}' có ngày HSD không hợp lệ.") from exc


def _parse_sku(item: Any) -> str:
    return re.split(r"\s+-\s+", str(item or "").strip(), maxsplit=1)[0].strip().upper()


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
        if len(rows) < 13:
            raise ValueError("File Excel không có dữ liệu từ dòng 13.")
        headers = [_header(value) for value in rows[11]]
        required = {"item", "lot", "s.lượng"}
        if not required.issubset(headers):
            raise ValueError("File phải có các cột Item, Lot và S.Lượng ở dòng 12.")
        indexes = {name: headers.index(name) for name in required}
        location_index = headers.index("vị trí") if "vị trí" in headers else None
        unit_index = headers.index("đvt") if "đvt" in headers else None
        carton_index = headers.index("thùng") if "thùng" in headers else None
        loose_index = headers.index("hộp") if "hộp" in headers else None
        delivery_references = str(rows[6][1] or "").strip() if len(rows) > 6 and len(rows[6]) > 1 else None
        po_values = str(rows[7][1] or "").strip() if len(rows) > 7 and len(rows[7]) > 1 else None
        delivery_references = delivery_references or None
        po_references = ", ".join(dict.fromkeys(
            part.strip() for part in (po_values or "").split(",") if part.strip()
        )) or None
        document_date = _parse_import_datetime(rows[5][7] if len(rows) > 5 and len(rows[5]) > 7 else None)
        products = {product.sku.upper(): product for product in db.scalars(select(Product)).all()}
        grouped: dict[tuple[str, str], dict[str, Any]] = {}
        for row_number, values in enumerate(rows[12:], 13):
            if not any(value is not None and str(value).strip() for value in values):
                continue
            sku = _parse_sku(values[indexes["item"]] if indexes["item"] < len(values) else None)
            lot_number = str(values[indexes["lot"]] if indexes["lot"] < len(values) else "").strip()
            if not sku or not lot_number:
                continue
            product = products.get(sku)
            if not product:
                raise ValueError(f"Dòng {row_number}: không tìm thấy mã sản phẩm {sku}.")
            try:
                quantity = int(values[indexes["s.lượng"]])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Dòng {row_number}: S.Lượng phải là số hộp.") from exc
            if quantity <= 0:
                raise ValueError(f"Dòng {row_number}: S.Lượng phải lớn hơn 0.")
            expiry_date = _parse_expiry(lot_number)
            key = (sku, lot_number)
            item = grouped.setdefault(key, {
                "product_id": product.id, "sku": product.sku, "product_name": product.name,
                "unit": values[unit_index] if unit_index is not None and unit_index < len(values) else None,
                "lot_number": lot_number, "expiry_date": expiry_date,
                "source_location_code": values[location_index] if location_index is not None and location_index < len(values) else None,
                "cartons": 0, "loose_boxes": 0, "quantity": 0, "allocations": [],
                "delivery_references": delivery_references, "po_references": po_references,
                "document_date": document_date,
            })
            item["quantity"] += quantity
            item["cartons"] += int(values[carton_index] or 0) if carton_index is not None and carton_index < len(values) else 0
            item["loose_boxes"] += int(values[loose_index] or 0) if loose_index is not None and loose_index < len(values) else 0
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
                    expiry_date=item.expiry_date, ref_type="PO", ref_code=payload.ref_code,
                    note=payload.note or (
                        f"Delivery {payload.delivery_references or '-'} - "
                        f"{item.sku} - {item.lot_number}"
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
    return crud.list_(db, skip=skip, limit=limit, product_id=product_id, txn_type=txn_type)


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
    return crud.stock_levels(db, warehouse_id=warehouse_id)


@router.post("/adjust/", response_model=InventoryTransaction, status_code=201)
def adjust_stock(payload: StockAdjust, db: Session = Depends(get_db)):
    try:
        return crud.adjust(db, payload)
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