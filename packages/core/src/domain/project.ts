import { DomainValidationError } from "../errors.js";
import {
  assertDate,
  assertNonEmpty,
  assertFiniteNonNegative,
  type MilestoneId,
  type ProjectId,
  type ProjectMode,
  type ProjectStatus,
  type TaskId,
  type TeamMemberId,
  type WorkspaceId,
} from "./common.js";

export interface ProjectVisionInput {
  statement: string;
  problem?: string | undefined;
  targetOutcome?: string | undefined;
  coreExperience?: string | undefined;
  mustHaveScope?: readonly string[] | undefined;
  shouldHaveScope?: readonly string[] | undefined;
  niceToHaveScope?: readonly string[] | undefined;
  excludedScope?: readonly string[] | undefined;
  constraints?: readonly string[] | undefined;
  successCriteria?: readonly string[] | undefined;
  nonGoals?: readonly string[] | undefined;
}

export class ProjectVision {
  public readonly statement: string;
  public readonly problem: string;
  public readonly targetOutcome: string;
  public readonly coreExperience: string;
  public readonly mustHaveScope: readonly string[];
  public readonly shouldHaveScope: readonly string[];
  public readonly niceToHaveScope: readonly string[];
  public readonly excludedScope: readonly string[];
  public readonly constraints: readonly string[];
  public readonly successCriteria: readonly string[];
  public readonly nonGoals: readonly string[];

  public constructor(input: ProjectVisionInput) {
    this.statement = assertNonEmpty(input.statement, "projectVision.statement");
    this.problem = input.problem?.trim() ?? "";
    this.targetOutcome = input.targetOutcome?.trim() ?? this.statement;
    this.coreExperience = input.coreExperience?.trim() ?? "";
    const scope = (values: readonly string[] | undefined, name: string): readonly string[] =>
      Object.freeze(
        (values ?? []).map((value, index) =>
          assertNonEmpty(value, `projectVision.${name}[${index}]`),
        ),
      );
    this.mustHaveScope = scope(input.mustHaveScope, "mustHaveScope");
    this.shouldHaveScope = scope(input.shouldHaveScope, "shouldHaveScope");
    this.niceToHaveScope = scope(input.niceToHaveScope, "niceToHaveScope");
    this.excludedScope = scope(input.excludedScope ?? input.nonGoals, "excludedScope");
    this.constraints = scope(input.constraints, "constraints");
    this.successCriteria = Object.freeze(
      (input.successCriteria ?? []).map((criterion, index) =>
        assertNonEmpty(criterion, `projectVision.successCriteria[${index}]`),
      ),
    );
    this.nonGoals = Object.freeze(
      (input.nonGoals ?? []).map((nonGoal, index) =>
        assertNonEmpty(nonGoal, `projectVision.nonGoals[${index}]`),
      ),
    );
    Object.freeze(this);
  }
}

