from datetime import date, datetime, timedelta
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.debt_ledger import (
    cancel_delivery_return,
    get_employee_balance,
    receive_delivery_return,
)
from app.models.employee import Employee
from app.models.finance import DebtLedgerEntry, DeliveryReturn
from app.models.inventory import (
    DeliveryAllocation,
    DeliveryRequest,
    DeliveryRequestItem,
    DeliveryRequestOrder,
    DeliveryRequestOrderItem,
    InventoryLot,
    Warehouse,
    WarehouseLocation,
)
from app.models.product import Product, ProductCategory, ProductGroup, ProductGroupItem, ProductUnit
from app.models.vinamilk import VinamilkOrderReplacement, VinamilkOrderSnapshot
from app.services.order_replacement_return import (
    create_replacement_return,
    list_eligible_new_orders,
    list_eligible_old_orders,
    preview_replacement_return,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        wh = Warehouse(code="WH-1", name="Kho Chinh", location="HCM")
        session.add(wh)
        session.flush()

        loc = WarehouseLocation(warehouse_id=wh.id, code="A-01", name="Ke A1", is_active=True)
        cat = ProductCategory(code="MILK", name="Sua")
        unit = ProductUnit(code="HOP", name="Hop")
        session.add_all([loc, cat, unit])
        session.flush()

        p1 = Product(sku="SP01", name="Sua Tuoi 1L", category_id=cat.id, unit_id=unit.id, boxes_per_carton=12)
        p2 = Product(sku="SP02", name="Sua Chua 100g", category_id=cat.id, unit_id=unit.id, boxes_per_carton=48)
        emp = Employee(code="NV01", name="Nguyen Van A", position="Delivery", phone="0901111111", status="active")
        session.add_all([p1, p2, emp])
        session.flush()

        g1 = ProductGroup(name="Sua Tuoi 1L", representative_product_id=p1.id)
        g2 = ProductGroup(name="Sua Chua 100g", representative_product_id=p2.id)
        session.add_all([g1, g2])
        session.flush()
        session.add_all([
            ProductGroupItem(product_group_id=g1.id, product_id=p1.id),
            ProductGroupItem(product_group_id=g2.id, product_id=p2.id),
        ])
        session.flush()

        lot1 = InventoryLot(
            warehouse_id=wh.id,
            location_id=loc.id,
            product_id=p1.id,
            lot_number="LOT-01",
            expiry_date=datetime.utcnow() + timedelta(days=90),
            quantity_on_hand=100,
            locked_quantity=0,
            unit_cost=10000,
        )
        lot2 = InventoryLot(
            warehouse_id=wh.id,
            location_id=loc.id,
            product_id=p2.id,
            lot_number="LOT-02",
            expiry_date=datetime.utcnow() + timedelta(days=90),
            quantity_on_hand=100,
            locked_quantity=0,
            unit_cost=5000,
        )
        session.add_all([lot1, lot2])
        session.flush()

        # Phiếu xuất kho đã hoàn tất (đã xuất kho)
        dr = DeliveryRequest(
            code="DR-001",
            warehouse_id=wh.id,
            status="COMPLETED",
            completed_at=datetime.utcnow(),
        )
        session.add(dr)
        session.flush()

        dri1 = DeliveryRequestItem(request_id=dr.id, product_id=p1.id, quantity=24)
        dri2 = DeliveryRequestItem(request_id=dr.id, product_id=p2.id, quantity=10)
        session.add_all([dri1, dri2])
        session.flush()

        session.add_all([
            DeliveryAllocation(item_id=dri1.id, allocated_quantity=24, lot_id=lot1.id, location_id=loc.id, expiry_date=lot1.expiry_date),
            DeliveryAllocation(item_id=dri2.id, allocated_quantity=10, lot_id=lot2.id, location_id=loc.id, expiry_date=lot2.expiry_date),
        ])

        # Đơn cũ trong phiếu xuất kho (tổng tiền 290,000đ)
        dro = DeliveryRequestOrder(
            delivery_request_id=dr.id,
            order_date=date.today(),
            order_number="SO-OLD-001",
            employee_id=emp.id,
            employee_code=emp.code,
            employee_name=emp.name,
            customer_code="KH01",
            customer_name="Tap Hoa A",
            amount=290000,
            returned_amount=0,
            net_amount=290000,
            delivery_status="PENDING",
            payment_status="UNPAID",
        )
        session.add(dro)
        session.flush()

        session.add_all([
            DeliveryRequestOrderItem(
                delivery_request_order_id=dro.id,
                product_id=p1.id,
                ordered_qty=24,
                delivered_qty=24,
                returned_qty=0,
                unit_price=10000,
                line_total=240000,
            ),
            DeliveryRequestOrderItem(
                delivery_request_order_id=dro.id,
                product_id=p2.id,
                ordered_qty=10,
                delivered_qty=10,
                returned_qty=0,
                unit_price=5000,
                line_total=50000,
            ),
        ])

        # Ghi công nợ ban đầu cho NVGH khi xuất kho: +290,000đ
        session.add(DebtLedgerEntry(
            party_type="EMPLOYEE",
            party_id=emp.id,
            entry_type="DELIVERY_ISSUE",
            amount=290000,
            source_type="DELIVERY_REQUEST",
            source_id=dr.id,
            source_code=dr.code,
        ))

        # Snapshot đơn cũ và đơn mới trên DMS (khách chỉ nhận 12 SP01 = 120,000đ, trả 12 SP01 + 10 SP02 = 170,000đ)
        today = date.today()
        session.add_all([
            VinamilkOrderSnapshot(
                remote_key="old-1",
                order_number="SO-OLD-001",
                customer_code="KH01",
                customer_name="Tap Hoa A",
                product_code="SP01",
                product_name="Sua Tuoi 1L",
                order_created_date=today,
                synced_from=today,
                synced_to=today,
                warehouse_updated=True,
                returned=False,
                raw_payload={"Số lượng": 24, "Giá trị": 240000},
            ),
            VinamilkOrderSnapshot(
                remote_key="old-2",
                order_number="SO-OLD-001",
                customer_code="KH01",
                customer_name="Tap Hoa A",
                product_code="SP02",
                product_name="Sua Chua 100g",
                order_created_date=today,
                synced_from=today,
                synced_to=today,
                warehouse_updated=True,
                returned=False,
                raw_payload={"Số lượng": 10, "Giá trị": 50000},
            ),
            VinamilkOrderSnapshot(
                remote_key="new-1",
                order_number="SO-NEW-002",
                customer_code="KH01",
                customer_name="Tap Hoa A",
                product_code="SP01",
                product_name="Sua Tuoi 1L",
                order_created_date=today,
                synced_from=today,
                synced_to=today,
                warehouse_updated=False,
                returned=False,
                raw_payload={"Số lượng": 12, "Giá trị": 120000},
            ),
        ])
        session.commit()

        yield session, {
            "emp": emp,
            "dro": dro,
            "lot1": lot1,
            "lot2": lot2,
        }


def test_order_replacement_partial_return_and_warehouse_receive(db):
    session, ctx = db
    emp = ctx["emp"]
    dro = ctx["dro"]

    # 1. Tìm đơn cũ và đơn mới đủ điều kiện
    old_list = list_eligible_old_orders(session, search="SO-OLD")
    assert len(old_list) == 1
    assert old_list[0]["order_number"] == "SO-OLD-001"

    new_list = list_eligible_new_orders(session, customer_code="KH01")
    assert len(new_list) == 1
    assert new_list[0]["order_number"] == "SO-NEW-002"

    # 2. Xem trước đối chiếu chênh lệch
    preview = preview_replacement_return(session, dro.id, "SO-NEW-002")
    assert preview["can_create"] is True
    assert preview["old_amount"] == 290000.0
    assert preview["new_amount"] == 120000.0
    assert preview["return_amount"] == 170000.0
    assert preview["total_return_qty"] == 22  # 12 SP01 + 10 SP02

    # 3. Tạo lệnh thay thế & yêu cầu trả hàng -> trạng thái PENDING_WAREHOUSE
    ret = create_replacement_return(session, dro.id, "SO-NEW-002", created_by="nv_sale", note="Khach nhan 1 phan")
    assert ret.status == "PENDING_WAREHOUSE"
    assert ret.return_type == "ORDER_REPLACEMENT"
    assert ret.replacement_order_number == "SO-NEW-002"
    assert float(ret.amount) == 170000.0
    assert len(ret.items) == 2

    # Liên kết thay thế DMS đã được lưu
    rep = session.get(VinamilkOrderReplacement, "SO-NEW-002")
    assert rep is not None
    assert rep.replaced_order_number == "SO-OLD-001"

    # CHƯA giảm công nợ NVGH & CHƯA cộng tồn kho trước khi thủ kho xác nhận!
    assert get_employee_balance(session, emp.id) == 290000.0
    session.refresh(ctx["lot1"])
    session.refresh(ctx["lot2"])
    assert ctx["lot1"].quantity_on_hand == 100
    assert ctx["lot2"].quantity_on_hand == 100

    # 4. Thủ kho xác nhận nhận đủ hàng -> trạng thái WAREHOUSE_RECEIVED, cộng tồn kho FEFO, giảm công nợ NVGH
    received = receive_delivery_return(
        session,
        return_id=ret.id,
        received_by="thu_kho_1",
        restore_stock=True,
        note="Da nhan du hang",
    )
    assert received.status == "WAREHOUSE_RECEIVED"
    assert received.warehouse_received_by == "thu_kho_1"

    # Công nợ NVGH giảm từ 290,000đ -> 120,000đ (khớp chính xác đơn mới!)
    assert get_employee_balance(session, emp.id) == 120000.0

    # Tồn kho được cộng đúng vào lô gốc
    session.refresh(ctx["lot1"])
    session.refresh(ctx["lot2"])
    assert ctx["lot1"].quantity_on_hand == 112
    assert ctx["lot2"].quantity_on_hand == 110

    # Đơn cũ trên DMS snapshot được đánh dấu returned=True
    old_snaps = session.scalars(
        select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number == "SO-OLD-001")
    ).all()
    assert all(s.returned is True for s in old_snaps)


def test_cancel_pending_replacement_return_cleans_up_link(db):
    session, ctx = db
    dro = ctx["dro"]

    ret = create_replacement_return(session, dro.id, "SO-NEW-002", created_by="nv_sale")
    assert session.get(VinamilkOrderReplacement, "SO-NEW-002") is not None

    cancelled = cancel_delivery_return(session, ret.id, cancelled_by="nv_sale", reason="Chon nham don")
    assert cancelled.status == "CANCELLED"
    assert session.get(VinamilkOrderReplacement, "SO-NEW-002") is None
    assert get_employee_balance(session, ctx["emp"].id) == 290000.0
