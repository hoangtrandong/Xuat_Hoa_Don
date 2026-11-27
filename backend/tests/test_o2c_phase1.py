from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.debt_ledger import (
    approve_debt_transfer,
    create_debt_transfer,
    create_delivery_return,
    get_employee_balance,
    get_store_balance,
    receive_delivery_return,
    reject_debt_transfer,
    resolve_damaged_return_item,
)
from app.crud.delivery_request import _fefo_picks
from app.crud.vehicle import create_vehicle, list_vehicles, update_vehicle
from app.models.customer import Store
from app.models.employee import Employee
from app.models.finance import DebtLedgerEntry
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
from app.schemas.vehicle import VehicleCreate, VehicleUpdate


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        wh = Warehouse(code="WH-P1", name="Kho Trung Tam", location="HCM")
        session.add(wh)
        session.flush()

        loc_good = WarehouseLocation(warehouse_id=wh.id, code="A-01", name="Ke A1", is_active=True)
        loc_dmg = WarehouseLocation(warehouse_id=wh.id, code="DAMAGED", name="Khu Hang Hong", is_active=True)
        session.add_all([loc_good, loc_dmg])
        session.flush()

        cat = ProductCategory(code="CAT-MILK", name="Sua")
        unit = ProductUnit(code="HOP", name="Hop")
        session.add_all([cat, unit])
        session.flush()

        prod = Product(
            sku="SKU-MILK-01",
            name="Sua Tuoi 1L",
            category_id=cat.id,
            unit_id=unit.id,
            boxes_per_carton=12,
            cost_price=80000,
            base_price=100000,
        )
        session.add(prod)
        session.flush()
        grp = ProductGroup(name="Sua Tuoi 1L", representative_product_id=prod.id)
        session.add(grp)
        session.flush()
        session.add(ProductGroupItem(product_group_id=grp.id, product_id=prod.id))

        emp = Employee(code="NV-GH01", name="Nguyen Van Giao", position="Delivery", phone="0901111111")
        driver = Employee(code="TX-01", name="Tran Tai Xe", position="Driver", phone="0902222222")
        store = Store(code="CH-01", name="Tap Hoa A", credit_limit=500000.0)
        session.add_all([emp, driver, store])
        session.commit()
        yield session, wh, loc_good, loc_dmg, prod, emp, driver, store
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_vehicle_crud_and_uniqueness(db):
    session, _, _, _, _, _, driver, _ = db
    v = create_vehicle(
        session,
        VehicleCreate(
            code="xe-01",
            plate_number="51c-123.45",
            name="Xe tai 2.5 tan",
            vehicle_type="COLD",
            max_weight_kg=2500,
            default_driver_id=driver.id,
        ),
    )
    assert v["code"] == "XE-01"
    assert v["plate_number"] == "51C-123.45"
    assert v["default_driver_code"] == "TX-01"

    with pytest.raises(ValueError, match="đã tồn tại"):
        create_vehicle(
            session,
            VehicleCreate(code="XE-02", plate_number="51C-123.45", name="Duplicate Plate"),
        )

    updated = update_vehicle(session, v["id"], VehicleUpdate(max_weight_kg=3000, is_active=False))
    assert updated["max_weight_kg"] == 3000
    assert list_vehicles(session, active_only=True) == []
    assert len(list_vehicles(session, active_only=False)) == 1


def test_fefo_strictly_blocks_expired_lots(db):
    session, wh, loc_good, _, prod, _, _, _ = db
    expired_lot = InventoryLot(
        warehouse_id=wh.id,
        location_id=loc_good.id,
        product_id=prod.id,
        lot_number="LOT-EXP",
        expiry_date=datetime.utcnow() - timedelta(days=2),
        quantity_on_hand=50,
        locked_quantity=0,
    )
    valid_lot = InventoryLot(
        warehouse_id=wh.id,
        location_id=loc_good.id,
        product_id=prod.id,
        lot_number="LOT-OK",
        expiry_date=datetime.utcnow() + timedelta(days=30),
        quantity_on_hand=20,
        locked_quantity=0,
    )
    session.add_all([expired_lot, valid_lot])
    session.commit()

    picks, remaining = _fefo_picks(session, wh.id, prod.id, 15)
    assert remaining == 0
    assert len(picks) == 1
    assert picks[0][1] == valid_lot.id
    assert picks[0][3] == 15


