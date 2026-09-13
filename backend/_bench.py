import os
os.environ["DEBUG"] = "false"

import time as _time

from app.core.database import SessionLocal
from app.crud.delivery_request import list_
from app.schemas.delivery_request import DeliveryRequestList

# 1) warmup
db = SessionLocal()
rows = list_(db, "SUBMITTED")
_ = [DeliveryRequestList.model_validate(r) for r in rows]
db.close()

# 2) timed db query
db = SessionLocal()
t0 = _time.time()
rows = list_(db, "SUBMITTED")
t1 = _time.time()
print("CRUD list_(SUBMITTED): rows=%d db=%dms" % (len(rows), int((t1-t0)*1000)))

# 3) timed serialize (schema now excludes allocations)
t2 = _time.time()
out = [DeliveryRequestList.model_validate(r) for r in rows]
t3 = _time.time()
print("validate DeliveryRequestList: %dms" % int((t3-t2)*1000))

t4 = _time.time()
payload = str([o.model_dump(mode="json") for o in out])
t5 = _time.time()
print("json dump: %dms len=%d" % (int((t5-t4)*1000), len(payload)))
db.close()

# 4) HTTP test to running server (short timeout)
import urllib.request, urllib.error
t6 = _time.time()
try:
    req = urllib.request.Request("http://localhost:8000/api/v1/delivery-requests/?status=SUBMITTED")
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = resp.read()
    t7 = _time.time()
    print("HTTP /delivery-requests/?status=SUBMITTED: %d %dms bytes=%d" % (resp.status, int((t7-t6)*1000), len(data)))
except urllib.error.HTTPError as e:
    t7 = _time.time()
    print("HTTP error %d after %dms" % (e.code, int((t7-t6)*1000)))
    print("  body:", e.read()[:800])
except Exception as e:
    t7 = _time.time()
    print("HTTP failed after %dms: %r" % (int((t7-t6)*1000), e))
