"""Import Vinamilk products from Excel file to PostgreSQL.

Chay: python -m scripts.import_vinamilk
Yeu cau: DATABASE_URL hop le va bang da tao (alembic upgrade head).
"""
import os
import sys
from datetime import datetime, timedelta

import openpyxl
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models import (
    Product, ProductCategory, ProductUnit, Warehouse,
    InventoryLot, WarehouseLocation
)


# Category mapping: Excel code -> Database category code
CATEGORY_MAP = {
    "A": "NGK",  # Nuoc giai khat
    "B": "SUN",  # Sua & Thuc pham bo duong
    "C": "BKS",  # Banh keo & Snack
    "D": "MIA",  # Mi & Thuc pham an lien
    "E": "HMP",  # Hoa my pham & Ve sinh
}

# Default unit for Vinamilk products (Thung)
DEFAULT_UNIT_CODE = "THUNG"


def import_vinamilk(filepath: str):
    print("Loading Excel file...")
    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb["thong tin sp"]  # Sheet san pham
    print(f"Sheet loaded: {ws.max_row} rows")

    with SessionLocal() as db:
        # Get or create default unit
        unit = db.execute(
            select(ProductUnit).where(ProductUnit.code == DEFAULT_UNIT_CODE)
        ).scalar_one_or_none()
        if not unit:
            unit = ProductUnit(code=DEFAULT_UNIT_CODE, name="Thùng")
            db.add(unit)
            db.flush()
        print(f"Unit: {unit.code}")

        # Get default warehouse and location
        warehouse = db.execute(select(Warehouse).order_by(Warehouse.id).limit(1)).scalar_one()
        location = db.execute(select(WarehouseLocation).limit(1)).scalar_one_or_none()
        print(f"Warehouse: {warehouse.code}")

        # Cache categories
        categories = {}
        for cat in db.execute(select(ProductCategory)).scalars().all():
            categories[cat.code] = cat

        # Cache existing products (uppercase for case-insensitive comparison)
        existing_skus = set()
        for sku in db.execute(select(Product.sku)).scalars().all():
            if sku:
                existing_skus.add(sku.upper())
        print(f"Existing products: {len(existing_skus)}")

        imported = 0
        updated = 0
        errors = 0
        batch_size = 100

        print("Starting import...")
        for r in range(2, ws.max_row + 1):
            try:
                sku = ws.cell(r, 1).value
                name = ws.cell(r, 2).value
                cat_code = ws.cell(r, 3).value
                supplier = ws.cell(r, 4).value
                conversion = ws.cell(r, 5).value  # Ty le quy doi (boxes_per_carton)

                if not sku or not name:
                    continue

                # Normalize SKU to uppercase for case-insensitive comparison
                sku = str(sku).strip().upper()
                name = str(name).strip()

                # Parse conversion ratio
                boxes_per_carton = 1
                if conversion:
                    try:
                        boxes_per_carton = int(float(str(conversion).strip()))
                    except (ValueError, TypeError):
                        boxes_per_carton = 1

                # Map category
                db_cat_code = CATEGORY_MAP.get(str(cat_code).strip() if cat_code else "", "SUN")
                category = categories.get(db_cat_code)
                if not category:
                    category = list(categories.values())[0]  # Fallback

                # Check if product exists (case-insensitive)
                if sku in existing_skus:
                    # Skip update for now - just count
                    updated += 1
                else:
                    # Create new product
                    product = Product(
                        sku=sku,
                        name=name,
                        category_id=category.id,
                        unit_id=unit.id,
                        supplier=supplier or "Vinamilk",
                        base_price=0,
                        cost_price=0,
                        boxes_per_carton=boxes_per_carton,
                    )
                    db.add(product)
                    imported += 1

                # Commit in batches
                if (imported + updated) % batch_size == 0:
                    db.commit()
                    print(f"  Progress: {imported} new, {updated} existing (row {r})")

            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"Error row {r}: {e}")
                continue

        # Final commit
        db.commit()
        print(f"\nImport completed!")
        print(f"  - Imported: {imported} new products")
        print(f"  - Existing: {updated} products")
        print(f"  - Errors: {errors}")
    
    wb.close()


if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\ACER\Desktop\Data\Sản phẩm VInamilk.xlsx"
    import_vinamilk(filepath)
