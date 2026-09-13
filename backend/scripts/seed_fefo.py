"""Seed stock FEFO tu BC_THGH_NhomXe (bulk, 1 commit)."""
import re, sys
from datetime import datetime, timedelta
from sqlalchemy import select, func, delete
from app.core.database import SessionLocal
from app.models import Product, Warehouse, WarehouseLocation
from app.models import InventoryLot, InventoryTransaction
from uuid import uuid4

def parse_cb(s):
    if s is None: return (0, 0)
    import re as _re
    m = _re.match(r"\s*(\d+)\s*/\s*(\d+)\s*", str(s))
    if m: return (int(m.group(1)), int(m.group(2)))
    return (0, 0)

def load_items(fp):
    import openpyxl
    wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
    ws = wb["PhieuGiaoHang"]
    out = []
    for r in list(ws.iter_rows(values_only=True))[11:]:
        sku, total = r[1], r[3]
        if sku and str(sku).strip() and total:
            s = str(sku).strip().upper()
            if s == "NGUOI LAP": continue
            c, b = parse_cb(total)
            if c or b: out.append((s, c, b))
    wb.close()
    return out

def gen_code():
    ts = datetime.utcnow()
    return f"ITT-{ts:%y%m%d}-{ts:%H%M%S}-{uuid4().hex[:6].upper()}"

def main(fp, cover=2):
    items = load_items(fp)
    print(f"SKU doc duoc: {len(items)}", flush=True)
    skus = [s for s, _, _ in items]
    with SessionLocal() as db:
        wh = db.execute(select(Warehouse).order_by(Warehouse.id)).scalars().first()
        print(f"Kho {wh.code}", flush=True)
        locs = {}
        for code in ["A-01", "A-02", "A-03"]:
            l = db.execute(select(WarehouseLocation).where(
                WarehouseLocation.warehouse_id == wh.id,
                WarehouseLocation.code == code)).scalar_one_or_none()
            if not l:
                l = WarehouseLocation(warehouse_id=wh.id, code=code, name=f"Ke {code}")
                db.add(l); db.flush()
            locs[code] = l
        prods = db.execute(select(Product).where(func.upper(Product.sku).in_(skus))).scalars().all()
        pmap = {p.sku.upper(): p for p in prods}
        print(f"Match DB: {len(pmap)}/{len(skus)}", flush=True)
        miss = [s for s in skus if s not in pmap]
        if miss: print(f"Thieu: {miss[:15]}", flush=True)
        pids = [p.id for p in pmap.values()]
        # xoa txn + lot cu (bulk delete, khong load object)
        db.execute(delete(InventoryTransaction).where(
            InventoryTransaction.warehouse_id == wh.id,
            InventoryTransaction.product_id.in_(pids),
            InventoryTransaction.ref_code.like("SEED-FEFO%")))
        db.execute(delete(InventoryLot).where(
            InventoryLot.warehouse_id == wh.id,
            InventoryLot.product_id.in_(pids),
            InventoryLot.lot_number.like("FEFO-%")))
        db.flush()
        now = datetime.utcnow()
        exps = [now + timedelta(days=30), now + timedelta(days=180), now + timedelta(days=365)]
        cyc = ["A-01", "A-02", "A-03"]
        lots, txns = [], []
        for sku, c, b in items:
            p = pmap.get(sku)
            if not p: continue
            bpc = p.boxes_per_carton or 1
            target = max((c * bpc + b) * cover, bpc)
            q0, q1 = int(target * 0.5), int(target * 0.3)
            q2 = target - q0 - q1
            for i, q in enumerate([q0, q1, q2]):
                if q <= 0: continue
                lots.append({"wh": wh.id, "pid": p.id, "loc": locs[cyc[i]].id,
                    "lot": f"FEFO-{sku}-{now:%y%m%d}-{i+1}", "exp": exps[i],
                    "qty": q, "cost": p.cost_price, "sku": sku, "i": i})
        print(f"Chuan bi insert {len(lots)} lots", flush=True)
        lot_objs = [InventoryLot(warehouse_id=d["wh"], product_id=d["pid"],
            location_id=d["loc"], lot_number=d["lot"], expiry_date=d["exp"],
            quantity_on_hand=d["qty"], unit_cost=d["cost"]) for d in lots]
        db.add_all(lot_objs); db.flush()
        print("Flush lots xong", flush=True)
        for o, d in zip(lot_objs, lots):
            txns.append(InventoryTransaction(code=gen_code(), type="OPENING",
                warehouse_id=d["wh"], product_id=d["pid"], quantity=d["qty"],
                unit_cost=d["cost"], ref_type="OPENING",
                ref_code=f"SEED-FEFO-{now:%y%m%d}",
                note=f"Seed FEFO {d['sku']} HSD {d['exp']:%d/%m/%Y} {cyc[d['i']]}",
                created_by="seed-fefo", lot_id=o.id,
                location_id=o.location_id, expiry_date=o.expiry_date))
        db.add_all(txns)
        db.commit()
        print(f"XONG: {len(lot_objs)} lots + {len(txns)} OPENING", flush=True)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "D:/DMS_Project/bcthgh.xlsx")
