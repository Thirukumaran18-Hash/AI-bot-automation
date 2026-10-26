from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import Assignment, Evaluation, Intern, User
from ..schemas import DecisionRequest
from ..serializers import assignment_dict, evaluation_dict
from ..services.evaluator import apply_decision

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("/queue")
def review_queue(
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = (
        db.query(Assignment)
        .join(Intern, Assignment.intern_id == Intern.id)
        .filter(Assignment.status == "human_review")
    )
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)
    return [assignment_dict(item, detail=True) for item in query.order_by(Assignment.updated_at).all()]


@router.get("/evaluations")
def evaluation_history(
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> list[dict]:
    evaluations = db.query(Evaluation).order_by(Evaluation.created_at.desc()).limit(200).all()
    results = []
    for evaluation in evaluations:
        assignment = evaluation.submission.assignment
        if user.role == "mentor" and assignment.intern.mentor_id != user.id:
            continue
        results.append(
            {
                **evaluation_dict(evaluation),
                "assignment_id": assignment.id,
                "task_title": assignment.task.title,
                "intern_name": assignment.intern.user.name,
                "assignment_status": assignment.status,
            }
        )
    return results


@router.get("/pending-count")
def pending_count(
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    query = (
        db.query(Assignment)
        .join(Intern, Assignment.intern_id == Intern.id)
        .filter(Assignment.status == "human_review")
    )
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)
    return {"pending": query.count()}


@router.post("/{evaluation_id}/decision")
def decide(
    evaluation_id: int,
    payload: DecisionRequest,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    evaluation = db.get(Evaluation, evaluation_id)
    if not evaluation:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    assignment = evaluation.submission.assignment
    if user.role == "mentor" and assignment.intern.mentor_id != user.id:
        raise HTTPException(status_code=403, detail="This submission is not assigned to you")
    if assignment.status == "completed":
        raise HTTPException(status_code=400, detail="This assignment is already completed")

    apply_decision(db, assignment, evaluation, payload.outcome, payload.reason, user)
    db.commit()
    db.refresh(assignment)
    return {
        "evaluation": evaluation_dict(evaluation),
        "assignment": assignment_dict(assignment, detail=True),
    }
