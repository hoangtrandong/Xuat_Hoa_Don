from io import BytesIO
from datetime import datetime

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.database import Base, get_db
from app.api.v1.endpoints.inventory import confirm_inventory_import, upload_inventory_import
from app.crud import supplier_discrepancy as discrepancy_crud
from app.models.inventory import (
    InventoryLot,
    InventoryTransaction,
    SupplierGoodsDiscrepancy,
    SupplierGoodsDiscrepancyOffset,
)
from app.models.product import Product, ProductCategory, ProductUnit
from app.models.inventory import Warehouse, WarehouseLocation
from starlette.datastructures import UploadFile
from app.schemas.inventory import (
    InventoryImportAllocation,
    InventoryImportConfirm,
    InventoryImportItem,
)
from app.main import app


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        category = ProductCategory(code="TEST", name="Test")
        unit = ProductUnit(code="BOX", name="Hộp")
        warehouse = Warehouse(code="T1", name="Test warehouse", location="Test")
        session.add_all([category, unit, warehouse])
        session.flush()
        product = Product(
            sku="TEST001",
            name="Test product",
            category_id=category.id,
            unit_id=unit.id,
            boxes_per_carton=1,
        )
        location = WarehouseLocation(
            warehouse_id=warehouse.id, code="A01", name="A01", is_active=True
        )
        session.add_all([product, location])
        session.commit()
        yield session, warehouse, product, location
    Base.metadata.drop_all(engine)
    engine.dispose()


def import_line(product, location, document_quantity, actual_quantity):
    allocations = (
        [InventoryImportAllocation(location_id=location.id, quantity=actual_quantity)]
        if actual_quantity
        else []
    )
    return InventoryImportItem(
        product_id=product.id,
        sku=product.sku,
        product_name=product.name,
        lot_number=f"LOT-{document_quantity}-{actual_quantity}",
        expiry_date=datetime(2027, 1, 1),
        quantity=document_quantity,
        actual_qty=actual_quantity,
        allocations=allocations,
    )


def confirm_import(db, warehouse, product, location, document_quantity, actual_quantity):
    payload = InventoryImportConfirm(
        warehouse_id=warehouse.id,
        invoice_number=f"INV-{document_quantity}-{actual_quantity}",
        items=[import_line(product, location, document_quantity, actual_quantity)],
    )
    return confirm_inventory_import(payload, db)


def test_shortage_records_missing_quantity_without_creating_stock(db):
    session, warehouse, product, location = db

    transactions = confirm_import(session, warehouse, product, location, 10, 0)

    assert transactions == []
    assert session.scalars(select(InventoryTransaction)).all() == []
    assert session.scalars(select(InventoryLot)).all() == []
    discrepancy = session.scalar(select(SupplierGoodsDiscrepancy))
    assert discrepancy.type == "SHORTAGE"
    assert discrepancy.document_quantity == 10
    assert discrepancy.actual_quantity == 0
    assert discrepancy.quantity == 10


def test_excess_is_received_but_locked_out_of_available_stock(db):
    from app.crud.delivery_request import available_for_product

    session, warehouse, product, location = db

    transactions = confirm_import(session, warehouse, product, location, 10, 12)

    assert sum(transaction.quantity for transaction in transactions) == 12
    lot = session.scalar(select(InventoryLot))
    assert lot.quantity_on_hand == 12
    assert lot.locked_quantity == 2
    discrepancy = session.scalar(select(SupplierGoodsDiscrepancy))
    assert discrepancy.type == "EXCESS"
    assert discrepancy.quantity == 2
    assert discrepancy.sources[0].quantity == 2
    assert discrepancy_crud.remaining_quantity(session, discrepancy) == 2
    assert available_for_product(session, warehouse.id, product.id) == 10


def test_import_without_actual_quantity_keeps_document_quantity_behavior(db):
    session, warehouse, product, location = db
    item = import_line(product, location, 4, 4).model_dump(exclude={"actual_qty"})
    payload = InventoryImportConfirm(
        warehouse_id=warehouse.id,
        items=[InventoryImportItem(**item)],
    )

    transactions = confirm_inventory_import(payload, session)

    assert sum(transaction.quantity for transaction in transactions) == 4
    assert session.scalars(select(SupplierGoodsDiscrepancy)).all() == []


def test_actual_quantity_rejects_negative_and_boolean_values(db):
    _, _, product, location = db
    data = import_line(product, location, 4, 4).model_dump()

    for invalid_quantity in (-1, True):
        with pytest.raises(ValidationError):
            InventoryImportItem(**{**data, "actual_qty": invalid_quantity})


