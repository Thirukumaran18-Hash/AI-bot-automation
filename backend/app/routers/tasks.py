from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import Task, User
from ..schemas import TaskCreate, TaskDraftRequest
from ..serializers import task_dict
from ..services.ai_engine import normalize_weights
from ..services.task_assistant import draft_task
from ..services.workflow import record_event

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("")
def list_tasks(
    domain: str | None = None,
    task_status: str | None = None,
    search: str | None = None,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = db.query(Task)
    if user.role == "intern":
        query = query.filter(Task.status == "approved")
    if domain:
        query = query.filter(Task.domain == domain)
    if task_status:
        query = query.filter(Task.status == task_status)
    if search:
        pattern = f"%{search.lower()}%"
        query = query.filter(or_(Task.title.ilike(pattern), Task.description.ilike(pattern)))
    return [task_dict(task) for task in query.order_by(Task.created_at.desc()).all()]


@router.get("/facets")
def task_facets(
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    domains = sorted(
        {row[0] for row in db.query(Task.domain).distinct().all() if row[0]}
    )
    return {"domains": domains}


@router.post("/ai-draft")
def ai_draft(
    payload: TaskDraftRequest,
    user: User = Depends(require_roles("admin", "mentor")),
) -> dict:
    return draft_task(payload)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    task_status = payload.status
    if user.role == "mentor":
        task_status = "draft"

    rubric = normalize_weights([item.model_dump() for item in payload.rubric])
    task = Task(
        title=payload.title,
        description=payload.description,
        domain=payload.domain,
        difficulty=payload.difficulty,
        deliverables=payload.deliverables,
        acceptance_criteria=payload.acceptance_criteria,
        rubric=rubric,
        test_cases=payload.test_cases,
        deadline_days=payload.deadline_days,
        pass_threshold=payload.pass_threshold,
        status=task_status,
        created_by=user.id,
    )
    db.add(task)
    db.flush()
    record_event(
        db,
        "task",
        task.id,
        "task.created",
        new_status=task.status,
        actor_id=user.id,
        meta={"title": task.title, "domain": task.domain},
    )
    db.commit()
    db.refresh(task)
    return task_dict(task)


@router.get("/{task_id}")
def get_task(
    task_id: int,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> dict:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if user.role == "intern" and task.status != "approved":
        raise HTTPException(status_code=403, detail="This task is not published yet")
    return task_dict(task)


@router.post("/{task_id}/approve")
def approve_task(
    task_id: int,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == "approved":
        return task_dict(task)
    previous = task.status
    task.status = "approved"
    record_event(
        db,
        "task",
        task.id,
        "task.approved",
        previous_status=previous,
        new_status="approved",
        actor_id=user.id,
    )
    db.commit()
    db.refresh(task)
    return task_dict(task)


@router.patch("/{task_id}")
def update_task(
    task_id: int,
    payload: TaskCreate,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.title = payload.title
    task.description = payload.description
    task.domain = payload.domain
    task.difficulty = payload.difficulty
    task.deliverables = payload.deliverables
    task.acceptance_criteria = payload.acceptance_criteria
    task.rubric = normalize_weights([item.model_dump() for item in payload.rubric])
    task.test_cases = payload.test_cases
    task.deadline_days = payload.deadline_days
    task.pass_threshold = payload.pass_threshold
    task.status = payload.status
    record_event(
        db,
        "task",
        task.id,
        "task.updated",
        actor_id=user.id,
        meta={"title": task.title},
    )
    db.commit()
    db.refresh(task)
    return task_dict(task)
