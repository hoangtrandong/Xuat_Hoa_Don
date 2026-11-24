import re
import unicodedata
from typing import Any, List, Optional
from sqlalchemy import case, func, select, text, or_, and_, bindparam
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


def _normalize_supplier_name(
    raw_supplier: str | None,
    seller_tax_code: str | None = None,
    fallback: str = "Vinamilk",
    db: Session | None = None,
) -> str:
    text_sup = (raw_supplier or "").strip()
    if not text_sup and not seller_tax_code:
        return fallback
    if text_sup.upper().startswith("NCC:"):
        text_sup = text_sup[4:].strip()
    upper = text_sup.upper()
    tax_clean = (seller_tax_code or "").strip()

    # 1. Tra cứu động từ Từ điển Nhà cung cấp trong Database
    if db is not None:
        try:
            from app.models.supplier_dictionary import SupplierDictionary
            dicts = db.scalars(select(SupplierDictionary).where(SupplierDictionary.is_active == True)).all()
            # 1a. Tra cứu theo Mã số thuế (MST CQT)
            if tax_clean:
                for d in dicts:
                    if d.tax_codes and tax_clean in d.tax_codes:
                        return d.standard_name
            # 1b. Tra cứu theo Từ khóa nhận diện
            if upper:
                for d in dicts:
                    if d.keywords:
                        for kw in d.keywords:
                            kw_clean = (kw or "").strip().upper()
                            if kw_clean and kw_clean in upper:
                                return d.standard_name
        except Exception:
            pass

    # 2. Quy tắc dự phòng (Fallback built-in)
    if "VINAMILK" in upper or "SỮA VIỆT NAM" in upper or "SUA VIET NAM" in upper:
        return "Vinamilk"
    if "FRIESLAND" in upper or "CAMPINA" in upper or "DUTCH LADY" in upper or "HÀ LAN" in upper or "HA LAN" in upper:
        return "Hà Lan"
    if "NABATI" in upper:
        return "Nabati"
    if "Á CHÂU" in upper or "A CHAU" in upper or "GẤU ĐỎ" in upper or "GAU DO" in upper:
        return "Gấu đỏ"
    if "VIỆT SING" in upper or "VIET SING" in upper or "VIETSING" in upper:
        return "Bỉm VietSing"
    if "HÙNG CƯỜNG" in upper or "HUNG CUONG" in upper:
        return "Hùng Cường"
    if "HAYAT" in upper or "MOLFIX" in upper:
        return "Hayat"
    if "VIỆT ĐÀI" in upper or "VIET DAI" in upper:
        return "Việt Đài"
    if "PETROLIMEX" in upper:
        return "Petrolimex"
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
    return text_sup[:120] if text_sup else fallback


def normalize_all_products_suppliers(db: Session) -> int:
    """Quét và chuẩn hóa toàn bộ trường supplier trong bảng products theo từ điển DB."""
    prods = db.scalars(select(Product)).all()
    updated = 0
    for p in prods:
        curr = p.supplier or ""
        norm = _normalize_supplier_name(curr, fallback=curr, db=db)
        if norm and norm != curr:
            p.supplier = norm
            updated += 1
    if updated > 0:
        db.commit()
    return updated


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


