from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from .config import settings
from .models import (
    Assignment,
    Evaluation,
    Intern,
    Meeting,
    Submission,
    Task,
    User,
)
from .security import hash_password
from .services.ai_engine import DEFAULT_RUBRIC, normalize_weights
from .services.calendar_service import create_provider_event
from .services.email_service import send_email
from .services.evaluator import email_context, run_evaluation
from .services.workflow import record_event
from .utils import human_datetime

SEED_SUBMISSION_DIR = Path(settings.storage_dir) / "submissions" / "seed"


def _user(db: Session, name: str, email: str, role: str, password: str) -> User:
    user = User(
        name=name,
        email=email,
        role=role,
        password_hash=hash_password(password),
    )
    db.add(user)
    db.flush()
    return user


def _task(
    db: Session,
    admin: User,
    title: str,
    description: str,
    domain: str,
    difficulty: str,
    deliverables: list[str],
    criteria: list[str],
    rubric: list[dict],
    test_cases: list[dict],
    deadline_days: int,
    status: str = "approved",
) -> Task:
    task = Task(
        title=title,
        description=description,
        domain=domain,
        difficulty=difficulty,
        deliverables=deliverables,
        acceptance_criteria=criteria,
        rubric=normalize_weights(rubric or DEFAULT_RUBRIC),
        test_cases=test_cases,
        deadline_days=deadline_days,
        pass_threshold=70.0,
        status=status,
        created_by=admin.id,
    )
    db.add(task)
    db.flush()
    record_event(
        db,
        "task",
        task.id,
        "task.created",
        new_status=status,
        actor_id=admin.id,
        meta={"title": title, "source": "seed"},
    )
    return task


def _assignment(
    db: Session,
    task: Task,
    intern: Intern,
    actor: User,
    due_days: int,
    assignment_status: str = "assigned",
) -> Assignment:
    assignment = Assignment(
        task_id=task.id,
        intern_id=intern.id,
        due_date=datetime.utcnow() + timedelta(days=due_days),
        status=assignment_status,
        assigned_by=actor.id,
    )
    db.add(assignment)
    db.flush()
    record_event(
        db,
        "assignment",
        assignment.id,
        "assignment.created",
        new_status="assigned",
        actor_id=actor.id,
        meta={"task_id": task.id, "intern_id": intern.id, "source": "seed"},
    )
    send_email(
        db,
        recipient=intern.user.email,
        template="assignment",
        context=email_context(assignment),
        entity_type="assignment",
        entity_id=assignment.id,
    )
    return assignment


def _submission(
    db: Session,
    assignment: Assignment,
    filename: str,
    content: str,
    notes: str,
    repo_url: str | None = None,
) -> Submission:
    SEED_SUBMISSION_DIR.mkdir(parents=True, exist_ok=True)
    path = SEED_SUBMISSION_DIR / filename
    path.write_text(content, encoding="utf-8")
    version = len(assignment.submissions) + 1
    submission = Submission(
        assignment_id=assignment.id,
        version=version,
        file_path=str(path.resolve()),
        file_name=filename,
        file_size=len(content.encode("utf-8")),
        repo_url=repo_url,
        notes=notes,
        submitted_at=datetime.utcnow() - timedelta(minutes=3),
    )
    db.add(submission)
    assignment.status = "submitted"
    db.flush()
    record_event(
        db,
        "submission",
        submission.id,
        "submission.received",
        new_status="submitted",
        actor_id=assignment.intern.user_id,
        meta={"assignment_id": assignment.id, "version": version, "source": "seed"},
    )
    send_email(
        db,
        recipient=assignment.intern.user.email,
        template="submission_receipt",
        context={
            **email_context(assignment),
            "version": version,
            "submitted_at": human_datetime(submission.submitted_at),
            "file_name": filename,
            "repo_url": repo_url,
        },
        entity_type="submission",
        entity_id=submission.id,
    )
    return submission


