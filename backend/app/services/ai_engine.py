"""AI-assisted evaluation engine.

The engine combines deterministic checks (required deliverables, files, links,
test evidence, static code signals) with an optional LLM rubric review. The LLM
is advisory: mandatory checks and routing thresholds are enforced locally.
"""

from __future__ import annotations

import ast
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import httpx

from ..config import settings
from ..models import Assignment, Submission, Task

TEXT_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".cs", ".go",
    ".rb", ".php", ".sql", ".html", ".css", ".md", ".txt", ".json", ".csv",
    ".yaml", ".yml", ".ipynb",
}
CODE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".cs", ".go",
    ".rb", ".php", ".sql",
}
DOC_EXTENSIONS = {".md", ".txt", ".pdf", ".docx", ".pptx"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
NOTEBOOK_EXTENSIONS = {".ipynb"}

DEFAULT_RUBRIC = [
    {
        "name": "Requirement matching",
        "weight": 25,
        "description": "All required deliverables are present and usable.",
    },
    {
        "name": "Functional correctness",
        "weight": 30,
        "description": "The solution works and handles expected edge cases.",
    },
    {
        "name": "Code / deliverable quality",
        "weight": 25,
        "description": "The work is structured, readable and maintainable.",
    },
    {
        "name": "Documentation and explanation",
        "weight": 20,
        "description": "Setup, usage and decisions are clearly documented.",
    },
]

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "your",
    "have", "must", "should", "will", "were", "been", "being", "their",
    "there", "which", "when", "where", "while", "about", "above", "after",
    "again", "against", "also", "because", "before", "below", "between",
    "each", "more", "most", "other", "some", "such", "than", "these",
    "those", "through", "under", "until", "very", "what", "then", "them",
}


@dataclass
class Evidence:
    file_name: str | None = None
    extension: str = ""
    text: str = ""
    notes: str = ""
    repo_url: str | None = None
    repo_valid: bool = False
    has_file: bool = False
    has_code: bool = False
    has_doc: bool = False
    has_image: bool = False
    has_notebook: bool = False
    has_tests: bool = False
    has_readme: bool = False
    test_count: int = 0
    function_count: int = 0
    line_count: int = 0
    todo_count: int = 0
    zip_names: list[str] = field(default_factory=list)
    deliverable_status: dict[str, bool] = field(default_factory=dict)

    @property
    def notes_len(self) -> int:
        return len(self.notes or "")

    @property
    def text_len(self) -> int:
        return len(self.text or "")


def normalize_weights(rubric: list[dict]) -> list[dict]:
    items = []
    for index, item in enumerate(rubric or []):
        try:
            weight = float(item.get("weight", 0))
        except (TypeError, ValueError):
            weight = 0.0
        if weight <= 0:
            continue
        items.append(
            {
                "name": str(item.get("name") or f"Criterion {index + 1}")[:120],
                "weight": weight,
                "description": str(item.get("description") or ""),
            }
        )
    if not items:
        return [dict(item) for item in DEFAULT_RUBRIC]
    total = sum(item["weight"] for item in items)
    if total <= 0:
        return [dict(item) for item in DEFAULT_RUBRIC]
    for item in items:
        item["weight"] = round(item["weight"] / total * 100, 4)
    return items


def _validate_repo(url: str | None) -> bool:
    if not url:
        return False
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    return "." in parsed.netloc and " " not in url


def _read_text_file(path: Path, limit: int = 60_000) -> str:
    try:
        data = path.read_bytes()[:limit]
    except OSError:
        return ""
    return data.decode("utf-8", errors="ignore")