def test_two_step_fefo_partial_return_and_damaged_resolution(db):
    session, wh, loc_good, loc_dmg, prod, emp, _, _ = db
    exp_date = datetime.utcnow() + timedelta(days=45)
    lot = InventoryLot(
        warehouse_id=wh.id,
        location_id=loc_good.id,
        product_id=prod.id,
        lot_number="LOT-001",
        expiry_date=exp_date,
        quantity_on_hand=10,
        locked_quantity=0,
    )
    session.add(lot)
    session.flush()

    dr = DeliveryRequest(code="DR-P1-001", warehouse_id=wh.id, status="COMPLETED")
    session.add(dr)
    session.flush()

    dr_item = DeliveryRequestItem(request_id=dr.id, product_id=prod.id, quantity=10)
    session.add(dr_item)
    session.flush()

    session.add(
        DeliveryAllocation(
            item_id=dr_item.id,
            allocated_quantity=10,
            lot_id=lot.id,
            location_id=loc_good.id,
            expiry_date=exp_date,
        )
    )
    order = DeliveryRequestOrder(
        delivery_request_id=dr.id,
        order_date=date.today(),
        order_number="DH-001",
        employee_id=emp.id,
        employee_code=emp.code,
        amount=1000000,
        einvoice_status="ISSUED",
    )
    session.add(order)
    session.flush()
    order_item = DeliveryRequestOrderItem(
        delivery_request_order_id=order.id,
        product_id=prod.id,
        ordered_qty=10,
        delivered_qty=10,
        returned_qty=0,
        unit_price=100000,
        line_total=1000000,
    )
    session.add(order_item)
    # Initial employee debt = 1,000,000
    session.add(
        DebtLedgerEntry(
            party_type="EMPLOYEE",
            party_id=emp.id,
            entry_type="DELIVERY_ISSUE",
            amount=Decimal("1000000"),
            source_type="DELIVERY_REQUEST",
            source_id=dr.id,
            source_code=dr.code,
        )
    )
    session.commit()

    # Reject over-return > ordered_qty
    with pytest.raises(ValueError, match="vượt quá số lượng có thể trả"):
        create_delivery_return(
            session,
            delivery_request_id=dr.id,
            employee_id=emp.id,
            order_id=order.id,
            items=[{"product_id": prod.id, "quantity": 11, "unit_price": 100000}],
            auto_receive=False,
            created_by="shipper",
        )

    # Step 1: Shipper creates 2-step return (3 GOOD + 1 DAMAGED)
    ret = create_delivery_return(
        session,
        delivery_request_id=dr.id,
        employee_id=emp.id,
        order_id=order.id,
        items=[
            {"product_id": prod.id, "quantity": 3, "unit_price": 100000, "item_condition": "GOOD"},
            {"product_id": prod.id, "quantity": 1, "unit_price": 100000, "item_condition": "DAMAGED", "location_id": loc_dmg.id},
        ],
        auto_receive=False,
        created_by="shipper",
    )
    assert ret.status == "PENDING_WAREHOUSE"
    session.refresh(lot)
    assert lot.quantity_on_hand == 10  # Not restored yet!
    assert get_employee_balance(session, emp.id) == 1000000.0  # Debt not reduced yet!

    # Step 2: Warehouse receives physical goods
    ret = receive_delivery_return(
        session,
        return_id=ret.id,
        received_by="warehouse_keeper",
        restore_stock=True,
    )
    assert ret.status == "WAREHOUSE_RECEIVED"

    # GOOD item restored into original InventoryLot (+3) and unlocked
    session.refresh(lot)
    assert lot.quantity_on_hand == 13
    assert lot.locked_quantity == 0

    # DAMAGED item placed in quarantine location and LOCKED from FEFO
    dmg_item = next(i for i in ret.items if i.item_condition == "DAMAGED")
    dmg_lot = session.get(InventoryLot, dmg_item.lot_id)
    assert dmg_lot is not None
    assert dmg_lot.quantity_on_hand == 1
    assert dmg_lot.locked_quantity == 1
    assert dmg_item.damage_resolution == "PENDING"

    # Employee debt reduced ONLY by GOOD amount (300,000); DAMAGED (100,000) stays pending
    assert get_employee_balance(session, emp.id) == 700000.0

    # Order marked PARTIAL_DELIVERED (not RETURNED_ALL) and einvoice flagged ADJUSTMENT_REQUIRED
    session.refresh(order)
    assert order.delivery_status == "PARTIAL_DELIVERED"
    assert float(order.returned_amount) == 400000.0
    assert float(order.net_amount) == 600000.0
    assert order.einvoice_status == "ADJUSTMENT_REQUIRED"
    session.refresh(order_item)
    assert order_item.returned_qty == 4
    assert order_item.delivered_qty == 6

    # Step 3: Admin absorbs damaged goods -> reduces remaining 100,000 employee debt
    resolved = resolve_damaged_return_item(
        session,
        return_id=ret.id,
        item_id=dmg_item.id,
        resolution="COMPANY_ABSORB",
        resolved_by="admin",
        note="Loi bao bi nha san xuat",
    )
    assert resolved.damage_resolution == "COMPANY_ABSORB"
    assert get_employee_balance(session, emp.id) == 600000.0

    # Cannot resolve twice
    with pytest.raises(ValueError, match="đã được xử lý"):
        resolve_damaged_return_item(
            session,
            return_id=ret.id,
            item_id=dmg_item.id,
            resolution="CHARGE_EMPLOYEE",
            resolved_by="admin",
        )


