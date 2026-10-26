import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import {
  EmptyState,
  Modal,
  PageHeader,
  StatusBadge,
  statusLabel,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type { Intern, RubricCriterion, TaskRecord, TestCase } from "../types";
import { formatDate, markdownExcerpt } from "../utils";

const DEFAULT_RUBRIC: RubricCriterion[] = [
  { name: "Requirement matching", weight: 25, description: "All required deliverables are present and usable." },
  { name: "Functional correctness", weight: 30, description: "The solution works and handles expected edge cases." },
  { name: "Code / deliverable quality", weight: 25, description: "The work is structured, readable and maintainable." },
  { name: "Documentation and explanation", weight: 20, description: "Setup, usage and decisions are clearly documented." },
];

interface TaskDraftResponse {
  title: string;
  domain: string;
  difficulty: string;
  description: string;
  deliverables: string[];
  acceptance_criteria: string[];
  rubric: RubricCriterion[];
  test_cases: TestCase[];
  deadline_days: number;
  generated_by: string;
}

function StringListEditor({
  label,
  hint,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="list-editor">
      <div className="list-editor-head">
        <span>{label}</span>
        {hint && <em>{hint}</em>}
      </div>
      {items.map((item, index) => (
        <div className="list-row" key={index}>
          <input
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="icon-button icon-button-danger"
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            aria-label="Remove item"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...items, ""])}>
        <Icon name="plus" size={14} />
        Add {label.toLowerCase()}
      </button>
    </div>
  );
}

function CreateTaskForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("Python");
  const [difficulty, setDifficulty] = useState("Beginner");
  const [description, setDescription] = useState("");
  const [deadlineDays, setDeadlineDays] = useState(7);
  const [passThreshold, setPassThreshold] = useState(70);
  const [status, setStatus] = useState("approved");
  const [deliverables, setDeliverables] = useState<string[]>(["Source code", "Unit tests", "README"]);
  const [criteria, setCriteria] = useState<string[]>([
    "The main scenario works as described.",
    "Invalid input is handled safely.",
    "Setup steps are documented.",
  ]);
  const [rubric, setRubric] = useState<RubricCriterion[]>(DEFAULT_RUBRIC.map((item) => ({ ...item })));
  const [testCases, setTestCases] = useState<TestCase[]>([
    { name: "Happy path", detail: "The main scenario produces the expected result." },
    { name: "Invalid input", detail: "Invalid or empty input is rejected safely." },
  ]);
  const [notes, setNotes] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [generatedBy, setGeneratedBy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weightTotal = rubric.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);

  const draftWithAi = async () => {
    if (!title.trim()) {
      toast.error("Add a task title before asking the AI assistant to draft it.");
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const draft = await api.post<TaskDraftResponse>("/api/tasks/ai-draft", {
        title,
        domain,
        difficulty,
        notes,
      });
      setTitle(draft.title || title);
      setDomain(draft.domain || domain);
      setDifficulty(draft.difficulty || difficulty);
      setDescription(draft.description || "");
      setDeliverables(draft.deliverables || []);
      setCriteria(draft.acceptance_criteria || []);
      setRubric(draft.rubric?.length ? draft.rubric : DEFAULT_RUBRIC);
      setTestCases(draft.test_cases || []);
      setDeadlineDays(draft.deadline_days || deadlineDays);
      setGeneratedBy(draft.generated_by);
      toast.success(
        draft.generated_by === "openai"
          ? "Task draft generated by the AI model."
          : "Task draft generated locally. Review every field before publishing.",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate a draft.");
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/tasks", {
        title,
        description,
        domain,
        difficulty,
        deliverables: deliverables.filter((item) => item.trim()),
        acceptance_criteria: criteria.filter((item) => item.trim()),
        rubric: rubric
          .filter((item) => item.name.trim() && Number(item.weight) > 0)
          .map((item) => ({ ...item, weight: Number(item.weight) })),
        test_cases: testCases.filter((item) => item.name.trim()),
        deadline_days: Number(deadlineDays),
        pass_threshold: Number(passThreshold),
        status: user?.role === "mentor" ? "draft" : status,
      });
      toast.success(
        user?.role === "mentor"
          ? "Task saved as a draft for administrator approval."
          : status === "approved"
            ? "Task created and approved."
            : "Task saved as a draft.",
      );
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the task.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="form-stack">
      <div className="ai-draft-box">
        <div>
          <strong><Icon name="sparkles" size={16} /> AI task assistant</strong>
          <span>Describe the outcome and let InternFlow draft the brief, deliverables and rubric.</span>
        </div>
        <div className="ai-draft-actions">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="e.g. A Python exercise on validating login input with tests and a short README…"
          />
          <button type="button" className="btn btn-secondary" onClick={draftWithAi} disabled={drafting}>
            {drafting ? <span className="spinner" /> : <Icon name="sparkles" size={16} />}
            {drafting ? "Drafting…" : "Draft with AI"}
          </button>
        </div>
        {generatedBy && <span className="ai-generated">Generated by {generatedBy}. Review before publishing.</span>}
      </div>

      <div className="form-grid">
        <label className="field field-span-2">
          <span>Task title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} placeholder="Python Login Validation" />
        </label>
        <label className="field">
          <span>Domain</span>
          <input value={domain} onChange={(event) => setDomain(event.target.value)} required placeholder="Python" />
        </label>
        <label className="field">
          <span>Difficulty</span>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
            <option>Beginner</option>
            <option>Intermediate</option>
            <option>Advanced</option>
          </select>
        </label>
        <label className="field">
          <span>Deadline (days)</span>
          <input type="number" min={1} max={120} value={deadlineDays} onChange={(event) => setDeadlineDays(Number(event.target.value))} />
        </label>
        <label className="field">
          <span>Pass threshold</span>
          <input type="number" min={1} max={100} value={passThreshold} onChange={(event) => setPassThreshold(Number(event.target.value))} />
        </label>
        {user?.role === "admin" && (
          <label className="field">
            <span>Publish status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="approved">Approved — assignable</option>
              <option value="draft">Draft — not assignable</option>
            </select>
          </label>
        )}
      </div>

      <label className="field">
        <span>Task brief</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={7}
          required
          minLength={10}
          placeholder="Objective, requirements, submission format and evaluation notes…"
        />
        <em>Markdown-style headings are supported in the saved brief.</em>
      </label>

      <div className="form-grid">
        <StringListEditor
          label="Deliverables"
          hint="Deterministic checks use this list"
          items={deliverables}
          placeholder="e.g. Source code"
          onChange={setDeliverables}
        />
        <StringListEditor
          label="Acceptance criteria"
          hint="Observable, reviewable outcomes"
          items={criteria}
          placeholder="e.g. Empty input is rejected"
          onChange={setCriteria}
        />
      </div>

      <div className="list-editor">
        <div className="list-editor-head">
          <span>Scoring rubric</span>
          <em>Weights are normalised to 100 · current total {weightTotal}</em>
        </div>
        <div className="rubric-rows">
          {rubric.map((item, index) => (
            <div className="rubric-row" key={index}>
              <input
                value={item.name}
                placeholder="Criterion name"
                onChange={(event) => {
                  const next = [...rubric];
                  next[index] = { ...next[index], name: event.target.value };
                  setRubric(next);
                }}
              />
              <input
                type="number"
                min={1}
                max={100}
                value={item.weight}
                onChange={(event) => {
                  const next = [...rubric];
                  next[index] = { ...next[index], weight: Number(event.target.value) };
                  setRubric(next);
                }}
                className="weight-input"
              />
              <input
                value={item.description || ""}
                placeholder="What evidence does this criterion need?"
                onChange={(event) => {
                  const next = [...rubric];
                  next[index] = { ...next[index], description: event.target.value };
                  setRubric(next);
                }}
              />
              <button
                type="button"
                className="icon-button icon-button-danger"
                onClick={() => setRubric(rubric.filter((_, itemIndex) => itemIndex !== index))}
                aria-label="Remove criterion"
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="rubric-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRubric([...rubric, { name: "", weight: 10, description: "" }])}>
            <Icon name="plus" size={14} /> Add criterion
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRubric(DEFAULT_RUBRIC.map((item) => ({ ...item })))}>
            <Icon name="refresh" size={14} /> Reset to default
          </button>
        </div>
      </div>

      <div className="list-editor">
        <div className="list-editor-head">
          <span>Test cases / evidence prompts</span>
          <em>Used by reviewers and the evaluation engine</em>
        </div>
        {testCases.map((item, index) => (
          <div className="test-row" key={index}>
            <input
              value={item.name}
              placeholder="Test name"
              onChange={(event) => {
                const next = [...testCases];
                next[index] = { ...next[index], name: event.target.value };
                setTestCases(next);
              }}
            />
            <input
              value={item.detail || ""}
              placeholder="Expected evidence or detail"
              onChange={(event) => {
                const next = [...testCases];
                next[index] = { ...next[index], detail: event.target.value };
                setTestCases(next);
              }}
            />
            <button
              type="button"
              className="icon-button icon-button-danger"
              onClick={() => setTestCases(testCases.filter((_, itemIndex) => itemIndex !== index))}
              aria-label="Remove test case"
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTestCases([...testCases, { name: "", detail: "" }])}>
          <Icon name="plus" size={14} /> Add test case
        </button>
      </div>

      {error && <div className="inline-error"><Icon name="alert" size={15} />{error}</div>}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <span className="spinner spinner-light" /> : <Icon name="check" size={16} />}
          {saving ? "Saving…" : "Create task"}
        </button>
      </div>
    </form>
  );
}

function AssignModal({
  task,
  onClose,
  onAssigned,
}: {
  task: TaskRecord;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const toast = useToast();
  const [interns, setInterns] = useState<Intern[]>([]);
  const [internId, setInternId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [batch, setBatch] = useState("");
  const [domain, setDomain] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);

  useEffect(() => {
    api
      .get<Intern[]>("/api/interns?active=true")
      .then((data) => {
        setInterns(data);
        if (data.length) {
          setInternId(String(data[0].id));
          setDomain(data[0].domain);
        }
      })
      .catch(() => undefined);
  }, []);

  const batches = useMemo(() => Array.from(new Set(interns.map((intern) => intern.batch))), [interns]);
  const domains = useMemo(() => Array.from(new Set(interns.map((intern) => intern.domain))), [interns]);

  const assignOne = async () => {
    if (!internId) return;
    setAssigning(true);
    try {
      await api.post("/api/assignments", {
        task_id: task.id,
        intern_id: Number(internId),
        due_date: dueDate ? new Date(`${dueDate}T23:59:00`).toISOString() : undefined,
      });
      toast.success("Task assigned and notification sent.");
      onAssigned();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not assign the task.");
    } finally {
      setAssigning(false);
    }
  };

  const autoAssign = async () => {
    setAutoAssigning(true);
    try {
      const result = await api.post<{ created_count: number; skipped_count: number; eligible_count: number }>(
        "/api/assignments/auto",
        {
          task_id: task.id,
          batch: batch || undefined,
          domain: domain || undefined,
        },
      );
      toast.success(
        `${result.created_count} new assignment${result.created_count === 1 ? "" : "s"} created${
          result.skipped_count ? ` · ${result.skipped_count} skipped` : ""
        }.`,
      );
      onAssigned();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Auto-assignment failed.");
    } finally {
      setAutoAssigning(false);
    }
  };

  return (
    <div className="form-stack">
      <div className="callout callout-info">
        <span className="callout-icon"><Icon name="clipboard" size={17} /></span>
        <div>
          <strong>{task.title}</strong>
          <div className="callout-body">
            {task.domain} · {task.difficulty} · {task.deadline_days} day deadline · pass at {task.pass_threshold}
          </div>
        </div>
      </div>

      <div className="assign-section">
        <div className="section-title"><Icon name="user-check" size={16} /> Assign to one intern</div>
        <div className="form-grid">
          <label className="field">
            <span>Intern</span>
            <select value={internId} onChange={(event) => setInternId(event.target.value)}>
              {interns.map((intern) => (
                <option key={intern.id} value={intern.id}>
                  {intern.name} · {intern.domain} {intern.mentor_name ? `· ${intern.mentor_name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due date <em>optional</em></span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        </div>
        <button className="btn btn-primary" onClick={assignOne} disabled={assigning || !internId}>
          {assigning ? <span className="spinner spinner-light" /> : <Icon name="send" size={16} />}
          {assigning ? "Assigning…" : "Assign and notify"}
        </button>
      </div>

      <div className="assign-divider"><span>or assign by rule</span></div>

      <div className="assign-section">
        <div className="section-title"><Icon name="sliders" size={16} /> Auto-assign by batch and domain</div>
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
        <p className="muted small">
          Every active intern matching these filters receives the task. Interns who already have an open
          assignment for this task are skipped.
        </p>
        <button className="btn btn-secondary" onClick={autoAssign} disabled={autoAssigning}>
          {autoAssigning ? <span className="spinner" /> : <Icon name="layers" size={16} />}
          {autoAssigning ? "Assigning…" : "Auto-assign matching interns"}
        </button>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function Tasks() {
  const { user } = useAuth();
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<TaskRecord | null>(null);
  const [assignTarget, setAssignTarget] = useState<TaskRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (domain) params.set("domain", domain);
    if (taskStatus) params.set("task_status", taskStatus);
    try {
      const data = await api.get<TaskRecord[]>(`/api/tasks?${params.toString()}`);
      setTasks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, [search, domain, taskStatus]);

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    api.get<{ domains: string[] }>("/api/tasks/facets").then((data) => setDomains(data.domains)).catch(() => undefined);
  }, []);

  const approve = async (task: TaskRecord) => {
    try {
      await api.post(`/api/tasks/${task.id}/approve`);
      toast.success(`${task.title} is now approved and assignable.`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not approve the task.");
    }
  };

  const saved = () => {
    setCreateOpen(false);
    load();
    api.get<{ domains: string[] }>("/api/tasks/facets").then((data) => setDomains(data.domains)).catch(() => undefined);
  };

  const stats = useMemo(() => {
    return {
      total: tasks.length,
      approved: tasks.filter((task) => task.status === "approved").length,
      drafts: tasks.filter((task) => task.status === "draft").length,
      assignments: tasks.reduce((sum, task) => sum + task.assignment_count, 0),
    };
  }, [tasks]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Task library"
        title="Tasks"
        description="Design measurable assignments with deliverables, acceptance criteria and rubric weights."
        actions={
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={16} />
            Create task
          </button>
        }
      />

      <div className="mini-stats">
        <div><span>In view</span><strong>{stats.total}</strong></div>
        <div><span>Approved</span><strong>{stats.approved}</strong></div>
        <div><span>Drafts</span><strong>{stats.drafts}</strong></div>
        <div><span>Assignments</span><strong>{stats.assignments}</strong></div>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" />
          </div>
          <div className="toolbar-group">
            <select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="Filter by domain">
              <option value="">All domains</option>
              {domains.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="approved">Approved</option>
              <option value="draft">Draft</option>
            </select>
            <button className="icon-button" onClick={() => load()} aria-label="Refresh tasks">
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="table-loading"><span className="spinner" /> Loading tasks…</div>
        ) : error ? (
          <EmptyState icon="alert" title="Could not load tasks" message={error} action={<button className="btn btn-primary" onClick={() => load()}>Retry</button>} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No tasks found"
            message="Create a task with a clear brief and rubric to start assigning work."
            action={<button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} />Create task</button>}
          />
        ) : (
          <div className="task-grid">
            {tasks.map((task) => (
              <article className="task-card" key={task.id}>
                <div className="task-card-top">
                  <span className="badge badge-slate">{task.domain}</span>
                  <span className={`badge ${task.difficulty === "Beginner" ? "badge-green" : task.difficulty === "Advanced" ? "badge-red" : "badge-amber"}`}>
                    {task.difficulty}
                  </span>
                  <StatusBadge status={task.status} />
                </div>
                <h3>{task.title}</h3>
                <p className="task-snippet">{markdownExcerpt(task.description, 170)}</p>
                <div className="task-meta">
                  <span><Icon name="layers" size={14} />{task.assignment_count} assigned</span>
                  <span><Icon name="check-circle" size={14} />{task.completed_count} done</span>
                  <span><Icon name="star" size={14} />{task.average_score ?? "—"} avg</span>
                  <span><Icon name="clock" size={14} />{task.deadline_days}d</span>
                </div>
                <div className="task-rubric-preview">
                  {task.rubric.slice(0, 3).map((item) => (
                    <span key={item.name} className="chip">{item.name} · {Math.round(item.weight)}%</span>
                  ))}
                  {task.rubric.length > 3 && <span className="chip chip-more">+{task.rubric.length - 3}</span>}
                </div>
                <div className="task-card-footer">
                  <span className="muted small">Created {formatDate(task.created_at)}</span>
                  <div className="row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setDetail(task)}>View</button>
                    {user?.role === "admin" && task.status === "draft" && (
                      <button className="btn btn-secondary btn-sm" onClick={() => approve(task)}>
                        <Icon name="check" size={14} /> Approve
                      </button>
                    )}
                    {task.status === "approved" && (
                      <button className="btn btn-primary btn-sm" onClick={() => setAssignTarget(task)}>
                        <Icon name="send" size={14} /> Assign
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create an internship task"
        subtitle="Define the brief, required evidence and scoring rubric. AI can draft a starting point."
        size="xl"
      >
        <CreateTaskForm onClose={() => setCreateOpen(false)} onSaved={saved} />
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title || "Task detail"}
        subtitle={detail ? `${detail.domain} · ${detail.difficulty} · ${statusLabel(detail.status)}` : undefined}
        size="lg"
        footer={
          detail ? (
            <>
              <button className="btn btn-ghost" onClick={() => setDetail(null)}>Close</button>
              {detail.status === "approved" && (
                <button className="btn btn-primary" onClick={() => { setAssignTarget(detail); setDetail(null); }}>
                  <Icon name="send" size={16} /> Assign task
                </button>
              )}
            </>
          ) : undefined
        }
      >
        {detail && (
          <div className="task-detail">
            <div className="detail-meta-grid">
              <div><span>Deadline</span><strong>{detail.deadline_days} days</strong></div>
              <div><span>Pass threshold</span><strong>{detail.pass_threshold}</strong></div>
              <div><span>Assigned</span><strong>{detail.assignment_count}</strong></div>
              <div><span>Average score</span><strong>{detail.average_score ?? "—"}</strong></div>
            </div>
            <div className="detail-section">
              <h4>Task brief</h4>
              <Markdown text={detail.description} />
            </div>
            <div className="detail-columns">
              <div className="detail-section">
                <h4>Deliverables</h4>
                <ul className="check-list">
                  {detail.deliverables.map((item) => <li key={item}><Icon name="check" size={14} />{item}</li>)}
                </ul>
              </div>
              <div className="detail-section">
                <h4>Acceptance criteria</h4>
                <ul className="check-list">
                  {detail.acceptance_criteria.map((item) => <li key={item}><Icon name="target" size={14} />{item}</li>)}
                </ul>
              </div>
            </div>
            <div className="detail-section">
              <h4>Scoring rubric</h4>
              <div className="rubric-table">
                {detail.rubric.map((item) => (
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
            {detail.test_cases.length > 0 && (
              <div className="detail-section">
                <h4>Test cases / evidence prompts</h4>
                <div className="test-case-list">
                  {detail.test_cases.map((item) => (
                    <div className="test-case" key={item.name}>
                      <strong>{item.name}</strong>
                      {item.detail && <span>{item.detail}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(assignTarget)}
        onClose={() => setAssignTarget(null)}
        title="Assign task"
        subtitle={assignTarget ? assignTarget.title : undefined}
        size="lg"
      >
        {assignTarget && (
          <AssignModal
            task={assignTarget}
            onClose={() => setAssignTarget(null)}
            onAssigned={() => {
              setAssignTarget(null);
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
