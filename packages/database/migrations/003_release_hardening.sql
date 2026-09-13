ALTER TABLE github_activity
  ADD CONSTRAINT github_activity_repository_fk
  FOREIGN KEY (repository_id) REFERENCES github_repositories(repository_id) ON DELETE SET NULL;

ALTER TABLE task_github_links
  ADD CONSTRAINT task_github_links_repository_fk
  FOREIGN KEY (repository_id) REFERENCES github_repositories(repository_id) ON DELETE CASCADE;

CREATE INDEX milestones_project_due_idx ON milestones(project_id, due_at);
CREATE INDEX tasks_project_owner_idx ON tasks(project_id, owner_member_id);
CREATE INDEX task_evidence_task_time_idx ON task_evidence(task_id, created_at DESC);
CREATE INDEX github_repositories_project_idx ON github_repositories(project_id, active);
