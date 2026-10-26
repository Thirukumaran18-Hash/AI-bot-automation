import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import {
  Avatar,
  EmptyState,
  Modal,
  PageHeader,
  ScoreRing,
  StatusBadge,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type { AssignmentRecord, Intern, InternFacets, TaskRecord } from "../types";
import { dueLabel, formatDate, markdownExcerpt } from "../utils";

const OPEN_STATUSES = new Set([
  "assigned",
  "in_progress",
  "submitted",
  "evaluating",
  "human_review",
  "revision_required",
  "resubmitted",
  "review_scheduled",
]);

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["assigned", "Assigned"],
  ["in_progress", "In progress"],
  ["submitted", "Submitted"],
  ["evaluating", "Evaluating"],
  ["human_review", "Human review"],
  ["revision_required", "Revision required"],
  ["approved", "Approved"],
  ["review_scheduled", "Review scheduled"],
  ["completed", "Completed"],
] as const;

function NewAssignmentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [interns, setInterns] = useState<Intern[]>([]);
  const [taskId, setTaskId] = useState("");
  const [internId, setInternId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [batch, setBatch] = useState("");
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<TaskRecord[]>("/api/tasks?task_status=approved"),
      api.get<Intern[]>("/api/interns?active=true"),
    ])
      .then(([taskData, internData]) => {
        setTasks(taskData);
        setInterns(internData);
        if (taskData.length) setTaskId(String(taskData[0].id));
        if (internData.length) {
          setInternId(String(internData[0].id));
          setDomain(internData[0].domain);
        }
      })
      .catch(() => toast.error("Could not load tasks or interns."))
      .finally(() => setLoading(false));
  }, [toast]);

  const selectedTask = tasks.find((task) => String(task.id) === taskId);
  const batches = useMemo(() => Array.from(new Set(interns.map((intern) => intern.batch))), [interns]);
  const domains = useMemo(() => Array.from(new Set(interns.map((intern) => intern.domain))), [interns]);

  const submitManual = async () => {
    if (!taskId || !internId) return;
    setSaving(true);
    try {
      await api.post("/api/assignments", {
        task_id: Number(taskId),
        intern_id: Number(internId),
        due_date: dueDate ? new Date(`${dueDate}T23:59:00`).toISOString() : undefined,
      });
      toast.success("Assignment created and the intern was notified.");
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the assignment.");
    } finally {
      setSaving(false);
    }
  };

  const submitAuto = async () => {
    if (!taskId) return;
    setSaving(true);
    try {
      const result = await api.post<{ created_count: number; skipped_count: number }>("/api/assignments/auto", {
        task_id: Number(taskId),
        batch: batch || undefined,
        domain: domain || undefined,
      });
      toast.success(
        `${result.created_count} assignment${result.created_count === 1 ? "" : "s"} created${
          result.skipped_count ? ` · ${result.skipped_count} skipped` : ""
        }.`,
      );
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Auto-assignment failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-stack">
      {loading ? (
        <div className="table-loading"><span className="spinner" /> Loading tasks and interns…</div>
      ) : (
        <>
          <div className="segmented">
            <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")} type="button">
              <Icon name="user-check" size={15} /> One intern
            </button>
            <button className={mode === "auto" ? "active" : ""} onClick={() => setMode("auto")} type="button">
              <Icon name="sliders" size={15} /> By rule
            </button>
          </div>

          <label className="field">
            <span>Task</span>
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title} · {task.domain} · {task.difficulty}
                </option>
              ))}
            </select>
          </label>

          {selectedTask && (
            <div className="selection-summary">
              <span className="badge badge-slate">{selectedTask.domain}</span>
              <span className="badge badge-amber">{selectedTask.difficulty}</span>
              <span>{selectedTask.deadline_days} day deadline</span>
              <span>pass ≥ {selectedTask.pass_threshold}</span>
              <span>{selectedTask.deliverables.length} deliverables</span>
            </div>
          )}

          {mode === "manual" ? (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>Intern</span>
                  <select value={internId} onChange={(event) => setInternId(event.target.value)}>
                    {interns.map((intern) => (
                      <option key={intern.id} value={intern.id}>
                        {intern.name} · {intern.domain} · {intern.batch}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Due date <em>optional — defaults to the task deadline</em></span>
                  <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                </label>
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={submitManual} disabled={saving || !taskId || !internId}>
                  {saving ? <span className="spinner spinner-light" /> : <Icon name="send" size={16} />}
                  {saving ? "Creating…" : "Create assignment"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>Batch</span>
                  <select value={batch} onChange={(event) => setBatch(event.target.value)}>
                    <option value="">All batches</option>
                    {batches.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Domain</span>
                  <select value={domain} onChange={(event) => setDomain(event.target.value)}>
                    <option value="">All domains</option>
                    {domains.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </div>
              <div className="callout callout-warn">
                <span className="callout-icon"><Icon name="alert" size={16} /></span>
                <div>
                  <strong>Rule-based assignment</strong>
                  <div className="callout-body">
                    Every active intern matching the filters receives this task. Existing open assignments for the
                    same task are skipped.
                  </div>
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={submitAuto} disabled={saving || !taskId}>
                  {saving ? <span className="spinner spinner-light" /> : <Icon name="layers" size={16} />}
                  {saving ? "Assigning…" : "Auto-assign matching interns"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function Assignments() {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [facets, setFacets] = useState<InternFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [overdue, setOverdue] = useState(searchParams.get("overdue") === "1");
  const [batch, setBatch] = useState("");
  const [domain, setDomain] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminding, setReminding] = useState<number | null>(null);

  const paramKey = searchParams.toString();

  useEffect(() => {
    setSearch(searchParams.get("search") || "");
    setStatus(searchParams.get("status") || "");
    setOverdue(searchParams.get("overdue") === "1");
  }, [paramKey, searchParams]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (overdue) params.set("overdue", "true");
    if (batch) params.set("batch", batch);
    if (domain) params.set("domain", domain);
    try {
      const data = await api.get<AssignmentRecord[]>(`/api/assignments?${params.toString()}`);
      setAssignments(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load assignments.");
    } finally {
      setLoading(false);
    }
  }, [search, status, overdue, batch, domain]);

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    if (user?.role === "intern") return;
    api.get<InternFacets>("/api/interns/facets").then(setFacets).catch(() => undefined);
  }, [user?.role]);

  const stats = useMemo(() => {
    return {
      open: assignments.filter((item) => OPEN_STATUSES.has(item.status)).length,
      overdue: assignments.filter((item) => item.overdue).length,
      review: assignments.filter((item) => item.status === "human_review").length,
      completed: assignments.filter((item) => item.status === "completed" || item.status === "approved").length,
    };
  }, [assignments]);

  const scoredAssignments = assignments.filter((assignment) => assignment.latest_evaluation);

  const remind = async (assignment: AssignmentRecord) => {
    setReminding(assignment.id);
    try {
      await api.post(`/api/assignments/${assignment.id}/remind`);
      toast.success(`Reminder queued for ${assignment.intern_name}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the reminder.");
    } finally {
      setReminding(null);
    }
  };

  const isIntern = user?.role === "intern";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={isIntern ? "My work" : "Delivery tracking"}
        title={isIntern ? "My tasks" : "Assignments"}
        description={
          isIntern
            ? "Open a task to read the brief, submit your work and review mentor feedback."
            : "Track every intern-task pair from assignment through evaluation and review."
        }
        actions={
          !isIntern ? (
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} />
              New assignment
            </button>
          ) : undefined
        }
      />

      <div className="mini-stats">
        <div><span>{isIntern ? "Open tasks" : "Open"}</span><strong>{stats.open}</strong></div>
        <div><span>Overdue</span><strong className={stats.overdue ? "text-danger" : ""}>{stats.overdue}</strong></div>
        <div><span>Pending review</span><strong>{stats.review}</strong></div>
        <div><span>Completed</span><strong>{stats.completed}</strong></div>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isIntern ? "Search my tasks" : "Search by task or intern"}
            />
          </div>
          <div className="toolbar-group">
            {!isIntern && (
              <>
                <select value={batch} onChange={(event) => setBatch(event.target.value)} aria-label="Filter by batch">
                  <option value="">All batches</option>
                  {(facets?.batches || []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="Filter by domain">
                  <option value="">All domains</option>
                  {(facets?.domains || []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </>
            )}
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="toggle-inline">
              <input type="checkbox" checked={overdue} onChange={(event) => setOverdue(event.target.checked)} />
              <span>Overdue only</span>
            </label>
            <button className="icon-button" onClick={() => load()} aria-label="Refresh assignments">
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="table-loading"><span className="spinner" /> Loading assignments…</div>
        ) : error ? (
          <EmptyState icon="alert" title="Could not load assignments" message={error} action={<button className="btn btn-primary" onClick={() => load()}>Retry</button>} />
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={isIntern ? "check-circle" : "layers"}
            title={isIntern ? "No tasks match these filters" : "No assignments match these filters"}
            message={isIntern ? "New tasks will appear here as soon as your mentor assigns them." : "Create an assignment or adjust the filters."}
            action={!isIntern ? <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} />New assignment</button> : undefined}
          />
        ) : isIntern ? (
          <div className="my-task-grid">
            {assignments.map((assignment) => (
              <Link to={`/assignments/${assignment.id}`} className="my-task-card" key={assignment.id}>
                <div className="my-task-head">
                  <span className="badge badge-slate">{assignment.task_domain}</span>
                  <StatusBadge status={assignment.status} />
                </div>
                <h3>{assignment.task_title}</h3>
                <p>{markdownExcerpt(assignment.task_description, 130)}</p>
                <div className="my-task-meta">
                  <span className={assignment.overdue ? "text-danger" : ""}>
                    <Icon name="clock" size={14} />
                    {assignment.status === "completed" ? "Completed" : dueLabel(assignment.due_date)}
                  </span>
                  <span><Icon name="upload" size={14} />{assignment.submission_count} submission{assignment.submission_count === 1 ? "" : "s"}</span>
                  {assignment.latest_evaluation && (
                    <span className="my-task-score">
                      <Icon name="star" size={14} />
                      {assignment.latest_evaluation.total_score}
                    </span>
                  )}
                </div>
                <div className="my-task-footer">
                  <span>{formatDate(assignment.due_date)}</span>
                  <span className="my-task-open">Open task <Icon name="arrow-right" size={14} /></span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Intern</th>
                  <th>Task</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Submissions</th>
                  <th>Score</th>
                  <th className="align-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar name={assignment.intern_name} size={36} />
                        <div>
                          <strong>{assignment.intern_name}</strong>
                          <span>{assignment.intern_domain} · {assignment.mentor_name || "No mentor"}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <strong>{assignment.task_title}</strong>
                        <span>{assignment.task_domain} · {assignment.task_difficulty}</span>
                      </div>
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <span className={assignment.overdue ? "text-danger" : ""}>{formatDate(assignment.due_date)}</span>
                        <span className={assignment.overdue ? "text-danger small" : "muted small"}>
                          {assignment.status === "completed" ? "Completed" : dueLabel(assignment.due_date)}
                        </span>
                      </div>
                    </td>
                    <td><StatusBadge status={assignment.status} /></td>
                    <td>{assignment.submission_count}</td>
                    <td>
                      {assignment.latest_evaluation ? (
                        <span className={assignment.latest_evaluation.total_score < 70 ? "score-text score-low" : "score-text"}>
                          {assignment.latest_evaluation.total_score}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="align-right">
                      <div className="row-actions">
                        {OPEN_STATUSES.has(assignment.status) && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => remind(assignment)}
                            disabled={reminding === assignment.id}
                          >
                            {reminding === assignment.id ? <span className="spinner" /> : <Icon name="mail" size={14} />}
                            Remind
                          </button>
                        )}
                        <Link className="btn btn-secondary btn-sm" to={`/assignments/${assignment.id}`}>
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isIntern && (
        <section className="card">
          <div className="card-head">
            <div><h2>Score snapshot</h2><p>Your latest evaluation across active tasks.</p></div>
          </div>
          <div className="score-snapshot">
            {scoredAssignments.length === 0 ? (
              <EmptyState title="No evaluations yet" message="Submit your first task to receive rubric-based feedback." />
            ) : (
              scoredAssignments.slice(0, 4).map((assignment) => (
                <div className="score-snapshot-item" key={assignment.id}>
                  <ScoreRing score={assignment.latest_evaluation?.total_score ?? null} size={64} />
                  <div>
                    <strong>{assignment.task_title}</strong>
                    <StatusBadge status={assignment.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create an assignment"
        subtitle="Match an approved task to an intern, or apply a batch/domain rule."
        size="lg"
      >
        <NewAssignmentModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
      </Modal>
    </div>
  );
}
