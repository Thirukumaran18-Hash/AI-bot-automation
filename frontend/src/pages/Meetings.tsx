import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import {
  Callout,
  EmptyState,
  Modal,
  PageHeader,
  StatusBadge,
} from "../components/ui";
import { useToast } from "../components/Toast";
import type { AssignmentRecord, MeetingRecord } from "../types";
import {
  defaultMeetingTime,
  formatDate,
  formatTime,
  relativeTime,
  parseDate,
} from "../utils";

export function Meetings() {
  const { user } = useAuth();
  const toast = useToast();
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"upcoming" | "past" | "all">("upcoming");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignmentId, setAssignmentId] = useState("");
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [start, setStart] = useState(defaultMeetingTime());
  const [duration, setDuration] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<MeetingRecord[]>("/api/meetings");
      setMeetings(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load meetings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canManage = user?.role === "admin" || user?.role === "mentor";

  const loadAssignments = useCallback(async () => {
    if (!canManage) return;
    try {
      const data = await api.get<AssignmentRecord[]>("/api/assignments");
      const available = data.filter((item) => item.status !== "completed");
      setAssignments(available);
      if (available.length && !assignmentId) {
        setAssignmentId(String(available[0].id));
        setTitle(`Review: ${available[0].task_title}`);
      }
    } catch {
      // surfaced when creating a meeting
    }
  }, [canManage, assignmentId]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const now = Date.now();
  const upcoming = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.status !== "cancelled" && (parseDate(meeting.start_time)?.getTime() || 0) >= now)
        .sort((a, b) => (parseDate(a.start_time)?.getTime() || 0) - (parseDate(b.start_time)?.getTime() || 0)),
    [meetings, now],
  );
  const past = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.status === "cancelled" || (parseDate(meeting.start_time)?.getTime() || 0) < now)
        .sort((a, b) => (parseDate(b.start_time)?.getTime() || 0) - (parseDate(a.start_time)?.getTime() || 0)),
    [meetings, now],
  );

  const stats = useMemo(() => {
    const weekAhead = now + 7 * 86400000;
    return {
      upcoming: upcoming.length,
      thisWeek: upcoming.filter((meeting) => (parseDate(meeting.start_time)?.getTime() || 0) <= weekAhead).length,
      completed: meetings.filter((meeting) => meeting.status === "completed").length,
      cancelled: meetings.filter((meeting) => meeting.status === "cancelled").length,
    };
  }, [meetings, upcoming, now]);

  const visible = tab === "upcoming" ? upcoming : tab === "past" ? past : [...upcoming, ...past];

  const grouped = useMemo(() => {
    const map = new Map<string, MeetingRecord[]>();
    visible.forEach((meeting) => {
      const key = formatDate(meeting.start_time);
      const list = map.get(key) || [];
      list.push(meeting);
      map.set(key, list);
    });
    return Array.from(map.entries());
  }, [visible]);

  const selectAssignment = (value: string) => {
    setAssignmentId(value);
    const assignment = assignments.find((item) => String(item.id) === value);
    if (assignment) setTitle(`Review: ${assignment.task_title}`);
  };

  const createMeeting = async () => {
    if (!assignmentId || !title.trim()) return;
    setSaving(true);
    try {
      await api.post("/api/meetings", {
        assignment_id: Number(assignmentId),
        title,
        agenda,
        start_time: new Date(start).toISOString(),
        duration_minutes: Number(duration),
      });
      toast.success("Meeting scheduled and invitations logged.");
      setCreateOpen(false);
      setAgenda("");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not schedule the meeting.");
    } finally {
      setSaving(false);
    }
  };

  const cancelMeeting = async (meeting: MeetingRecord) => {
    if (!window.confirm(`Cancel "${meeting.title}"?`)) return;
    try {
      await api.post(`/api/meetings/${meeting.id}/cancel`);
      toast.success("Meeting cancelled and attendees notified.");
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

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Communication engine"
        title="Meetings"
        description="Review conversations, calendar invitations and automated reminders in one place."
        actions={
          canManage ? (
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} /> Schedule meeting
            </button>
          ) : undefined
        }
      />

      <div className="mini-stats">
        <div><span>Upcoming</span><strong>{stats.upcoming}</strong></div>
        <div><span>Next 7 days</span><strong>{stats.thisWeek}</strong></div>
        <div><span>Completed</span><strong>{stats.completed}</strong></div>
        <div><span>Cancelled</span><strong>{stats.cancelled}</strong></div>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="segmented">
            <button className={tab === "upcoming" ? "active" : ""} onClick={() => setTab("upcoming")} type="button">
              Upcoming <span className="seg-count">{upcoming.length}</span>
            </button>
            <button className={tab === "past" ? "active" : ""} onClick={() => setTab("past")} type="button">
              Past <span className="seg-count">{past.length}</span>
            </button>
            <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")} type="button">
              All
            </button>
          </div>
          <div className="toolbar-group">
            <span className="muted small"><Icon name="calendar" size={14} /> Times shown in your local timezone</span>
            <button className="icon-button" onClick={() => load()} aria-label="Refresh meetings">
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="table-loading"><span className="spinner" /> Loading meetings…</div>
        ) : error ? (
          <EmptyState icon="alert" title="Could not load meetings" message={error} action={<button className="btn btn-primary" onClick={() => load()}>Retry</button>} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={tab === "upcoming" ? "No upcoming meetings" : "No meetings in this view"}
            message={canManage ? "Schedule a review from an assignment to create a calendar event and join link." : "Your mentor will schedule review meetings here."}
            action={canManage ? <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} />Schedule meeting</button> : undefined}
          />
        ) : (
          <div className="meeting-groups">
            {grouped.map(([date, items]) => (
              <div className="meeting-group" key={date}>
                <div className="meeting-group-date">
                  <span>{date}</span>
                  <em>{items.length} meeting{items.length === 1 ? "" : "s"}</em>
                </div>
                <div className="meeting-group-list">
                  {items.map((meeting) => {
                    const meetingDate = parseDate(meeting.start_time);
                    return (
                      <article className={`meeting-row ${meeting.status === "cancelled" ? "meeting-row-cancelled" : ""}`} key={meeting.id}>
                        <div className="meeting-row-time">
                          <strong>{meetingDate ? formatTime(meeting.start_time) : "—"}</strong>
                          <span>{meetingDate ? meetingDate.toLocaleString(undefined, { weekday: "short" }) : ""}</span>
                        </div>
                        <div className="meeting-row-main">
                          <div className="meeting-row-head">
                            <h3>{meeting.title}</h3>
                            <StatusBadge status={meeting.status} />
                          </div>
                          <div className="meeting-row-meta">
                            {meeting.task_title && <span><Icon name="clipboard" size={14} />{meeting.task_title}</span>}
                            {meeting.intern_name && <span><Icon name="users" size={14} />{meeting.intern_name}</span>}
                            {meeting.mentor_name && <span><Icon name="user-check" size={14} />{meeting.mentor_name}</span>}
                            <span><Icon name="clock" size={14} />{relativeTime(meeting.start_time)}</span>
                          </div>
                          {meeting.agenda && <p className="meeting-row-agenda">{meeting.agenda}</p>}
                          <div className="meeting-row-actions">
                            {meeting.join_url && meeting.status === "scheduled" && (
                              <a className="btn btn-secondary btn-sm" href={meeting.join_url} target="_blank" rel="noreferrer">
                                <Icon name="external" size={14} /> Join meeting
                              </a>
                            )}
                            <button className="btn btn-ghost btn-sm" onClick={() => downloadIcs(meeting)}>
                              <Icon name="download" size={14} /> Calendar (.ics)
                            </button>
                            {canManage && meeting.status === "scheduled" && (
                              <button className="btn btn-ghost btn-sm" onClick={() => cancelMeeting(meeting)}>
                                <Icon name="x" size={14} /> Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Schedule a review meeting"
        subtitle="Create the event, notify attendees and move the assignment into review."
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={createMeeting} disabled={saving || !assignmentId || !title.trim()}>
              {saving ? <span className="spinner spinner-light" /> : <Icon name="calendar" size={16} />}
              {saving ? "Scheduling…" : "Schedule meeting"}
            </button>
          </>
        }
      >
        <div className="form-stack">
          {assignments.length === 0 ? (
            <Callout tone="warn" icon="alert" title="No assignments available">
              Create an assignment first, then schedule its review meeting here.
            </Callout>
          ) : (
            <>
              <label className="field">
                <span>Assignment</span>
                <select value={assignmentId} onChange={(event) => selectAssignment(event.target.value)}>
                  {assignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>
                      {assignment.intern_name} · {assignment.task_title} · {assignment.status.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Meeting title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>Start time</span>
                  <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
                </label>
                <label className="field">
                  <span>Duration</span>
                  <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
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
                  value={agenda}
                  onChange={(event) => setAgenda(event.target.value)}
                  rows={3}
                  placeholder="Walk through the submission, discuss the rubric feedback and agree next steps."
                />
              </label>
              <Callout tone="info" icon="mail" title="What happens next">
                InternFlow generates a join link and ICS file, emails the intern and mentor, and records a
                workflow event. Duplicate event creation is prevented with a stored provider event ID.
              </Callout>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
