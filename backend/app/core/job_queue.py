import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class JobInfo(BaseModel):
    id: str
    job_type: str
    title: str
    status: str  # PENDING, RUNNING, SUCCESS, FAILED
    progress: int  # 0 to 100
    current_step: int
    total_steps: int
    message: str
    result_summary: Optional[Dict[str, Any]] = None
    error_detail: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobQueueManager:
    """Quản lý các tác vụ chạy ngầm thời gian thực (In-memory Background Job Engine)."""

    def __init__(self):
        self._jobs: Dict[str, JobInfo] = {}
        self._lock = asyncio.Lock()

    def create_job(self, job_type: str, title: str, total_steps: int = 100) -> JobInfo:
        job_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc)
        job = JobInfo(
            id=job_id,
            job_type=job_type,
            title=title,
            status="PENDING",
            progress=0,
            current_step=0,
            total_steps=max(1, total_steps),
            message="Đã khởi tạo và đưa vào hàng đợi...",
            result_summary=None,
            error_detail=None,
            created_at=now,
            updated_at=now,
        )
        self._jobs[job_id] = job
        return job

    def start_job(self, job_id: str, message: str = "Đang bắt đầu xử lý..."):
        if job_id in self._jobs:
            self._jobs[job_id].status = "RUNNING"
            self._jobs[job_id].message = message
            self._jobs[job_id].updated_at = datetime.now(timezone.utc)

    def update_progress(self, job_id: str, current_step: int, message: Optional[str] = None):
        if job_id in self._jobs:
            job = self._jobs[job_id]
            job.current_step = current_step
            # Tính % từ 0 đến 99 (100 dành riêng cho set_success)
            percent = int((current_step / max(1, job.total_steps)) * 100)
            job.progress = min(99, max(0, percent))
            if message:
                job.message = message
            job.updated_at = datetime.now(timezone.utc)

    def set_success(self, job_id: str, result_summary: Optional[Dict[str, Any]] = None, message: str = "Hoàn tất thành công!"):
        if job_id in self._jobs:
            job = self._jobs[job_id]
            job.status = "SUCCESS"
            job.progress = 100
            job.current_step = job.total_steps
            job.message = message
            job.result_summary = result_summary
            job.updated_at = datetime.now(timezone.utc)

    def set_failed(self, job_id: str, error_detail: str):
        if job_id in self._jobs:
            job = self._jobs[job_id]
            job.status = "FAILED"
            job.message = f"Thất bại: {error_detail[:120]}"
            job.error_detail = error_detail
            job.updated_at = datetime.now(timezone.utc)

    def get_job(self, job_id: str) -> Optional[JobInfo]:
        return self._jobs.get(job_id)

    def list_active_jobs(self) -> List[JobInfo]:
        """Lấy các job đang chạy hoặc vừa hoàn thành/thất bại trong 30 giây gần nhất."""
        now = datetime.now(timezone.utc)
        active = []
        for job in self._jobs.values():
            if job.status in ("PENDING", "RUNNING"):
                active.append(job)
            else:
                # Giữ lại các job vừa xong trong 30 giây để UI kịp hiển thị hoàn tất
                diff = (now - job.updated_at).total_seconds()
                if diff <= 30:
                    active.append(job)
        return sorted(active, key=lambda x: x.created_at, reverse=True)


# Singleton Job Manager instance
job_manager = JobQueueManager()
