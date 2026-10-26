import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import {
  Avatar,
  Callout,
  EmptyState,
  Modal,
  ScoreRing,
  StatusBadge,
  statusLabel,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type {
  AssignmentRecord,
  EvaluationRecord,
  MeetingRecord,
  SubmissionRecord,
  WorkflowEvent,
} from "../types";
import {
  defaultMeetingTime,
  dueLabel,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatTime,
  relativeTime,
  titleCase,
  statusTone,
} from "../utils";

const SUBMITTABLE = new Set(["assigned", "in_progress", "revision_required", "resubmitted"]);

function FeedbackRow({ item }: { item: EvaluationRecord["scores"][number] }) {
  const tone = item.score >= 80 ? "green" : item.score >= 70 ? "indigo" : item.score >= 60 ? "amber" : "red";
  return (
    <div className="feedback-row">
      <div className="feedback-head">
        <div>
          <strong>{item.criterion}</strong>
          <span>{Math.round(item.weight)}% weight</span>
        </div>
        <span className={`feedback-score tone-text-${tone}`}>{Math.round(item.score)}<em>/100</em></span>
      </div>
      <div className="feedback-bar">
        <span className={`tone-bg-${tone}`} style={{ width: `${Math.min(100, item.score)}%` }} />
      </div>
      {item.evidence && <p className="feedback-evidence">{item.evidence}</p>}
      <div className="feedback-notes">
        {item.issue && <span className="feedback-issue"><Icon name="alert" size={13} />{item.issue}</span>}
        {item.suggestion && <span className="feedback-suggestion"><Icon name="arrow-right" size={13} />{item.suggestion}</span>}
      </div>
    </div>
  );
}

function SubmissionForm({
  assignment,
  onSubmitted,
}: {
  assignment: AssignmentRecord;
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [autoEvaluate, setAutoEvaluate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file && !repoUrl.trim() && !notes.trim()) {
      setError("Attach a file, add a repository URL, or write submission notes.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      if (file) formData.append("file", file);
      if (repoUrl.trim()) formData.append("repo_url", repoUrl.trim());
      if (notes.trim()) formData.append("notes", notes.trim());
      formData.append("auto_evaluate", autoEvaluate ? "true" : "false");
      const result = await api.upload<{
        evaluation: EvaluationRecord | null;
        evaluation_error: string | null;
        submission: SubmissionRecord;
      }>(`/api/submissions/assignments/${assignment.id}`, formData);
      if (result.evaluation_error) {
        toast.error(result.evaluation_error);
      } else if (result.evaluation) {
        const outcome = result.evaluation.final_outcome || result.evaluation.outcome;
        toast.success(
          `Submission v${result.submission.version} evaluated: ${statusLabel(outcome)} (${result.evaluation.total_score}/100).`,
        );
      } else {
        toast.success(`Submission v${result.submission.version} received.`);
      }
      setFile(null);
      setRepoUrl("");
      setNotes("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit your work.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="submission-form" onSubmit={submit}>
      <div className="submission-form-head">
        <div>
          <h3>Submit your work</h3>
          <p>Version {assignment.submission_count + 1} · previous submissions are kept in your history.</p>
        </div>
        <span className="badge badge-indigo"><Icon name="upload" size={12} />New version</span>
      </div>

      <label className="file-drop">
        <input
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <span className="file-drop-icon"><Icon name="upload" size={22} /></span>
        <strong>{file ? file.name : "Choose a deliverable file"}</strong>
        <span>{file ? formatFileSize(file.size) : "Source code, ZIP, PDF, report or notebook · max 10 MB"}</span>
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Repository URL <em>optional</em></span>
          <div className="input-with-icon">
            <Icon name="link" size={16} />
            <input
              type="url"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/your-name/project"
            />
          </div>
        </label>
      </div>

      <label className="field">
        <span>Submission notes / README summary</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          placeholder="Explain what you built, how to run it, test evidence and any limitations…"
        />
      </label>

      <div className="submission-options">
        <label className="checkbox-row">
          <input type="checkbox" checked={autoEvaluate} onChange={(event) => setAutoEvaluate(event.target.checked)} />
          <span>Evaluate immediately against the rubric</span>
        </label>
        <span className="muted small">AI scores are advisory; borderline results go to your mentor.</span>
      </div>

      {error && <div className="inline-error"><Icon name="alert" size={15} />{error}</div>}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? <span className="spinner spinner-light" /> : <Icon name="send" size={16} />}
        {submitting ? "Submitting and evaluating…" : "Submit for evaluation"}
      </button>
    </form>
  );
}

function EvaluationPanel({
  evaluation,
  canReview,
  busy,
  onDecision,
}: {
  evaluation: EvaluationRecord;
  canReview: boolean;
  busy: boolean;
  onDecision: (outcome: "approved" | "revision_required", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const outcome = evaluation.final_outcome || evaluation.outcome;
  return (
    <div className="evaluation-panel">
      <div className="evaluation-top">
        <ScoreRing score={evaluation.total_score} size={86} label="weighted" />
        <div className="evaluation-summary">
          <div className="evaluation-badges">
            <StatusBadge status={outcome} />
            <span className="badge badge-slate"><Icon name="cpu" size={12} />{evaluation.engine}</span>
            <span className="badge badge-slate">{Math.round(evaluation.confidence * 100)}% confidence</span>
          </div>
          <p>{evaluation.summary}</p>
          {evaluation.reviewer && (
            <span className="reviewed-by">
              <Icon name="user-check" size={14} />
              Final decision by {evaluation.reviewer.name}
              {evaluation.override_reason ? ` · ${evaluation.override_reason}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="test-results">
        {evaluation.test_results.map((test) => (
          <div className={`test-result ${test.passed ? "test-pass" : "test-fail"}`} key={test.name}>
            <span className="test-result-icon"><Icon name={test.passed ? "check" : "x"} size={13} /></span>
            <div>
              <strong>{test.name}</strong>
              <span>{test.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="feedback-list">
        {evaluation.scores.map((item) => <FeedbackRow key={item.criterion} item={item} />)}
      </div>

      {canReview && (
        <div className="decision-panel">
          <div className="decision-head">
            <div>
              <strong>Reviewer decision</strong>
              <span>Human review overrides the AI outcome and is recorded in the audit trail.</span>
            </div>
          </div>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="Add a rationale for the intern (recommended for revisions)…"
          />
          <div className="decision-actions">
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => onDecision("revision_required", reason)}
            >
              <Icon name="refresh" size={15} />
              Request revision
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => onDecision("approved", reason)}>
              <Icon name="check" size={15} />
              Approve outcome
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AssignmentDetail() {
  const { assignmentId: id } = useParams<{ assignmentId: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const [assignment, setAssignment] = useState<AssignmentRecord | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingAgenda, setMeetingAgenda] = useState("");
  const [meetingStart, setMeetingStart] = useState(defaultMeetingTime());
  const [meetingDuration, setMeetingDuration] = useState(30);
  const [meetingBusy, setMeetingBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [assignmentData, eventData] = await Promise.all([
        api.get<AssignmentRecord>(`/api/assignments/${id}`),
        api.get<WorkflowEvent[]>(`/api/activity/events?entity_type=assignment&entity_id=${id}&limit=30`),
      ]);
      setAssignment(assignmentData);
      setEvents(eventData);
      setMeetingTitle((current) => current || `Review: ${assignmentData.task_title}`);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this assignment.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const latestEvaluation = assignment?.latest_evaluation || null;
  const canManage = user?.role === "admin" || user?.role === "mentor";
  const canSubmit = user?.role === "intern" && assignment ? SUBMITTABLE.has(assignment.status) : false;

  const decide = async (outcome: "approved" | "revision_required", reason: string) => {
    if (!latestEvaluation) return;
    setDecisionBusy(true);
    try {
      await api.post(`/api/reviews/${latestEvaluation.id}/decision`, { outcome, reason: reason || undefined });
      toast.success(outcome === "approved" ? "Outcome approved and the intern was notified." : "Revision requested and the intern was notified.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record the decision.");
    } finally {
      setDecisionBusy(false);
    }
  };

  const reevaluate = async (submission: SubmissionRecord) => {
    try {
      await api.post(`/api/submissions/${submission.id}/evaluate`);
      toast.success("Evaluation re-run completed.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not re-run the evaluation.");
    }
  };

  const remind = async () => {
    if (!assignment) return;
    try {
      const result = await api.post<{ email_status: string; recipient: string }>(
        `/api/assignments/${assignment.id}/remind`,
      );
      if (result.email_status === "sent") {
        toast.success(`Reminder email sent to ${result.recipient}.`);
      } else if (result.email_status === "skipped") {
        toast.info("Email saved to Activity only. Add SMTP settings in backend/.env to send it for real.");
      } else {
        toast.error(`Reminder could not be delivered to ${result.recipient}. Check the SMTP settings.`);
      }
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the reminder.");
    }
  };

  const markComplete = async () => {
    if (!assignment) return;
    try {
      await api.post(`/api/assignments/${assignment.id}/status`, { status: "completed" });
      toast.success("Assignment marked as completed.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the assignment.");
    }
  };

  const createMeeting = async () => {
    if (!assignment) return;
    setMeetingBusy(true);
    try {
      await api.post("/api/meetings", {
        assignment_id: assignment.id,
        title: meetingTitle,
        agenda: meetingAgenda,
        start_time: new Date(meetingStart).toISOString(),
        duration_minutes: Number(meetingDuration),
      });
      toast.success("Meeting scheduled and invitations logged.");
      setMeetingOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not schedule the meeting.");
    } finally {
      setMeetingBusy(false);
    }
  };

  const cancelMeeting = async (meeting: MeetingRecord) => {
    if (!window.confirm(`Cancel "${meeting.title}"?`)) return;
    try {
      await api.post(`/api/meetings/${meeting.id}/cancel`);
      toast.success("Meeting cancelled.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not cancel the meeting.");
    }
  };

  const downloadIcs = (meeting: MeetingRecord) => {
    api.download(meeting.ics_url, `internflow-meeting-${meeting.id}.ics`).catch((err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not download the calendar file.");
      return;
    });
  };

  const downloadSubmission = (submission: SubmissionRecord) => {
    if (!submission.download_url) return;
    api.download(submission.download_url, submission.file_name || undefined).catch((err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not download the file.");
      return;
    });
  };

  const meetings = useMemo(() => {
    if (!assignment) return [];
    return [...(assignment.meetings || [])].sort(
      (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
    );
  }, [assignment]);

  if (loading) {
    return (
      <div className="page-stack">
        <div className="skeleton skeleton-header" />
        <div className="skeleton skeleton-panel" />
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <EmptyState
        icon="alert"
        title="Assignment unavailable"
        message={error || "This assignment could not be found."}
        action={<Link className="btn btn-primary" to="/assignments">Back to assignments</Link>}
      />
    );
  }

  return (
    <div className="page-stack">
      <div className="detail-breadcrumb">
        <Link to="/assignments" className="back-link"><Icon name="chevron-right" size={14} className="flip" />Assignments</Link>
        <span>/</span>
        <span>{assignment.task_title}</span>
      </div>

      <div className="detail-heading">
        <div>
          <div className="detail-badges">
            <StatusBadge status={assignment.status} />
            <span className="badge badge-slate">{assignment.task_domain}</span>
            <span className="badge badge-slate">{assignment.task_difficulty}</span>
            {assignment.overdue && <span className="badge badge-red"><Icon name="alert" size={12} />Overdue</span>}
          </div>
          <h1>{assignment.task_title}</h1>
          <p className="detail-subtitle">
            {assignment.intern_name} · {assignment.intern_domain} · assigned {formatDate(assignment.created_at)}
          </p>
        </div>
        <div className="detail-head-actions">
          {canManage && (
            <button className="btn btn-ghost" onClick={remind}>
              <Icon name="mail" size={16} /> Remind
            </button>
          )}
          {canManage && ["approved", "review_scheduled"].includes(assignment.status) && (
            <button className="btn btn-secondary" onClick={markComplete}>
              <Icon name="check-circle" size={16} /> Mark completed
            </button>
          )}
          {canSubmit && (
            <a className="btn btn-primary" href="#submission">
              <Icon name="upload" size={16} /> Submit work
            </a>
          )}
        </div>
      </div>

      <div className="detail-layout">
        <div className="detail-main">
          <section className="card">
            <div className="card-head">
              <div><h2>Task brief</h2><p>Objective, deliverables and acceptance criteria.</p></div>
              <span className="badge badge-slate">Pass ≥ {assignment.pass_threshold}</span>
            </div>
            <Markdown text={assignment.task_description} />
            <div className="detail-columns">
              <div className="detail-section">
                <h4>Deliverables</h4>
                <ul className="check-list">
                  {assignment.deliverables.map((item) => (
                    <li key={item}><Icon name="check" size={14} />{item}</li>
                  ))}
                </ul>
              </div>
              <div className="detail-section">
                <h4>Acceptance criteria</h4>
                <ul className="check-list">
                  {assignment.acceptance_criteria.map((item) => (
                    <li key={item}><Icon name="target" size={14} />{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="detail-section">
              <h4>Scoring rubric</h4>
              <div className="rubric-table">
                {assignment.rubric.map((item) => (
                  <div className="rubric-table-row" key={item.name}>
                    <span className="rubric-weight">{Math.round(item.weight)}%</span>
                    <div>
                      <strong>{item.name}</strong>
                      {item.description && <span>{item.description}</span>}
                    </div>
                    <div className="rubric-meter"><span style={{ width: `${item.weight}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="card" id="submission">
            <div className="card-head">
              <div><h2>Submissions</h2><p>Version history, files and evaluation status.</p></div>
              <span className="badge badge-slate">{assignment.submission_count} version{assignment.submission_count === 1 ? "" : "s"}</span>
            </div>

            {canSubmit && <SubmissionForm assignment={assignment} onSubmitted={load} />}
            {user?.role === "intern" && !canSubmit && (
              <Callout tone="info" icon="shield" title={`Submission is ${statusLabel(assignment.status).toLowerCase()}`}>
                {assignment.status === "human_review"
                  ? "Your submission is with a mentor for review. You can submit again after a decision."
                  : assignment.status === "approved" || assignment.status === "completed"
                    ? "This task is approved and closed."
                    : "Wait for the current evaluation or review to finish before submitting again."}
              </Callout>
            )}

            {assignment.submissions && assignment.submissions.length > 0 ? (
              <div className="submission-history">
                {assignment.submissions.map((submission) => {
                  const submissionEvaluation = submission.evaluations?.length
                    ? submission.evaluations[submission.evaluations.length - 1]
                    : null;
                  return (
                    <div className="submission-item" key={submission.id}>
                      <div className="submission-item-head">
                        <div className="submission-version">
                          <span className="version-pill">v{submission.version}</span>
                          <div>
                            <strong>{submission.file_name || (submission.repo_url ? "Repository submission" : "Notes submission")}</strong>
                            <span>{formatDateTime(submission.submitted_at)} · {formatFileSize(submission.file_size)}</span>
                          </div>
                        </div>
                        <div className="submission-actions">
                          {submissionEvaluation && (
                            <span className={`badge badge-${statusTone(submissionEvaluation.final_outcome || submissionEvaluation.outcome)}`}>
                              {submissionEvaluation.total_score}/100 · {statusLabel(submissionEvaluation.final_outcome || submissionEvaluation.outcome)}
                            </span>
                          )}
                          {submission.download_url && (
                            <button className="btn btn-ghost btn-sm" onClick={() => downloadSubmission(submission)}>
                              <Icon name="download" size={14} /> Download
                            </button>
                          )}
                          {submission.repo_url && (
                            <a className="btn btn-ghost btn-sm" href={submission.repo_url} target="_blank" rel="noreferrer">
                              <Icon name="link" size={14} /> Repository
                            </a>
                          )}
                          {canManage && !["approved", "completed"].includes(assignment.status) && (
                            <button className="btn btn-ghost btn-sm" onClick={() => reevaluate(submission)}>
                              <Icon name="refresh" size={14} /> Re-evaluate
                            </button>
                          )}
                        </div>
                      </div>
                      {submission.notes && <p className="submission-notes">{submission.notes}</p>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon="upload"
                title="No submissions yet"
                message={user?.role === "intern" ? "Submit your first version using the form above." : "The intern has not submitted this task yet."}
              />
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Evaluation & feedback</h2><p>Rubric-linked evidence, test results and reviewer decision.</p></div>
              {latestEvaluation && (
                <span className="badge badge-slate">
                  <Icon name="cpu" size={12} />
                  {latestEvaluation.engine}
                </span>
              )}
            </div>
            {latestEvaluation ? (
              <EvaluationPanel
                evaluation={latestEvaluation}
                canReview={Boolean(canManage && assignment.status !== "completed")}
                busy={decisionBusy}
                onDecision={decide}
              />
            ) : (
              <EmptyState
                icon="sparkles"
                title="No evaluation yet"
                message={
                  assignment.submission_count
                    ? "This submission has not been evaluated. Use Re-evaluate on a submission above."
                    : "Once a submission is received, the rubric engine will run here."
                }
              />
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Workflow timeline</h2><p>Backend state transitions and audit events.</p></div>
            </div>
            {events.length === 0 ? (
              <EmptyState title="No events recorded yet" />
            ) : (
              <div className="timeline">
                {events.map((event) => (
                  <div className="timeline-item" key={event.id}>
                    <span className={`timeline-icon tone-soft-${statusTone(event.new_status || "assigned")}`}>
                      <Icon name="activity" size={15} />
                    </span>
                    <div className="timeline-copy">
                      <strong>{titleCase(event.action.replace(/\./g, " "))}</strong>
                      <span>
                        {event.actor_name}
                        {event.previous_status ? ` · ${statusLabel(event.previous_status)}` : ""}
                        {event.new_status ? ` → ${statusLabel(event.new_status)}` : ""}
                      </span>
                    </div>
                    <span className="timeline-time">{relativeTime(event.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="detail-side">
          <section className="card">
            <div className="card-head">
              <div><h2>At a glance</h2><p>Current state and people involved.</p></div>
            </div>
            <div className="detail-score-block">
              <ScoreRing score={latestEvaluation?.total_score ?? null} size={92} label="score" />
              <div>
                <StatusBadge status={assignment.status} />
                <span className="detail-due">
                  <Icon name="clock" size={14} />
                  {formatDate(assignment.due_date)} ·{" "}
                  {assignment.status === "completed" ? "Completed" : dueLabel(assignment.due_date)}
                </span>
              </div>
            </div>
            <div className="detail-people">
              <div className="detail-person">
                <Avatar name={assignment.intern_name} size={38} />
                <div><strong>{assignment.intern_name}</strong><span>{assignment.intern_email}</span></div>
                <span className="person-role">Intern</span>
              </div>
              <div className="detail-person">
                {assignment.mentor_name ? <Avatar name={assignment.mentor_name} size={38} /> : <span className="avatar avatar-empty">?</span>}
                <div><strong>{assignment.mentor_name || "Unassigned"}</strong><span>Mentor / reviewer</span></div>
                <span className="person-role">Mentor</span>
              </div>
            </div>
            <div className="detail-facts">
              <div><span>Submissions</span><strong>{assignment.submission_count}</strong></div>
              <div><span>Meetings</span><strong>{assignment.meeting_count}</strong></div>
              <div><span>Confidence</span><strong>{latestEvaluation ? `${Math.round(latestEvaluation.confidence * 100)}%` : "—"}</strong></div>
              <div><span>Pass mark</span><strong>{assignment.pass_threshold}</strong></div>
            </div>
            <div className="detail-progress">
              <div className="detail-progress-head">
                <span>Score vs pass mark</span>
                <strong>{latestEvaluation ? `${latestEvaluation.total_score}/${assignment.pass_threshold}` : `—/${assignment.pass_threshold}`}</strong>
              </div>
              <div className="progress">
                <span
                  className={`progress-fill ${(latestEvaluation?.total_score ?? 0) >= assignment.pass_threshold ? "progress-green" : "progress-amber"}`}
                  style={{ width: `${Math.min(100, latestEvaluation?.total_score ?? 0)}%` }}
                />
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Meetings</h2><p>Review calls, join links and calendar files.</p></div>
              {canManage && (
                <button className="icon-button" onClick={() => setMeetingOpen(true)} aria-label="Schedule meeting" title="Schedule meeting">
                  <Icon name="plus" size={17} />
                </button>
              )}
            </div>

            {meetings.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="No meetings scheduled"
                message={canManage ? "Schedule a review once the submission is ready." : "Your mentor will share a review time here."}
                action={canManage ? <button className="btn btn-primary btn-sm" onClick={() => setMeetingOpen(true)}><Icon name="plus" size={14} />Schedule</button> : undefined}
              />
            ) : (
              <div className="meeting-list">
                {meetings.map((meeting) => (
                  <div className={`meeting-card ${meeting.status === "cancelled" ? "meeting-cancelled" : ""}`} key={meeting.id}>
                    <div className="meeting-card-head">
                      <div className="date-tile">
                        <strong>{new Date(meeting.start_time).getDate()}</strong>
                        <span>{new Date(meeting.start_time).toLocaleString(undefined, { month: "short" })}</span>
                      </div>
                      <div className="meeting-card-copy">
                        <strong>{meeting.title}</strong>
                        <span>{formatTime(meeting.start_time)} – {formatTime(meeting.end_time)} · {formatDate(meeting.start_time)}</span>
                      </div>
                      <StatusBadge status={meeting.status} />
                    </div>
                    {meeting.agenda && <p className="meeting-agenda">{meeting.agenda}</p>}
                    <div className="meeting-actions">
                      {meeting.join_url && meeting.status === "scheduled" && (
                        <a className="btn btn-ghost btn-sm" href={meeting.join_url} target="_blank" rel="noreferrer">
                          <Icon name="external" size={14} /> Join
                        </a>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => downloadIcs(meeting)}>
                        <Icon name="download" size={14} /> ICS
                      </button>
                      {canManage && meeting.status === "scheduled" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => cancelMeeting(meeting)}>
                          <Icon name="x" size={14} /> Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <Modal
        open={meetingOpen}
        onClose={() => setMeetingOpen(false)}
        title="Schedule a review meeting"
        subtitle={`${assignment.task_title} · ${assignment.intern_name}`}
        size="md"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setMeetingOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={createMeeting} disabled={meetingBusy}>
              {meetingBusy ? <span className="spinner spinner-light" /> : <Icon name="calendar" size={16} />}
              {meetingBusy ? "Scheduling…" : "Schedule meeting"}
            </button>
          </>
        }
      >
        <div className="form-stack">
          <label className="field">
            <span>Meeting title</span>
            <input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Start time</span>
              <input type="datetime-local" value={meetingStart} onChange={(event) => setMeetingStart(event.target.value)} />
            </label>
            <label className="field">
              <span>Duration</span>
              <select value={meetingDuration} onChange={(event) => setMeetingDuration(Number(event.target.value))}>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Agenda</span>
            <textarea
              value={meetingAgenda}
              onChange={(event) => setMeetingAgenda(event.target.value)}
              rows={3}
              placeholder="Review the submission, discuss feedback and agree next steps."
            />
          </label>
          <Callout tone="info" icon="calendar" title="Calendar & email automation">
            A join link and ICS file are generated. Invitations are sent to the intern and mentor, and the
            workflow moves to Review scheduled.
          </Callout>
        </div>
      </Modal>
    </div>
  );
}
