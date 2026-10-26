from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Assignment, Evaluation, Submission, User
from ..utils import human_datetime
from . import autopilot
from .ai_engine import evaluate_submission
from .email_service import send_email
from .workflow import record_event


def email_context(assignment: Assignment, extra: dict | None = None) -> dict:
    intern = assignment.intern
    task = assignment.task
    context = {
        "name": intern.user.name,
        "email": intern.user.email,
        "batch": intern.batch,
        "domain": intern.domain,
        "task_title": task.title,
        "due_date": human_datetime(assignment.due_date),
        "deliverables": ", ".join(task.deliverables or []),
    }
    if extra:
        context.update(extra)
    return context


def _reviewer_email(db: Session, assignment: Assignment) -> str | None:
    mentor = assignment.intern.mentor
    if mentor and mentor.email:
        return mentor.email
    admin = db.query(User).filter(User.role == "admin", User.active.is_(True)).first()
    return admin.email if admin else None


def _status_for_outcome(outcome: str) -> str:
    return {
        "approved": "approved",
        "revision_required": "revision_required",
        "human_review": "human_review",
    }.get(outcome, "human_review")


def _send_outcome_email(
    db: Session,
    assignment: Assignment,
    evaluation: Evaluation,
    meeting=None,
) -> None:
    intern = assignment.intern
    top_issue = next(
        (item.get("issue") for item in evaluation.feedback if item.get("issue")),
        None,
    )
    top_suggestion = next(
        (item.get("suggestion") for item in evaluation.feedback if item.get("suggestion")),
        None,
    )
    core = email_context(assignment)

    if evaluation.outcome == "human_review":
        recipient = _reviewer_email(db, assignment)
        if recipient:
            send_email(
                db,
                recipient=recipient,
                template="human_review",
                context={
                    **core,
                    "score": evaluation.total_score,
                    "confidence": evaluation.confidence,
                    "summary": evaluation.summary,
                },
                entity_type="evaluation",
                entity_id=evaluation.id,
                dedupe=True,
            )
        return

    if evaluation.outcome == "approved":
        send_email(
            db,
            recipient=intern.user.email,
            template="approved",
            context={
                **core,
                "score": evaluation.total_score,
                "confidence": evaluation.confidence,
                "footer": evaluation.summary,
            },
            entity_type="evaluation",
            entity_id=evaluation.id,
            dedupe=True,
        )
        return

    send_email(
        db,
        recipient=intern.user.email,
        template="revision",
        context={
            **core,
            "score": evaluation.total_score,
            "issue": top_issue or evaluation.summary,
            "suggestion": top_suggestion or "Address the failed criteria and resubmit.",
            "resubmission_due": human_datetime(datetime.utcnow() + timedelta(days=5)),
            "join_url": meeting.join_url if meeting else "",
            "meeting_time": human_datetime(meeting.start_time) if meeting else "",
            "portal_url": autopilot.portal_url(),
            "footer": evaluation.summary,
        },
        entity_type="evaluation",
        entity_id=evaluation.id,
        dedupe=True,
    )


def run_evaluation(
    db: Session,
    assignment: Assignment,
    submission: Submission,
    actor_id: int | None = None,
) -> Evaluation:
    previous = assignment.status
    if previous != "evaluating":
        assignment.status = "evaluating"
        record_event(
            db,
            "assignment",
            assignment.id,
            "evaluation.started",
            previous_status=previous,
            new_status="evaluating",
            actor_id=actor_id,
            meta={"submission_id": submission.id},
        )
        db.flush()

    result = evaluate_submission(submission, assignment)
    evaluation = Evaluation(
        submission_id=submission.id,
        scores=result["scores"],
        test_results=result["test_results"],
        total_score=result["total"],
        confidence=result["confidence"],
        outcome=result["outcome"],
        summary=result["summary"],
        feedback=result["scores"],
        engine=result["engine"],
    )
    db.add(evaluation)
    db.flush()

    new_status = _status_for_outcome(result["outcome"])
    assignment.status = new_status
    record_event(
        db,
        "assignment",
        assignment.id,
        f"evaluation.{result['outcome']}",
        previous_status="evaluating",
        new_status=new_status,
        actor_id=actor_id,
        meta={
            "evaluation_id": evaluation.id,
            "submission_id": submission.id,
            "score": evaluation.total_score,
            "confidence": evaluation.confidence,
            "engine": evaluation.engine,
        },
    )
    prepared = autopilot.prepare_followup(db, assignment, evaluation, actor_id)
    _send_outcome_email(db, assignment, evaluation, prepared.get("meeting"))
    autopilot.send_followups(db, assignment, prepared, actor_id)
    db.flush()
    return evaluation


def apply_decision(
    db: Session,
    assignment: Assignment,
    evaluation: Evaluation,
    outcome: str,
    reason: str | None,
    reviewer: User,
) -> Evaluation:
    previous = assignment.status
    evaluation.reviewer_id = reviewer.id
    evaluation.final_outcome = outcome
    evaluation.override_reason = reason
    evaluation.decided_at = datetime.utcnow()

    assignment.status = outcome
    record_event(
        db,
        "assignment",
        assignment.id,
        f"review.{outcome}",
        previous_status=previous,
        new_status=outcome,
        actor_id=reviewer.id,
        meta={
            "evaluation_id": evaluation.id,
            "ai_outcome": evaluation.outcome,
            "reason": reason,
        },
    )

    intern = assignment.intern
    core = email_context(assignment)
    rework_meeting = None
    if outcome == "approved":
        send_email(
            db,
            recipient=intern.user.email,
            template="approved",
            context={
                **core,
                "score": evaluation.total_score,
                "confidence": evaluation.confidence,
                "footer": reason or "Final approval recorded after human review.",
            },
            entity_type="evaluation",
            entity_id=evaluation.id,
        )
    else:
        top_issue = next(
            (item.get("issue") for item in evaluation.feedback if item.get("issue")),
            reason or "A reviewer requested changes.",
        )
        rework_meeting = autopilot.schedule_rework_meeting(
            db,
            assignment,
            reviewer,
            reason or top_issue,
        )
        send_email(
            db,
            recipient=intern.user.email,
            template="revision",
            context={
                **core,
                "score": evaluation.total_score,
                "issue": reason or top_issue,
                "suggestion": "Review the reviewer notes and resubmit a corrected version.",
                "resubmission_due": human_datetime(datetime.utcnow() + timedelta(days=5)),
                "join_url": rework_meeting.join_url,
                "meeting_time": human_datetime(rework_meeting.start_time),
                "portal_url": autopilot.portal_url(),
                "footer": "Decision recorded by " + reviewer.name,
            },
            entity_type="evaluation",
            entity_id=evaluation.id,
        )
    if outcome == "approved":
        autopilot.advance_after_approval(db, assignment, reviewer)
    db.flush()
    return evaluation
