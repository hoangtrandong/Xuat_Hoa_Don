from app.core.database import SessionLocal
from app.crud.delivery_request import list_
from app.schemas.delivery_request import DeliveryRequest, DeliveryRequestItem
import time

try:
    db = SessionLocal()
    rows = list_(db, "SUBMITTED")
    print("rows:", len(rows))
    t0 = time.time()
    r6 = [r for r in rows if r.id == 6][0]
    print("items:", len(r6.items))
    t1 = time.time()
    out_items = [DeliveryRequestItem.model_validate(i) for i in r6.items]
    t2 = time.time()
    print(f"validate items: {(t2-t1)*1000:.0f}ms")
    first = out_items[0]
    t3 = time.time()
    d = first.model_dump(mode="json")
    t4 = time.time()
    print(f"dump first item: {(t4-t3)*1000:.0f}ms, allocations in dump: {len(d['allocations'])}")
    t5 = time.time()
    d_all = [i.model_dump(mode="json") for i in out_items]
    t6 = time.time()
    print(f"dump all items: {(t6-t5)*1000:.0f}ms")
    print("allocations count per item:", [len(i.allocations) for i in out_items[:10]])
    db.close()
except Exception:
    import traceback
    traceback.print_exc()
from app.core.database import SessionLocal
from app.crud.delivery_request import list_
from app.schemas.delivery_request import DeliveryRequest

try:
    db = SessionLocal()
    rows = list_(db, "SUBMITTED")
    print("rows:", len(rows))
    import time
    t0 = time.time()
    out = [DeliveryRequest.model_validate(r) for r in rows]
    t1 = time.time()
    print(f"serialize: {(t1-t0)*1000:.0f}ms")
    import json
    t2 = time.time()
    payload = json.dumps([o.model_dump(mode="json") for o in out])
    t3 = time.time()
    print(f"json dump: {(t3-t2)*1000:.0f}ms, length: {len(payload)}")
    db.close()
except Exception:
    import traceback
    traceback.print_exc()
from app.core.database import SessionLocal
from app.crud.delivery_request import list_

try:
    db = SessionLocal()
    rows = list_(db, "SUBMITTED")
    print("SUBMITTED rows:", len(rows))
    for r in rows:
        print(" ", r.id, r.code, r.status, "items:", len(r.items))
    db.close()
except Exception:
    import traceback
    traceback.print_exc()
from app.main import app
print("import OK, routes:", len(app.routes))