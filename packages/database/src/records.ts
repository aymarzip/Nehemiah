export type ProjectModeRecord = "STANDARD" | "GAME_JAM";
export type ProjectStatusRecord = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type TaskStatusRecord =
  | "PLANNED"
  | "READY"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "IMPLEMENTED"
  | "VERIFIED"
  | "INTEGRATED"
  | "SHIPPED"
  | "CANCELLED";
export type ImpactRecord = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ProjectSetupInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly ownerMemberId: string;
  readonly workspaceName: string;
  readonly discordGuildId?: string;
  readonly ownerExternalUserId: string;
  readonly ownerDisplayName: string;
  readonly name: string;
  readonly description: string;
  readonly vision: string;
  readonly visionDetails?: ProjectVisionDetailsRecord;
  readonly successCriteria?: readonly string[];
  readonly nonGoals?: readonly string[];
  readonly deadline: Date;
  readonly timezone: string;
  readonly mode: ProjectModeRecord;
  readonly githubRepository?: string;
  readonly constraints?: readonly string[];
  readonly createdAt: Date;
}

export interface ProjectRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly discordGuildId?: string;
  readonly name: string;
  readonly description: string;
  readonly vision: string;
  readonly visionDetails: ProjectVisionDetailsRecord;
  readonly successCriteria: readonly string[];
  readonly nonGoals: readonly string[];
  readonly deadline: Date;
  readonly timezone: string;
  readonly mode: ProjectModeRecord;
  readonly status: ProjectStatusRecord;
  readonly githubRepository?: string;
  readonly constraints: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TeamMemberProfileInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly externalUserId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly skills: readonly { readonly name: string; readonly level: number }[];
  readonly availability: Readonly<Record<string, unknown>>;
  readonly communicationPreferences: Readonly<Record<string, unknown>>;
  readonly aiToolProfiles: readonly Readonly<Record<string, unknown>>[];
  readonly now: Date;
}

