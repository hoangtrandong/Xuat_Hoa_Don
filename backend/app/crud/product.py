import re
import unicodedata
from typing import Any, List, Optional
from sqlalchemy import func, select, text, or_, bindparam
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.product import (
    PriceList,
    PriceListItem,
    Product,
    ProductCategory,
    ProductUnit,
)
from app.models.vinamilk import VinamilkOrderSnapshot
from app.schemas.product import PriceListCreate, ProductCreate
from app.crud.npp import NppDirectory


DEFAULT_PRODUCT_CATEGORIES: dict[str, tuple[str, str]] = {
    "A": ("A - Sữa Bột", "Sữa bột trẻ em, người lớn, bột ăn dặm & dinh dưỡng đặc biệt"),
    "B": ("B - Sữa Đặc", "Sữa đặc có đường, Creamer đặc có đường các loại"),
    "C": ("C - Sữa Tươi - Sữa chua uống - Sữa đậu nành", "Sữa tươi tiệt trùng, sữa dinh dưỡng, sữa hạt, sữa chua uống tiệt trùng"),
    "D": ("D - Sữa chua - Phô mai", "Sữa chua ăn, sữa chua uống men sống Probi/Yomost, phô mai"),
    "E": ("E - Giải Khát (Trà - Nước trái cây)", "Nước trái cây, trà đóng chai, nước uống đóng chai"),
    "F": ("F - Thực phẩm & Gia vị", "Mì ăn liền, nước mắm, gia vị, thực phẩm chế biến"),
    "G": ("G - Kem & Đông lạnh", "Kem hộp, kem que, kem sữa đánh (Whipping Cream)"),
    "H": ("H - Hóa mỹ phẩm & Chăm sóc", "Sản phẩm chăm sóc cá nhân & vệ sinh gia đình"),
    "S": ("S - Đường & Nguyên liệu", "Đường tinh luyện, nguyên liệu pha chế công nghiệp"),
    "Z": ("Z - Hàng Khuyến Mãi & Khác", "Vật phẩm khuyến mãi (VPKM), quà tặng & hàng hóa khác"),
}

DEFAULT_PRODUCT_UNITS: dict[str, str] = {
    "HOP": "Hộp",
    "THUNG": "Thùng",
    "LON": "Lon",
    "CHA": "Chai",
    "BIC": "Bịch",
    "TUI": "Túi",
    "TUY": "Tuýp",
    "LOC": "Lốc",
    "GOI": "Gói",
    "CAI": "Cái",
    "BO": "Bộ",
    "CON": "Con",
    "KG": "Kg",
}

UNIT_ALIASES: dict[str, str] = {
    "HOP": "HOP",
    "HỘP": "HOP",
    "BOX": "HOP",
    "THUNG": "THUNG",
    "THÙNG": "THUNG",
    "THG": "THUNG",
    "CARTON": "THUNG",
    "CTN": "THUNG",
    "LON": "LON",
    "CAN": "LON",
    "CHA": "CHA",
    "CHAI": "CHA",
    "BOTTLE": "CHA",
    "BIC": "BIC",
    "BỊCH": "BIC",
    "BICH": "BIC",
    "TUI": "TUI",
    "TÚI": "TUI",
    "BAG": "TUI",
    "TUY": "TUY",
    "TUÝP": "TUY",
    "TUYP": "TUY",
    "LOC": "LOC",
    "LỐC": "LOC",
    "GOI": "GOI",
    "GÓI": "GOI",
    "PACK": "GOI",
    "CAI": "CAI",
    "CÁI": "CAI",
    "CHIẾC": "CAI",
    "CHIEC": "CAI",
    "PCS": "CAI",
    "BO": "BO",
    "BỘ": "BO",
    "SET": "BO",
    "CON": "CON",
    "KG": "KG",
    "KILOGAM": "KG",
}


def _to_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    text_val = str(val).replace(",", "").replace("đ", "").replace("VND", "").strip()
    if not text_val:
        return default
    try:
        return float(text_val)
    except ValueError:
        return default


def _normalize_unit_code(raw_unit: str | None) -> tuple[str, str]:
    cleaned = (raw_unit or "").strip().upper()
    if not cleaned:
        return "HOP", DEFAULT_PRODUCT_UNITS["HOP"]
    mapped_code = UNIT_ALIASES.get(cleaned)
    if mapped_code:
        return mapped_code, DEFAULT_PRODUCT_UNITS.get(mapped_code, mapped_code.capitalize())
    short_code = cleaned[:10]
    return short_code, (raw_unit or short_code).strip()[:40]


