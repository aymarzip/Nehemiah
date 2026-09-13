import { DomainValidationError, DuplicateEntityError } from "../errors.js";
import {
  IMPACT_WEIGHTS,
  assertDate,
  assertFiniteNonNegative,
  assertNonEmpty,
  assertPositive,
  type Impact,
  type MilestoneId,
  type ProjectId,
  type TaskId,
  type TaskStatus,
  type TeamMemberId,
} from "./common.js";

export const TASK_EVIDENCE_KINDS = [
  "COMMIT",
  "PULL_REQUEST",
  "REVIEW",
  "CHECK_RUN",
  "TEST_RESULT",
  "BUILD",
  "ARTIFACT",
  "DEPLOYMENT",
  "MANUAL_VERIFICATION",
  "NOTE",
] as const;

export type TaskEvidenceKind = (typeof TASK_EVIDENCE_KINDS)[number];

export interface TaskEvidenceInput {
  id: string;
  taskId: TaskId;
  kind: TaskEvidenceKind;
  summary: string;
  uri?: string | undefined;
  externalId?: string | undefined;
  recordedBy?: TeamMemberId | undefined;
  recordedAt?: Date | undefined;
  metadata?: Readonly<Record<string, string | number | boolean | null>> | undefined;
}

export class TaskEvidence {
  public readonly id: string;
  public readonly taskId: TaskId;
  public readonly kind: TaskEvidenceKind;
  public readonly summary: string;
  public readonly uri?: string | undefined;
  public readonly externalId?: string | undefined;
  public readonly recordedBy: TeamMemberId;
  public readonly recordedAt: Date;
  public readonly metadata: Readonly<Record<string, string | number | boolean | null>>;

  public constructor(input: TaskEvidenceInput) {
    this.id = assertNonEmpty(input.id, "taskEvidence.id");
    this.taskId = assertNonEmpty(input.taskId, "taskEvidence.taskId");
    this.kind = input.kind;
    this.summary = assertNonEmpty(input.summary, "taskEvidence.summary");
    this.uri = input.uri === undefined ? undefined : assertNonEmpty(input.uri, "taskEvidence.uri");
    this.externalId =
      input.externalId === undefined
        ? undefined
        : assertNonEmpty(input.externalId, "taskEvidence.externalId");
    this.recordedBy = input.recordedBy ?? "SYSTEM";
    this.recordedAt = assertDate(input.recordedAt ?? new Date(), "taskEvidence.recordedAt");
    this.metadata = Object.freeze({ ...(input.metadata ?? {}) });
    Object.freeze(this);
  }
}

export type DependencyRequiredStatus = "IMPLEMENTED" | "VERIFIED" | "INTEGRATED" | "SHIPPED";

export interface TaskDependencyInput {
  id?: string | undefined;
  projectId: ProjectId;
  dependencyTaskId: TaskId;
  dependantTaskId: TaskId;
  requiredStatus?: DependencyRequiredStatus | undefined;
  rationale?: string | undefined;
}

export class TaskDependency {
  public readonly id: string;
  public readonly projectId: ProjectId;
  public readonly dependencyTaskId: TaskId;
  public readonly dependantTaskId: TaskId;
  public readonly requiredStatus: DependencyRequiredStatus;
  public readonly rationale: string;

  public constructor(input: TaskDependencyInput) {
    this.projectId = assertNonEmpty(input.projectId, "taskDependency.projectId");
    this.dependencyTaskId = assertNonEmpty(
      input.dependencyTaskId,
      "taskDependency.dependencyTaskId",
    );
    this.dependantTaskId = assertNonEmpty(input.dependantTaskId, "taskDependency.dependantTaskId");
    if (this.dependencyTaskId === this.dependantTaskId) {
      throw new DomainValidationError("A task cannot depend on itself", {
        taskId: this.dependencyTaskId,
      });
    }
    this.requiredStatus = input.requiredStatus ?? "VERIFIED";
    this.id = assertNonEmpty(
      input.id ?? `${this.dependencyTaskId}->${this.dependantTaskId}`,
      "taskDependency.id",
    );
    this.rationale = input.rationale?.trim() ?? "";
    Object.freeze(this);
  }
}

