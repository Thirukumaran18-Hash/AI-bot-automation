export type Role = "admin" | "mentor" | "intern";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  intern_id?: number | null;
  batch?: string | null;
  domain?: string | null;
  mentor_name?: string | null;
  created_at?: string;
}

export interface Intern {
  id: number;
  user_id: number;
  name: string;
  email: string;
  batch: string;
  domain: string;
  phone?: string;
  skills: string[];
  mentor_id: number | null;
  mentor_name: string | null;
  active: boolean;
  joined_at: string;
  assignment_count: number;
  completed_count: number;
  overdue_count: number;
  average_score: number | null;
}

export interface InternFacets {
  batches: string[];
  domains: string[];
  mentors: { id: number; name: string; email: string }[];
}

export interface RubricCriterion {
  name: string;
  weight: number;
  description?: string;
}

export interface TestCase {
  name: string;
  detail?: string;
  input?: string;
  expected?: string;
}

export interface TaskRecord {
  id: number;
  title: string;
  description: string;
  domain: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced" | string;
  deliverables: string[];
  acceptance_criteria: string[];
  rubric: RubricCriterion[];
  test_cases: TestCase[];
  deadline_days: number;
  pass_threshold: number;
  status: "draft" | "approved" | string;
  created_by: number | null;
  created_at: string;
  assignment_count: number;
  completed_count: number;
  average_score: number | null;
}

export interface SubmissionRecord {
  id: number;
  assignment_id: number;
  version: number;
  file_name: string | null;
  file_size: number | null;
  has_file: boolean;
  repo_url: string | null;
  notes: string | null;
  submitted_at: string;
  download_url: string | null;
  evaluations?: EvaluationRecord[];
  assignment_status?: string;
  task_title?: string;
  intern_name?: string;
  intern_email?: string;
  evaluation?: EvaluationRecord | null;
}

export interface ScoreItem {
  criterion: string;
  weight: number;
  description?: string;
  score: number;
  evidence?: string;
  issue?: string | null;
  suggestion?: string | null;
  confidence?: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface EvaluationRecord {
  id: number;
  submission_id: number;
  scores: ScoreItem[];
  test_results: TestResult[];
  total_score: number;
  confidence: number;
  outcome: string;
  final_outcome: string | null;
  summary: string;
  feedback: ScoreItem[];
  engine: string;
  reviewer: AuthUser | null;
  override_reason: string | null;
  created_at: string;
  decided_at: string | null;
  assignment_id?: number;
  task_title?: string;
  intern_name?: string;
  assignment_status?: string;
}

export interface AssignmentRecord {
  id: number;
  task_id: number;
  task_title: string;
  task_description: string;
  task_domain: string;
  task_difficulty: string;
  deliverables: string[];
  acceptance_criteria: string[];
  rubric: RubricCriterion[];
  pass_threshold: number;
  intern_id: number;
  intern_name: string;
  intern_email: string;
  intern_domain: string;
  mentor_id: number | null;
  mentor_name: string | null;
  due_date: string;
  status: string;
  assigned_by: number | null;
  created_at: string;
  updated_at: string;
  overdue: boolean;
  submission_count: number;
  latest_submission: SubmissionRecord | null;
  latest_evaluation: EvaluationRecord | null;
  meeting_count: number;
  submissions?: SubmissionRecord[];
  meetings?: MeetingRecord[];
}

export interface MeetingRecord {
  id: number;
  assignment_id: number | null;
  title: string;
  agenda: string;
  start_time: string;
  end_time: string;
  join_url: string;
  provider_event_id: string;
  status: string;
  created_by: number | null;
  created_at: string;
  intern_name: string | null;
  intern_email: string | null;
  mentor_name: string | null;
  mentor_email: string | null;
  task_title: string | null;
  ics_url: string;
}

export interface EmailRecord {
  id: number;
  recipient: string;
  template: string;
  subject: string;
  body: string;
  entity_type: string | null;
  entity_id: number | null;
  status: string;
  retry_count: number;
  created_at: string;
}

export interface WorkflowEvent {
  id: number;
  entity_type: string;
  entity_id: number;
  previous_status: string | null;
  new_status: string | null;
  actor_id: number | null;
  actor_name: string;
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface DashboardData {
  role: Role;
  generated_at: string;
  deadline: string;
  cards: {
    interns: number;
    active_interns: number;
    tasks: number;
    assignments: number;
    submissions: number;
    pending_reviews: number;
    overdue: number;
    completed: number;
    approval_rate: number;
    avg_score: number | null;
    avg_confidence: number | null;
    avg_evaluation_minutes: number | null;
    emails: number;
    email_failures: number;
    upcoming_meetings: number;
  };
  status_breakdown: { status: string; count: number }[];
  domain_breakdown: { domain: string; count: number }[];
  score_distribution: { bucket: string; count: number }[];
  upcoming_meetings: MeetingRecord[];
  next_meeting: MeetingRecord | null;
  pending_reviews: AssignmentRecord[];
  recent_events: WorkflowEvent[];
  my_tasks: AssignmentRecord[];
  mentor_workload: {
    mentor: string;
    interns: number;
    open_assignments: number;
    pending_reviews: number;
  }[];
  email_stats: {
    total: number;
    sent: number;
    logged: number;
    failed: number;
    last_7_days?: number;
    mode: string;
  };
  ai_stats: {
    evaluations: number;
    engines: Record<string, number>;
    outcomes: Record<string, number>;
    human_review_rate: number;
  };
}

export interface IntegrationsInfo {
  smtp: { configured: boolean; host: string | null; mode: string };
  ai: { provider: string; configured: boolean; model: string; mode: string };
  calendar: { configured: boolean; mode: string; timezone: string };
  scheduler: { enabled: boolean; interval_minutes: number };
  uploads: { max_upload_mb: number; storage: string };
}
