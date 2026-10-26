from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import ensure_assignment_access, require_roles
from ..config import settings
from ..models import Assignment, Intern, Meeting, Task, User
from ..schemas import AssignmentCreate, AutoAssignRequest, StatusUpdateRequest
from ..serializers import assignment_dict
from ..services.email_service import send_email
from ..services.workflow import record_event
from ..utils import human_datetime

router = APIRouter(prefix="/assignments", tags=["assignments"])

OPEN_STATUSES = {
    "assigned",
    "in_progress",
    "submitted",
    "evaluating",
    "human_review",
    "revision_required",
    "resubmitted",
    "review_scheduled",
}


def _naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _current_intern(db: Session, user: User) -> Intern | None:
    if user.role != "intern":
        return None
    return db.query(Intern).filter(Intern.user_id == user.id).first()


def _assignment_email_context(assignment: Assignment) -> dict:
    return {
        "name": assignment.intern.user.name,
        "email": assignment.intern.user.email,
        "task_title": assignment.task.title,
        "domain": assignment.task.domain,
        "due_date": human_datetime(assignment.due_date),
        "deliverables": ", ".join(assignment.task.deliverables or []),
        "batch": assignment.intern.batch,
        "portal_url": f"{settings.app_public_url.rstrip('/')}/assignments/{assignment.id}",
    }


def _create_assignment(
    db: Session,
    task: Task,
    intern: Intern,
    due_date: datetime,
    actor: User,
) -> Assignment:
    assignment = Assignment(
        task_id=task.id,
        intern_id=intern.id,
        due_date=due_date,
        status="assigned",
        assigned_by=actor.id,
    )
    db.add(assignment)
    db.flush()
    record_event(
        db,
        "assignment",
        assignment.id,
        "assignment.created",
        previous_status=None,
        new_status="assigned",
        actor_id=actor.id,
        meta={
            "task_id": task.id,
            "intern_id": intern.id,
            "due_date": due_date.isoformat(),
        },
    )
    send_email(
        db,
        recipient=intern.user.email,
        template="assignment",
        context=_assignment_email_context(assignment),
        entity_type="assignment",
        entity_id=assignment.id,
        dedupe=True,
    )
    return assignment


@router.get("")
def list_assignments(
    assignment_status: str | None = Query(default=None, alias="status"),
    batch: str | None = None,
    domain: str | None = None,
    overdue: bool | None = None,
    search: str | None = None,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = db.query(Assignment).join(Intern, Assignment.intern_id == Intern.id)
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)
    elif user.role == "intern":
        query = query.filter(Intern.user_id == user.id)

    if assignment_status:
        statuses = [item.strip() for item in assignment_status.split(",") if item.strip()]
        query = query.filter(Assignment.status.in_(statuses))
    if batch:
        query = query.filter(Intern.batch == batch)
    if domain:
        query = query.filter(Intern.domain == domain)
    if overdue:
        query = query.filter(
            Assignment.due_date < datetime.utcnow(),
            Assignment.status.in_(OPEN_STATUSES),
        )
    if search:
        pattern = f"%{search.lower()}%"
        query = query.join(Task, Assignment.task_id == Task.id).join(
            User, Intern.user_id == User.id
        ).filter(
            or_(Task.title.ilike(pattern), User.name.ilike(pattern), User.email.ilike(pattern))
        )
    assignments = query.order_by(Assignment.due_date.asc()).all()
    return [assignment_dict(item) for item in assignments]


