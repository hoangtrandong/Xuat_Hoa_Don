"""Seed du lieu mau DMS (tieng Viet) vao PostgreSQL.

Chay: python -m scripts.seed
Yeu cau: DATABASE_URL hop le va bang da tao (alembic upgrade head).
"""
from datetime import datetime

from sqlalchemy import select

from app.core.database import SessionLocal, init_db
from app.models import (
    ProductCategory, ProductUnit, Product,
    Warehouse, Customer, Employee, SalesTerritory, Route,
    PriceList, PriceListItem, SalesOrder, SalesOrderItem,
    InventoryTransaction,
)


def seed() -> None:
    with SessionLocal() as db:
        # --- Danh muc & don vi ---
        categories = [
            ProductCategory(code="NGK", name="Nước giải khát"),
            ProductCategory(code="SUN", name="Sữa & Thực phẩm bổ dưỡng"),
            ProductCategory(code="BKS", name="Bánh kẹo & Snack"),
            ProductCategory(code="MIA", name="Mì & Thực phẩm ăn liền"),
            ProductCategory(code="HMP", name="Hóa mỹ phẩm & Vệ sinh"),
        ]
        db.add_all(categories)
        db.flush()

        units = [
            ProductUnit(code="CAI", name="Cai"),
            ProductUnit(code="THUNG", name="Thung"),
            ProductUnit(code="HOP", name="Hop"),
            ProductUnit(code="CHAI", name="Chai"),
            ProductUnit(code="LOC", name="Loc"),
            ProductUnit(code="GOI", name="Goi"),
            ProductUnit(code="KG", name="Kg"),
        ]
        db.add_all(units)
        db.flush()

        # --- San pham ---
        products = [
            Product(sku="SKU-001", name="Dau goi Clear 650ml", category_id=categories[4].id, unit_id=units[3].id, supplier="Unilever", base_price=165000, cost_price=115000),
            Product(sku="SKU-002", name="Dau xa Sunsilk 320ml", category_id=categories[4].id, unit_id=units[3].id, supplier="Unilever", base_price=85000, cost_price=60000),
            Product(sku="SKU-003", name="Omo Matic 3kg", category_id=categories[4].id, unit_id=units[5].id, supplier="Unilever", base_price=195000, cost_price=145000),
            Product(sku="SKU-007", name="Banh quy Cosy 300g", category_id=categories[2].id, unit_id=units[2].id, supplier="Viet Dai", base_price=45000, cost_price=32000),
            Product(sku="SKU-009", name="Mi Hao Hao Tom Chua Cay", category_id=categories[3].id, unit_id=units[1].id, supplier="Cau Do", base_price=110000, cost_price=90000),
            Product(sku="SKU-011", name="Bia Heineken 330ml (Thung 24)", category_id=categories[0].id, unit_id=units[1].id, supplier="Hayat", base_price=420000, cost_price=380000),
        ]
        db.add_all(products)
        db.flush()

        # --- Kho ---
        wh_main = Warehouse(code="KT", name="Kho Tong", location="Bin Tan, TP.HCM", manager="Nguyen Thu Kho")
        wh_hcm = Warehouse(code="KHCM", name="Kho Chi nhanh HCM", location="Go Vap, TP.HCM", manager="Tran Thu Kho")
        db.add_all([wh_main, wh_hcm])
        db.flush()

        # --- Ton dau ky ---
        for p in products:
            db.add(InventoryTransaction(
                code=f"OPEN-{p.sku}", type="OPENING", warehouse_id=wh_main.id,
                product_id=p.id, quantity=100, ref_type="OPENING",
                ref_code="OPEN-20260901", note="Ton dau ky thang 09", created_by="system",
            ))

        # --- Khu vuc & tuyen ---
        territory = SalesTerritory(name="KV HCM", region="NAM")
        db.add(territory)
        db.flush()
        route = Route(code="TX.01", name="Tuyen 1", territory_id=territory.id, visit_target=18)
        db.add(route)
        db.flush()

        # --- Nhan vien ---
        emp = Employee(code="NV001", name="Nguyen Van A", position="SAS", phone="0912000101", territory_id=territory.id, target=120_000_000)
        db.add(emp)
        db.flush()

        # --- Khach hang ---
        customers = [
            Customer(code="KH-0001", name="Dai ly Phu Phong", type="DISTRIBUTOR", tier="A", phone="0901234567", credit_limit=200_000_000, territory_id=territory.id, route_id=route.id, assigned_employee_id=emp.id),
            Customer(code="KH-0002", name="Cua hang An Khang 24h", type="RETAIL", tier="B", phone="0912345678", territory_id=territory.id, route_id=route.id, assigned_employee_id=emp.id),
            Customer(code="KH-0003", name="Nha phan phoi Minh Chau", type="DISTRIBUTOR", tier="A", phone="0933456789", credit_limit=300_000_000, territory_id=territory.id, route_id=route.id, assigned_employee_id=emp.id),
        ]
        db.add_all(customers)
        db.flush()

        # --- Bang gia ---
        pl = PriceList(name="Bang gia Ban le", customer_type="ALL", effective_date=datetime(2026, 3, 1))
        db.add(pl)
        db.flush()
        db.add_all([
            PriceListItem(price_list_id=pl.id, product_id=products[0].id, price=165000),
            PriceListItem(price_list_id=pl.id, product_id=products[1].id, price=85000),
            PriceListItem(price_list_id=pl.id, product_id=products[4].id, price=110000),
        ])

        # --- Don hang mau ---
        order = SalesOrder(
            code="SO-260906-001", customer_id=customers[0].id, employee_id=emp.id,
            warehouse_id=wh_main.id, status="COMPLETED", payment_status="PAID",
            subtotal=550000, discount=0, total=550000, amount_paid=550000,
            payment_method="TRANSFER", source="WEB",
        )
        db.add(order)
        db.flush()
        db.add_all([
            SalesOrderItem(order_id=order.id, product_id=products[0].id, quantity=2, price=165000, line_total=330000),
            SalesOrderItem(order_id=order.id, product_id=products[1].id, quantity=2, price=85000, line_total=170000),
            SalesOrderItem(order_id=order.id, product_id=products[4].id, quantity=1, price=50000, line_total=50000),
        ])

        db.commit()
        print("Seed DMS completed successfully.")


if __name__ == "__main__":
    seed()