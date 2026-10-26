from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import ensure_assignment_access, require_roles
from ..models import Assignment, Intern, Meeting, User
from ..schemas import MeetingCreate
from ..serializers import meeting_dict
from ..services.calendar_service import build_ics, create_provider_event
from ..services.email_service import send_email
from ..services.workflow import record_event
from ..utils import human_datetime

router = APIRouter(prefix="/meetings", tags=["meetings"])


def _naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _current_intern(db: Session, user: User) -> Intern | None:
    if user.role != "intern":
        return None
    return db.query(Intern).filter(Intern.user_id == user.id).first()


def _meeting_emails(meeting: Meeting, db: Session) -> list[str]:
    recipients: list[str] = []
    assignment = meeting.assignment
    if assignment:
        recipients.append(assignment.intern.user.email)
        if assignment.intern.mentor:
            recipients.append(assignment.intern.mentor.email)
    return list(dict.fromkeys(recipients))


def _meeting_context(meeting: Meeting) -> dict:
    assignment = meeting.assignment
    intern = assignment.intern if assignment else None
    return {
        "name": intern.user.name if intern else "there",
        "email": intern.user.email if intern else "",
        "task_title": assignment.task.title if assignment else meeting.title,
        "meeting_title": meeting.title,
        "start_time": human_datetime(meeting.start_time),
        "duration": str(int((meeting.end_time - meeting.start_time).total_seconds() // 60)),
        "join_url": meeting.join_url,
        "agenda": meeting.agenda or "Review submission and agree next steps",
    }


@router.get("")
def list_meetings(
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = db.query(Meeting)
    if user.role != "admin":
        query = query.join(Assignment, Meeting.assignment_id == Assignment.id).join(
            Intern, Assignment.intern_id == Intern.id
        )
        if user.role == "mentor":
            query = query.filter(Intern.mentor_id == user.id)
        else:
            query = query.filter(Intern.user_id == user.id)
    meetings = query.order_by(Meeting.start_time.asc()).all()
    return [meeting_dict(item) for item in meetings]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_meeting(
    payload: MeetingCreate,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    assignment: Assignment | None = None
    if payload.assignment_id:
        assignment = db.get(Assignment, payload.assignment_id)
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if user.role == "mentor" and assignment.intern.mentor_id != user.id:
            raise HTTPException(status_code=403, detail="This assignment is not assigned to you")
        if assignment.status == "completed":
            raise HTTPException(status_code=400, detail="This assignment is already completed")
    elif user.role != "admin":
        raise HTTPException(status_code=400, detail="Select an assignment for the meeting")

    start = _naive_utc(payload.start_time)
    end = start + timedelta(minutes=payload.duration_minutes)
    meeting = Meeting(
        assignment_id=assignment.id if assignment else None,
        title=payload.title,
        agenda=payload.agenda,
        start_time=start,
        end_time=end,
        status="scheduled",
        created_by=user.id,
    )
    provider_event_id, join_url = create_provider_event(meeting)
    meeting.provider_event_id = provider_event_id
    meeting.join_url = join_url
    db.add(meeting)
    db.flush()

    record_event(
        db,
        "meeting",
        meeting.id,
        "meeting.created",
        new_status="scheduled",
        actor_id=user.id,
        meta={
            "assignment_id": meeting.assignment_id,
            "join_url": join_url,
            "provider_event_id": provider_event_id,
        },
    )
    context = _meeting_context(meeting)
    for recipient in _meeting_emails(meeting, db):
        send_email(
            db,
            recipient=recipient,
            template="meeting",
            context=context,
            entity_type="meeting",
            entity_id=meeting.id,
            dedupe=True,
        )

    if assignment and assignment.status in {"submitted", "approved", "human_review"}:
        previous = assignment.status
        assignment.status = "review_scheduled"
        record_event(
            db,
            "assignment",
            assignment.id,
            "review.scheduled",
            previous_status=previous,
            new_status="review_scheduled",
            actor_id=user.id,
            meta={"meeting_id": meeting.id},
        )

    db.commit()
    db.refresh(meeting)
    return meeting_dict(meeting)


@router.get("/{meeting_id}")
def get_meeting(
    meeting_id: int,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> dict:
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if user.role != "admin":
        if not meeting.assignment:
            raise HTTPException(status_code=403, detail="Access denied")
        ensure_assignment_access(meeting.assignment, user, _current_intern(db, user))
    return meeting_dict(meeting)


@router.get("/{meeting_id}/ics")
def download_ics(
    meeting_id: int,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
):
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if user.role != "admin":
        if not meeting.assignment:
            raise HTTPException(status_code=403, detail="Access denied")
        ensure_assignment_access(meeting.assignment, user, _current_intern(db, user))
    content = build_ics(meeting)
    return Response(
        content=content,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="internflow-meeting-{meeting.id}.ics"'
        },
    )


@router.post("/{meeting_id}/cancel")
def cancel_meeting(
    meeting_id: int,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if user.role == "mentor":
        if not meeting.assignment or meeting.assignment.intern.mentor_id != user.id:
            raise HTTPException(status_code=403, detail="This meeting is not assigned to you")
    if meeting.status == "cancelled":
        return meeting_dict(meeting)

    meeting.status = "cancelled"
    record_event(
        db,
        "meeting",
        meeting.id,
        "meeting.cancelled",
        previous_status="scheduled",
        new_status="cancelled",
        actor_id=user.id,
    )
    context = _meeting_context(meeting)
    for recipient in _meeting_emails(meeting, db):
        send_email(
            db,
            recipient=recipient,
            template="meeting_cancelled",
            context=context,
            entity_type="meeting",
            entity_id=meeting.id,
            dedupe=True,
        )
    db.commit()
    db.refresh(meeting)
    return meeting_dict(meeting)
