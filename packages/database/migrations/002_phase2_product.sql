ALTER TABLE projects
  ADD COLUMN vision_details jsonb NOT NULL DEFAULT '{"problem":"","targetOutcome":"","coreExperience":"","mustHaveScope":[],"shouldHaveScope":[],"niceToHaveScope":[],"excludedScope":[]}'::jsonb;

ALTER TABLE tasks
  ADD COLUMN expected_outcome text NOT NULL DEFAULT '',
  ADD COLUMN owner_role text,
  ADD COLUMN risk_level text NOT NULL DEFAULT 'MEDIUM' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD COLUMN verification_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN suggested_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN component text,
  ADD COLUMN deadline_criticality text NOT NULL DEFAULT 'IMPORTANT' CHECK (deadline_criticality IN ('OPTIONAL', 'IMPORTANT', 'CRITICAL')),
  ADD COLUMN scope_tier text NOT NULL DEFAULT 'MUST' CHECK (scope_tier IN ('MUST', 'SHOULD', 'NICE')),
  ADD COLUMN release_required boolean NOT NULL DEFAULT true;

ALTER TABLE task_evidence
  ADD COLUMN external_id text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT task_evidence_external_unique UNIQUE (task_id, kind, external_id);

ALTER TABLE decisions
  ADD COLUMN type text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN context text NOT NULL DEFAULT '',
  ADD COLUMN status text NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN author_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  ADD COLUMN approved_by_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN affected_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN affected_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN supersedes_decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL,
  ADD COLUMN superseded_by_decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL;

CREATE TABLE project_vision_revisions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  statement text NOT NULL,
  problem text NOT NULL DEFAULT '',
  target_outcome text NOT NULL,
  core_experience text NOT NULL DEFAULT '',
  must_have_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  should_have_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  nice_to_have_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED')),
  proposed_by uuid NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES team_members(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  approved_at timestamptz
);

CREATE TABLE task_blockers (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  blocked_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  blocking_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  blocked_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  description text NOT NULL,
  source text NOT NULL CHECK (source IN ('HUMAN', 'TASK', 'GITHUB', 'CI', 'INTEGRATION', 'SYSTEM')),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  suggested_resolution text NOT NULL DEFAULT '',
  created_by uuid REFERENCES team_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES team_members(id) ON DELETE SET NULL
);

CREATE TABLE task_assignments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  reasons jsonb NOT NULL,
  score numeric(6, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  automatic boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES team_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE risk_snapshots (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score numeric(6, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  severity text NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamptz NOT NULL
);

CREATE TABLE project_settings (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_cadence_hours integer NOT NULL DEFAULT 24 CHECK (checkpoint_cadence_hours BETWEEN 1 AND 720),
  notification_policy text NOT NULL DEFAULT 'BATCHED' CHECK (notification_policy IN ('IMMEDIATE_CRITICAL', 'BATCHED', 'CHECKPOINT_ONLY')),
  mission_control_channel_id text,
  mission_control_message_id text,
  baseline_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE github_activity (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id bigint,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  kind text NOT NULL,
  external_id text NOT NULL,
  url text,
  branch text,
  changed_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  UNIQUE (project_id, kind, external_id)
);

CREATE TABLE task_github_links (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repository_id bigint NOT NULL,
  link_kind text NOT NULL,
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, repository_id, link_kind, external_id)
);

CREATE TABLE notification_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  deduplication_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, deduplication_key)
);

CREATE INDEX vision_revisions_project_time_idx ON project_vision_revisions(project_id, created_at DESC);
CREATE INDEX decisions_project_time_idx ON decisions(project_id, decided_at DESC);
CREATE INDEX blockers_project_open_idx ON task_blockers(project_id, resolved_at, created_at DESC);
CREATE INDEX assignments_project_task_idx ON task_assignments(project_id, task_id, created_at DESC);
CREATE INDEX risk_snapshots_project_time_idx ON risk_snapshots(project_id, captured_at DESC);
CREATE INDEX github_activity_project_time_idx ON github_activity(project_id, occurred_at DESC);
CREATE INDEX notifications_pending_idx ON notification_events(delivered_at, available_at);
