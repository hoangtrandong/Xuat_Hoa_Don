from datetime import date, datetime
from types import SimpleNamespace
import unicodedata

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (đăng ký toàn bộ model)
from app.api.v1.endpoints.sync import (
    BulkDeleteOrderTarget,
    BulkDeleteOrdersRequest,
    ManualOrderLine,
    ManualOrderRequest,
    MergeOrdersRequest,
    SplitOrderItemAllocation,
    SplitOrderRequest,
    SplitOrderTarget,
    _approve_split_order_request,
    _bulk_delete_orders,
    _create_split_order_request,
    _create_manual_order,
    _delete_manual_order,
    _get_manual_order_detail,
    _merge_vinamilk_orders,
    _update_manual_order,
    list_grouped_vinamilk_orders,
    list_local_vinamilk_orders,
)
from app.api.v1.endpoints.delivery_requests import submit_request
from app.core.database import Base
from app.crud import customer as customer_crud
from app.models.customer import Customer, Store
from app.models.employee import Employee
from app.models.inventory import DeliveryRequest, DeliveryRequestOrder, Warehouse
from app.models.multi_tenant_invoice import Distributor, DistributorSupplierConfig
from app.models.product import Product, ProductCategory, ProductUnit
from app.models.promotion import Promotion, PromotionItem, PromotionRule, PromotionRuleRewardProduct, PromotionStore
from app.models.vinamilk import VinamilkOrderSnapshot
from app.api.v1.endpoints.products import _product_distributors
from app.schemas.customer import CustomerCreate


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        cat = ProductCategory(code="SUA", name="Sữa")
        unit = ProductUnit(code="HOP", name="Hộp")
        session.add_all([cat, unit])
        session.flush()
        session.add(Product(sku="01VD41", name="SĐCĐ Ông Thọ", category_id=cat.id, unit_id=unit.id,
                            supplier="Vinamilk", base_price=4428))
        session.add(Customer(code="0MD", name="Nam thúy 1", type="RETAIL", staff_code="0000030917",
                             staff_name="Phạm Thị Lê", manager_code="NV001", manager_name="Nguyễn An"))
        session.commit()
        yield session
    engine.dispose()


def _payload(**kwargs):
    base = dict(
        customer_code="0MD",
        order_date=date(2026, 11, 4),
        lines=[ManualOrderLine(product_code="01vd41", quantity=10, discount_amount=4280)],
    )
    base.update(kwargs)
    return ManualOrderRequest(**base)


def test_create_manual_order_uses_system_customer_and_sku(db):
    result = _create_manual_order(db, _payload(), performed_by="admin")
    assert result["order_number"] == "TC-261104-001"
    assert result["total_value"] == 44280 - 4280

    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == "TC-261104-001"))
    assert row.is_synthetic is True
    assert row.raw_payload["Tên KH"] == "Nam thúy 1"
    assert row.raw_payload["Mã NVBH"] == "0000030917"
    assert row.raw_payload["Đơn giá"] == 4428
    assert row.raw_payload["ĐVT"] == "HOP"
    assert row.raw_payload["Trạng thái tạo đơn"] == "001-Xuất hàng"
    assert row.raw_payload["orderType"] == "001-Xuất hàng"

    second = _create_manual_order(db, _payload(order_type="002-Dương Số"), performed_by="admin")
    assert second["order_number"] == "TC-261104-002"
    second_row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == "TC-261104-002"))
    assert second_row.raw_payload["Trạng thái tạo đơn"] == "002-Dương Số"


def test_manual_order_shows_in_order_list_with_supplier(db):
    _create_manual_order(db, _payload(), performed_by="admin")
    res = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    rows = res["rows"]
    assert len(rows) == 1
    assert rows[0]["Số đơn hàng"] == "TC-261104-001"
    assert rows[0]["Nhà cung cấp"] == "Vinamilk"
    assert rows[0]["Tình trạng xử lý đơn hàng"] == "Đơn Tự Tạo"
    assert rows[0]["Trạng thái tạo đơn"] == "001-Xuất hàng"
    assert rows[0]["Mã NVQL"] == "NV001"
    assert rows[0]["Tên NVQL"] == "Nguyễn An"


def test_order_list_uses_supplier_sync_timestamp_without_legacy_sync_run(db):
    distributor = Distributor(code="NPP-SYNC", name="NPP Sync")
    other_distributor = Distributor(code="NPP-OTHER", name="NPP Other")
    db.add_all([distributor, other_distributor])
    db.flush()
    db.add_all([
        DistributorSupplierConfig(
            distributor_id=distributor.id,
            supplier_code="NAZZY",
            supplier_name="Nazzy",
            last_synced_at=datetime(2026, 11, 22, 12, 0),
        ),
        DistributorSupplierConfig(
            distributor_id=other_distributor.id,
            supplier_code="MASAN",
            supplier_name="Masan",
            last_synced_at=datetime(2026, 11, 22, 15, 0),
        ),
    ])
    db.commit()

    result = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4),
        to_date=date(2026, 11, 4),
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=100,
        db=db,
        distributor_code="NPP-SYNC",
    )

    assert result["last_synced_at"] == "2026-11-22T12:00:00+00:00"


def test_supplier_synced_orders_are_visible_to_their_distributor(db):
    order_date = date(2026, 11, 4)
    db.add(VinamilkOrderSnapshot(
        remote_key="supplier-sync-maigold",
        order_number="NAZZY-001",
        customer_code="0MD",
        customer_name="Nam thúy 1",
        product_code="01VD41",
        product_name="SĐCĐ Ông Thọ",
        order_created_date=order_date,
        synced_from=order_date,
        synced_to=order_date,
        performed_by="NPP-MAIGOLD",
        raw_payload={
            "Số đơn hàng": "NAZZY-001",
            "Mã KH": "0MD",
            "Tên KH": "Nam thúy 1",
            "Mã sản phẩm": "01VD41",
            "Tên sản phẩm": "SĐCĐ Ông Thọ",
            "Nhà cung cấp": "Nazzy",
        },
    ))
    db.add(VinamilkOrderSnapshot(
        remote_key="supplier-sync-other-distributor",
        order_number="OTHER-001",
        customer_code="0MD",
        customer_name="Nam thúy 1",
        product_code="01VD41",
        product_name="SĐCĐ Ông Thọ",
        order_created_date=order_date,
        synced_from=order_date,
        synced_to=order_date,
        performed_by="NPP-OTHER",
        raw_payload={"Số đơn hàng": "OTHER-001"},
    ))
    db.flush()

    response = list_local_vinamilk_orders(
        from_date=order_date,
        to_date=order_date,
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=1,
        db=db,
        current_user=SimpleNamespace(
            distributor_id=2,
            distributor=SimpleNamespace(code="NPP-MAIGOLD"),
        ),
    )

    assert [row["Số đơn hàng"] for row in response["rows"]] == ["NAZZY-001"]
    assert response["snapshot_total"] == 1


