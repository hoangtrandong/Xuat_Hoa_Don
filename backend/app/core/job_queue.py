from __future__ import annotations

import asyncio
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from sqlalchemy import delete, select

STALE_RUNNING_MINUTES = 5


class JobInfo(BaseModel):
    id: str
    job_type: str
    title: str
    status: str  # PENDING, RUNNING, SUCCESS, FAILED
    progress: int  # 0 to 100
    current_step: int
    total_steps: int
    message: str
    items: List[Dict[str, Any]] = []
    logs: List[Dict[str, Any]] = []
    result_summary: Optional[Dict[str, Any]] = None
    error_detail: Optional[str] = None
    created_at: datetime
    updated_at: datetime


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _to_naive_utc(dt: datetime) -> datetime:
    return _ensure_utc(dt).replace(tzinfo=None)


class JobQueueManager:
    """Quản lý các tác vụ chạy ngầm thời gian thực lưu bền vững trong PostgreSQL (`background_jobs`),
    an toàn khi restart container/đa worker, kèm cơ chế tự phát hiện stale job và fallback ổ đĩa tạm."""

    def __init__(self, session_factory: Any = None):
        self._jobs: Dict[str, JobInfo] = {}
        self._lock = asyncio.Lock()
        self._session_factory = session_factory
        self._store_dir = Path(tempfile.gettempdir()) / "dms_sync_jobs"
        try:
            self._store_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    def _get_session_factory(self):
        if self._session_factory is not None:
            return self._session_factory
        try:
            from app.core.database import SessionLocal
            return SessionLocal
        except Exception:
            return None

    def _job_path(self, job_id: str) -> Path:
        safe_id = "".join(ch for ch in job_id if ch.isalnum() or ch in ("-", "_"))
        return self._store_dir / f"{safe_id}.json"

    def _row_to_job(self, row: Any) -> JobInfo:
        return JobInfo(
            id=row.id,
            job_type=row.job_type,
            title=row.title,
            status=row.status,
            progress=row.progress,
            current_step=row.current_step,
            total_steps=row.total_steps,
            message=row.message or "",
            items=list(row.items_json or []),
            logs=list(row.logs_json or []),
            result_summary=row.result_summary_json,
            error_detail=row.error_detail,
            created_at=_ensure_utc(row.created_at),
            updated_at=_ensure_utc(row.updated_at),
        )

    def _persist_db(self, job: JobInfo) -> bool:
        factory = self._get_session_factory()
        if factory is None:
            return False
        try:
            from app.models.multi_tenant_invoice import BackgroundJob

            with factory() as db:
                row = db.get(BackgroundJob, job.id)
                if row is None:
                    row = BackgroundJob(
                        id=job.id,
                        job_type=job.job_type,
                        title=job.title,
                        created_at=_to_naive_utc(job.created_at),
                    )
                    db.add(row)
                row.status = job.status
                row.progress = job.progress
                row.current_step = job.current_step
                row.total_steps = job.total_steps
                row.message = job.message
                row.items_json = list(job.items)
                row.logs_json = list(job.logs)
                row.result_summary_json = job.result_summary
                row.error_detail = job.error_detail
                row.updated_at = _to_naive_utc(job.updated_at)
                db.commit()
            return True
        except Exception:
            return False

    def _load_from_db(self, job_id: str) -> Optional[JobInfo]:
        factory = self._get_session_factory()
        if factory is None:
            return None
        try:
            from app.models.multi_tenant_invoice import BackgroundJob

            with factory() as db:
                row = db.get(BackgroundJob, job_id)
                if row is None:
                    return None
                job = self._row_to_job(row)
                self._jobs[job.id] = job
                return job
        except Exception:
            return None

    def _persist_disk(self, job: JobInfo) -> None:
        try:
            self._store_dir.mkdir(parents=True, exist_ok=True)
            target = self._job_path(job.id)
            tmp = target.with_suffix(f".{os.getpid()}.tmp")
            tmp.write_text(job.model_dump_json(), encoding="utf-8")
            os.replace(tmp, target)
        except OSError:
            pass

    def _load_from_disk(self, job_id: str) -> Optional[JobInfo]:
        path = self._job_path(job_id)
        if not path.is_file():
            return None
        try:
            raw = path.read_text(encoding="utf-8")
            job = JobInfo.model_validate_json(raw)
            self._jobs[job.id] = job
            return job
        except Exception:
            return None

    def _persist(self, job: JobInfo) -> None:
        if not self._persist_db(job):
            self._persist_disk(job)

    def _load(self, job_id: str) -> Optional[JobInfo]:
        db_job = self._load_from_db(job_id)
        if db_job is not None:
            return db_job
        disk_job = self._load_from_disk(job_id)
        if disk_job is not None:
            return disk_job
        return self._jobs.get(job_id)

    def _push_log(self, job: JobInfo, message: str, level: str = "info") -> None:
        if not message:
            return
        if job.logs and job.logs[-1].get("message") == message:
            return
        job.logs.append(
            {
                "time": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "message": message,
            }
        )
        if len(job.logs) > 60:
            job.logs = job.logs[-60:]

    def create_job(self, job_type: str, title: str, total_steps: int = 100) -> JobInfo:
        job_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc)
        initial_msg = "Đã khởi tạo và đưa vào hàng đợi..."
        job = JobInfo(
            id=job_id,
            job_type=job_type,
            title=title,
            status="PENDING",
            progress=0,
            current_step=0,
            total_steps=max(1, total_steps),
            message=initial_msg,
            items=[],
            logs=[{"time": now.isoformat(), "level": "info", "message": initial_msg}],
            result_summary=None,
            error_detail=None,
            created_at=now,
            updated_at=now,
        )
        self._jobs[job_id] = job
        self._persist(job)
        return job

    def set_total_steps(self, job_id: str, total_steps: int) -> None:
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            job.total_steps = max(1, total_steps)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def set_items(self, job_id: str, items: List[Dict[str, Any]]) -> None:
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            job.items = list(items)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def update_item(self, job_id: str, item_id: Any, **fields: Any) -> None:
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            for item in job.items:
                if item.get("id") == item_id:
                    item.update(fields)
                    break
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def append_log(self, job_id: str, message: str, level: str = "info") -> None:
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            self._push_log(job, message, level=level)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def start_job(self, job_id: str, message: str = "Đang bắt đầu xử lý..."):
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            job.status = "RUNNING"
            job.message = message
            self._push_log(job, message, level="info")
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def update_progress(
        self,
        job_id: str,
        current_step: int,
        message: Optional[str] = None,
        level: str = "info",
    ):
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            job.current_step = current_step
            percent = int((current_step / max(1, job.total_steps)) * 100)
            job.progress = min(99, max(0, percent))
            if message:
                job.message = message
                self._push_log(job, message, level=level)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def set_success(
        self,
        job_id: str,
        result_summary: Optional[Dict[str, Any]] = None,
        message: str = "Hoàn tất thành công!",
    ):
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            job.status = "SUCCESS"
            job.progress = 100
            job.current_step = job.total_steps
            job.message = message
            job.result_summary = result_summary
            self._push_log(job, message, level="success")
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def set_failed(self, job_id: str, error_detail: str):
        job = self._jobs.get(job_id) or self._load(job_id)
        if job:
            job.status = "FAILED"
            job.message = f"Thất bại: {error_detail[:120]}"
            job.error_detail = error_detail
            self._push_log(job, f"Lỗi: {error_detail}", level="error")
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def fail_orphaned_jobs_on_startup(self) -> int:
        """Thu hồi toàn bộ job PENDING/RUNNING mồ côi khi backend khởi động lại."""
        factory = self._get_session_factory()
        if factory is None:
            return 0
        now_naive = _to_naive_utc(datetime.now(timezone.utc))
        reason = "Tiến trình bị gián đoạn do máy chủ vừa khởi động lại. Vui lòng bấm đồng bộ lại."
        recovered = 0
        try:
            from app.models.multi_tenant_invoice import BackgroundJob

            with factory() as db:
                rows = db.scalars(
                    select(BackgroundJob).where(BackgroundJob.status.in_(("PENDING", "RUNNING")))
                ).all()
                for row in rows:
                    row.status = "FAILED"
                    row.error_detail = reason
                    row.message = f"Thất bại: {reason}"
                    row.updated_at = now_naive
                    recovered += 1
                if recovered > 0:
                    db.commit()
        except Exception:
            return 0
        return recovered

    def get_job(self, job_id: str) -> Optional[JobInfo]:
        return self._load(job_id)

    def list_active_jobs(self) -> List[JobInfo]:
        """Lấy các job đang chạy hoặc vừa hoàn thành/thất bại trong 30 giây gần nhất,
        đồng thời tự động thu hồi các job bị treo quá 20 phút."""
        now = datetime.now(timezone.utc)
        stale_cutoff = now - timedelta(minutes=STALE_RUNNING_MINUTES)
        merged: Dict[str, JobInfo] = dict(self._jobs)

        factory = self._get_session_factory()
        if factory is not None:
            try:
                from app.models.multi_tenant_invoice import BackgroundJob

                with factory() as db:
                    rows = db.scalars(
                        select(BackgroundJob).order_by(BackgroundJob.created_at.desc()).limit(100)
                    ).all()
                    dirty = False
                    for row in rows:
                        job = self._row_to_job(row)
                        if job.status in ("PENDING", "RUNNING") and job.updated_at < stale_cutoff:
                            row.status = "FAILED"
                            row.error_detail = "Tác vụ quá thời gian xử lý hoặc máy chủ đã khởi động lại."
                            row.message = f"Thất bại: {row.error_detail}"
                            row.updated_at = _to_naive_utc(now)
                            job = self._row_to_job(row)
                            dirty = True
                        merged[job.id] = job
                    # Dọn job hoàn tất cũ hơn 24 giờ để bảng gọn nhẹ
                    cleanup_before = _to_naive_utc(now - timedelta(hours=24))
                    db.execute(
                        delete(BackgroundJob).where(
                            BackgroundJob.status.notin_(("PENDING", "RUNNING")),
                            BackgroundJob.updated_at < cleanup_before,
                        )
                    )
                    if dirty:
                        db.commit()
                    else:
                        db.commit()
            except Exception:
                pass

        if self._store_dir.is_dir():
            for path in self._store_dir.glob("*.json"):
                try:
                    job = JobInfo.model_validate_json(path.read_text(encoding="utf-8"))
                    if job.id not in merged:
                        merged[job.id] = job
                    if job.status not in ("PENDING", "RUNNING"):
                        age = (now - _ensure_utc(job.updated_at)).total_seconds()
                        if age > 600:
                            path.unlink(missing_ok=True)
                except Exception:
                    continue

        active = []
        for job in merged.values():
            if job.status in ("PENDING", "RUNNING"):
                active.append(job)
            else:
                diff = (now - _ensure_utc(job.updated_at)).total_seconds()
                if diff <= 30:
                    active.append(job)
        return sorted(active, key=lambda x: x.created_at, reverse=True)


# Singleton Job Manager instance
job_manager = JobQueueManager()
