import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon, type IconName } from "../components/Icon";
import {
  Avatar,
  EmptyState,
  PageHeader,
  ProgressBar,
  ScoreRing,
  Spinner,
  StatusBadge,
  statusLabel,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type { DashboardData, WorkflowEvent } from "../types";
import {
  dueLabel,
  formatNumber,
  formatTime,
  relativeTime,
  statusTone,
  titleCase,
} from "../utils";

const ROLE_GREETING: Record<string, { title: string; copy: string }> = {
  admin: {
    title: "Programme control room",
    copy: "See how every batch, task and review is moving — and step in where it matters.",
  },
  mentor: {
    title: "Your mentoring cockpit",
    copy: "Review borderline submissions, keep your mentees unblocked and stay ahead of deadlines.",
  },
  intern: {
    title: "Your internship, at a glance",
    copy: "Track assigned work, submissions, feedback and the next review conversation.",
  },
};

function StatCard({
  icon,
  tone,
  label,
  value,
  hint,
  to,
}: {
  icon: IconName;
  tone: string;
  label: string;
  value: string | number;
  hint: string;
  to?: string;
}) {
  const body = (
    <>
      <span className={`stat-icon stat-${tone}`}>
        <Icon name={icon} size={20} />
      </span>
      <div className="stat-content">
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{hint}</em>
      </div>
      {to && <Icon name="chevron-right" size={16} className="stat-arrow" />}
    </>
  );
  if (to) {
    return (
      <Link to={to} className="stat-card stat-card-link">
        {body}
      </Link>
    );
  }
  return <div className="stat-card">{body}</div>;
}

function eventLink(event: WorkflowEvent): string | null {
  if (event.entity_type === "assignment") return `/assignments/${event.entity_id}`;
  if (event.entity_type === "meeting") return "/meetings";
  if (event.entity_type === "intern") return "/interns";
  return "/activity";
}

function eventIcon(event: WorkflowEvent): IconName {
  if (event.entity_type === "assignment") return "layers";
  if (event.entity_type === "submission") return "upload";
  if (event.entity_type === "meeting") return "calendar";
  if (event.entity_type === "intern") return "users";
  if (event.entity_type === "task") return "clipboard";
  return "activity";
}

export function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const payload = await api.get<DashboardData>("/api/dashboard");
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="page-stack">
        <div className="skeleton skeleton-header" />
        <div className="stats-grid">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div className="skeleton skeleton-card" key={item} />
          ))}
        </div>
        <div className="skeleton skeleton-panel" />
      </div>
    );
  }

  if (!data || !user) {
    return (
      <EmptyState
        icon="alert"
        title="Dashboard unavailable"
        message={error || "The API did not return any data."}
        action={
          <button className="btn btn-primary" onClick={() => load()}>
            Retry
          </button>
        }
      />
    );
  }

  const greeting = ROLE_GREETING[user.role] || ROLE_GREETING.admin;
  const cards = data.cards;
  const isIntern = user.role === "intern";
  const maxStatus = Math.max(1, ...data.status_breakdown.map((item) => item.count));
  const maxBucket = Math.max(1, ...data.score_distribution.map((item) => item.count));
  const maxDomain = Math.max(1, ...data.domain_breakdown.map((item) => item.count));

  const copySummary = () => {
    toast.info("Dashboard link copied to clipboard.");
    navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
  };

  return (
    <div className="page-stack dashboard">
      <PageHeader
        eyebrow={`${titleCase(user.role)} workspace`}
        title={greeting.title}
        description={greeting.copy}
        actions={
          <>
            <button className="btn btn-ghost" onClick={copySummary}>
              <Icon name="link" size={16} />
              Share
            </button>
            <button className="btn btn-ghost" onClick={() => load(true)} disabled={refreshing}>
              <Icon name="refresh" size={16} className={refreshing ? "spin" : ""} />
              Refresh
            </button>
            {!isIntern && (
              <Link to={user.role === "admin" ? "/interns" : "/reviews"} className="btn btn-primary">
                <Icon name={user.role === "admin" ? "plus" : "check-circle"} size={16} />
                {user.role === "admin" ? "Onboard interns" : "Open review queue"}
              </Link>
            )}
            {isIntern && (
              <Link to="/assignments" className="btn btn-primary">
                <Icon name="target" size={16} />
                Open my tasks
              </Link>
            )}
          </>
        }
      />

      <div className="greeting-strip">
        <div className="greeting-avatar">
          <Avatar name={user.name} size={46} />
        </div>
        <div className="greeting-copy">
          <strong>Welcome back, {user.name.split(" ")[0]}</strong>
          <span>{data.deadline} · {data.role === "intern" ? "Keep your next deadline visible." : "Here is what needs attention today."}</span>
        </div>
        <div className="greeting-tags">
          <span className="badge badge-indigo"><span className="badge-dot" />{data.ai_stats.evaluations} AI evaluations</span>
          <span className="badge badge-slate"><span className="badge-dot" />{data.email_stats.mode === "smtp" ? "SMTP live" : "Email log mode"}</span>
        </div>
      </div>

      <div className="stats-grid">
        {isIntern ? (
          <>
            <StatCard icon="target" tone="indigo" label="My assignments" value={cards.assignments} hint="across all tasks" to="/assignments" />
            <StatCard icon="check-circle" tone="green" label="Completed" value={cards.completed} hint="approved and closed" />
            <StatCard icon="star" tone="amber" label="Average score" value={formatNumber(cards.avg_score)} hint="weighted rubric" />
            <StatCard icon="alert" tone="red" label="Overdue" value={cards.overdue} hint="need attention" to="/assignments?overdue=1" />
            <StatCard icon="calendar" tone="cyan" label="Upcoming meetings" value={cards.upcoming_meetings} hint="next reviews" to="/meetings" />
            <StatCard icon="mail" tone="purple" label="Notifications" value={cards.emails} hint="emails delivered to you" to="/activity" />
          </>
        ) : (
          <>
            <StatCard icon="users" tone="indigo" label="Active interns" value={cards.active_interns} hint={`${cards.interns} in the programme`} to="/interns" />
            <StatCard icon="layers" tone="blue" label="Assignments" value={cards.assignments} hint={`${cards.submissions} submissions`} to="/assignments" />
            <StatCard icon="check-circle" tone="purple" label="Pending reviews" value={cards.pending_reviews} hint="waiting for a human" to="/reviews" />
            <StatCard icon="alert" tone="red" label="Overdue tasks" value={cards.overdue} hint="interns need a nudge" to="/assignments?overdue=1" />
            <StatCard icon="star" tone="amber" label="Average score" value={formatNumber(cards.avg_score)} hint="latest evaluations" />
            <StatCard icon="award" tone="green" label="Approval rate" value={`${cards.approval_rate}%`} hint="decided submissions" />
          </>
        )}
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Workflow pipeline</h2>
                <p>Every assignment by its current lifecycle stage.</p>
              </div>
              <Link to="/assignments" className="link-muted">View all <Icon name="arrow-right" size={14} /></Link>
            </div>
            {data.status_breakdown.length === 0 ? (
              <EmptyState title="No assignments yet" message="Create a task and assign it to an intern to start the pipeline." />
            ) : (
              <div className="status-bars">
                {data.status_breakdown.map((item) => (
                  <button
                    key={item.status}
                    className="status-bar-row"
                    onClick={() => navigate(`/assignments?status=${item.status}`)}
                    type="button"
                  >
                    <span className={`status-dot tone-${statusTone(item.status)}`} />
                    <span className="status-bar-label">{statusLabel(item.status)}</span>
                    <span className="status-bar-track">
                      <span
                        className={`status-bar-fill tone-bg-${statusTone(item.status)}`}
                        style={{ width: `${(item.count / maxStatus) * 100}%` }}
                      />
                    </span>
                    <span className="status-bar-count">{item.count}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>{isIntern ? "My open work" : "Needs your attention"}</h2>
                <p>{isIntern ? "The next tasks and deadlines in your queue." : "Borderline evaluations and overdue assignments."}</p>
              </div>
              <Link to={isIntern ? "/assignments" : "/reviews"} className="link-muted">
                {isIntern ? "All tasks" : "Review queue"} <Icon name="arrow-right" size={14} />
              </Link>
            </div>

            {isIntern ? (
              data.my_tasks.length === 0 ? (
                <EmptyState icon="check-circle" title="You are all caught up" message="No open tasks right now. New assignments will appear here." />
              ) : (
                <div className="task-mini-list">
                  {data.my_tasks.map((task) => (
                    <Link to={`/assignments/${task.id}`} className="task-mini" key={task.id}>
                      <span className="task-mini-icon"><Icon name="clipboard" size={17} /></span>
                      <div className="task-mini-copy">
                        <strong>{task.task_title}</strong>
                        <span>{task.task_domain} · {dueLabel(task.due_date)}</span>
                      </div>
                      <StatusBadge status={task.status} />
                      <Icon name="chevron-right" size={16} />
                    </Link>
                  ))}
                </div>
              )
            ) : data.pending_reviews.length === 0 ? (
              <EmptyState icon="shield" title="Review queue is clear" message="AI evaluations that need a human decision will land here." />
            ) : (
              <div className="review-mini-list">
                {data.pending_reviews.map((assignment) => (
                  <Link to={`/assignments/${assignment.id}`} className="review-mini" key={assignment.id}>
                    <Avatar name={assignment.intern_name} size={40} />
                    <div className="review-mini-copy">
                      <strong>{assignment.intern_name}</strong>
                      <span>{assignment.task_title}</span>
                    </div>
                    <div className="review-mini-metrics">
                      <span><em>{assignment.latest_evaluation?.total_score ?? "—"}</em> score</span>
                      <span><em>{assignment.latest_evaluation ? Math.round(assignment.latest_evaluation.confidence * 100) : "—"}%</em> confidence</span>
                    </div>
                    <span className="badge badge-purple"><span className="badge-dot" />Review</span>
                  </Link>
                ))}
              </div>
            )}

            {!isIntern && data.mentor_workload.length > 0 && (
              <div className="workload-block">
                <div className="block-label">Mentor workload</div>
                {data.mentor_workload.map((mentor) => (
                  <div className="workload-row" key={mentor.mentor}>
                    <span className="workload-name">{mentor.mentor}</span>
                    <div className="workload-bar">
                      <ProgressBar value={(mentor.open_assignments / Math.max(1, ...data.mentor_workload.map((m) => m.open_assignments))) * 100} />
                    </div>
                    <span className="workload-meta">{mentor.open_assignments} open · {mentor.pending_reviews} review</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Recent activity</h2>
                <p>Workflow events recorded by the automation engine.</p>
              </div>
              <Link to="/activity" className="link-muted">Audit log <Icon name="arrow-right" size={14} /></Link>
            </div>
            {data.recent_events.length === 0 ? (
              <EmptyState title="No activity yet" message="Workflow events will appear here as tasks move forward." />
            ) : (
              <div className="timeline">
                {data.recent_events.map((event) => {
                  const target = eventLink(event);
                  const content = (
                    <>
                      <span className={`timeline-icon tone-soft-${statusTone(event.new_status || "assigned")}`}>
                        <Icon name={eventIcon(event)} size={15} />
                      </span>
                      <div className="timeline-copy">
                        <strong>{titleCase(event.action.replace(/\./g, " "))}</strong>
                        <span>
                          {event.entity_type} #{event.entity_id} · {event.actor_name}
                          {event.new_status ? ` → ${statusLabel(event.new_status)}` : ""}
                        </span>
                      </div>
                      <span className="timeline-time">{relativeTime(event.created_at)}</span>
                    </>
                  );
                  return target ? (
                    <Link to={target} className="timeline-item" key={event.id}>{content}</Link>
                  ) : (
                    <div className="timeline-item" key={event.id}>{content}</div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="dashboard-side">
          <section className="card ai-card">
            <div className="card-head">
              <div>
                <h2>Evaluation quality</h2>
                <p>Rubric scores and reviewer confidence.</p>
              </div>
              <span className="ai-spark"><Icon name="sparkles" size={16} /></span>
            </div>
            <div className="ai-score-block">
              <ScoreRing score={cards.avg_score} size={92} label="avg score" />
              <div className="ai-score-meta">
                <div><span>Avg confidence</span><strong>{cards.avg_confidence !== null ? `${Math.round(cards.avg_confidence * 100)}%` : "—"}</strong></div>
                <div><span>Human review rate</span><strong>{data.ai_stats.human_review_rate}%</strong></div>
                <div><span>First result</span><strong>{cards.avg_evaluation_minutes !== null ? `${cards.avg_evaluation_minutes}m` : "—"}</strong></div>
              </div>
            </div>
            <div className="ai-footer">
              <span className="badge badge-slate"><Icon name="cpu" size={12} />{Object.keys(data.ai_stats.engines).join(", ") || "heuristic"}</span>
              <span className="ai-evaluations">{data.ai_stats.evaluations} evaluations</span>
            </div>
            <div className="ai-outcomes">
              {Object.entries(data.ai_stats.outcomes).map(([outcome, count]) => (
                <div key={outcome} className="ai-outcome-row">
                  <StatusBadge status={outcome} />
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Upcoming meetings</h2><p>Review conversations and join links.</p></div>
              <Link to="/meetings" className="link-muted">All <Icon name="arrow-right" size={14} /></Link>
            </div>
            {data.upcoming_meetings.length === 0 ? (
              <EmptyState icon="calendar" title="No meetings scheduled" message="Schedule a review from an assignment once a submission is ready." />
            ) : (
              <div className="meeting-mini-list">
                {data.upcoming_meetings.map((meeting) => {
                  const date = new Date(meeting.start_time);
                  return (
                    <div className="meeting-mini" key={meeting.id}>
                      <div className="date-tile">
                        <strong>{date.getDate()}</strong>
                        <span>{date.toLocaleString(undefined, { month: "short" })}</span>
                      </div>
                      <div className="meeting-mini-copy">
                        <strong>{meeting.title}</strong>
                        <span>{meeting.intern_name || "Team"} · {formatTime(meeting.start_time)}</span>
                      </div>
                      <a className="icon-button" href={meeting.join_url} target="_blank" rel="noreferrer" aria-label="Open meeting link">
                        <Icon name="external" size={16} />
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Domain mix</h2><p>Where the cohort is focused.</p></div>
              <span className="badge badge-slate">{cards.active_interns} interns</span>
            </div>
            {data.domain_breakdown.length === 0 ? (
              <EmptyState title="No interns yet" />
            ) : (
              <div className="domain-list">
                {data.domain_breakdown.map((item) => (
                  <div className="domain-row" key={item.domain}>
                    <span className="domain-name">{item.domain}</span>
                    <div className="domain-bar"><ProgressBar value={(item.count / maxDomain) * 100} tone="indigo" height={7} /></div>
                    <span className="domain-count">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Score distribution</h2><p>Latest evaluation per assignment.</p></div>
            </div>
            {data.score_distribution.every((item) => item.count === 0) ? (
              <EmptyState title="No scores yet" message="Submissions will populate this chart." />
            ) : (
              <div className="bar-chart">
                {data.score_distribution.map((bucket) => (
                  <div className="bar-col" key={bucket.bucket}>
                    <span className="bar-count">{bucket.count}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ height: `${Math.max(4, (bucket.count / maxBucket) * 100)}%` }}
                      />
                    </div>
                    <span className="bar-label">{bucket.bucket}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {refreshing && (
        <div className="refresh-indicator">
          <Spinner label="Refreshing dashboard" />
        </div>
      )}
    </div>
  );
}
