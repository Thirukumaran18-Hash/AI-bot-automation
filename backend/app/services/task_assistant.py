import json

import httpx

from ..config import settings
from ..schemas import TaskDraftRequest
from .ai_engine import DEFAULT_RUBRIC


def _heuristic_draft(payload: TaskDraftRequest) -> dict:
    title = payload.title.strip()
    notes = payload.notes.strip()
    domain = payload.domain
    difficulty = payload.difficulty

    description = (
        f"## Objective\n\nBuild a {difficulty.lower()}-level {domain} deliverable: {title}.\n\n"
        f"{notes or 'Apply the concepts covered in the current learning module and document your decisions.'}\n\n"
        "## What to submit\n\n"
        "- A working implementation or analysis artefact.\n"
        "- Tests or validation evidence that shows the work behaves as expected.\n"
        "- A short README explaining setup, approach and known limitations.\n\n"
        "## How you will be evaluated\n\n"
        "Your submission is checked against the deliverables and acceptance criteria. "
        "Automated checks run first, then the rubric is scored. Borderline results go to your mentor."
    )
    return {
        "title": title,
        "domain": domain,
        "difficulty": difficulty,
        "description": description,
        "deliverables": ["Source code / artefact", "Tests or validation evidence", "README"],
        "acceptance_criteria": [
            "The deliverable matches the objective and works for the documented main scenario.",
            "Invalid or edge-case inputs are handled without crashing.",
            "Setup and usage steps are documented clearly.",
        ],
        "rubric": [dict(item) for item in DEFAULT_RUBRIC],
        "test_cases": [
            {"name": "Happy path", "detail": "The main scenario produces the expected output."},
            {"name": "Invalid input", "detail": "Invalid or empty input is rejected safely."},
            {"name": "Edge case", "detail": "A boundary case is handled without a crash."},
        ],
        "deadline_days": 7,
        "generated_by": "heuristic",
    }


def _llm_draft(payload: TaskDraftRequest) -> dict | None:
    if settings.ai_provider != "openai" or not settings.openai_api_key:
        return None
    prompt = {
        "title": payload.title,
        "domain": payload.domain,
        "difficulty": payload.difficulty,
        "coordinator_notes": payload.notes,
        "requirements": {
            "deliverables": "3-6 concrete items",
            "acceptance_criteria": "3-6 observable criteria",
            "rubric": "4 criteria with weights summing to 100",
            "test_cases": "2-5 test cases",
            "deadline_days": "integer 3-21",
        },
    }
    body = {
        "model": settings.openai_model,
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an internship task designer. Return JSON with keys title, domain, "
                    "difficulty, description (markdown), deliverables (array of strings), "
                    "acceptance_criteria (array of strings), rubric (array of objects with name, "
                    "weight, description), test_cases (array of objects with name and detail), "
                    "deadline_days. Keep the task practical and measurable."
                ),
            },
            {"role": "user", "content": json.dumps(prompt)},
        ],
    }
    try:
        with httpx.Client(timeout=settings.ai_timeout_seconds) as client:
            response = client.post(
                f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            content = content[content.find("{"):]
        data = json.loads(content)
        data["generated_by"] = "openai"
        return data
    except (httpx.HTTPError, KeyError, ValueError, json.JSONDecodeError):
        return None


def draft_task(payload: TaskDraftRequest) -> dict:
    return _llm_draft(payload) or _heuristic_draft(payload)