def _normalize_supplier_name(raw_supplier: str | None, fallback: str = "Vinamilk") -> str:
    text_sup = (raw_supplier or "").strip()
    if not text_sup:
        return fallback
    if text_sup.upper().startswith("NCC:"):
        text_sup = text_sup[4:].strip()
    upper = text_sup.upper()
    if "VINAMILK" in upper or "SỮA VIỆT NAM" in upper or "SUA VIET NAM" in upper:
        return "Vinamilk"
    if "FRIESLAND" in upper or "CAMPINA" in upper or "DUTCH LADY" in upper:
        return "FrieslandCampina"
    if "MASAN" in upper:
        return "Masan"
    if "UNILEVER" in upper:
        return "Unilever"
    if "NESTLE" in upper or "NESTLÉ" in upper:
        return "Nestlé"
    if "KIOTVIET" in upper:
        return "KiotViet"
    # Rút gọn tiền tố pháp nhân dài nếu từ hóa đơn CQT
    for prefix in (
        "CÔNG TY TNHH MỘT THÀNH VIÊN ",
        "CÔNG TY TNHH MTV ",
        "CÔNG TY TNHH ",
        "CÔNG TY CỔ PHẦN ",
        "CÔNG TY CP ",
        "CHI NHÁNH ",
    ):
        if upper.startswith(prefix):
            return text_sup[len(prefix):].strip().title()[:120]
    return text_sup[:120]


def _infer_category_code(sku: str, name: str, supplier: str = "") -> str:
    sku_u = (sku or "").strip().upper()
    name_u = (name or "").strip().upper()

    # 1. Phân loại theo quy tắc mã chuẩn của Vinamilk DMS
    if supplier.lower() == "vinamilk" or re.match(r"^(0\d|1\d|9[A-Z]{2})", sku_u):
        if sku_u.startswith("01"):
            return "B"
        if sku_u.startswith(("02", "03")):
            return "A"
        if sku_u.startswith(("04", "05", "06")):
            return "C"
        if sku_u.startswith(("07", "10")):
            return "D"
        if sku_u.startswith(("08", "15")):
            return "E"
        if sku_u.startswith(("09", "17")):
            return "G"
        if sku_u.startswith("9"):
            return "Z"

    # 2. Phân loại theo từ khóa tên sản phẩm (đa nhà cung cấp: FrieslandCampina, Masan, Unilever...)
    if any(k in name_u for k in ("SỮA ĐẶC", "SĐCĐ", "ÔNG THỌ", "CREAMER", "KEM ĐẶC", "KEM DAC", "NSPN")):
        return "B"
    if any(k in name_u for k in ("SỮA BỘT", "SB ", "DIELAC", "OPTIMUM", "SURE PREVENT", "BỘT AD", "RIDIELAC", "NGUYÊN KEM LON", "NGUYEN KEM LON")):
        return "A"
    if any(k in name_u for k in ("SỮA CHUA", "SUA CHUA", "SUACHUA", "SCA ", "SCU MS", "PROBI", "YOMOST", "PHÔ MAI", "PHO MAI")):
        return "D"
    if any(k in name_u for k in ("STTT", "SDD ", "SỮA TƯƠI", "SUA TUOI", "SỮA DINH DƯỠNG", "SUA DD", "SỮA HẠT", "ĐẬU NÀNH", "SUSU", "YOMILK", "ADM ", "GREEN FARM", "OMEGASMART", "CAOKHOE", "DUTCH LADY")):
        return "C"
    if any(k in name_u for k in ("NƯỚC UỐNG", "TRÀ ", "HERO", "TUSTC", "NƯỚC TRÁI CÂY", "COCA", "PEPSI", "REDBULL")):
        return "E"
    if any(k in name_u for k in ("MÌ ", "OMACHI", "KOKOMI", "NƯỚC MẮM", "NAM NGƯ", "CHINSU", "TƯƠNG ỚT", "HẠT NÊM", "DẦU ĂN")):
        return "F"
    if any(k in name_u for k in ("KEM ", "WHIPPING CREAM")):
        return "G"
    if any(k in name_u for k in ("DẦU GỘI", "SỮA TẮM", "BỘT GIẶT", "NƯỚC GIẶT", "NƯỚC RỬA", "SUNLIGHT", "OMO", "COMFORT", "CLEAR", "DOVE", "LIFEBUOY")):
        return "H"
    if any(k in name_u for k in ("ĐƯỜNG ", "VIÊN ĐƯỜNG")):
        return "S"
    if any(k in name_u for k in ("VPKM", "BALO", "MÓC KHÓA", "CHÉN SỨ", "BÀN HỌC", "NAM CHÂM", "QUÀ TẶNG")):
        return "Z"
    return "C" if "SỮA" in name_u or "SUA" in name_u else "Z"