@router.get("/{assignment_id}")
def get_assignment(
    assignment_id: int,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> dict:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    ensure_assignment_access(assignment, user, _current_intern(db, user))
    return assignment_dict(assignment, detail=True)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    task = db.get(Task, payload.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "approved":
        raise HTTPException(status_code=400, detail="Approve the task before assigning it")
    intern = db.get(Intern, payload.intern_id)
    if not intern or not intern.active:
        raise HTTPException(status_code=404, detail="Active intern not found")
    if user.role == "mentor" and intern.mentor_id != user.id:
        raise HTTPException(status_code=403, detail="You can only assign tasks to your mentees")

    existing = (
        db.query(Assignment)
        .filter(
            Assignment.intern_id == intern.id,
            Assignment.task_id == task.id,
            Assignment.status.in_(OPEN_STATUSES),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This task is already active for the intern")

    if payload.due_date:
        due_date = _naive_utc(payload.due_date)
    else:
        due_date = datetime.utcnow() + timedelta(days=task.deadline_days)

    assignment = _create_assignment(db, task, intern, due_date, user)
    db.commit()
    db.refresh(assignment)
    return assignment_dict(assignment)


@router.post("/auto")
def auto_assign(
    payload: AutoAssignRequest,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    task = db.get(Task, payload.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "approved":
        raise HTTPException(status_code=400, detail="Approve the task before assigning it")

    query = db.query(Intern).filter(Intern.active.is_(True))
    if payload.batch:
        query = query.filter(Intern.batch == payload.batch)
    if payload.domain:
        query = query.filter(Intern.domain == payload.domain)
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)

    interns = query.all()
    created = []
    skipped = 0
    due_date = datetime.utcnow() + timedelta(days=task.deadline_days)
    for intern in interns:
        exists = (
            db.query(Assignment)
            .filter(
                Assignment.intern_id == intern.id,
                Assignment.task_id == task.id,
                Assignment.status.in_(OPEN_STATUSES),
            )
            .first()
        )
        if exists:
            skipped += 1
            continue
        created.append(_create_assignment(db, task, intern, due_date, user))

    db.commit()
    return {
        "created_count": len(created),
        "skipped_count": skipped,
        "eligible_count": len(interns),
        "assignments": [assignment_dict(item) for item in created],
    }


@router.post("/{assignment_id}/remind")
def remind(
    assignment_id: int,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if user.role == "mentor" and assignment.intern.mentor_id != user.id:
        raise HTTPException(status_code=403, detail="This assignment is not assigned to you")
    if assignment.status not in OPEN_STATUSES:
        raise HTTPException(status_code=400, detail="This assignment is already closed")

    overdue = assignment.due_date < datetime.utcnow()
    next_meeting = (
        db.query(Meeting)
        .filter(
            Meeting.assignment_id == assignment.id,
            Meeting.status == "scheduled",
            Meeting.start_time >= datetime.utcnow(),
        )
        .order_by(Meeting.start_time)
        .first()
    )
    log = send_email(
        db,
        recipient=assignment.intern.user.email,
        template="overdue" if overdue else "reminder",
        context={
            **_assignment_email_context(assignment),
            "meeting_title": assignment.task.title,
            "start_time": human_datetime(assignment.due_date),
            "meeting_time": human_datetime(next_meeting.start_time) if next_meeting else "",
            "duration": "n/a",
            "join_url": next_meeting.join_url if next_meeting else "",
            "agenda": "Please complete the assigned task and submit it through the portal.",
        },
        entity_type="assignment",
        entity_id=assignment.id,
    )
    record_event(
        db,
        "assignment",
        assignment.id,
        "reminder.sent",
        actor_id=user.id,
        meta={"recipient": assignment.intern.user.email, "template": "overdue" if overdue else "reminder"},
    )
    db.commit()
    return {
        "message": "Reminder processed",
        "email_status": log.status if log else "skipped",
        "recipient": assignment.intern.user.email,
    }


@router.post("/{assignment_id}/status")
def update_status(
    assignment_id: int,
    payload: StatusUpdateRequest,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> dict:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    ensure_assignment_access(assignment, user, _current_intern(db, user))

    allowed_for_intern = {
        "assigned": {"in_progress"},
        "revision_required": {"in_progress"},
        "resubmitted": {"in_progress"},
    }
    if user.role == "intern":
        allowed = allowed_for_intern.get(assignment.status, set())
        if payload.status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot move from {assignment.status} to {payload.status}",
            )
    else:
        allowed_admin = {
            "submitted": {"review_scheduled"},
            "approved": {"review_scheduled", "completed"},
            "human_review": {"review_scheduled", "revision_required"},
            "revision_required": {"review_scheduled", "completed"},
            "review_scheduled": {"completed"},
            "in_progress": {"completed"},
            "assigned": {"completed"},
        }
        allowed = allowed_admin.get(assignment.status, set())
        if payload.status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot move from {assignment.status} to {payload.status}",
            )

    previous = assignment.status
    assignment.status = payload.status
    record_event(
        db,
        "assignment",
        assignment.id,
        "assignment.status_changed",
        previous_status=previous,
        new_status=payload.status,
        actor_id=user.id,
    )
    db.commit()
    db.refresh(assignment)
    return assignment_dict(assignment, detail=True)