def test_order_list_supplies_product_carton_conversion_and_unknown_sku(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    product.boxes_per_carton = 24
    for index, code in enumerate(("01VD41", "MISSING")):
        db.add(VinamilkOrderSnapshot(
            remote_key=f"conversion-{index}", order_number="VM-CONVERSION", product_code=code,
            order_created_date=date(2026, 11, 4), synced_from=date(2026, 11, 4),
            synced_to=date(2026, 11, 4),
            raw_payload={"productCode": code, "quantity": 27, "promotionQuantity": 3},
        ))
    db.flush()
    result = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    rows = {row["productCode"]: row for row in result["rows"]}
    assert rows["01VD41"]["_boxes_per_carton"] == 24
    assert rows["MISSING"]["_boxes_per_carton"] is None


def test_grouped_order_pagination_filter_and_detail(db):
    day = date(2026, 11, 4)
    for index, (order, product, value, discount) in enumerate((
        ("ORD-1", "01VD41", 100, 10),
        ("ORD-1", "OTHER", 200, 30),
        ("ORD-2", "01VD41", 300, 20),
    )):
        db.add(VinamilkOrderSnapshot(
            remote_key=f"grouped-{index}", order_number=order, product_code=product,
            customer_code="0MD", customer_name="Nam thúy 1", order_created_date=day,
            performed_by=unicodedata.normalize("NFD", "H\u1ec7 th\u1ed1ng") if order == "ORD-2" else None,
            processing_status="NCC:NAZZY" if order == "ORD-1" and product == "OTHER" else None,
            synced_from=day, synced_to=day,
            raw_payload={"orderNumber": order, "productCode": product, "totalValue": value,
                         "totalDiscount": discount, "customerCode": "0MD",
                         **({"Nguồn đồng bộ": "NAZZY"} if order == "ORD-1" and product == "01VD41" else {})},
        ))
    db.flush()
    first = list_grouped_vinamilk_orders(day, day, skip=0, limit=1, db=db)
    second = list_grouped_vinamilk_orders(day, day, skip=1, limit=1, db=db)
    assert first["total"] == 2
    assert first["rows"][0]["orderNumber"] != second["rows"][0]["orderNumber"]
    matching = list_grouped_vinamilk_orders(day, day, product="OTHER", skip=0, limit=20, db=db)
    assert matching["total"] == 1
    assert matching["rows"][0]["_product_count"] == 2
    assert matching["rows"][0]["totalValue"] == 300
    assert matching["rows"][0]["totalDiscount"] == 40
    # ORD-1 có Nguồn đồng bộ = NAZZY nên không kế thừa mặc định Nhà cung cấp = Vinamilk
    assert "Nhà cung cấp" not in matching["rows"][0]
    assert matching["rows"][0]["Nguồn đồng bộ"] == "NAZZY"
    vinamilk_order = next(row for row in first["rows"] + second["rows"] if row["orderNumber"] == "ORD-2")
    assert vinamilk_order["Nguồn đồng bộ"] == "VINAMILK"
    assert vinamilk_order["Nhà cung cấp"] == "Vinamilk"
    assert "productCode" not in matching["rows"][0]
    assert "quantity" not in matching["rows"][0]
    assert list_grouped_vinamilk_orders(day, day, product="Vinamilk", skip=0, limit=20, db=db)["total"] == 1
    detail = list_local_vinamilk_orders(
        from_date=day, to_date=day, source="sync", search=None, status=None,
        skip=0, limit=100, db=db, order_number="ORD-1",
    )
    assert {row["productCode"] for row in detail["rows"]} == {"01VD41", "OTHER"}


def test_grouped_orders_keep_same_order_number_separate_by_distributor(db):
    day = date(2026, 11, 4)
    distributors = [
        Distributor(code="NPP-TRUNGDONG", name="Trung Dong"),
        Distributor(code="NPP-MAIGOLD", name="Mai Gold"),
    ]
    db.add_all(distributors)
    db.flush()
    for index, distributor in enumerate(distributors):
        db.add(VinamilkOrderSnapshot(
            remote_key=f"same-order-{index}",
            order_number="DUPLICATE-001",
            product_code=f"SKU-{index}",
            product_name=f"Product {index}",
            order_created_date=day,
            performed_by=distributor.code,
            synced_from=day,
            synced_to=day,
            raw_payload={"Số đơn hàng": "DUPLICATE-001", "Mã NPP": distributor.code},
        ))
    db.flush()

    result = list_grouped_vinamilk_orders(day, day, skip=0, limit=20, db=db)

    assert result["total"] == 2
    assert {row["_distributor_code"] for row in result["rows"]} == {
        "NPP-TRUNGDONG",
        "NPP-MAIGOLD",
    }
    assert {row["NPP"] for row in result["rows"]} == {
        "Trung Dong",
        "Mai Gold",
    }
    mai_gold_detail = list_local_vinamilk_orders(
        from_date=day,
        to_date=day,
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=20,
        db=db,
        order_number="DUPLICATE-001",
        distributor_code="NPP-MAIGOLD",
    )
    assert len(mai_gold_detail["rows"]) == 1
    assert mai_gold_detail["rows"][0]["_distributor_code"] == "NPP-MAIGOLD"
    assert mai_gold_detail["snapshot_count"] == 1


def test_synced_products_are_associated_with_their_distributor(db):
    trung_dong = Distributor(code="NPP-TRUNGDONG", name="Trung Dong")
    mai_gold = Distributor(code="NPP-MAIGOLD", name="Mai Gold")
    db.add_all([trung_dong, mai_gold])
    db.flush()
    db.add_all([
        DistributorSupplierConfig(
            distributor_id=trung_dong.id, supplier_code="VINAMILK", supplier_name="Vinamilk",
        ),
        DistributorSupplierConfig(
            distributor_id=mai_gold.id, supplier_code="NAZZY", supplier_name="Nazzy",
        ),
    ])
    day = date(2026, 11, 4)
    db.add_all([
        VinamilkOrderSnapshot(
            remote_key="product-source-vinamilk",
            order_number="VNM-001",
            product_code="SKU-VNM",
            product_name="Vinamilk product",
            order_created_date=day,
            performed_by="Hệ thống",
            synced_from=day,
            synced_to=day,
            raw_payload={"Nguồn đồng bộ": "VINAMILK"},
        ),
        VinamilkOrderSnapshot(
            remote_key="product-source-nazzy",
            order_number="NAZ-001",
            product_code="SKU-NAZ",
            product_name="Nazzy product",
            order_created_date=day,
            performed_by=mai_gold.code,
            synced_from=day,
            synced_to=day,
            raw_payload={"Nguồn đồng bộ": "NAZZY", "Mã NPP": mai_gold.code},
        ),
    ])
    db.flush()

    result = _product_distributors(db, {"SKU-VNM", "SKU-NAZ"})

    assert result["SKU-VNM"] == [{"code": "NPP-TRUNGDONG", "name": "Trung Dong"}]
    assert result["SKU-NAZ"] == [{"code": "NPP-MAIGOLD", "name": "Mai Gold"}]


def test_order_list_works_when_legacy_customers_table_lacks_phone_column(db):
    day = date(2026, 11, 16)
    customer = db.scalar(select(Customer).where(Customer.code == "0MD"))
    customer.store = Store(code="STORE-0MD", name="Cửa hàng Nam Thúy")
    db.add(VinamilkOrderSnapshot(
        remote_key="legacy-customer-schema",
        order_number="LEGACY-1",
        product_code="01VD41",
        customer_code="0MD",
        customer_name="Nam thúy 1",
        order_created_date=day,
        synced_from=day,
        synced_to=day,
        raw_payload={"orderNumber": "LEGACY-1", "productCode": "01VD41", "customerCode": "0MD"},
    ))
    db.commit()
    db.connection().exec_driver_sql("ALTER TABLE customers DROP COLUMN phone")

    result = list_grouped_vinamilk_orders(day, day, skip=0, limit=20, db=db)

    assert result["total"] == 1
    assert result["rows"][0]["Cửa Hàng"] == "Cửa hàng Nam Thúy"


def test_grouped_order_keeps_all_lines_across_snapshot_pages(db):
    day = date(2026, 11, 4)
    db.add_all([
        VinamilkOrderSnapshot(
            remote_key=f"large-{index}", order_number="LARGE", product_code="01VD41",
            order_created_date=day, synced_from=day, synced_to=day,
            raw_payload={"productCode": "01VD41", "totalValue": 10, "totalDiscount": 1},
        )
        for index in range(2001)
    ])
    db.flush()
    result = list_grouped_vinamilk_orders(day, day, skip=0, limit=20, db=db)
    assert result["total"] == 1
    assert result["rows"][0]["orderNumber"] == "LARGE"
    assert result["rows"][0]["_product_count"] == 2001
    assert result["rows"][0]["totalValue"] == 20010
    assert result["rows"][0]["totalDiscount"] == 2001


def test_grouped_order_keeps_order_level_discount_separate_from_line_discounts(db):
    day = date(2026, 11, 16)
    lines = (
        ("NCNAK180-001", 12, 396000, 4752000),
        ("NCNSHDD180-001", 240, 360000, 86400000),
    )
    for index, (product_code, quantity, unit_price, total_value) in enumerate(lines):
        db.add(VinamilkOrderSnapshot(
            remote_key=f"nazzy-discount-{index}",
            order_number="26113454",
            product_code=product_code,
            order_created_date=day,
            synced_from=day,
            synced_to=day,
            raw_payload={
                "Số đơn hàng": "26113454",
                "Mã sản phẩm": product_code,
                "Số lượng": quantity,
                "Giá bán": unit_price,
                "Giá trị": total_value,
                "Số tiền CK": 1251 if index == 0 else 22749,
                "Chiết khấu đơn hàng": 24000,
            },
        ))
    db.flush()

    result = list_grouped_vinamilk_orders(day, day, skip=0, limit=20, db=db)

    assert result["total"] == 1
    assert result["rows"][0]["totalValue"] == 91152000
    assert result["rows"][0]["totalDiscount"] == 24000
    assert result["total_value"] == 91152000
    assert result["total_discount"] == 24000


def test_order_list_shows_store_from_customer_code(db):
    customer = db.scalar(select(Customer).where(Customer.code == "0MD"))
    customer.store = Store(code="STORE-0MD", name="Cửa hàng Nam Thúy")
    db.commit()
    _create_manual_order(db, _payload(), performed_by="admin")

    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    assert response["rows"][0]["Cửa Hàng"] == "Cửa hàng Nam Thúy"
    assert response["rows"][0]["Cửa Hàng"] == "Cửa hàng Nam Thúy"


def test_order_list_resolves_store_from_full_customer_code_suffix(db):
    customer = Customer(
        code="0HX",
        name="Mẹ và bé An Hùng",
        type="RETAIL",
        store=Store(code="STORE-0HX", name="Cửa hàng An Hùng"),
    )
    db.add(customer)
    db.commit()
    result = _create_manual_order(db, _payload(), performed_by="admin")
    snapshot = db.scalar(
        select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"])
    )
    snapshot.customer_code = "MG200310HX"
    snapshot.customer_name = customer.name
    snapshot.raw_payload = {**snapshot.raw_payload, "Mã KH": "MG200310HX"}
    db.commit()

    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )

    assert response["rows"][0]["Mã KH"] == "MG200310HX"
    assert response["rows"][0]["Cửa Hàng"] == "Cửa hàng An Hùng"