def _parse_cqt_vat_rate(raw_vat: str | None) -> float | None:
    """Chuẩn hóa thẻ <TSuat> từ XML Hóa đơn mua vào CQT thành số thực.
    - '8%', '8' -> 8.0
    - '10%', '10' -> 10.0
    - '5%', '0%' -> 5.0, 0.0
    - 'KCT', 'KKKNT' (Không chịu thuế / Không kê khai nộp thuế) -> -1.0
    """
    if raw_vat is None:
        return None
    text = str(raw_vat).strip().upper()
    if not text:
        return None
    if "KCT" in text or "KKKNT" in text or "KHONG CHIU THUE" in text:
        return -1.0
    cleaned = text.replace("%", "").replace(",", ".").strip()
    try:
        val = float(cleaned)
        if 0.0 <= val <= 100.0:
            return val
    except ValueError:
        pass
    return None


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
            parsed_vat = _parse_cqt_vat_rate(item.vat_rate)

            purchase_skus.add(sku)
            if sku not in candidates:
                candidates[sku] = {
                    "sku": sku,
                    "name": name,
                    "unit_raw": unit_raw,
                    "base_price": cost_price,
                    "cost_price": cost_price,
                    "vat_rate": parsed_vat,
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
                if parsed_vat is not None:
                    cand["vat_rate"] = parsed_vat
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
                    supplier=cand.get("supplier") or None,
                    base_price=round(float(cand.get("base_price") or 0.0), 4),
                    cost_price=round(float(cand.get("cost_price") or 0.0), 4),
                    vat_rate=cand.get("vat_rate"),
                    vat_rate_source="PURCHASE_INVOICE" if cand.get("vat_rate") is not None else "MANUAL",
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
                if cand.get("vat_rate") is not None and (
                    existing.vat_rate is None or (existing.vat_rate_source or "") == "PURCHASE_INVOICE"
                ):
                    if existing.vat_rate != cand["vat_rate"]:
                        existing.vat_rate = cand["vat_rate"]
                        existing.vat_rate_source = "PURCHASE_INVOICE"
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
        existing_group_by_prod_id: dict[int, ProductGroup] = {}
        for p in all_current_products:
            if p.group_items and p.group_items[0].group is not None:
                existing_group_by_prod_id[p.id] = p.group_items[0].group
        # Nạp thêm từ DB để chắc chắn 100% không bỏ sót product_id nào đã tồn tại trong product_group_items
        for pgi in db.scalars(
            select(ProductGroupItem).options(
                selectinload(ProductGroupItem.group).selectinload(ProductGroup.company_links)
            )
        ).all():
            if pgi.product_id not in existing_group_by_prod_id and pgi.group is not None:
                existing_group_by_prod_id[pgi.product_id] = pgi.group

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
                existing_group = existing_group_by_prod_id.get(matched_prod.id)
                if existing_group is not None:
                    for link in existing_group.company_links:
                        if link.distributor_sku != dms_code:
                            link.distributor_sku = dms_code
                            link.distributor_name = dms_info["name"]
                            prod_changed = True
                elif all_companies:
                    new_group = ProductGroup(name=matched_prod.name, representative_product_id=matched_prod.id)
                    db.add(new_group)
                    db.flush()
                    new_pgi = ProductGroupItem(product_group_id=new_group.id, product_id=matched_prod.id)
                    db.add(new_pgi)
                    for comp in all_companies:
                        db.add(ProductGroupCompany(
                            product_group_id=new_group.id,
                            company_id=comp.id,
                            role="MANAGER",
                            distributor_sku=dms_code,
                            distributor_name=dms_info["name"],
                        ))
                    db.flush()
                    existing_group_by_prod_id[matched_prod.id] = new_group
                    prod_changed = True

                if prod_changed:
                    dms_mapped_count += 1
                    updated += 1

    if added > 0 or updated > 0:
        db.flush()

    # Tự động đồng bộ Công ty quản lý & liên kết SKU–Công ty từ Hóa đơn mua vào CQT
    company_sync_stats = {"companies_created": 0, "companies_updated": 0, "sku_links_upserted": 0}
    try:
        from app.crud.company import sync_companies_from_purchase_invoices

        company_sync_stats = sync_companies_from_purchase_invoices(
            db, invoice_ids=invoice_ids, commit=False
        )
    except Exception:
        pass

    if commit:
        db.commit()
    else:
        db.flush()

    return {
        "added": added,
        "updated": updated,
        "dms_mapped": dms_mapped_count,
        "total_products": len(existing_products),
        "from_orders": len(order_skus),
        "from_purchase_invoices": len(purchase_skus),
        "from_issued_invoices": len(issued_skus),
        **company_sync_stats,
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


def list_paged(
    db: Session,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    supplier: Optional[str] = None,
    unit: Optional[str] = None,
    status: Optional[str] = None,
    distributor_code: Optional[str] = None,
    company_id: Optional[int] = None,
    company_tax_code: Optional[str] = None,
    has_internal_code: Optional[bool] = None,
    sort_field: str = "code",
    sort_order: str = "asc",
) -> tuple[List[Product], int, dict[str, Any]]:
    from app.models.customer import Company as CompanyModel
    from app.models.product import ProductCompany as ProductCompanyModel

    conditions = [Product.sku.is_not(None), Product.sku != ""]

    if category_id:
        conditions.append(Product.category_id == category_id)

    if supplier and supplier != "ALL":
        conditions.append(Product.supplier == supplier)

    if unit and unit != "ALL":
        conditions.append(Product.unit.has(ProductUnit.name == unit))

    if distributor_code and distributor_code.strip() and distributor_code.strip().upper() != "ALL":
        from app.models.multi_tenant_invoice import (
            Distributor as DistributorModel,
            IssuedInvoice as IssuedInvoiceModel,
            IssuedInvoiceItem as IssuedInvoiceItemModel,
            PurchaseInvoice as PurchaseInvoiceModel,
            PurchaseInvoiceItem as PurchaseInvoiceItemModel,
        )
        from app.models.vinamilk import VinamilkOrderSnapshot as SnapshotModel

        clean_dist_code = distributor_code.strip().upper()
        dist_obj = db.scalar(
            select(DistributorModel).where(func.upper(DistributorModel.code) == clean_dist_code)
        )
        dist_filter_clauses = []
        if dist_obj is not None:
            dist_filter_clauses.append(
                Product.company_links.any(
                    ProductCompanyModel.company.has(CompanyModel.distributor_id == dist_obj.id)
                )
            )
            purch_subq = (
                select(func.upper(func.trim(PurchaseInvoiceItemModel.product_code)))
                .join(
                    PurchaseInvoiceModel,
                    PurchaseInvoiceModel.id == PurchaseInvoiceItemModel.purchase_invoice_id,
                )
                .where(
                    PurchaseInvoiceModel.distributor_id == dist_obj.id,
                    PurchaseInvoiceItemModel.product_code.is_not(None),
                )
            )
            dist_filter_clauses.append(func.upper(Product.sku).in_(purch_subq))

            issued_subq = (
                select(func.upper(func.trim(IssuedInvoiceItemModel.product_code)))
                .join(
                    IssuedInvoiceModel,
                    IssuedInvoiceModel.id == IssuedInvoiceItemModel.invoice_id,
                )
                .where(
                    IssuedInvoiceModel.distributor_id == dist_obj.id,
                    IssuedInvoiceItemModel.product_code.is_not(None),
                )
            )
            dist_filter_clauses.append(func.upper(Product.sku).in_(issued_subq))

        payload_dist_expr = SnapshotModel.raw_payload["Mã NPP"].as_string()
        snap_subq = (
            select(func.upper(func.trim(SnapshotModel.product_code)))
            .where(
                SnapshotModel.product_code.is_not(None),
                or_(
                    func.upper(SnapshotModel.performed_by) == clean_dist_code,
                    func.upper(payload_dist_expr) == clean_dist_code,
                ),
            )
        )
        dist_filter_clauses.append(func.upper(Product.sku).in_(snap_subq))
        dist_filter_clauses.append(func.upper(Product._npp_code).in_(snap_subq))
        conditions.append(or_(*dist_filter_clauses))

    if company_id is not None:
        if company_id == 0:
            conditions.append(~Product.company_links.any())
        else:
            conditions.append(
                Product.company_links.any(ProductCompanyModel.company_id == company_id)
            )

    if company_tax_code and company_tax_code.strip():
        clean_mst = company_tax_code.strip()
        conditions.append(
            Product.company_links.any(
                ProductCompanyModel.company.has(CompanyModel.tax_code == clean_mst)
            )
        )

    if has_internal_code is True:
        conditions.append(and_(Product._npp_code.is_not(None), Product._npp_code != ""))
    elif has_internal_code is False:
        conditions.append(or_(Product._npp_code.is_(None), Product._npp_code == ""))

    if status and status != "ALL":
        if status == "active":
            conditions.append(Product.status == "active")
        elif status == "inactive":
            conditions.append(Product.status == "inactive")
        elif status == "HAS_PRICE":
            conditions.append(or_(Product.base_price > 0, Product.cost_price > 0))
        elif status == "ZERO_PRICE":
            conditions.append(
                and_(
                    or_(Product.base_price <= 0, Product.base_price.is_(None)),
                    or_(Product.cost_price <= 0, Product.cost_price.is_(None)),
                )
            )

    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(Product.sku).like(term),
                func.lower(Product.name).like(term),
                func.lower(Product._npp_code).like(term),
                func.lower(Product.internal_name).like(term),
                func.lower(Product.supplier).like(term),
                Product.company_links.any(
                    ProductCompanyModel.company.has(
                        or_(
                            func.lower(CompanyModel.tax_code).like(term),
                            func.lower(CompanyModel.name).like(term),
                            func.lower(CompanyModel.short_name).like(term),
                        )
                    )
                ),
            )
        )

    # 1. Đếm tổng số bản ghi phù hợp điều kiện lọc (Single fast indexed COUNT)
    count_query = select(func.count(Product.id)).where(*conditions)
    total = db.scalar(count_query) or 0

    # 2. Xử lý sắp xếp
    sort_col_map = {
        "code": Product.sku,
        "nppCode": Product._npp_code,
        "name": Product.name,
        "category": ProductCategory.name,
        "unit": ProductUnit.name,
        "boxes_per_carton": Product.boxes_per_carton,
        "supplier": Product.supplier,
        "price": Product.base_price,
        "cost_price": Product.cost_price,
    }
    col = sort_col_map.get(sort_field, Product.sku)
    order_clause = col.desc() if sort_order == "desc" else col.asc()

    # 3. Phân trang
    safe_page = max(1, page)
    safe_page_size = min(500, max(1, page_size))
    offset = (safe_page - 1) * safe_page_size

    paged_query = (
        select(Product)
        .options(joinedload(Product.category), joinedload(Product.unit))
        .outerjoin(Product.category)
        .outerjoin(Product.unit)
        .where(*conditions)
        .order_by(order_clause)
        .offset(offset)
        .limit(safe_page_size)
    )
    products = list(db.execute(paged_query).scalars().unique().all())

    # 4. Thống kê tổng quan (Single pass SQL aggregation < 2ms)
    stats_dict = {
        "total": total,
        "active_count": 0,
        "priced_count": 0,
        "zero_price_count": 0,
        "supplier_count": 0,
    }
    try:
        stats_row = db.execute(text("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'active') as active_count,
                COUNT(*) FILTER (WHERE (base_price > 0 OR cost_price > 0)) as priced_count,
                COUNT(*) FILTER (WHERE (base_price <= 0 OR base_price IS NULL) AND (cost_price <= 0 OR cost_price IS NULL)) as zero_price_count,
                COUNT(DISTINCT supplier) as supplier_count
            FROM products
            WHERE sku IS NOT NULL AND sku <> ''
        """)).mappings().first()
        if stats_row:
            stats_dict = dict(stats_row)
    except Exception:
        pass

    if not products:
        return products, total, stats_dict

    # 5. Làm giàu dữ liệu CHỈ CHO ĐÚNG các sản phẩm trên trang này (50 bản ghi)
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

    return products, total, stats_dict


def list_paged_by_mst(
    db: Session,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    supplier: Optional[str] = None,
    unit: Optional[str] = None,
    status: Optional[str] = None,
    distributor_code: Optional[str] = None,
    company_id: Optional[int] = None,
    company_tax_code: Optional[str] = None,
    has_internal_code: Optional[bool] = None,
    sort_field: str = "code",
    sort_order: str = "asc",
) -> tuple[list[tuple[Product, Any, Any]], int, dict[str, Any]]:
    """Phân trang danh sách SKU mở rộng theo từng MST đầu vào (1 dòng / cặp SKU–MST).
    SKU chưa gắn MST nào vẫn hiển thị 1 dòng với (pc_link=None, company=None).
    """
    from app.models.customer import Company as CompanyModel
    from app.models.product import ProductCompany as ProductCompanyModel

    conditions = [Product.sku.is_not(None), Product.sku != ""]

    if category_id:
        conditions.append(Product.category_id == category_id)

    if supplier and supplier != "ALL":
        conditions.append(Product.supplier == supplier)

    if unit and unit != "ALL":
        conditions.append(Product.unit.has(ProductUnit.name == unit))

    if distributor_code and distributor_code.strip() and distributor_code.strip().upper() != "ALL":
        from app.models.multi_tenant_invoice import (
            Distributor as DistributorModel,
            IssuedInvoice as IssuedInvoiceModel,
            IssuedInvoiceItem as IssuedInvoiceItemModel,
            PurchaseInvoice as PurchaseInvoiceModel,
            PurchaseInvoiceItem as PurchaseInvoiceItemModel,
        )
        from app.models.vinamilk import VinamilkOrderSnapshot as SnapshotModel

        clean_dist_code = distributor_code.strip().upper()
        dist_obj = db.scalar(
            select(DistributorModel).where(func.upper(DistributorModel.code) == clean_dist_code)
        )
        dist_filter_clauses = []
        if dist_obj is not None:
            # Cô lập dòng theo đúng phạm vi NPP khi đã gắn công ty
            conditions.append(
                or_(
                    CompanyModel.id.is_(None),
                    CompanyModel.distributor_id.is_(None),
                    CompanyModel.distributor_id == dist_obj.id,
                )
            )
            dist_filter_clauses.append(
                Product.company_links.any(
                    ProductCompanyModel.company.has(CompanyModel.distributor_id == dist_obj.id)
                )
            )
            purch_subq = (
                select(func.upper(func.trim(PurchaseInvoiceItemModel.product_code)))
                .join(
                    PurchaseInvoiceModel,
                    PurchaseInvoiceModel.id == PurchaseInvoiceItemModel.purchase_invoice_id,
                )
                .where(
                    PurchaseInvoiceModel.distributor_id == dist_obj.id,
                    PurchaseInvoiceItemModel.product_code.is_not(None),
                )
            )
            dist_filter_clauses.append(func.upper(Product.sku).in_(purch_subq))

            issued_subq = (
                select(func.upper(func.trim(IssuedInvoiceItemModel.product_code)))
                .join(
                    IssuedInvoiceModel,
                    IssuedInvoiceModel.id == IssuedInvoiceItemModel.invoice_id,
                )
                .where(
                    IssuedInvoiceModel.distributor_id == dist_obj.id,
                    IssuedInvoiceItemModel.product_code.is_not(None),
                )
            )
            dist_filter_clauses.append(func.upper(Product.sku).in_(issued_subq))

        payload_dist_expr = SnapshotModel.raw_payload["Mã NPP"].as_string()
        snap_subq = (
            select(func.upper(func.trim(SnapshotModel.product_code)))
            .where(
                SnapshotModel.product_code.is_not(None),
                or_(
                    func.upper(SnapshotModel.performed_by) == clean_dist_code,
                    func.upper(payload_dist_expr) == clean_dist_code,
                ),
            )
        )
        dist_filter_clauses.append(func.upper(Product.sku).in_(snap_subq))
        dist_filter_clauses.append(func.upper(Product._npp_code).in_(snap_subq))
        dist_filter_clauses.append(func.upper(ProductCompanyModel.npp_code).in_(snap_subq))
        conditions.append(or_(*dist_filter_clauses))

    if company_id is not None:
        if company_id == 0:
            conditions.append(ProductCompanyModel.id.is_(None))
        else:
            conditions.append(ProductCompanyModel.company_id == company_id)

    if company_tax_code and company_tax_code.strip():
        clean_mst = company_tax_code.strip()
        conditions.append(CompanyModel.tax_code == clean_mst)

    effective_npp_expr = case(
        (ProductCompanyModel.id.is_not(None), ProductCompanyModel.npp_code),
        else_=Product._npp_code,
    )

    if has_internal_code is True:
        conditions.append(and_(effective_npp_expr.is_not(None), func.trim(effective_npp_expr) != ""))
    elif has_internal_code is False:
        conditions.append(or_(effective_npp_expr.is_(None), func.trim(effective_npp_expr) == ""))

    if status and status != "ALL":
        if status == "active":
            conditions.append(Product.status == "active")
        elif status == "inactive":
            conditions.append(Product.status == "inactive")
        elif status == "HAS_PRICE":
            conditions.append(or_(Product.base_price > 0, Product.cost_price > 0))
        elif status == "ZERO_PRICE":
            conditions.append(
                and_(
                    or_(Product.base_price <= 0, Product.base_price.is_(None)),
                    or_(Product.cost_price <= 0, Product.cost_price.is_(None)),
                )
            )

    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(Product.sku).like(term),
                func.lower(Product.name).like(term),
                func.lower(Product._npp_code).like(term),
                func.lower(ProductCompanyModel.npp_code).like(term),
                func.lower(Product.internal_name).like(term),
                func.lower(Product.supplier).like(term),
                func.lower(CompanyModel.tax_code).like(term),
                func.lower(CompanyModel.name).like(term),
                func.lower(CompanyModel.short_name).like(term),
            )
        )

    # 1. Đếm tổng số dòng (SKU, MST)
    count_query = (
        select(func.count())
        .select_from(Product)
        .outerjoin(ProductCompanyModel, ProductCompanyModel.product_id == Product.id)
        .outerjoin(CompanyModel, CompanyModel.id == ProductCompanyModel.company_id)
        .outerjoin(Product.category)
        .outerjoin(Product.unit)
        .where(*conditions)
    )
    total = db.scalar(count_query) or 0

    # 2. Xử lý sắp xếp (luôn giữ các dòng cùng SKU nằm kề nhau theo MST)
    sort_col_map = {
        "code": Product.sku,
        "nppCode": effective_npp_expr,
        "name": Product.name,
        "category": ProductCategory.name,
        "unit": ProductUnit.name,
        "boxes_per_carton": Product.boxes_per_carton,
        "supplier": Product.supplier,
        "price": Product.base_price,
        "cost_price": Product.cost_price,
    }
    col = sort_col_map.get(sort_field, Product.sku)
    primary_order = col.desc().nullslast() if sort_order == "desc" else col.asc().nullslast()
    order_clauses = [
        primary_order,
        Product.sku.asc(),
        CompanyModel.tax_code.asc().nullslast(),
        ProductCompanyModel.id.asc().nullslast(),
    ]

    # 3. Phân trang
    safe_page = max(1, page)
    safe_page_size = min(500, max(1, page_size))
    offset = (safe_page - 1) * safe_page_size

    paged_query = (
        select(Product, ProductCompanyModel, CompanyModel)
        .options(joinedload(Product.category), joinedload(Product.unit))
        .outerjoin(ProductCompanyModel, ProductCompanyModel.product_id == Product.id)
        .outerjoin(CompanyModel, CompanyModel.id == ProductCompanyModel.company_id)
        .outerjoin(Product.category)
        .outerjoin(Product.unit)
        .where(*conditions)
        .order_by(*order_clauses)
        .offset(offset)
        .limit(safe_page_size)
    )
    raw_rows = list(db.execute(paged_query).all())

    # 4. Thống kê tổng quan
    stats_dict = {
        "total": total,
        "active_count": 0,
        "priced_count": 0,
        "zero_price_count": 0,
        "supplier_count": 0,
    }
    try:
        stats_row = db.execute(text("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'active') as active_count,
                COUNT(*) FILTER (WHERE (base_price > 0 OR cost_price > 0)) as priced_count,
                COUNT(*) FILTER (WHERE (base_price <= 0 OR base_price IS NULL) AND (cost_price <= 0 OR cost_price IS NULL)) as zero_price_count,
                COUNT(DISTINCT supplier) as supplier_count
            FROM products
            WHERE sku IS NOT NULL AND sku <> ''
        """)).mappings().first()
        if stats_row:
            stats_dict = dict(stats_row)
    except Exception:
        pass

    if not raw_rows:
        return [], total, stats_dict

    # 5. Làm giàu dữ liệu CHỈ CHO các SKU duy nhất trên trang hiện tại
    unique_products_by_id: dict[int, Product] = {}
    for prod, _pc, _comp in raw_rows:
        if prod.id not in unique_products_by_id:
            unique_products_by_id[prod.id] = prod
    unique_products = list(unique_products_by_id.values())
    current_product_ids = list(unique_products_by_id.keys())

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

    relevant_codes: set[str] = set()
    for prod, pc_link, _comp in raw_rows:
        if prod.sku:
            relevant_codes.add(prod.sku.strip().upper())
        if prod._npp_code:
            relevant_codes.add(prod._npp_code.strip().upper())
        if pc_link is not None and pc_link.npp_code:
            relevant_codes.add(pc_link.npp_code.strip().upper())
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
    for product in unique_products:
        rep = rep_map.get(product.id)
        product._rep_sku_cache = rep[0] if rep else None
        product._rep_name_cache = rep[1] if rep else None
        product._npp_code_cache = npp_directory.code(product.id, product.sku)

        sku_key = (product.sku or "").strip().upper()
        npp_key = (product._npp_code or "").strip().upper()
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

    return [(prod, pc_link, comp) for prod, pc_link, comp in raw_rows], total, stats_dict


