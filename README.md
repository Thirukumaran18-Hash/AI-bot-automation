# InternFlow AI

InternFlow AI is a full-stack internship operations workspace built from the project proposal in
`InternFlow_AI_Project_Proposal.docx`. It covers onboarding, structured tasks, assignment tracking,
rubric-based submission evaluation, human review, feedback emails, meeting coordination, reminders and
an auditable activity trail.

The app is designed to run locally with no external services. Email is logged when SMTP is not configured,
meetings use generated join links with downloadable ICS files, and AI evaluation runs with a deterministic
rubric engine unless an OpenAI-compatible provider is configured.

## Highlights

- Role-aware workspace for administrators, mentors and interns.
- Built-in **InternFlow Assistant** chatbot with live, role-scoped answers about tasks, meetings,
  candidates, reviews and email activity (rule-based offline, optional LLM via the same AI settings).
- Intern onboarding with a single form, CSV import and generated temporary credentials.
- Task library with AI drafting, deliverables, acceptance criteria, rubric weights and test prompts.
- Manual or rule-based task assignment, due dates, reminders and overdue detection.
- Versioned submissions with file upload, repository links and submission notes.
- Explainable evaluation: weighted rubric scores, evidence, issues, suggestions and test results.
- Automatic routing to approval, revision or human review based on confidence and pass thresholds.
- Reviewer queue with decision rationale and a complete audit record.
- Meeting scheduling with join links, email invitations, ICS calendar exports and cancellation.
- Dashboard for programme health, evaluation quality, workload, domain mix and email status.
- Email and workflow activity ledger with provider configuration details.

## Fully automated Excel -> task -> meeting -> feedback pipeline

The coordinator only supplies one Excel sheet. The bot does the rest.

1. Excel columns: `name, email, phone, role` (optional `batch, skills, mentor_email, password`).
   `.xlsx`, `.xlsm` and UTF-8 `.csv` are all accepted. A ready sample is in `sample_candidates.xlsx`.
2. Open **Interns -> Import Excel** and keep **Launch automation now** checked. Or import first and press
   **Run automation** to kick off every active candidate.
3. For each candidate the bot creates an account, builds a three-stage task ladder for their role,
   generates a real Jitsi meeting link, and emails the sign-in credentials, task brief, deadline,
   acceptance criteria and meeting link.
4. The candidate joins the meeting, signs in to the portal and submits a file, repository link or notes.
5. The rubric engine scores the submission immediately:
   - **Pass** -> "Approved" email, then the next task + a new meeting link are sent automatically.
   - **Fail** -> an email listing the exact mistakes and suggestions plus a rework meeting link.
   - **Last task passed** -> a program-completion email is sent.
6. Every email, meeting and status change is recorded under **Activity** and **Meetings**. No manual
   task assignment or meeting scheduling is needed.

The meeting links are real and joinable with no API key because they use a public Jitsi host
(`MEETING_BASE_URL=https://meet.jit.si`). Any public Jitsi deployment can be used instead.

### Enable real email delivery