def test_order_list_resolves_manager_by_last_three_customer_code_characters(db):
    db.add(Customer(
        code="IMV",
        name="Khách hàng khớp hậu tố",
        type="RETAIL",
        manager_code="NV002",
        manager_name="Trần Bình",
    ))
    db.add(VinamilkOrderSnapshot(
        remote_key="manager-suffix-order",
        order_number="VM-MANAGER-SUFFIX",
        customer_code="MG20031IMV",
        order_created_date=date(2026, 11, 4),
        synced_from=date(2026, 11, 4),
        synced_to=date(2026, 11, 4),
        raw_payload={"orderNumber": "VM-MANAGER-SUFFIX", "customerCode": "MG20031IMV"},
    ))
    db.commit()

    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    order = next(row for row in response["rows"] if row["orderNumber"] == "VM-MANAGER-SUFFIX")
    assert order["Mã NVQL"] == "NV002"
    assert order["Tên NVQL"] == "Trần Bình"


def test_customer_manager_assignment_requires_existing_nv_employee(db):
    db.add_all([
        Employee(code="NV003", name="Lê Cường", position="Quản lý", phone=""),
        Employee(code="KT01", name="Vũ Thị Lê", position="Kế toán", phone=""),
    ])
    db.commit()

    customer = customer_crud.create(
        db,
        CustomerCreate(code="MGR-1", name="Khách hàng quản lý", manager_code="nv003"),
    )
    assert customer.manager_code == "NV003"
    assert customer.manager_name == "Lê Cường"

    customer_kt = customer_crud.create(
        db,
        CustomerCreate(code="MGR-KT", name="Khách hàng KT quản lý", manager_code="kt01"),
    )
    assert customer_kt.manager_code == "KT01"
    assert customer_kt.manager_name == "Vũ Thị Lê"

    with pytest.raises(ValueError, match="Không tìm thấy nhân viên"):
        customer_crud.create(
            db,
            CustomerCreate(code="MGR-2", name="Mã không tồn tại", manager_code="AB001"),
        )


def test_order_list_separates_processing_and_warehouse_request_statuses(db):
    warehouse = Warehouse(code="W1", name="Kho chính", location="Hà Nội")
    db.add(warehouse)
    db.flush()

    statuses = {
        "TC-REQUESTED": "DRAFT",
        "TC-APPROVED": "SUBMITTED",
        "TC-RECEIVING": "RECEIVED",
        "TC-EXPORTED": "COMPLETED",
        "TC-CANCELLED": "CANCELLED",
    }
    expected_delivery_statuses = {
        "TC-NONE": "Chưa yêu cầu",
        "TC-PENDING": "Chưa yêu cầu",
        "TC-REQUESTED": "Chờ Admin duyệt",
        "TC-APPROVED": "Đã duyệt - chờ kho nhận",
        "TC-RECEIVING": "Đã nhận - đang xuất kho",
        "TC-EXPORTED": "Đã xuất kho",
        "TC-CANCELLED": "Đã hủy yêu cầu",
    }
    order_numbers = ["TC-NONE", "TC-PENDING", *statuses]
    for order_number in order_numbers:
        db.add(VinamilkOrderSnapshot(
            remote_key=f"key-{order_number}",
            order_number=order_number,
            order_created_date=date(2026, 11, 4),
            synced_from=date(2026, 11, 4),
            synced_to=date(2026, 11, 4),
            processing_status="Đơn Tách" if order_number == "TC-NONE" else None,
            warehouse_updated=order_number == "TC-NONE",
            raw_payload={"orderNumber": order_number},
        ))
    db.flush()

    for order_number, status in statuses.items():
        request = DeliveryRequest(
            code=f"YC-{order_number}",
            warehouse_id=warehouse.id,
            status=status,
        )
        db.add(request)
        db.flush()
        db.add(DeliveryRequestOrder(
            delivery_request_id=request.id,
            order_number=order_number,
            employee_code="NV001",
        ))
    db.flush()

    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4),
        to_date=date(2026, 11, 4),
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=100,
        db=db,
    )
    rows_by_order = {row["orderNumber"]: row for row in response["rows"]}

    for order_number, expected in expected_delivery_statuses.items():
        assert rows_by_order[order_number]["Tình trạng xuất kho"] == expected
    assert rows_by_order["TC-NONE"]["Tình trạng xử lý đơn hàng"] == "Đơn Tách"
    assert rows_by_order["TC-NONE"]["Trạng thái xử lý"] == "Đơn Tách"
    assert rows_by_order["TC-NONE"]["_warehouse_updated"] is True
    assert rows_by_order["TC-PENDING"]["Tình trạng xử lý đơn hàng"] == "Chưa xử lý"


