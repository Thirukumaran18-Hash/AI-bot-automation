from __future__ import annotations

import re
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Assignment, EmailLog, Intern, Meeting, User
from ..utils import human_datetime
from .visibility import visible_emails_query

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

HELP_TEXT = (
    "I am the InternFlow assistant. I can answer live questions about candidates, tasks, "
    "meetings, reviews and email activity. Try:\n"
    "- `Give me a status summary`\n"
    "- `Which candidates are overdue?`\n"
    "- `Show upcoming meetings`\n"
    "- `Pending reviews`\n"
    "- `Tell me about Ananya`\n"
    "- `How do I import a new Excel sheet?`"
)


def _scoped_interns(db: Session, user: User):
    query = db.query(Intern).join(User, Intern.user_id == User.id)
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)
    elif user.role == "intern":
        query = query.filter(Intern.user_id == user.id)
    return query


def _scoped_assignments(db: Session, user: User):
    query = db.query(Assignment).join(Intern, Assignment.intern_id == Intern.id)
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)
    elif user.role == "intern":
        query = query.filter(Intern.user_id == user.id)
    return query


def _scoped_meetings(db: Session, user: User):
    query = db.query(Meeting)
    if user.role != "admin":
        query = query.join(Assignment, Meeting.assignment_id == Assignment.id).join(
            Intern, Assignment.intern_id == Intern.id
        )
        if user.role == "mentor":
            query = query.filter(Intern.mentor_id == user.id)
        else:
            query = query.filter(Intern.user_id == user.id)
    return query


def _your_tasks(db: Session, user: User) -> list[str]:
    assignments = (
        _scoped_assignments(db, user)
        .filter(Assignment.status.in_(OPEN_STATUSES))
        .order_by(Assignment.due_date.asc())
        .limit(5)
        .all()
    )
    lines = []
    for item in assignments:
        who = item.intern.user.name
        prefix = f"{who}: " if user.role != "intern" else ""
        lines.append(
            f"- {prefix}**{item.task.title}** - {item.status.replace('_', ' ')} "
            f"(due {human_datetime(item.due_date)})"
        )
    return lines


def _upcoming_meetings(db: Session, user: User) -> list[str]:
    now = datetime.utcnow()
    meetings = (
        _scoped_meetings(db, user)
        .filter(Meeting.status == "scheduled", Meeting.start_time >= now)
        .order_by(Meeting.start_time.asc())
        .limit(5)
        .all()
    )
    lines = []
    for meeting in meetings:
        who = meeting.assignment.intern.user.name if meeting.assignment else ""
        lines.append(
            f"- **{meeting.title}** with {who} on {human_datetime(meeting.start_time)} "
            f"- [join meeting]({meeting.join_url})"
        )
    return lines


def _pending_reviews(db: Session, user: User) -> list[str]:
    if user.role == "intern":
        return []
    rows = (
        _scoped_assignments(db, user)
        .filter(Assignment.status == "human_review")
        .order_by(Assignment.updated_at.asc())
        .limit(5)
        .all()
    )
    return [
        f"- {item.intern.user.name} - **{item.task.title}** (awaiting decision)"
        for item in rows
    ]


def _interns_by_scope(db: Session, user: User) -> list[Intern]:
    if user.role == "intern":
        return []
    return _scoped_interns(db, user).order_by(User.name.asc()).all()


def _find_candidate(db: Session, user: User, text: str) -> Intern | None:
    lowered = text.lower()
    for intern in _interns_by_scope(db, user):
        full_name = intern.user.name.lower()
        email = intern.user.email.lower()
        first_name = full_name.split()[0] if full_name.split() else ""
        if full_name in lowered or email in lowered:
            return intern
        if len(first_name) >= 3 and re.search(rf"\b{re.escape(first_name)}\b", lowered):
            return intern
    return None


def _candidate_line(intern: Intern) -> str:
    open_tasks = sum(1 for item in intern.assignments if item.status in OPEN_STATUSES)
    completed = sum(1 for item in intern.assignments if item.status in {"approved", "completed"})
    return (
        f"- **{intern.user.name}** ({intern.domain}, {intern.batch}) - "
        f"{open_tasks} open, {completed} completed, email `{intern.user.email}`"
    )


