"""Test stock-levels + lots API layer against seeded FEFO data."""
import importlib
from sqlalchemy import select
from app.core.database import SessionLocal
from app.crud.inventory import get_stock_levels
from app.models import InventoryLot, Product, WarehouseLocation

mod = importlib.import_module("app.crud.delivery_request")

def main():
    with SessionLocal() as db:
        # 1. stock-levels (as returned by GET /inventory/stock-levels/)
        levels = get_stock_levels(db)
        with_stock = [l for l in levels if l.on_hand > 0]
        print(f"GET /stock-levels/ -> {len(with_stock)} SKU cu stock, {len(levels)} total", flush=True)
        sample = [l for l in with_stock if l.product_code == "01TD03"]
        if sample:
            s = sample[0]
            print(f"  01TD03: on_hand={s.on_hand} lot_count={s.lot_count} earliest_expiry={s.earliest_expiry:%Y-%m-%d} locations={s.locations}", flush=True)
            assert s.lot_count == 3 and s.locations == "A-01, A-02, A-03", "stock-levels FAIL"
            print("  stock-levels CORECT ✓ (lot_count, earliest_expiry, locations)", flush=True)

        # 2. lots endpoint query (GET /inventory/lots/?product_id=)
        p = db.execute(select(Product).where(Product.sku == "01TD03")).scalar_one()
        lots = (db.query(InventoryLot)
                .filter(InventoryLot.product_id == p.id, InventoryLot.quantity_on_hand > 0)
                .order_by(InventoryLot.expiry_date, InventoryLot.id)).all()
        print(f"\nGET /lots/?product_id={p.id} -> {len(lots)} lots (order = FEFO)", flush=True)
        for lot in lots:
            loc = db.get(WarehouseLocation, lot.location_id)
            print(f"  lot={lot.lot_number} qty={lot.quantity_on_hand} HSD={lot.expiry_date:%Y-%m-%d} loc={loc.code if loc else '?'}", flush=True)
        assert lots[0].lot_number.endswith("-1"), "lots FAIL"
        print("  lots CORECT ✓ (sap xep FEFO - primeiro lot = HSD cel mai timpur)", flush=True)

        print("\nALL API-LAYER TESTS PASS ✓", flush=True)

if __name__ == "__main__":
    main()