def _manual_evaluation(
    db: Session,
    assignment: Assignment,
    submission: Submission,
    score: float,
    confidence: float,
    outcome: str,
    summary: str,
    reviewer: User | None = None,
) -> Evaluation:
    rubric = assignment.task.rubric
    scores = []
    offset = [-4, 2, -2, 4]
    for index, item in enumerate(rubric):
        value = max(0, min(100, score + offset[index % len(offset)]))
        scores.append(
            {
                "criterion": item["name"],
                "weight": item["weight"],
                "description": item.get("description", ""),
                "score": value,
                "evidence": "Seeded reviewer evidence for the demo dataset.",
                "issue": None if value >= 70 else "Criterion needs more evidence.",
                "suggestion": None if value >= 70 else "Expand the supporting evidence.",
                "confidence": confidence,
            }
        )
    evaluation = Evaluation(
        submission_id=submission.id,
        scores=scores,
        test_results=[
            {
                "name": "Required deliverables",
                "passed": True,
                "detail": "All required deliverables were detected.",
            },
            {
                "name": "Automated test evidence",
                "passed": outcome == "approved",
                "detail": "Seeded evaluation record.",
            },
        ],
        total_score=score,
        confidence=confidence,
        outcome=outcome,
        summary=summary,
        feedback=scores,
        engine="heuristic",
        reviewer_id=reviewer.id if reviewer else None,
        final_outcome=outcome if reviewer else None,
        decided_at=datetime.utcnow() - timedelta(hours=6) if reviewer else None,
    )
    db.add(evaluation)
    db.flush()
    return evaluation