def test_import_preview_reads_and_validates_actual_qty_column(db):
    session, warehouse, _, _ = db

    def workbook_file(actual_quantity):
        workbook = Workbook()
        sheet = workbook.active
        for _ in range(14):
            sheet.append([])
        sheet.append(["Tên Sản Phẩm", "Lot", "Hạn sử dụng", "Số Lượng", "actual_qty"])
        sheet.append(["TEST001", "LOT-A", "01-01-2027", 10, actual_quantity])
        stream = BytesIO()
        workbook.save(stream)
        stream.seek(0)
        return UploadFile(filename="supplier.xlsx", file=stream)

    preview = upload_inventory_import(warehouse.id, workbook_file(7), session)
    assert preview[0].quantity == 10
    assert preview[0].actual_qty == 7

    with pytest.raises(HTTPException) as error:
        upload_inventory_import(warehouse.id, workbook_file(-1), session)
    assert error.value.status_code == 400


def test_offset_suggestions_confirmation_and_history_release_locked_excess(db):
    session, warehouse, product, location = db
    confirm_import(session, warehouse, product, location, 10, 7)
    confirm_import(session, warehouse, product, location, 5, 8)
    shortage, excess = session.scalars(
        select(SupplierGoodsDiscrepancy).order_by(SupplierGoodsDiscrepancy.id)
    ).all()

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            suggestions_response = client.get(
                f"/api/v1/inventory/supplier-discrepancies/{shortage.id}/offset-suggestions"
            )
            assert suggestions_response.status_code == 200
            suggestions = suggestions_response.json()
            assert len(suggestions) == 1
            assert suggestions[0]["id"] == excess.id
            assert suggestions[0]["suggested_quantity"] == 3

            offset_response = client.post(
                "/api/v1/inventory/supplier-discrepancies/offsets/confirm",
                json={
                    "shortage_id": shortage.id,
                    "excess_id": excess.id,
                    "quantity": 1,
                    "created_by": "tester",
                },
            )
            assert offset_response.status_code == 201
            offset = offset_response.json()
            assert offset["quantity"] == 1
            session.refresh(shortage)
            session.refresh(excess)
            assert shortage.status == "PARTIAL"
            assert excess.status == "PARTIAL"

            partial_list_response = client.get(
                "/api/v1/inventory/supplier-discrepancies/",
                params={"status": "PARTIAL"},
            )
            assert partial_list_response.status_code == 200
            assert {row["id"] for row in partial_list_response.json()} == {shortage.id, excess.id}

            remaining_suggestions = client.get(
                f"/api/v1/inventory/supplier-discrepancies/{shortage.id}/offset-suggestions"
            )
            assert remaining_suggestions.status_code == 200
            assert remaining_suggestions.json()[0]["suggested_quantity"] == 2

            completed_offset = client.post(
                "/api/v1/inventory/supplier-discrepancies/offsets/confirm",
                json={
                    "shortage_id": shortage.id,
                    "excess_id": excess.id,
                    "quantity": 2,
                    "created_by": "tester",
                },
            )
            assert completed_offset.status_code == 201
            session.refresh(shortage)
            session.refresh(excess)
            assert shortage.status == "RESOLVED"
            assert excess.status == "RESOLVED"

            history_response = client.get(
                f"/api/v1/inventory/supplier-discrepancies/{excess.id}/history"
            )
            assert history_response.status_code == 200
            history = history_response.json()
            assert len(history["sources"]) == 1
            assert history["sources"][0]["released_quantity"] == 3
            assert len(history["offsets"]) == 2
            assert history["offsets"][0]["created_by"] == "tester"
            assert history["offsets"][0]["shortage_invoice_number"] == "INV-10-7"
            assert history["offsets"][0]["excess_invoice_number"] == "INV-5-8"
            list_response = client.get(
                "/api/v1/inventory/supplier-discrepancies/",
                params={"status": "RESOLVED"},
            )
            assert list_response.status_code == 200
            assert {row["id"] for row in list_response.json()} == {shortage.id, excess.id}
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert shortage.status == "RESOLVED"
    assert excess.status == "RESOLVED"
    assert discrepancy_crud.remaining_quantity(session, shortage) == 0
    assert discrepancy_crud.remaining_quantity(session, excess) == 0
    excess_lot = session.scalar(select(InventoryLot).where(InventoryLot.lot_number == "LOT-5-8"))
    assert excess_lot.locked_quantity == 0
    offsets = session.scalars(select(SupplierGoodsDiscrepancyOffset)).all()
    assert [offset.quantity for offset in offsets] == [1, 2]
    from app.crud.delivery_request import available_for_product
    assert available_for_product(session, warehouse.id, product.id) == 15
