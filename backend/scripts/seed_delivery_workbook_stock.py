"""Seed FEFO test stock for products requested by a DSDonHang workbook."""

import argparse
import hashlib
import sys
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from openpyxl import load_workbook
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.api.v1.endpoints.delivery_requests import _preview_new_workbook
from app.core.database import SessionLocal, engine
from app.models.inventory import InventoryLot, InventoryTransaction, Warehouse, WarehouseLocation
from app.models.product import Product


def _arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="Path to the DSDonHang workbook")
    parser.add_argument("--warehouse-id", type=int, required=True)
    parser.add_argument("--cover", type=int, default=2, help="Add this multiple of demand per product (default: 2)")
    parser.add_argument("--apply", action="store_true", help="Write inventory lots and opening transactions")
    parser.add_argument(
        "--allow-remote-db",
        action="store_true",
        help="Permit writes when the configured database host is remote",
    )
    return parser.parse_args()


def main():
    args = _arguments()
    if args.cover < 1:
        raise SystemExit("--cover must be at least 1.")
    if not args.workbook.is_file():
        raise SystemExit(f"Workbook not found: {args.workbook}")

    host = engine.url.host or ""
    if args.apply and host not in {"localhost", "127.0.0.1", "::1"} and not args.allow_remote_db:
        raise SystemExit(
            f"Refusing to write to remote database host '{host}'. "
            "Use a local test DB or explicitly pass --allow-remote-db."
        )

    file_bytes = args.workbook.read_bytes()
    import_hash = hashlib.sha256(file_bytes).hexdigest()
    workbook = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    try:
        workbook_sheet_names = [sheet.title for sheet in workbook.worksheets]
    finally:
        workbook.close()
    if len(workbook_sheet_names) != 1 or workbook_sheet_names[0].casefold() not in {
        "dsdonhang",
        "danhsachdonhang",
    }:
        raise SystemExit("Expected a workbook containing only the DSDonHang sheet.")

    with SessionLocal() as db:
        warehouse = db.get(Warehouse, args.warehouse_id)
        if not warehouse:
            raise SystemExit(f"Warehouse id {args.warehouse_id} was not found.")

        preview = _preview_new_workbook(
            file_bytes=file_bytes,
            filename=args.workbook.name,
            warehouse_id=warehouse.id,
            db=db,
        )
        if preview is None:
            raise SystemExit("The workbook could not be parsed as DSDonHang.")
        blocking_issues = [
            issue for issue in preview.issues
            if not (issue.startswith("Đơn mượn ") and "không tìm thấy NVBH" in issue)
        ]
        if blocking_issues:
            raise SystemExit("Cannot seed because the workbook has unresolved product/order issues:\n- "
                             + "\n- ".join(blocking_issues))
        if not preview.items:
            raise SystemExit("The workbook has no products to seed.")

        ref_code = f"SEED-DR-{warehouse.id}-{import_hash[:12]}"
        existing_seed = db.scalar(
            select(InventoryTransaction.id).where(InventoryTransaction.ref_code == ref_code).limit(1)
        )
        if existing_seed:
            raise SystemExit(f"Seed {ref_code} already exists; refusing to add duplicate stock.")

        locations = {}
        for code in ("A101", "A102", "A103"):
            location = db.scalar(
                select(WarehouseLocation).where(
                    WarehouseLocation.warehouse_id == warehouse.id,
                    WarehouseLocation.code == code,
                )
            )
            locations[code] = location

        now = datetime.utcnow()
        expiries = [now + timedelta(days=30), now + timedelta(days=180), now + timedelta(days=365)]
        location_codes = tuple(locations)
        planned = []
        for item in preview.items:
            total_quantity = max(item.quantity * args.cover, 3)
            portions = [total_quantity // 2, total_quantity * 3 // 10]
            portions.append(total_quantity - sum(portions))
            product = db.get(Product, item.product_id)
            if not product:
                raise SystemExit(f"Internal product id {item.product_id} was not found.")
            for index, quantity in enumerate(portions):
                if quantity:
                    planned.append({
                        "product_id": item.product_id,
                        "sku": item.sku,
                        "quantity": quantity,
                        "location_code": location_codes[index],
                        "expiry_date": expiries[index],
                        "unit_cost": product.cost_price,
                    })

        print(f"Database: {engine.url.drivername}://{host}/{engine.url.database}")
        print(f"Warehouse: {warehouse.code} — {warehouse.name} (id={warehouse.id})")
        print(f"Workbook: {args.workbook.name}; export SKUs: {len(preview.items)}")
        print(f"Additional stock: {sum(item['quantity'] for item in planned)} units across {len(planned)} FEFO lots")
        for item in preview.items:
            print(f"  {item.sku:>16}  {item.product_name}: demand={item.quantity}, seed={max(item.quantity * args.cover, 3)}")
        if not args.apply:
            print("DRY RUN — no inventory was changed. Pass --apply to write the seed.")
            return

        for code in location_codes:
            if locations[code] is None:
                location = WarehouseLocation(
                    warehouse_id=warehouse.id,
                    code=code,
                    name=f"Seed test {code}",
                )
                db.add(location)
                db.flush()
                locations[code] = location

        for item in planned:
            lot = InventoryLot(
                warehouse_id=warehouse.id,
                product_id=item["product_id"],
                location_id=locations[item["location_code"]].id,
                lot_number=f"TEST-DR-{import_hash[:8]}-{item['sku']}-{item['location_code']}",
                expiry_date=item["expiry_date"],
                quantity_on_hand=item["quantity"],
                unit_cost=item["unit_cost"],
            )
            db.add(lot)
            db.flush()
            db.add(InventoryTransaction(
                code=f"SDR-{uuid4().hex[:20].upper()}",
                type="OPENING",
                warehouse_id=warehouse.id,
                product_id=item["product_id"],
                quantity=item["quantity"],
                unit_cost=item["unit_cost"],
                ref_type="OPENING",
                ref_code=ref_code,
                note=f"TEST seed {item['sku']} FEFO {item['location_code']}",
                created_by="seed-delivery-workbook-test",
                lot_id=lot.id,
                location_id=lot.location_id,
                expiry_date=lot.expiry_date,
            ))
        db.commit()
        print(f"Seeded {len(planned)} lots. Reference: {ref_code}")


if __name__ == "__main__":
    main()
