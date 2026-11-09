from datetime import date
from io import BytesIO

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.delivery_requests import _preview_new_workbook
from app.api.v1.endpoints.sync import (
    SplitOrderItemAllocation,
    SplitOrderRequest,
    SplitOrderTarget,
    _approve_split_order_request,
    _build_delivery_request_form,
    _create_split_order_request,
)
from app.core.database import Base
from app.crud.delivery_request import create as create_delivery_request
from app.models.employee_borrow import EmployeeBorrowBatch, EmployeeBorrowEntry
from app.models.customer import Company, Customer
from app.models.employee import Employee
from app.models.inventory import DeliveryRequest, DeliveryRequestOrder, Warehouse
from app.models.product import (
    Product,
    ProductCategory,
    ProductGroup,
    ProductGroupCompany,
    ProductGroupItem,
    ProductUnit,
)
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.vinamilk import VinamilkOrderSnapshot
from app.schemas.delivery_request import (
    DeliveryRequestCreate,
    DeliveryRequestItemCreate,
    EmployeeBorrowEntryCreate,
)


@pytest.fixture
def workbook_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        category = ProductCategory(code="NEWFORM", name="New form")
        unit = ProductUnit(code="BOX", name="Box")
        warehouse = Warehouse(code="NEWFORM", name="New form warehouse", location="Test")
        driver = Employee(code="DRIVER1", name="Driver One", position="Driver", phone="1")
        salesperson = Employee(
            code="STAFF1",
            vinamilk_code="EXTSTAFF1",
            name="Sales One",
            position="Sales",
            phone="2",
        )
        customer = Customer(code="CUST1", name="Customer", type="RETAIL")
        company = Company(code="COMP1", name="Company")
        db.add_all([category, unit, warehouse, driver, salesperson, customer, company])
        db.flush()
        representative = Product(
            sku="REP001",
            name="NPP product",
            category_id=category.id,
            unit_id=unit.id,
            boxes_per_carton=12,
        )
        dms_product = Product(
            sku="DMS001",
            name="DMS product",
            category_id=category.id,
            unit_id=unit.id,
            boxes_per_carton=12,
        )
        db.add_all([representative, dms_product])
        db.flush()
        group = ProductGroup(
            name="NPP product",
            representative_product_id=representative.id,
            items=[
                ProductGroupItem(product_id=representative.id),
                ProductGroupItem(product_id=dms_product.id),
            ],
            company_links=[
                ProductGroupCompany(
                    company_id=company.id,
                    distributor_sku="0001",
                    distributor_name="NPP product",
                )
            ],
        )
        db.add(group)
        db.flush()
        db.add_all([
            VinamilkOrderSnapshot(
                remote_key="EX1-DMS001",
                order_number="EX1",
                customer_code="CUST1",
                customer_name="Customer",
                product_code="DMS001",
                product_name="DMS product",
                order_created_date=date(2026, 10, 30),
                synced_from=date(2026, 10, 30),
                synced_to=date(2026, 10, 30),
                raw_payload={
                    "Số lượng": 3,
                    "Số lượng KM": 2,
                    "Giá trị": 100,
                    "Mã NVBH": "EXTSTAFF1",
                    "Tên NVBH": "Sales One",
                },
            ),
            VinamilkOrderSnapshot(
                remote_key="BOR1-DMS001",
                order_number="BOR1",
                customer_code="CUST1",
                customer_name="Customer",
                product_code="DMS001",
                product_name="DMS product",
                order_created_date=date(2026, 10, 30),
                synced_from=date(2026, 10, 30),
                synced_to=date(2026, 10, 30),
                raw_payload={
                    "Số lượng": 2,
                    "Giá trị": 40,
                    "Mã NVBH": "EXTSTAFF1",
                    "Tên NVBH": "Sales One",
                },
            ),
            VinamilkOrderSnapshot(
                remote_key="RET1-DMS001",
                order_number="RET1",
                customer_code="CUST1",
                customer_name="Customer",
                product_code="DMS001",
                product_name="DMS product",
                order_created_date=date(2026, 10, 30),
                synced_from=date(2026, 10, 30),
                synced_to=date(2026, 10, 30),
                raw_payload={
                    "Số lượng": 1,
                    "Giá trị": 10,
                    "Mã NVBH": "EXTSTAFF1",
                    "Tên NVBH": "Sales One",
                },
            ),
        ])
        sales_order = SalesOrder(
            code="ACCOUNTING-1",
            customer_id=customer.id,
            employee_id=salesperson.id,
            warehouse_id=warehouse.id,
            status="APPROVED",
            subtotal=250,
            total=250,
            items=[
                SalesOrderItem(
                    product_id=dms_product.id,
                    quantity=4,
                    price=62.5,
                    line_total=250,
                )
            ],
        )
        db.add(sales_order)
        db.commit()
        yield db, warehouse
    Base.metadata.drop_all(engine)
    engine.dispose()