def test_admin_approval_is_required_and_recorded(db):
    warehouse = Warehouse(code="APPROVAL", name="Approval test warehouse", location="Test")
    db.add(warehouse)
    db.flush()
    request = DeliveryRequest(code="YC-APPROVAL-TEST", warehouse_id=warehouse.id, status="DRAFT")
    db.add(request)
    db.commit()

    with pytest.raises(HTTPException) as error:
        submit_request(
            request.id,
            db,
            SimpleNamespace(username="warehouse", roles=[]),
        )
    assert error.value.status_code == 403

    approved = submit_request(
        request.id,
        db,
        SimpleNamespace(username="supervisor", roles=[SimpleNamespace(name="Admin")]),
    )

    assert approved.status == "SUBMITTED"
    assert approved.approved_by == "supervisor"
    assert approved.approved_at is not None
    assert approved.submitted_at is not None


def test_manual_order_rejects_unknown_customer_or_product(db):
    with pytest.raises(HTTPException):
        _create_manual_order(db, _payload(customer_code="KHONGCO"))
    with pytest.raises(HTTPException):
        _create_manual_order(db, _payload(lines=[ManualOrderLine(product_code="XXX", quantity=1)]))


def test_delete_manual_order(db):
    _create_manual_order(db, _payload())
    assert _delete_manual_order(db, "TC-261104-001")["deleted_lines"] == 1
    with pytest.raises(HTTPException):
        _delete_manual_order(db, "IN062823")


def test_get_and_update_manual_order(db):
    shipper = Employee(code="NV025", name="Giao Hàng Sửa", position="Giao hàng", phone="0900000025")
    db.add(shipper)
    db.commit()

    created = _create_manual_order(db, _payload(note="Bản đầu"), performed_by="admin")
    order_number = created["order_number"]

    detail = _get_manual_order_detail(db, order_number)
    assert detail["order_number"] == order_number
    assert detail["customer_code"] == "0MD"
    assert detail["note"] == "Bản đầu"
    assert detail["can_edit"] is True
    assert len(detail["lines"]) == 1
    assert detail["lines"][0]["quantity"] == 10

    updated = _update_manual_order(
        db,
        order_number,
        _payload(
            order_type="002-Dương Số",
            delivery_employee_code="NV025",
            note="Đã chỉnh sửa",
            lines=[ManualOrderLine(product_code="01VD41", quantity=20, discount_amount=1000)],
        ),
        performed_by="ketoan",
    )
    assert updated["order_number"] == order_number
    assert updated["total_value"] == 4428 * 20 - 1000

    after = _get_manual_order_detail(db, order_number)
    assert after["order_type"] == "002-Dương Số"
    assert after["delivery_employee_code"] == "NV025"
    assert after["note"] == "Đã chỉnh sửa"
    assert after["lines"][0]["quantity"] == 20

    # Chặn sửa đơn không phải tự tạo
    with pytest.raises(HTTPException) as non_manual_err:
        _update_manual_order(db, "IN062823", _payload())
    assert non_manual_err.value.status_code == 400

    # Chặn sửa khi đã đưa vào yêu cầu xuất hàng chưa hủy
    warehouse = Warehouse(code="WH-EDIT-LOCK", name="Kho Sửa", location="HN")
    db.add(warehouse)
    db.flush()
    req = DeliveryRequest(code="YC-EDIT-LOCK", warehouse_id=warehouse.id, status="DRAFT")
    db.add(req)
    db.flush()
    db.add(DeliveryRequestOrder(delivery_request_id=req.id, order_number=order_number, employee_code="NV025"))
    db.commit()

    locked_detail = _get_manual_order_detail(db, order_number)
    assert locked_detail["can_edit"] is False
    with pytest.raises(HTTPException) as locked_err:
        _update_manual_order(db, order_number, _payload())
    assert locked_err.value.status_code == 400


def test_bulk_delete_orders_deletes_selected_and_blocks_active_delivery(db):
    day = date(2026, 11, 4)
    manual = _create_manual_order(db, _payload(), performed_by="admin")
    db.add_all([
        VinamilkOrderSnapshot(
            remote_key="bulk-del-1",
            order_number="DMS-WRONG-01",
            customer_code="0MD",
            product_code="01VD41",
            order_created_date=day,
            synced_from=day,
            synced_to=day,
            raw_payload={"Số đơn hàng": "DMS-WRONG-01"},
        ),
        VinamilkOrderSnapshot(
            remote_key="bulk-del-2",
            order_number="DMS-LOCKED-02",
            customer_code="0MD",
            product_code="01VD41",
            order_created_date=day,
            synced_from=day,
            synced_to=day,
            raw_payload={"Số đơn hàng": "DMS-LOCKED-02"},
        ),
    ])
    warehouse = Warehouse(code="WH-BULK-DEL", name="Kho", location="HN")
    db.add(warehouse)
    db.flush()
    req = DeliveryRequest(code="YC-BULK-DEL", warehouse_id=warehouse.id, status="DRAFT")
    db.add(req)
    db.flush()
    db.add(DeliveryRequestOrder(delivery_request_id=req.id, order_number="DMS-LOCKED-02", employee_code="NV001"))
    db.commit()

    # Chặn nếu trong danh sách chọn có đơn đang nằm trong YCXH
    with pytest.raises(HTTPException) as err:
        _bulk_delete_orders(db, BulkDeleteOrdersRequest(orders=[
            BulkDeleteOrderTarget(order_number="DMS-WRONG-01"),
            BulkDeleteOrderTarget(order_number="DMS-LOCKED-02"),
        ]))
    assert err.value.status_code == 400
    assert "DMS-LOCKED-02" in str(err.value.detail)

    # Xóa thành công cả đơn tự tạo lẫn đơn đồng bộ sai
    res = _bulk_delete_orders(db, BulkDeleteOrdersRequest(orders=[
        BulkDeleteOrderTarget(order_number=manual["order_number"]),
        BulkDeleteOrderTarget(order_number="DMS-WRONG-01"),
    ]))
    assert res["deleted_count"] == 2
    assert set(res["deleted_orders"]) == {manual["order_number"], "DMS-WRONG-01"}
    remaining = db.scalars(select(VinamilkOrderSnapshot.order_number)).all()
    assert remaining == ["DMS-LOCKED-02"]


def test_manual_order_defaults_staff_to_current_user_and_records_delivery_employee(db):
    seller = Employee(code="NV010", name="Người Bán", position="Nhân viên kinh doanh", phone="0900000010")
    shipper = Employee(code="NV020", name="Người Giao", position="Giao hàng", phone="0900000020")
    db.add_all([seller, shipper])
    db.commit()

    result = _create_manual_order(
        db,
        _payload(delivery_employee_code="nv020"),
        performed_by="nv010",
        current_employee=seller,
    )
    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"]))
    assert row.raw_payload["Mã NVBH"] == "NV010"
    assert row.raw_payload["Tên NVBH"] == "Người Bán"
    assert row.raw_payload["Mã NVGH"] == "NV020"
    assert row.raw_payload["Tên NVGH"] == "Người Giao"
    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    assert response["rows"][0]["NVGH"] == "NV020 - Người Giao"
    assert response["rows"][0]["Mã NVGH"] == "NV020"
    warehouse = Warehouse(code="WH-MANUAL-NVGH", name="Kho", location="Kho")
    db.add(warehouse)
    db.flush()
    request = DeliveryRequest(code="YC-MANUAL-NVGH", warehouse_id=warehouse.id, status="SUBMITTED")
    db.add(request)
    db.flush()
    db.add(DeliveryRequestOrder(
        delivery_request_id=request.id, order_number=result["order_number"],
        employee_code="NV030", employee_name="Người khác",
    ))
    db.flush()
    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    assert response["rows"][0]["NVGH"] == "NV020 - Người Giao"


