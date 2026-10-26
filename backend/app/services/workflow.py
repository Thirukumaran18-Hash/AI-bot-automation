from sqlalchemy.orm import Session

from ..models import WorkflowEvent


def record_event(
    db: Session,
    entity_type: str,
    entity_id: int,
    action: str,
    previous_status: str | None = None,
    new_status: str | None = None,
    actor_id: int | None = None,
    meta: dict | None = None,
) -> WorkflowEvent:
    event = WorkflowEvent(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        previous_status=previous_status,
        new_status=new_status,
        actor_id=actor_id,
        meta=meta or {},
    )
    db.add(event)
    return event
