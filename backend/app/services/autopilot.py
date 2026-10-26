from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Assignment, Evaluation, Intern, Meeting, Task, User
from ..utils import human_datetime
from .calendar_service import create_provider_event
from .email_service import send_email
from .workflow import record_event

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

RUBRIC = [
    {
        "name": "Requirement matching",
        "weight": 25,
        "description": "Every deliverable in the brief is present and complete.",
    },
    {
        "name": "Functional correctness",
        "weight": 30,
        "description": "The solution works for the main cases and handles edge cases.",
    },
    {
        "name": "Quality and structure",
        "weight": 25,
        "description": "The work is organised, readable and easy to maintain.",
    },
    {
        "name": "Documentation",
        "weight": 20,
        "description": "Setup, usage and assumptions are documented clearly.",
    },
]

STAGES = [
    {
        "title": "{role} - Foundation Task",
        "description": (
            "## Objective\n\nAs a {role}, build a small, working solution that demonstrates the "
            "core skills of the role.\n\n## Requirements\n\n"
            "- Implement the main feature end to end.\n"
            "- Handle at least three realistic edge cases.\n"
            "- Include tests or a written validation checklist.\n"
            "- Add a short README with setup steps and assumptions."
        ),
        "deliverables": ["Working solution", "Tests or validation checklist", "README"],
        "criteria": [
            "Main functionality works end to end.",
            "Edge cases are handled and explained.",
            "Setup and usage are documented.",
        ],
    },
    {
        "title": "{role} - Debug and Improve",
        "description": (
            "## Objective\n\nDebug a realistic {role} scenario and improve an existing solution.\n\n"
            "## Requirements\n\n"
            "- Identify at least two defects or weaknesses and fix them.\n"
            "- Explain the root cause of each issue.\n"
            "- Add or update tests so the fixes are protected.\n"
            "- Summarise the before and after behaviour."
        ),
        "deliverables": ["Fixed implementation", "Root-cause notes", "Updated tests"],
        "criteria": [
            "Defects are correctly identified and fixed.",
            "Root causes are explained clearly.",
            "Tests prove the fixes work.",
        ],
    },
    {
        "title": "{role} - Final Assessment",
        "description": (
            "## Objective\n\nDeliver a polished {role} mini-project that you could present to "
            "a team lead.\n\n## Requirements\n\n"
            "- Build or extend the solution with a clear user flow.\n"
            "- Document architecture, trade-offs and next steps.\n"
            "- Include tests and a short demo script.\n"
            "- Keep the work reproducible from a clean checkout."
        ),
        "deliverables": ["Mini-project", "Architecture and trade-off notes", "Demo script"],
        "criteria": [
            "The solution is complete and presentable.",
            "Trade-offs and limitations are documented.",
            "Another person can run the project from the README.",
        ],
    },
]

MAX_TASKS_PER_ROLE = len(STAGES)


def portal_url() -> str:
    return f"{settings.app_public_url.rstrip('/')}/assignments"


def _task_for_stage(db: Session, domain: str, index: int, actor: User | None) -> Task:
    spec = STAGES[min(index, len(STAGES) - 1)]
    task = Task(
        title=spec["title"].format(role=domain),
        description=spec["description"].format(role=domain),
        domain=domain,
        difficulty=["Beginner", "Intermediate", "Advanced"][min(index, 2)],
        deliverables=list(spec["deliverables"]),
        acceptance_criteria=list(spec["criteria"]),
        rubric=RUBRIC,
        test_cases=[
            {"name": "Deliverables present", "detail": "All required artefacts were submitted."},
            {"name": "Edge cases handled", "detail": "The solution works beyond the happy path."},
            {"name": "Documentation", "detail": "Setup and usage notes are complete."},
        ],
        deadline_days=settings.autopilot_due_days,
        pass_threshold=settings.pass_threshold,
        status="approved",
        created_by=actor.id if actor else None,
    )
    db.add(task)
    db.flush()
    record_event(
        db,
        "task",
        task.id,
        "task.autopilot_created",
        new_status="approved",
        actor_id=actor.id if actor else None,
        meta={"domain": domain, "stage": index + 1},
    )
    return task


def ensure_role_tasks(db: Session, domain: str, actor: User | None = None) -> list[Task]:
    tasks = (
        db.query(Task)
        .filter(func.lower(Task.domain) == domain.lower(), Task.status == "approved")
        .order_by(Task.id.asc())
        .all()
    )
    while len(tasks) < MAX_TASKS_PER_ROLE:
        tasks.append(_task_for_stage(db, domain, len(tasks), actor))
    return tasks


