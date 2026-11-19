import os
import sys
sys.path.insert(0, ".")
from dotenv import load_dotenv
load_dotenv(".env")
from app.core.database import SessionLocal
from app.models.supplier_dictionary import SupplierDictionary
from sqlalchemy import select

def seed():
    db = SessionLocal()
    default_suppliers = [
        {
            "standard_name": "Vinamilk",
            "short_code": "VNM",
            "tax_codes": ["0300588569"],
            "keywords": ["VINAMILK", "SỮA VIỆT NAM", "SUA VIET NAM", "VNM"],
            "notes": "Công ty Cổ phần Sữa Việt Nam",
        },
        {
            "standard_name": "Hà Lan",
            "short_code": "HL",
            "tax_codes": ["0700242558"],
            "keywords": ["FRIESLAND", "CAMPINA", "DUTCH LADY", "HÀ LAN", "HA LAN", "CÔ GÁI HÀ LAN", "YOMOST", "FRISTI"],
            "notes": "Công ty TNHH FrieslandCampina Việt Nam / Hà Nam (Sữa Cô Gái Hà Lan)",
        },
        {
            "standard_name": "Nabati",
            "short_code": "NBT",
            "tax_codes": [],
            "keywords": ["NABATI", "NABATI VIỆT NAM", "RICHEESE", "NEXTAR"],
            "notes": "Công ty TNHH Nabati Việt Nam",
        },
        {
            "standard_name": "Gấu đỏ",
            "short_code": "GD",
            "tax_codes": [],
            "keywords": ["GẤU ĐỎ", "GAU DO", "Á CHÂU", "A CHAU", "THỰC PHẨM Á CHÂU"],
            "notes": "Công ty Cổ phần Thực phẩm Á Châu (Mì / Cháo Gấu Đỏ)",
        },
        {
            "standard_name": "Bỉm VietSing",
            "short_code": "VS",
            "tax_codes": [],
            "keywords": ["VIỆT SING", "VIET SING", "VIETSING", "JPAD", "BONAMI", "BỈM VIETSING"],
            "notes": "Công ty CP Sản Xuất & TMQT Việt Sing",
        },
        {
            "standard_name": "Hùng Cường",
            "short_code": "HC",
            "tax_codes": [],
            "keywords": ["HÙNG CƯỜNG", "HUNG CUONG", "NUTRICARE", "SMARTA GROW", "COLOS24H", "NUNUT"],
            "notes": "Công ty TNHH Phân Phối & Logistics Hùng Cường (Nutricare)",
        },
        {
            "standard_name": "Hayat",
            "short_code": "HYT",
            "tax_codes": [],
            "keywords": ["HAYAT", "MOLFIX"],
            "notes": "Công ty TNHH Hayat Kimya Việt Nam (Tã bỉm Molfix)",
        },
        {
            "standard_name": "Việt Đài",
            "short_code": "VD",
            "tax_codes": [],
            "keywords": ["VIỆT ĐÀI", "VIET DAI"],
            "notes": "Sữa hạt dinh dưỡng ngũ cốc Việt Đài",
        },
        {
            "standard_name": "Petrolimex",
            "short_code": "PETRO",
            "tax_codes": [],
            "keywords": ["PETROLIMEX", "XĂNG DẦU NGHỆ AN"],
            "notes": "Xăng dầu chi phí hoạt động",
        },
    ]

    for item in default_suppliers:
        existing = db.scalar(select(SupplierDictionary).where(SupplierDictionary.standard_name == item["standard_name"]))
        if not existing:
            sup = SupplierDictionary(
                standard_name=item["standard_name"],
                short_code=item["short_code"],
                tax_codes=item["tax_codes"],
                keywords=item["keywords"],
                notes=item["notes"],
                is_active=True,
            )
            db.add(sup)
            print(f"Added supplier: {item['standard_name']}")
        else:
            existing.short_code = item["short_code"]
            existing.tax_codes = item["tax_codes"]
            existing.keywords = item["keywords"]
            existing.notes = item["notes"]
            print(f"Updated supplier: {item['standard_name']}")

    db.commit()
    print("Seed supplier dictionaries completed.")
    db.close()

if __name__ == "__main__":
    seed()
