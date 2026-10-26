import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
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
import type { AssignmentRecord, EvaluationRecord } from "../types";
import { formatDateTime, statusTone } from "../utils";

export function Reviews() {
  const toast = useToast();
  const [queue, setQueue] = useState<AssignmentRecord[]>([]);
  const [history, setHistory] = useState<EvaluationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AssignmentRecord | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [queueData, historyData] = await Promise.all([
        api.get<AssignmentRecord[]>("/api/reviews/queue"),
        api.get<EvaluationRecord[]>("/api/reviews/evaluations"),
      ]);
      setQueue(queueData);
      setHistory(historyData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the review queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const decided = history.filter((item) => item.final_outcome);
    const avg = history.length
      ? Math.round(history.reduce((sum, item) => sum + item.total_score, 0) / history.length)
      : null;
    const accepted = decided.filter((item) => item.final_outcome === "approved").length;
    return {
      pending: queue.length,
      decisions: decided.length,
      acceptance: decided.length ? Math.round((accepted / decided.length) * 100) : null,
      avg,
    };
  }, [queue, history]);

  const decide = async (outcome: "approved" | "revision_required") => {
    if (!selected?.latest_evaluation) return;
    setBusy(true);
    try {
      await api.post(`/api/reviews/${selected.latest_evaluation.id}/decision`, {
        outcome,
        reason: reason || undefined,
      });
      toast.success(outcome === "approved" ? "Submission approved. The intern was notified." : "Revision requested. The intern was notified.");
      setSelected(null);
      setReason("");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  };

  const selectedEvaluation = selected?.latest_evaluation || null;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Human oversight"
        title="Review queue"
        description="AI scores are advisory. Resolve borderline cases, inspect evidence and own the final outcome."
        actions={
          <button className="btn btn-ghost" onClick={() => load()}>
            <Icon name="refresh" size={16} /> Refresh queue
          </button>
        }
      />

      <div className="mini-stats">
        <div><span>Awaiting review</span><strong>{stats.pending}</strong></div>
        <div><span>Decisions recorded</span><strong>{stats.decisions}</strong></div>
        <div><span>Agreement rate</span><strong>{stats.acceptance !== null ? `${stats.acceptance}%` : "—"}</strong></div>
        <div><span>Average AI score</span><strong>{stats.avg ?? "—"}</strong></div>
      </div>

      {loading ? (
        <div className="table-loading card"><span className="spinner" /> Loading review queue…</div>
      ) : error ? (
        <EmptyState icon="alert" title="Could not load reviews" message={error} action={<button className="btn btn-primary" onClick={() => load()}>Retry</button>} />
      ) : (
        <>
          <section className="review-queue">
            <div className="section-heading">
              <div>
                <h2>Needs a human decision</h2>
                <p>Evaluations routed here because confidence was low or the score was close to the threshold.</p>
              </div>
              <span className="badge badge-purple">{queue.length} open</span>
            </div>

            {queue.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon="shield"
                  title="The queue is clear"
                  message="New borderline evaluations will appear here automatically. Everything else has been decided."
                />
              </div>
            ) : (
              <div className="review-card-grid">
                {queue.map((assignment) => {
                  const evaluation = assignment.latest_evaluation;
                  const passedTests = evaluation?.test_results.filter((test) => test.passed).length || 0;
                  const totalTests = evaluation?.test_results.length || 0;
                  return (
                    <article className="review-card" key={assignment.id}>
                      <div className="review-card-head">
                        <div className="person-cell">
                          <Avatar name={assignment.intern_name} size={42} />
                          <div>
                            <strong>{assignment.intern_name}</strong>
                            <span>{assignment.task_title}</span>
                          </div>
                        </div>
                        <StatusBadge status={assignment.status} />
                      </div>
                      <div className="review-card-body">
                        <ScoreRing score={evaluation?.total_score ?? null} size={76} />
                        <div className="review-card-metrics">
                          <div><span>Confidence</span><strong>{evaluation ? `${Math.round(evaluation.confidence * 100)}%` : "—"}</strong></div>
                          <div><span>Checks passed</span><strong>{passedTests}/{totalTests}</strong></div>
                          <div><span>Mentor</span><strong>{assignment.mentor_name || "Unassigned"}</strong></div>
                          <div><span>Due</span><strong>{formatDateTime(assignment.due_date)}</strong></div>
                        </div>
                      </div>
                      <p className="review-card-summary">{evaluation?.summary || "No evaluation summary available."}</p>
                      <div className="review-card-footer">
                        <Link className="btn btn-ghost btn-sm" to={`/assignments/${assignment.id}`}>
                          Inspect evidence
                        </Link>
                        <button className="btn btn-primary btn-sm" onClick={() => { setSelected(assignment); setReason(""); }}>
                          <Icon name="check-circle" size={14} /> Decide
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Evaluation history</h2><p>Every automated and human-reviewed result, newest first.</p></div>
              <span className="badge badge-slate">{history.length} records</span>
            </div>
            {history.length === 0 ? (
              <EmptyState title="No evaluations yet" message="Evaluation results will appear here after the first submission." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Intern</th>
                      <th>Task</th>
                      <th>Score</th>
                      <th>Confidence</th>
                      <th>AI outcome</th>
                      <th>Final outcome</th>
                      <th>Reviewer</th>
                      <th>When</th>
                      <th className="align-right">Assignment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((evaluation) => (
                      <tr key={evaluation.id}>
                        <td>{evaluation.intern_name}</td>
                        <td>
                          <div className="stacked-cell">
                            <strong>{evaluation.task_title}</strong>
                            <span>{evaluation.engine}</span>
                          </div>
                        </td>
                        <td>
                          <span className={evaluation.total_score < 70 ? "score-text score-low" : "score-text"}>
                            {evaluation.total_score}
                          </span>
                        </td>
                        <td>{Math.round(evaluation.confidence * 100)}%</td>
                        <td><StatusBadge status={evaluation.outcome} /></td>
                        <td>
                          {evaluation.final_outcome ? (
                            <StatusBadge status={evaluation.final_outcome} />
                          ) : (
                            <span className="muted">Pending</span>
                          )}
                        </td>
                        <td>{evaluation.reviewer?.name || <span className="muted">Automated</span>}</td>
                        <td>{formatDateTime(evaluation.created_at)}</td>
                        <td className="align-right">
                          <Link className="btn btn-ghost btn-sm" to={`/assignments/${evaluation.assignment_id}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Record a final decision"
        subtitle={selected ? `${selected.intern_name} · ${selected.task_title}` : undefined}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
            <button className="btn btn-secondary" onClick={() => decide("revision_required")} disabled={busy}>
              <Icon name="refresh" size={15} /> Request revision
            </button>
            <button className="btn btn-primary" onClick={() => decide("approved")} disabled={busy}>
              {busy ? <span className="spinner spinner-light" /> : <Icon name="check" size={15} />}
              Approve outcome
            </button>
          </>
        }
      >
        {selected && selectedEvaluation && (
          <div className="form-stack">
            <div className="decision-summary">
              <ScoreRing score={selectedEvaluation.total_score} size={80} />
              <div>
                <StatusBadge status={selectedEvaluation.outcome} />
                <p>{selectedEvaluation.summary}</p>
                <div className="decision-facts">
                  <span>Confidence {Math.round(selectedEvaluation.confidence * 100)}%</span>
                  <span>{selectedEvaluation.test_results.filter((test) => test.passed).length}/{selectedEvaluation.test_results.length} checks passed</span>
                  <span className={`tone-text-${statusTone(selectedEvaluation.outcome)}`}>AI: {selectedEvaluation.outcome.replace(/_/g, " ")}</span>
                </div>
              </div>
            </div>
            <div className="feedback-list compact">
              {selectedEvaluation.scores.map((item) => (
                <div className="feedback-row" key={item.criterion}>
                  <div className="feedback-head">
                    <div><strong>{item.criterion}</strong><span>{Math.round(item.weight)}% weight</span></div>
                    <span className="feedback-score">{Math.round(item.score)}<em>/100</em></span>
                  </div>
                  <div className="feedback-bar"><span className="tone-bg-indigo" style={{ width: `${item.score}%` }} /></div>
                  {item.issue && <span className="feedback-issue"><Icon name="alert" size={13} />{item.issue}</span>}
                </div>
              ))}
            </div>
            <label className="field">
              <span>Reviewer rationale <em>recorded in the audit trail</em></span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                placeholder="Explain the decision so the intern receives actionable, consistent feedback…"
              />
            </label>
            <Link className="link-inline" to={`/assignments/${selected.id}`} onClick={() => setSelected(null)}>
              <Icon name="external" size={14} /> Open the full assignment and submission evidence
            </Link>
          </div>
        )}
      </Modal>
    </div>
  );
}