def test_order_list_shows_only_approved_delivery_assignments(db):
    warehouse = Warehouse(code="WH-NVGH", name="Kho", location="Kho")
    db.add(warehouse)
    db.flush()
    for number in ("VM-A", "VM-B", "VM-C", "VM-D"):
        db.add(VinamilkOrderSnapshot(
            remote_key=f"nvgh-{number}", order_number=number,
            order_created_date=date(2026, 11, 4), synced_from=date(2026, 11, 4),
            synced_to=date(2026, 11, 4), raw_payload={"orderNumber": number},
        ))
    for index, (number, status, code, name, order_date) in enumerate([
        ("VM-A", "DRAFT", "NV001", "Chưa duyệt", None),
        ("VM-A", "SUBMITTED", "NV002", "Đã duyệt", date(2026, 11, 4)),
        ("VM-A", "CANCELLED", "NV003", "Đã hủy", None),
        ("VM-A", "COMPLETED", "NV004", "Khác ngày", date(2026, 11, 3)),
        ("VM-B", "DRAFT", "NV001", "Chưa duyệt", None),
        ("VM-C", "RECEIVED", "NV005", "Một", None),
        ("VM-C", "COMPLETED", "NV006", "Hai", None),
        ("VM-D", "CANCELLED", "NV007", "Đã hủy", None),
    ]):
        request = DeliveryRequest(code=f"YC-NVGH-{index}", warehouse_id=warehouse.id, status=status)
        db.add(request)
        db.flush()
        db.add(DeliveryRequestOrder(
            delivery_request_id=request.id, order_number=number,
            order_date=order_date, employee_code=code, employee_name=name,
        ))
    db.flush()
    response = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    rows = {row["orderNumber"]: row for row in response["rows"]}
    assert rows["VM-A"]["NVGH"] == "NV002 - Đã duyệt"
    assert rows["VM-A"]["Mã NVGH"] == "NV002"
    assert rows["VM-B"]["NVGH"] == rows["VM-D"]["NVGH"] == ""
    assert rows["VM-C"]["NVGH"] == "NV005 - Một, NV006 - Hai"
    assert rows["VM-C"]["Mã NVGH"] == ""


def test_split_delivery_employee_survives_approval_and_delivery_override(db):
    shipper = Employee(code="NV020", name="Người Giao", position="Giao hàng", phone="0900000020")
    source = VinamilkOrderSnapshot(
        remote_key="split-nvgh", order_number="VM-SPLIT",
        customer_code="0MD", customer_name="Khách hàng", product_code="01VD41", product_name="SP",
        order_created_date=date(2026, 11, 4), synced_from=date(2026, 11, 4), synced_to=date(2026, 11, 4),
        raw_payload={"orderNumber": "VM-SPLIT", "quantity": 2, "totalValue": 200,
                     "Mã NVGH": "NV099", "Tên NVGH": "Không kế thừa"},
    )
    db.add_all([shipper, source])
    db.flush()
    payload = SplitOrderRequest(order_number="VM-SPLIT", splits=[
        SplitOrderTarget(customer_code="0MD", delivery_employee_code="nv020",
                         items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=1)]),
        SplitOrderTarget(customer_code="OTHER",
                         items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=1)]),
    ])
    request = _create_split_order_request(db, payload, requested_by="admin")
    assert request["preview"]["splits"][0]["delivery_employee_code"] == "NV020"
    assert request["preview"]["splits"][0]["delivery_employee_name"] == "Người Giao"
    assert request["preview"]["splits"][1]["delivery_employee_code"] == ""
    _approve_split_order_request(db, request["id"], reviewed_by="admin")

    def rows():
        result = list_local_vinamilk_orders(
            from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
            search=None, status=None, skip=0, limit=100, db=db,
        )
        return {row["Số đơn hàng"]: row for row in result["rows"] if row.get("Số đơn hàng")}

    assert rows()["TD-VM-SPLIT-01"]["NVGH"] == "NV020 - Người Giao"
    assert rows()["TD-VM-SPLIT-02"]["NVGH"] == ""
    warehouse = Warehouse(code="WH-SPLIT", name="Kho", location="Kho")
    db.add(warehouse)
    db.flush()
    delivery = DeliveryRequest(code="YC-SPLIT", warehouse_id=warehouse.id, status="SUBMITTED")
    db.add(delivery)
    db.flush()
    db.add(DeliveryRequestOrder(delivery_request_id=delivery.id, order_number="TD-VM-SPLIT-01",
                                employee_code="NV030", employee_name="Người khác"))
    db.flush()
    assert rows()["TD-VM-SPLIT-01"]["NVGH"] == "NV030 - Người khác"
    delivery.status = "CANCELLED"
    db.flush()
    assert rows()["TD-VM-SPLIT-01"]["NVGH"] == "NV020 - Người Giao"


def test_split_rejects_invalid_delivery_employee(db):
    source = VinamilkOrderSnapshot(
        remote_key="split-invalid", order_number="VM-INVALID", customer_code="0MD",
        product_code="01VD41", order_created_date=date(2026, 11, 4),
        synced_from=date(2026, 11, 4), synced_to=date(2026, 11, 4),
        raw_payload={"quantity": 1},
    )
    db.add(source)
    db.flush()
    payload = SplitOrderRequest(order_number="VM-INVALID", splits=[
        SplitOrderTarget(customer_code="OTHER", delivery_employee_code="NV999",
                         items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=1)])
    ])
    with pytest.raises(HTTPException, match="NVGH đang hoạt động"):
        _create_split_order_request(db, payload)


def test_merge_delivery_employee_persists_on_all_lines_and_follows_delivery_status(db):
    shipper = Employee(code="NV020", name="Người Giao", position="Giao hàng", phone="0900000020")
    db.add(shipper)
    for index in range(2):
        db.add(VinamilkOrderSnapshot(
            remote_key=f"merge-delivery-{index}", order_number=f"VM-MERGE-{index}",
            customer_code="0MD", customer_name="Khách hàng", product_code=f"SP-{index}",
            order_created_date=date(2026, 11, 4), synced_from=date(2026, 11, 4),
            synced_to=date(2026, 11, 4),
            raw_payload={"quantity": 1, "Mã NVGH": "NV099", "Tên NVGH": "Không kế thừa"},
        ))
    db.flush()
    result = _merge_vinamilk_orders(db, MergeOrdersRequest(
        order_numbers=["VM-MERGE-0", "VM-MERGE-1"], delivery_employee_code="nv020",
    ))
    number = result["new_order_number"]
    snapshots = db.scalars(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == number)).all()
    assert len(snapshots) == 2
    assert all(row.raw_payload["Mã NVGH"] == "NV020" and row.raw_payload["Tên NVGH"] == "Người Giao" for row in snapshots)

    def merged_rows():
        response = list_local_vinamilk_orders(
            from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
            search=None, status=None, skip=0, limit=100, db=db,
        )
        rows = [row for row in response["rows"] if row.get("Số đơn hàng") == number]
        assert len(rows) == 2
        return rows

    assert all(row["NVGH"] == "NV020 - Người Giao" for row in merged_rows())
    warehouse = Warehouse(code="WH-MERGE", name="Kho", location="Kho")
    db.add(warehouse)
    db.flush()
    delivery = DeliveryRequest(code="YC-MERGE", warehouse_id=warehouse.id, status="DRAFT")
    db.add(delivery)
    db.flush()
    db.add(DeliveryRequestOrder(delivery_request_id=delivery.id, order_number=number,
                                employee_code="NV030", employee_name="Người khác"))
    db.flush()
    assert all(row["NVGH"] == "NV020 - Người Giao" for row in merged_rows())
    delivery.status = "SUBMITTED"
    db.flush()
    assert all(row["NVGH"] == "NV030 - Người khác" for row in merged_rows())
    delivery.status = "CANCELLED"
    db.flush()
    assert all(row["NVGH"] == "NV020 - Người Giao" for row in merged_rows())


