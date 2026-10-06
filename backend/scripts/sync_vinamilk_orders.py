"""Sync recent Vinamilk orders into the snapshot tables (cron job)."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.api.v1.endpoints.sync import read_cookie, sync_vinamilk_day
from app.core.database import SessionLocal
from app.models.vinamilk import VinamilkSyncRun
from app.services.vinamilk_dates import iter_inclusive_dates

# Đơn có thể bị trả / cập nhật kho muộn vài ngày sau khi tạo, nên quét lại 5 ngày gần nhất.
LOOKBACK_DAYS = 5


async def sync_days(db, from_date: date, to_date: date) -> tuple[int, int, list[dict[str, Any]]]:
    """Dùng chung đường đồng bộ với nút "Đồng bộ" trên web (export Excel + trạng thái kho/trả)."""
    cookie = read_cookie()
    saved_total = 0
    synced_days = 0
    failed_days: list[dict[str, Any]] = []
    for day in iter_inclusive_dates(from_date, to_date):
        day_form = {
            "fromDate": day.strftime("%d/%m/%Y"),
            "toDate": day.strftime("%d/%m/%Y"),
            "page": "1",
            "rows": "2000",
        }
        try:
            cookie, row_count = await sync_vinamilk_day(db, day_form, day, cookie)
            saved_total += row_count
            synced_days += 1
            print(f"Vinamilk day sync saved={row_count} date={day}")
        except Exception as exc:
            db.rollback()
            failed_days.append({"date": day.isoformat(), "error": str(exc)})
            print(f"Vinamilk day sync failed date={day} error={exc}")
    return saved_total, synced_days, failed_days


def main() -> None:
    today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    from_date = today - timedelta(days=LOOKBACK_DAYS - 1)
    with SessionLocal() as db:
        sync_run = VinamilkSyncRun(from_date=from_date, to_date=today, status="RUNNING")
        db.add(sync_run)
        db.commit()
        try:
            saved_total, synced_days, failed_days = asyncio.run(sync_days(db, from_date, today))
            if failed_days and synced_days == 0:
                raise RuntimeError("; ".join(f"{item['date']}: {item['error']}" for item in failed_days))
            sync_run.status = "PARTIAL" if failed_days else "SUCCESS"
            sync_run.row_count = saved_total
            sync_run.error_message = (
                "; ".join(f"{item['date']}: {item['error']}" for item in failed_days) if failed_days else None
            )
            sync_run.finished_at = datetime.utcnow()
            db.commit()
            print(
                f"Vinamilk order sync completed: saved={saved_total} from={from_date} to={today} "
                f"failed_days={len(failed_days)}"
            )
            if failed_days:
                raise RuntimeError(sync_run.error_message)
        except Exception as exc:
            db.rollback()
            if sync_run.status == "RUNNING":
                sync_run.status = "FAILED"
                sync_run.error_message = str(exc)
                sync_run.finished_at = datetime.utcnow()
                db.add(sync_run)
                db.commit()
            raise


if __name__ == "__main__":
    main()