def _collect_text(path: Path, extension: str) -> tuple[str, list[str], bool]:
    zip_names: list[str] = []
    has_readme = False
    if extension == ".zip":
        try:
            with zipfile.ZipFile(path) as archive:
                infos = [info for info in archive.infolist() if not info.is_dir()][:80]
                zip_names = [info.filename for info in infos]
                chunks: list[str] = []
                total = 0
                for info in infos:
                    lower = info.filename.lower()
                    inner_ext = Path(lower).suffix
                    if inner_ext in {".py", ".js", ".ts", ".java", ".md", ".txt", ".json", ".html", ".css"}:
                        if info.file_size > 400_000:
                            continue
                        with archive.open(info) as handle:
                            data = handle.read(min(info.file_size, 40_000))
                        chunks.append(data.decode("utf-8", errors="ignore"))
                        total += len(chunks[-1])
                        if "readme" in lower:
                            has_readme = True
                        if total >= 80_000:
                            break
                return "\n".join(chunks), zip_names, has_readme
        except (zipfile.BadZipFile, OSError):
            return "", [], False

    if extension not in TEXT_EXTENSIONS:
        return "", [], False

    text = _read_text_file(path)
    if Path(path.name).name.lower().startswith("readme"):
        has_readme = True
    if "# " in text[:800] or "## " in text[:1500]:
        has_readme = True
    return text, [], has_readme


def _python_static_check(text: str) -> str | None:
    if not text.strip():
        return None
    try:
        ast.parse(text)
    except SyntaxError:
        return "Python syntax could not be parsed; review the uploaded source."
    return None


def collect_evidence(submission: Submission, deliverables: list[str] | None = None) -> Evidence:
    ev = Evidence(
        file_name=submission.file_name,
        notes=submission.notes or "",
        repo_url=submission.repo_url,
        repo_valid=_validate_repo(submission.repo_url),
    )
    path: Path | None = None
    if submission.file_path:
        candidate = Path(submission.file_path)
        if candidate.exists() and candidate.is_file():
            path = candidate
            ev.has_file = True
            ev.extension = candidate.suffix.lower()
            ev.has_code = ev.extension in CODE_EXTENSIONS
            ev.has_doc = ev.extension in DOC_EXTENSIONS
            ev.has_image = ev.extension in IMAGE_EXTENSIONS
            ev.has_notebook = ev.extension in NOTEBOOK_EXTENSIONS

            text, zip_names, readme = _collect_text(candidate, ev.extension)
            ev.text = text
            ev.zip_names = zip_names
            ev.has_readme = readme
            if zip_names:
                suffixes = {Path(name).suffix.lower() for name in zip_names}
                ev.has_code = ev.has_code or bool(suffixes & CODE_EXTENSIONS)
                ev.has_doc = ev.has_doc or bool(suffixes & DOC_EXTENSIONS)
                ev.has_image = ev.has_image or bool(suffixes & IMAGE_EXTENSIONS)
                ev.has_notebook = ev.has_notebook or bool(suffixes & NOTEBOOK_EXTENSIONS)
                ev.has_readme = ev.has_readme or any(
                    "readme" in name.lower() for name in zip_names
                )

    combined = "\n".join(part for part in [ev.text, ev.notes] if part)
    lower = combined.lower()
    ev.test_count = len(
        re.findall(r"(?:def\s+test_\w+|describe\s*\(|it\s*\(|pytest|unittest|assert\s+)", combined, re.I)
    )
    ev.has_tests = ev.test_count > 0
    ev.function_count = len(
        re.findall(r"(?:^\s*def\s+\w+|^\s*(?:async\s+)?function\s+\w+|=>)", combined, re.M)
    )
    ev.line_count = len([line for line in combined.splitlines() if line.strip()])
    ev.todo_count = len(re.findall(r"\b(?:TODO|FIXME|HACK|XXX)\b", combined))
    if "readme" in lower:
        ev.has_readme = True

    for deliverable in deliverables or []:
        ev.deliverable_status[deliverable] = _deliverable_satisfied(deliverable, ev)
    return ev