def seed_demo_data(db: Session) -> None:
    if db.query(User).count() > 0:
        return

    admin = _user(db, "Aishwarya Rao", "admin@internflow.ai", "admin", "Admin@123")
    meera = _user(db, "Meera Raman", "mentor@internflow.ai", "mentor", "Mentor@123")
    suresh = _user(db, "Suresh Kumar", "suresh@internflow.ai", "mentor", "Mentor@123")

    intern_specs = [
        ("Arun Prakash", "arun@internflow.ai", "2026-Cohort-A", "Python", "Python, Flask, SQL", meera),
        ("Divya Nair", "divya@internflow.ai", "2026-Cohort-A", "Python", "Python, Pytest, Git", meera),
        ("Karthik Raj", "karthik@internflow.ai", "2026-Cohort-A", "Web", "JavaScript, Node.js, Express", suresh),
        ("Priya Sharma", "priya@internflow.ai", "2026-Cohort-A", "Data", "Python, Pandas, SQL", suresh),
        ("Vikram Menon", "vikram@internflow.ai", "2026-Cohort-A", "Python", "Python, APIs, Git", meera),
        ("Sneha Iyer", "sneha@internflow.ai", "2026-Cohort-A", "Web", "React, TypeScript, CSS", suresh),
    ]
    interns: dict[str, Intern] = {}
    for name, email, batch, domain, skills, mentor in intern_specs:
        account = _user(db, name, email, "intern", "Intern@123")
        intern = Intern(
            user_id=account.id,
            batch=batch,
            domain=domain,
            skills=skills,
            mentor_id=mentor.id,
        )
        db.add(intern)
        db.flush()
        interns[name] = intern
        record_event(
            db,
            "intern",
            intern.id,
            "intern.created",
            new_status="active",
            actor_id=admin.id,
            meta={"source": "seed", "batch": batch},
        )
        send_email(
            db,
            recipient=email,
            template="welcome",
            context={
                "name": name,
                "email": email,
                "batch": batch,
                "domain": domain,
            },
            entity_type="intern",
            entity_id=intern.id,
        )

    task1 = _task(
        db,
        admin,
        "Python Login Validation",
        "## Objective\n\nCreate a Python module that validates username and password input for a small "
        "login service. The validator must reject empty, too-short and unsafe values and return a clear "
        "error message for each failure.\n\n## Requirements\n\n- Username must be 3-32 characters.\n"
        "- Password must be at least 8 characters and contain both letters and digits.\n"
        "- Return a tuple of (is_valid, message).\n- Include unit tests for valid, empty and short input.",
        "Python",
        "Beginner",
        ["Source code", "Unit tests", "README"],
        [
            "Valid input is accepted.",
            "Empty and too-short input is rejected with a message.",
            "At least three unit tests cover the main cases.",
            "README explains how to run the tests.",
        ],
        DEFAULT_RUBRIC,
        [
            {"name": "Valid login accepted", "detail": "validate_login('divya', 'Password1') returns True."},
            {"name": "Empty password rejected", "detail": "An empty password returns False."},
            {"name": "Short username rejected", "detail": "A two-character username returns False."},
        ],
        7,
    )
    task2 = _task(
        db,
        admin,
        "REST API for Task Board",
        "## Objective\n\nBuild a small REST API for a task board with endpoints to list, create and update "
        "tasks. Use in-memory data or SQLite and return JSON responses.\n\n## Requirements\n\n"
        "- GET /tasks, POST /tasks and PATCH /tasks/:id\n- Validate required fields and return 400 on bad input\n"
        "- Include API documentation and unit tests\n- Add a short setup guide",
        "Web",
        "Intermediate",
        ["Source code", "API documentation", "Unit tests"],
        [
            "All three endpoints work with valid input.",
            "Invalid input returns a 4xx response.",
            "API documentation lists request and response shapes.",
            "Tests cover happy path and validation.",
        ],
        [
            {"name": "Requirement matching", "weight": 20, "description": "Endpoints and deliverables are complete."},
            {"name": "API correctness", "weight": 35, "description": "Endpoints behave correctly and validate input."},
            {"name": "Code quality", "weight": 25, "description": "Code is organised and maintainable."},
            {"name": "API documentation", "weight": 20, "description": "Documentation is clear and accurate."},
        ],
        [
            {"name": "Create task", "detail": "POST /tasks with a title returns 201."},
            {"name": "Reject blank title", "detail": "POST /tasks with no title returns 400."},
            {"name": "Update task", "detail": "PATCH /tasks/:id changes the title."},
        ],
        10,
    )
    task3 = _task(
        db,
        admin,
        "Sales Data Analysis Report",
        "## Objective\n\nAnalyse the provided sales dataset and produce a concise report describing trends, "
        "top products and recommendations for the next quarter.\n\n## Requirements\n\n- Clean the dataset and "
        "document assumptions\n- Include at least two charts\n- Summarise findings in a report\n"
        "- Explain the method so another analyst can reproduce it",
        "Data",
        "Intermediate",
        ["Analysis notebook", "Summary report", "Charts"],
        [
            "The dataset is cleaned and assumptions are documented.",
            "At least two relevant charts are included.",
            "The summary report links evidence to recommendations.",
            "The analysis can be reproduced from the notebook.",
        ],
        [
            {"name": "Requirement matching", "weight": 20, "description": "Required analysis artefacts are present."},
            {"name": "Analysis correctness", "weight": 35, "description": "Insights are supported by the data."},
            {"name": "Report quality", "weight": 25, "description": "The report is clear and well structured."},
            {"name": "Documentation and explanation", "weight": 20, "description": "Method and assumptions are explained."},
        ],
        [
            {"name": "Dataset cleaned", "detail": "Missing values and duplicates are handled."},
            {"name": "Charts present", "detail": "At least two charts support the findings."},
            {"name": "Recommendations", "detail": "Recommendations follow from the evidence."},
        ],
        9,
    )
    _task(
        db,
        admin,
        "Git and Pull Request Workflow",
        "## Objective\n\nPractise the team Git workflow: create a branch, make a focused change, open a pull "
        "request and respond to review comments.\n\n## Requirements\n\n- One small documentation change\n"
        "- Clear commit messages\n- A pull request description explaining the change",
        "Web",
        "Beginner",
        ["Pull request link", "Updated documentation", "Reflection note"],
        ["The pull request is linked.", "The change is focused and documented.", "Review comments are addressed."],
        DEFAULT_RUBRIC,
        [{"name": "Pull request opened", "detail": "A pull request URL is submitted."}],
        5,
        status="draft",
    )

    arun_task = _assignment(db, task1, interns["Arun Prakash"], admin, due_days=3)

    divya_task = _assignment(db, task1, interns["Divya Nair"], admin, due_days=1)
    divya_submission = _submission(
        db,
        divya_task,
        "login_validation.py",
        '''import re

EMAIL_PATTERN = re.compile(r"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")


def validate_username(username: str) -> bool:
    return bool(username and 3 <= len(username.strip()) <= 32)


def validate_password(password: str) -> bool:
    if not password or len(password) < 8:
        return False
    return any(char.isdigit() for char in password) and any(char.isalpha() for char in password)


def validate_login(username: str, password: str) -> tuple[bool, str]:
    if not validate_username(username):
        return False, "Username must be 3-32 characters"
    if not validate_password(password):
        return False, "Password must be at least 8 characters and include letters and digits"
    return True, "ok"


def test_valid_login():
    assert validate_login("divya", "Password1")[0] is True


def test_empty_password():
    assert validate_login("divya", "")[0] is False


def test_short_username():
    assert validate_login("ab", "Password1")[0] is False
''',
        "README for the login validator.\n\nRun the tests with: python -m pytest login_validation.py\n\n"
        "The module exposes validate_username, validate_password and validate_login. Each helper "
        "returns a clear boolean or message, and the three included tests cover the valid case, the "
        "empty password case and the short username edge case. No external dependencies are required.",
        "https://github.com/internflow-demo/python-login-validation",
    )
    divya_eval = run_evaluation(db, divya_task, divya_submission, actor_id=None)

    karthik_task = _assignment(db, task2, interns["Karthik Raj"], admin, due_days=5)
    karthik_submission = _submission(
        db,
        karthik_task,
        "task_board_api.js",
        '''const express = require("express");
const app = express();
app.use(express.json());

const tasks = [];

function validateTask(payload) {
  return payload && typeof payload.title === "string" && payload.title.trim().length > 0;
}

app.get("/tasks", (req, res) => {
  res.json({ data: tasks });
});

app.post("/tasks", (req, res) => {
  if (!validateTask(req.body)) {
    return res.status(400).json({ error: "title is required" });
  }
  const task = { id: tasks.length + 1, title: req.body.title, done: false };
  tasks.push(task);
  res.status(201).json(task);
});

app.patch("/tasks/:id", (req, res) => {
  const task = tasks.find((item) => item.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: "not found" });
  Object.assign(task, req.body);
  res.json(task);
});

app.listen(3000, () => console.log("Task board API listening on port 3000"));
''',
        "First version of the task board API. Endpoints are implemented but tests and API docs still need work.",
    )
    karthik_eval = run_evaluation(db, karthik_task, karthik_submission, actor_id=None)

    priya_task = _assignment(db, task3, interns["Priya Sharma"], admin, due_days=-1)
    priya_submission = _submission(
        db,
        priya_task,
        "sales_analysis.md",
        "# Q3 Sales Analysis\n\n## Method\n\nRemoved duplicate orders, filled missing regions with "
        "'Unknown' and grouped revenue by product and month.\n\n## Findings\n\nRevenue grew 12% "
        "quarter over quarter, driven by the analytics add-on. The top three charts show monthly "
        "revenue, product mix and regional performance.\n\n## Recommendations\n\nFocus the next "
        "quarter on renewals and bundle the analytics add-on with the starter plan.\n",
        "The report includes the method, findings, charts and recommendations. Notebook attached separately.",
        "https://github.com/internflow-demo/sales-analysis",
    )
    priya_evaluation = _manual_evaluation(
        db,
        priya_task,
        priya_submission,
        68.4,
        0.51,
        "human_review",
        "The report is promising but the chart evidence and notebook reproducibility are below the "
        "confidence threshold. A mentor should inspect the notebook before a final decision.",
    )
    priya_task.status = "human_review"
    record_event(
        db,
        "assignment",
        priya_task.id,
        "evaluation.human_review",
        previous_status="submitted",
        new_status="human_review",
        actor_id=None,
        meta={"evaluation_id": priya_evaluation.id, "score": 68.4, "confidence": 0.51},
    )
    send_email(
        db,
        recipient=suresh.email,
        template="human_review",
        context={
            **email_context(priya_task),
            "score": 68.4,
            "confidence": 0.51,
            "summary": priya_evaluation.summary,
        },
        entity_type="evaluation",
        entity_id=priya_evaluation.id,
    )

    vikram_task = _assignment(db, task1, interns["Vikram Menon"], admin, due_days=-2)

    sneha_task = _assignment(db, task2, interns["Sneha Iyer"], admin, due_days=-4)
    sneha_submission = _submission(
        db,
        sneha_task,
        "task_board_ui.md",
        "# Task Board API delivery\n\n## Endpoints\n\nGET /tasks returns all tasks.\nPOST /tasks creates "
        "a task and validates the title.\nPATCH /tasks/:id updates a task.\n\n## Tests\n\nThe test suite "
        "covers create, update and validation. Run with npm test.\n\n## Notes\n\nThe API uses SQLite in "
        "development and returns consistent JSON error shapes for bad input.\n",
        "Completed API with tests, documentation and setup notes. The test suite passes locally.",
        "https://github.com/internflow-demo/task-board-api",
    )
    sneha_evaluation = _manual_evaluation(
        db,
        sneha_task,
        sneha_submission,
        84.0,
        0.81,
        "approved",
        "All deliverables were verified. The API is documented, tested and ready for the review meeting.",
        reviewer=suresh,
    )
    sneha_task.status = "completed"
    record_event(
        db,
        "assignment",
        sneha_task.id,
        "review.approved",
        previous_status="submitted",
        new_status="completed",
        actor_id=suresh.id,
        meta={"evaluation_id": sneha_evaluation.id, "score": 84.0},
    )
    send_email(
        db,
        recipient=interns["Sneha Iyer"].user.email,
        template="approved",
        context={
            **email_context(sneha_task),
            "score": 84.0,
            "confidence": 0.81,
            "footer": "This assignment is marked complete after mentor review.",
        },
        entity_type="evaluation",
        entity_id=sneha_evaluation.id,
    )

    now = datetime.utcnow()
    divya_meeting = Meeting(
        assignment_id=divya_task.id,
        title="Review: Python Login Validation",
        agenda="Walk through the validator, test coverage and next internship milestones.",
        start_time=now + timedelta(days=2, hours=4),
        end_time=now + timedelta(days=2, hours=4, minutes=30),
        status="scheduled",
        created_by=meera.id,
    )
    divya_meeting.provider_event_id, divya_meeting.join_url = create_provider_event(divya_meeting)
    db.add(divya_meeting)
    db.flush()
    record_event(
        db,
        "meeting",
        divya_meeting.id,
        "meeting.created",
        new_status="scheduled",
        actor_id=meera.id,
        meta={"assignment_id": divya_task.id, "source": "seed"},
    )
    divya_task.status = "review_scheduled"
    record_event(
        db,
        "assignment",
        divya_task.id,
        "review.scheduled",
        previous_status=divya_eval.outcome,
        new_status="review_scheduled",
        actor_id=meera.id,
        meta={"meeting_id": divya_meeting.id},
    )
    for recipient in [interns["Divya Nair"].user.email, meera.email]:
        send_email(
            db,
            recipient=recipient,
            template="meeting",
            context={
                "name": interns["Divya Nair"].user.name,
                "task_title": task1.title,
                "meeting_title": divya_meeting.title,
                "start_time": human_datetime(divya_meeting.start_time),
                "duration": "30",
                "join_url": divya_meeting.join_url,
                "agenda": divya_meeting.agenda,
            },
            entity_type="meeting",
            entity_id=divya_meeting.id,
        )

    sneha_meeting = Meeting(
        assignment_id=sneha_task.id,
        title="Final review: Task Board API",
        agenda="Final sign-off and internship feedback.",
        start_time=now - timedelta(days=2, hours=1),
        end_time=now - timedelta(days=2, minutes=30),
        status="completed",
        created_by=suresh.id,
    )
    sneha_meeting.provider_event_id, sneha_meeting.join_url = create_provider_event(sneha_meeting)
    db.add(sneha_meeting)
    db.flush()
    record_event(
        db,
        "meeting",
        sneha_meeting.id,
        "meeting.completed",
        new_status="completed",
        actor_id=suresh.id,
        meta={"assignment_id": sneha_task.id, "source": "seed"},
    )

    db.commit()