@pytest.mark.parametrize("employee_code", ["NV999", "NV021", "KT001"])
def test_merge_rejects_invalid_delivery_employee(db, employee_code):
    db.add_all([
        Employee(code="NV021", name="Ngừng hoạt động", position="Giao hàng", status="inactive", phone="0900000021"),
        Employee(code="KT001", name="Kế toán", position="Kế toán", status="active", phone="0900000022"),
    ])
    for index in range(2):
        db.add(VinamilkOrderSnapshot(
            remote_key=f"merge-invalid-{index}", order_number=f"VM-INVALID-{index}",
            customer_code="0MD", product_code="01VD41", order_created_date=date(2026, 11, 4),
            synced_from=date(2026, 11, 4), synced_to=date(2026, 11, 4), raw_payload={"quantity": 1},
        ))
    db.flush()
    with pytest.raises(HTTPException, match="NVGH đang hoạt động"):
        _merge_vinamilk_orders(db, MergeOrdersRequest(
            order_numbers=["VM-INVALID-0", "VM-INVALID-1"], delivery_employee_code=employee_code,
        ))
    assert db.scalar(select(VinamilkOrderSnapshot.id).where(VinamilkOrderSnapshot.is_synthetic.is_(True))) is None


@pytest.mark.parametrize("automatic", [True, False])
def test_split_shortage_is_assigned_to_selected_delivery_employee(db, automatic):
    shipper = Employee(code="NV020", name="Người Giao", position="Giao hàng", phone="0900000020")
    source = VinamilkOrderSnapshot(
        remote_key="split-shortage", order_number="VM-SHORT",
        customer_code="0MD", customer_name="Khách hàng", product_code="01VD41",
        order_created_date=date(2026, 11, 4), synced_from=date(2026, 11, 4), synced_to=date(2026, 11, 4),
        raw_payload={"quantity": 10, "promotionQuantity": 2, "totalValue": 1000,
                     "Mã NVBH": "SALE01", "Tên NVBH": "Người Bán"},
    )
    db.add_all([shipper, source])
    db.flush()
    targets = [SplitOrderTarget(
        customer_code="0MD", items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=6, promo_quantity=1)]
    )]
    if not automatic:
        targets.append(SplitOrderTarget(
            is_staff_debt=True, debt_target="DELIVERY", delivery_employee_code="nv020",
            customer_code="NVBH-SALE01", customer_name="Sai đối tượng",
            items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=4, promo_quantity=1)],
        ))
    payload = SplitOrderRequest(
        order_number="VM-SHORT", splits=targets, auto_assign_remainder_to_delivery=automatic,
        remainder_delivery_employee_code="nv020" if automatic else None,
    )
    request = _create_split_order_request(db, payload, requested_by="admin")
    shortage = request["preview"]["splits"][1]
    assert shortage["customer_code"] == "NVGH-NV020"
    assert "Người Giao" in shortage["customer_name"]
    assert shortage["delivery_employee_code"] == "NV020"
    assert shortage["status_label"] == "Đơn Tách (Nợ NVGH)"
    assert shortage["total_qty"] == 4
    assert shortage["total_promo_qty"] == 1
    _approve_split_order_request(db, request["id"], reviewed_by="accountant")

    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == "TD-VM-SHORT-02"))
    assert row.customer_code == "NVGH-NV020"
    assert row.raw_payload["Mã NVGH"] == "NV020"
    assert row.raw_payload["Mã NVBH"] == "SALE01"
    listed = list_local_vinamilk_orders(
        from_date=date(2026, 11, 4), to_date=date(2026, 11, 4), source="sync",
        search=None, status=None, skip=0, limit=100, db=db,
    )
    shortage_row = next(row for row in listed["rows"] if row["orderNumber"] == "TD-VM-SHORT-02")
    assert shortage_row["NVGH"] == "NV020 - Người Giao"
    assert shortage_row["_processing_status"] == "Đơn Tách (Nợ NVGH)"


@pytest.mark.parametrize("mode", ["automatic", "explicit", "all_missing"])
def test_delivery_recipient_is_separate_normal_order(db, mode):
    shipper = Employee(code="NV020", name="Người Giao", position="Giao hàng", phone="0900000020")
    source = VinamilkOrderSnapshot(
        remote_key="split-new-delivery", order_number="VM-NEW-DELIVERY",
        customer_code="0MD", customer_name="Khách hàng", product_code="01VD41",
        order_created_date=date(2026, 11, 4), synced_from=date(2026, 11, 4), synced_to=date(2026, 11, 4),
        raw_payload={"quantity": 2400, "promotionQuantity": 24, "totalValue": 240000,
                     "totalDiscount": 24000, "Mã NVBH": "SALE01",
                     "_order_type": "002-Dương Số",
                     "Trạng thái tạo đơn": "002-Dương Số", "orderType": "002-Dương Số"},
    )
    db.add_all([shipper, source])
    db.flush()
    targets = [] if mode == "all_missing" else [SplitOrderTarget(
        customer_code="0MD", items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=1200, promo_quantity=12)]
    )]
    if mode == "explicit":
        targets.append(SplitOrderTarget(
            delivery_recipient=True, delivery_employee_code="nv020",
            items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=1200, promo_quantity=12)],
        ))
    payload = SplitOrderRequest(
        order_number="VM-NEW-DELIVERY", splits=targets,
        auto_assign_remainder_to_delivery_customer=mode != "explicit",
        remainder_delivery_employee_code="nv020" if mode != "explicit" else None,
    )
    request = _create_split_order_request(db, payload)
    splits = request["preview"]["splits"]
    assert len(splits) == (1 if mode == "all_missing" else 2)
    recipient = splits[-1]
    assert recipient["customer_code"] == "NVGH-NV020"
    assert recipient["delivery_recipient"] is True
    assert recipient["is_staff_debt"] is False
    assert recipient["status_label"] == "Đơn Tách"
    _approve_split_order_request(db, request["id"])
    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == recipient["new_order_number"]))
    assert row.customer_code == "NVGH-NV020"
    assert row.raw_payload["quantity"] == (2400 if mode == "all_missing" else 1200)
    assert row.raw_payload["Mã NVGH"] == "NV020"
    assert row.raw_payload["_is_staff_debt"] is False
    assert row.raw_payload["_delivery_recipient"] is True
    assert row.raw_payload["_order_type"] == row.raw_payload["orderType"] == row.raw_payload["Trạng thái tạo đơn"] == "001-Xuất hàng"
    assert row.raw_payload["Mã NVBH"] == "SALE01"


@pytest.mark.parametrize("code", [None, "NV999"])
def test_new_delivery_recipient_requires_valid_employee(db, code):
    db.add(VinamilkOrderSnapshot(
        remote_key="all-missing-invalid", order_number="VM-ALL-MISSING", product_code="01VD41",
        order_created_date=date(2026, 11, 4), synced_from=date(2026, 11, 4), synced_to=date(2026, 11, 4),
        raw_payload={"quantity": 2400},
    ))
    db.flush()
    with pytest.raises(HTTPException, match="NVGH"):
        _create_split_order_request(db, SplitOrderRequest(
            order_number="VM-ALL-MISSING", splits=[], auto_assign_remainder_to_delivery_customer=True,
            remainder_delivery_employee_code=code,
        ))


