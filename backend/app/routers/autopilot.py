from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import Assignment, Intern, Meeting, User
from ..services import autopilot

router = APIRouter(prefix="/autopilot", tags=["autopilot"])

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


@router.post("/launch")
def launch_automation(
    payload: dict | None = Body(default=None),
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    intern_ids = payload.get("intern_ids") if payload else None
    query = db.query(Intern).filter(Intern.active.is_(True))
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)
    if intern_ids:
        query = query.filter(Intern.id.in_(intern_ids))
    interns = query.order_by(Intern.id.asc()).all()
    result = autopilot.launch_many(db, interns, user)
    db.commit()
    return result


@router.get("/overview")
def overview(
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    interns = db.query(Intern).filter(Intern.active.is_(True)).all()
    open_count = (
        db.query(Assignment)
        .filter(Assignment.status.in_(OPEN_STATUSES))
        .count()
    )
    upcoming = (
        db.query(Meeting)
        .filter(Meeting.status == "scheduled")
        .order_by(Meeting.start_time.asc())
        .limit(10)
        .all()
    )
    return {
        "candidates": len(interns),
        "open_assignments": open_count,
        "upcoming_meetings": [
            {
                "id": meeting.id,
                "title": meeting.title,
                "join_url": meeting.join_url,
                "start_time": meeting.start_time.isoformat() + "Z",
                "intern": meeting.assignment.intern.user.name if meeting.assignment else None,
            }
            for meeting in upcoming
        ],
    }
