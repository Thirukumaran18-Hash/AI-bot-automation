import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import ensure_assignment_access, require_roles
from ..models import Assignment, Intern, Submission, User
from ..serializers import assignment_dict, evaluation_dict, submission_dict
from ..services.calendar_service import safe_filename
from ..services.email_service import send_email
from ..services.evaluator import email_context, run_evaluation
from ..services.workflow import record_event
from ..utils import human_datetime

router = APIRouter(prefix="/submissions", tags=["submissions"])

SUBMITTABLE_STATUSES = {"assigned", "in_progress", "revision_required", "resubmitted"}


def _current_intern(db: Session, user: User) -> Intern | None:
    if user.role != "intern":
        return None
    return db.query(Intern).filter(Intern.user_id == user.id).first()


def _validate_repo(repo_url: str | None) -> str | None:
    if not repo_url:
        return None
    value = repo_url.strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Repository URL must start with http:// or https://")
    return value


@router.post("/assignments/{assignment_id}", status_code=status.HTTP_201_CREATED)
async def submit_work(
    assignment_id: int,
    file: UploadFile | None = File(default=None),
    repo_url: str | None = Form(default=None),
    notes: str | None = Form(default=None),
    auto_evaluate: bool = Form(default=True),
    user: User = Depends(require_roles("intern")),
    db: Session = Depends(get_db),
) -> dict:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    intern = _current_intern(db, user)
    ensure_assignment_access(assignment, user, intern)
    if assignment.status not in SUBMITTABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit while the assignment is '{assignment.status}'",
        )

    repo_url = _validate_repo(repo_url)
    notes = (notes or "").strip()
    if not file and not repo_url and not notes:
        raise HTTPException(
            status_code=400,
            detail="Provide a file, a repository URL, or submission notes",
        )

    version = (max((s.version for s in assignment.submissions), default=0)) + 1
    stored_path: Path | None = None
    original_name: str | None = None
    size = 0
    if file and file.filename:
        original_name = safe_filename(file.filename)
        extension = Path(original_name).suffix.lower()
        if extension not in settings.allowed_extension_list:
            raise HTTPException(
                status_code=400,
                detail=f"File type {extension or '(none)'} is not allowed",
            )
        max_bytes = settings.max_upload_mb * 1024 * 1024
        content = await file.read(max_bytes + 1)
        size = len(content)
        if size > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {settings.max_upload_mb} MB limit",
            )
        if size == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty")
        folder = Path(settings.storage_dir) / "submissions" / str(assignment.id)
        folder.mkdir(parents=True, exist_ok=True)
        stored_path = folder / f"v{version}_{uuid.uuid4().hex[:8]}_{original_name}"
        stored_path.write_bytes(content)

    previous = assignment.status
    submission = Submission(
        assignment_id=assignment.id,
        version=version,
        file_path=str(stored_path) if stored_path else None,
        file_name=original_name,
        file_size=size if stored_path else None,
        repo_url=repo_url,
        notes=notes or None,
    )
    db.add(submission)
    assignment.status = "resubmitted" if previous == "revision_required" else "submitted"
    db.flush()
    record_event(
        db,
        "submission",
        submission.id,
        "submission.received",
        new_status=assignment.status,
        actor_id=user.id,
        meta={
            "assignment_id": assignment.id,
            "version": version,
            "has_file": bool(stored_path),
            "has_repo": bool(repo_url),
        },
    )
    record_event(
        db,
        "assignment",
        assignment.id,
        "submission.received",
        previous_status=previous,
        new_status=assignment.status,
        actor_id=user.id,
        meta={"submission_id": submission.id, "version": version},
    )
    send_email(
        db,
        recipient=user.email,
        template="submission_receipt",
        context={
            **email_context(assignment),
            "version": version,
            "submitted_at": human_datetime(submission.submitted_at),
            "file_name": original_name,
            "repo_url": repo_url,
        },
        entity_type="submission",
        entity_id=submission.id,
    )
    db.commit()
    db.refresh(submission)
    db.refresh(assignment)

    evaluation = None
    evaluation_error = None
    if auto_evaluate:
        try:
            evaluation = run_evaluation(db, assignment, submission, actor_id=None)
            db.commit()
            db.refresh(assignment)
        except Exception as exc:  # keep the submission even if evaluation fails
            db.rollback()
            evaluation_error = f"Evaluation could not be completed: {exc}"
            assignment = db.get(Assignment, assignment_id)
            assignment.status = "submitted"
            db.commit()

    return {
        "submission": submission_dict(submission),
        "assignment": assignment_dict(assignment),
        "evaluation": evaluation_dict(evaluation) if evaluation else None,
        "evaluation_error": evaluation_error,
    }