def get_filter_options(db: Session) -> dict[str, Any]:
    from app.models.multi_tenant_invoice import Distributor
    supplier_rows = db.execute(text("""
        SELECT supplier, COUNT(*) as count
        FROM products
        WHERE supplier IS NOT NULL AND supplier <> ''
        GROUP BY supplier
        ORDER BY count DESC, supplier ASC
    """)).all()
    cat_rows = db.execute(text("""
        SELECT category_id, COUNT(*) as count
        FROM products
        WHERE category_id IS NOT NULL
        GROUP BY category_id
    """)).all()
    distributors = db.scalars(select(Distributor).order_by(Distributor.name)).all()
    return {
        "suppliers": [{"name": str(r[0]), "count": int(r[1])} for r in supplier_rows if r[0]],
        "category_counts": {int(r[0]): int(r[1]) for r in cat_rows if r[0] is not None},
        "distributors": [{"code": d.code, "name": d.name} for d in distributors if d.code],
    }


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
        from app.models.product import ProductCompany as ProductCompanyModel

        npp_raw = update_data.pop("npp_code")
        npp_val = str(npp_raw).strip().upper() if npp_raw and str(npp_raw).strip() else None
        product.npp_code = npp_val
        # Nếu SKU chỉ gắn đúng 1 MST đầu vào thì đồng bộ luôn npp_code trên dòng ProductCompany đó
        pc_links = db.scalars(
            select(ProductCompanyModel).where(ProductCompanyModel.product_id == product.id)
        ).all()
        if len(pc_links) == 1:
            pc_links[0].npp_code = npp_val
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
    list_paged = staticmethod(list_paged)
    list_paged_by_mst = staticmethod(list_paged_by_mst)
    get_filter_options = staticmethod(get_filter_options)
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