def _deliverable_satisfied(deliverable: str, ev: Evidence) -> bool:
    name = deliverable.lower()
    if any(key in name for key in ("repo", "github", "gitlab", "repository")):
        return ev.repo_valid
    if any(key in name for key in ("readme", "document", "documentation")):
        return ev.has_readme or ev.has_doc or ev.notes_len >= 100
    if "test" in name:
        return ev.has_tests
    if any(key in name for key in ("code", "source", "script", "implementation")):
        return ev.has_code
    if any(key in name for key in ("report", "summary", "write-up", "writeup")):
        return ev.has_doc or ev.notes_len >= 80
    if any(key in name for key in ("chart", "visual", "graph", "dashboard")):
        return ev.has_image or "chart" in ev.notes.lower()
    if any(key in name for key in ("notebook", "analysis")):
        return ev.has_notebook or ev.has_code or ev.notes_len >= 60
    if any(key in name for key in ("presentation", "slide")):
        return ".pptx" in {ev.extension} or ev.notes_len >= 80
    if any(key in name for key in ("file", "upload", "attachment")):
        return ev.has_file
    return ev.has_file or ev.notes_len >= 40


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z]{5,}", value.lower())
        if token not in STOPWORDS
    }


def _criteria_coverage(criteria: list[str], text: str) -> tuple[float, list[str]]:
    if not criteria:
        return 0.0, []
    text_tokens = _tokens(text)
    ratios: list[float] = []
    missed: list[str] = []
    for criterion in criteria:
        tokens = _tokens(criterion)
        if not tokens:
            ratios.append(0.5)
            continue
        overlap = len(tokens & text_tokens) / len(tokens)
        ratios.append(overlap)
        if overlap < 0.34:
            missed.append(criterion)
    return sum(ratios) / len(ratios), missed


def _clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def _score_criterion(
    name: str,
    ev: Evidence,
    delivery_ratio: float,
    criteria_ratio: float,
) -> dict:
    criterion = name.lower()
    combined_len = ev.text_len + ev.notes_len

    if any(key in criterion for key in ("require", "deliver", "accept", "complete")):
        score = 40 + 60 * delivery_ratio
        if criteria_ratio:
            score = (score + (45 + 55 * criteria_ratio)) / 2
        score = _clamp(score)
        missing = [k for k, ok in ev.deliverable_status.items() if not ok]
        evidence = (
            f"{sum(1 for ok in ev.deliverable_status.values() if ok)} / "
            f"{len(ev.deliverable_status)} required deliverables detected."
        )
        if missing:
            evidence += " Missing: " + ", ".join(missing[:4]) + "."
        issue = "Some required deliverables are missing." if missing else None
        suggestion = (
            "Attach the missing deliverables (for example source code, tests or README)."
            if missing
            else None
        )
    elif any(key in criterion for key in ("function", "correct", "test", "working", "behaviour", "behavior")):
        if ev.has_tests:
            score = 86 + min(10, ev.test_count * 2)
        elif ev.has_code:
            score = 63
        elif ev.has_notebook:
            score = 68
        else:
            score = 50 + min(12, combined_len / 40)
        score = _clamp(score)
        evidence = (
            f"Detected {ev.test_count} test signal(s); "
            f"{'code was provided' if ev.has_code else 'no executable code file was detected'}."
        )
        issue = None if ev.has_tests else "No automated test evidence was found."
        suggestion = None if ev.has_tests else "Add unit tests or include the test output in the submission notes."
    elif any(key in criterion for key in ("quality", "maintain", "structure", "readab", "design")):
        if ev.has_code:
            score = 58
            score += 10 if ev.function_count >= 2 else 0
            score += 10 if ev.line_count >= 40 else 0
            score += 8 if ev.todo_count == 0 else -10
            if ev.extension == ".py":
                score += 8 if not _python_static_check(ev.text) else -15
        elif ev.has_doc or ev.has_notebook:
            score = 66 + min(18, combined_len / 120)
        else:
            score = 52 + min(16, combined_len / 100)
        score = _clamp(score)
        evidence = (
            f"{ev.line_count} non-empty lines, {ev.function_count} function signal(s), "
            f"{ev.todo_count} TODO/FIXME marker(s)."
        )
        issue = "Unresolved TODO/FIXME markers reduce maintainability." if ev.todo_count else None
        suggestion = "Resolve leftover TODO/FIXME markers and organise the solution into clear functions." if ev.todo_count else None
    elif any(key in criterion for key in ("document", "explain", "communicat", "report", "readme")):
        score = 44 + min(30, ev.notes_len / 8)
        score += 16 if ev.has_readme else 0
        score += 10 if ev.has_doc else 0
        score = _clamp(score)
        evidence = (
            f"README signal: {'yes' if ev.has_readme else 'no'}; "
            f"submission notes: {ev.notes_len} characters."
        )
        issue = None if (ev.has_readme or ev.notes_len >= 120) else "Explanation or setup documentation is thin."
        suggestion = None if (ev.has_readme or ev.notes_len >= 120) else "Add a short README covering setup, usage and design decisions."
    else:
        score = 52 + 26 * delivery_ratio
        score += 12 if combined_len >= 300 else 0
        score = _clamp(score)
        evidence = f"General rubric review using {combined_len} characters of submission evidence."
        issue = None if score >= 65 else "Limited evidence for this criterion."
        suggestion = None if score >= 65 else "Add concrete evidence that addresses this criterion."

    if not ev.has_file and not ev.repo_valid and ev.notes_len < 40:
        score = min(score, 35)
        issue = issue or "No substantive submission evidence was provided."
        suggestion = suggestion or "Upload a deliverable file or add a repository link."

    return {
        "score": round(score, 1),
        "evidence": evidence,
        "issue": issue,
        "suggestion": suggestion,
    }


