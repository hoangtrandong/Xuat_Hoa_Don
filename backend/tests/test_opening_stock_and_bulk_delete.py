"""Tests for opening stock Excel upload (by InvoiceProduct code) and bulk stock delete."""
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import UploadFile
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.inventory import (
    bulk_delete_stock,
    download_opening_stock_template,
    upload_opening_stock,
)
from app.core.database import Base
from app.models.inventory import InventoryLot, InventoryTransaction, Warehouse
from app.models.product import InvoiceProduct
from app.schemas.inventory import BulkDeleteStockRequest


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def test_opening_stock_template_upload_and_bulk_delete(db_session):
    wh = Warehouse(code="KHO1", name="Kho Chính", location="HN")
    ip1 = InvoiceProduct(code="01TD03", name="Sữa tươi 180ml", unit_name="Hộp", status="active")
    ip2 = InvoiceProduct(code="07KD12", name="Sữa chua ăn 100g", unit_name="Hộp", status="active")
    db_session.add_all([wh, ip1, ip2])
    db_session.commit()

    user = SimpleNamespace(id=1, username="admin")

    # 1. Template download
    tpl_resp = download_opening_stock_template()
    wb_tpl = load_workbook(BytesIO(tpl_resp.body))
    headers = [c.value for c in wb_tpl.active[1]]
    assert "Mã SP XHĐ" in headers
    assert "Số lượng tồn đầu" in headers

    # 2. Upload Excel tồn đầu kỳ (tự tạo vị trí A1-01, tự tạo Product liên kết với InvoiceProduct)
    wb = Workbook()
    ws = wb.active
    ws.append(["STT", "Mã SP XHĐ", "Tên sản phẩm", "Vị trí kho", "Số lô", "Hạn sử dụng", "Số lượng tồn đầu", "Ghi chú"])
    ws.append([1, "01TD03", "Sữa tươi 180ml", "A1-01", "LOT-01", "31/12/2026", 480, "Tồn đầu"])
    ws.append([2, "07KD12", "Sữa chua ăn 100g", "A1-02", "LOT-02", "15/01/2027", 240, "Tồn đầu"])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    res = upload_opening_stock(
        warehouse_id=wh.id,
        mode="ADD",
        file=UploadFile(filename="ton-dau-ky.xlsx", file=buf),
        db=db_session,
        current_user=user,
    )
    assert res["success"] is True
    assert res["imported_rows"] == 2
    assert res["total_quantity"] == 720
    assert set(res["created_locations"]) == {"A1-01", "A1-02"}

    lots = db_session.scalars(select(InventoryLot).where(InventoryLot.quantity_on_hand > 0)).all()
    assert len(lots) == 2
    assert sum(l.quantity_on_hand for l in lots) == 720

    # 3. Bulk delete tồn kho theo invoice_product_ids
    del_res = bulk_delete_stock(
        payload=BulkDeleteStockRequest(
            warehouse_id=wh.id,
            invoice_product_ids=[ip1.id, ip2.id],
        ),
        db=db_session,
        current_user=user,
    )
    assert del_res["success"] is True
    assert del_res["cleared_products"] == 2
    assert del_res["cleared_quantity"] == 720

    remaining_lots = db_session.scalars(select(InventoryLot).where(InventoryLot.quantity_on_hand > 0)).all()
    assert remaining_lots == []

    # Kiểm tra lịch sử thẻ kho ghi nhận cả OPENING và ADJUST (BULK_DELETE)
    txns = db_session.scalars(select(InventoryTransaction)).all()
    assert len([t for t in txns if t.type == "OPENING"]) == 2
    assert len([t for t in txns if t.ref_type == "BULK_DELETE"]) == 2
