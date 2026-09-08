from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.inventory import InventoryTransaction, StockLevel, StockAdjust, Warehouse, WarehouseLocation, InventoryLot
from app.models.inventory import Warehouse as WarehouseModel, WarehouseLocation as LocationModel, InventoryLot as LotModel
from app.crud import inventory_transaction as crud

router = APIRouter(prefix="/inventory", tags=["inventory"])


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