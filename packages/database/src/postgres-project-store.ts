import type { Pool, PoolClient, QueryResultRow } from "pg";
import { PersistenceError } from "./in-memory-project-store.js";
import type {
  AssignmentRecord,
  BlockerRecord,
  DecisionRecord,
  ImpactRecord,
  MemoryCategoryRecord,
  MemoryEntryRecord,
  ProjectRecord,
  ProjectSettingsRecord,
  ProjectSetupInput,
  ProjectStore,
  RiskSnapshotRecord,
  GitHubActivityRecord,
  MilestoneRecord,
  TaskCreateInput,
  TaskEvidenceRecord,
  TaskRecord,
  TaskPlanCreateInput,
  TaskStatusRecord,
  TaskTransitionPersistenceInput,
  TeamMemberProfileInput,
  TeamMemberRecord,
  VisionRevisionRecord,
} from "./records.js";

interface ProjectRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  discord_guild_id: string | null;
  name: string;
  description: string;
  vision_statement: string;
  vision_success_criteria: unknown;
  vision_non_goals: unknown;
  vision_details: unknown;
  deadline: Date;
  timezone: string;
  mode: ProjectRecord["mode"];
  status: ProjectRecord["status"];
  github_repository: string | null;
  constraints: unknown;
  created_at: Date;
  updated_at: Date;
}

interface MemberRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  external_user_id: string;
  display_name: string;
  roles: unknown;
  skills: unknown;
  availability: unknown;
  communication_preferences: unknown;
  ai_tool_profiles: unknown;
  created_at: Date;
  updated_at: Date;
}

interface TaskRow extends QueryResultRow {
  id: string;
  project_id: string;
  milestone_id: string | null;
  owner_member_id: string | null;
  title: string;
  description: string;
  expected_outcome: string;
  owner_role: string | null;
  risk_level: ImpactRecord;
  verification_requirements: unknown;
  suggested_evidence: unknown;
  component: string | null;
  deadline_criticality: "OPTIONAL" | "IMPORTANT" | "CRITICAL";
  scope_tier: "MUST" | "SHOULD" | "NICE";
  release_required: boolean;
  status: TaskStatusRecord;
  impact: TaskRecord["impact"];
  weight: string | number;
  estimated_effort_hours: string | number;
  due_at: Date | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}

interface TaskEvidenceRow extends QueryResultRow {
  id: string;
  task_id: string;
  kind: string;
  uri: string | null;
  summary: string;
  verified: boolean;
  submitted_by: string | null;
  external_id: string | null;
  metadata: unknown;
  created_at: Date;
}

interface VisionRevisionRow extends QueryResultRow {
  id: string;
  project_id: string;
  statement: string;
  problem: string;
  target_outcome: string;
  core_experience: string;
  must_have_scope: unknown;
  should_have_scope: unknown;
  nice_to_have_scope: unknown;
  excluded_scope: unknown;
  constraints: unknown;
  success_criteria: unknown;
  status: VisionRevisionRecord["status"];
  proposed_by: string;
  approved_by: string | null;
  decision_id: string | null;
  created_at: Date;
  approved_at: Date | null;
}

interface DecisionRow extends QueryResultRow {
  id: string;
  project_id: string;
  type: DecisionRecord["type"];
  title: string;
  description: string;
  context: string;
  rationale: string;
  outcome: string;
  alternatives: unknown;
  affected_task_ids: unknown;
  affected_components: unknown;
  status: DecisionRecord["status"];
  author_member_id: string | null;
  approved_by_member_id: string | null;
  supersedes_decision_id: string | null;
  superseded_by_decision_id: string | null;
  decided_at: Date;
  approved_at: Date | null;
}

interface BlockerRow extends QueryResultRow {
  id: string;
  project_id: string;
  description: string;
  source: BlockerRecord["source"];
  severity: BlockerRecord["severity"];
  blocked_task_id: string | null;
  blocking_task_id: string | null;
  blocked_member_id: string | null;
  suggested_resolution: string;
  created_by: string | null;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
}

interface AssignmentRow extends QueryResultRow {
  id: string;
  project_id: string;
  task_id: string;
  member_id: string;
  reasons: unknown;
  score: number | string;
  confidence: number | string;
  automatic: boolean;
  approved_by: string | null;
  created_at: Date;
}

interface RiskSnapshotRow extends QueryResultRow {
  id: string;
  project_id: string;
  score: number | string;
  severity: string;
  signals: unknown;
  changes: unknown;
  captured_at: Date;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function objectArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  const visionDetails = objectValue(row.vision_details);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    name: row.name,
    description: row.description,
    vision: row.vision_statement,
    visionDetails: {
      problem: typeof visionDetails["problem"] === "string" ? visionDetails["problem"] : "",
      targetOutcome:
        typeof visionDetails["targetOutcome"] === "string"
          ? visionDetails["targetOutcome"]
          : row.vision_statement,
      coreExperience:
        typeof visionDetails["coreExperience"] === "string" ? visionDetails["coreExperience"] : "",
      mustHaveScope: stringArray(visionDetails["mustHaveScope"]),
      shouldHaveScope: stringArray(visionDetails["shouldHaveScope"]),
      niceToHaveScope: stringArray(visionDetails["niceToHaveScope"]),
      excludedScope: stringArray(visionDetails["excludedScope"]),
    },
    successCriteria: stringArray(row.vision_success_criteria),
    nonGoals: stringArray(row.vision_non_goals),
    deadline: new Date(row.deadline),
    timezone: row.timezone,
    mode: row.mode,
    status: row.status,
    constraints: stringArray(row.constraints),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(row.discord_guild_id === null ? {} : { discordGuildId: row.discord_guild_id }),
    ...(row.github_repository === null ? {} : { githubRepository: row.github_repository }),
  };
}

function memberFromRow(row: MemberRow): TeamMemberRecord {
  const skills = objectArray(row.skills)
    .filter((entry) => typeof entry["name"] === "string" && typeof entry["level"] === "number")
    .map((entry) => ({ name: entry["name"] as string, level: entry["level"] as number }));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    roles: stringArray(row.roles),
    skills,
    availability: objectValue(row.availability),
    communicationPreferences: objectValue(row.communication_preferences),
    aiToolProfiles: objectArray(row.ai_tool_profiles),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function taskFromRow(row: TaskRow, dependencyIds: readonly string[] = []): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    expectedOutcome: row.expected_outcome || row.description,
    riskLevel: row.risk_level,
    verificationRequirements: stringArray(row.verification_requirements),
    suggestedEvidence: stringArray(row.suggested_evidence),
    deadlineCriticality: row.deadline_criticality,
    scopeTier: row.scope_tier,
    releaseRequired: row.release_required,
    status: row.status,
    impact: row.impact,
    weight: Number(row.weight),
    estimatedEffortHours: Number(row.estimated_effort_hours),
    metadata: objectValue(row.metadata),
    dependencyIds,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(row.milestone_id === null ? {} : { milestoneId: row.milestone_id }),
    ...(row.owner_member_id === null ? {} : { ownerMemberId: row.owner_member_id }),
    ...(row.owner_role === null ? {} : { ownerRole: row.owner_role }),
    ...(row.component === null ? {} : { component: row.component }),
    ...(row.due_at === null ? {} : { dueAt: new Date(row.due_at) }),
  };
}