def test_two_step_debt_transfer_pod_and_credit_limit(db):
    session, wh, _, _, _, emp, _, store = db
    dr = DeliveryRequest(code="DR-P1-002", warehouse_id=wh.id, status="COMPLETED")
    session.add(dr)
    session.flush()
    order = DeliveryRequestOrder(
        delivery_request_id=dr.id,
        order_number="DH-002",
        employee_id=emp.id,
        employee_code=emp.code,
        store_id=store.id,
        amount=600000,
    )
    session.add(order)
    session.add(
        DebtLedgerEntry(
            party_type="EMPLOYEE",
            party_id=emp.id,
            entry_type="DELIVERY_ISSUE",
            amount=Decimal("800000"),
            source_type="DELIVERY_REQUEST",
            source_id=dr.id,
            source_code=dr.code,
        )
    )
    session.commit()

    # Must attach POD when shipper requests EMPLOYEE -> STORE transfer
    with pytest.raises(ValueError, match="ảnh ký nhận"):
        create_debt_transfer(
            session,
            from_party_type="EMPLOYEE",
            from_party_id=emp.id,
            to_party_type="STORE",
            to_party_id=store.id,
            amount=600000,
            delivery_request_order_id=order.id,
            require_approval=True,
            created_by="shipper",
        )

    # Create pending transfer with POD
    trf = create_debt_transfer(
        session,
        from_party_type="EMPLOYEE",
        from_party_id=emp.id,
        to_party_type="STORE",
        to_party_id=store.id,
        amount=600000,
        delivery_request_order_id=order.id,
        pod_image_url="https://cdn.example.com/pod/dh-002.jpg",
        require_approval=True,
        created_by="shipper",
    )
    assert trf.status == "PENDING_APPROVAL"
    assert get_employee_balance(session, emp.id) == 800000.0
    assert get_store_balance(session, store.id) == 0.0

    # Non-admin blocked because store credit_limit is 500,000 < 600,000
    with pytest.raises(ValueError, match="vượt hạn mức công nợ"):
        approve_debt_transfer(session, trf.id, approved_by="accountant", is_admin=False)

    # Admin overrides credit limit with reason -> succeeds
    approved = approve_debt_transfer(
        session,
        trf.id,
        approved_by="admin",
        is_admin=True,
        override_limit_reason="Khach VIP cam ket thanh toan trong 3 ngay",
    )
    assert approved.status == "COMPLETED"
    assert approved.override_limit_by == "admin"
    assert get_employee_balance(session, emp.id) == 200000.0
    assert get_store_balance(session, store.id) == 600000.0
    session.refresh(order)
    assert order.payment_status == "TRANSFERRED_DEBT"

    # Reject flow test
    trf2 = create_debt_transfer(
        session,
        from_party_type="EMPLOYEE",
        from_party_id=emp.id,
        to_party_type="STORE",
        to_party_id=store.id,
        amount=100000,
        pod_image_url="https://cdn.example.com/pod/blurry.jpg",
        require_approval=True,
        created_by="shipper",
    )
    rejected = reject_debt_transfer(session, trf2.id, rejected_by="accountant", reject_reason="Anh mo khong ro chu ky")
    assert rejected.status == "REJECTED"
    assert get_employee_balance(session, emp.id) == 200000.0