def _infer_boxes_per_carton(sku: str, name: str, raw: dict[str, Any] | None = None) -> int:
    if raw:
        for k in ("boxes_per_carton", "convfact", "_boxes_per_carton"):
            val = raw.get(k)
            if val is not None:
                try:
                    num = int(float(str(val).strip()))
                    if num > 1:
                        return num
                except (ValueError, TypeError):
                    pass

    text_name = (name or "").strip()
    # Mẫu (24H/T), (48H/T)
    m1 = re.search(r"\((\d{1,3})\s*[HhBbCcGgLlTt]\s*/\s*[TtKk]\)", text_name)
    if m1:
        return max(1, int(m1.group(1)))

    # Mẫu 48X170ML, 12x850G, 24X280G, 48X110ML
    m2 = re.search(r"\b(\d{1,3})\s*[xX×]\s*\d+\s*(?:ml|ML|g|G|gr|GR|kg|KG|l|L)\b", text_name)
    if m2:
        return max(1, int(m2.group(1)))

    # Mẫu (Thùng 30 gói), (Thùng 18 chai)
    m3 = re.search(r"[Tt]hùng\s*(\d{1,3})\s*(?:gói|chai|hộp|lon|bịch|túi|lốc)", text_name)
    if m3:
        return max(1, int(m3.group(1)))

    # Quy tắc đóng gói chuẩn theo mã SKU Vinamilk
    sku_u = (sku or "").strip().upper()
    name_u = text_name.upper()
    if sku_u.startswith("9"):
        return 1
    if "1284G" in name_u or "1KG" in name_u or " 1L" in name_u:
        return 12
    if "800G" in name_u or "850G" in name_u or "900G" in name_u:
        return 6
    if "350G" in name_u or "130ML" in name_u or "165G" in name_u or "500ML" in name_u:
        return 24
    if "65ML" in name_u:
        return 50
    if "400ML" in name_u or "250ML" in name_u:
        return 12
    if any(x in name_u for x in ("110ML", "180ML", "170ML", "220ML", "80ML", "100G", "380G")):
        return 48
    return 1


def ensure_default_categories_and_units(
    db: Session,
    commit: bool = False,
) -> tuple[dict[str, ProductCategory], dict[str, ProductUnit]]:
    """Đảm bảo bảng product_categories và product_units luôn có sẵn các danh mục & ĐVT chuẩn."""
    categories = {c.code.strip().upper(): c for c in db.scalars(select(ProductCategory)).all() if c.code}
    units = {u.code.strip().upper(): u for u in db.scalars(select(ProductUnit)).all() if u.code}
    changed = False

    if not categories:
        for code, (name, desc) in DEFAULT_PRODUCT_CATEGORIES.items():
            cat = ProductCategory(code=code, name=name, description=desc)
            db.add(cat)
            categories[code] = cat
            changed = True

    if not units:
        for code, name in DEFAULT_PRODUCT_UNITS.items():
            u = ProductUnit(code=code, name=name)
            db.add(u)
            units[code] = u
            changed = True

    if changed:
        db.flush()
        if commit:
            db.commit()

    return categories, units


def _get_or_create_category(
    db: Session,
    code: str,
    categories: dict[str, ProductCategory],
) -> ProductCategory:
    norm = (code or "Z").strip().upper()[:20]
    if norm in categories:
        return categories[norm]
    name, desc = DEFAULT_PRODUCT_CATEGORIES.get(norm, (f"{norm} - Nhóm hàng {norm}", None))
    cat = db.scalar(select(ProductCategory).where(func.upper(ProductCategory.code) == norm))
    if cat is None:
        cat = ProductCategory(code=norm, name=name, description=desc)
        db.add(cat)
        db.flush()
    categories[norm] = cat
    return cat


def _get_or_create_unit(
    db: Session,
    raw_unit: str | None,
    units: dict[str, ProductUnit],
) -> ProductUnit:
    code, display_name = _normalize_unit_code(raw_unit)
    if code in units:
        return units[code]
    u = db.scalar(select(ProductUnit).where(func.upper(ProductUnit.code) == code))
    if u is None:
        u = ProductUnit(code=code, name=display_name)
        db.add(u)
        db.flush()
    units[code] = u
    return u


def _normalize_name_tokens(text: str) -> set[str]:
    if not text:
        return set()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn").lower()
    replacements = {
        r"\bsca\b": "sua chua an",
        r"\bvnm\b": "vinamilk",
        r"\bkd\b": "khong duong",
        r"\bcd\b": "co duong",
        r"\btc\b": "trai cay",
        r"\bnd\b": "nha dam",
        r"\bsttt\b": "sua tuoi tiet trung",
        r"\bt\b": "thung",
        r"\bh\b": "hop",
        r"\bl\b": "lon",
        r"\bg\b": "gram",
    }
    for pat, rep in replacements.items():
        text = re.sub(pat, rep, text)
    return {t for t in re.findall(r"[a-z0-9]+", text) if len(t) >= 2}


