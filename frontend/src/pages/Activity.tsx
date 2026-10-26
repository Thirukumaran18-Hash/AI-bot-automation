import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon, type IconName } from "../components/Icon";
import { EmptyState, Modal, PageHeader, StatusBadge } from "../components/ui";
import { useToast } from "../components/Toast";
import type { EmailRecord, IntegrationsInfo, WorkflowEvent } from "../types";
import { formatDateTime, relativeTime, statusTone, titleCase } from "../utils";

interface EmailStats {
  total: number;
  sent: number;
  logged: number;
  failed: number;
  mode: string;
}

const EVENT_ICONS: Record<string, IconName> = {
  assignment: "layers",
  submission: "upload",
  evaluation: "sparkles",
  meeting: "calendar",
  intern: "users",
  task: "clipboard",
  email: "mail",
};

function eventIcon(event: WorkflowEvent): IconName {
  return EVENT_ICONS[event.entity_type] || "activity";
}

export function Activity() {
  const { user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"events" | "emails">("events");
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [emailStatus, setEmailStatus] = useState("all");
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const [eventData, emailData, statData] = await Promise.all([
        api.get<WorkflowEvent[]>("/api/activity/events?limit=150"),
        api.get<EmailRecord[]>("/api/activity/emails?limit=150"),
        api.get<EmailStats>("/api/activity/email-stats"),
      ]);
      setEvents(eventData);
      setEmails(emailData);
      setStats(statData);
      setError(null);
      if (user?.role === "admin") {
        try {
          setIntegrations(await api.get<IntegrationsInfo>("/api/activity/integrations"));
        } catch {
          setIntegrations(null);
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  const entityTypes = useMemo(
    () => Array.from(new Set(events.map((event) => event.entity_type))).sort(),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (entityType !== "all" && event.entity_type !== entityType) return false;
      if (!query) return true;
      return (
        event.action.toLowerCase().includes(query) ||
        event.actor_name.toLowerCase().includes(query) ||
        event.entity_type.toLowerCase().includes(query) ||
        String(event.entity_id).includes(query) ||
        (event.new_status || "").toLowerCase().includes(query)
      );
    });
  }, [events, entityType, search]);

  const filteredEmails = useMemo(() => {
    const query = search.trim().toLowerCase();
    return emails.filter((email) => {
      if (emailStatus !== "all" && email.status !== emailStatus) return false;
      if (!query) return true;
      return (
        email.subject.toLowerCase().includes(query) ||
        email.recipient.toLowerCase().includes(query) ||
        email.template.toLowerCase().includes(query)
      );
    });
  }, [emails, emailStatus, search]);

  const groupedEvents = useMemo(() => {
    const map = new Map<string, WorkflowEvent[]>();
    filteredEvents.forEach((event) => {
      const key = formatDateTime(event.created_at).split(",")[0];
      const list = map.get(key) || [];
      list.push(event);
      map.set(key, list);
    });
    return Array.from(map.entries());
  }, [filteredEvents]);

  const emailMode = stats?.mode === "smtp";
  const failing = Boolean(stats?.failed);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Automation ledger"
        title="Activity & email"
        description="Every workflow transition, notification and provider mode in one auditable stream."
        actions={
          <button className="btn btn-ghost" onClick={() => load()}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
        }
      />

      <div className="mini-stats">
        <div><span>Workflow events</span><strong>{stats ? events.length : "—"}</strong></div>
        <div><span>Emails total</span><strong>{stats?.total ?? "—"}</strong></div>
        <div><span>Delivered</span><strong>{stats ? stats.sent + stats.logged : "—"}</strong></div>
        <div><span>Failed</span><strong className={failing ? "text-danger" : ""}>{stats?.failed ?? "—"}</strong></div>
      </div>

      {integrations && (
        <div className="integration-grid">
          <div className="integration-card">
            <span className="integration-icon tone-soft-green"><Icon name="mail" size={18} /></span>
            <div>
              <span>Email delivery</span>
              <strong>{integrations.smtp.configured ? "SMTP connected" : "Local log mode"}</strong>
              <em>{integrations.smtp.host || "Messages are stored in the audit log"}</em>
            </div>
          </div>
          <div className="integration-card">
            <span className="integration-icon tone-soft-indigo"><Icon name="cpu" size={18} /></span>
            <div>
              <span>Evaluation engine</span>
              <strong>{integrations.ai.mode}</strong>
              <em>{integrations.ai.model}</em>
            </div>
          </div>
          <div className="integration-card">
            <span className="integration-icon tone-soft-cyan"><Icon name="calendar" size={18} /></span>
            <div>
              <span>Calendar</span>
              <strong>{integrations.calendar.mode}</strong>
              <em>{integrations.calendar.timezone}</em>
            </div>
          </div>
          <div className="integration-card">
            <span className={`integration-icon ${integrations.scheduler.enabled ? "tone-soft-amber" : "tone-soft-slate"}`}>
              <Icon name="clock" size={18} />
            </span>
            <div>
              <span>Reminder scheduler</span>
              <strong>{integrations.scheduler.enabled ? "Running" : "Paused"}</strong>
              <em>Every {integrations.scheduler.interval_minutes} minutes</em>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="segmented">
            <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")} type="button">
              Workflow timeline <span className="seg-count">{events.length}</span>
            </button>
            <button className={tab === "emails" ? "active" : ""} onClick={() => setTab("emails")} type="button">
              Email log <span className="seg-count">{emails.length}</span>
            </button>
          </div>
          <div className="toolbar-group">
            <div className="search-input">
              <Icon name="search" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tab === "events" ? "Search events, actors, statuses…" : "Search subject, recipient, template…"}
              />
            </div>
            {tab === "events" ? (
              <select value={entityType} onChange={(event) => setEntityType(event.target.value)} className="compact-select">
                <option value="all">All entities</option>
                {entityTypes.map((type) => (
                  <option key={type} value={type}>{titleCase(type)}</option>
                ))}
              </select>
            ) : (
              <select value={emailStatus} onChange={(event) => setEmailStatus(event.target.value)} className="compact-select">
                <option value="all">All statuses</option>
                <option value="sent">Sent</option>
                <option value="logged">Logged</option>
                <option value="failed">Failed</option>
              </select>
            )}
          </div>
        </div>

        {loading ? (
          <div className="table-loading"><span className="spinner" /> Loading activity…</div>
        ) : error ? (
          <EmptyState icon="alert" title="Could not load activity" message={error} action={<button className="btn btn-primary" onClick={() => load()}>Retry</button>} />
        ) : tab === "events" ? (
          filteredEvents.length === 0 ? (
            <EmptyState
              icon="activity"
              title="No matching events"
              message={events.length ? "Try clearing the filters or search term." : "Workflow transitions will appear here as work moves forward."}
            />
          ) : (
            <div className="activity-groups">
              {groupedEvents.map(([date, items]) => (
                <div className="activity-group" key={date}>
                  <div className="activity-date">{date}</div>
                  <div className="activity-group-items">
                    {items.map((event) => (
                      <article className="activity-item" key={event.id}>
                        <span className={`activity-icon tone-soft-${statusTone(event.new_status || "assigned")}`}>
                          <Icon name={eventIcon(event)} size={16} />
                        </span>
                        <div className="activity-copy">
                          <div className="activity-title">
                            <strong>{titleCase(event.action.replace(/\./g, " "))}</strong>
                            {event.new_status && <StatusBadge status={event.new_status} />}
                          </div>
                          <p>
                            <span className="entity-tag">{titleCase(event.entity_type)} #{event.entity_id}</span>
                            {event.previous_status && event.new_status && (
                              <span className="status-transition">
                                {titleCase(event.previous_status)} <Icon name="arrow-right" size={12} /> {titleCase(event.new_status)}
                              </span>
                            )}
                          </p>
                          <div className="activity-meta">
                            <span><Icon name="user-check" size={13} />{event.actor_name}</span>
                            <span><Icon name="clock" size={13} />{formatDateTime(event.created_at)}</span>
                            <span>{relativeTime(event.created_at)}</span>
                          </div>
                          {event.meta && Object.keys(event.meta).length > 0 && (
                            <div className="event-meta">
                              {Object.entries(event.meta)
                                .filter(([, value]) => value !== null && value !== undefined && value !== "")
                                .slice(0, 4)
                                .map(([key, value]) => (
                                  <span key={key}>
                                    <em>{titleCase(key)}</em>
                                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filteredEmails.length === 0 ? (
          <EmptyState
            icon="mail"
            title="No matching emails"
            message={emails.length ? "Try changing the status filter or search term." : "Outbound notifications are logged here, even when SMTP is not configured."}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table email-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Recipient</th>
                  <th>Template</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th className="align-right">Preview</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmails.map((email) => (
                  <tr key={email.id}>
                    <td>
                      <button className="link-button" onClick={() => setSelectedEmail(email)}>
                        {email.subject}
                      </button>
                    </td>
                    <td>{email.recipient}</td>
                    <td><span className="template-chip">{titleCase(email.template)}</span></td>
                    <td><StatusBadge status={email.status} /></td>
                    <td>
                      <div className="stacked-cell">
                        <strong>{relativeTime(email.created_at)}</strong>
                        <span>{formatDateTime(email.created_at)}</span>
                      </div>
                    </td>
                    <td className="align-right">
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelectedEmail(email)}>
                        <Icon name="eye" size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {integrations && (
        <section className="card small-card">
          <div className="card-head">
            <div>
              <h2>Delivery configuration</h2>
              <p>Current runtime modes. Switch providers with environment variables and restart the API.</p>
            </div>
            <span className={`badge ${emailMode ? "badge-green" : "badge-amber"}`}>
              <span className="badge-dot" />{emailMode ? "SMTP live" : "Log-only"}
            </span>
          </div>
          <div className="config-list">
            <div><span>Upload limit</span><strong>{integrations.uploads.max_upload_mb} MB</strong></div>
            <div><span>Storage path</span><code>{integrations.uploads.storage}</code></div>
            <div><span>Scheduler</span><strong>{integrations.scheduler.enabled ? `every ${integrations.scheduler.interval_minutes}m` : "disabled"}</strong></div>
            <div><span>AI provider</span><strong>{integrations.ai.provider} · {integrations.ai.configured ? "configured" : "not configured"}</strong></div>
          </div>
        </section>
      )}

      <Modal
        open={Boolean(selectedEmail)}
        onClose={() => setSelectedEmail(null)}
        title={selectedEmail?.subject || "Email preview"}
        subtitle={selectedEmail ? `${selectedEmail.recipient} · ${titleCase(selectedEmail.template)}` : undefined}
        size="lg"
        footer={
          <button className="btn btn-ghost" onClick={() => setSelectedEmail(null)}>Close</button>
        }
      >
        {selectedEmail && (
          <div className="email-preview">
            <div className="email-preview-meta">
              <div><span>To</span><strong>{selectedEmail.recipient}</strong></div>
              <div><span>Status</span><StatusBadge status={selectedEmail.status} /></div>
              <div><span>Created</span><strong>{formatDateTime(selectedEmail.created_at)}</strong></div>
              <div><span>Tries</span><strong>{selectedEmail.retry_count}</strong></div>
            </div>
            <pre className="email-body">{selectedEmail.body}</pre>
            <div className="email-preview-foot">
              <span>Template <strong>{selectedEmail.template}</strong></span>
              {selectedEmail.entity_type && (
                <span>Linked to <strong>{selectedEmail.entity_type} #{selectedEmail.entity_id}</strong></span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(selectedEmail.body).then(
                    () => toast.success("Email body copied."),
                    () => toast.error("Clipboard is not available."),
                  );
                }}
              >
                <Icon name="file" size={14} /> Copy body
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
