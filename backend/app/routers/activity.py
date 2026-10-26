from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import require_roles
from ..models import EmailLog, User, WorkflowEvent
from ..serializers import email_dict, event_dict
from ..services.visibility import event_visibility_filter, visible_emails_query

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("/events")
def list_events(
    limit: int = Query(default=60, ge=1, le=250),
    entity_type: str | None = None,
    entity_id: int | None = None,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = db.query(WorkflowEvent).order_by(WorkflowEvent.created_at.desc())
    visibility = event_visibility_filter(db, user)
    if visibility is not None:
        query = query.filter(visibility)
    if entity_type:
        query = query.filter(WorkflowEvent.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(WorkflowEvent.entity_id == entity_id)
    return [event_dict(event) for event in query.limit(limit).all()]


@router.get("/emails")
def list_emails(
    limit: int = Query(default=60, ge=1, le=250),
    template: str | None = None,
    email_status: str | None = Query(default=None, alias="status"),
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = visible_emails_query(db, user).order_by(EmailLog.created_at.desc())
    if template:
        query = query.filter(EmailLog.template == template)
    if email_status:
        query = query.filter(EmailLog.status == email_status)
    return [email_dict(log) for log in query.limit(limit).all()]


@router.get("/email-stats")
def email_summary(
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> dict:
    logs = visible_emails_query(db, user).all()
    return {
        "total": len(logs),
        "sent": sum(1 for log in logs if log.status == "sent"),
        "logged": sum(1 for log in logs if log.status == "logged"),
        "failed": sum(1 for log in logs if log.status == "failed"),
        "mode": "smtp" if settings.smtp_host else "log-only",
    }


@router.get("/integrations")
def integrations(
    user: User = Depends(require_roles("admin")),
) -> dict:
    return {
        "smtp": {
            "configured": bool(settings.smtp_host),
            "host": settings.smtp_host or None,
            "mode": "smtp" if settings.smtp_host else "log-only",
        },
        "ai": {
            "provider": settings.ai_provider,
            "configured": bool(settings.openai_api_key)
            if settings.ai_provider == "openai"
            else True,
            "model": settings.openai_model if settings.ai_provider == "openai" else "local heuristic",
            "mode": "llm + deterministic checks"
            if settings.ai_provider == "openai" and settings.openai_api_key
            else "deterministic + heuristic",
        },
        "calendar": {
            "configured": True,
            "mode": "ICS + local meeting links",
            "timezone": settings.company_timezone,
        },
        "scheduler": {
            "enabled": settings.scheduler_enabled,
            "interval_minutes": settings.reminder_interval_minutes,
        },
        "uploads": {
            "max_upload_mb": settings.max_upload_mb,
            "storage": settings.storage_dir,
        },
    }