def _heuristic_review(task: Task, submission: Submission, ev: Evidence) -> dict:
    rubric = normalize_weights(task.rubric)
    deliverables = list(task.deliverables or [])
    if deliverables:
        satisfied = sum(1 for item in deliverables if ev.deliverable_status.get(item))
        delivery_ratio = satisfied / len(deliverables)
    else:
        delivery_ratio = 1.0 if (ev.has_file or ev.repo_valid or ev.notes_len >= 40) else 0.0

    combined = "\n".join(part for part in [ev.text, ev.notes] if part)
    criteria_ratio, missed_criteria = _criteria_coverage(task.acceptance_criteria or [], combined)

    confidence = 0.32
    confidence += 0.16 if ev.has_file else 0
    confidence += 0.14 if ev.repo_valid else 0
    confidence += 0.10 if ev.notes_len >= 100 else 0
    confidence += 0.10 if ev.has_tests else 0
    confidence += 0.06 if ev.has_readme else 0
    confidence += 0.06 if ev.has_code else 0
    confidence += 0.06 if delivery_ratio == 1 else 0
    if not ev.has_file and not ev.repo_valid:
        confidence = min(confidence, 0.24)
    confidence = round(min(0.95, confidence), 2)

    scores = []
    weighted_total = 0.0
    for item in rubric:
        result = _score_criterion(item["name"], ev, delivery_ratio, criteria_ratio)
        weighted_total += result["score"] * item["weight"] / 100
        scores.append(
            {
                "criterion": item["name"],
                "weight": item["weight"],
                "description": item["description"],
                "score": result["score"],
                "evidence": result["evidence"],
                "issue": result["issue"],
                "suggestion": result["suggestion"],
                "confidence": confidence,
            }
        )

    total = round(weighted_total, 1)
    mandatory_ok = delivery_ratio >= 0.999
    threshold = float(task.pass_threshold or settings.pass_threshold)

    if not mandatory_ok:
        outcome = "revision_required"
    elif confidence < settings.confidence_threshold:
        outcome = "human_review"
    elif abs(total - threshold) <= settings.borderline_margin:
        outcome = "human_review"
    elif total >= threshold:
        outcome = "approved"
    else:
        outcome = "revision_required"

    missing_names = [k for k, ok in ev.deliverable_status.items() if not ok]
    test_results = [
        {
            "name": "Required deliverables",
            "passed": mandatory_ok,
            "detail": (
                "All required deliverables were detected."
                if mandatory_ok
                else "Missing: " + ", ".join(missing_names[:5])
            ),
        },
        {
            "name": "Submission format",
            "passed": bool(ev.has_file or ev.repo_valid),
            "detail": (
                f"File: {ev.file_name}" if ev.has_file else
                ("Repository link provided" if ev.repo_valid else "No file or valid repository link")
            ),
        },
        {
            "name": "Repository link validity",
            "passed": ev.repo_valid if ev.repo_url else True,
            "detail": (
                "Valid repository URL." if ev.repo_valid
                else ("Repository URL is not valid." if ev.repo_url else "Not required.")
            ),
        },
        {
            "name": "Automated test evidence",
            "passed": ev.has_tests,
            "detail": (
                f"{ev.test_count} test signal(s) found."
                if ev.has_tests
                else "No automated tests detected; reviewer verification recommended."
            ),
        },
        {
            "name": "Static code review",
            "passed": (
                not bool(_python_static_check(ev.text)) if ev.extension == ".py" else True
            ),
            "detail": (
                "Python syntax parsed successfully."
                if ev.extension == ".py" and not _python_static_check(ev.text)
                else (
                    _python_static_check(ev.text)
                    if ev.extension == ".py"
                    else "Static parser not applicable to this file type."
                )
            ),
        },
        {
            "name": "Rubric threshold",
            "passed": total >= threshold,
            "detail": f"Weighted score {total} against threshold {threshold}.",
        },
    ]

    if outcome == "approved":
        summary = (
            f"All required deliverables were detected and the weighted rubric score is {total}/100. "
            "The evidence is strong enough for approval."
        )
    elif outcome == "revision_required":
        reasons = []
        if missing_names:
            reasons.append("missing deliverables: " + ", ".join(missing_names[:4]))
        if total < threshold:
            reasons.append(f"score {total} is below the {threshold} threshold")
        if not ev.has_tests and ev.has_code:
            reasons.append("no automated test evidence")
        summary = "Revision required because " + "; ".join(reasons) + "."
    else:
        summary = (
            f"The weighted score is {total}/100 with confidence {confidence:.2f}. "
            "The result is too close to the threshold or not confident enough, so a human reviewer must decide."
        )
        if missed_criteria:
            summary += " Weak evidence for: " + "; ".join(missed_criteria[:3]) + "."

    return {
        "scores": scores,
        "test_results": test_results,
        "total": total,
        "confidence": confidence,
        "outcome": outcome,
        "summary": summary,
        "engine": "heuristic",
        "delivery_ratio": delivery_ratio,
        "mandatory_ok": mandatory_ok,
    }


