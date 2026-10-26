export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let phrase: string;
  if (minutes < 1) phrase = "just now";
  else if (minutes < 60) phrase = `${minutes}m`;
  else if (hours < 24) phrase = `${hours}h`;
  else if (days < 30) phrase = `${days}d`;
  else phrase = `${Math.round(days / 30)}mo`;
  if (phrase === "just now") return phrase;
  return diff >= 0 ? `in ${phrase}` : `${phrase} ago`;
}

export function daysUntil(value: string | null | undefined): number | null {
  const date = parseDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

export function dueLabel(value: string | null | undefined): string {
  const days = daysUntil(value);
  if (days === null) return "No due date";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function markdownExcerpt(value: string, maxLength: number): string {
  const text = value
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s/.test(line.trim()))
    .join(" ")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const boundary = clipped.lastIndexOf(" ");
  const shortened = boundary > maxLength * 0.6 ? clipped.slice(0, boundary) : clipped;
  return `${shortened.trimEnd()}…`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatNumber(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined) return "—";
  return `${value}${suffix}`;
}

export function toDateTimeLocal(value: Date): string {
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
}

export function defaultMeetingTime(): string {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  date.setHours(10, 0, 0, 0);
  return toDateTimeLocal(date);
}

export function statusTone(status: string): string {
  switch (status) {
    case "approved":
    case "completed":
    case "sent":
    case "active":
      return "green";
    case "assigned":
    case "scheduled":
      return "blue";
    case "in_progress":
      return "indigo";
    case "submitted":
    case "evaluating":
    case "logged":
      return "amber";
    case "revision_required":
    case "failed":
    case "cancelled":
      return "red";
    case "human_review":
      return "purple";
    case "review_scheduled":
    case "resubmitted":
      return "cyan";
    default:
      return "slate";
  }
}
