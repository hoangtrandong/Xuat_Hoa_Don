from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.crud.debt_ledger import (
    create_debt_transfer,
    get_employee_balance,
    get_store_balance,
    list_debt_transfers,
)
from app.models.customer import Store
from app.models.employee import Employee
from app.models.finance import DebtLedgerEntry, DebtTransfer


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        employee_one = Employee(
            code="TRF-EMP-1",
            name="Employee One",
            position="Delivery",
            phone="0000000001",
        )
        employee_two = Employee(
            code="TRF-EMP-2",
            name="Employee Two",
            position="Delivery",
            phone="0000000002",
        )
        store_one = Store(code="TRF-STORE-1", name="Store One")
        store_two = Store(code="TRF-STORE-2", name="Store Two")
        session.add_all([employee_one, employee_two, store_one, store_two])
        session.commit()
        yield session, employee_one, employee_two, store_one, store_two
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.mark.parametrize(
    ("source_type", "destination_type"),
    [
        ("EMPLOYEE", "STORE"),
        ("EMPLOYEE", "EMPLOYEE"),
        ("STORE", "EMPLOYEE"),
        ("STORE", "STORE"),
    ],
)
def test_transfer_moves_debt_between_supported_party_types(
    db, source_type, destination_type
):
    session, employee_one, employee_two, store_one, store_two = db
    parties = {
        ("EMPLOYEE", employee_one.id): employee_one,
        ("EMPLOYEE", employee_two.id): employee_two,
        ("STORE", store_one.id): store_one,
        ("STORE", store_two.id): store_two,
    }
    source = parties[(source_type, employee_one.id if source_type == "EMPLOYEE" else store_one.id)]
    recipient = parties[(destination_type, employee_two.id if destination_type == "EMPLOYEE" else store_two.id)]
    session.add(DebtLedgerEntry(
        party_type=source_type,
        party_id=source.id,
        entry_type="ADJUSTMENT",
        amount=Decimal("5000"),
        source_type="MANUAL",
        note="Opening debt",
    ))
    session.commit()

    transfer = create_debt_transfer(
        session,
        from_party_type=source_type,
        from_party_id=source.id,
        to_party_type=destination_type,
        to_party_id=recipient.id,
        amount=3000,
        reason="Confirmed with accounting",
        created_by="accountant",
    )

    balance = get_employee_balance if source_type == "EMPLOYEE" else get_store_balance
    recipient_balance = (
        get_employee_balance if destination_type == "EMPLOYEE" else get_store_balance
    )
    assert balance(session, source.id) == 2000
    assert recipient_balance(session, recipient.id) == 3000
    assert transfer.status == "COMPLETED"
    entries = session.scalars(
        select(DebtLedgerEntry).where(DebtLedgerEntry.source_id == transfer.id)
    ).all()
    assert {(entry.party_type, entry.party_id, entry.entry_type, Decimal(entry.amount)) for entry in entries} == {
        (source_type, source.id, "TRANSFER_OUT", Decimal("-3000.00")),
        (destination_type, recipient.id, "TRANSFER_IN", Decimal("3000.00")),
    }


def test_transfer_rejects_amount_over_source_balance_without_writing(db):
    session, employee_one, employee_two, _, _ = db
    session.add(DebtLedgerEntry(
        party_type="EMPLOYEE",
        party_id=employee_one.id,
        entry_type="ADJUSTMENT",
        amount=Decimal("1000"),
        source_type="MANUAL",
    ))
    session.commit()

    with pytest.raises(ValueError, match="vượt công nợ hiện tại"):
        create_debt_transfer(
            session,
            "EMPLOYEE",
            employee_one.id,
            "EMPLOYEE",
            employee_two.id,
            1001,
        )

    assert session.scalar(select(DebtTransfer.id)) is None
    assert session.scalar(
        select(DebtLedgerEntry.id).where(DebtLedgerEntry.entry_type == "TRANSFER_OUT")
    ) is None


def test_transfer_rejects_same_party_and_unknown_party_without_writing(db):
    session, employee_one, employee_two, _, _ = db
    with pytest.raises(ValueError, match="phải khác nhau"):
        create_debt_transfer(
            session,
            "EMPLOYEE",
            employee_one.id,
            "EMPLOYEE",
            employee_one.id,
            100,
        )
    with pytest.raises(ValueError, match="Không tìm thấy nhân viên"):
        create_debt_transfer(
            session,
            "EMPLOYEE",
            employee_one.id,
            "EMPLOYEE",
            9999,
            100,
        )

    assert session.scalar(select(DebtTransfer.id)) is None
    assert session.scalar(select(DebtLedgerEntry.id)) is None


def test_transfer_history_hides_legacy_requests_without_debt_movement(db):
    session, employee_one, _, _, store_two = db
    common = {
        "from_party_type": "EMPLOYEE",
        "from_party_id": employee_one.id,
        "to_party_type": "STORE",
        "to_party_id": store_two.id,
        "amount": Decimal("1000"),
    }
    pending = DebtTransfer(code="TRF-PENDING", status="PENDING", **common)
    completed = DebtTransfer(code="TRF-COMPLETED", status="COMPLETED", **common)
    session.add_all([pending, completed])
    session.commit()

    assert [transfer.code for transfer in list_debt_transfers(session)] == [
        "TRF-COMPLETED"
    ]