def snapshot(db: Session, user: User) -> str:
    interns = _scoped_interns(db, user).all()
    assignments = _scoped_assignments(db, user).all()
    open_assignments = sum(1 for item in assignments if item.status in OPEN_STATUSES)
    overdue = sum(
        1
        for item in assignments
        if item.status in OPEN_STATUSES and item.due_date < datetime.utcnow()
    )
    approved = sum(1 for item in assignments if item.status in {"approved", "completed"})
    pending = sum(1 for item in assignments if item.status == "human_review")
    upcoming = _scoped_meetings(db, user).filter(Meeting.status == "scheduled").count()
    emails = visible_emails_query(db, user).count()

    if user.role == "intern":
        return (
            f"**Your snapshot**\n"
            f"- Open tasks: {open_assignments}\n"
            f"- Overdue: {overdue}\n"
            f"- Approved/completed: {approved}\n"
            f"- Upcoming meetings: {upcoming}\n"
            f"- Emails received: {emails}"
        )
    return (
        f"**Workspace snapshot**\n"
        f"- Candidates: {len(interns)}\n"
        f"- Open tasks: {open_assignments}\n"
        f"- Overdue: {overdue}\n"
        f"- Approved/completed: {approved}\n"
        f"- Pending reviews: {pending}\n"
        f"- Upcoming meetings: {upcoming}\n"
        f"- Emails (visible to you): {emails}"
    )


def _rules_reply(db: Session, user: User, text: str) -> str | None:
    lowered = text.lower().strip()

    candidate = _find_candidate(db, user, text)
    if candidate:
        latest = []
        for item in sorted(candidate.assignments, key=lambda row: row.updated_at, reverse=True)[:3]:
            latest.append(f"- {item.task.title}: **{item.status.replace('_', ' ')}**")
        return (
            f"**{candidate.user.name}** ({candidate.user.email})\n"
            f"- Role: {candidate.domain}\n"
            f"- Batch: {candidate.batch}\n"
            f"- Phone: {candidate.phone or 'not provided'}\n"
            f"- Mentor: {candidate.mentor.name if candidate.mentor else 'unassigned'}\n"
            + ("\n**Recent tasks**\n" + "\n".join(latest) if latest else "")
        )

    if (
        lowered in {"hi", "hello", "hey", "help"}
        or any(word in lowered for word in ("hello", "hey", "help", "what can you do"))
    ):
        return HELP_TEXT + "\n\n" + snapshot(db, user)

    if "submit" in lowered and user.role == "intern":
        return (
            "**How to submit**\n"
            "1. Open **My tasks** and pick the assigned task.\n"
            "2. Upload a file, paste a repository URL, or add detailed notes.\n"
            "3. Submit - the AI reviewer scores it immediately.\n"
            "4. If it passes you receive the next task and meeting link. If not, the email lists "
            "the exact mistakes and a rework meeting link."
        )

    if "meeting" in lowered or "join link" in lowered:
        lines = _upcoming_meetings(db, user)
        if not lines:
            return "No upcoming meetings are scheduled right now."
        return "**Upcoming meetings**\n" + "\n".join(lines)

    if "pending" in lowered or "review" in lowered:
        if user.role == "intern":
            return "Reviews are handled by your mentor. I can show your own task status instead."
        lines = _pending_reviews(db, user)
        if not lines:
            return "The review queue is clear - no submissions are waiting for a human decision."
        return "**Pending reviews**\n" + "\n".join(lines)

    if ("overdue" in lowered) or ("late" in lowered):
        rows = [
            item
            for item in _scoped_assignments(db, user).all()
            if item.status in OPEN_STATUSES and item.due_date < datetime.utcnow()
        ]
        if not rows:
            return "Nothing is overdue right now."
        return "**Overdue tasks**\n" + "\n".join(
            f"- {item.intern.user.name} - **{item.task.title}** (due {human_datetime(item.due_date)})"
            for item in rows[:8]
        )

    if "task" in lowered or "assignment" in lowered:
        lines = _your_tasks(db, user)
        if not lines:
            return "No open tasks right now."
        return "**Open tasks**\n" + "\n".join(lines)

    if "intern" in lowered or "candidate" in lowered or "people" in lowered:
        if user.role == "intern":
            return snapshot(db, user)
        rows = _interns_by_scope(db, user)
        if not rows:
            return "No candidates are visible to you yet."
        shown = "\n".join(_candidate_line(item) for item in rows[:12])
        extra = f"\n- ...and {len(rows) - 12} more" if len(rows) > 12 else ""
        return f"**Candidates ({len(rows)})**\n{shown}{extra}"

    if "email" in lowered:
        query = visible_emails_query(db, user)
        recent = query.order_by(EmailLog.created_at.desc()).limit(5).all()
        lines = "\n".join(
            f"- {item.template.replace('_', ' ')} -> {item.recipient}: {item.subject}"
            for item in recent
        )
        return f"**Email activity**\nTotal: {query.count()}\n{lines}"

    if "import" in lowered or "excel" in lowered or "sheet" in lowered:
        if user.role != "admin":
            return "Only an administrator can import candidates."
        return (
            "**Import candidates**\n"
            "1. Open **Interns**.\n"
            "2. Click **Import Excel**.\n"
            "3. Required columns: `name, email, phone, role` (or `domain`).\n"
            "4. Keep **Launch automation now** checked to create tasks, Jitsi meeting links and emails immediately."
        )

    if "delete" in lowered:
        if user.role != "admin":
            return "Only an administrator can delete a candidate."
        return (
            "Open **Interns**, find the candidate, click **Delete** and confirm. "
            "This removes the account, tasks, submissions, evaluations and meetings."
        )

    if "run automation" in lowered or "autopilot" in lowered or "automation" in lowered:
        if user.role == "intern":
            return "The autopilot is managed by your coordinator. Your tasks and meeting links arrive by email."
        return (
            "Click **Interns -> Run automation**. Every active candidate without an open task gets a "
            "role-based task, a new Jitsi meeting link and a task + meeting email."
        )

    if "status" in lowered or "summary" in lowered or "overview" in lowered or "how many" in lowered:
        return snapshot(db, user)

    if "score" in lowered or "marks" in lowered or "performance" in lowered:
        rows = [
            item
            for item in _scoped_assignments(db, user).all()
            if item.status in {"approved", "completed"} and item.submissions
        ]
        if not rows:
            return "No scored submissions are available yet."
        lines = []
        for item in rows[:8]:
            evaluation = item.submissions[-1].evaluations[-1] if item.submissions[-1].evaluations else None
            if evaluation:
                lines.append(f"- {item.intern.user.name} - **{item.task.title}**: {evaluation.total_score}/100")
        return "**Scores**\n" + "\n".join(lines) if lines else "No scored submissions are available yet."

    if "whatsapp" in lowered:
        return "WhatsApp delivery is not configured. Email and the in-app activity log are supported."

    return None