function evidenceFromRow(row: TaskEvidenceRow): TaskEvidenceRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    summary: row.summary,
    verified: row.verified,
    createdAt: new Date(row.created_at),
    ...(row.uri === null ? {} : { uri: row.uri }),
    ...(row.submitted_by === null ? {} : { submittedBy: row.submitted_by }),
    ...(row.external_id === null ? {} : { externalId: row.external_id }),
    metadata: objectValue(row.metadata),
  };
}

function taskTransitionMetadata(
  value: unknown,
  status: TaskStatusRecord,
  blockReason?: string,
): Readonly<Record<string, unknown>> {
  const metadata = { ...objectValue(value) };
  if (status === "BLOCKED") metadata["blockReason"] = blockReason ?? "Reason not recorded";
  else delete metadata["blockReason"];
  return metadata;
}

function visionRevisionFromRow(row: VisionRevisionRow): VisionRevisionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    statement: row.statement,
    problem: row.problem,
    targetOutcome: row.target_outcome,
    coreExperience: row.core_experience,
    mustHaveScope: stringArray(row.must_have_scope),
    shouldHaveScope: stringArray(row.should_have_scope),
    niceToHaveScope: stringArray(row.nice_to_have_scope),
    excludedScope: stringArray(row.excluded_scope),
    constraints: stringArray(row.constraints),
    successCriteria: stringArray(row.success_criteria),
    status: row.status,
    proposedBy: row.proposed_by,
    createdAt: new Date(row.created_at),
    ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }),
    ...(row.decision_id === null ? {} : { decisionId: row.decision_id }),
    ...(row.approved_at === null ? {} : { approvedAt: new Date(row.approved_at) }),
  };
}

function decisionFromRow(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    description: row.description,
    context: row.context,
    rationale: row.rationale,
    outcome: row.outcome,
    alternatives: stringArray(row.alternatives),
    affectedTaskIds: stringArray(row.affected_task_ids),
    affectedComponents: stringArray(row.affected_components),
    status: row.status,
    createdAt: new Date(row.decided_at),
    ...(row.author_member_id === null ? {} : { authorMemberId: row.author_member_id }),
    ...(row.approved_by_member_id === null
      ? {}
      : { approvedByMemberId: row.approved_by_member_id }),
    ...(row.supersedes_decision_id === null
      ? {}
      : { supersedesDecisionId: row.supersedes_decision_id }),
    ...(row.superseded_by_decision_id === null
      ? {}
      : { supersededByDecisionId: row.superseded_by_decision_id }),
    ...(row.approved_at === null ? {} : { approvedAt: new Date(row.approved_at) }),
  };
}

function blockerFromRow(row: BlockerRow): BlockerRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    description: row.description,
    source: row.source,
    severity: row.severity,
    suggestedResolution: row.suggested_resolution,
    createdAt: new Date(row.created_at),
    ...(row.blocked_task_id === null ? {} : { blockedTaskId: row.blocked_task_id }),
    ...(row.blocking_task_id === null ? {} : { blockingTaskId: row.blocking_task_id }),
    ...(row.blocked_member_id === null ? {} : { blockedMemberId: row.blocked_member_id }),
    ...(row.created_by === null ? {} : { createdBy: row.created_by }),
    ...(row.resolved_at === null ? {} : { resolvedAt: new Date(row.resolved_at) }),
    ...(row.resolved_by === null ? {} : { resolvedBy: row.resolved_by }),
  };
}

function assignmentFromRow(row: AssignmentRow): AssignmentRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    memberId: row.member_id,
    reasons: stringArray(row.reasons),
    score: Number(row.score),
    confidence: Number(row.confidence),
    automatic: row.automatic,
    createdAt: new Date(row.created_at),
    ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }),
  };
}

async function rollback(client: PoolClient, cause: unknown): Promise<never> {
  await client.query("ROLLBACK");
  throw cause;
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function normalizePersistenceError(error: unknown): unknown {
  if (error instanceof PersistenceError) return error;
  switch (postgresCode(error)) {
    case "23505":
      return new PersistenceError("ALREADY_EXISTS", "The requested record already exists");
    case "23503":
      return new PersistenceError(
        "PROJECT_MISMATCH",
        "A referenced record does not belong to this project or workspace",
      );
    case "22P02":
    case "22007":
      return new PersistenceError("INVALID_INPUT", "A persisted value has an invalid format");
    default:
      return error;
  }
}

async function normalizedQuery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw normalizePersistenceError(error);
  }
}

async function rollbackNormalized(client: PoolClient, cause: unknown): Promise<never> {
  return rollback(client, normalizePersistenceError(cause));
}

const projectSelect = `
  SELECT p.*, w.name AS workspace_name, w.discord_guild_id
  FROM projects p
  JOIN workspaces w ON w.id = p.workspace_id
`;

