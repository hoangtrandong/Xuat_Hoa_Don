"""Phân loại lại SKU theo mã ngành hàng (catCode) lấy trực tiếp từ Vinamilk DMS One.

Bối cảnh: DB chỉ lưu category_id, không lưu mã ngành gốc. Trước đây
`import_vinamilk.py` map sai (A→NGK, C→BKS, D→MIA, E→HMP) và dồn B/G/H/S/Z
vào "SUN" nên không thể tách bằng DB. Script này lấy lại catCode chuẩn theo
từng SKU từ site Vinamilk rồi cập nhật danh mục tương ứng.

Chạy:
    python -m scripts.reclassify_categories --dry-run   # xem trước
    python -m scripts.reclassify_categories             # ghi vào DB
"""
from __future__ import annotations

import argparse
import sys

# Console Windows mặc định cp1252 không in được tiếng Việt -> ép UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models.product import Product, ProductCategory
from app.services.vinamilk_products import fetch_all_products

# Tên hiển thị theo mã ngành hàng Vinamilk.
# Lưu ý: API trả về catName = null nên tên phải khai báo tại đây.
CATEGORY_NAMES: dict[str, str] = {
    "A": "A - Sữa Bột",
    "B": "B - Sữa Đặc",
    "C": "C - Sữa Tươi- Sữa chua uống- Sữa đậu nành",
    "D": "D - Sữa chua - Pho mai",
    "E": "E - Giải Khát ( Trà - Nước trái cây )",
    "F": "F - F",
    "G": "G - Kem",
    "H": "H - H",
    "S": "S - Đường",
    "Z": "Z - KHÁC",
}

# SKU không tìm thấy trên Vinamilk sẽ được đưa vào nhóm này.
DEFAULT_CODE = "Z"


def _remote_category_map() -> dict[str, str]:
    """Trả về map SKU (uppercase) -> mã ngành hàng từ Vinamilk."""
    rows = fetch_all_products()
    mapping: dict[str, str] = {}
    for row in rows:
        sku = str(row.get("productCode") or "").strip().upper()
        code = str(row.get("catCode") or "").strip().upper()
        if not sku:
            continue
        mapping[sku] = code if code in CATEGORY_NAMES else DEFAULT_CODE
    return mapping


def _ensure_categories(db) -> dict[str, ProductCategory]:
    """Tạo/đổi tên 10 danh mục chuẩn, trả về map code -> category."""
    existing = {category.code: category for category in db.scalars(select(ProductCategory)).all()}
    result: dict[str, ProductCategory] = {}
    for code, name in CATEGORY_NAMES.items():
        category = existing.get(code)
        if category is None:
            category = ProductCategory(code=code, name=name)
            db.add(category)
            db.flush()
        elif category.name != name:
            category.name = name
        result[code] = category
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Phân loại lại SKU theo mã ngành hàng Vinamilk.")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ xem trước, không ghi DB.")
    args = parser.parse_args()

    print("Đang lấy mã ngành hàng từ Vinamilk...")
    remote = _remote_category_map()
    print(f"  Nhận được {len(remote)} SKU từ Vinamilk.")

    with SessionLocal() as db:
        before_rows = db.execute(
            select(ProductCategory.code, ProductCategory.name, func.count(Product.id))
            .outerjoin(Product, Product.category_id == ProductCategory.id)
            .group_by(ProductCategory.code, ProductCategory.name)
            .order_by(ProductCategory.code)
        ).all()
        print("Danh mục TRƯỚC khi phân loại lại:")
        for code, name, total in before_rows:
            print(f"  [{code}] {name} -> {total} SKU")

        categories = _ensure_categories(db)
        products = list(db.scalars(select(Product)).all())

        changed = 0
        counts: dict[str, int] = {code: 0 for code in CATEGORY_NAMES}
        unmatched = 0
        for product in products:
            code = remote.get(str(product.sku).strip().upper())
            if code is None:
                unmatched += 1
                code = DEFAULT_CODE
            target = categories[code]
            counts[code] += 1
            if product.category_id != target.id:
                product.category_id = target.id
                changed += 1

        keep_ids = {category.id for category in categories.values()}
        removed: list[str] = []
        for category in db.scalars(select(ProductCategory)).all():
            if category.id in keep_ids:
                continue
            still_used = db.scalar(
                select(Product.id).where(Product.category_id == category.id).limit(1)
            )
            if still_used is None:
                db.delete(category)
                removed.append(f"{category.code} ({category.name})")

        if args.dry_run:
            db.rollback()
            print("[DRY-RUN] Đã huỷ thay đổi, không ghi vào DB.")
        else:
            db.commit()
            print("Đã ghi thay đổi vào DB.")

    print(f"\nSKU được cập nhật danh mục: {changed}/{len(products)}")
    print(f"SKU không tìm thấy trên Vinamilk -> {DEFAULT_CODE}: {unmatched}")
    print("Phân bố SAU khi phân loại:")
    for code, name in CATEGORY_NAMES.items():
        print(f"  [{code}] {name} -> {counts[code]} SKU")
    print("Danh mục cũ đã xoá:", ", ".join(removed) if removed else "(không có)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
