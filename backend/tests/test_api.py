import os
import tempfile
import uuid
from pathlib import Path

TEST_ROOT = Path(tempfile.mkdtemp(prefix="internflow-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_ROOT / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(TEST_ROOT / "storage")
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["SEED_DEMO_DATA"] = "true"
os.environ["AI_PROVIDER"] = "heuristic"
os.environ["OPENAI_API_KEY"] = ""
os.environ["JWT_SECRET"] = "internflow-test-secret"

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, email: str, password: str) -> str:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["ai_provider"] == "heuristic"
    assert payload["email_mode"] == "log-only"


def test_authentication_and_permissions(client: TestClient):
    invalid = client.post(
        "/api/auth/login",
        json={"email": "admin@internflow.ai", "password": "wrong-password"},
    )
    assert invalid.status_code == 401

    admin_token = login(client, "admin@internflow.ai", "Admin@123")
    intern_token = login(client, "arun@internflow.ai", "Intern@123")
    mentor_token = login(client, "mentor@internflow.ai", "Mentor@123")

    me = client.get("/api/auth/me", headers=headers(admin_token))
    assert me.status_code == 200
    assert me.json()["role"] == "admin"

    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/interns", headers=headers(intern_token)).status_code == 403
    assert client.get("/api/reviews/queue", headers=headers(intern_token)).status_code == 403
    assert client.get("/api/activity/integrations", headers=headers(intern_token)).status_code == 403

    admin_interns = client.get("/api/interns", headers=headers(admin_token))
    mentor_interns = client.get("/api/interns", headers=headers(mentor_token))
    assert admin_interns.status_code == 200
    assert mentor_interns.status_code == 200
    assert len(mentor_interns.json()) <= len(admin_interns.json())


def test_seeded_dashboard(client: TestClient):
    admin_token = login(client, "admin@internflow.ai", "Admin@123")
    response = client.get("/api/dashboard", headers=headers(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "admin"
    assert data["cards"]["interns"] >= 6
    assert data["cards"]["assignments"] >= 6
    assert data["cards"]["submissions"] >= 4
    assert data["email_stats"]["total"] > 0
    assert data["recent_events"]

    intern_token = login(client, "arun@internflow.ai", "Intern@123")
    intern_dashboard = client.get("/api/dashboard", headers=headers(intern_token))
    assert intern_dashboard.status_code == 200
    assert intern_dashboard.json()["role"] == "intern"


def test_assignment_submission_evaluation_meeting_flow(client: TestClient):
    admin_token = login(client, "admin@internflow.ai", "Admin@123")
    intern_token = login(client, "arun@internflow.ai", "Intern@123")
    other_token = login(client, "divya@internflow.ai", "Intern@123")

    interns = client.get("/api/interns?active=true", headers=headers(admin_token))
    assert interns.status_code == 200
    arun = next(item for item in interns.json() if item["email"] == "arun@internflow.ai")

    task_payload = {
        "title": f"API workflow test {uuid.uuid4().hex[:6]}",
        "description": (
            "Build a small validated calculator module with tests, error handling and a "
            "README that explains setup and usage."
        ),
        "domain": "Python",
        "difficulty": "Beginner",
        "deliverables": ["Source code", "Tests", "README"],
        "acceptance_criteria": [],
        "rubric": [
            {"name": "Requirement matching", "weight": 25, "description": "Deliverables present."},
            {"name": "Functional correctness", "weight": 30, "description": "Tests and logic work."},
            {"name": "Code quality", "weight": 25, "description": "Readable, structured code."},
            {"name": "Documentation", "weight": 20, "description": "Setup and usage documented."},
        ],
        "test_cases": [{"name": "Valid input"}, {"name": "Invalid input"}],
        "deadline_days": 7,
        "pass_threshold": 70,
        "status": "approved",
    }
    task_response = client.post("/api/tasks", headers=headers(admin_token), json=task_payload)
    assert task_response.status_code == 201, task_response.text
    task_id = task_response.json()["id"]

    draft = client.post(
        "/api/tasks/ai-draft",
        headers=headers(admin_token),
        json={"title": "CSV parser", "domain": "Python", "difficulty": "Beginner", "notes": "Parse and validate CSV"},
    )
    assert draft.status_code == 200
    assert draft.json()["title"]
    assert draft.json()["rubric"]

    assignment_response = client.post(
        "/api/assignments",
        headers=headers(admin_token),
        json={"task_id": task_id, "intern_id": arun["id"]},
    )
    assert assignment_response.status_code == 201, assignment_response.text
    assignment = assignment_response.json()
    assignment_id = assignment["id"]
    assert assignment["status"] == "assigned"

    other_view = client.get(f"/api/assignments/{assignment_id}", headers=headers(other_token))
    assert other_view.status_code == 403

    source = (
        "def add(left, right):\n"
        "    return left + right\n"
        "\n"
        "def validate(value):\n"
        "    if not value:\n"
        "        raise ValueError('value is required')\n"
        "    return value.strip()\n"
        "\n"
        "def test_add():\n"
        "    assert add(2, 3) == 5\n"
        "\n"
        "def test_validate():\n"
        "    assert validate(' ok ') == 'ok'\n"
        "\n"
        "def test_invalid():\n"
        "    try:\n"
        "        validate('')\n"
        "    except ValueError:\n"
        "        assert True\n"
    )
    notes = (
        "README: This module validates input and adds two numbers. "
        "Run the tests with pytest. The implementation handles empty input by raising "
        "a ValueError and keeps functions small and readable for review."
    )
    submission_response = client.post(
        f"/api/submissions/assignments/{assignment_id}",
        headers=headers(intern_token),
        data={"notes": notes, "auto_evaluate": "true"},
        files={"file": ("solution.py", source.encode("utf-8"), "text/x-python")},
    )
    assert submission_response.status_code == 201, submission_response.text
    result = submission_response.json()
    assert result["evaluation_error"] is None
    evaluation = result["evaluation"]
    assert evaluation is not None
    assert evaluation["engine"] == "heuristic"
    assert 0 <= evaluation["total_score"] <= 100
    assert len(evaluation["scores"]) == 4
    assert result["assignment"]["status"] == "approved"
    assert evaluation["outcome"] == "approved"

    detail = client.get(f"/api/assignments/{assignment_id}", headers=headers(intern_token))
    assert detail.status_code == 200
    assert detail.json()["latest_submission"]["file_name"] == "solution.py"
    download = client.get(
        f"/api/submissions/{result['submission']['id']}/download",
        headers=headers(admin_token),
    )
    assert download.status_code == 200
    assert download.content == source.encode("utf-8")

    decision = client.post(
        f"/api/reviews/{evaluation['id']}/decision",
        headers=headers(admin_token),
        json={"outcome": "approved", "reason": "Evidence verified in integration test."},
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["evaluation"]["final_outcome"] == "approved"

    meeting_response = client.post(
        "/api/meetings",
        headers=headers(admin_token),
        json={
            "assignment_id": assignment_id,
            "title": "Integration review",
            "agenda": "Walk through the submission and agree next steps.",
            "start_time": "2030-01-15T10:00:00+05:30",
            "duration_minutes": 30,
        },
    )
    assert meeting_response.status_code == 201, meeting_response.text
    meeting = meeting_response.json()
    assert meeting["join_url"].startswith("https://")
    assert meeting["status"] == "scheduled"

    ics = client.get(meeting["ics_url"], headers=headers(intern_token))
    assert ics.status_code == 200
    assert "text/calendar" in ics.headers["content-type"]
    assert b"BEGIN:VCALENDAR" in ics.content

    intern_meetings = client.get("/api/meetings", headers=headers(intern_token))
    assert intern_meetings.status_code == 200
    assert any(item["id"] == meeting["id"] for item in intern_meetings.json())

    cancel = client.post(f"/api/meetings/{meeting['id']}/cancel", headers=headers(admin_token))
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"

    timeline = client.get(
        f"/api/activity/events?entity_type=assignment&entity_id={assignment_id}",
        headers=headers(admin_token),
    )
    assert timeline.status_code == 200
    actions = {item["action"] for item in timeline.json()}
    assert "assignment.created" in actions
    assert "submission.received" in actions


def test_csv_import_and_generated_credentials(client: TestClient):
    admin_token = login(client, "admin@internflow.ai", "Admin@123")
    email = f"qa.{uuid.uuid4().hex[:8]}@example.com"
    csv_content = (
        "name,email,batch,domain,skills,mentor_email,password\n"
        f"QA Candidate,{email},2026-Cohort-B,Web,\"React, TypeScript\",mentor@internflow.ai,\n"
    )
    response = client.post(
        "/api/interns/import",
        headers=headers(admin_token),
        files={"file": ("interns.csv", csv_content.encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created_count"] == 1
    assert payload["error_count"] == 0
    created = payload["created"][0]
    assert created["email"] == email
    assert created["temporary_password"]

    imported_login = client.post(
        "/api/auth/login",
        json={"email": email, "password": created["temporary_password"]},
    )
    assert imported_login.status_code == 200
    assert imported_login.json()["user"]["role"] == "intern"

    duplicate = client.post(
        "/api/interns/import",
        headers=headers(admin_token),
        files={"file": ("interns.csv", csv_content.encode("utf-8"), "text/csv")},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["created_count"] == 0
    assert duplicate.json()["skipped_count"] == 1
