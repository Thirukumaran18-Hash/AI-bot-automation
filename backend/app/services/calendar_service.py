import re
import secrets
import uuid
from datetime import datetime

from ..config import settings
from ..models import Meeting


def create_provider_event(meeting: Meeting) -> tuple[str, str]:
    token = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:12]
    room = f"internflow-{token}"
    join_url = f"{settings.meeting_base_url.rstrip('/')}/{room}"
    provider_event_id = f"local-{uuid.uuid4().hex[:14]}"
    return provider_event_id, join_url


def _escape(value: str) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def _fold(line: str) -> str:
    if len(line) <= 73:
        return line
    chunks = [line[:73]]
    remainder = line[73:]
    while remainder:
        chunks.append(" " + remainder[:72])
        remainder = remainder[72:]
    return "\r\n".join(chunks)


def _utc_stamp(value: datetime) -> str:
    return value.strftime("%Y%m%dT%H%M%SZ")


def build_ics(meeting: Meeting, organizer_name: str = "InternFlow AI") -> str:
    attendee_lines = []
    assignment = meeting.assignment
    if assignment:
        attendee_lines.append(
            f"ATTENDEE;CN={_escape(assignment.intern.user.name)};ROLE=REQ-PARTICIPANT:mailto:{assignment.intern.user.email}"
        )
        if assignment.intern.mentor:
            attendee_lines.append(
                f"ATTENDEE;CN={_escape(assignment.intern.mentor.name)};ROLE=REQ-PARTICIPANT:mailto:{assignment.intern.mentor.email}"
            )

    description = meeting.agenda or "Internship review meeting"
    if meeting.join_url:
        description += f"\\n\\nJoin link: {meeting.join_url}"

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//InternFlow AI//Meetings//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{_escape(meeting.provider_event_id or f'internflow-{meeting.id}')}@internflow.ai",
        f"DTSTAMP:{_utc_stamp(datetime.utcnow())}",
        f"DTSTART:{_utc_stamp(meeting.start_time)}",
        f"DTEND:{_utc_stamp(meeting.end_time)}",
        f"SUMMARY:{_escape(meeting.title)}",
        f"DESCRIPTION:{_escape(description)}",
        f"LOCATION:{_escape(meeting.join_url)}",
        f"ORGANIZER;CN={_escape(organizer_name)}:mailto:no-reply@internflow.local",
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        *attendee_lines,
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


def safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return value[:180] or "attachment"