Without SMTP the app runs in log-only mode: every message is still rendered, stored and visible in
**Activity**, but nothing leaves the machine. To send real mail, copy `backend/.env.example` to
`backend/.env` and set:

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.address@gmail.com
SMTP_PASSWORD=your-16-character-google-app-password
SMTP_FROM=your.address@gmail.com
SMTP_TLS=true
```

Use a Google App Password (not the normal account password). Any SMTP provider works the same way.
The AI reviewer works offline by default; set `AI_PROVIDER=openai` plus `OPENAI_API_KEY` to use an
OpenAI-compatible model for the analysis instead.

### Built-in chatbot

A floating **Ask AI** button appears on every signed-in page. The assistant is scoped to the signed-in
role and answers from live data, for example:

- `Give me a status summary`, `Show upcoming meetings`, `Pending reviews`, `Which candidates are overdue?`
- `Tell me about <candidate name>`, `How do I import candidates?`
- Interns can ask `What are my open tasks?`, `When is my next meeting?`, `How do I submit my work?`

The rule-based engine works with no API key. Set `AI_PROVIDER=openai` and `OPENAI_API_KEY` to have
unmatched questions answered by an OpenAI-compatible chat model using the same live workspace context.
Endpoints: `POST /api/chatbot/message` and `GET /api/chatbot/suggestions`.

### 2-minute interview demo

1. Run `.\start.ps1`, open http://127.0.0.1:8000 and sign in as `admin@internflow.ai / Admin@123`.
2. **Interns -> Import Excel -> sample_candidates.xlsx**, leave **Launch automation now** on.
3. Show the generated task, meeting link and credentials in the import result.
4. Show **Meeting** / **Activity** to prove the task + meeting emails were sent automatically.
5. Sign in as the new candidate with the temporary password, submit the task, and show the automatic
   pass/fail email plus the next task and new meeting link.
6. Click **Ask AI** and ask `Give me a status summary` or `Show upcoming meetings` to demonstrate the
   live role-aware chatbot.

## Stack

| Layer | Technology |
| --- | --- |
| Backend | FastAPI, SQLAlchemy 2, Pydantic 2, SQLite (default) |
| Auth | JWT bearer tokens, PBKDF2 password hashing |
| Automation | APScheduler for deadlines, reminders and escalations |
| AI evaluation | Deterministic heuristic engine; optional OpenAI-compatible chat completions |
| Email | SMTP when configured, otherwise durable local email log |
| Calendar | ICS generation and real Jitsi meeting join links |
| Frontend | React 18, TypeScript, Vite, React Router |
| Styling | Hand-written responsive CSS, custom SVG icon set |

## Requirements

- Python 3.11 or newer
- Node.js 18 or newer and npm
- Windows PowerShell, macOS or Linux shell

The repository already includes a virtual environment at `.venv` with backend dependencies installed.
On another machine, create and install it again:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

## Quick start

From the project root:

```powershell
.\start.ps1
```

The script builds the frontend if `frontend\dist\index.html` is missing, then starts the API. Open:

- Application: http://127.0.0.1:8000
- API docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/api/health

`start.ps1 -Rebuild` forces a fresh frontend build. `start.ps1 -Dev` starts the API and Vite in separate
PowerShell windows for development. If script execution is blocked by policy, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

### Manual development start

Terminal 1, backend:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Terminal 2, frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the backend on port 8000.

### Manual production-style start

```powershell
cd frontend
npm install
npm run build
cd ..\backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

FastAPI serves the built single-page app from `frontend/dist`, including client-side routes.

## Demo accounts

The database is seeded automatically on startup when `SEED_DEMO_DATA=true`.

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@internflow.ai` | `Admin@123` |
| Mentor | `mentor@internflow.ai` | `Mentor@123` |
| Mentor | `suresh@internflow.ai` | `Mentor@123` |
| Intern | `arun@internflow.ai` | `Intern@123` |
| Intern | `divya@internflow.ai` | `Intern@123` |
| Intern | `karthik@internflow.ai` | `Intern@123` |
| Intern | `priya@internflow.ai` | `Intern@123` |
| Intern | `vikram@internflow.ai` | `Intern@123` |
| Intern | `sneha@internflow.ai` | `Intern@123` |

Data is stored in `backend/internflow.db`. Delete that file to reset the workspace; it will be recreated and
seeded on the next backend start.

## Suggested walkthrough

1. Sign in as the administrator and open **Interns** to review the cohort or import a CSV.
2. Open **Tasks**, create a task, or use **Draft with AI** to generate the brief and rubric.
3. Assign the task from the task card or the **Assignments** page.
4. Sign in as an intern, open the task, attach a file or repository link and submit.
5. The rubric engine evaluates immediately and routes the result to approved, revision required or human review.
6. Sign in as a mentor or administrator and open **Review queue** for borderline cases.
7. Schedule a review meeting from the assignment or **Meetings** page and download the ICS file.
8. Use **Activity & email** to inspect workflow transitions, notification bodies and integration modes.

## Project structure

```text
new project/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, SPA serving, lifespan
│   │   ├── config.py            # Environment-driven settings
│   │   ├── models.py            # SQLAlchemy models and workflow statuses
│   │   ├── schemas.py           # Request validation
│   │   ├── seed.py              # Idempotent demo data
│   │   ├── deps.py              # Auth and access-control dependencies
│   │   ├── routers/             # Auth, interns, tasks, assignments, submissions,
│   │   │                        # reviews, meetings, dashboard, activity
│   │   └── services/            # AI engine, evaluator, email, calendar, workflow
│   ├── tests/test_api.py        # Integration tests
│   ├── storage/                 # Uploaded submissions
│   ├── .env.example             # Backend configuration template
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Routes and role gates
│   │   ├── api.ts               # Fetch, upload and download client
│   │   ├── auth.tsx             # Session restoration and login state
│   │   ├── components/          # Layout, UI primitives, icons, toasts
│   │   ├── pages/               # Dashboard, interns, tasks, assignments,
│   │   │                        # detail, reviews, meetings, activity, login
│   │   └── styles.css           # Full responsive design system
│   ├── package.json
│   ├── .env.example
│   └── vite.config.ts
├── start.ps1
└── README.md
```

## Configuration

Copy `backend/.env.example` to `backend/.env` and edit as needed. Settings can also be supplied as
environment variables. Common options:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | SQLite at `backend/internflow.db` | Database connection |
| `JWT_SECRET` | Development secret | Change before any shared deployment |
| `ACCESS_TOKEN_MINUTES` | `720` | Login session lifetime |
| `STORAGE_DIR` | `backend/storage` | Upload destination |
| `MAX_UPLOAD_MB` | `10` | Submission upload limit |
| `PASS_THRESHOLD` | `70` | Default rubric pass mark |
| `CONFIDENCE_THRESHOLD` | `0.55` | Below this, work routes to human review |
| `BORDERLINE_MARGIN` | `8` | Scores this close to the threshold route to review |
| `AI_PROVIDER` | `heuristic` | Use `openai` for an LLM-assisted review |
| `OPENAI_API_KEY` | empty | Required when `AI_PROVIDER=openai` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any compatible endpoint |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | empty | Enable real email delivery |
| `SMTP_FROM` | `no-reply@internflow.local` | Sender address |
| `MEETING_BASE_URL` | `https://meet.jit.si` | Base for real, joinable meeting links |
| `APP_PUBLIC_URL` | `http://127.0.0.1:8000` | Portal URL included in automated emails |
| `AUTOPILOT_LEAD_MINUTES` | `5` | How soon after assignment the briefing meeting starts |
| `AUTOPILOT_MEETING_MINUTES` | `30` | Default meeting duration |
| `AUTOPILOT_DUE_DAYS` | `2` | Deadline used for auto-assigned role tasks |
| `SCHEDULER_ENABLED` | `true` | Deadline and meeting reminder loop |
| `REMINDER_INTERVAL_MINUTES` | `15` | Scheduler interval |
| `SEED_DEMO_DATA` | `true` | Seed demo accounts and workflows |

