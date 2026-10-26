from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class RubricCriterion(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    weight: float = Field(gt=0, le=100)
    description: str = ""


class InternCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str | None = Field(default=None, min_length=8)
    batch: str = Field(min_length=1, max_length=80)
    domain: str = Field(min_length=1, max_length=80)
    skills: str = ""
    mentor_id: int | None = None


class InternUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    batch: str | None = None
    domain: str | None = None
    skills: str | None = None
    mentor_id: int | None = None
    active: bool | None = None


class TaskCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10)
    domain: str = Field(min_length=1, max_length=80)
    difficulty: Literal["Beginner", "Intermediate", "Advanced"] = "Beginner"
    deliverables: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    rubric: list[RubricCriterion] = Field(default_factory=list)
    test_cases: list[dict] = Field(default_factory=list)
    deadline_days: int = Field(default=7, ge=1, le=120)
    pass_threshold: float = Field(default=70.0, ge=1, le=100)
    status: Literal["draft", "approved"] = "approved"

    @field_validator("deliverables", "acceptance_criteria")
    @classmethod
    def clean_list(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item and item.strip()]


class AssignmentCreate(BaseModel):
    task_id: int
    intern_id: int
    due_date: datetime | None = None


class AutoAssignRequest(BaseModel):
    task_id: int
    batch: str | None = None
    domain: str | None = None


class StatusUpdateRequest(BaseModel):
    status: Literal[
        "assigned",
        "in_progress",
        "review_scheduled",
        "completed",
    ]


class DecisionRequest(BaseModel):
    outcome: Literal["approved", "revision_required"]
    reason: str | None = None


class MeetingCreate(BaseModel):
    assignment_id: int | None = None
    title: str = Field(min_length=3, max_length=200)
    agenda: str = ""
    start_time: datetime
    duration_minutes: int = Field(default=30, ge=10, le=240)
    attendee_ids: list[int] = Field(default_factory=list)


class TaskDraftRequest(BaseModel):
    title: str
    domain: str
    difficulty: Literal["Beginner", "Intermediate", "Advanced"] = "Beginner"
    notes: str = ""
