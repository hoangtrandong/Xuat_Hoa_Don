from datetime import date
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.sync import (
    MergeOrdersRequest,
    SplitOrderItemAllocation,
    SplitOrderRequest,
    SplitOrderTarget,
    _apply_scoped_states,
    _merge_vinamilk_orders,
    _order_numbers,
    _revert_split_or_merge_order,
    _save_snapshot,
    _split_vinamilk_order,
    _update_order_replacement,
    list_local_vinamilk_orders,
)
from app.models.vinamilk import (
    VinamilkOrderReplacement,
    VinamilkOrderSnapshot,
    VinamilkSyncRun,
)
from app.services.vinamilk_sales_summary import build_sales_summary


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    VinamilkOrderSnapshot.__table__.create(engine)
    VinamilkOrderReplacement.__table__.create(engine)
    VinamilkSyncRun.__table__.create(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def add_order(db: Session, order_number: str) -> None:
    db.add(VinamilkOrderSnapshot(
        remote_key=f"key-{order_number}",
        order_number=order_number,
        order_created_date=date(2026, 10, 1),
        synced_from=date(2026, 10, 1),
        synced_to=date(2026, 10, 1),
        raw_payload={"orderNumber": order_number},
    ))
    db.flush()


def test_order_numbers_reads_api_and_excel_columns():
    payload = [{"orderNumber": "A1"}, {"Số đơn hàng": "B2"}, {"productCode": "x"}]
    assert _order_numbers(payload) == {"A1", "B2"}


def test_warehouse_query_sets_only_warehouse_state_per_day(db):
    day = date(2026, 10, 1)
    for number in ("VM-1", "VM-2", "VM-3"):
        add_order(db, number)

    _apply_scoped_states(db, day, {"VM-1", "VM-2"})

    states = {s.order_number: (s.warehouse_updated, s.returned) for s in db.query(VinamilkOrderSnapshot)}
    assert states == {"VM-1": (True, None), "VM-2": (True, None), "VM-3": (False, None)}


def test_failed_scoped_query_keeps_previous_state(db):
    day = date(2026, 10, 1)
    add_order(db, "VM-1")
    snapshot = db.query(VinamilkOrderSnapshot).one()
    snapshot.returned = True
    db.flush()
    _apply_scoped_states(db, day, {"VM-1"})

    _apply_scoped_states(db, day, None)

    snapshot = db.query(VinamilkOrderSnapshot).one()
    assert snapshot.warehouse_updated is True
    assert snapshot.returned is True


def test_regular_sync_does_not_touch_scoped_states(db):
    row = {"orderNumber": "VM-100", "productCode": "SKU-1", "lineId": "line-1", "orderStatus": "Đã trả"}
    _save_snapshot(db, [row], date(2026, 10, 1), date(2026, 10, 1))
    snapshot = db.query(VinamilkOrderSnapshot).one()
    assert snapshot.warehouse_updated is None
    assert snapshot.returned is None


def test_replacement_link_can_be_updated_and_cleared(db):
    add_order(db, "VM-OLD")
    add_order(db, "VM-NEW")

    _update_order_replacement(db, "VM-NEW", "VM-OLD")
    db.flush()
    assert db.get(VinamilkOrderReplacement, "VM-NEW").replaced_order_number == "VM-OLD"

    _update_order_replacement(db, "VM-NEW", None)
    db.flush()
    assert db.get(VinamilkOrderReplacement, "VM-NEW") is None


@pytest.mark.parametrize(
    ("new_order", "old_order", "expected_status"),
    [
        ("VM-OLD", "VM-OLD", 400),
        ("VM-MISSING", "VM-OLD", 404),
        ("VM-NEW", "VM-MISSING", 404),
    ],
)
def test_replacement_link_rejects_invalid_orders(db, new_order, old_order, expected_status):
    add_order(db, "VM-OLD")
    add_order(db, "VM-NEW")

    with pytest.raises(HTTPException) as exc_info:
        _update_order_replacement(db, new_order, old_order)

    assert exc_info.value.status_code == expected_status


def test_replacement_link_rejects_cycles(db):
    for order_number in ("VM-A", "VM-B", "VM-C"):
        add_order(db, order_number)
    _update_order_replacement(db, "VM-B", "VM-A")
    _update_order_replacement(db, "VM-C", "VM-B")
    db.flush()

    with pytest.raises(HTTPException) as exc_info:
        _update_order_replacement(db, "VM-A", "VM-C")

    assert exc_info.value.status_code == 400


def test_order_list_includes_replacement_metadata_on_both_orders(db):
    add_order(db, "VM-OLD")
    add_order(db, "VM-NEW")
    _update_order_replacement(db, "VM-NEW", "VM-OLD")
    db.flush()

    response = list_local_vinamilk_orders(
        from_date=date(2026, 10, 1),
        to_date=date(2026, 10, 1),
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=2000,
        db=db,
    )

    rows_by_number = {row["orderNumber"]: row for row in response["rows"]}
    assert rows_by_number["VM-NEW"]["_replaced_order_number"] == "VM-OLD"
    assert rows_by_number["VM-NEW"]["_replacement_display"] == "TT: VM-OLD"
    assert rows_by_number["VM-OLD"]["_replaced_by_order_numbers"] == ["VM-NEW"]
    assert rows_by_number["VM-OLD"]["_replacement_display"] == "BTT: VM-NEW"


def test_split_order_creates_td_orders_and_excludes_original_in_summary(db):
    line1 = VinamilkOrderSnapshot(
        remote_key="k-split-1",
        order_number="PO-100",
        customer_code="000101",
        customer_name="KH A",
        product_code="SP-01",
        product_name="Sữa Tươi",
        order_created_date=date(2026, 10, 1),
        delivery_date=date(2026, 10, 1),
        warehouse_updated=True,
        synced_from=date(2026, 10, 1),
        synced_to=date(2026, 10, 1),
        raw_payload={
            "orderNumber": "PO-100",
            "customerCode": "000101",
            "customerName": "KH A",
            "productCode": "SP-01",
            "productName": "Sữa Tươi",
            "quantity": 10,
            "promotionQuantity": 2,
            "totalValue": 100000,
            "totalDiscount": 10000,
            "voucherAmount": 0,
            "deliveryDate": "01/10/2026",
        },
    )
    db.add(line1)
    db.flush()

    res = _split_vinamilk_order(
        db,
        SplitOrderRequest(
            order_number="PO-100",
            splits=[
                SplitOrderTarget(items=[SplitOrderItemAllocation(snapshot_id=line1.id, quantity=4, promo_quantity=1)]),
                SplitOrderTarget(items=[SplitOrderItemAllocation(snapshot_id=line1.id, quantity=6, promo_quantity=1)]),
            ],
        ),
    )
    db.commit()

    assert res["new_order_numbers"] == ["TD-PO-100-01", "TD-PO-100-02"]

    listed = list_local_vinamilk_orders(
        from_date=date(2026, 10, 1),
        to_date=date(2026, 10, 1),
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=2000,
        db=db,
    )
    by_order = {row["orderNumber"]: row for row in listed["rows"]}
    assert by_order["PO-100"]["_replacement_display"] == "BTT: TD-PO-100-01, TD-PO-100-02"
    assert by_order["TD-PO-100-01"]["_processing_status"] == "Đơn Tách"
    assert by_order["TD-PO-100-01"]["_replacement_display"] == "TT: PO-100"
    assert by_order["TD-PO-100-01"]["totalValue"] == 40000.0
    assert by_order["TD-PO-100-02"]["totalValue"] == 60000.0

    # Kiểm tra tổng hợp bán hàng không tính trùng đơn gốc
    summary = build_sales_summary(
        db=db,
        from_date=date(2026, 10, 1),
        to_date=date(2026, 10, 1),
    )
    assert summary["totals"]["net_value"] == 100000.0
    assert summary["totals"]["net_qty"] == 10.0

    # Hoàn tác tách đơn
    rev = _revert_split_or_merge_order(db, "PO-100")
    db.commit()
    assert rev["deleted_synthetic_orders"] == ["TD-PO-100-01", "TD-PO-100-02"]


def test_merge_orders_creates_gd_order_and_aggregates_lines(db):
    for idx, (order_no, qty, promo, val) in enumerate([
        ("PO-201", 3.0, 1.0, 30000.0),
        ("PO-202", 7.0, 2.0, 70000.0),
    ]):
        db.add(
            VinamilkOrderSnapshot(
                remote_key=f"k-merge-{idx}",
                order_number=order_no,
                customer_code="000202",
                customer_name="KH B",
                product_code="SP-02",
                product_name="Sữa Chua",
                order_created_date=date(2026, 10, 1),
                delivery_date=date(2026, 10, 1),
                warehouse_updated=True,
                synced_from=date(2026, 10, 1),
                synced_to=date(2026, 10, 1),
                raw_payload={
                    "orderNumber": order_no,
                    "customerCode": "000202",
                    "customerName": "KH B",
                    "productCode": "SP-02",
                    "productName": "Sữa Chua",
                    "promotionCode": "KM-01",
                    "quantity": qty,
                    "promotionQuantity": promo,
                    "totalValue": val,
                    "totalDiscount": 0,
                    "voucherAmount": 0,
                    "deliveryDate": "01/10/2026",
                },
            )
        )
    db.flush()

    res = _merge_vinamilk_orders(
        db,
        MergeOrdersRequest(
            order_numbers=["PO-201", "PO-202"],
            representative_order_number="PO-201",
        ),
    )
    db.commit()

    new_order_no = res["new_order_number"]
    assert new_order_no == "GD-261001-001"

    listed = list_local_vinamilk_orders(
        from_date=date(2026, 10, 1),
        to_date=date(2026, 10, 1),
        source="sync",
        search=None,
        status=None,
        skip=0,
        limit=2000,
        db=db,
    )
    by_order = {row["orderNumber"]: row for row in listed["rows"]}
    assert by_order[new_order_no]["_processing_status"] == "Đơn Gộp"
    assert by_order[new_order_no]["_replacement_display"] == "TT: PO-201, PO-202"
    assert by_order[new_order_no]["quantity"] == 10.0
    assert by_order[new_order_no]["promotionQuantity"] == 3.0
    assert by_order[new_order_no]["totalValue"] == 100000.0
    assert by_order["PO-201"]["_replacement_display"] == f"BTT: {new_order_no}"
    assert by_order["PO-202"]["_replacement_display"] == f"BTT: {new_order_no}"


def test_migration_leaves_existing_order_states_unknown():
    engine = create_engine("sqlite://")
    metadata = sa.MetaData()
    snapshots = sa.Table(
        "vinamilk_order_snapshots",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("status", sa.String(80)),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(snapshots.insert(), [
            {"status": "Đã cập nhật kho"},
            {"status": "Đã trả"},
            {"status": "Đang giao"},
        ])

    migration_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "db"
        / "migrations"
        / "versions"
        / "20261006_vinamilk_order_replacements.py"
    )
    spec = spec_from_file_location("vinamilk_order_replacements_migration", migration_path)
    assert spec is not None and spec.loader is not None
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)

    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        states = connection.execute(sa.text(
            "SELECT status, warehouse_updated, returned FROM vinamilk_order_snapshots ORDER BY id"
        )).all()

    assert states == [
        ("Đã cập nhật kho", None, None),
        ("Đã trả", None, None),
        ("Đang giao", None, None),
    ]
    engine.dispose()