@router.get("")
def list_submissions(
    assignment_id: int | None = None,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = db.query(Submission).join(Assignment, Submission.assignment_id == Assignment.id).join(
        Intern, Assignment.intern_id == Intern.id
    )
    if user.role == "mentor":
        query = query.filter(Intern.mentor_id == user.id)
    elif user.role == "intern":
        query = query.filter(Intern.user_id == user.id)
    if assignment_id:
        query = query.filter(Submission.assignment_id == assignment_id)

    results = []
    for submission in query.order_by(Submission.submitted_at.desc()).all():
        evaluation = submission.evaluations[-1] if submission.evaluations else None
        results.append(
            {
                **submission_dict(submission),
                "assignment_status": submission.assignment.status,
                "task_title": submission.assignment.task.title,
                "intern_name": submission.assignment.intern.user.name,
                "intern_email": submission.assignment.intern.user.email,
                "evaluation": evaluation_dict(evaluation),
            }
        )
    return results


@router.get("/{submission_id}")
def get_submission(
    submission_id: int,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
) -> dict:
    submission = db.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    ensure_assignment_access(submission.assignment, user, _current_intern(db, user))
    evaluation = submission.evaluations[-1] if submission.evaluations else None
    return {
        **submission_dict(submission),
        "assignment": assignment_dict(submission.assignment),
        "evaluation": evaluation_dict(evaluation),
    }


@router.get("/{submission_id}/download")
def download_submission(
    submission_id: int,
    user: User = Depends(require_roles("admin", "mentor", "intern")),
    db: Session = Depends(get_db),
):
    submission = db.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    ensure_assignment_access(submission.assignment, user, _current_intern(db, user))
    if not submission.file_path:
        raise HTTPException(status_code=404, detail="This submission does not include a file")
    path = Path(submission.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file is no longer available")
    return FileResponse(
        path,
        filename=submission.file_name or path.name,
        media_type="application/octet-stream",
    )


@router.post("/{submission_id}/evaluate")
def reevaluate(
    submission_id: int,
    user: User = Depends(require_roles("admin", "mentor")),
    db: Session = Depends(get_db),
) -> dict:
    submission = db.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    assignment = submission.assignment
    if user.role == "mentor" and assignment.intern.mentor_id != user.id:
        raise HTTPException(status_code=403, detail="This submission is not assigned to you")
    if assignment.status in {"approved", "completed"}:
        raise HTTPException(status_code=400, detail="This assignment is already complete")
    evaluation = run_evaluation(db, assignment, submission, actor_id=user.id)
    db.commit()
    db.refresh(assignment)
    return {
        "evaluation": evaluation_dict(evaluation),
        "assignment": assignment_dict(assignment),
    }


@router.delete("/{submission_id}")
def delete_submission(
    submission_id: int,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    submission = db.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if submission.file_path:
        try:
            Path(submission.file_path).unlink(missing_ok=True)
        except OSError:
            pass
    assignment = submission.assignment
    previous = assignment.status
    remaining = sum(1 for item in assignment.submissions if item.id != submission.id)
    db.delete(submission)
    assignment.status = "in_progress" if remaining else "assigned"
    record_event(
        db,
        "submission",
        submission_id,
        "submission.deleted",
        previous_status=previous,
        new_status=assignment.status,
        actor_id=user.id,
    )
    db.commit()
    return {"message": "Submission deleted", "assignment_status": assignment.status}
