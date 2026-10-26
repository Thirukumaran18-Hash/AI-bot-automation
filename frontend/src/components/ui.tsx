import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { initials, statusTone, titleCase } from "../utils";

const STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted",
  evaluating: "Evaluating",
  human_review: "Human review",
  revision_required: "Revision required",
  resubmitted: "Resubmitted",
  approved: "Approved",
  review_scheduled: "Review scheduled",
  completed: "Completed",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  draft: "Draft",
  sent: "Sent",
  logged: "Logged",
  failed: "Failed",
  active: "Active",
  inactive: "Inactive",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || titleCase(status);
}

export function StatusBadge({ status, dot = true }: { status: string; dot?: boolean }) {
  return (
    <span className={`badge badge-${statusTone(status)}`}>
      {dot && <span className="badge-dot" />}
      {statusLabel(status)}
    </span>
  );
}

export function Avatar({
  name,
  size = 38,
  tone,
}: {
  name: string;
  size?: number;
  tone?: string;
}) {
  const palettes = ["#eef2ff:#4338ca", "#ecfdf5:#047857", "#fef3c7:#b45309", "#fce7f3:#be185d", "#e0f2fe:#0369a1"];
  const index = name.split("").reduce((total, char) => total + char.charCodeAt(0), 0) % palettes.length;
  const [background, color] = tone ? [tone, "#312e81"] : palettes[index].split(":");
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background, color, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function ScoreRing({
  score,
  size = 74,
  label,
}: {
  score: number | null | undefined;
  size?: number;
  label?: string;
}) {
  if (score === null || score === undefined) {
    return (
      <div className="score-ring score-ring-empty" style={{ width: size, height: size }}>
        <span>—</span>
      </div>
    );
  }
  const tone = score >= 80 ? "#059669" : score >= 70 ? "#4f46e5" : score >= 60 ? "#d97706" : "#dc2626";
  const style: CSSProperties = {
    width: size,
    height: size,
    background: `conic-gradient(${tone} ${Math.max(0, Math.min(100, score)) * 3.6}deg, #eef2f7 0deg)`,
  };
  return (
    <div className="score-ring" style={style}>
      <div className="score-ring-inner">
        <strong>{Math.round(score)}</strong>
        <span>{label || "score"}</span>
      </div>
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "indigo",
  height = 8,
}: {
  value: number;
  tone?: string;
  height?: number;
}) {
  return (
    <div className="progress" style={{ height }}>
      <div
        className={`progress-fill progress-${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon = "layers",
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <strong>{title}</strong>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Callout({
  tone = "info",
  icon = "shield",
  title,
  children,
}: {
  tone?: "info" | "warn" | "success" | "danger";
  icon?: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`callout callout-${tone}`}>
      <span className="callout-icon">
        <Icon name={icon} size={17} />
      </span>
      <div>
        <strong>{title}</strong>
        {children && <div className="callout-body">{children}</div>}
      </div>
    </div>
  );
}