def build_new_workbook() -> bytes:
    workbook = Workbook()
    orders = workbook.active
    orders.title = "DSDonHang"
    orders.append(["DANH SÁCH ĐƠN HÀNG"])
    orders.append(["Ngày đơn hàng", "Số đơn hàng", "Mã NVGH", "Tên NVGH", "Mã Khách hàng", "Tên Khách hàng", "Trạng Thái"])
    orders.append([date(2026, 10, 30), "EX1", "DRIVER1", "Driver One", "CUST1", "Customer", "Xuất Hàng"])
    orders.append([date(2026, 10, 30), "BOR1", "STAFF1", "Sales One", "CUST1", "Customer", "Mượn Số"])
    orders.append([date(2026, 10, 30), "SEND1", "DRIVER1", "Driver One", "CUST1", "Customer", "Gửi Số"])
    orders.append([date(2026, 10, 30), "RET1", "DRIVER1", "Driver One", "CUST1", "Customer", "Trả Số"])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_split_delivery_recipient_exports_as_normal_order_without_sales_borrow(workbook_db):
    db, warehouse = workbook_db
    driver = Employee(code="NV020", name="Delivery recipient", position="Driver", phone="3")
    db.add(driver)
    source = db.query(VinamilkOrderSnapshot).filter_by(order_number="EX1").one()
    request = _create_split_order_request(db, SplitOrderRequest(
        order_number="EX1",
        splits=[SplitOrderTarget(
            customer_code="CUST1",
            items=[SplitOrderItemAllocation(snapshot_id=source.id, quantity=2, promo_quantity=1)],
        )],
        auto_assign_remainder_to_delivery_customer=True,
        remainder_delivery_employee_code="NV020",
    ))
    recipient = request["preview"]["splits"][1]
    _approve_split_order_request(db, request["id"])
    form = _build_delivery_request_form([{
        "order_date": "30/10/2026", "order_number": recipient["new_order_number"],
        "employee_code": driver.code, "employee_name": driver.name,
        "customer_code": recipient["customer_code"], "customer_name": recipient["customer_name"],
        "status": "001-Xuất hàng",
    }])
    preview = _preview_new_workbook(
        file_bytes=form, filename="delivery.xlsx", warehouse_id=warehouse.id, db=db,
    )
    assert preview is not None
    assert preview.can_create
    assert preview.statuses == {"Xuất Hàng": 1}
    assert preview.total_quantity == 2
    assert preview.borrow_entries == []
    assert preview.items[0].borrowed_employee_offsets == []
    assert preview.orders[0].order_number == recipient["new_order_number"]
    assert preview.orders[0].customer_code == "NVGH-NV020"
    assert preview.orders[0].employee_code == "NV020"