def _strip_code_fence(content: str) -> str:
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
    return content


def _llm_review(task: Task, submission: Submission, ev: Evidence, rubric: list[dict]) -> dict | None:
    if settings.ai_provider != "openai" or not settings.openai_api_key:
        return None

    evidence_text = "\n".join(part for part in [ev.text, ev.notes] if part)[:12_000]
    prompt = {
        "task": {
            "title": task.title,
            "description": task.description,
            "deliverables": task.deliverables,
            "acceptance_criteria": task.acceptance_criteria,
            "test_cases": task.test_cases,
        },
        "rubric": rubric,
        "submission": {
            "file_name": submission.file_name,
            "repo_url": submission.repo_url,
            "notes": ev.notes[:3000],
            "extracted_text": evidence_text,
            "detected_signals": {
                "has_code": ev.has_code,
                "has_tests": ev.has_tests,
                "test_count": ev.test_count,
                "has_readme": ev.has_readme,
                "line_count": ev.line_count,
                "todo_count": ev.todo_count,
            },
        },
    }
    system = (
        "You are a strict internship evaluator. Use only the supplied evidence. "
        "Return JSON with keys: scores (array in the exact rubric order, each item has "
        "criterion, score from 0-100, evidence, issue, suggestion, confidence from 0-1), "
        "summary, confidence. Do not invent tests, files or features. If evidence is "
        "insufficient for a criterion, score conservatively and explain why."
    )
    payload = {
        "model": settings.openai_model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
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
                json=payload,
            )
            if response.status_code == 400:
                payload.pop("response_format", None)
                response = client.post(
                    f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        data = json.loads(_strip_code_fence(content))
        scores = data.get("scores")
        if not isinstance(scores, list) or not scores:
            return None
        return {
            "scores": scores,
            "summary": str(data.get("summary") or ""),
            "confidence": float(data.get("confidence") or 0.6),
        }
    except (httpx.HTTPError, KeyError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _merge_llm_review(base: dict, llm: dict, threshold: float) -> dict:
    llm_scores = llm.get("scores") or []
    by_name = {
        str(item.get("criterion", "")).strip().lower(): item
        for item in llm_scores
        if isinstance(item, dict)
    }
    merged = []
    total = 0.0
    llm_confidences = []
    for index, item in enumerate(base["scores"]):
        candidate = by_name.get(item["criterion"].strip().lower())
        if candidate is None and index < len(llm_scores) and isinstance(llm_scores[index], dict):
            candidate = llm_scores[index]
        if candidate:
            try:
                score = _clamp(float(candidate.get("score", item["score"])))
            except (TypeError, ValueError):
                score = item["score"]
            try:
                confidence = max(0.0, min(1.0, float(candidate.get("confidence", base["confidence"]))))
            except (TypeError, ValueError):
                confidence = base["confidence"]
            llm_confidences.append(confidence)
            item = {
                **item,
                "score": round(score, 1),
                "evidence": str(candidate.get("evidence") or item["evidence"])[:1200],
                "issue": candidate.get("issue") or item["issue"],
                "suggestion": candidate.get("suggestion") or item["suggestion"],
                "confidence": round(confidence, 2),
            }
        merged.append(item)
        total += item["score"] * item["weight"] / 100

    base["scores"] = merged
    base["total"] = round(total, 1)
    base["engine"] = "openai+heuristic"
    if llm.get("summary"):
        base["summary"] = str(llm["summary"])[:2000]

    llm_conf = sum(llm_confidences) / len(llm_confidences) if llm_confidences else 0.6
    try:
        reported = float(llm.get("confidence") or llm_conf)
    except (TypeError, ValueError):
        reported = llm_conf
    base["confidence"] = round(min(0.95, max(0.2, 0.45 * base["confidence"] + 0.55 * min(reported, llm_conf))), 2)

    mandatory_ok = base["mandatory_ok"]
    if not mandatory_ok:
        base["outcome"] = "revision_required"
    elif base["confidence"] < settings.confidence_threshold:
        base["outcome"] = "human_review"
    elif abs(base["total"] - threshold) <= settings.borderline_margin:
        base["outcome"] = "human_review"
    elif base["total"] >= threshold:
        base["outcome"] = "approved"
    else:
        base["outcome"] = "revision_required"
    return base


def evaluate_submission(submission: Submission, assignment: Assignment) -> dict:
    task: Task = assignment.task
    ev = collect_evidence(submission, list(task.deliverables or []))
    result = _heuristic_review(task, submission, ev)

    rubric = normalize_weights(task.rubric)
    llm = _llm_review(task, submission, ev, rubric)
    threshold = float(task.pass_threshold or settings.pass_threshold)
    if llm:
        result = _merge_llm_review(result, llm, threshold)

    result["summary"] = result["summary"] + f" Pass threshold: {threshold}."
    return result