def ensure_custom_first_task(
    db: Session,
    domain: str,
    title: str,
    actor: User | None = None,
) -> Task:
    existing = (
        db.query(Task)
        .filter(func.lower(Task.domain) == domain.lower(), Task.status == "approved")
        .order_by(Task.id.asc())
        .first()
    )
    if existing:
        return existing

    spec = STAGES[0]
    task = Task(
        title=title.strip()[:200],
        description=spec["description"].format(role=domain),
        domain=domain,
        difficulty="Beginner",
        deliverables=list(spec["deliverables"]),
        acceptance_criteria=list(spec["criteria"]),
        rubric=RUBRIC,
        test_cases=[
            {"name": "Deliverables present", "detail": "All required artefacts were submitted."},
            {"name": "Edge cases handled", "detail": "The solution works beyond the happy path."},
            {"name": "Documentation", "detail": "Setup and usage notes are complete."},
        ],
        deadline_days=settings.autopilot_due_days,
        pass_threshold=settings.pass_threshold,
        status="approved",
        created_by=actor.id if actor else None,
    )
    db.add(task)
    db.flush()
    record_event(
        db,
        "task",
        task.id,
        "task.autopilot_created",
        new_status="approved",
        actor_id=actor.id if actor else None,
        meta={"domain": domain, "stage": 1, "source": "import_sheet"},
    )
    return task


def next_task_for(db: Session, intern: Intern, actor: User | None = None) -> Task | None:
    tasks = ensure_role_tasks(db, intern.domain, actor)
    used = {assignment.task_id for assignment in intern.assignments}
    for task in tasks:
        if task.id not in used:
            return task
    return None


def _create_assignment(
    db: Session,
    task: Task,
    intern: Intern,
    actor: User | None,
) -> Assignment:
    due = datetime.utcnow() + timedelta(days=settings.autopilot_due_days)
    assignment = Assignment(
        task_id=task.id,
        intern_id=intern.id,
        due_date=due,
        status="assigned",
        assigned_by=actor.id if actor else None,
    )
    db.add(assignment)
    db.flush()
    record_event(
        db,
        "assignment",
        assignment.id,
        "autopilot.assignment_created",
        previous_status=None,
        new_status="assigned",
        actor_id=actor.id if actor else None,
        meta={"task_id": task.id, "intern_id": intern.id, "due_date": due.isoformat()},
    )
    return assignment


def _schedule_meeting(
    db: Session,
    assignment: Assignment,
    actor: User | None,
    title_prefix: str = "Task briefing",
    agenda: str | None = None,
) -> Meeting:
    start = datetime.utcnow() + timedelta(minutes=settings.autopilot_lead_minutes)
    meeting = Meeting(
        assignment_id=assignment.id,
        title=f"{title_prefix}: {assignment.task.title}",
        agenda=agenda
        or "Walk through the task, deliverables, acceptance criteria and how to submit.",
        start_time=start,
        end_time=start + timedelta(minutes=settings.autopilot_meeting_minutes),
        status="scheduled",
        created_by=actor.id if actor else None,
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
        "autopilot.meeting_created",
        new_status="scheduled",
        actor_id=actor.id if actor else None,
        meta={
            "assignment_id": assignment.id,
            "join_url": join_url,
            "start_time": start.isoformat(),
        },
    )
    return meeting


def _kickoff_context(
    assignment: Assignment,
    meeting: Meeting,
    password: str | None = None,
) -> dict:
    intern = assignment.intern
    task = assignment.task
    return {
        "name": intern.user.name,
        "email": intern.user.email,
        "password": password or "",
        "phone": intern.phone,
        "batch": intern.batch,
        "domain": intern.domain,
        "task_title": task.title,
        "task_description": task.description,
        "deliverables": ", ".join(task.deliverables or []),
        "criteria": "; ".join(task.acceptance_criteria or []),
        "due_date": human_datetime(assignment.due_date),
        "meeting_title": meeting.title,
        "start_time": human_datetime(meeting.start_time),
        "duration": str(settings.autopilot_meeting_minutes),
        "join_url": meeting.join_url,
        "agenda": meeting.agenda,
        "portal_url": portal_url(),
    }


def _send_kickoff(
    db: Session,
    assignment: Assignment,
    meeting: Meeting,
    actor: User | None,
    password: str | None = None,
) -> None:
    send_email(
        db,
        recipient=assignment.intern.user.email,
        template="task_kickoff",
        context=_kickoff_context(assignment, meeting, password),
        entity_type="assignment",
        entity_id=assignment.id,
        dedupe=True,
    )
    record_event(
        db,
        "assignment",
        assignment.id,
        "autopilot.task_and_meeting_sent",
        actor_id=actor.id if actor else None,
        meta={"meeting_id": meeting.id, "join_url": meeting.join_url},
    )


