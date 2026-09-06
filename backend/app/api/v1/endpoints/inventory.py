from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.inventory import InventoryTransaction, StockLevel, StockAdjust, Warehouse
from app.models.inventory import Warehouse as WarehouseModel
from app.crud import inventory_transaction as crud

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("/warehouses/", response_model=List[Warehouse])
def list_warehouses(db: Session = Depends(get_db)):
    return db.query(WarehouseModel).order_by(WarehouseModel.id).all()


@router.get("/transactions/", response_model=List[InventoryTransaction])
def list_transactions(skip: int = 0, limit: int = 100, product_id: int | None = None, txn_type: str | None = None, db: Session = Depends(get_db)):
    return crud.list_(db, skip=skip, limit=limit, product_id=product_id, txn_type=txn_type)


@router.get("/stock-levels/", response_model=List[StockLevel])
def stock_levels(warehouse_id: int | None = None, db: Session = Depends(get_db)):
    return crud.stock_levels(db, warehouse_id=warehouse_id)


@router.post("/adjust/", response_model=InventoryTransaction, status_code=201)
def adjust_stock(payload: StockAdjust, db: Session = Depends(get_db)):
    try:
        return crud.adjust(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc