import html
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..models import EmailLog

BRAND = "#4338ca"
TEXT = "#1f2937"
MUTED = "#6b7280"


def _layout(title: str, intro: str, bullets: list[str], footer: str = "") -> str:
    bullet_html = "".join(
        f'<li style="margin:6px 0;color:{TEXT};font-size:14px;line-height:1.6">{html.escape(item)}</li>'
        for item in bullets
    )
    footer_html = (
        f'<p style="color:{MUTED};font-size:12px;margin-top:24px">{html.escape(footer)}</p>'
        if footer
        else ""
    )
    return f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px">
      <div style="background:{BRAND};color:#fff;padding:20px 24px;border-radius:14px 14px 0 0">
        <div style="font-size:12px;letter-spacing:1.5px;opacity:.85">INTERNFLOW AI</div>
        <h1 style="margin:6px 0 0;font-size:22px">{html.escape(title)}</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px;padding:24px;background:#fff">
        <p style="color:{TEXT};font-size:15px;line-height:1.7;margin-top:0">{html.escape(intro)}</p>
        <ul style="padding-left:20px;margin:16px 0">{bullet_html}</ul>
        {footer_html}
        <p style="color:{MUTED};font-size:12px;margin:24px 0 0;border-top:1px solid #f3f4f6;padding-top:16px">
          Automated message from InternFlow AI. Replies go to your internship coordinator.
        </p>
      </div>
    </div>
    """


def build_email(template: str, context: dict) -> tuple[str, str]:
    name = context.get("name", "there")
    task = context.get("task_title", "your task")
    due = context.get("due_date", "")
    batch = context.get("batch", "")

    if template == "welcome":
        subject = "Welcome to InternFlow AI - your internship starts here"
        body = _layout(
            f"Welcome aboard, {name}",
            "Your internship workspace is ready. You can sign in to see assigned tasks, "
            "deadlines, feedback and meetings.",
            [
                f"Batch: {batch or 'Not assigned'}",
                f"Domain: {context.get('domain', 'General')}",
                f"Sign-in email: {context.get('email', '')}",
                (
                    f"Temporary password: {context.get('password')}"
                    if context.get("password")
                    else "Use the temporary password shared by your coordinator, then change it after signing in."
                ),
                f"Sign in and open My Tasks: {context.get('portal_url', '')}",
            ],
            "If you did not expect this email, please contact your internship coordinator.",
        )
        return subject, body

    if template == "assignment":
        subject = f"New task assigned: {task}"
        body = _layout(
            f"New task assigned: {task}",
            f"Hi {name}, a new task has been assigned to you. Read the brief carefully and plan your work.",
            [
                f"Task: {task}",
                f"Domain: {context.get('domain', '')}",
                f"Due date: {due}",
                f"Deliverables: {context.get('deliverables', 'See task brief')}",
                "Submit through the InternFlow portal. Upload a file or add a repository link.",
            ],
            "Late submissions are still recorded but may be marked overdue for reporting.",
        )
        return subject, body

    if template == "task_kickoff":
        subject = f"Your task and meeting link: {task}"
        brief = " ".join(str(context.get("task_description", "")).split())[:900]
        bullets = [
            f"Role / domain: {context.get('domain', '')}",
            f"Task: {task}",
            f"Task brief: {brief}" if brief else "Task brief: see the portal",
            f"Due date: {due}",
            f"Deliverables: {context.get('deliverables', 'See the task brief')}",
            f"Acceptance criteria: {context.get('criteria', 'See the task brief')}",
            f"Meeting: {context.get('meeting_title', 'Task briefing')}",
            f"Meeting time: {context.get('start_time', '')}",
            f"Join the meeting: {context.get('join_url', '')}",
            f"Submit your work here: {context.get('portal_url', '')}",
        ]
        if context.get("password"):
            bullets.append(f"Sign-in email: {context.get('email', '')}")
            bullets.append(f"Temporary password: {context.get('password')}")
        body = _layout(
            f"Hi {name}, here is your next task",
            "I have assigned the next task for your role and created a short briefing meeting. "
            "Please join the meeting, then submit your work through the portal when it is ready.",
            bullets,
            "When you submit, the AI reviewer analyses your work immediately. "
            "If it passes you get the next task and a new meeting link; if not, you get the exact "
            "mistakes to fix and a rework meeting link.",
        )
        return subject, body

    if template == "program_complete":
        subject = f"Program complete: {context.get('domain', 'internship')} track"
        body = _layout(
            f"Congratulations, {name}",
            "You have completed every task in your track. Your submissions were reviewed and approved by the automated evaluator.",
            [
                f"Track: {context.get('domain', '')}",
                f"Batch: {context.get('batch', '')}",
                "All required tasks are complete and recorded in your workspace.",
                f"Review your history here: {context.get('portal_url', '')}",
            ],
            "Your coordinator can now schedule the final wrap-up session.",
        )
        return subject, body

    if template == "submission_receipt":
        subject = f"Submission received v{context.get('version', 1)}: {task}"
        body = _layout(
            "Submission received",
            f"Hi {name}, we received your submission for {task}. The evaluation workflow has started.",
            [
                f"Version: {context.get('version', 1)}",
                f"Submitted at: {context.get('submitted_at', '')}",
                f"Deliverable: {context.get('file_name') or context.get('repo_url') or 'Notes only'}",
                "You will receive another email when the evaluation is ready.",
            ],
        )
        return subject, body

    if template == "approved":
        subject = f"Approved: {task}"
        body = _layout(
            f"Great work - {task} is approved",
            f"Hi {name}, your submission met the required standard. The bot has already sent your next task and meeting link.",
            [
                f"Task: {task}",
                f"Final score: {context.get('score', 0)} / 100",
                f"Confidence: {context.get('confidence', 0)}",
                "Check the My Tasks page for feedback and the next assignment.",
            ],
            context.get("footer", ""),
        )
        return subject, body

    if template == "revision":
        subject = f"Revision required: {task}"
        revision_bullets = [
            f"Score: {context.get('score', 0)} / 100",
            f"Main issue: {context.get('issue', 'One or more acceptance criteria were not met')}",
            f"Suggested next step: {context.get('suggestion', 'Address the failed criteria and resubmit')}",
            f"Resubmission due: {context.get('resubmission_due', 'Within 5 working days')}",
            "Your next submission will create a new version so your history stays intact.",
        ]
        if context.get("join_url"):
            revision_bullets.append(f"Rework meeting: {context.get('meeting_time', '')}")
            revision_bullets.append(f"Join the rework meeting: {context.get('join_url')}")
        if context.get("portal_url"):
            revision_bullets.append(f"Resubmit here: {context.get('portal_url')}")
        body = _layout(
            f"Revision required for {task}",
            f"Hi {name}, your submission needs another pass before approval. Use the feedback below to prepare a revised submission.",
            revision_bullets,
            context.get("footer", ""),
        )
        return subject, body

    if template == "human_review":
        subject = f"Review needed: {task} ({name})"
        body = _layout(
            "A submission needs human review",
            f"{name}'s submission for {task} was routed to human review because the automated confidence or score was inconclusive.",
            [
                f"Intern: {name} ({context.get('email', '')})",
                f"Task: {task}",
                f"Automated score: {context.get('score', 0)} / 100",
                f"Confidence: {context.get('confidence', 0)}",
                context.get("summary", ""),
                "Open the Review Queue in InternFlow to inspect evidence and make the final decision.",
            ],
            "AI output is advisory. The reviewer owns the final outcome.",
        )
        return subject, body

    if template == "meeting":
        subject = f"Meeting scheduled: {context.get('meeting_title', task)}"
        body = _layout(
            "Your review meeting is scheduled",
            f"Hi {name}, a meeting has been created for {task}.",
            [
                f"When: {context.get('start_time', '')}",
                f"Duration: {context.get('duration', '30')} minutes",
                f"Join link: {context.get('join_url', '')}",
                f"Agenda: {context.get('agenda', 'Review submission and next steps')}",
            ],
            "Calendar file is attached through the InternFlow portal. Contact your mentor if the time does not work.",
        )
        return subject, body

    if template == "meeting_cancelled":
        subject = f"Meeting cancelled: {context.get('meeting_title', task)}"
        body = _layout(
            "Meeting cancelled",
            f"Hi {name}, the meeting scheduled for {task} has been cancelled.",
            [
                f"Originally scheduled: {context.get('start_time', '')}",
                "Your mentor will share a new time if another review is needed.",
            ],
        )
        return subject, body

    if template == "overdue":
        subject = f"Overdue task reminder: {task}"
        bullets = [
            f"Task: {task}",
            f"Domain: {context.get('domain', '')}",
            f"Due date: {due}",
            "Submit as soon as possible or contact your mentor if you are blocked.",
        ]
        if context.get("join_url"):
            bullets.append(f"Next meeting: {context.get('meeting_time', '')}")
            bullets.append(f"Join the meeting: {context.get('join_url')}")
        if context.get("portal_url"):
            bullets.append(f"Open your task: {context.get('portal_url')}")
        body = _layout(
            f"Task overdue: {task}",
            f"Hi {name}, this task is past its due date and is still open.",
            bullets,
            "Your coordinator has been copied on this reminder.",
        )
        return subject, body

    if template == "reminder":
        subject = f"Reminder: {task}"
        bullets = [
            f"Task: {task}",
            f"Domain: {context.get('domain', '')}",
            f"Submission date: {due}",
            f"Deliverables: {context.get('deliverables', 'See the task brief')}",
        ]
        if context.get("join_url"):
            bullets.append(f"Next review meeting: {context.get('meeting_time', '')}")
            bullets.append(f"Join the meeting: {context.get('join_url')}")
        if context.get("portal_url"):
            bullets.append(f"Open your task: {context.get('portal_url')}")
        bullets.append("If you are blocked, ask your mentor for help before the deadline.")
        body = _layout(
            f"Reminder for {task}",
            f"Hi {name}, this task is still open. Keep your submission on track.",
            bullets,
        )
        return subject, body

    if template == "escalation":
        subject = f"Escalation: {task} is overdue for {name}"
        body = _layout(
            "Overdue task escalation",
            f"{name}'s task is past its due date and remains open.",
            [
                f"Intern: {name} ({context.get('email', '')})",
                f"Task: {task}",
                f"Due date: {due}",
                "The intern has received an automated reminder.",
                "Review the assignment in InternFlow and follow up if needed.",
            ],
            "This escalation was generated by the workflow scheduler.",
        )
        return subject, body

    if template == "meeting_reminder":
        subject = f"Meeting reminder: {context.get('meeting_title', task)}"
        body = _layout(
            "Your meeting starts soon",
            f"Hi {name}, a reminder for your upcoming InternFlow meeting.",
            [
                f"When: {context.get('start_time', '')}",
                f"Join link: {context.get('join_url', '')}",
                f"Agenda: {context.get('agenda', 'Review progress and next steps')}",
            ],
        )
        return subject, body

    subject = context.get("subject", "InternFlow AI notification")
    body = _layout(
        subject,
        context.get("intro", "You have a new notification from InternFlow AI."),
        context.get("bullets", []),
    )
    return subject, body


def _smtp_send(recipient: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content("This message contains HTML. Please use an HTML-capable client.")
    message.add_alternative(body, subtype="html")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_tls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


def already_sent(
    db: Session,
    recipient: str,
    template: str,
    entity_type: str | None,
    entity_id: int | None,
    same_day: bool = False,
) -> bool:
    query = db.query(EmailLog).filter(
        EmailLog.recipient == recipient,
        EmailLog.template == template,
        EmailLog.status != "failed",
    )
    if entity_type:
        query = query.filter(EmailLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(EmailLog.entity_id == entity_id)
    if same_day:
        start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(EmailLog.created_at >= start)
    return query.first() is not None


def send_email(
    db: Session,
    *,
    recipient: str,
    template: str,
    context: dict,
    entity_type: str | None = None,
    entity_id: int | None = None,
    dedupe: bool = False,
    same_day: bool = False,
) -> EmailLog | None:
    if not recipient:
        return None
    if dedupe and already_sent(db, recipient, template, entity_type, entity_id, same_day):
        return None

    subject, body = build_email(template, context)
    status = "logged"
    if settings.smtp_host:
        try:
            _smtp_send(recipient, subject, body)
            status = "sent"
        except (smtplib.SMTPException, OSError):
            status = "failed"

    log = EmailLog(
        recipient=recipient,
        template=template,
        subject=subject,
        body=body,
        entity_type=entity_type,
        entity_id=entity_id,
        status=status,
    )
    db.add(log)
    db.flush()
    return log


def email_stats(db: Session) -> dict:
    total = db.query(func.count(EmailLog.id)).scalar() or 0
    sent = db.query(func.count(EmailLog.id)).filter(EmailLog.status == "sent").scalar() or 0
    logged = db.query(func.count(EmailLog.id)).filter(EmailLog.status == "logged").scalar() or 0
    failed = db.query(func.count(EmailLog.id)).filter(EmailLog.status == "failed").scalar() or 0
    since = datetime.utcnow() - timedelta(days=7)
    recent = (
        db.query(func.count(EmailLog.id)).filter(EmailLog.created_at >= since).scalar() or 0
    )
    return {
        "total": total,
        "sent": sent,
        "logged": logged,
        "failed": failed,
        "last_7_days": recent,
        "mode": "smtp" if settings.smtp_host else "log-only",
    }
