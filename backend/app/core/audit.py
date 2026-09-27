"""Lightweight audit trail for write operations and login attempts.

Every insert opens and closes its own DB session so a logging failure never
breaks the request it is trying to describe (best-effort, fire-and-forget).
"""
import logging
from datetime import datetime

from app.core.database import SessionLocal
from app.models.user import AuditLog, User

logger = logging.getLogger(__name__)

_ACTION_BY_METHOD = {"POST": "create", "PATCH": "update", "PUT": "update", "DELETE": "delete"}


def resource_and_id_from_path(path: str, api_prefix: str) -> tuple[str, str | None]:
    prefix_parts = [part for part in api_prefix.split("/") if part]
    parts = [part for part in path.split("/") if part]
    remainder = parts[len(prefix_parts):] if len(parts) > len(prefix_parts) else []
    resource = remainder[0] if remainder else "unknown"
    resource_id = remainder[1] if len(remainder) > 1 and remainder[1].isdigit() else None
    return resource, resource_id


def record_audit_log(
    *,
    actor: User | None,
    method: str,
    path: str,
    api_prefix: str,
    status_code: int,
    ip_address: str | None,
) -> None:
    action = _ACTION_BY_METHOD.get(method.upper())
    if not action:
        return
    resource, resource_id = resource_and_id_from_path(path, api_prefix)
    db = SessionLocal()
    try:
        db.add(
            AuditLog(
                actor_user_id=actor.id if actor else None,
                actor_username=actor.username if actor else None,
                action=action,
                resource=resource,
                resource_id=resource_id,
                path=path,
                status_code=status_code,
                ip_address=ip_address,
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
    except Exception:  # pragma: no cover - defensive, must never break the request
        logger.exception("Failed to write audit log entry for %s %s", method, path)
        db.rollback()
    finally:
        db.close()


def record_login_attempt(*, username: str, success: bool, ip_address: str | None, user: User | None = None) -> None:
    db = SessionLocal()
    try:
        db.add(
            AuditLog(
                actor_user_id=user.id if user else None,
                actor_username=username,
                action="login" if success else "login_failed",
                resource="auth",
                resource_id=None,
                path="/api/v1/auth/login",
                status_code=200 if success else 401,
                ip_address=ip_address,
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
    except Exception:  # pragma: no cover - defensive, must never break login
        logger.exception("Failed to write login audit log entry for %s", username)
        db.rollback()
    finally:
        db.close()