export interface TeamMemberRecord extends Omit<TeamMemberProfileInput, "now"> {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TaskCreateInput {
  readonly id: string;
  readonly projectId: string;
  readonly milestoneId?: string;
  readonly ownerMemberId?: string;
  readonly title: string;
  readonly description: string;
  readonly expectedOutcome?: string;
  readonly ownerRole?: string;
  readonly riskLevel?: ImpactRecord;
  readonly verificationRequirements?: readonly string[];
  readonly suggestedEvidence?: readonly string[];
  readonly component?: string;
  readonly deadlineCriticality?: "OPTIONAL" | "IMPORTANT" | "CRITICAL";
  readonly scopeTier?: "MUST" | "SHOULD" | "NICE";
  readonly releaseRequired?: boolean;
  readonly status?: TaskStatusRecord;
  readonly impact: ImpactRecord;
  readonly weight: number;
  readonly estimatedEffortHours: number;
  readonly dueAt?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

export interface MilestoneRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly dueAt: Date;
  readonly status: "PLANNED" | "ACTIVE" | "ACHIEVED" | "MISSED" | "CANCELLED";
  readonly completionCriteria: readonly string[];
  readonly createdAt: Date;
}

export interface TaskRecord extends Omit<TaskCreateInput, "now" | "status"> {
  readonly status: TaskStatusRecord;
  readonly dependencyIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TaskPlanCreateInput {
  readonly projectId: string;
  readonly tasks: readonly TaskCreateInput[];
  readonly dependencies: readonly {
    readonly taskId: string;
    readonly dependsOnTaskId: string;
  }[];
}

export interface TaskEvidenceRecord {
  readonly id: string;
  readonly taskId: string;
  readonly kind: string;
  readonly uri?: string;
  readonly externalId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly summary: string;
  readonly verified: boolean;
  readonly submittedBy?: string;
  readonly createdAt: Date;
}

export interface TaskTransitionPersistenceInput {
  readonly taskId: string;
  /** Optimistic concurrency guard for the domain snapshot that was validated. */
  readonly expectedStatus: TaskStatusRecord;
  readonly expectedUpdatedAt: Date;
  readonly status: TaskStatusRecord;
  readonly now: Date;
  readonly blockReason?: string;
  readonly evidence?: readonly TaskEvidenceRecord[];
}

export type MemoryCategoryRecord =
  | "FACT"
  | "DECISION"
  | "CONSTRAINT"
  | "ARCHITECTURE"
  | "REQUIREMENT"
  | "TEAM"
  | "RISK"
  | "LESSON";

export interface MemoryEntryRecord {
  readonly id: string;
  readonly projectId: string;
  readonly category: MemoryCategoryRecord;
  readonly title: string;
  readonly content: string;
  readonly confidence: number;
  readonly createdAt: Date;
}

export interface ProjectVisionDetailsRecord {
  readonly problem: string;
  readonly targetOutcome: string;
  readonly coreExperience: string;
  readonly mustHaveScope: readonly string[];
  readonly shouldHaveScope: readonly string[];
  readonly niceToHaveScope: readonly string[];
  readonly excludedScope: readonly string[];
}

export interface VisionRevisionRecord extends ProjectVisionDetailsRecord {
  readonly id: string;
  readonly projectId: string;
  readonly statement: string;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly string[];
  readonly status: "PROPOSED" | "APPROVED" | "REJECTED";
  readonly proposedBy: string;
  readonly approvedBy?: string;
  readonly decisionId?: string;
  readonly createdAt: Date;
  readonly approvedAt?: Date;
}

export interface DecisionRecord {
  readonly id: string;
  readonly projectId: string;
  readonly type:
    | "GENERAL"
    | "SCOPE_CHANGE"
    | "ARCHITECTURE"
    | "DEADLINE_CHANGE"
    | "ASSIGNMENT"
    | "RISK_ACCEPTANCE"
    | "OVERRIDE";
  readonly title: string;
  readonly description: string;
  readonly context: string;
  readonly rationale: string;
  readonly outcome: string;
  readonly alternatives: readonly string[];
  readonly affectedTaskIds: readonly string[];
  readonly affectedComponents: readonly string[];
  readonly status: "PROPOSED" | "ACCEPTED" | "SUPERSEDED" | "REJECTED";
  readonly authorMemberId?: string;
  readonly approvedByMemberId?: string;
  readonly supersedesDecisionId?: string;
  readonly supersededByDecisionId?: string;
  readonly createdAt: Date;
  readonly approvedAt?: Date;
}

export interface BlockerRecord {
  readonly id: string;
  readonly projectId: string;
  readonly description: string;
  readonly source: "HUMAN" | "TASK" | "GITHUB" | "CI" | "INTEGRATION" | "SYSTEM";
  readonly severity: ImpactRecord;
  readonly blockedTaskId?: string;
  readonly blockingTaskId?: string;
  readonly blockedMemberId?: string;
  readonly suggestedResolution: string;
  readonly createdBy?: string;
  readonly createdAt: Date;
  readonly resolvedAt?: Date;
  readonly resolvedBy?: string;
}

export interface AssignmentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly memberId: string;
  readonly reasons: readonly string[];
  readonly score: number;
  readonly confidence: number;
  readonly automatic: boolean;
  readonly approvedBy?: string;
  readonly createdAt: Date;
}

export interface RiskSnapshotRecord {
  readonly id: string;
  readonly projectId: string;
  readonly score: number;
  readonly severity: string;
  readonly signals: readonly Readonly<Record<string, unknown>>[];
  readonly changes: readonly Readonly<Record<string, unknown>>[];
  readonly capturedAt: Date;
}

export interface ProjectSettingsRecord {
  readonly projectId: string;
  readonly checkpointCadenceHours: number;
  readonly notificationPolicy: "IMMEDIATE_CRITICAL" | "BATCHED" | "CHECKPOINT_ONLY";
  readonly missionControlChannelId?: string;
  readonly missionControlMessageId?: string;
  readonly baselineTaskIds: readonly string[];
}

export interface GitHubActivityRecord {
  readonly id: string;
  readonly projectId: string;
  readonly repositoryId?: number;
  readonly taskId?: string;
  readonly kind: string;
  readonly externalId: string;
  readonly url?: string;
  readonly branch?: string;
  readonly changedFiles: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface ProjectStore {
  readiness(): Promise<boolean>;
  setupProject(input: ProjectSetupInput): Promise<ProjectRecord>;
  getProject(projectId: string): Promise<ProjectRecord | undefined>;
  getProjectByGuild(discordGuildId: string): Promise<ProjectRecord | undefined>;
  joinTeam(input: TeamMemberProfileInput): Promise<TeamMemberRecord>;
  getTeamMember(workspaceId: string, externalUserId: string): Promise<TeamMemberRecord | undefined>;
  createMilestone(milestone: MilestoneRecord): Promise<void>;
  listMilestones(projectId: string): Promise<readonly MilestoneRecord[]>;
  createTask(input: TaskCreateInput): Promise<TaskRecord>;
  createTaskPlan(input: TaskPlanCreateInput): Promise<readonly TaskRecord[]>;
  getTask(taskId: string): Promise<TaskRecord | undefined>;
  addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
  listTasks(projectId: string): Promise<readonly TaskRecord[]>;
  listMemberTasks(projectId: string, memberId: string): Promise<readonly TaskRecord[]>;
  applyTaskTransition(input: TaskTransitionPersistenceInput): Promise<TaskRecord>;
  addTaskEvidence(evidence: TaskEvidenceRecord): Promise<void>;
  listTaskEvidence(taskId: string): Promise<readonly TaskEvidenceRecord[]>;
  listProjectTaskEvidence(projectId: string): Promise<readonly TaskEvidenceRecord[]>;
  addMemoryEntry(entry: MemoryEntryRecord): Promise<void>;
  listMemory(
    projectId: string,
    categories?: readonly MemoryCategoryRecord[],
    limit?: number,
  ): Promise<readonly MemoryEntryRecord[]>;
  listTeamMembers(workspaceId: string): Promise<readonly TeamMemberRecord[]>;
  updateCommunicationPreferences(
    workspaceId: string,
    externalUserId: string,
    preferences: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<TeamMemberRecord>;
  addVisionRevision(revision: VisionRevisionRecord): Promise<void>;
  listVisionRevisions(projectId: string): Promise<readonly VisionRevisionRecord[]>;
  approveVisionRevision(
    revisionId: string,
    approvedBy: string,
    decision: DecisionRecord,
    now: Date,
  ): Promise<VisionRevisionRecord>;
  addDecision(decision: DecisionRecord): Promise<void>;
  getDecision(projectId: string, decisionId: string): Promise<DecisionRecord | undefined>;
  listDecisions(projectId: string, limit?: number): Promise<readonly DecisionRecord[]>;
  approveDecision(decisionId: string, approvedBy: string, now: Date): Promise<DecisionRecord>;
  addBlocker(blocker: BlockerRecord): Promise<void>;
  listBlockers(projectId: string, includeResolved?: boolean): Promise<readonly BlockerRecord[]>;
  resolveBlocker(blockerId: string, resolvedBy: string, now: Date): Promise<BlockerRecord>;
  assignTask(assignment: AssignmentRecord, now: Date): Promise<TaskRecord>;
  listAssignments(projectId: string, taskId?: string): Promise<readonly AssignmentRecord[]>;
  addRiskSnapshot(snapshot: RiskSnapshotRecord): Promise<void>;
  listRiskSnapshots(projectId: string, limit?: number): Promise<readonly RiskSnapshotRecord[]>;
  getProjectSettings(projectId: string): Promise<ProjectSettingsRecord>;
  saveProjectSettings(settings: ProjectSettingsRecord): Promise<void>;
  connectGitHubRepository(
    projectId: string,
    installationId: number,
    repositoryId: number,
    repositoryFullName: string,
  ): Promise<void>;
  addGitHubActivity(activity: GitHubActivityRecord): Promise<void>;
  listGitHubActivity(projectId: string, limit?: number): Promise<readonly GitHubActivityRecord[]>;
  linkTaskToGitHub(
    projectId: string,
    taskId: string,
    repositoryId: number,
    linkKind: "BRANCH" | "PULL_REQUEST" | "ISSUE",
    externalId: string,
    now: Date,
  ): Promise<void>;
  close(): Promise<void>;
}
