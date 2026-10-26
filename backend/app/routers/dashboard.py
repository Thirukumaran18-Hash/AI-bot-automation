from collections import Counter
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_roles
from ..models import Assignment, Intern, Meeting, Submission, Task, User, WorkflowEvent
from ..serializers import assignment_dict, event_dict, iso, latest_evaluation, meeting_dict
from ..services.email_service import email_stats
from ..services.visibility import (
    event_visibility_filter,
    scoped_assignments_query,
    visible_emails_query,
)
from ..utils import human_datetime

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

STATUS_ORDER = [
    "assigned",
    "in_progress",
    "submitted",
    "evaluating",
    "human_review",
    "revision_required",
    "resubmitted",
    "approved",
    "review_scheduled",
    "completed",
]
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


@router.get("")
def dashboard(
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> dict:
    now = datetime.utcnow()
    assignments = (
        scoped_assignments_query(db, user)
        .options(
            selectinload(Assignment.task),
            selectinload(Assignment.intern).selectinload(Intern.user),
            selectinload(Assignment.intern).selectinload(Intern.mentor),
            selectinload(Assignment.submissions).selectinload(Submission.evaluations),
            selectinload(Assignment.meetings),
        )
        .all()
    )

    intern_query = db.query(Intern)
    if user.role == "mentor":
        intern_query = intern_query.filter(Intern.mentor_id == user.id)
    elif user.role == "intern":
        intern_query = intern_query.filter(Intern.user_id == user.id)
    interns = intern_query.all()

    latest_evaluations = []
    for assignment in assignments:
        evaluation = latest_evaluation(assignment)
        if evaluation:
            latest_evaluations.append((assignment, evaluation))

    status_counts = Counter(assignment.status for assignment in assignments)
    overdue = [
        assignment
        for assignment in assignments
        if assignment.status in OPEN_STATUSES and assignment.due_date < now
    ]
    pending_reviews = [a for a in assignments if a.status == "human_review"]
    completed = sum(1 for a in assignments if a.status in {"approved", "completed"})
    submissions_count = sum(len(assignment.submissions) for assignment in assignments)

    approved_outcomes = sum(
        1
        for _, evaluation in latest_evaluations
        if (evaluation.final_outcome or evaluation.outcome) == "approved"
    )
    revision_outcomes = sum(
        1
        for _, evaluation in latest_evaluations
        if (evaluation.final_outcome or evaluation.outcome) == "revision_required"
    )
    decided = approved_outcomes + revision_outcomes
    approval_rate = round(approved_outcomes / decided * 100, 1) if decided else 0.0

    scores = [evaluation.total_score for _, evaluation in latest_evaluations]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None
    confidences = [evaluation.confidence for _, evaluation in latest_evaluations]
    avg_confidence = round(sum(confidences) / len(confidences), 2) if confidences else None

    eval_minutes = []
    for assignment, evaluation in latest_evaluations:
        if not assignment.submissions:
            continue
        submission = assignment.submissions[-1]
        delta = (evaluation.created_at - submission.submitted_at).total_seconds() / 60
        if 0 <= delta <= 60 * 24 * 30:
            eval_minutes.append(delta)
    avg_eval_minutes = round(sum(eval_minutes) / len(eval_minutes), 1) if eval_minutes else None

    domain_counts = Counter(intern.domain for intern in interns)
    status_breakdown = [
        {"status": status, "count": status_counts[status]}
        for status in STATUS_ORDER
        if status_counts[status]
    ]

    buckets = [
        {"bucket": "0-59", "count": 0},
        {"bucket": "60-69", "count": 0},
        {"bucket": "70-79", "count": 0},
        {"bucket": "80-89", "count": 0},
        {"bucket": "90-100", "count": 0},
    ]
    for score in scores:
        if score < 60:
            buckets[0]["count"] += 1
        elif score < 70:
            buckets[1]["count"] += 1
        elif score < 80:
            buckets[2]["count"] += 1
        elif score < 90:
            buckets[3]["count"] += 1
        else:
            buckets[4]["count"] += 1

    meetings = []
    for assignment in assignments:
        meetings.extend(assignment.meetings)
    if user.role == "admin":
        meetings.extend(
            db.query(Meeting)
            .filter(Meeting.assignment_id.is_(None), Meeting.status == "scheduled")
            .all()
        )
    upcoming = sorted(
        [m for m in meetings if m.status == "scheduled" and m.start_time >= now],
        key=lambda m: m.start_time,
    )[:5]

    event_query = db.query(WorkflowEvent).order_by(WorkflowEvent.created_at.desc())
    visibility = event_visibility_filter(db, user)
    if visibility is not None:
        event_query = event_query.filter(visibility)
    events = event_query.limit(8).all()

    if user.role == "admin":
        email_summary = email_stats(db)
    else:
        logs = visible_emails_query(db, user).all()
        email_summary = {
            "total": len(logs),
            "sent": sum(1 for log in logs if log.status == "sent"),
            "logged": sum(1 for log in logs if log.status == "logged"),
            "failed": sum(1 for log in logs if log.status == "failed"),
            "last_7_days": 0,
            "mode": "smtp" if any(log.status == "sent" for log in logs) else "log-only",
        }

    engines = Counter(evaluation.engine for _, evaluation in latest_evaluations)
    outcomes = Counter(
        (evaluation.final_outcome or evaluation.outcome) for _, evaluation in latest_evaluations
    )

    my_tasks = []
    if user.role == "intern":
        upcoming_tasks = sorted(
            [a for a in assignments if a.status in OPEN_STATUSES],
            key=lambda a: a.due_date,
        )
        my_tasks = [assignment_dict(a) for a in upcoming_tasks[:6]]

    workload = []
    if user.role in {"admin", "mentor"}:
        mentor_map: dict[str, dict] = {}
        for intern in interns:
            name = intern.mentor.name if intern.mentor else "Unassigned"
            entry = mentor_map.setdefault(
                name, {"mentor": name, "interns": 0, "open_assignments": 0, "pending_reviews": 0}
            )
            entry["interns"] += 1
        for assignment in assignments:
            name = assignment.intern.mentor.name if assignment.intern.mentor else "Unassigned"
            entry = mentor_map.setdefault(
                name, {"mentor": name, "interns": 0, "open_assignments": 0, "pending_reviews": 0}
            )
            if assignment.status in OPEN_STATUSES:
                entry["open_assignments"] += 1
            if assignment.status == "human_review":
                entry["pending_reviews"] += 1
        workload = sorted(mentor_map.values(), key=lambda item: item["open_assignments"], reverse=True)

    cards = {
        "interns": len(interns),
        "active_interns": sum(1 for intern in interns if intern.active),
        "tasks": db.query(Task).filter(Task.status == "approved").count()
        if user.role in {"admin", "mentor"}
        else len({a.task_id for a in assignments}),
        "assignments": len(assignments),
        "submissions": submissions_count,
        "pending_reviews": len(pending_reviews),
        "overdue": len(overdue),
        "completed": completed,
        "approval_rate": approval_rate,
        "avg_score": avg_score,
        "avg_confidence": avg_confidence,
        "avg_evaluation_minutes": avg_eval_minutes,
        "emails": email_summary["total"],
        "email_failures": email_summary["failed"],
        "upcoming_meetings": len(upcoming),
    }

    next_meeting = meeting_dict(upcoming[0]) if user.role == "intern" and upcoming else None

    return {
        "role": user.role,
        "generated_at": iso(now),
        "cards": cards,
        "status_breakdown": status_breakdown,
        "domain_breakdown": [
            {"domain": domain, "count": count}
            for domain, count in sorted(domain_counts.items(), key=lambda item: item[1], reverse=True)
        ],
        "score_distribution": buckets,
        "upcoming_meetings": [meeting_dict(m) for m in upcoming],
        "next_meeting": next_meeting,
        "pending_reviews": [assignment_dict(a) for a in pending_reviews[:5]],
        "recent_events": [event_dict(event) for event in events],
        "my_tasks": my_tasks,
        "mentor_workload": workload,
        "email_stats": email_summary,
        "ai_stats": {
            "evaluations": len(latest_evaluations),
            "engines": dict(engines),
            "outcomes": dict(outcomes),
            "human_review_rate": round(
                len(pending_reviews) / len(assignments) * 100, 1
            )
            if assignments
            else 0.0,
        },
        "deadline": human_datetime(now),
    }