def test_new_workbook_reconciles_orders_and_routes_borrowing(workbook_db):
    db, warehouse = workbook_db
    internal_order = db.query(SalesOrder).filter_by(code="ACCOUNTING-1").one()
    borrowed_snapshot = db.query(VinamilkOrderSnapshot).filter_by(order_number="BOR1").one()
    borrowed_snapshot.raw_payload = {
        **borrowed_snapshot.raw_payload,
        "Mã NVBH": "UNKNOWN-DMS-STAFF",
        "Tên NVBH": "DMS employee mismatch",
    }
    db.commit()

    preview = _preview_new_workbook(
        file_bytes=build_new_workbook(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
        send_order_mappings={"send1": internal_order.id},
    )

    assert preview is not None
    assert preview.statuses == {"Xuất Hàng": 1, "Mượn Số": 1, "Gửi Số": 1, "Trả Số": 1}
    assert preview.can_create
    assert preview.total_quantity == 10
    assert len(preview.items) == 1
    assert preview.items[0].sku == "0001"
    assert preview.items[0].dms_skus == ["DMS001"]
    assert preview.items[0].employee_allocations["DRIVER1"]["quantity"] == 10
    assert [
        offset.model_dump() for offset in preview.items[0].borrowed_employee_offsets
    ] == [{
            "external_employee_code": "EXTSTAFF1",
            "external_employee_name": "Sales One",
            "employee_id": db.query(Employee).filter_by(code="STAFF1").one().id,
            "quantity": 1,
            "amount": 10.0,
        }]
    assert {order.order_number: order.amount for order in preview.orders} == {
        "EX1": 100,
        "SEND1": 250,
        "RET1": 10,
    }
    assert len(preview.borrow_entries) == 1
    assert preview.borrow_entries[0].employee_id is None
    assert preview.borrow_entries[0].external_employee_code == "UNKNOWN-DMS-STAFF"
    assert preview.borrow_entries[0].quantity == -2
    assert preview.borrow_entries[0].amount == -40
    compared = {order["order_number"]: order for order in preview.order_reconciliation}
    assert compared["EX1"]["difference"] is None
    assert compared["BOR1"]["status"] == "Mượn Số"
    assert compared["SEND1"]["source_order_code"] == "ACCOUNTING-1"
    assert preview.amount_source == "DMS"
    assert preview.employee_summaries[0].amount == 360
    assert preview.employee_summaries[0].employee_code == "DRIVER1"
    assert any("NVBH ưu tiên theo DMS UNKNOWN-DMS-STAFF" in warning for warning in preview.warnings)
    assert not any("NVBH ưu tiên theo DMS EXTSTAFF1" in warning for warning in preview.warnings)


def test_new_workbook_rejects_mapping_one_internal_order_to_multiple_send_rows(workbook_db):
    db, warehouse = workbook_db
    internal_order = db.query(SalesOrder).filter_by(code="ACCOUNTING-1").one()
    workbook = load_workbook(BytesIO(build_new_workbook()))
    workbook["DSDonHang"].append([
        date(2026, 10, 30), "SEND2", "DRIVER1", "Driver One", "CUST1", "Customer", "Gửi Số",
    ])
    output = BytesIO()
    workbook.save(output)

    preview = _preview_new_workbook(
        file_bytes=output.getvalue(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
        send_order_mappings={"send1": internal_order.id, "send2": internal_order.id},
    )

    assert not preview.can_create
    assert any("đã được ghép cho một dòng Gửi Số khác" in issue for issue in preview.issues)


def test_new_workbook_allows_orders_from_cancelled_delivery_request(workbook_db):
    db, warehouse = workbook_db
    cancelled_request = DeliveryRequest(
        code="DR-CANCELLED",
        warehouse_id=warehouse.id,
        status="CANCELLED",
    )
    cancelled_request.orders.append(DeliveryRequestOrder(
        order_number="EX1",
        employee_code="DRIVER1",
        employee_name="Driver One",
        amount=100,
    ))
    db.add(cancelled_request)
    db.commit()

    preview = _preview_new_workbook(
        file_bytes=build_new_workbook(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
        send_order_mappings={
            "send1": db.query(SalesOrder).filter_by(code="ACCOUNTING-1").one().id,
        },
    )

    assert preview.can_create
    assert not any("Đơn EX1 đã có" in issue for issue in preview.issues)


def test_new_workbook_still_rejects_orders_in_active_delivery_request(workbook_db):
    db, warehouse = workbook_db
    active_request = DeliveryRequest(
        code="DR-ACTIVE",
        warehouse_id=warehouse.id,
        status="SUBMITTED",
    )
    active_request.orders.append(DeliveryRequestOrder(
        order_number="EX1",
        employee_code="DRIVER1",
        employee_name="Driver One",
        amount=100,
    ))
    db.add(active_request)
    db.commit()

    preview = _preview_new_workbook(
        file_bytes=build_new_workbook(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
        send_order_mappings={
            "send1": db.query(SalesOrder).filter_by(code="ACCOUNTING-1").one().id,
        },
    )

    assert not preview.can_create
    assert any("Đơn EX1 đã có trong một yêu cầu xuất kho trước đó." == issue for issue in preview.issues)


def test_borrow_status_uses_dms_sales_employee_and_warns_when_file_has_driver(workbook_db):
    db, warehouse = workbook_db
    workbook = load_workbook(BytesIO(build_new_workbook()))
    workbook["DSDonHang"]["C4"] = "DRIVER1"
    workbook["DSDonHang"]["D4"] = "Driver One"
    output = BytesIO()
    workbook.save(output)

    preview = _preview_new_workbook(
        file_bytes=output.getvalue(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
        send_order_mappings={
            "send1": db.query(SalesOrder).filter_by(code="ACCOUNTING-1").one().id,
        },
    )

    assert preview.can_create
    assert preview.borrow_entries[0].employee_id == db.query(Employee).filter_by(code="STAFF1").one().id
    assert any("mã file DRIVER1 ≠ mã DMS EXTSTAFF1" in warning for warning in preview.warnings)


def test_borrow_uses_dms_identity_without_internal_employee_mapping(workbook_db):
    db, warehouse = workbook_db
    snapshot = db.query(VinamilkOrderSnapshot).filter_by(order_number="BOR1").one()
    snapshot.raw_payload = {
        **snapshot.raw_payload,
        "Mã NVBH": "UNKNOWN-DMS-STAFF",
        "Tên NVBH": "Sales unknown",
    }
    db.commit()

    preview = _preview_new_workbook(
        file_bytes=build_new_workbook(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
        send_order_mappings={
            "send1": db.query(SalesOrder).filter_by(code="ACCOUNTING-1").one().id,
        },
    )

    assert preview.can_create
    borrow_entry = next(entry for entry in preview.borrow_entries if entry.external_employee_code == "UNKNOWN-DMS-STAFF")
    assert borrow_entry.employee_id is None
    assert borrow_entry.external_employee_name == "Sales unknown"


def test_new_workbook_offers_internal_order_candidates_for_send_status(workbook_db):
    db, warehouse = workbook_db
    internal_order = db.query(SalesOrder).filter_by(code="ACCOUNTING-1").one()

    preview = _preview_new_workbook(
        file_bytes=build_new_workbook(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
    )

    assert not preview.can_create
    assert any("SEND1 chưa được tạo" in issue for issue in preview.issues)
    assert preview.send_order_candidates["SEND1"][0]["id"] == internal_order.id


def test_new_workbook_blocks_when_dms_product_is_not_mapped(workbook_db):
    db, warehouse = workbook_db
    snapshot = db.query(VinamilkOrderSnapshot).filter_by(order_number="EX1").one()
    snapshot.product_code = "UNKNOWN"
    db.commit()

    preview = _preview_new_workbook(
        file_bytes=build_new_workbook(),
        filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        warehouse_id=warehouse.id,
        db=db,
    )

    assert preview is not None
    assert not preview.can_create
    assert any("UNKNOWN" in issue for issue in preview.issues)


def test_new_workbook_rejects_duplicate_order_rows(workbook_db):
    db, warehouse = workbook_db
    workbook = Workbook()
    orders = workbook.active
    orders.title = "DSDonHang"
    headers = ["Ngày đơn hàng", "Số đơn hàng", "Mã NVGH", "Tên NVGH", "Mã Khách hàng", "Tên Khách hàng", "Trạng Thái"]
    orders.append(headers)
    orders.append([date(2026, 10, 30), "EX1", "DRIVER1", "Driver One", "CUST1", "Customer", "Xuất Hàng"])
    orders.append([date(2026, 10, 30), "EX1", "DRIVER1", "Driver One", "CUST1", "Customer", "Xuất Hàng"])
    output = BytesIO()
    workbook.save(output)

    with pytest.raises(ValueError, match="xuất hiện nhiều lần"):
        _preview_new_workbook(
            file_bytes=output.getvalue(),
            filename="duplicate.xlsx",
            warehouse_id=warehouse.id,
            db=db,
        )


def test_delivery_creation_records_borrow_rows_in_pending_batch_atomically(workbook_db):
    db, warehouse = workbook_db
    product = db.query(Product).filter_by(sku="REP001").one()
    salesperson = db.query(Employee).filter_by(code="STAFF1").one()

    request = create_delivery_request(
        db,
        DeliveryRequestCreate(
            warehouse_id=warehouse.id,
            items=[DeliveryRequestItemCreate(
                product_id=product.id,
                quantity=2,
                borrowed_employee_offsets=[{
                    "external_employee_code": "EXTSTAFF1",
                    "external_employee_name": "Sales One",
                    "employee_id": salesperson.id,
                    "quantity": 1,
                    "amount": 40,
                }],
            )],
            borrow_entries=[
                EmployeeBorrowEntryCreate(
                    employee_id=salesperson.id,
                    product_id=product.id,
                    quantity=-2,
                    amount=-80,
                    note="Mượn Số theo đơn BOR1",
                )
            ],
            borrow_import_hash="a" * 64,
            borrow_filename="Form_Yeu_Cau_Xuat_Kho_Moi.xlsx",
        ),
        created_by="admin",
    )

    batch = db.query(EmployeeBorrowBatch).one()
    entry = db.query(EmployeeBorrowEntry).one()
    assert request.status == "DRAFT"
    assert batch.status == "POSTED"
    assert entry.source_request_id == request.id
    assert entry.quantity == -2
    assert float(entry.amount) == -80
    assert request.items[0].borrowed_employee_offsets == [{
        "external_employee_code": "EXTSTAFF1",
        "external_employee_name": "Sales One",
        "employee_id": salesperson.id,
        "quantity": 1,
        "amount": 40.0,
    }]