export class PostgresProjectStore implements ProjectStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async setupProject(input: ProjectSetupInput): Promise<ProjectRecord> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO workspaces (id, name, discord_guild_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [input.workspaceId, input.workspaceName, input.discordGuildId ?? null, input.createdAt],
      );
      await client.query(
        `INSERT INTO team_members
          (id, workspace_id, external_user_id, display_name, roles, skills, availability,
           communication_preferences, ai_tool_profiles, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 '[]'::jsonb, $6, $6)`,
        [
          input.ownerMemberId,
          input.workspaceId,
          input.ownerExternalUserId,
          input.ownerDisplayName,
          JSON.stringify(["OWNER", "PRODUCER"]),
          input.createdAt,
        ],
      );
      await client.query("UPDATE workspaces SET owner_member_id = $1 WHERE id = $2", [
        input.ownerMemberId,
        input.workspaceId,
      ]);
      await client.query(
        `INSERT INTO projects
          (id, workspace_id, name, description, vision_statement, vision_success_criteria,
           vision_non_goals, vision_details, deadline, timezone, mode, status, github_repository, constraints,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, 'ACTIVE', $12,
                 $13::jsonb, $14, $14)`,
        [
          input.projectId,
          input.workspaceId,
          input.name,
          input.description,
          input.vision,
          JSON.stringify(input.successCriteria ?? []),
          JSON.stringify(input.nonGoals ?? []),
          JSON.stringify(
            input.visionDetails ?? {
              problem: "",
              targetOutcome: input.vision,
              coreExperience: "",
              mustHaveScope: [],
              shouldHaveScope: [],
              niceToHaveScope: [],
              excludedScope: input.nonGoals ?? [],
            },
          ),
          input.deadline,
          input.timezone,
          input.mode,
          input.githubRepository ?? null,
          JSON.stringify(input.constraints ?? []),
          input.createdAt,
        ],
      );
      const result = await client.query<ProjectRow>(`${projectSelect} WHERE p.id = $1`, [
        input.projectId,
      ]);
      await client.query("COMMIT");
      const row = result.rows[0];
      if (row === undefined) throw new PersistenceError("NOT_FOUND", "Created project vanished");
      return projectFromRow(row);
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    const result = await this.#pool.query<ProjectRow>(`${projectSelect} WHERE p.id = $1`, [
      projectId,
    ]);
    return result.rows[0] === undefined ? undefined : projectFromRow(result.rows[0]);
  }

  async getProjectByGuild(discordGuildId: string): Promise<ProjectRecord | undefined> {
    const result = await this.#pool.query<ProjectRow>(
      `${projectSelect} WHERE w.discord_guild_id = $1 ORDER BY p.created_at LIMIT 1`,
      [discordGuildId],
    );
    return result.rows[0] === undefined ? undefined : projectFromRow(result.rows[0]);
  }

  async joinTeam(input: TeamMemberProfileInput): Promise<TeamMemberRecord> {
    const result = await normalizedQuery(() =>
      this.#pool.query<MemberRow>(
        `INSERT INTO team_members
        (id, workspace_id, external_user_id, display_name, roles, skills, availability,
         communication_preferences, ai_tool_profiles, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $10)
       ON CONFLICT (workspace_id, external_user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         roles = EXCLUDED.roles,
         skills = EXCLUDED.skills,
         availability = EXCLUDED.availability,
         communication_preferences = EXCLUDED.communication_preferences,
         ai_tool_profiles = EXCLUDED.ai_tool_profiles,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.externalUserId,
          input.displayName,
          JSON.stringify(input.roles),
          JSON.stringify(input.skills),
          JSON.stringify(input.availability),
          JSON.stringify(input.communicationPreferences),
          JSON.stringify(input.aiToolProfiles),
          input.now,
        ],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) throw new PersistenceError("WRITE_FAILED", "Team member was not saved");
    return memberFromRow(row);
  }

  async createMilestone(milestone: MilestoneRecord): Promise<void> {
    await normalizedQuery(() =>
      this.#pool.query(
        `INSERT INTO milestones (id, project_id, name, description, due_at, status, completion_criteria, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          milestone.id,
          milestone.projectId,
          milestone.name,
          milestone.description,
          milestone.dueAt,
          milestone.status,
          JSON.stringify(milestone.completionCriteria),
          milestone.createdAt,
        ],
      ),
    );
  }

  async listMilestones(projectId: string): Promise<readonly MilestoneRecord[]> {
    const result = await this.#pool.query<{
      id: string;
      project_id: string;
      name: string;
      description: string;
      due_at: Date;
      status: MilestoneRecord["status"];
      completion_criteria: unknown;
      created_at: Date;
    }>("SELECT * FROM milestones WHERE project_id = $1 ORDER BY due_at", [projectId]);
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      dueAt: new Date(row.due_at),
      status: row.status,
      completionCriteria: stringArray(row.completion_criteria),
      createdAt: new Date(row.created_at),
    }));
  }

  async getTeamMember(
    workspaceId: string,
    externalUserId: string,
  ): Promise<TeamMemberRecord | undefined> {
    const result = await this.#pool.query<MemberRow>(
      "SELECT * FROM team_members WHERE workspace_id = $1 AND external_user_id = $2",
      [workspaceId, externalUserId],
    );
    return result.rows[0] === undefined ? undefined : memberFromRow(result.rows[0]);
  }

  async createTask(input: TaskCreateInput): Promise<TaskRecord> {
    const scope = await this.#pool.query<{
      project_exists: boolean;
      owner_matches: boolean;
      milestone_matches: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM projects WHERE id = $1) AS project_exists,
         ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM projects p
           JOIN team_members tm ON tm.workspace_id = p.workspace_id
           WHERE p.id = $1 AND tm.id = $2
         )) AS owner_matches,
         ($3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM milestones m WHERE m.project_id = $1 AND m.id = $3
         )) AS milestone_matches`,
      [input.projectId, input.ownerMemberId ?? null, input.milestoneId ?? null],
    );
    const validation = scope.rows[0];
    if (validation?.project_exists !== true) {
      throw new PersistenceError("NOT_FOUND", `Project ${input.projectId} does not exist`);
    }
    if (validation.owner_matches !== true || validation.milestone_matches !== true) {
      throw new PersistenceError(
        "PROJECT_MISMATCH",
        "Task owner and milestone must belong to the task project",
      );
    }
    const result = await normalizedQuery(() =>
      this.#pool.query<TaskRow>(
        `INSERT INTO tasks
        (id, project_id, milestone_id, owner_member_id, title, description, expected_outcome,
         owner_role, risk_level, verification_requirements, suggested_evidence, component,
         deadline_criticality, scope_tier, release_required, status, impact, weight,
         estimated_effort_hours, due_at, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $22)
       RETURNING *`,
        [
          input.id,
          input.projectId,
          input.milestoneId ?? null,
          input.ownerMemberId ?? null,
          input.title,
          input.description,
          input.expectedOutcome ?? input.description,
          input.ownerRole ?? null,
          input.riskLevel ?? input.impact,
          JSON.stringify(input.verificationRequirements ?? []),
          JSON.stringify(input.suggestedEvidence ?? []),
          input.component ?? null,
          input.deadlineCriticality ?? "IMPORTANT",
          input.scopeTier ?? "MUST",
          input.releaseRequired ?? true,
          input.status ?? "PLANNED",
          input.impact,
          input.weight,
          input.estimatedEffortHours,
          input.dueAt ?? null,
          JSON.stringify(input.metadata ?? {}),
          input.now,
        ],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) throw new PersistenceError("WRITE_FAILED", "Task was not saved");
    return taskFromRow(row);
  }

  async createTaskPlan(input: TaskPlanCreateInput): Promise<readonly TaskRecord[]> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const project = await client.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM projects WHERE id = $1 FOR UPDATE",
        [input.projectId],
      );
      const workspaceId = project.rows[0]?.workspace_id;
      if (workspaceId === undefined)
        throw new PersistenceError("NOT_FOUND", "Project was not found");
      const created: TaskRecord[] = [];
      for (const task of input.tasks) {
        if (task.projectId !== input.projectId) {
          throw new PersistenceError("PROJECT_MISMATCH", "Task plan crosses a project boundary");
        }
        if (task.ownerMemberId !== undefined) {
          const owner = await client.query(
            "SELECT 1 FROM team_members WHERE id = $1 AND workspace_id = $2",
            [task.ownerMemberId, workspaceId],
          );
          if ((owner.rowCount ?? 0) === 0) {
            throw new PersistenceError(
              "PROJECT_MISMATCH",
              "Task owner belongs to another workspace",
            );
          }
        }
        if (task.milestoneId !== undefined) {
          const milestone = await client.query(
            "SELECT 1 FROM milestones WHERE id = $1 AND project_id = $2",
            [task.milestoneId, input.projectId],
          );
          if ((milestone.rowCount ?? 0) === 0) {
            throw new PersistenceError(
              "PROJECT_MISMATCH",
              "Task milestone belongs to another project",
            );
          }
        }
        const result = await client.query<TaskRow>(
          `INSERT INTO tasks
            (id, project_id, milestone_id, owner_member_id, title, description, expected_outcome,
             owner_role, risk_level, verification_requirements, suggested_evidence, component,
             deadline_criticality, scope_tier, release_required, status, impact, weight,
             estimated_effort_hours, due_at, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12,
                   $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $22)
           RETURNING *`,
          [
            task.id,
            task.projectId,
            task.milestoneId ?? null,
            task.ownerMemberId ?? null,
            task.title,
            task.description,
            task.expectedOutcome ?? task.description,
            task.ownerRole ?? null,
            task.riskLevel ?? task.impact,
            JSON.stringify(task.verificationRequirements ?? []),
            JSON.stringify(task.suggestedEvidence ?? []),
            task.component ?? null,
            task.deadlineCriticality ?? "IMPORTANT",
            task.scopeTier ?? "MUST",
            task.releaseRequired ?? true,
            task.status ?? "PLANNED",
            task.impact,
            task.weight,
            task.estimatedEffortHours,
            task.dueAt ?? null,
            JSON.stringify(task.metadata ?? {}),
            task.now,
          ],
        );
        created.push(taskFromRow(result.rows[0]!));
      }
      for (const edge of input.dependencies) {
        const scope = await client.query<{ task_project: string; dependency_project: string }>(
          `SELECT task.project_id AS task_project, dependency.project_id AS dependency_project
           FROM tasks task, tasks dependency WHERE task.id = $1 AND dependency.id = $2`,
          [edge.taskId, edge.dependsOnTaskId],
        );
        if (
          scope.rows[0]?.task_project !== input.projectId ||
          scope.rows[0]?.dependency_project !== input.projectId
        ) {
          throw new PersistenceError(
            "PROJECT_MISMATCH",
            "Task plan dependency is outside the project",
          );
        }
        const cycle = await client.query(
          `WITH RECURSIVE dependencies(id) AS (
             SELECT $2::uuid
             UNION
             SELECT td.depends_on_task_id FROM task_dependencies td
             JOIN dependencies d ON td.task_id = d.id
           ) SELECT 1 FROM dependencies WHERE id = $1::uuid LIMIT 1`,
          [edge.taskId, edge.dependsOnTaskId],
        );
        if ((cycle.rowCount ?? 0) > 0)
          throw new PersistenceError("CYCLE", "Task plan contains a cycle");
        await client.query(
          "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1, $2)",
          [edge.taskId, edge.dependsOnTaskId],
        );
      }
      await client.query("COMMIT");
      const dependencyMap = new Map<string, string[]>();
      for (const edge of input.dependencies) {
        const values = dependencyMap.get(edge.taskId) ?? [];
        values.push(edge.dependsOnTaskId);
        dependencyMap.set(edge.taskId, values);
      }
      return created.map((task) => ({ ...task, dependencyIds: dependencyMap.get(task.id) ?? [] }));
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const [taskResult, dependencyResult] = await Promise.all([
      this.#pool.query<TaskRow>("SELECT * FROM tasks WHERE id = $1", [taskId]),
      this.#pool.query<{ depends_on_task_id: string }>(
        "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1",
        [taskId],
      ),
    ]);
    const row = taskResult.rows[0];
    return row === undefined
      ? undefined
      : taskFromRow(
          row,
          dependencyResult.rows.map((entry) => entry.depends_on_task_id),
        );
  }

  async addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    if (taskId === dependsOnTaskId)
      throw new PersistenceError("CYCLE", "Task cannot depend on itself");
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const target = await client.query<{ project_id: string }>(
        "SELECT project_id FROM tasks WHERE id = $1",
        [taskId],
      );
      const targetProject = target.rows[0]?.project_id;
      if (targetProject === undefined) {
        throw new PersistenceError("NOT_FOUND", "Both tasks must exist");
      }
      // All graph edits and transitions for a project share this lock. This closes the race where
      // a dependency was added after READY/IN_PROGRESS validation.
      await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [targetProject]);
      const projectResult = await client.query<{
        id: string;
        project_id: string;
        status: TaskStatusRecord;
      }>("SELECT id, project_id, status FROM tasks WHERE id = $1 OR id = $2 FOR UPDATE", [
        taskId,
        dependsOnTaskId,
      ]);
      const taskProject = projectResult.rows.find((row) => row.id === taskId)?.project_id;
      const dependencyProject = projectResult.rows.find(
        (row) => row.id === dependsOnTaskId,
      )?.project_id;
      if (taskProject === undefined || dependencyProject === undefined) {
        throw new PersistenceError("NOT_FOUND", "Both tasks must exist");
      }
      if (taskProject !== dependencyProject) {
        throw new PersistenceError("PROJECT_MISMATCH", "Dependencies must belong to one project");
      }
      const taskStatus = projectResult.rows.find((row) => row.id === taskId)?.status;
      if (taskStatus !== "PLANNED") {
        throw new PersistenceError(
          "CONFLICT",
          "Dependencies can only be changed while the dependant task is PLANNED",
        );
      }
      const edgeResult = await client.query<{ task_id: string; depends_on_task_id: string }>(
        `SELECT td.task_id, td.depends_on_task_id FROM task_dependencies td
         JOIN tasks t ON t.id = td.task_id WHERE t.project_id = $1`,
        [taskProject],
      );
      const dependencies = new Map<string, string[]>();
      for (const edge of edgeResult.rows) {
        const values = dependencies.get(edge.task_id) ?? [];
        values.push(edge.depends_on_task_id);
        dependencies.set(edge.task_id, values);
      }
      const reachesTask = (candidate: string, seen = new Set<string>()): boolean => {
        if (candidate === taskId) return true;
        if (seen.has(candidate)) return false;
        seen.add(candidate);
        return (dependencies.get(candidate) ?? []).some((next) => reachesTask(next, seen));
      };
      if (reachesTask(dependsOnTaskId)) {
        throw new PersistenceError("CYCLE", "Task dependency would create a cycle");
      }
      await client.query(
        `INSERT INTO task_dependencies (task_id, depends_on_task_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [taskId, dependsOnTaskId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async listTasks(projectId: string): Promise<readonly TaskRecord[]> {
    const [tasks, dependencies] = await Promise.all([
      this.#pool.query<TaskRow>(
        "SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at, id",
        [projectId],
      ),
      this.#pool.query<{ task_id: string; depends_on_task_id: string }>(
        `SELECT td.task_id, td.depends_on_task_id FROM task_dependencies td
         JOIN tasks t ON t.id = td.task_id WHERE t.project_id = $1`,
        [projectId],
      ),
    ]);
    const byTask = new Map<string, string[]>();
    for (const row of dependencies.rows) {
      const values = byTask.get(row.task_id) ?? [];
      values.push(row.depends_on_task_id);
      byTask.set(row.task_id, values);
    }
    return tasks.rows.map((row) => taskFromRow(row, byTask.get(row.id) ?? []));
  }

  async listMemberTasks(projectId: string, memberId: string): Promise<readonly TaskRecord[]> {
    return (await this.listTasks(projectId)).filter((task) => task.ownerMemberId === memberId);
  }

  async addTaskEvidence(evidence: TaskEvidenceRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO task_evidence (id, task_id, kind, uri, summary, verified, submitted_by, created_at, external_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) ON CONFLICT DO NOTHING`,
      [
        evidence.id,
        evidence.taskId,
        evidence.kind,
        evidence.uri ?? null,
        evidence.summary,
        evidence.verified,
        evidence.submittedBy ?? null,
        evidence.createdAt,
        evidence.externalId ?? null,
        JSON.stringify(evidence.metadata ?? {}),
      ],
    );
  }

  async applyTaskTransition(input: TaskTransitionPersistenceInput): Promise<TaskRecord> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const target = await client.query<{ project_id: string }>(
        "SELECT project_id FROM tasks WHERE id = $1",
        [input.taskId],
      );
      const projectId = target.rows[0]?.project_id;
      if (projectId === undefined) {
        throw new PersistenceError("NOT_FOUND", `Task ${input.taskId} does not exist`);
      }
      // Serialize with dependency edits and other transitions in this project, then re-check the
      // exact domain snapshot that the application validated.
      await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
      const current = await client.query<{
        metadata: unknown;
        status: TaskStatusRecord;
        updated_at: Date;
      }>("SELECT metadata, status, updated_at FROM tasks WHERE id = $1 FOR UPDATE", [input.taskId]);
      const currentRow = current.rows[0];
      if (currentRow === undefined) {
        throw new PersistenceError("NOT_FOUND", `Task ${input.taskId} does not exist`);
      }
      if (
        currentRow.status !== input.expectedStatus ||
        new Date(currentRow.updated_at).getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new PersistenceError(
          "CONFLICT",
          "Task changed after its transition was validated; reload and retry",
        );
      }
      if (input.status === "READY" || input.status === "IN_PROGRESS") {
        const unmet = await client.query(
          `SELECT 1
           FROM task_dependencies td
           JOIN tasks dependency ON dependency.id = td.depends_on_task_id
           WHERE td.task_id = $1
             AND dependency.status NOT IN ('VERIFIED', 'INTEGRATED', 'SHIPPED')
           LIMIT 1`,
          [input.taskId],
        );
        if ((unmet.rowCount ?? 0) > 0) {
          throw new PersistenceError("CONFLICT", "Task dependencies are no longer satisfied");
        }
      }
      for (const evidence of input.evidence ?? []) {
        if (evidence.taskId !== input.taskId) {
          throw new PersistenceError("PROJECT_MISMATCH", "Evidence belongs to another task");
        }
        await client.query(
          `INSERT INTO task_evidence
            (id, task_id, kind, uri, summary, verified, submitted_by, created_at, external_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) ON CONFLICT DO NOTHING`,
          [
            evidence.id,
            evidence.taskId,
            evidence.kind,
            evidence.uri ?? null,
            evidence.summary,
            evidence.verified,
            evidence.submittedBy ?? null,
            evidence.createdAt,
            evidence.externalId ?? null,
            JSON.stringify(evidence.metadata ?? {}),
          ],
        );
      }
      const result = await client.query<TaskRow>(
        "UPDATE tasks SET status = $2, updated_at = $3, metadata = $4::jsonb WHERE id = $1 RETURNING *",
        [
          input.taskId,
          input.status,
          input.now,
          JSON.stringify(
            taskTransitionMetadata(currentRow.metadata, input.status, input.blockReason),
          ),
        ],
      );
      const row = result.rows[0];
      if (row === undefined)
        throw new PersistenceError("NOT_FOUND", `Task ${input.taskId} does not exist`);
      const dependencies = await client.query<{ depends_on_task_id: string }>(
        "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1",
        [input.taskId],
      );
      await client.query("COMMIT");
      return taskFromRow(
        row,
        dependencies.rows.map((entry) => entry.depends_on_task_id),
      );
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async listTaskEvidence(taskId: string): Promise<readonly TaskEvidenceRecord[]> {
    const result = await this.#pool.query<TaskEvidenceRow>(
      "SELECT * FROM task_evidence WHERE task_id = $1 ORDER BY created_at",
      [taskId],
    );
    return result.rows.map(evidenceFromRow);
  }

  async listProjectTaskEvidence(projectId: string): Promise<readonly TaskEvidenceRecord[]> {
    const result = await this.#pool.query<TaskEvidenceRow>(
      `SELECT evidence.* FROM task_evidence evidence
       JOIN tasks task ON task.id = evidence.task_id
       WHERE task.project_id = $1
       ORDER BY evidence.created_at DESC, evidence.id`,
      [projectId],
    );
    return result.rows.map(evidenceFromRow);
  }

  async addMemoryEntry(entry: MemoryEntryRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO project_memory_entries (id, project_id, category, title, content, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.projectId,
        entry.category,
        entry.title,
        entry.content,
        entry.confidence,
        entry.createdAt,
      ],
    );
  }

  async listMemory(
    projectId: string,
    categories?: readonly MemoryCategoryRecord[],
    limit?: number,
  ): Promise<readonly MemoryEntryRecord[]> {
    const query =
      limit === undefined
        ? `SELECT id, project_id, category, title, content, confidence, created_at
           FROM project_memory_entries
           WHERE project_id = $1 AND ($2::text[] IS NULL OR category = ANY($2::text[]))
           ORDER BY created_at DESC`
        : `SELECT id, project_id, category, title, content, confidence, created_at
           FROM project_memory_entries
           WHERE project_id = $1 AND ($2::text[] IS NULL OR category = ANY($2::text[]))
           ORDER BY created_at DESC
           LIMIT $3`;
    const params =
      limit === undefined
        ? [projectId, categories === undefined ? null : [...categories]]
        : [projectId, categories === undefined ? null : [...categories], limit];
    const result = await this.#pool.query<
      QueryResultRow & {
        id: string;
        project_id: string;
        category: MemoryCategoryRecord;
        title: string;
        content: string;
        confidence: string | number;
        created_at: Date;
      }
    >(query, params);
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      category: row.category,
      title: row.title,
      content: row.content,
      confidence: Number(row.confidence),
      createdAt: new Date(row.created_at),
    }));
  }

  async listTeamMembers(workspaceId: string): Promise<readonly TeamMemberRecord[]> {
    const result = await this.#pool.query<MemberRow>(
      "SELECT * FROM team_members WHERE workspace_id = $1 ORDER BY created_at, id",
      [workspaceId],
    );
    return result.rows.map(memberFromRow);
  }

  async updateCommunicationPreferences(
    workspaceId: string,
    externalUserId: string,
    preferences: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<TeamMemberRecord> {
    const result = await this.#pool.query<MemberRow>(
      `UPDATE team_members SET communication_preferences = communication_preferences || $3::jsonb, updated_at = $4
       WHERE workspace_id = $1 AND external_user_id = $2 RETURNING *`,
      [workspaceId, externalUserId, JSON.stringify(preferences), now],
    );
    const row = result.rows[0];
    if (row === undefined) throw new PersistenceError("NOT_FOUND", "Team member was not found");
    return memberFromRow(row);
  }

  async addVisionRevision(revision: VisionRevisionRecord): Promise<void> {
    const result = await normalizedQuery(() =>
      this.#pool.query(
        `INSERT INTO project_vision_revisions
          (id, project_id, statement, problem, target_outcome, core_experience, must_have_scope,
           should_have_scope, nice_to_have_scope, excluded_scope, constraints, success_criteria,
           status, proposed_by, approved_by, decision_id, created_at, approved_at)
         SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::jsonb,
                $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::text,
                $14::uuid, $15::uuid, $16::uuid, $17::timestamptz, $18::timestamptz
         FROM projects p JOIN team_members tm ON tm.workspace_id = p.workspace_id
         WHERE p.id = $2 AND tm.id = $14`,
        [
          revision.id,
          revision.projectId,
          revision.statement,
          revision.problem,
          revision.targetOutcome,
          revision.coreExperience,
          JSON.stringify(revision.mustHaveScope),
          JSON.stringify(revision.shouldHaveScope),
          JSON.stringify(revision.niceToHaveScope),
          JSON.stringify(revision.excludedScope),
          JSON.stringify(revision.constraints),
          JSON.stringify(revision.successCriteria),
          revision.status,
          revision.proposedBy,
          revision.approvedBy ?? null,
          revision.decisionId ?? null,
          revision.createdAt,
          revision.approvedAt ?? null,
        ],
      ),
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new PersistenceError("PROJECT_MISMATCH", "Vision author belongs to another workspace");
    }
  }

  async listVisionRevisions(projectId: string): Promise<readonly VisionRevisionRecord[]> {
    const result = await this.#pool.query<VisionRevisionRow>(
      "SELECT * FROM project_vision_revisions WHERE project_id = $1 ORDER BY created_at DESC",
      [projectId],
    );
    return result.rows.map(visionRevisionFromRow);
  }

  async approveVisionRevision(
    revisionId: string,
    approvedBy: string,
    decision: DecisionRecord,
    now: Date,
  ): Promise<VisionRevisionRecord> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const result = await client.query<VisionRevisionRow>(
        `SELECT vr.* FROM project_vision_revisions vr
         JOIN projects p ON p.id = vr.project_id
         JOIN team_members tm ON tm.workspace_id = p.workspace_id AND tm.id = $2
         WHERE vr.id = $1 FOR UPDATE`,
        [revisionId, approvedBy],
      );
      const revision = result.rows[0];
      if (revision === undefined)
        throw new PersistenceError("NOT_FOUND", "Vision revision or approver was not found");
      if (revision.status !== "PROPOSED")
        throw new PersistenceError("CONFLICT", "Vision revision is already resolved");
      await this.#insertDecision(client, decision);
      const approved = await client.query<VisionRevisionRow>(
        `UPDATE project_vision_revisions SET status = 'APPROVED', approved_by = $2,
           decision_id = $3, approved_at = $4 WHERE id = $1 RETURNING *`,
        [revisionId, approvedBy, decision.id, now],
      );
      await client.query(
        `UPDATE projects SET vision_statement = $2, vision_success_criteria = $3::jsonb,
           vision_non_goals = $4::jsonb, constraints = $5::jsonb, vision_details = $6::jsonb,
           updated_at = $7 WHERE id = $1`,
        [
          revision.project_id,
          revision.statement,
          JSON.stringify(stringArray(revision.success_criteria)),
          JSON.stringify(stringArray(revision.excluded_scope)),
          JSON.stringify(stringArray(revision.constraints)),
          JSON.stringify({
            problem: revision.problem,
            targetOutcome: revision.target_outcome,
            coreExperience: revision.core_experience,
            mustHaveScope: stringArray(revision.must_have_scope),
            shouldHaveScope: stringArray(revision.should_have_scope),
            niceToHaveScope: stringArray(revision.nice_to_have_scope),
            excludedScope: stringArray(revision.excluded_scope),
          }),
          now,
        ],
      );
      await client.query("COMMIT");
      return visionRevisionFromRow(approved.rows[0]!);
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async #insertDecision(client: PoolClient | Pool, decision: DecisionRecord): Promise<void> {
    await client.query(
      `INSERT INTO decisions
        (id, project_id, type, title, description, context, rationale, outcome, alternatives,
         affected_task_ids, affected_components, status, decided_by, author_member_id,
         approved_by_member_id, approved_at, supersedes_decision_id,
         superseded_by_decision_id, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb,
               $12, $13, $13, $14, $15, $16, $17, $18)`,
      [
        decision.id,
        decision.projectId,
        decision.type,
        decision.title,
        decision.description,
        decision.context,
        decision.rationale,
        decision.outcome,
        JSON.stringify(decision.alternatives),
        JSON.stringify(decision.affectedTaskIds),
        JSON.stringify(decision.affectedComponents),
        decision.status,
        decision.authorMemberId ?? null,
        decision.approvedByMemberId ?? null,
        decision.approvedAt ?? null,
        decision.supersedesDecisionId ?? null,
        decision.supersededByDecisionId ?? null,
        decision.createdAt,
      ],
    );
  }

  async addDecision(decision: DecisionRecord): Promise<void> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      await this.#insertDecision(client, decision);
      if (decision.status === "ACCEPTED" && decision.supersedesDecisionId !== undefined) {
        const superseded = await client.query(
          "UPDATE decisions SET status = 'SUPERSEDED', superseded_by_decision_id = $2 WHERE id = $1 AND project_id = $3 AND status = 'ACCEPTED'",
          [decision.supersedesDecisionId, decision.id, decision.projectId],
        );
        if ((superseded.rowCount ?? 0) === 0)
          throw new PersistenceError("CONFLICT", "Superseded decision is missing or not accepted");
      }
      await client.query("COMMIT");
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async getDecision(projectId: string, decisionId: string): Promise<DecisionRecord | undefined> {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(projectId) || !uuidPattern.test(decisionId)) {
      return undefined;
    }
    const result = await this.#pool.query<DecisionRow>(
      "SELECT * FROM decisions WHERE project_id = $1 AND id = $2 LIMIT 1",
      [projectId, decisionId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : decisionFromRow(row);
  }

  async listDecisions(projectId: string, limit = 20): Promise<readonly DecisionRecord[]> {
    const result = await this.#pool.query<DecisionRow>(
      "SELECT * FROM decisions WHERE project_id = $1 ORDER BY decided_at DESC LIMIT $2",
      [projectId, limit],
    );
    return result.rows.map(decisionFromRow);
  }

  async approveDecision(
    decisionId: string,
    approvedBy: string,
    now: Date,
  ): Promise<DecisionRecord> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const result = await client.query<DecisionRow>(
        `UPDATE decisions SET status = 'ACCEPTED', approved_by_member_id = $2, approved_at = $3
         WHERE id = $1 AND status = 'PROPOSED' AND project_id IN (
           SELECT p.id FROM projects p JOIN team_members tm ON tm.workspace_id = p.workspace_id WHERE tm.id = $2
         ) RETURNING *`,
        [decisionId, approvedBy, now],
      );
      const row = result.rows[0];
      if (row === undefined)
        throw new PersistenceError(
          "CONFLICT",
          "Decision is missing, resolved, or approver is out of scope",
        );
      if (row.supersedes_decision_id !== null) {
        const superseded = await client.query(
          "UPDATE decisions SET status = 'SUPERSEDED', superseded_by_decision_id = $2 WHERE id = $1 AND project_id = $3 AND status = 'ACCEPTED'",
          [row.supersedes_decision_id, row.id, row.project_id],
        );
        if ((superseded.rowCount ?? 0) === 0)
          throw new PersistenceError("CONFLICT", "Superseded decision is missing or not accepted");
      }
      await client.query("COMMIT");
      return decisionFromRow(row);
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async addBlocker(blocker: BlockerRecord): Promise<void> {
    const result = await normalizedQuery(() =>
      this.#pool.query(
        `INSERT INTO task_blockers
          (id, project_id, blocked_task_id, blocking_task_id, blocked_member_id, description,
           source, severity, suggested_resolution, created_by, created_at, resolved_at, resolved_by)
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::text,
                $8::text, $9::text, $10::uuid, $11::timestamptz, $12::timestamptz,
                $13::uuid
         WHERE ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM tasks WHERE id = $3 AND project_id = $2))
           AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM tasks WHERE id = $4 AND project_id = $2))
           AND ($5::uuid IS NULL OR EXISTS (
             SELECT 1 FROM projects p JOIN team_members tm ON tm.workspace_id = p.workspace_id
             WHERE p.id = $2 AND tm.id = $5
           ))
           AND ($10::uuid IS NULL OR EXISTS (
             SELECT 1 FROM projects p JOIN team_members tm ON tm.workspace_id = p.workspace_id
             WHERE p.id = $2 AND tm.id = $10
           ))
           AND ($13::uuid IS NULL OR EXISTS (
             SELECT 1 FROM projects p JOIN team_members tm ON tm.workspace_id = p.workspace_id
             WHERE p.id = $2 AND tm.id = $13
           ))`,
        [
          blocker.id,
          blocker.projectId,
          blocker.blockedTaskId ?? null,
          blocker.blockingTaskId ?? null,
          blocker.blockedMemberId ?? null,
          blocker.description,
          blocker.source,
          blocker.severity,
          blocker.suggestedResolution,
          blocker.createdBy ?? null,
          blocker.createdAt,
          blocker.resolvedAt ?? null,
          blocker.resolvedBy ?? null,
        ],
      ),
    );
    if ((result.rowCount ?? 0) === 0)
      throw new PersistenceError("PROJECT_MISMATCH", "Blocker tasks belong to another project");
  }

  async listBlockers(
    projectId: string,
    includeResolved = false,
  ): Promise<readonly BlockerRecord[]> {
    const result = await this.#pool.query<BlockerRow>(
      `SELECT * FROM task_blockers WHERE project_id = $1 AND ($2 OR resolved_at IS NULL)
       ORDER BY resolved_at NULLS FIRST, created_at DESC`,
      [projectId, includeResolved],
    );
    return result.rows.map(blockerFromRow);
  }

  async resolveBlocker(blockerId: string, resolvedBy: string, now: Date): Promise<BlockerRecord> {
    const result = await this.#pool.query<BlockerRow>(
      `UPDATE task_blockers SET resolved_at = COALESCE(resolved_at, $3),
         resolved_by = COALESCE(resolved_by, $2)
       WHERE id = $1 AND project_id IN (
         SELECT p.id FROM projects p
         JOIN team_members tm ON tm.workspace_id = p.workspace_id
         WHERE tm.id = $2
       )
       RETURNING *`,
      [blockerId, resolvedBy, now],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new PersistenceError("NOT_FOUND", "Blocker or resolver was not found");
    return blockerFromRow(row);
  }

  async assignTask(assignment: AssignmentRecord, now: Date): Promise<TaskRecord> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const task = await client.query<TaskRow>(
        `UPDATE tasks SET owner_member_id = $3, updated_at = $4
         WHERE id = $2 AND project_id = $1 AND $1 IN (
           SELECT p.id FROM projects p
           JOIN team_members tm ON tm.workspace_id = p.workspace_id
           WHERE p.id = $1 AND tm.id = $3
         ) RETURNING *`,
        [assignment.projectId, assignment.taskId, assignment.memberId, now],
      );
      const row = task.rows[0];
      if (row === undefined)
        throw new PersistenceError("PROJECT_MISMATCH", "Assignment crosses a project boundary");
      await client.query(
        `INSERT INTO task_assignments
          (id, project_id, task_id, member_id, reasons, score, confidence, automatic,
           approved_by, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
        [
          assignment.id,
          assignment.projectId,
          assignment.taskId,
          assignment.memberId,
          JSON.stringify(assignment.reasons),
          assignment.score,
          assignment.confidence,
          assignment.automatic,
          assignment.approvedBy ?? null,
          assignment.createdAt,
        ],
      );
      const dependencies = await client.query<{ depends_on_task_id: string }>(
        "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1",
        [assignment.taskId],
      );
      await client.query("COMMIT");
      return taskFromRow(
        row,
        dependencies.rows.map((entry) => entry.depends_on_task_id),
      );
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async listAssignments(projectId: string, taskId?: string): Promise<readonly AssignmentRecord[]> {
    const result = await this.#pool.query<AssignmentRow>(
      `SELECT * FROM task_assignments WHERE project_id = $1 AND ($2::uuid IS NULL OR task_id = $2)
       ORDER BY created_at DESC`,
      [projectId, taskId ?? null],
    );
    return result.rows.map(assignmentFromRow);
  }

  async addRiskSnapshot(snapshot: RiskSnapshotRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO risk_snapshots (id, project_id, score, severity, signals, changes, captured_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) ON CONFLICT (id) DO NOTHING`,
      [
        snapshot.id,
        snapshot.projectId,
        snapshot.score,
        snapshot.severity,
        JSON.stringify(snapshot.signals),
        JSON.stringify(snapshot.changes),
        snapshot.capturedAt,
      ],
    );
  }

  async listRiskSnapshots(projectId: string, limit = 20): Promise<readonly RiskSnapshotRecord[]> {
    const result = await this.#pool.query<RiskSnapshotRow>(
      "SELECT * FROM risk_snapshots WHERE project_id = $1 ORDER BY captured_at DESC LIMIT $2",
      [projectId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      score: Number(row.score),
      severity: row.severity,
      signals: objectArray(row.signals),
      changes: objectArray(row.changes),
      capturedAt: new Date(row.captured_at),
    }));
  }

  async getProjectSettings(projectId: string): Promise<ProjectSettingsRecord> {
    const result = await this.#pool.query<
      QueryResultRow & {
        project_id: string;
        checkpoint_cadence_hours: number;
        notification_policy: ProjectSettingsRecord["notificationPolicy"];
        mission_control_channel_id: string | null;
        mission_control_message_id: string | null;
        baseline_task_ids: unknown;
      }
    >(
      `INSERT INTO project_settings (project_id)
       SELECT id FROM projects WHERE id = $1 ON CONFLICT (project_id) DO UPDATE SET project_id = EXCLUDED.project_id
       RETURNING *`,
      [projectId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new PersistenceError("NOT_FOUND", "Project was not found");
    return {
      projectId: row.project_id,
      checkpointCadenceHours: row.checkpoint_cadence_hours,
      notificationPolicy: row.notification_policy,
      baselineTaskIds: stringArray(row.baseline_task_ids),
      ...(row.mission_control_channel_id === null
        ? {}
        : { missionControlChannelId: row.mission_control_channel_id }),
      ...(row.mission_control_message_id === null
        ? {}
        : { missionControlMessageId: row.mission_control_message_id }),
    };
  }

  async saveProjectSettings(settings: ProjectSettingsRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO project_settings
        (project_id, checkpoint_cadence_hours, notification_policy, mission_control_channel_id,
         mission_control_message_id, baseline_task_ids, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
       ON CONFLICT (project_id) DO UPDATE SET checkpoint_cadence_hours = EXCLUDED.checkpoint_cadence_hours,
         notification_policy = EXCLUDED.notification_policy,
         mission_control_channel_id = EXCLUDED.mission_control_channel_id,
         mission_control_message_id = EXCLUDED.mission_control_message_id,
         baseline_task_ids = EXCLUDED.baseline_task_ids, updated_at = now()`,
      [
        settings.projectId,
        settings.checkpointCadenceHours,
        settings.notificationPolicy,
        settings.missionControlChannelId ?? null,
        settings.missionControlMessageId ?? null,
        JSON.stringify(settings.baselineTaskIds),
      ],
    );
  }

  async readiness(): Promise<boolean> {
    try {
      await this.#pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async connectGitHubRepository(
    projectId: string,
    installationId: number,
    repositoryId: number,
    repositoryFullName: string,
  ): Promise<void> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const project = await client.query<{
        workspace_id: string;
        github_repository: string | null;
      }>("SELECT workspace_id, github_repository FROM projects WHERE id = $1 FOR UPDATE", [
        projectId,
      ]);
      const projectRow = project.rows[0];
      if (projectRow === undefined)
        throw new PersistenceError("NOT_FOUND", "Project was not found");
      if (
        projectRow.github_repository === null ||
        projectRow.github_repository.toLocaleLowerCase() !== repositoryFullName.toLocaleLowerCase()
      ) {
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "Repository does not match the project configuration",
        );
      }
      const installation = await client.query<{ workspace_id: string | null; status: string }>(
        "SELECT workspace_id, status FROM github_installations WHERE installation_id = $1 FOR UPDATE",
        [installationId],
      );
      const installationRow = installation.rows[0];
      if (installationRow === undefined || installationRow.status !== "ACTIVE")
        throw new PersistenceError(
          "NOT_FOUND",
          "Active GitHub installation was not discovered by a verified webhook",
        );
      if (
        installationRow.workspace_id !== null &&
        installationRow.workspace_id !== projectRow.workspace_id
      ) {
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "GitHub installation belongs to another workspace",
        );
      }
      const repository = await client.query<{
        installation_id: number | string;
        project_id: string | null;
        full_name: string;
        active: boolean;
      }>(
        "SELECT installation_id, project_id, full_name, active FROM github_repositories WHERE repository_id = $1 FOR UPDATE",
        [repositoryId],
      );
      const repositoryRow = repository.rows[0];
      if (
        repositoryRow === undefined ||
        !repositoryRow.active ||
        Number(repositoryRow.installation_id) !== installationId ||
        repositoryRow.full_name.toLocaleLowerCase() !== repositoryFullName.toLocaleLowerCase()
      ) {
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "Repository was not discovered for this active installation",
        );
      }
      if (repositoryRow.project_id !== null && repositoryRow.project_id !== projectId)
        throw new PersistenceError(
          "ALREADY_EXISTS",
          "Repository is already connected to another project",
        );
      await client.query(
        "UPDATE github_installations SET workspace_id = $2 WHERE installation_id = $1",
        [installationId, projectRow.workspace_id],
      );
      await client.query(
        "UPDATE github_repositories SET project_id = $2, updated_at = now() WHERE repository_id = $1",
        [repositoryId, projectId],
      );
      await client.query("COMMIT");
    } catch (error) {
      return rollbackNormalized(client, error);
    } finally {
      client.release();
    }
  }

  async addGitHubActivity(activity: GitHubActivityRecord): Promise<void> {
    const result = await this.#pool.query(
      `INSERT INTO github_activity
        (id, project_id, repository_id, task_id, kind, external_id, url, branch, changed_files, metadata, occurred_at)
       SELECT $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text, $6::text, $7::text, $8::text,
         $9::jsonb, $10::jsonb, $11::timestamptz
       WHERE $4::uuid IS NULL OR EXISTS (SELECT 1 FROM tasks WHERE id = $4 AND project_id = $2)
       ON CONFLICT (project_id, kind, external_id) DO UPDATE SET
         task_id = COALESCE(EXCLUDED.task_id, github_activity.task_id), url = COALESCE(EXCLUDED.url, github_activity.url),
         branch = COALESCE(EXCLUDED.branch, github_activity.branch), changed_files = EXCLUDED.changed_files,
          metadata = EXCLUDED.metadata, occurred_at = EXCLUDED.occurred_at
        WHERE github_activity.occurred_at <= EXCLUDED.occurred_at`,
      [
        activity.id,
        activity.projectId,
        activity.repositoryId ?? null,
        activity.taskId ?? null,
        activity.kind,
        activity.externalId,
        activity.url ?? null,
        activity.branch ?? null,
        JSON.stringify(activity.changedFiles),
        JSON.stringify(activity.metadata),
        activity.occurredAt,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new PersistenceError(
        "PROJECT_MISMATCH",
        "GitHub activity task belongs to another project",
      );
    }
  }

  async listGitHubActivity(
    projectId: string,
    limit = 100,
  ): Promise<readonly GitHubActivityRecord[]> {
    const result = await this.#pool.query<{
      id: string;
      project_id: string;
      repository_id: number | string | null;
      task_id: string | null;
      kind: string;
      external_id: string;
      url: string | null;
      branch: string | null;
      changed_files: unknown;
      metadata: unknown;
      occurred_at: Date;
    }>("SELECT * FROM github_activity WHERE project_id = $1 ORDER BY occurred_at DESC LIMIT $2", [
      projectId,
      limit,
    ]);
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      kind: row.kind,
      externalId: row.external_id,
      changedFiles: stringArray(row.changed_files),
      metadata: objectValue(row.metadata),
      occurredAt: new Date(row.occurred_at),
      ...(row.repository_id === null ? {} : { repositoryId: Number(row.repository_id) }),
      ...(row.task_id === null ? {} : { taskId: row.task_id }),
      ...(row.url === null ? {} : { url: row.url }),
      ...(row.branch === null ? {} : { branch: row.branch }),
    }));
  }

  async linkTaskToGitHub(
    projectId: string,
    taskId: string,
    repositoryId: number,
    linkKind: "BRANCH" | "PULL_REQUEST" | "ISSUE",
    externalId: string,
    now: Date,
  ): Promise<void> {
    const result = await this.#pool.query(
      `INSERT INTO task_github_links (task_id, repository_id, link_kind, external_id, created_at)
       SELECT task.id, repository.repository_id, $4::text, $5::text, $6::timestamptz
       FROM tasks task
       JOIN github_repositories repository ON repository.project_id = task.project_id AND repository.repository_id = $3 AND repository.active = true
       WHERE task.id = $2 AND task.project_id = $1
       ON CONFLICT DO NOTHING`,
      [projectId, taskId, repositoryId, linkKind, externalId, now],
    );
    if ((result.rowCount ?? 0) === 0) {
      const existing = await this.#pool.query(
        "SELECT 1 FROM task_github_links WHERE task_id = $1 AND repository_id = $2 AND link_kind = $3 AND external_id = $4",
        [taskId, repositoryId, linkKind, externalId],
      );
      if ((existing.rowCount ?? 0) === 0)
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "Task or connected repository does not belong to the project",
        );
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
