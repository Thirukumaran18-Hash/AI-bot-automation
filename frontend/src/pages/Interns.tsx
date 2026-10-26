import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import {
  Avatar,
  EmptyState,
  Modal,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type { Intern, InternFacets } from "../types";

interface ImportCreated {
  intern_id: number;
  name: string;
  email: string;
  temporary_password: string;
}

interface AutomationItem {
  status: string;
  name?: string;
  task?: string;
  join_url?: string;
  reason?: string;
}

interface AutomationResult {
  total: number;
  launched: number;
  skipped: number;
  completed: number;
  results: AutomationItem[];
}

interface ImportResult {
  created_count: number;
  skipped_count: number;
  error_count: number;
  created: ImportCreated[];
  skipped: { row: number; email: string; reason: string }[];
  errors: { row: number; error: string }[];
  automation?: {
    requested: boolean;
    launched: number;
    skipped: number;
    failed: number;
    results: AutomationItem[];
  };
}

interface CredentialNotice {
  name: string;
  email: string;
  password: string;
}

function InternForm({
  intern,
  facets,
  onClose,
  onSaved,
}: {
  intern: Intern | null;
  facets: InternFacets | null;
  onClose: () => void;
  onSaved: (notice?: CredentialNotice) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(intern?.name || "");
  const [email, setEmail] = useState(intern?.email || "");
  const [password, setPassword] = useState("");
  const [batch, setBatch] = useState(intern?.batch || facets?.batches[0] || "2026-Cohort-A");
  const [domain, setDomain] = useState(intern?.domain || facets?.domains[0] || "Python");
  const [skills, setSkills] = useState(intern?.skills.join(", ") || "");
  const [mentorId, setMentorId] = useState<string>(
    intern?.mentor_id ? String(intern.mentor_id) : facets?.mentors[0] ? String(facets.mentors[0].id) : "",
  );
  const [active, setActive] = useState(intern?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(intern);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing && intern) {
        await api.patch(`/api/interns/${intern.id}`, {
          name,
          batch,
          domain,
          skills,
          mentor_id: mentorId ? Number(mentorId) : null,
          active,
        });
        toast.success(`${name} was updated.`);
        onSaved();
      } else {
        const response = await api.post<{ intern: Intern; temporary_password: string }>("/api/interns", {
          name,
          email,
          password: password || undefined,
          batch,
          domain,
          skills,
          mentor_id: mentorId ? Number(mentorId) : null,
        });
        toast.success(`${name} was onboarded.`);
        onSaved({
          name: response.intern.name,
          email: response.intern.email,
          password: response.temporary_password,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the intern.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="form-stack">
      <div className="form-grid">
        <label className="field">
          <span>Full name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="e.g. Ananya Krishnan" />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={editing}
            placeholder="intern@company.com"
          />
        </label>
        {!editing && (
          <label className="field">
            <span>Initial password <em>optional</em></span>
            <input
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              placeholder="Auto-generated if blank"
            />
          </label>
        )}
        <label className="field">
          <span>Batch</span>
          <input value={batch} onChange={(event) => setBatch(event.target.value)} required list="batch-options" />
          <datalist id="batch-options">
            {(facets?.batches || []).map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>
        <label className="field">
          <span>Domain</span>
          <input value={domain} onChange={(event) => setDomain(event.target.value)} required list="domain-options" />
          <datalist id="domain-options">
            {(facets?.domains || []).map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>
        <label className="field">
          <span>Mentor</span>
          <select value={mentorId} onChange={(event) => setMentorId(event.target.value)}>
            <option value="">Unassigned</option>
            {(facets?.mentors || []).map((mentor) => (
              <option key={mentor.id} value={mentor.id}>{mentor.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Skills <em>comma separated</em></span>
        <input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Python, SQL, React" />
      </label>
      {editing && (
        <label className="checkbox-row">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span>Account is active and can sign in</span>
        </label>
      )}
      {error && <div className="inline-error"><Icon name="alert" size={15} />{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <span className="spinner spinner-light" /> : <Icon name={editing ? "check" : "user-check"} size={16} />}
          {saving ? "Saving…" : editing ? "Save changes" : "Create intern"}
        </button>
      </div>
    </form>
  );
}

export function Interns() {
  const { user } = useAuth();
  const toast = useToast();
  const [interns, setInterns] = useState<Intern[]>([]);
  const [facets, setFacets] = useState<InternFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [batch, setBatch] = useState("");
  const [domain, setDomain] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Intern | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<CredentialNotice | null>(null);
  const [launchNow, setLaunchNow] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Intern | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (batch) params.set("batch", batch);
    if (domain) params.set("domain", domain);
    if (activeFilter !== "all") params.set("active", activeFilter === "active" ? "true" : "false");
    try {
      const data = await api.get<Intern[]>(`/api/interns?${params.toString()}`);
      setInterns(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load interns.");
    } finally {
      setLoading(false);
    }
  }, [search, batch, domain, activeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    api
      .get<InternFacets>("/api/interns/facets")
      .then(setFacets)
      .catch(() => undefined);
  }, []);

  const stats = useMemo(() => {
    const total = interns.length;
    const active = interns.filter((intern) => intern.active).length;
    const overdue = interns.reduce((sum, intern) => sum + intern.overdue_count, 0);
    const withScores = interns.filter((intern) => intern.average_score !== null);
    const average = withScores.length
      ? Math.round(withScores.reduce((sum, intern) => sum + (intern.average_score || 0), 0) / withScores.length)
      : null;
    return { total, active, overdue, average };
  }, [interns]);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (intern: Intern) => {
    setEditing(intern);
    setEditorOpen(true);
  };

  const downloadTemplate = () => {
    const csv = [
      "name,email,phone,role,batch,skills,mentor_email,password",
      "Ananya Krishnan,ananya@example.com,+91 90000 00001,Python Developer,2026-Cohort-A,\"Python, SQL, Git\",mentor@internflow.ai,",
      "Rohit Verma,rohit@example.com,+91 90000 00002,Frontend Developer,2026-Cohort-A,\"React, TypeScript\",suresh@internflow.ai,",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "internflow-intern-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const submitImport = async () => {
    if (!importFile) {
      toast.error("Choose a CSV or Excel file first.");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("launch", launchNow ? "true" : "false");
      const result = await api.upload<ImportResult>("/api/interns/import", formData);
      setImportResult(result);
      if (result.automation?.launched) {
        toast.success(
          `${result.created_count} imported and ${result.automation.launched} task brief + meeting emails sent.`,
        );
      } else {
        toast.success(`${result.created_count} intern${result.created_count === 1 ? "" : "s"} imported.`);
      }
      load();
      api.get<InternFacets>("/api/interns/facets").then(setFacets).catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const runAutomation = async () => {
    setLaunching(true);
    try {
      const result = await api.post<AutomationResult>("/api/autopilot/launch", {});
      toast.success(
        `${result.launched} task brief${result.launched === 1 ? "" : "s"} sent with meeting links` +
          (result.skipped ? `, ${result.skipped} already had an open task.` : "."),
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the automation.");
    } finally {
      setLaunching(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/interns/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} and all related records were deleted.`);
      setDeleteTarget(null);
      load();
      api.get<InternFacets>("/api/interns/facets").then(setFacets).catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the intern.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaved = (credential?: CredentialNotice) => {
    setEditorOpen(false);
    if (credential) setNotice(credential);
    load();
    api.get<InternFacets>("/api/interns/facets").then(setFacets).catch(() => undefined);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Cohort management"
        title="Interns"
        description="Onboard interns, map them to mentors and keep an eye on progress across every batch."
        actions={
          user?.role === "admin" ? (
            <>
              <button className="btn btn-secondary" onClick={runAutomation} disabled={launching}>
                {launching ? <span className="spinner spinner-light" /> : <Icon name="play" size={16} />}
                {launching ? "Starting�?�" : "Run automation"}
              </button>
              <button className="btn btn-ghost" onClick={() => { setImportResult(null); setImportOpen(true); }}>
                <Icon name="upload" size={16} />
                Import Excel
              </button>
              <button className="btn btn-primary" onClick={openCreate}>
                <Icon name="plus" size={16} />
                Add intern
              </button>
            </>
          ) : undefined
        }
      />

      {notice && (
        <div className="credential-banner">
          <span className="credential-icon"><Icon name="user-check" size={18} /></span>
          <div>
            <strong>{notice.name} is ready to sign in</strong>
            <span>Email: {notice.email} · Temporary password: <code>{notice.password}</code></span>
          </div>
          <button className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <div className="mini-stats">
        <div><span>In view</span><strong>{stats.total}</strong></div>
        <div><span>Active</span><strong>{stats.active}</strong></div>
        <div><span>Avg score</span><strong>{stats.average ?? "—"}</strong></div>
        <div><span>Overdue items</span><strong>{stats.overdue}</strong></div>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email or skill"
            />
          </div>
          <div className="toolbar-group">
            <select value={batch} onChange={(event) => setBatch(event.target.value)} aria-label="Filter by batch">
              <option value="">All batches</option>
              {(facets?.batches || []).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="Filter by domain">
              <option value="">All domains</option>
              {(facets?.domains || []).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button className="icon-button" onClick={() => load()} title="Refresh" aria-label="Refresh interns">
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="table-loading"><span className="spinner" /> Loading interns…</div>
        ) : error ? (
          <EmptyState icon="alert" title="Could not load interns" message={error} action={<button className="btn btn-primary" onClick={() => load()}>Retry</button>} />
        ) : interns.length === 0 ? (
          <EmptyState
            icon="users"
            title="No interns match these filters"
            message="Adjust the filters or onboard a new intern to get started."
            action={user?.role === "admin" ? <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" size={16} />Add intern</button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Intern</th>
                  <th>Domain</th>
                  <th>Batch</th>
                  <th>Mentor</th>
                  <th>Progress</th>
                  <th>Avg score</th>
                  <th>Status</th>
                  <th className="align-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {interns.map((intern) => {
                  const progress = intern.assignment_count
                    ? Math.round((intern.completed_count / intern.assignment_count) * 100)
                    : 0;
                  return (
                    <tr key={intern.id}>
                      <td>
                        <div className="person-cell">
                          <Avatar name={intern.name} size={38} />
                          <div>
                            <strong>{intern.name}</strong>
                            <span>
                              {intern.email}
                              {intern.phone ? ` | ${intern.phone}` : ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="stacked-cell">
                          <span>{intern.domain}</span>
                          <div className="skill-chips">
                            {intern.skills.slice(0, 2).map((skill) => <span key={skill} className="chip">{skill}</span>)}
                            {intern.skills.length > 2 && <span className="chip chip-more">+{intern.skills.length - 2}</span>}
                          </div>
                        </div>
                      </td>
                      <td>{intern.batch}</td>
                      <td>{intern.mentor_name || <span className="muted">Unassigned</span>}</td>
                      <td>
                        <div className="progress-cell">
                          <ProgressBar value={progress} tone={intern.overdue_count ? "amber" : "indigo"} height={7} />
                          <span>{intern.completed_count}/{intern.assignment_count} complete</span>
                          {intern.overdue_count > 0 && <span className="text-danger">{intern.overdue_count} overdue</span>}
                        </div>
                      </td>
                      <td>
                        <span className={intern.average_score !== null && intern.average_score < 70 ? "score-text score-low" : "score-text"}>
                          {intern.average_score ?? "—"}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={intern.active ? "active" : "inactive"} dot />
                      </td>
                      <td className="align-right">
                        <div className="row-actions">
                          <Link className="btn btn-ghost btn-sm" to={`/assignments?search=${encodeURIComponent(intern.email)}`}>
                            Tasks
                          </Link>
                          {user?.role === "admin" && (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => openEdit(intern)}>Edit</button>
                              <button
                                className="btn btn-ghost btn-sm text-danger"
                                onClick={() => setDeleteTarget(intern)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? "Edit intern" : "Onboard a new intern"}
        subtitle={editing ? "Update cohort details, mentor mapping and account status." : "Create the intern's account and internship profile in one step."}
        size="lg"
      >
        <InternForm
          key={editing?.id ?? "new"}
          intern={editing}
          facets={facets}
          onClose={() => setEditorOpen(false)}
          onSaved={handleSaved}
        />
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk import candidates"
        subtitle="Upload Excel (.xlsx) or UTF-8 CSV. Rows with existing emails are skipped safely."
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setImportOpen(false)}>Close</button>
            <button className="btn btn-primary" onClick={submitImport} disabled={importing || !importFile}>
              {importing ? <span className="spinner spinner-light" /> : <Icon name="upload" size={16} />}
              {importing ? "Importing…" : "Import interns"}
            </button>
          </>
        }
      >
        <div className="form-stack">
          <div className="callout callout-info">
            <span className="callout-icon"><Icon name="file" size={17} /></span>
            <div>
              <strong>Required columns</strong>
              <div className="callout-body">
                <code>name,email,role</code> are required (<code>domain</code> also works). Optional:
                <code> phone,batch,skills,mentor_email,password</code>.
              </div>
            </div>
          </div>

          <div className="import-actions">
            <button className="btn btn-ghost" onClick={downloadTemplate}>
              <Icon name="download" size={16} />
              Download CSV template
            </button>
          </div>

          <label className="file-drop">
            <input
              type="file"
              accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] || null);
                setImportResult(null);
              }}
            />
            <span className="file-drop-icon"><Icon name="upload" size={22} /></span>
            <strong>{importFile ? importFile.name : "Choose an Excel or CSV file"}</strong>
            <span>{importFile ? "Ready to import" : "or drag it here - max one batch per file"}</span>
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={launchNow} onChange={(event) => setLaunchNow(event.target.checked)} />
            <span>
              <strong>Launch automation now</strong> - create role tasks, meeting links and send the first
              task + meeting email to every candidate.
            </span>
          </label>

          {importResult && (
            <div className="import-result">
              <div className="import-summary">
                <span className="badge badge-green">{importResult.created_count} created</span>
                <span className="badge badge-slate">{importResult.skipped_count} skipped</span>
                <span className="badge badge-red">{importResult.error_count} errors</span>
              </div>
              {importResult.created.length > 0 && (
                <div className="import-list">
                  <strong>Temporary credentials</strong>
                  {importResult.created.map((item) => (
                    <div key={item.intern_id} className="import-list-row">
                      <span>{item.name} · {item.email}</span>
                      <code>{item.temporary_password}</code>
                    </div>
                  ))}
                </div>
              )}
              {importResult.automation?.requested && (
                <div className="import-list">
                  <strong>Automation started</strong>
                  <div className="import-summary">
                    <span className="badge badge-green">{importResult.automation.launched} launched</span>
                    <span className="badge badge-slate">{importResult.automation.skipped} skipped</span>
                    <span className="badge badge-red">{importResult.automation.failed} failed</span>
                  </div>
                  {importResult.automation.results
                    .filter((item) => item.status === "launched")
                    .map((item) => (
                      <div key={`${item.name}-${item.task}`} className="import-list-row">
                        <span>{item.name} - {item.task}</span>
                        {item.join_url && (
                          <a href={item.join_url} target="_blank" rel="noreferrer">
                            Meeting link
                          </a>
                        )}
                      </div>
                    ))}
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="import-errors">
                  {importResult.errors.map((item) => (
                    <div key={`${item.row}-${item.error}`}>Row {item.row}: {item.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        title="Delete intern"
        subtitle="This removes the account and every related record."
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <span className="spinner spinner-light" /> : <Icon name="trash" size={16} />}
              {deleting ? "Deleting..." : "Delete permanently"}
            </button>
          </>
        }
      >
        <div className="callout callout-danger">
          <span className="callout-icon"><Icon name="alert" size={17} /></span>
          <div>
            <strong>{deleteTarget?.name} ({deleteTarget?.email})</strong>
            <div className="callout-body">
              Their account, tasks, submissions, evaluations and meetings will be deleted. This cannot be undone.
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