export interface WorkspaceInput {
  id: WorkspaceId;
  name: string;
  ownerId: TeamMemberId;
  memberIds?: readonly TeamMemberId[] | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export class Workspace {
  public readonly id: WorkspaceId;
  public readonly name: string;
  public readonly ownerId: TeamMemberId;
  public readonly memberIds: readonly TeamMemberId[];
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  public constructor(input: WorkspaceInput) {
    this.id = assertNonEmpty(input.id, "workspace.id");
    this.name = assertNonEmpty(input.name, "workspace.name");
    this.ownerId = assertNonEmpty(input.ownerId, "workspace.ownerId");
    this.memberIds = Object.freeze([...new Set([this.ownerId, ...(input.memberIds ?? [])])]);
    this.createdAt = assertDate(input.createdAt ?? new Date(), "workspace.createdAt");
    this.updatedAt = assertDate(input.updatedAt ?? this.createdAt, "workspace.updatedAt");
    if (this.updatedAt < this.createdAt) {
      throw new DomainValidationError("workspace.updatedAt cannot precede createdAt");
    }
    Object.freeze(this);
  }

  public withMember(memberId: TeamMemberId, now = new Date()): Workspace {
    return new Workspace({
      ...this,
      memberIds: [...this.memberIds, assertNonEmpty(memberId, "memberId")],
      updatedAt: now,
    });
  }
}

export interface ProjectInput {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  description: string;
  vision: ProjectVision | ProjectVisionInput;
  deadline: Date;
  timezone: string;
  mode?: ProjectMode | undefined;
  status?: ProjectStatus | undefined;
  constraints?: readonly string[] | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export class Project {
  public readonly id: ProjectId;
  public readonly workspaceId: WorkspaceId;
  public readonly name: string;
  public readonly description: string;
  public readonly vision: ProjectVision;
  public readonly deadline: Date;
  public readonly timezone: string;
  public readonly mode: ProjectMode;
  public readonly status: ProjectStatus;
  public readonly constraints: readonly string[];
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  public constructor(input: ProjectInput) {
    this.id = assertNonEmpty(input.id, "project.id");
    this.workspaceId = assertNonEmpty(input.workspaceId, "project.workspaceId");
    this.name = assertNonEmpty(input.name, "project.name");
    this.description = assertNonEmpty(input.description, "project.description");
    this.vision =
      input.vision instanceof ProjectVision ? input.vision : new ProjectVision(input.vision);
    this.deadline = assertDate(input.deadline, "project.deadline");
    this.timezone = assertNonEmpty(input.timezone, "project.timezone");
    this.mode = input.mode ?? "STANDARD";
    this.status = input.status ?? "DRAFT";
    this.constraints = Object.freeze(
      (input.constraints ?? []).map((constraint, index) =>
        assertNonEmpty(constraint, `project.constraints[${index}]`),
      ),
    );
    this.createdAt = assertDate(input.createdAt ?? new Date(), "project.createdAt");
    this.updatedAt = assertDate(input.updatedAt ?? this.createdAt, "project.updatedAt");
    if (this.deadline <= this.createdAt) {
      throw new DomainValidationError("project.deadline must be after createdAt", {
        deadline: this.deadline,
        createdAt: this.createdAt,
      });
    }
    if (this.updatedAt < this.createdAt) {
      throw new DomainValidationError("project.updatedAt cannot precede createdAt");
    }
    Object.freeze(this);
  }

  public withStatus(status: ProjectStatus, now = new Date()): Project {
    return new Project({ ...this, status, updatedAt: now });
  }
}

export type MilestoneStatus = "PLANNED" | "ACTIVE" | "ACHIEVED" | "MISSED" | "CANCELLED";

export interface MilestoneInput {
  id: MilestoneId;
  projectId: ProjectId;
  name: string;
  description?: string | undefined;
  dueAt: Date;
  status?: MilestoneStatus | undefined;
  taskIds?: readonly TaskId[] | undefined;
  completionCriteria?: readonly string[] | undefined;
}

export class Milestone {
  public readonly id: MilestoneId;
  public readonly projectId: ProjectId;
  public readonly name: string;
  public readonly description: string;
  public readonly dueAt: Date;
  public readonly status: MilestoneStatus;
  public readonly taskIds: readonly TaskId[];
  public readonly completionCriteria: readonly string[];

  public constructor(input: MilestoneInput) {
    this.id = assertNonEmpty(input.id, "milestone.id");
    this.projectId = assertNonEmpty(input.projectId, "milestone.projectId");
    this.name = assertNonEmpty(input.name, "milestone.name");
    this.description = input.description?.trim() ?? "";
    this.dueAt = assertDate(input.dueAt, "milestone.dueAt");
    this.status = input.status ?? "PLANNED";
    this.taskIds = Object.freeze([...new Set(input.taskIds ?? [])]);
    this.completionCriteria = Object.freeze(
      (input.completionCriteria ?? []).map((criterion, index) =>
        assertNonEmpty(criterion, `milestone.completionCriteria[${index}]`),
      ),
    );
    Object.freeze(this);
  }

  public completionRatio(completedTaskIds: ReadonlySet<TaskId>): number {
    if (this.taskIds.length === 0) return 0;
    return (
      this.taskIds.filter((taskId) => completedTaskIds.has(taskId)).length / this.taskIds.length
    );
  }
}

export interface CapacityPlan {
  availableHours: number;
  committedHours: number;
}

export function remainingCapacity(plan: CapacityPlan): number {
  return Math.max(
    0,
    assertFiniteNonNegative(plan.availableHours, "capacity.availableHours") -
      assertFiniteNonNegative(plan.committedHours, "capacity.committedHours"),
  );
}
