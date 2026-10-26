from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from .config import settings
from .database import SessionLocal
from .models import Assignment, Meeting
from .services.email_service import send_email
from .services.workflow import record_event
from .utils import human_datetime

scheduler = BackgroundScheduler(timezone="UTC")

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


def run_reminders() -> None:
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        overdue = (
            db.query(Assignment)
            .filter(Assignment.status.in_(OPEN_STATUSES), Assignment.due_date < now)
            .limit(200)
            .all()
        )
        for assignment in overdue:
            context = {
                "name": assignment.intern.user.name,
                "email": assignment.intern.user.email,
                "task_title": assignment.task.title,
                "due_date": human_datetime(assignment.due_date),
                "domain": assignment.intern.domain,
            }
            log = send_email(
                db,
                recipient=assignment.intern.user.email,
                template="overdue",
                context=context,
                entity_type="assignment",
                entity_id=assignment.id,
                dedupe=True,
                same_day=True,
            )
            mentor = assignment.intern.mentor
            if mentor:
                send_email(
                    db,
                    recipient=mentor.email,
                    template="escalation",
                    context=context,
                    entity_type="assignment",
                    entity_id=assignment.id,
                    dedupe=True,
                    same_day=True,
                )
            if log:
                record_event(
                    db,
                    "assignment",
                    assignment.id,
                    "reminder.overdue_sent",
                    actor_id=None,
                    meta={"recipient": assignment.intern.user.email},
                )

        soon = now + timedelta(minutes=60)
        meetings = (
            db.query(Meeting)
            .filter(
                Meeting.status == "scheduled",
                Meeting.start_time >= now,
                Meeting.start_time <= soon,
            )
            .limit(100)
            .all()
        )
        for meeting in meetings:
            assignment = meeting.assignment
            if not assignment:
                continue
            context = {
                "name": assignment.intern.user.name,
                "email": assignment.intern.user.email,
                "task_title": assignment.task.title,
                "meeting_title": meeting.title,
                "start_time": human_datetime(meeting.start_time),
                "join_url": meeting.join_url,
                "agenda": meeting.agenda,
            }
            recipients = [assignment.intern.user.email]
            if assignment.intern.mentor:
                recipients.append(assignment.intern.mentor.email)
            sent_any = False
            for recipient in dict.fromkeys(recipients):
                log = send_email(
                    db,
                    recipient=recipient,
                    template="meeting_reminder",
                    context=context,
                    entity_type="meeting",
                    entity_id=meeting.id,
                    dedupe=True,
                    same_day=True,
                )
                sent_any = sent_any or bool(log)
            if sent_any:
                record_event(
                    db,
                    "meeting",
                    meeting.id,
                    "reminder.meeting_sent",
                    actor_id=None,
                    meta={"start_time": meeting.start_time.isoformat()},
                )

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def start_scheduler() -> None:
    if not settings.scheduler_enabled:
        return
    if scheduler.running:
        return
    scheduler.add_job(
        run_reminders,
        "interval",
        minutes=max(1, settings.reminder_interval_minutes),
        id="internflow-reminders",
        replace_existing=True,
        next_run_time=datetime.utcnow() + timedelta(minutes=1),
    )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