@pytest.mark.parametrize("automatic,employee_code", [
    (True, None), (True, "NV999"), (False, None), (False, "NV999"), (True, "NV021"), (False, "NV021"),
])
def test_split_shortage_requires_active_delivery_employee(db, automatic, employee_code):
    db.add(Employee(code="NV021", name="Ngừng hoạt động", position="Giao hàng", status="inactive", phone="0900000021"))
    source = VinamilkOrderSnapshot(
        remote_key="invalid-shortage", order_number="VM-SHORT-INVALID", customer_code="0MD",
        product_code="01VD41", order_created_date=date(2026, 11, 4),
        synced_from=date(2026, 11, 4), synced_to=date(2026, 11, 4), raw_payload={"quantity": 2},
    )
    db.add(source)
    db.flush()
    target = SplitOrderTarget(
        customer_code="OTHER", is_staff_debt=not automatic, debt_target=None if automatic else "DELIVERY",
        delivery_employee_code=None if automatic else employee_code,
        items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=1)],
    )
    payload = SplitOrderRequest(
        order_number="VM-SHORT-INVALID", splits=[target], auto_assign_remainder_to_delivery=automatic,
        remainder_delivery_employee_code=employee_code if automatic else None,
    )
    with pytest.raises(HTTPException, match="NVGH"):
        _create_split_order_request(db, payload)


def test_manual_order_rejects_unknown_delivery_employee(db):
    with pytest.raises(HTTPException) as exc:
        _create_manual_order(db, _payload(delivery_employee_code="NV999"), performed_by="admin")
    assert exc.value.status_code == 404


def test_manual_order_applies_promotion_server_side_and_saves_entry_metadata(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    product.boxes_per_carton = 10
    promotion = Promotion(
        code="KM-TEST-001",
        name="Mua thùng tặng hộp",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[
            PromotionRule(
                trigger_type="QUANTITY",
                quantity_unit="CARTON",
                min_cartons=1,
                min_quantity=1,
                min_qty=1,
                reward_type="FREE_QUANTITY",
                reward_value=2,
                free_quantity=2,
                reward_unit="CARTON",
            )
        ],
    )
    db.add(promotion)
    db.commit()
    result = _create_manual_order(
        db,
        _payload(
            order_date=date(2026, 11, 4),
            entry_date=date(2026, 11, 5),
            sales_route="Tuyến A",
            lines=[
                ManualOrderLine(
                    product_code="01VD41",
                    quantity=10,
                    promo_quantity=999,
                    discount_amount=999999,
                    promotion_id=promotion.id,
                )
            ],
        ),
    )

    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"]))
    assert row.raw_payload["Mã CTKM"] == "KM-TEST-001"
    assert row.raw_payload["Tên CTKM"] == "Mua thùng tặng hộp"
    assert row.raw_payload["Số lượng KM"] == 20
    assert row.raw_payload["Số tiền CK"] == ""
    assert row.raw_payload["Ngày nhập"] == "05/11/2026"
    assert row.raw_payload["Tuyến bán hàng"] == "Tuyến A"


def test_manual_order_uses_registered_reward_products_and_quantities(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    product.boxes_per_carton = 10
    category = db.scalar(select(ProductCategory).where(ProductCategory.code == "SUA"))
    unit = db.scalar(select(ProductUnit).where(ProductUnit.code == "HOP"))
    reward_products = [
        Product(sku="GIFT-A", name="Quà A", category_id=category.id, unit_id=unit.id,
                supplier="Vinamilk", base_price=100, boxes_per_carton=1),
        Product(sku="GIFT-ALT", name="Quà thay thế", category_id=category.id, unit_id=unit.id,
                supplier="Vinamilk", base_price=200, boxes_per_carton=12),
        Product(sku="GIFT-B", name="Quà B", category_id=category.id, unit_id=unit.id,
                supplier="Vinamilk", base_price=300, boxes_per_carton=1),
    ]
    db.add_all(reward_products)
    db.flush()
    promotion = Promotion(
        code="KM-TEST-GIFTS",
        name="Quà đăng ký theo nhóm",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[
            PromotionRule(
                trigger_type="QUANTITY",
                quantity_unit="CARTON",
                min_cartons=1,
                min_quantity=1,
                min_qty=1,
                reward_type="FREE_QUANTITY",
                reward_value=99,
                free_quantity=99,
                reward_product_links=[
                    PromotionRuleRewardProduct(
                        product_id=reward_products[0].id, group_index=0, quantity=2, unit="BOX",
                    ),
                    PromotionRuleRewardProduct(
                        product_id=reward_products[1].id, group_index=0, quantity=1, unit="CARTON",
                    ),
                    PromotionRuleRewardProduct(
                        product_id=reward_products[2].id, group_index=1, quantity=3, unit="BOX",
                    ),
                ],
            )
        ],
    )
    db.add(promotion)
    db.commit()

    result = _create_manual_order(
        db,
        _payload(lines=[
            ManualOrderLine(
                product_code="01VD41",
                quantity=10,
                promo_quantity=999,
                promotion_id=promotion.id,
            )
        ]),
    )

    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"]))
    assert row.raw_payload["Số lượng KM"] == 5
    assert row.raw_payload["Sản phẩm khuyến mãi"] == [
        {
            "product_id": reward_products[0].id,
            "product_code": "GIFT-A",
            "product_name": "Quà A",
            "quantity": 2,
            "unit": "BOX",
            "group_index": 0,
        },
        {
            "product_id": reward_products[2].id,
            "product_code": "GIFT-B",
            "product_name": "Quà B",
            "quantity": 3,
            "unit": "BOX",
            "group_index": 1,
        },
    ]


def test_manual_order_rejects_locked_promotion(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    promotion = Promotion(
        code="KM-TEST-LOCK",
        name="Đã khóa",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30),
        is_active=True,
        is_locked=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[PromotionRule(
            trigger_type="QUANTITY",
            quantity_unit="CARTON",
            min_cartons=1,
            min_quantity=1,
            min_qty=1,
            reward_type="FREE_QUANTITY",
            reward_value=1,
        )],
    )
    db.add(promotion)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        _create_manual_order(
            db,
            _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=1, promotion_id=promotion.id)]),
        )
    assert exc.value.status_code == 400


def test_manual_order_rejects_promotion_with_unsupported_total_amount_basis(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    promotion = Promotion(
        code="KM-TEST-INVOICE",
        name="Tổng hóa đơn chưa hỗ trợ",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        promotion_kind="INVOICE_AMOUNT",
        items=[PromotionItem(product_id=product.id)],
        rules=[PromotionRule(
            trigger_type="AMOUNT",
            min_amount=50000,
            reward_type="DISCOUNT_AMOUNT",
            reward_value=1000,
        )],
    )
    db.add(promotion)
    db.commit()

    with pytest.raises(HTTPException, match="kiểu tính khuyến mại chưa được hỗ trợ"):
        _create_manual_order(
            db,
            _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=10, promotion_id=promotion.id)]),
        )


def test_manual_order_enforces_minimum_number_of_qualifying_products(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    second_product = Product(
        sku="02VD41",
        name="Sản phẩm thứ hai",
        category_id=product.category_id,
        unit_id=product.unit_id,
        supplier=product.supplier,
        base_price=1000,
    )
    db.add(second_product)
    db.flush()
    promotion = Promotion(
        code="KM-TEST-MIN-PRODUCTS",
        name="Hai sản phẩm áp dụng",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        minimum_product_quantity=2,
        items=[
            PromotionItem(product_id=product.id, min_quantity=2),
            PromotionItem(product_id=second_product.id, min_quantity=2),
        ],
        rules=[PromotionRule(
            trigger_type="QUANTITY",
            quantity_unit="BOX",
            min_quantity=1,
            min_qty=1,
            reward_type="DISCOUNT_AMOUNT",
            reward_value=100,
        )],
    )
    db.add(promotion)
    db.commit()

    with pytest.raises(HTTPException, match="chưa đủ số lượng sản phẩm áp dụng"):
        _create_manual_order(
            db,
            _payload(lines=[
                ManualOrderLine(product_code="01VD41", quantity=2, promotion_id=promotion.id),
            ]),
        )
    result = _create_manual_order(
        db,
        _payload(lines=[
            ManualOrderLine(product_code="01VD41", quantity=2, promotion_id=promotion.id),
            ManualOrderLine(product_code="02VD41", quantity=2),
        ]),
    )
    row = db.scalar(
        select(VinamilkOrderSnapshot)
        .where(VinamilkOrderSnapshot.order_number == result["order_number"])
        .where(VinamilkOrderSnapshot.product_code == "01VD41")
    )
    assert row.raw_payload["Mã CTKM"] == "KM-TEST-MIN-PRODUCTS"


def test_manual_order_promotion_can_trigger_and_reward_in_boxes(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    product.boxes_per_carton = 10
    promotion = Promotion(
        code="KM-TEST-BOX",
        name="Mua hộp tặng hộp",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[
            PromotionRule(
                trigger_type="QUANTITY",
                quantity_unit="BOX",
                min_quantity=3,
                reward_type="FREE_QUANTITY",
                reward_value=2,
                reward_unit="BOX",
            )
        ],
    )
    db.add(promotion)
    db.commit()
    result = _create_manual_order(
        db,
        _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=3, promotion_id=promotion.id)]),
    )
    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"]))
    assert row.raw_payload["Số lượng KM"] == 2