export interface TaskInput {
  id: TaskId;
  projectId: ProjectId;
  title: string;
  description?: string | undefined;
  expectedOutcome?: string | undefined;
  ownerRole?: string | undefined;
  riskLevel?: Impact | undefined;
  verificationRequirements?: readonly string[] | undefined;
  suggestedEvidence?: readonly TaskEvidenceKind[] | undefined;
  component?: string | undefined;
  deadlineCriticality?: "OPTIONAL" | "IMPORTANT" | "CRITICAL" | undefined;
  scopeTier?: "MUST" | "SHOULD" | "NICE" | undefined;
  status?: TaskStatus | undefined;
  impact?: Impact | undefined;
  weight?: number | undefined;
  estimatedEffortHours?: number | undefined;
  ownerId?: TeamMemberId | undefined;
  milestoneId?: MilestoneId | undefined;
  dueAt?: Date | undefined;
  releaseRequired?: boolean | undefined;
  evidence?: readonly TaskEvidence[] | undefined;
  blockReason?: string | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
  tags?: readonly string[] | undefined;
}

export interface TaskChanges {
  title?: string | undefined;
  description?: string | undefined;
  expectedOutcome?: string | undefined;
  status?: TaskStatus | undefined;
  impact?: Impact | undefined;
  weight?: number | undefined;
  estimatedEffortHours?: number | undefined;
  ownerId?: TeamMemberId | undefined;
  milestoneId?: MilestoneId | undefined;
  dueAt?: Date | undefined;
  releaseRequired?: boolean | undefined;
  evidence?: readonly TaskEvidence[] | undefined;
  blockReason?: string | undefined;
  updatedAt?: Date | undefined;
  tags?: readonly string[] | undefined;
}

export class Task {
  public readonly id: TaskId;
  public readonly projectId: ProjectId;
  public readonly title: string;
  public readonly description: string;
  public readonly expectedOutcome: string;
  public readonly ownerRole?: string | undefined;
  public readonly riskLevel: Impact;
  public readonly verificationRequirements: readonly string[];
  public readonly suggestedEvidence: readonly TaskEvidenceKind[];
  public readonly component?: string | undefined;
  public readonly deadlineCriticality: "OPTIONAL" | "IMPORTANT" | "CRITICAL";
  public readonly scopeTier: "MUST" | "SHOULD" | "NICE";
  public readonly status: TaskStatus;
  public readonly impact: Impact;
  public readonly weight: number;
  public readonly estimatedEffortHours: number;
  public readonly ownerId?: TeamMemberId | undefined;
  public readonly milestoneId?: MilestoneId | undefined;
  public readonly dueAt?: Date | undefined;
  public readonly releaseRequired: boolean;
  public readonly evidence: readonly TaskEvidence[];
  public readonly blockReason?: string | undefined;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;
  public readonly tags: readonly string[];

  public constructor(input: TaskInput) {
    this.id = assertNonEmpty(input.id, "task.id");
    this.projectId = assertNonEmpty(input.projectId, "task.projectId");
    this.title = assertNonEmpty(input.title, "task.title");
    this.description = input.description?.trim() ?? "";
    this.expectedOutcome = input.expectedOutcome?.trim() ?? this.description;
    this.ownerRole = input.ownerRole?.trim() || undefined;
    this.riskLevel = input.riskLevel ?? input.impact ?? "MEDIUM";
    this.verificationRequirements = Object.freeze(
      (input.verificationRequirements ?? []).map((requirement, index) =>
        assertNonEmpty(requirement, `task.verificationRequirements[${index}]`),
      ),
    );
    this.suggestedEvidence = Object.freeze([...new Set(input.suggestedEvidence ?? [])]);
    this.component = input.component?.trim() || undefined;
    this.deadlineCriticality = input.deadlineCriticality ?? "IMPORTANT";
    this.scopeTier = input.scopeTier ?? "MUST";
    this.status = input.status ?? "PLANNED";
    this.impact = input.impact ?? "MEDIUM";
    this.weight = assertPositive(input.weight ?? 1, "task.weight");
    this.estimatedEffortHours = assertFiniteNonNegative(
      input.estimatedEffortHours ?? 0,
      "task.estimatedEffortHours",
    );
    this.ownerId =
      input.ownerId === undefined ? undefined : assertNonEmpty(input.ownerId, "task.ownerId");
    this.milestoneId =
      input.milestoneId === undefined
        ? undefined
        : assertNonEmpty(input.milestoneId, "task.milestoneId");
    this.dueAt = input.dueAt === undefined ? undefined : assertDate(input.dueAt, "task.dueAt");
    this.releaseRequired = input.releaseRequired ?? true;
    const evidenceIds = new Set<string>();
    for (const item of input.evidence ?? []) {
      if (item.taskId !== this.id) {
        throw new DomainValidationError("Task evidence belongs to another task", {
          taskId: this.id,
          evidenceId: item.id,
          evidenceTaskId: item.taskId,
        });
      }
      if (evidenceIds.has(item.id)) throw new DuplicateEntityError("TaskEvidence", item.id);
      evidenceIds.add(item.id);
    }
    this.evidence = Object.freeze([...(input.evidence ?? [])]);
    if (this.status === "BLOCKED") {
      this.blockReason = assertNonEmpty(input.blockReason ?? "", "task.blockReason");
    } else {
      this.blockReason = undefined;
    }
    this.createdAt = assertDate(input.createdAt ?? new Date(), "task.createdAt");
    this.updatedAt = assertDate(input.updatedAt ?? this.createdAt, "task.updatedAt");
    if (this.updatedAt < this.createdAt) {
      throw new DomainValidationError("task.updatedAt cannot precede createdAt");
    }
    this.tags = Object.freeze(
      [...new Set(input.tags ?? [])].map((tag, index) =>
        assertNonEmpty(tag, `task.tags[${index}]`),
      ),
    );
    Object.freeze(this);
  }

