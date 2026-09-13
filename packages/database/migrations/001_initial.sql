CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  discord_guild_id text UNIQUE,
  owner_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text NOT NULL,
  vision_statement text NOT NULL,
  vision_success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  vision_non_goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  deadline timestamptz NOT NULL,
  timezone text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('STANDARD', 'GAME_JAM')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  github_repository text,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE team_members (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  display_name text NOT NULL,
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  communication_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_tool_profiles jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_user_id)
);

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_owner_member_fk
  FOREIGN KEY (owner_member_id) REFERENCES team_members(id) ON DELETE SET NULL;

CREATE TABLE milestones (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED')),
  completion_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES milestones(id) ON DELETE SET NULL,
  owner_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'IMPLEMENTED', 'VERIFIED', 'INTEGRATED', 'SHIPPED', 'CANCELLED')),
  impact text NOT NULL DEFAULT 'MEDIUM' CHECK (impact IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  weight numeric(10, 3) NOT NULL DEFAULT 1 CHECK (weight > 0),
  estimated_effort_hours numeric(10, 2) NOT NULL DEFAULT 1 CHECK (estimated_effort_hours >= 0),
  due_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_dependencies (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE task_evidence (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  uri text,
  summary text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  submitted_by uuid REFERENCES team_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  rationale text NOT NULL,
  outcome text NOT NULL,
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_by uuid REFERENCES team_members(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  signal_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  score numeric(6, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  weight numeric(6, 2) NOT NULL CHECK (weight >= 0),
  evidence text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MITIGATED', 'ACCEPTED', 'CLOSED')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE project_checkpoints (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  implementation_progress numeric(6, 2) NOT NULL,
  integration_progress numeric(6, 2) NOT NULL,
  verification_progress numeric(6, 2) NOT NULL,
  release_readiness numeric(6, 2) NOT NULL,
  overall_risk numeric(6, 2) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integrations (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  external_key text,
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, external_key)
);

CREATE TABLE project_events (
  id uuid PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source text NOT NULL,
  external_key text,
  trust_level text NOT NULL DEFAULT 'trusted_internal' CHECK (trust_level IN ('trusted_internal', 'untrusted_external')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_key, event_type)
);

CREATE TABLE project_memory_entries (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('FACT', 'DECISION', 'CONSTRAINT', 'ARCHITECTURE', 'REQUIREMENT', 'TEAM', 'RISK', 'LESSON')),
  title text NOT NULL,
  content text NOT NULL,
  source_event_id uuid REFERENCES project_events(id) ON DELETE SET NULL,
  confidence numeric(4, 3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

CREATE TABLE github_installations (
  installation_id bigint PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  account_login text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE github_repositories (
  repository_id bigint PRIMARY KEY,
  installation_id bigint NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE github_webhook_events (
  delivery_id text PRIMARY KEY,
  event_name text NOT NULL,
  action text,
  installation_id bigint,
  repository_id bigint,
  repository_full_name text,
  sender_id bigint,
  trust_level text NOT NULL DEFAULT 'untrusted_external',
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token uuid,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_workspace_idx ON projects(workspace_id);
CREATE INDEX team_members_workspace_idx ON team_members(workspace_id);
CREATE INDEX tasks_project_status_idx ON tasks(project_id, status);
CREATE INDEX task_dependencies_dependency_idx ON task_dependencies(depends_on_task_id);
CREATE INDEX project_events_project_time_idx ON project_events(project_id, occurred_at DESC);
CREATE INDEX project_memory_project_category_idx ON project_memory_entries(project_id, category, created_at DESC);
CREATE INDEX github_webhook_pending_idx ON github_webhook_events(status, available_at, received_at);