def test_manual_order_promotion_respects_quantity_range(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    product.boxes_per_carton = 10
    promotion = Promotion(
        code="KM-TEST-RANGE",
        name="Khuyến mại theo khoảng thùng",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[
            PromotionRule(
                trigger_type="QUANTITY",
                quantity_unit="CARTON",
                min_quantity=1,
                max_quantity=1,
                reward_type="FREE_QUANTITY",
                reward_value=2,
            )
        ],
    )
    db.add(promotion)
    db.commit()

    eligible = _create_manual_order(
        db,
        _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=10, promotion_id=promotion.id)]),
    )
    with pytest.raises(HTTPException, match="chưa đạt điều kiện"):
        _create_manual_order(
            db,
            _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=20, promotion_id=promotion.id)]),
        )

    eligible_row = db.scalar(
        select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == eligible["order_number"])
    )
    assert eligible_row.raw_payload["Số lượng KM"] == 2


def test_manual_order_promotion_respects_amount_range(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    promotion = Promotion(
        code="KM-TEST-AMOUNT-RANGE",
        name="Khuyến mại theo khoảng giá trị",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        items=[PromotionItem(product_id=product.id)],
        rules=[
            PromotionRule(
                trigger_type="AMOUNT",
                min_amount=40000,
                max_amount=50000,
                reward_type="DISCOUNT_AMOUNT",
                reward_value=1000,
            )
        ],
    )
    db.add(promotion)
    db.commit()

    eligible = _create_manual_order(
        db,
        _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=10, promotion_id=promotion.id)]),
    )
    with pytest.raises(HTTPException, match="chưa đạt điều kiện"):
        _create_manual_order(
            db,
            _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=20, promotion_id=promotion.id)]),
        )

    eligible_row = db.scalar(
        select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == eligible["order_number"])
    )
    assert eligible_row.raw_payload["Số tiền CK"] == 1000


def test_manual_order_accepts_supplier_promotion_for_matching_customer_employee_and_sku(db):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    promotion = Promotion(
        code="KM-SUPPLIER-001",
        name="Khuyến mãi nhà cung cấp",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        target_scope="CUSTOMER_TYPE",
        customer_type="RETAIL",
        employee_code="0000030917",
        product_scope="SUPPLIER",
        supplier="vinamilk",
        rules=[PromotionRule(
            trigger_type="QUANTITY",
            quantity_unit="BOX",
            min_quantity=1,
            reward_type="FREE_QUANTITY",
            reward_value=1,
            reward_unit="BOX",
        )],
    )
    db.add(promotion)
    db.commit()

    result = _create_manual_order(
        db,
        _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=1, promotion_id=promotion.id)]),
    )
    row = db.scalar(select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == result["order_number"]))
    assert row.raw_payload["Mã CTKM"] == "KM-SUPPLIER-001"
    assert row.raw_payload["Số lượng KM"] == 1


def test_manual_order_store_target_is_enforced(db):
    customer = db.scalar(select(Customer).where(Customer.code == "0MD"))
    allowed = Store(code="ALLOWED", name="Allowed")
    other = Store(code="OTHER", name="Other")
    customer.store = allowed
    db.add(other)
    db.flush()
    promotion = Promotion(
        code="KM-STORE",
        name="Store promotion",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30),
        is_active=True,
        target_scope="STORES",
        store_links=[PromotionStore(store_id=allowed.id)],
        product_scope="SUPPLIER",
        supplier="Vinamilk",
        rules=[PromotionRule(trigger_type="QUANTITY", quantity_unit="BOX", min_quantity=1,
                             reward_type="FREE_QUANTITY", reward_value=1, reward_unit="BOX")],
    )
    db.add(promotion)
    db.commit()
    payload = _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=1, promotion_id=promotion.id)])
    assert _create_manual_order(db, payload)["order_number"]
    customer.store = other
    db.flush()
    with pytest.raises(HTTPException, match="không thuộc đối tượng"):
        _create_manual_order(db, payload)
    customer.store = None
    db.flush()
    with pytest.raises(HTTPException, match="không thuộc đối tượng"):
        _create_manual_order(db, payload)


def test_manual_order_rejects_supplier_promotion_for_wrong_supplier(db):
    promotion = Promotion(
        code="KM-SUPPLIER-002",
        name="Khuyến mãi nhà cung cấp khác",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        product_scope="SUPPLIER",
        supplier="Nhà cung cấp khác",
        rules=[PromotionRule(
            trigger_type="QUANTITY",
            quantity_unit="BOX",
            min_quantity=1,
            reward_type="FREE_QUANTITY",
            reward_value=1,
            reward_unit="BOX",
        )],
    )
    db.add(promotion)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        _create_manual_order(
            db,
            _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=1, promotion_id=promotion.id)]),
        )
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    ("customer_type", "employee_code"),
    [("WHOLESALE", "0000030917"), ("RETAIL", "OTHER-EMPLOYEE")],
)
def test_manual_order_rejects_promotion_for_ineligible_customer_or_employee(db, customer_type, employee_code):
    product = db.scalar(select(Product).where(Product.sku == "01VD41"))
    promotion = Promotion(
        code=f"KM-TARGET-{customer_type}",
        name="CTKM giới hạn đối tượng",
        start_date=datetime(2026, 11, 1),
        end_date=datetime(2026, 11, 30, 23, 59, 59),
        is_active=True,
        target_scope="CUSTOMER_TYPE",
        customer_type=customer_type,
        employee_code=employee_code,
        product_scope="SUPPLIER",
        supplier="Vinamilk",
        rules=[PromotionRule(
            trigger_type="QUANTITY",
            quantity_unit="BOX",
            min_quantity=1,
            reward_type="FREE_QUANTITY",
            reward_value=1,
            reward_unit="BOX",
        )],
    )
    db.add(promotion)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        _create_manual_order(
            db,
            _payload(lines=[ManualOrderLine(product_code="01VD41", quantity=1, promotion_id=promotion.id)]),
        )
    assert exc.value.status_code == 400


def test_resolve_user_employee_falls_back_to_username_as_employee_code(db):
    from app.core.auth import resolve_user_employee
    from app.models.user import User

    staff = Employee(code="NV030", name="Theo Mã", position="Nhân viên kinh doanh", phone="0900000030")
    db.add(staff)
    db.commit()
    user = User(username="nv030", email="nv030@noemail.local", hashed_password="x", full_name="Theo Mã")
    assert resolve_user_employee(db, user).code == "NV030"
    assert resolve_user_employee(db, User(username="admin", email="a@a", hashed_password="x", full_name="A")) is None
