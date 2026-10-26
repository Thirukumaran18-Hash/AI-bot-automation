import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ApiError } from "../api";
import { Icon, LogoMark } from "../components/Icon";

const DEMO_ACCOUNTS = [
  {
    role: "Administrator",
    email: "admin@internflow.ai",
    password: "Admin@123",
    note: "Batches, tasks, policies and reports",
    tone: "indigo",
  },
  {
    role: "Mentor",
    email: "mentor@internflow.ai",
    password: "Mentor@123",
    note: "Review queue and mentee progress",
    tone: "emerald",
  },
  {
    role: "Intern",
    email: "arun@internflow.ai",
    password: "Intern@123",
    note: "Tasks, submissions and feedback",
    tone: "amber",
  },
];

export function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("admin@internflow.ai");
  const [password, setPassword] = useState("Admin@123");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Sign in · InternFlow AI";
  }, []);

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const fillAccount = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-hero-glow login-hero-glow-one" />
        <div className="login-hero-glow login-hero-glow-two" />
        <div className="login-brand">
          <LogoMark size={42} />
          <div>
            <strong>InternFlow AI</strong>
            <span>Autonomous internship management</span>
          </div>
        </div>

        <div className="login-hero-copy">
          <span className="login-pill">
            <span className="pulse-dot" />
            Human-in-the-loop automation
          </span>
          <h1>Run internships at scale without losing the human touch.</h1>
          <p>
            Import interns, assign structured tasks, evaluate submissions against approved rubrics,
            send evidence-based feedback and coordinate review meetings — from one workspace.
          </p>
        </div>

        <div className="login-features">
          <div className="login-feature">
            <span className="login-feature-icon"><Icon name="user-check" size={19} /></span>
            <div><strong>Onboarding & assignment</strong><span>CSV import, domain rules and due dates</span></div>
          </div>
          <div className="login-feature">
            <span className="login-feature-icon"><Icon name="sparkles" size={19} /></span>
            <div><strong>Rubric-first AI evaluation</strong><span>Deterministic checks plus explainable scoring</span></div>
          </div>
          <div className="login-feature">
            <span className="login-feature-icon"><Icon name="calendar" size={19} /></span>
            <div><strong>Email & meeting automation</strong><span>Reminders, feedback and calendar invites</span></div>
          </div>
        </div>

        <div className="login-metric-row">
          <div className="login-metric">
            <strong>6</strong>
            <span>demo interns</span>
          </div>
          <div className="login-metric">
            <strong>3</strong>
            <span>live workflows</span>
          </div>
          <div className="login-metric">
            <strong>100%</strong>
            <span>audit trail</span>
          </div>
        </div>

        <div className="login-floating-card login-floating-card-a">
          <span className="mini-label">Evaluation complete</span>
          <strong>Python Login Validation</strong>
          <div className="mini-row">
            <span className="mini-score">88</span>
            <span className="mini-caption">weighted rubric</span>
            <span className="badge badge-green"><span className="badge-dot" />Approved</span>
          </div>
        </div>
        <div className="login-floating-card login-floating-card-b">
          <span className="mini-label">Next review</span>
          <strong>Divya Nair · 30 min</strong>
          <div className="mini-row">
            <span className="mini-caption">Join link ready</span>
            <span className="badge badge-indigo"><span className="badge-dot" />Scheduled</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-form-head">
            <div className="eyebrow">Welcome back</div>
            <h2>Sign in to your workspace</h2>
            <p>Use a demo account below or your assigned InternFlow credentials.</p>
          </div>

          <form onSubmit={submit} className="login-form">
            <label className="field">
              <span>Email address</span>
              <div className="input-with-icon">
                <Icon name="mail" size={17} />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </div>
            </label>

            <label className="field">
              <span>Password</span>
              <div className="input-with-icon">
                <Icon name="shield" size={17} />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  className="input-icon-button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <Icon name="eye" size={17} />
                </button>
              </div>
            </label>

            {error && (
              <div className="login-error">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting}>
              {submitting ? <span className="spinner spinner-light" /> : <Icon name="arrow-right" size={18} />}
              {submitting ? "Signing in…" : "Sign in to InternFlow"}
            </button>
          </form>

          <div className="demo-divider"><span>Quick demo access</span></div>

          <div className="demo-accounts">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.role}
                type="button"
                className="demo-account"
                onClick={() => fillAccount(account)}
              >
                <span className={`demo-role demo-role-${account.tone}`}>{account.role}</span>
                <span className="demo-details">
                  <strong>{account.email}</strong>
                  <span>{account.note}</span>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
          </div>

          <div className="login-footnote">
            <Icon name="database" size={14} />
            <span>Demo data is seeded automatically. Emails are logged locally unless SMTP is configured.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