def _is_name_match(dms_name: str, product_name: str) -> bool:
    if not dms_name or not product_name:
        return False

    def raw_norm(s: str) -> str:
        s = unicodedata.normalize("NFD", s)
        s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn").lower()
        return re.sub(r"[^a-z0-9]", "", s)

    rn_dms = raw_norm(dms_name)
    rn_prod = raw_norm(product_name)
    if rn_dms == rn_prod:
        return True
    if len(rn_dms) >= 8 and (rn_dms in rn_prod or rn_prod in rn_dms):
        return True

    t_dms = _normalize_name_tokens(dms_name)
    t_prod = _normalize_name_tokens(product_name)
    if not t_dms or not t_prod:
        return False
    inter = t_dms.intersection(t_prod)
    overlap = len(inter) / min(len(t_dms), len(t_prod))
    return overlap >= 0.5 and len(inter) >= 2


def sync_products_from_system_data(
    db: Session,
    invoice_ids: list[int] | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Tự động đồng bộ SKU từ hóa đơn CQT tối ưu theo cơ chế Incremental:
    1. Nếu invoice_ids được truyền vào: Chỉ quét và trích xuất đúng các hóa đơn mới tải về (O(K)).
    2. Nếu invoice_ids is None: Đồng bộ toàn diện (Full Sync) dùng khi nhấn nút 'Đồng bộ từ CQT'.
    3. Mã NPP nội bộ: Cập nhật từ Đơn hàng DMS (vinamilk_order_snapshots).
       Đơn hàng DMS KHÔNG tạo mới SKU vào bảng products, mà cập nhật mã sản phẩm vào Quản lý mã NPP nội bộ.
    """
    from app.models.customer import Company
    from app.models.product import ProductGroup, ProductGroupCompany, ProductGroupItem

    categories, units = ensure_default_categories_and_units(db, commit=False)
    candidates: dict[str, dict[str, Any]] = {}
    purchase_skus: set[str] = set()
    issued_skus: set[str] = set()
    order_skus: set[str] = set()
    dms_mapped_count = 0
    existing_products: dict[str, Product] = {}

    # 1. Quét từ PurchaseInvoice & PurchaseInvoiceItem (Hóa đơn mua vào CQT) -> NGUỒN CHÍNH TẠO SKU
    try:
        from app.models.multi_tenant_invoice import PurchaseInvoice, PurchaseInvoiceItem

        purch_stmt = (
            select(PurchaseInvoiceItem, PurchaseInvoice.seller_name)
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceItem.purchase_invoice_id)
        )
        if invoice_ids is not None:
            if not invoice_ids:
                purch_rows = []
            else:
                purch_stmt = purch_stmt.where(PurchaseInvoiceItem.purchase_invoice_id.in_(invoice_ids))
                purch_rows = db.execute(purch_stmt.order_by(PurchaseInvoiceItem.id.asc())).all()
        else:
            purch_rows = db.execute(purch_stmt.order_by(PurchaseInvoiceItem.id.asc())).all()

        for item, seller_name in purch_rows:
            sku = (item.product_code or "").strip().upper()[:30]
            name = (item.product_name or "").strip()[:200]
            if not sku or not name:
                continue
            unit_raw = (item.unit_name or "THUNG").strip()
            cost_price = float(item.unit_price or 0.0)
            if cost_price <= 0 and (item.quantity or 0) > 0 and float(item.amount_before_tax or 0) > 0:
                cost_price = round(float(item.amount_before_tax) / float(item.quantity), 4)
            supplier = _normalize_supplier_name(seller_name, fallback="Nhà cung cấp CQT")
            boxes_per_carton = _infer_boxes_per_carton(sku, name)

            purchase_skus.add(sku)
            if sku not in candidates:
                candidates[sku] = {
                    "sku": sku,
                    "name": name,
                    "unit_raw": unit_raw,
                    "base_price": cost_price,
                    "cost_price": cost_price,
                    "supplier": supplier,
                    "boxes_per_carton": boxes_per_carton,
                    "sync_source": "PURCHASE_INVOICE",
                }
            else:
                cand = candidates[sku]
                if cost_price > 0:
                    cand["cost_price"] = cost_price
                    if cand["base_price"] <= 0:
                        cand["base_price"] = cost_price
                if boxes_per_carton > 1 and cand.get("boxes_per_carton", 1) <= 1:
                    cand["boxes_per_carton"] = boxes_per_carton
    except Exception:
        pass

    # 2. Quét từ IssuedInvoiceItem (Hóa đơn bán ra đã phát hành) -> Bổ sung SKU nếu full sync
    if invoice_ids is None:
        try:
            from app.models.multi_tenant_invoice import IssuedInvoiceItem

            issued_rows = db.scalars(
                select(IssuedInvoiceItem)
                .where(
                    IssuedInvoiceItem.product_code.is_not(None),
                    IssuedInvoiceItem.item_type.in_(("NORMAL", "PROMOTION")),
                )
                .order_by(IssuedInvoiceItem.id.asc())
            ).all()
            for item in issued_rows:
                sku = (item.product_code or "").strip().upper()[:30]
                name = (item.product_name or "").strip()[:200]
                if not sku or not name:
                    continue
                price = float(item.unit_price or 0.0)
                issued_skus.add(sku)
                if sku not in candidates:
                    candidates[sku] = {
                        "sku": sku,
                        "name": name,
                        "unit_raw": item.unit_name or "HOP",
                        "base_price": max(0.0, price),
                        "cost_price": 0.0,
                        "supplier": "Vinamilk",
                        "boxes_per_carton": _infer_boxes_per_carton(sku, name),
                        "sync_source": "ISSUED_INVOICE",
                    }
                elif price > 0 and candidates[sku]["base_price"] <= 0:
                    candidates[sku]["base_price"] = price
        except Exception:
            pass

    # TỐI ƯU HÓA: Chỉ truy vấn các sản phẩm hiện có tương ứng với danh sách candidate_skus
    added = 0
    updated = 0

    if candidates:
        candidate_skus = list(candidates.keys())
        existing_products = {
            p.sku.strip().upper(): p
            for p in db.scalars(
                select(Product).where(func.upper(Product.sku).in_(candidate_skus))
            ).all()
            if p.sku
        }

        for sku, cand in candidates.items():
            cat_code = _infer_category_code(sku, cand["name"], cand.get("supplier") or "")
            cat_obj = _get_or_create_category(db, cat_code, categories)
            unit_obj = _get_or_create_unit(db, cand.get("unit_raw"), units)

            existing = existing_products.get(sku)
            if existing is None:
                new_prod = Product(
                    sku=sku,
                    name=cand["name"],
                    category_id=cat_obj.id,
                    unit_id=unit_obj.id,
                    supplier=cand.get("supplier") or "Vinamilk",
                    base_price=round(float(cand.get("base_price") or 0.0), 4),
                    cost_price=round(float(cand.get("cost_price") or 0.0), 4),
                    reorder_level=20,
                    boxes_per_carton=max(1, int(cand.get("boxes_per_carton") or 1)),
                    status="active",
                    sync_source=cand.get("sync_source") or "PURCHASE_INVOICE",
                )
                db.add(new_prod)
                existing_products[sku] = new_prod
                added += 1
            else:
                row_changed = False
                if (not existing.name or existing.name.startswith("Sản phẩm ")) and cand["name"]:
                    existing.name = cand["name"]
                    row_changed = True
                if (existing.cost_price is None or existing.cost_price <= 0) and (cand.get("cost_price") or 0) > 0:
                    existing.cost_price = round(float(cand["cost_price"]), 4)
                    row_changed = True
                if (existing.base_price is None or existing.base_price <= 0) and (cand.get("base_price") or 0) > 0:
                    existing.base_price = round(float(cand["base_price"]), 4)
                    row_changed = True
                if not existing.supplier and cand.get("supplier"):
                    existing.supplier = cand["supplier"]
                    row_changed = True
                if (existing.boxes_per_carton is None or existing.boxes_per_carton <= 1) and (cand.get("boxes_per_carton") or 1) > 1:
                    existing.boxes_per_carton = int(cand["boxes_per_carton"])
                    row_changed = True
                if existing.sync_source != cand.get("sync_source") and cand.get("sync_source"):
                    existing.sync_source = cand["sync_source"]
                    row_changed = True
                if row_changed:
                    updated += 1

        db.flush()

    # 3. Quét từ VinamilkOrderSnapshot (Đơn hàng DMS) -> Chỉ quét khi full sync (invoice_ids is None)
    if invoice_ids is None:
        dms_items: dict[str, dict[str, Any]] = {}
        snapshots = db.scalars(
            select(VinamilkOrderSnapshot)
            .where(
                VinamilkOrderSnapshot.product_code.is_not(None),
                func.trim(VinamilkOrderSnapshot.product_code) != "",
            )
            .order_by(VinamilkOrderSnapshot.id.asc())
        ).all()

        for snap in snapshots:
            raw = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
            dms_code = (
                snap.product_code
                or raw.get("Mã sản phẩm")
                or raw.get("productCode")
                or raw.get("ProductCode")
                or raw.get("ma_sku")
                or raw.get("ItemCode")
                or ""
            ).strip().upper()[:30]
            if not dms_code:
                continue

            dms_name = str(
                snap.product_name
                or raw.get("Sản phẩm")
                or raw.get("Tên sản phẩm")
                or raw.get("productName")
                or raw.get("ProductName")
                or raw.get("ten_hang_hoa")
                or raw.get("ItemName")
                or ""
            ).strip()[:200]
            if not dms_name or dms_name == f"Name {dms_code}":
                continue

            price = _to_float(
                raw.get("Đơn giá")
                or raw.get("Giá bán")
                or raw.get("unitPrice")
                or raw.get("Price")
                or raw.get("don_gia_chua_vat")
                or raw.get("basePrice")
                or 0.0
            )
            if price <= 0:
                qty = _to_float(raw.get("Số lượng") or raw.get("quantity") or raw.get("Quantity"), 0.0)
                val = _to_float(raw.get("Giá trị") or raw.get("totalValue") or raw.get("SubTotal"), 0.0)
                if qty > 0 and val > 0:
                    price = round(val / qty, 4)

            order_skus.add(dms_code)
            if dms_code not in dms_items:
                dms_items[dms_code] = {
                    "code": dms_code,
                    "name": dms_name,
                    "price": price,
                    "boxes_per_carton": _infer_boxes_per_carton(dms_code, dms_name, raw),
                }
            else:
                if price > 0:
                    dms_items[dms_code]["price"] = price

        # Khớp mã DMS vào danh sách sản phẩm SKU và cập nhật Mã NPP nội bộ
        all_current_products = db.scalars(
            select(Product).options(
                selectinload(Product.group_items).selectinload(ProductGroupItem.group).selectinload(ProductGroup.company_links)
            )
        ).all()
        all_companies = db.scalars(select(Company)).all()

        dms_mapped_count = 0
        for dms_code, dms_info in dms_items.items():
            matched_prod = None

            # 1) Khớp theo mã SKU
            for p in all_current_products:
                if p.sku.strip().upper() == dms_code:
                    matched_prod = p
                    break

            # 2) Khớp theo mã NPP đã gán
            if matched_prod is None:
                for p in all_current_products:
                    if (p.npp_code or "").strip().upper() == dms_code:
                        matched_prod = p
                        break

            # 3) Khớp theo tên sản phẩm
            if matched_prod is None and dms_info["name"]:
                for p in all_current_products:
                    if _is_name_match(dms_info["name"], p.name):
                        matched_prod = p
                        break

            # Khi tìm thấy SKU tương ứng, cập nhật Mã NPP nội bộ
            if matched_prod is not None:
                prod_changed = False
                if (matched_prod.npp_code or "").strip().upper() != dms_code:
                    matched_prod.npp_code = dms_code
                    prod_changed = True

                if dms_info["price"] > 0:
                    matched_prod.base_price = round(float(dms_info["price"]), 4)
                    prod_changed = True

                if (matched_prod.boxes_per_carton is None or matched_prod.boxes_per_carton <= 1) and dms_info["boxes_per_carton"] > 1:
                    matched_prod.boxes_per_carton = dms_info["boxes_per_carton"]
                    prod_changed = True

                # Đồng bộ vào Quản lý mã NPP nội bộ (ProductGroup & ProductGroupCompany)
                if matched_prod.group_items:
                    group = matched_prod.group_items[0].group
                    for link in group.company_links:
                        if link.distributor_sku != dms_code:
                            link.distributor_sku = dms_code
                            link.distributor_name = dms_info["name"]
                            prod_changed = True
                elif all_companies:
                    new_group = ProductGroup(name=matched_prod.name, representative_product_id=matched_prod.id)
                    db.add(new_group)
                    db.flush()
                    db.add(ProductGroupItem(product_group_id=new_group.id, product_id=matched_prod.id))
                    for comp in all_companies:
                        db.add(ProductGroupCompany(
                            product_group_id=new_group.id,
                            company_id=comp.id,
                            role="MANAGER",
                            distributor_sku=dms_code,
                            distributor_name=dms_info["name"],
                        ))
                    prod_changed = True

                if prod_changed:
                    dms_mapped_count += 1
                    updated += 1

    if (added > 0 or updated > 0) and commit:
        db.commit()
    elif added > 0 or updated > 0:
        db.flush()

    return {
        "added": added,
        "updated": updated,
        "dms_mapped": dms_mapped_count,
        "total_products": len(existing_products),
        "from_orders": len(order_skus),
        "from_purchase_invoices": len(purchase_skus),
        "from_issued_invoices": len(issued_skus),
    }


def get(db: Session, product_id: int) -> Optional[Product]:
    return db.get(Product, product_id)


def list_(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    category_id: Optional[int] = None,
    auto_sync: bool = False,
) -> List[Product]:
    from app.models.multi_tenant_invoice import PurchaseInvoiceItem

    if auto_sync:
        try:
            sync_products_from_system_data(db, commit=True)
        except Exception:
            db.rollback()

    # Danh sách SKU: Chỉ hiển thị các mã sản phẩm từ Cơ quan Thuế (sử dụng chỉ mục sync_source)
    stmt = (
        select(Product)
        .options(joinedload(Product.category), joinedload(Product.unit))
        .where(
            or_(
                Product.sync_source.in_(("PURCHASE_INVOICE", "ISSUED_INVOICE", "CQT")),
                Product.sku.in_(
                    select(PurchaseInvoiceItem.product_code).where(PurchaseInvoiceItem.product_code.is_not(None))
                ),
            )
        )
        .order_by(Product.sku)
        .offset(skip)
        .limit(limit)
    )
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    products = list(db.execute(stmt).scalars().unique().all())

    if not products:
        return products

    current_product_ids = [p.id for p in products]
    rep_rows = db.execute(
        text(
            "SELECT pgi.product_id, rp.sku AS rep_sku, rp.name AS rep_name "
            "FROM product_group_items pgi "
            "JOIN product_groups pg ON pg.id = pgi.product_group_id "
            "JOIN products rp ON rp.id = pg.representative_product_id "
            "WHERE pgi.product_id IN :pids"
        ).bindparams(bindparam("pids", expanding=True)),
        {"pids": current_product_ids},
    ).all()
    rep_map = {row.product_id: (row.rep_sku, row.rep_name) for row in rep_rows}

    # TỐI ƯU HÓA: Chỉ gom mã của các sản phẩm đang hiển thị trên trang hiện tại
    relevant_codes = {p.sku.strip().upper() for p in products if p.sku} | {
        (p.npp_code or "").strip().upper() for p in products if p.npp_code
    }
    relevant_codes = {c for c in relevant_codes if c}

    order_stats_map: dict[str, tuple[int, float]] = {}
    try:
        if relevant_codes:
            snaps = db.execute(
                select(
                    func.upper(func.trim(VinamilkOrderSnapshot.product_code)),
                    func.count(func.distinct(VinamilkOrderSnapshot.order_number)),
                    func.count(VinamilkOrderSnapshot.id),
                )
                .where(
                    VinamilkOrderSnapshot.product_code.is_not(None),
                    func.upper(func.trim(VinamilkOrderSnapshot.product_code)).in_(relevant_codes),
                )
                .group_by(func.upper(func.trim(VinamilkOrderSnapshot.product_code)))
            ).all()
            for s_code, ord_cnt, line_cnt in snaps:
                if s_code:
                    order_stats_map[str(s_code)] = (int(ord_cnt or 0), float(line_cnt or 0))

            all_snap_payloads = db.execute(
                select(
                    VinamilkOrderSnapshot.product_code,
                    VinamilkOrderSnapshot.raw_payload,
                ).where(
                    VinamilkOrderSnapshot.product_code.is_not(None),
                    VinamilkOrderSnapshot.is_synthetic.is_(False),
                    func.upper(func.trim(VinamilkOrderSnapshot.product_code)).in_(relevant_codes),
                )
            ).all()
            qty_by_sku: dict[str, float] = {}
            for p_code, raw_p in all_snap_payloads:
                key = (p_code or "").strip().upper()
                if not key:
                    continue
                rw = raw_p if isinstance(raw_p, dict) else {}
                q = _to_float(rw.get("Số lượng") or rw.get("quantity") or rw.get("Quantity"), 0.0)
                pq = _to_float(rw.get("Số lượng KM") or rw.get("promotionQuantity") or rw.get("bonusQuantity"), 0.0)
                qty_by_sku[key] = qty_by_sku.get(key, 0.0) + q + pq
            for k, total_q in qty_by_sku.items():
                if k in order_stats_map:
                    order_stats_map[k] = (order_stats_map[k][0], round(total_q, 2))
    except Exception:
        pass

    purchase_stats_map: dict[str, tuple[int, float]] = {}
    try:
        from app.models.multi_tenant_invoice import PurchaseInvoiceItem

        if relevant_codes:
            p_rows = db.execute(
                select(
                    func.upper(func.trim(PurchaseInvoiceItem.product_code)),
                    func.count(func.distinct(PurchaseInvoiceItem.purchase_invoice_id)),
                    func.sum(PurchaseInvoiceItem.quantity),
                )
                .where(
                    PurchaseInvoiceItem.product_code.is_not(None),
                    func.upper(func.trim(PurchaseInvoiceItem.product_code)).in_(relevant_codes),
                )
                .group_by(func.upper(func.trim(PurchaseInvoiceItem.product_code)))
            ).all()
            for p_code, inv_cnt, sum_qty in p_rows:
                if p_code:
                    purchase_stats_map[str(p_code)] = (int(inv_cnt or 0), round(float(sum_qty or 0.0), 2))
    except Exception:
        pass

    npp_directory = NppDirectory(db)
    for product in products:
        rep = rep_map.get(product.id)
        product._rep_sku_cache = rep[0] if rep else None
        product._rep_name_cache = rep[1] if rep else None
        product._npp_code_cache = npp_directory.code(product.id, product.sku)

        sku_key = (product.sku or "").strip().upper()
        npp_key = (product.npp_code or "").strip().upper()
        ord_cnt, ord_qty = order_stats_map.get(npp_key) or order_stats_map.get(sku_key) or (0, 0.0)
        pur_cnt, pur_qty = purchase_stats_map.get(sku_key) or purchase_stats_map.get(npp_key) or (0, 0.0)

        product.category_code = product.category.code if product.category else None
        product.category_name = product.category.name if product.category else None
        product.unit_code = product.unit.code if product.unit else None
        product.unit_name = product.unit.name if product.unit else None
        product.order_count = ord_cnt
        product.total_ordered_qty = ord_qty
        product.purchase_invoice_count = pur_cnt
        product.total_purchased_qty = pur_qty
        if ord_cnt > 0 and pur_cnt > 0:
            product.sync_source = "DMS_AND_CQT"
        elif ord_cnt > 0:
            product.sync_source = "ORDER_SYNC"
        elif pur_cnt > 0:
            product.sync_source = "PURCHASE_INVOICE"
        else:
            product.sync_source = "MANUAL"

    return products


def create(db: Session, obj_in: ProductCreate) -> Product:
    data = obj_in.model_dump()
    if data.get("sku"):
        data["sku"] = str(data["sku"]).strip().upper()
    npp_val = data.pop("npp_code", None)
    existing = db.execute(select(Product.id).where(Product.sku == data["sku"])).scalar_one_or_none()
    if existing:
        raise ValueError(f"SKU {data['sku']} đã tồn tại.")
    product = Product(**data)
    if npp_val:
        product.npp_code = str(npp_val).strip().upper()
    db.add(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError(f"SKU {data['sku']} đã tồn tại.") from None
    db.refresh(product)
    return product


def update(db: Session, product_id: int, obj_in) -> Optional[Product]:
    product = db.get(Product, product_id)
    if not product:
        return None

    if obj_in.sku is not None and obj_in.sku.upper() != product.sku.upper():
        existing = db.query(Product).filter(Product.sku == obj_in.sku.upper()).first()
        if existing:
            raise ValueError(f"SKU {obj_in.sku} đã tồn tại")

    update_data = obj_in.model_dump(exclude_unset=True)

    if "sku" in update_data and update_data["sku"]:
        update_data["sku"] = update_data["sku"].upper()

    if "npp_code" in update_data:
        npp_raw = update_data.pop("npp_code")
        npp_val = str(npp_raw).strip().upper() if npp_raw and str(npp_raw).strip() else None
        product.npp_code = npp_val
        # Đồng bộ ProductGroupCompany nếu SKU thuộc nhóm
        if product.group_items:
            group = product.group_items[0].group
            for link in group.company_links:
                link.distributor_sku = npp_val

    for field, value in update_data.items():
        setattr(product, field, value)

    db.commit()
    db.refresh(product)
    return product


def delete(db: Session, product_id: int) -> bool:
    product = db.get(Product, product_id)
    if not product:
        return False
    db.delete(product)
    db.commit()
    return True


def bulk_delete(db: Session, product_ids: List[int]) -> int:
    deleted = 0
    for product_id in product_ids:
        product = db.get(Product, product_id)
        if product:
            db.delete(product)
            deleted += 1
    db.commit()
    return deleted


class ProductCRUD:
    get = staticmethod(get)
    list_ = staticmethod(list_)
    create = staticmethod(create)
    update = staticmethod(update)
    delete = staticmethod(delete)
    bulk_delete = staticmethod(bulk_delete)
    sync_products_from_system_data = staticmethod(sync_products_from_system_data)
    ensure_default_categories_and_units = staticmethod(ensure_default_categories_and_units)


product = ProductCRUD()


def create_price_list(db: Session, obj_in: PriceListCreate) -> PriceList:
    data = obj_in.model_dump(exclude={"items"})
    pl = PriceList(**data)
    db.add(pl)
    db.flush()
    for item in obj_in.items:
        db.add(PriceListItem(price_list_id=pl.id, **item.model_dump()))
    db.commit()
    db.refresh(pl)
    return pl


def list_price_lists(db: Session) -> List[PriceList]:
    return list(db.execute(select(PriceList)).scalars().all())


class PriceListCRUD:
    create = staticmethod(create_price_list)
    list_ = staticmethod(list_price_lists)


price_list = PriceListCRUD()
