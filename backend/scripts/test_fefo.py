"""Verify FEFO seed: check DB state + test FEFO allocation logic."""
import importlib
import sys
from sqlalchemy import select, func
from app.core.database import SessionLocal
from app.models import Product, Warehouse, WarehouseLocation
from app.models import InventoryLot, InventoryTransaction, DeliveryRequest, DeliveryRequestItem

# Load the real module (app.crud.delivery_request is an instance of CRUD in __init__)
mod = importlib.import_module("app.crud.delivery_request")

def main():
    with SessionLocal() as db:
        # 1. DB state
        total = db.execute(select(func.count()).select_from(InventoryLot)).scalar()
        fefo = db.execute(select(func.count()).select_from(InventoryLot)
                          .where(InventoryLot.lot_number.like("FEFO-%"))).scalar()
        locs = db.execute(select(func.count()).select_from(WarehouseLocation)).scalar()
        print(f"== DB STATE ==\nLots total={total} (FEFO={fefo}) | Vị trí={locs}", flush=True)
        wh = db.execute(select(Warehouse).order_by(Warehouse.id)).scalars().first()
        print(f"Kho: {wh.code} id={wh.id}", flush=True)

        # 2. Count distinct SKUs with FEFO lots
        n_skus = db.execute(select(func.count(InventoryLot.product_id.distinct()))
                            .where(InventoryLot.lot_number.like("FEFO-%"))).scalar()
        print(f"SKU cu̧ stock FEFO: {n_skus}", flush=True)

        # 3. Piek 1 SKU sample (01TD03) - show lots ordered by expiry (FEFO)
        p = db.execute(select(Product).where(Product.sku == "01TD03")).scalar_one()
        lots = db.execute(select(InventoryLot).where(
            InventoryLot.product_id == p.id,
            InventoryLot.quantity_on_hand > 0
        ).order_by(InventoryLot.expiry_date.asc(), InventoryLot.id)).scalars().all()
        print(f"\n== FEFO ORDER (SKU {p.sku}) ==", flush=True)
        for i, lot in enumerate(lots):
            loc = db.get(WarehouseLocation, lot.location_id)
            print(f"  #{i+1} lot={lot.lot_number} qty={lot.quantity_on_hand} HSD={lot.expiry_date:%d/%m/%Y} loc={loc.code if loc else '?'}", flush=True)
        first = lots[0]
        assert first.expiry_date == min(l.expiry_date for l in lots), "FEFO order FAIL"
        print(f"  CORECT: lot cu HSD cel mai timpur este prima -> {first.lot_number}", flush=True)

        # 4. Test _allocate directly (in-memory, not persisted) on a DRAFT request
        # Create a real DRAFT delivery request then submit in a rollback session
        print(f"\n== TEST ALÓCARE FEFO (submit delivery request) ==", flush=True)
        qty = min(100, first.quantity_on_hand)
        req = DeliveryRequest(code=f"TEST-FEFO-{sys.maxsize}", warehouse_id=wh.id, status="DRAFT", created_by="test-fefo")
        item = DeliveryRequestItem(product_id=p.id, quantity=qty)
        req.items.append(item)
        db.add(req); db.flush()
        try:
            mod._allocate(db, req, item)
            print(f"  Cerut quantity: {qty}", flush=True)
            for a in item.allocations:
                loc = db.get(WarehouseLocation, a.location_id)
                print(f"  Alocated -> qty={a.allocated_quantity} strategy={a.allocation_strategy} lot={a.lot_id} HSD={a.expiry_date:%d/%m/%Y} loc={loc.code if loc else '?'}", flush=True)
            assert item.allocations and item.allocations[0].lot_id == first.id, "FEFO alloc FAIL: nu a alocat lotul cel mai timpur"
            print(f"  CORECT: alocarea a luat lotul cu HSD cel mai timpur (lot {first.lot_number})", flush=True)
            assert sum(a.allocated_quantity for a in item.allocations) == qty, "alloc qty mismatch"
            print("  TEST FEFO PASS ✓", flush=True)
        finally:
            db.rollback()  # nu salvam test data
            print("(test rollback - nu s-a salvat date in DB)", flush=True)

if __name__ == "__main__":
    main()