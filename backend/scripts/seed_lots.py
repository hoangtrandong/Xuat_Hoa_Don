"""Seed warehouse locations and inventory lots for existing stock.

Chay: python -m scripts.seed_lots
Yeu cau: DATABASE_URL hop le va bang da tao (alembic upgrade head).
"""
from datetime import datetime, timedelta
from sqlalchemy import select, func

from app.core.database import SessionLocal
from app.models import (
    Warehouse, WarehouseLocation, InventoryLot,
    InventoryTransaction, Product
)


def seed_lots():
    with SessionLocal() as db:
        # 1. Tao vi tri kho (warehouse_locations)
        warehouses = db.execute(select(Warehouse)).scalars().all()
        locations = []
        location_codes = ["A1", "A2", "B1", "B2"]
        
        for wh in warehouses:
            for code in location_codes:
                # Kiem tra neu da co thi bo qua
                existing = db.execute(
                    select(WarehouseLocation)
                    .where(WarehouseLocation.warehouse_id == wh.id)
                    .where(WarehouseLocation.code == code)
                ).scalar_one_or_none()
                
                if not existing:
                    loc = WarehouseLocation(
                        warehouse_id=wh.id,
                        code=code,
                        name=f"Khu {code}"
                    )
                    db.add(loc)
                    locations.append(loc)
        
        db.flush()
        print(f"Da tao {len(locations)} vi tri kho")

        # 2. Tinh ton kho hien co theo san pham va kho
        stock_result = db.execute(
            select(
                InventoryTransaction.product_id,
                InventoryTransaction.warehouse_id,
                func.sum(InventoryTransaction.quantity).label("total_qty")
            )
            .group_by(InventoryTransaction.product_id, InventoryTransaction.warehouse_id)
        ).all()

        # 3. Tao lo hang (inventory_lots) cho san pham co ton
        expiry_date = datetime.utcnow() + timedelta(days=365)  # Han su dung 1 nam
        lot_count = 0
        
        for row in stock_result:
            product_id, warehouse_id, total_qty = row
            if total_qty and int(total_qty) > 0:
                # Kiem tra neu san pham nay da co lo chua
                existing_lot = db.execute(
                    select(InventoryLot)
                    .where(InventoryLot.warehouse_id == warehouse_id)
                    .where(InventoryLot.product_id == product_id)
                ).scalar_one_or_none()
                
                if not existing_lot:
                    # Tim vi tri trong kho
                    location = db.execute(
                        select(WarehouseLocation)
                        .where(WarehouseLocation.warehouse_id == warehouse_id)
                        .limit(1)
                    ).scalar_one_or_none()
                    
                    lot = InventoryLot(
                        warehouse_id=warehouse_id,
                        product_id=product_id,
                        location_id=location.id if location else None,
                        lot_number=f"LOT-{datetime.utcnow():%Y%m%d}-{product_id:04d}",
                        expiry_date=expiry_date,
                        quantity_on_hand=int(total_qty),
                        unit_cost=None,
                    )
                    db.add(lot)
                    lot_count += 1

        db.commit()
        print(f"Da tao {lot_count} lo hang")
        print("Seed lots thanh cong!")


if __name__ == "__main__":
    seed_lots()
