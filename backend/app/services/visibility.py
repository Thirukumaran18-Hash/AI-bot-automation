from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Query, Session

from ..models import Assignment, EmailLog, Intern, Meeting, Submission, User, WorkflowEvent


def scoped_assignments_query(db: Session, user: User) -> Query:
    query = db.query(Assignment)
    if user.role == "mentor":
        query = query.join(Intern, Assignment.intern_id == Intern.id).filter(
            Intern.mentor_id == user.id
        )
    elif user.role == "intern":
        query = query.join(Intern, Assignment.intern_id == Intern.id).filter(
            Intern.user_id == user.id
        )
    return query


def visible_intern_ids(db: Session, user: User):
    query = select(Intern.id)
    if user.role == "mentor":
        query = query.where(Intern.mentor_id == user.id)
    elif user.role == "intern":
        query = query.where(Intern.user_id == user.id)
    return query


def event_visibility_filter(db: Session, user: User):
    if user.role == "admin":
        return None

    intern_ids = visible_intern_ids(db, user)
    assignment_ids = select(Assignment.id).where(Assignment.intern_id.in_(intern_ids))
    submission_ids = select(Submission.id).where(Submission.assignment_id.in_(assignment_ids))
    meeting_ids = select(Meeting.id).where(Meeting.assignment_id.in_(assignment_ids))

    return or_(
        and_(
            WorkflowEvent.entity_type == "assignment",
            WorkflowEvent.entity_id.in_(assignment_ids),
        ),
        and_(
            WorkflowEvent.entity_type == "submission",
            WorkflowEvent.entity_id.in_(submission_ids),
        ),
        and_(
            WorkflowEvent.entity_type == "meeting",
            WorkflowEvent.entity_id.in_(meeting_ids),
        ),
        and_(
            WorkflowEvent.entity_type == "intern",
            WorkflowEvent.entity_id.in_(intern_ids),
        ),
    )


def visible_emails_query(db: Session, user: User) -> Query:
    query = db.query(EmailLog)
    if user.role == "admin":
        return query
    if user.role == "intern":
        return query.filter(EmailLog.recipient == user.email)

    mentee_emails = (
        db.query(User.email)
        .join(Intern, Intern.user_id == User.id)
        .filter(Intern.mentor_id == user.id)
    )
    return query.filter(
        or_(EmailLog.recipient == user.email, EmailLog.recipient.in_(mentee_emails))
    )
