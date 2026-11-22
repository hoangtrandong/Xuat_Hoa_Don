import asyncio
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
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
    items: List[Dict[str, Any]] = []
    logs: List[Dict[str, Any]] = []
    result_summary: Optional[Dict[str, Any]] = None
    error_detail: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobQueueManager:
    """Quản lý các tác vụ chạy ngầm thời gian thực, đồng bộ trạng thái giữa nhiều worker
    thông qua thư mục tạm dùng chung (atomic file write)."""

    def __init__(self):
        self._jobs: Dict[str, JobInfo] = {}
        self._lock = asyncio.Lock()
        self._store_dir = Path(tempfile.gettempdir()) / "dms_sync_jobs"
        try:
            self._store_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    def _job_path(self, job_id: str) -> Path:
        safe_id = "".join(ch for ch in job_id if ch.isalnum() or ch in ("-", "_"))
        return self._store_dir / f"{safe_id}.json"

    def _persist(self, job: JobInfo) -> None:
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
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
        if job:
            job.total_steps = max(1, total_steps)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def set_items(self, job_id: str, items: List[Dict[str, Any]]) -> None:
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
        if job:
            job.items = list(items)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def update_item(self, job_id: str, item_id: Any, **fields: Any) -> None:
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
        if job:
            for item in job.items:
                if item.get("id") == item_id:
                    item.update(fields)
                    break
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def append_log(self, job_id: str, message: str, level: str = "info") -> None:
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
        if job:
            self._push_log(job, message, level=level)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def start_job(self, job_id: str, message: str = "Đang bắt đầu xử lý..."):
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
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
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
        if job:
            job.current_step = current_step
            percent = int((current_step / max(1, job.total_steps)) * 100)
            job.progress = min(99, max(0, percent))
            if message:
                job.message = message
                self._push_log(job, message, level=level)
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def set_success(self, job_id: str, result_summary: Optional[Dict[str, Any]] = None, message: str = "Hoàn tất thành công!"):
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
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
        job = self._jobs.get(job_id) or self._load_from_disk(job_id)
        if job:
            job.status = "FAILED"
            job.message = f"Thất bại: {error_detail[:120]}"
            job.error_detail = error_detail
            self._push_log(job, f"Lỗi: {error_detail}", level="error")
            job.updated_at = datetime.now(timezone.utc)
            self._persist(job)

    def get_job(self, job_id: str) -> Optional[JobInfo]:
        # Luôn ưu tiên đọc bản mới nhất từ ổ đĩa để các uvicorn worker đồng bộ với nhau
        disk_job = self._load_from_disk(job_id)
        if disk_job is not None:
            return disk_job
        return self._jobs.get(job_id)

    def list_active_jobs(self) -> List[JobInfo]:
        """Lấy các job đang chạy hoặc vừa hoàn thành/thất bại trong 30 giây gần nhất."""
        now = datetime.now(timezone.utc)
        merged: Dict[str, JobInfo] = dict(self._jobs)
        if self._store_dir.is_dir():
            for path in self._store_dir.glob("*.json"):
                try:
                    job = JobInfo.model_validate_json(path.read_text(encoding="utf-8"))
                    merged[job.id] = job
                    # Dọn các file job cũ đã hoàn tất quá 10 phút
                    if job.status not in ("PENDING", "RUNNING"):
                        age = (now - job.updated_at).total_seconds()
                        if age > 600:
                            path.unlink(missing_ok=True)
                            merged.pop(job.id, None)
                except Exception:
                    continue

        active = []
        for job in merged.values():
            if job.status in ("PENDING", "RUNNING"):
                active.append(job)
            else:
                diff = (now - job.updated_at).total_seconds()
                if diff <= 30:
                    active.append(job)
        return sorted(active, key=lambda x: x.created_at, reverse=True)


# Singleton Job Manager instance
job_manager = JobQueueManager()