The AI provider is advisory. Required deliverables, score thresholds, confidence routing and human review
decisions are enforced locally, so the application remains usable without an LLM key.

The frontend supports an optional `VITE_API_URL` when the API is hosted separately. Leave it empty and use
the Vite proxy for local development.

## API overview

All application endpoints are under `/api`:

- `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`
- `GET /dashboard`
- `GET/POST/PATCH /interns`, `POST /interns/import`, `GET /interns/facets`
- `GET/POST /tasks`, `POST /tasks/ai-draft`, `POST /tasks/{id}/approve`, `GET /tasks/facets`
- `GET/POST /assignments`, `POST /assignments/auto`, `POST /assignments/{id}/remind`,
  `POST /assignments/{id}/status`
- `POST /submissions/assignments/{assignment_id}`, `GET /submissions`,
  `GET /submissions/{id}/download`, `POST /submissions/{id}/evaluate`
- `GET /reviews/queue`, `GET /reviews/evaluations`, `GET /reviews/pending-count`,
  `POST /reviews/{evaluation_id}/decision`
- `GET/POST /meetings`, `GET /meetings/{id}/ics`, `POST /meetings/{id}/cancel`
- `GET /activity/events`, `GET /activity/emails`, `GET /activity/email-stats`,
  `GET /activity/integrations`

Interactive documentation with request schemas is available at `/docs`.

## Tests

Run backend integration tests from the backend directory:

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest tests -q
```

Run the frontend type check and production build:

```powershell
cd frontend
npm run typecheck
npm run build
```

The test suite uses a temporary SQLite database and storage directory, disables the scheduler, and verifies
authentication, role permissions, seeded dashboards, task drafting, assignment creation, submission upload,
heuristic evaluation, reviewer decisions, downloads, meeting ICS files, cancellation and CSV onboarding.

## Operational notes

- Uploaded files are stored under `backend/storage/submissions/<assignment_id>/`.
- Email delivery is recorded even when SMTP is absent, so notifications remain inspectable.
- Meeting links are deterministic local links; ICS files work with standard calendar applications.
- SQLite and the development JWT secret are appropriate for local evaluation. For shared deployment, use a
  managed database, a strong secret, HTTPS, and a real identity/password policy.
- The scheduler runs in the API process. With multiple API workers, run the scheduler once separately or
  disable it on extra workers.