  public get impactWeight(): number {
    return IMPACT_WEIGHTS[this.impact];
  }

  public get weightedEffort(): number {
    return this.estimatedEffortHours * this.weight * this.impactWeight;
  }

  public get isCritical(): boolean {
    return this.impact === "CRITICAL";
  }

  public with(changes: TaskChanges): Task {
    return new Task({
      id: this.id,
      projectId: this.projectId,
      title: changes.title ?? this.title,
      description: changes.description ?? this.description,
      expectedOutcome: changes.expectedOutcome ?? this.expectedOutcome,
      ownerRole: this.ownerRole,
      riskLevel: this.riskLevel,
      verificationRequirements: this.verificationRequirements,
      suggestedEvidence: this.suggestedEvidence,
      component: this.component,
      deadlineCriticality: this.deadlineCriticality,
      scopeTier: this.scopeTier,
      status: changes.status ?? this.status,
      impact: changes.impact ?? this.impact,
      weight: changes.weight ?? this.weight,
      estimatedEffortHours: changes.estimatedEffortHours ?? this.estimatedEffortHours,
      ownerId: Object.prototype.hasOwnProperty.call(changes, "ownerId")
        ? changes.ownerId
        : this.ownerId,
      milestoneId: Object.prototype.hasOwnProperty.call(changes, "milestoneId")
        ? changes.milestoneId
        : this.milestoneId,
      dueAt: Object.prototype.hasOwnProperty.call(changes, "dueAt") ? changes.dueAt : this.dueAt,
      releaseRequired: changes.releaseRequired ?? this.releaseRequired,
      evidence: changes.evidence ?? this.evidence,
      blockReason: Object.prototype.hasOwnProperty.call(changes, "blockReason")
        ? changes.blockReason
        : this.blockReason,
      createdAt: this.createdAt,
      updatedAt: changes.updatedAt ?? this.updatedAt,
      tags: changes.tags ?? this.tags,
    });
  }

  public addEvidence(item: TaskEvidence, now = item.recordedAt): Task {
    if (item.taskId !== this.id) {
      throw new DomainValidationError("Task evidence belongs to another task", {
        taskId: this.id,
        evidenceTaskId: item.taskId,
      });
    }
    if (this.evidence.some((existing) => existing.id === item.id)) {
      throw new DuplicateEntityError("TaskEvidence", item.id);
    }
    return this.with({ evidence: [...this.evidence, item], updatedAt: now });
  }
}

const DEPENDENCY_STATUS_RANK: Readonly<Partial<Record<TaskStatus, number>>> = Object.freeze({
  IMPLEMENTED: 1,
  VERIFIED: 2,
  INTEGRATED: 3,
  SHIPPED: 4,
});

export function dependencyIsSatisfied(
  dependencyTask: Pick<Task, "status">,
  requiredStatus: DependencyRequiredStatus,
): boolean {
  const actualRank = DEPENDENCY_STATUS_RANK[dependencyTask.status] ?? -1;
  const requiredRank = DEPENDENCY_STATUS_RANK[requiredStatus] ?? Number.POSITIVE_INFINITY;
  return actualRank >= requiredRank;
}
