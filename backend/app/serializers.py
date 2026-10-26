from datetime import datetime

from .models import (
    Assignment,
    EmailLog,
    Evaluation,
    Intern,
    Meeting,
    Submission,
    Task,
    User,
    WorkflowEvent,
)

COMPLETED_STATUSES = {"approved", "completed"}
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


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.isoformat()
    return value.isoformat() + "Z"


def user_dict(user: User | None) -> dict | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "active": user.active,
        "created_at": iso(user.created_at),
    }


def latest_evaluation(assignment: Assignment) -> Evaluation | None:
    for submission in reversed(assignment.submissions):
        if submission.evaluations:
            return submission.evaluations[-1]
    return None


def submission_dict(submission: Submission | None) -> dict | None:
    if submission is None:
        return None
    return {
        "id": submission.id,
        "assignment_id": submission.assignment_id,
        "version": submission.version,
        "file_name": submission.file_name,
        "file_size": submission.file_size,
        "has_file": bool(submission.file_path),
        "repo_url": submission.repo_url,
        "notes": submission.notes,
        "submitted_at": iso(submission.submitted_at),
        "download_url": (
            f"/api/submissions/{submission.id}/download" if submission.file_path else None
        ),
    }


def evaluation_dict(evaluation: Evaluation | None, include_submission: bool = False) -> dict | None:
    if evaluation is None:
        return None
    data = {
        "id": evaluation.id,
        "submission_id": evaluation.submission_id,
        "scores": evaluation.scores,
        "test_results": evaluation.test_results,
        "total_score": round(evaluation.total_score, 1),
        "confidence": round(evaluation.confidence, 2),
        "outcome": evaluation.outcome,
        "final_outcome": evaluation.final_outcome,
        "summary": evaluation.summary,
        "feedback": evaluation.feedback,
        "engine": evaluation.engine,
        "reviewer": user_dict(evaluation.reviewer),
        "override_reason": evaluation.override_reason,
        "created_at": iso(evaluation.created_at),
        "decided_at": iso(evaluation.decided_at),
    }
    if include_submission and evaluation.submission:
        data["submission"] = submission_dict(evaluation.submission)
    return data


def intern_dict(intern: Intern) -> dict:
    assignments = intern.assignments
    completed = sum(1 for a in assignments if a.status in COMPLETED_STATUSES)
    scores = []
    for assignment in assignments:
        evaluation = latest_evaluation(assignment)
        if evaluation:
            scores.append(evaluation.total_score)
    return {
        "id": intern.id,
        "user_id": intern.user_id,
        "name": intern.user.name,
        "email": intern.user.email,
        "batch": intern.batch,
        "domain": intern.domain,
        "phone": intern.phone,
        "skills": [s.strip() for s in intern.skills.split(",") if s.strip()],
        "mentor_id": intern.mentor_id,
        "mentor_name": intern.mentor.name if intern.mentor else None,
        "active": intern.active,
        "joined_at": iso(intern.joined_at),
        "assignment_count": len(assignments),
        "completed_count": completed,
        "overdue_count": sum(
            1
            for a in assignments
            if a.status in OPEN_STATUSES and a.due_date < datetime.utcnow()
        ),
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
    }


def task_dict(task: Task) -> dict:
    assignments = task.assignments
    scores = []
    for assignment in assignments:
        evaluation = latest_evaluation(assignment)
        if evaluation:
            scores.append(evaluation.total_score)
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "domain": task.domain,
        "difficulty": task.difficulty,
        "deliverables": task.deliverables,
        "acceptance_criteria": task.acceptance_criteria,
        "rubric": task.rubric,
        "test_cases": task.test_cases,
        "deadline_days": task.deadline_days,
        "pass_threshold": task.pass_threshold,
        "status": task.status,
        "created_by": task.created_by,
        "created_at": iso(task.created_at),
        "assignment_count": len(assignments),
        "completed_count": sum(1 for a in assignments if a.status in COMPLETED_STATUSES),
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
    }


def assignment_dict(assignment: Assignment, detail: bool = False) -> dict:
    latest_submission = assignment.submissions[-1] if assignment.submissions else None
    evaluation = latest_evaluation(assignment)
    data = {
        "id": assignment.id,
        "task_id": assignment.task_id,
        "task_title": assignment.task.title,
        "task_description": assignment.task.description,
        "task_domain": assignment.task.domain,
        "task_difficulty": assignment.task.difficulty,
        "deliverables": assignment.task.deliverables,
        "acceptance_criteria": assignment.task.acceptance_criteria,
        "rubric": assignment.task.rubric,
        "pass_threshold": assignment.task.pass_threshold,
        "intern_id": assignment.intern_id,
        "intern_name": assignment.intern.user.name,
        "intern_email": assignment.intern.user.email,
        "intern_domain": assignment.intern.domain,
        "mentor_id": assignment.intern.mentor_id,
        "mentor_name": assignment.intern.mentor.name if assignment.intern.mentor else None,
        "due_date": iso(assignment.due_date),
        "status": assignment.status,
        "assigned_by": assignment.assigned_by,
        "created_at": iso(assignment.created_at),
        "updated_at": iso(assignment.updated_at),
        "overdue": assignment.status in OPEN_STATUSES
        and assignment.due_date < datetime.utcnow(),
        "submission_count": len(assignment.submissions),
        "latest_submission": submission_dict(latest_submission),
        "latest_evaluation": evaluation_dict(evaluation),
        "meeting_count": len(assignment.meetings),
    }
    if detail:
        data["submissions"] = [
            {
                **submission_dict(submission),
                "evaluations": [evaluation_dict(e) for e in submission.evaluations],
            }
            for submission in reversed(assignment.submissions)
        ]
        data["meetings"] = [meeting_dict(m) for m in assignment.meetings]
    return data


def meeting_dict(meeting: Meeting) -> dict:
    assignment = meeting.assignment
    intern = assignment.intern if assignment else None
    mentor = intern.mentor if intern else None
    return {
        "id": meeting.id,
        "assignment_id": meeting.assignment_id,
        "title": meeting.title,
        "agenda": meeting.agenda,
        "start_time": iso(meeting.start_time),
        "end_time": iso(meeting.end_time),
        "join_url": meeting.join_url,
        "provider_event_id": meeting.provider_event_id,
        "status": meeting.status,
        "created_by": meeting.created_by,
        "created_at": iso(meeting.created_at),
        "intern_name": intern.user.name if intern else None,
        "intern_email": intern.user.email if intern else None,
        "mentor_name": mentor.name if mentor else None,
        "mentor_email": mentor.email if mentor else None,
        "task_title": assignment.task.title if assignment else None,
        "ics_url": f"/api/meetings/{meeting.id}/ics",
    }


def email_dict(log: EmailLog) -> dict:
    return {
        "id": log.id,
        "recipient": log.recipient,
        "template": log.template,
        "subject": log.subject,
        "body": log.body,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "status": log.status,
        "retry_count": log.retry_count,
        "created_at": iso(log.created_at),
    }


def event_dict(event: WorkflowEvent) -> dict:
    return {
        "id": event.id,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "previous_status": event.previous_status,
        "new_status": event.new_status,
        "actor_id": event.actor_id,
        "actor_name": event.actor.name if event.actor else "System",
        "action": event.action,
        "meta": event.meta,
        "created_at": iso(event.created_at),
    }
