from datetime import date
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.v1.endpoints.sync import (
    DeliveryRequestFormOrder,
    DeliveryRequestFormRequest,
    _build_delivery_request_form,
    download_vinamilk_delivery_request_form,
)
from app.api.v1.endpoints.delivery_requests import _read_new_workbook_order_rows
from app.models.employee import Employee
from app.models.vinamilk import VinamilkOrderSnapshot


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Employee.__table__.create(engine)
    VinamilkOrderSnapshot.__table__.create(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def add_snapshot(db: Session, order_number: str) -> None:
    db.add(VinamilkOrderSnapshot(
        remote_key=f"key-{order_number}",
        order_number=order_number,
        customer_code="MG20031IMV",
        customer_name="Cửa hàng mẫu",
        status="Xuất Hàng",
        order_created_date=date(2026, 11, 4),
        synced_from=date(2026, 11, 4),
        synced_to=date(2026, 11, 4),
        raw_payload={"orderNumber": order_number},
    ))
    db.flush()


def test_generated_form_keeps_template_format_and_fills_selected_orders():
    template = Path(__file__).resolve().parents[1] / "app" / "templates" / "delivery_request_form.xlsx"
    workbook_bytes = _build_delivery_request_form(
        [{
            "order_date": "04/11/2026",
            "order_number": "IN001",
            "employee_code": "NV008",
            "employee_name": "Nhân viên giao hàng",
            "customer_code": "C001",
            "customer_name": "Cửa hàng mẫu",
            "status": "001-Xuất hàng",
        }],
        template_path=template,
    )

    worksheet = load_workbook(BytesIO(workbook_bytes), data_only=True)["DSDonHang"]
    assert [worksheet.cell(4, column).value for column in range(1, 8)] == [
        "Ngày đơn hàng",
        "Số đơn hàng",
        "Mã NVGH",
        "Tên NVGH",
        "Mã Khách hàng",
        "Tên Khách hàng",
        "Trạng Thái",
    ]
    assert [worksheet.cell(5, column).value for column in range(1, 8)] == [
        "04/11/2026",
        "IN001",
        "NV008",
        "Nhân viên giao hàng",
        "C001",
        "Cửa hàng mẫu",
        "001-Xuất hàng",
    ]
    assert worksheet["C5"].number_format == "@"
    assert worksheet.auto_filter.ref == "A4:G5"


@pytest.mark.parametrize(
    ("status_text", "normalized_status"),
    [
        ("001-Xuất hàng", "Xuất Hàng"),
        ("002-Dương Số", "Mượn Số"),
        ("003-Âm Số", "Trả Số"),
    ],
)
def test_generated_form_rows_match_delivery_request_upload_parser(status_text, normalized_status):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "DSDonHang"
    worksheet.append([
        "Ngày đơn hàng",
        "Số đơn hàng",
        "Mã NVGH",
        "Tên NVGH",
        "Mã Khách hàng",
        "Tên Khách hàng",
        "Trạng Thái",
    ])
    worksheet.append(["2026-11-04", "IN001", "NV008", "Hoàng Xuân Bảo", "IMV", "Cửa hàng mẫu", status_text])

    parsed = _read_new_workbook_order_rows(workbook)

    assert parsed == [{
        "order_number": "IN001",
        "order_date": date(2026, 11, 4),
        "employee_code": "NV008",
        "employee_name": "Hoàng Xuân Bảo",
        "customer_code": "IMV",
        "customer_name": "Cửa hàng mẫu",
        "status": normalized_status,
        "row_number": 2,
    }]


def test_delivery_request_form_uses_employee_and_order_data_from_database(db):
    db.add(Employee(
        code="NV008",
        name="Hoàng Xuân Bảo",
        position="Đội xe",
        phone="0900000000",
        status="active",
    ))
    add_snapshot(db, "IN001")

    response = download_vinamilk_delivery_request_form(
        DeliveryRequestFormRequest(orders=[
            DeliveryRequestFormOrder(order_number="IN001", delivery_employee_code="NV008", status="003-Âm Số"),
        ]),
        db,
        SimpleNamespace(username="admin", roles=[]),
    )

    worksheet = load_workbook(BytesIO(response.body), data_only=True)["DSDonHang"]
    assert response.status_code == 200
    assert [worksheet.cell(5, column).value for column in range(1, 8)] == [
        "04/11/2026",
        "IN001",
        "NV008",
        "Hoàng Xuân Bảo",
        "IMV",
        "Cửa hàng mẫu",
        "003-Âm Số",
    ]


@pytest.mark.parametrize("customer_code", ["NVGH-NV008", "NVBH-SALE01"])
def test_delivery_request_form_preserves_staff_debt_customer_code(db, customer_code):
    db.add(Employee(code="NV008", name="Nhân viên giao", position="Đội xe", phone="0900000000", status="active"))
    add_snapshot(db, "IN001")
    snapshot = db.query(VinamilkOrderSnapshot).filter_by(order_number="IN001").one()
    snapshot.customer_code = customer_code
    db.flush()
    response = download_vinamilk_delivery_request_form(
        DeliveryRequestFormRequest(orders=[
            DeliveryRequestFormOrder(order_number="IN001", delivery_employee_code="NV008"),
        ]),
        db,
        SimpleNamespace(username="admin", roles=[]),
    )
    workbook = load_workbook(BytesIO(response.body), data_only=True)
    assert workbook["DSDonHang"]["E5"].value == customer_code
    assert _read_new_workbook_order_rows(workbook)[0]["customer_code"] == customer_code


@pytest.mark.parametrize(
    ("employee_code", "employee_status"),
    [("KT001", "active"), ("NV008", "inactive")],
)
def test_delivery_request_form_rejects_non_delivery_employees(db, employee_code, employee_status):
    db.add(Employee(
        code=employee_code,
        name="Nhân viên kiểm thử",
        position="Đội xe",
        phone="0900000000",
        status=employee_status,
    ))
    add_snapshot(db, "IN001")

    with pytest.raises(HTTPException) as error:
        download_vinamilk_delivery_request_form(
            DeliveryRequestFormRequest(orders=[
                DeliveryRequestFormOrder(order_number="IN001", delivery_employee_code=employee_code),
            ]),
            db,
            SimpleNamespace(username="admin", roles=[]),
        )

    assert error.value.status_code == 422


def test_delivery_request_form_rejects_missing_orders(db):
    db.add(Employee(
        code="NV008",
        name="Hoàng Xuân Bảo",
        position="Đội xe",
        phone="0900000000",
        status="active",
    ))

    with pytest.raises(HTTPException) as error:
        download_vinamilk_delivery_request_form(
            DeliveryRequestFormRequest(orders=[
                DeliveryRequestFormOrder(order_number="MISSING", delivery_employee_code="NV008"),
            ]),
            db,
            SimpleNamespace(username="admin", roles=[]),
        )

    assert error.value.status_code == 404


def test_delivery_request_form_is_admin_only(db):
    with pytest.raises(HTTPException) as error:
        download_vinamilk_delivery_request_form(
            DeliveryRequestFormRequest(orders=[
                DeliveryRequestFormOrder(order_number="IN001", delivery_employee_code="NV008"),
            ]),
            db,
            SimpleNamespace(username="staff", roles=[]),
        )

    assert error.value.status_code == 403