def _send_program_complete(
    db: Session,
    intern: Intern,
    actor: User | None,
) -> None:
    send_email(
        db,
        recipient=intern.user.email,
        template="program_complete",
        context={
            "name": intern.user.name,
            "email": intern.user.email,
            "domain": intern.domain,
            "batch": intern.batch,
            "portal_url": portal_url(),
        },
        entity_type="intern",
        entity_id=intern.id,
        dedupe=True,
    )
    record_event(
        db,
        "intern",
        intern.id,
        "autopilot.program_completed",
        actor_id=actor.id if actor else None,
    )


def launch_intern(
    db: Session,
    intern: Intern,
    actor: User | None = None,
    password: str | None = None,
    initial_task_title: str | None = None,
) -> dict:
    if not intern.active:
        return {"intern_id": intern.id, "status": "skipped", "reason": "inactive"}

    open_assignment = (
        db.query(Assignment)
        .filter(Assignment.intern_id == intern.id, Assignment.status.in_(OPEN_STATUSES))
        .first()
    )
    if open_assignment:
        return {
            "intern_id": intern.id,
            "status": "skipped",
            "reason": f"already has an open task ({open_assignment.status})",
            "assignment_id": open_assignment.id,
        }

    if initial_task_title:
        ensure_custom_first_task(db, intern.domain, initial_task_title, actor)

    task = next_task_for(db, intern, actor)
    if task is None:
        _send_program_complete(db, intern, actor)
        return {
            "intern_id": intern.id,
            "status": "completed",
            "reason": "all role tasks are finished",
            "email": intern.user.email,
        }

    assignment = _create_assignment(db, task, intern, actor)
    meeting = _schedule_meeting(db, assignment, actor)
    _send_kickoff(db, assignment, meeting, actor, password=password)
    return {
        "intern_id": intern.id,
        "status": "launched",
        "name": intern.user.name,
        "email": intern.user.email,
        "task": task.title,
        "assignment_id": assignment.id,
        "meeting_id": meeting.id,
        "join_url": meeting.join_url,
        "start_time": meeting.start_time.isoformat() + "Z",
        "due_date": assignment.due_date.isoformat() + "Z",
    }


def launch_many(
    db: Session,
    interns: list[Intern],
    actor: User | None = None,
) -> dict:
    results = [launch_intern(db, intern, actor) for intern in interns]
    return {
        "total": len(results),
        "launched": sum(1 for item in results if item["status"] == "launched"),
        "skipped": sum(1 for item in results if item["status"] == "skipped"),
        "completed": sum(1 for item in results if item["status"] == "completed"),
        "results": results,
    }


def prepare_followup(
    db: Session,
    assignment: Assignment,
    evaluation: Evaluation,
    actor_id: int | None = None,
) -> dict:
    actor = db.get(User, actor_id) if actor_id else None

    if evaluation.outcome == "approved":
        task = next_task_for(db, assignment.intern, actor)
        if task is None:
            return {"outcome": "approved", "complete": True, "meeting": None, "assignment": None}
        next_assignment = _create_assignment(db, task, assignment.intern, actor)
        meeting = _schedule_meeting(
            db,
            next_assignment,
            actor,
            title_prefix="Next task briefing",
            agenda="Walk through the next task and answer any questions before work starts.",
        )
        return {
            "outcome": "approved",
            "complete": False,
            "meeting": meeting,
            "assignment": next_assignment,
        }

    if evaluation.outcome == "revision_required":
        issue = next(
            (item.get("issue") for item in evaluation.feedback if item.get("issue")),
            "One or more acceptance criteria were not met.",
        )
        meeting = _schedule_meeting(
            db,
            assignment,
            actor,
            title_prefix="Rework review",
            agenda=f"Review the feedback, correct the issues and resubmit. Main issue: {issue}",
        )
        return {
            "outcome": "revision_required",
            "complete": False,
            "meeting": meeting,
            "assignment": assignment,
        }

    return {"outcome": evaluation.outcome, "complete": False, "meeting": None, "assignment": None}


def send_followups(
    db: Session,
    assignment: Assignment,
    prepared: dict,
    actor_id: int | None = None,
) -> None:
    actor = db.get(User, actor_id) if actor_id else None
    if prepared.get("outcome") != "approved":
        return
    if prepared.get("complete"):
        _send_program_complete(db, assignment.intern, actor)
        return
    next_assignment = prepared.get("assignment")
    meeting = prepared.get("meeting")
    if next_assignment and meeting:
        _send_kickoff(db, next_assignment, meeting, actor)


def schedule_rework_meeting(
    db: Session,
    assignment: Assignment,
    actor: User | None,
    issue: str,
) -> Meeting:
    return _schedule_meeting(
        db,
        assignment,
        actor,
        title_prefix="Rework review",
        agenda=f"Review the feedback, correct the issues and resubmit. Main issue: {issue}",
    )


def advance_after_approval(
    db: Session,
    assignment: Assignment,
    reviewer: User | None = None,
) -> dict:
    result = launch_intern(db, assignment.intern, reviewer)
    return result
