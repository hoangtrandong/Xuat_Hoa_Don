from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.job_queue import JobQueueManager
from app.models.multi_tenant_invoice import (
    BackgroundJob,
    Distributor,
    IssuedInvoice,
    IssuedInvoiceItem,
    PurchaseInvoice,
    PurchaseInvoiceItem,
    TaxAuthorityCredential,
)
from app.services.tax_inventory_service import (
    list_monthly_tax_inventory_snapshots,
    rebuild_monthly_tax_inventory_snapshots,
)


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, future=True)


def test_postgres_backed_job_queue_persists_across_instances_and_recovers_stale_jobs(session_factory):
    mgr1 = JobQueueManager(session_factory=session_factory)
    job = mgr1.create_job("sync_cqt", "Đồng bộ CQT", total_steps=10)
    mgr1.start_job(job.id, "Bắt đầu đồng bộ")
    mgr1.update_progress(job.id, 5, "Đang xử lý 5/10")

    # Giả lập worker/container khác đọc lại từ DB (RAM trống hoàn toàn)
    mgr2 = JobQueueManager(session_factory=session_factory)
    loaded = mgr2.get_job(job.id)
    assert loaded is not None
    assert loaded.status == "RUNNING"
    assert loaded.progress == 50
    assert loaded.current_step == 5

    # Giả lập job bị treo quá 25 phút -> list_active_jobs phải tự thu hồi thành FAILED
    with session_factory() as db:
        row = db.get(BackgroundJob, job.id)
        row.updated_at = (datetime.now(timezone.utc) - timedelta(minutes=25)).replace(tzinfo=None)
        db.commit()

    mgr3 = JobQueueManager(session_factory=session_factory)
    mgr3.list_active_jobs()
    recovered = mgr3.get_job(job.id)
    assert recovered is not None
    assert recovered.status == "FAILED"
    assert "quá thời gian" in (recovered.error_detail or "")


def test_monthly_tax_inventory_snapshot_rebuild_and_fast_read(session_factory):
    with session_factory() as db:
        dist = Distributor(code="NPP-SNAP", name="NPP Snapshot", tax_code="0105555555")
        db.add(dist)
        db.flush()
        cred = TaxAuthorityCredential(distributor_id=dist.id, username="0105555555")
        db.add(cred)
        db.flush()

        p = PurchaseInvoice(
            distributor_id=dist.id,
            tax_credential_id=cred.id,
            invoice_template="1",
            invoice_symbol="1C26TAA",
            invoice_number="0000777",
            invoice_date=datetime(2026, 11, 5, 9, 0),
            seller_tax_code="0300588569",
            seller_name="Vinamilk",
            buyer_tax_code="0105555555",
            xml_downloaded=True,
        )
        db.add(p)
        db.flush()
        db.add(
            PurchaseInvoiceItem(
                purchase_invoice_id=p.id,
                item_nature=1,
                product_code="SKU-S1",
                product_name="Sữa Snapshot",
                unit_name="THUNG",
                quantity=20,
                unit_price=150_000,
                amount_before_tax=3_000_000,
            )
        )

        s = IssuedInvoice(
            distributor_id=dist.id,
            seller_tax_code="0105555555",
            provider="VIETTEL",
            invoice_template_code="1/001",
            invoice_series="1C26TDD",
            invoice_number="0000888",
            status="ISSUED",
            buyer_name="KH Snap",
            issued_at=datetime(2026, 11, 15, 10, 0),
        )
        db.add(s)
        db.flush()
        db.add(
            IssuedInvoiceItem(
                invoice_id=s.id,
                item_type="NORMAL",
                product_code="SKU-S1",
                product_name="Sữa Snapshot",
                unit_name="THUNG",
                quantity=8,
                source_sku="SKU-S1",
                source_quantity=8,
                amount_before_tax=1_440_000,
            )
        )
        db.commit()

        rebuilt = rebuild_monthly_tax_inventory_snapshots(
            db,
            distributor_id=dist.id,
            year_month="2026-11",
        )
        assert rebuilt["upserted_rows"] == 1

        fast_read = list_monthly_tax_inventory_snapshots(
            db,
            distributor_id=dist.id,
            year_month="2026-11",
        )
        assert fast_read["summary"]["total_skus"] == 1
        assert fast_read["summary"]["total_cogs_amount"] == 1_200_000.0
        assert fast_read["summary"]["total_closing_amount"] == 1_800_000.0
        assert fast_read["items"][0]["closing_qty"] == 12.0
