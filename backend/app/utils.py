from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import settings


def company_timezone() -> ZoneInfo | timezone:
    try:
        return ZoneInfo(settings.company_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def human_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(company_timezone()).strftime("%d %b %Y, %I:%M %p %Z")


def utc_aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