def _llm_reply(db: Session, user: User, text: str, history: list[dict]) -> str | None:
    if settings.ai_provider != "openai" or not settings.openai_api_key:
        return None
    context = snapshot(db, user)
    messages = [
        {
            "role": "system",
            "content": (
                "You are the InternFlow AI assistant inside an internship management workspace. "
                "Answer only from the live workspace context. Be concise and practical. Use markdown. "
                "Never invent candidates, tasks or meetings. If the answer is not in the context, say "
                "you do not have that data and suggest the relevant page.\n\n"
                f"User role: {user.role}\nLive context:\n{context}"
            ),
        }
    ]
    for item in history[-8:]:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content[:1500]})
    messages.append({"role": "user", "content": text[:2000]})

    try:
        response = httpx.post(
            f"{settings.openai_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={
                "model": settings.openai_model,
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": 450,
            },
            timeout=settings.ai_timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return content.strip() if content else None
    except Exception:
        return None


def reply(db: Session, user: User, text: str, history: list[dict] | None = None) -> dict:
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return {"reply": HELP_TEXT, "engine": "rules"}

    rule = _rules_reply(db, user, cleaned)
    if rule:
        return {"reply": rule, "engine": "rules"}

    llm = _llm_reply(db, user, cleaned, history or [])
    if llm:
        return {"reply": llm, "engine": settings.openai_model}

    return {
        "reply": (
            "I do not have a specific answer for that yet. "
            "Here is what I can see right now:\n\n"
            f"{snapshot(db, user)}\n\n"
            "Ask me about meetings, tasks, overdue work, pending reviews, candidates or email activity."
        ),
        "engine": "rules",
    }
