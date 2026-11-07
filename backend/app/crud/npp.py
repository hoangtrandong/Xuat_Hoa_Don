"""Quy đổi SKU của công ty sang mã NPP nội bộ.

Tồn kho, giữ chỗ và xuất kho đều lưu theo sản phẩm đại diện của nhóm SKU dùng chung
(mã NPP). Mọi điểm đầu vào nhận SKU phải đi qua `canonical_product_id`.
"""
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from app.models.product import Product, ProductGroup, ProductGroupItem


def npp_eager_options():
    """Eager-load chain để Product.npp_code / npp_name không gây N+1."""
    return selectinload(Product.group_items).selectinload(ProductGroupItem.group).selectinload(
        ProductGroup.company_links
    )


def canonical_product_id(db: Session, product_id: int) -> int:
    product = db.get(Product, product_id)
    if not product:
        raise ValueError(f"Không tìm thấy sản phẩm {product_id}.")
    representative_id = db.scalar(
        select(ProductGroup.representative_product_id)
        .join(ProductGroupItem, ProductGroupItem.product_group_id == ProductGroup.id)
        .where(ProductGroupItem.product_id == product_id)
    )
    if representative_id is None:
        raise ValueError(f"SKU {product.sku} chưa thuộc nhóm mã NPP. Hãy gán mã NPP cho SKU này trước.")
    return representative_id


class NppDirectory:
    """Bảng tra cứu mã NPP, nạp bằng hai truy vấn để dùng cho danh sách lớn."""

    def __init__(self, db: Session):
        self.rep_of: dict[int, int] = {}
        self.labels: dict[int, tuple[str, str]] = {}
        rows = db.execute(text(
            "SELECT pgi.product_id, pg.id AS group_id, pg.name, pg.representative_product_id AS rep_id, "
            "rp.sku AS rep_sku "
            "FROM product_group_items pgi "
            "JOIN product_groups pg ON pg.id = pgi.product_group_id "
            "JOIN products rp ON rp.id = pg.representative_product_id"
        )).all()
        codes = {
            row.product_group_id: row.code
            for row in db.execute(text(
                "SELECT product_group_id, MIN(distributor_sku) AS code FROM product_group_companies "
                "WHERE distributor_sku IS NOT NULL AND distributor_sku <> '' GROUP BY product_group_id"
            )).all()
        }
        for row in rows:
            self.rep_of[row.product_id] = row.rep_id
            self.labels[row.rep_id] = (codes.get(row.group_id) or row.rep_sku, row.name)

    def canonical(self, product_id: int) -> int | None:
        return self.rep_of.get(product_id)

    def is_secondary(self, product_id: int) -> bool:
        rep = self.rep_of.get(product_id)
        return rep is not None and rep != product_id

    def label(self, product_id: int, fallback_code: str, fallback_name: str) -> tuple[str, str]:
        rep = self.rep_of.get(product_id)
        return self.labels.get(rep, (fallback_code, fallback_name)) if rep else (fallback_code, fallback_name)

    def code(self, product_id: int, fallback_code: str) -> str:
        rep = self.rep_of.get(product_id)
        return self.labels.get(rep, (fallback_code, ""))[0] if rep else fallback_code
