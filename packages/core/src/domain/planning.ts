import { DomainValidationError } from "../errors.js";
import {
  assertDate,
  assertFiniteNonNegative,
  assertNonEmpty,
  type Impact,
  type ProjectId,
  type TaskId,
  type TeamMemberId,
} from "./common.js";

export type BlockerSource = "HUMAN" | "TASK" | "GITHUB" | "CI" | "INTEGRATION" | "SYSTEM";
export type BlockerStatus = "OPEN" | "RESOLVED";

export interface BlockerInput {
  id: string;
  projectId: ProjectId;
  description: string;
  source: BlockerSource;
  severity: Impact;
  blockedTaskId?: TaskId | undefined;
  blockingTaskId?: TaskId | undefined;
  blockedMemberId?: TeamMemberId | undefined;
  suggestedResolution?: string | undefined;
  createdAt?: Date | undefined;
  resolvedAt?: Date | undefined;
  resolvedBy?: TeamMemberId | undefined;
}

export class Blocker {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly description: string;
  readonly source: BlockerSource;
  readonly severity: Impact;
  readonly blockedTaskId?: TaskId | undefined;
  readonly blockingTaskId?: TaskId | undefined;
  readonly blockedMemberId?: TeamMemberId | undefined;
  readonly suggestedResolution: string;
  readonly status: BlockerStatus;
  readonly createdAt: Date;
  readonly resolvedAt?: Date | undefined;
  readonly resolvedBy?: TeamMemberId | undefined;

  constructor(input: BlockerInput) {
    this.id = assertNonEmpty(input.id, "blocker.id");
    this.projectId = assertNonEmpty(input.projectId, "blocker.projectId");
    this.description = assertNonEmpty(input.description, "blocker.description");
    this.source = input.source;
    this.severity = input.severity;
    this.blockedTaskId = input.blockedTaskId;
    this.blockingTaskId = input.blockingTaskId;
    this.blockedMemberId = input.blockedMemberId;
    this.suggestedResolution = input.suggestedResolution?.trim() ?? "";
    this.createdAt = assertDate(input.createdAt ?? new Date(), "blocker.createdAt");
    this.resolvedAt =
      input.resolvedAt === undefined
        ? undefined
        : assertDate(input.resolvedAt, "blocker.resolvedAt");
    this.resolvedBy = input.resolvedBy;
    this.status = this.resolvedAt === undefined ? "OPEN" : "RESOLVED";
    if (this.resolvedBy !== undefined && this.resolvedAt === undefined) {
      throw new DomainValidationError("A blocker resolver requires resolvedAt");
    }
    Object.freeze(this);
  }

  resolve(resolvedBy: TeamMemberId, at = new Date()): Blocker {
    if (this.status === "RESOLVED") return this;
    return new Blocker({ ...this, resolvedBy, resolvedAt: at });
  }
}

export interface AICapacityDimensionsInput {
  implementationThroughput?: number | undefined;
  reviewCapacity?: number | undefined;
  integrationCapacity?: number | undefined;
  observedRework?: number | undefined;
  contextSwitchCost?: number | undefined;
  reliability?: number | undefined;
  confidence?: number | undefined;
}

export class AICapacityDimensions {
  readonly implementationThroughput: number;
  readonly reviewCapacity: number;
  readonly integrationCapacity: number;
  readonly observedRework: number;
  readonly contextSwitchCost: number;
  readonly reliability: number;
  readonly confidence: number;

  constructor(input: AICapacityDimensionsInput = {}) {
    const bounded = (value: number | undefined, fallback: number, name: string): number => {
      const result = assertFiniteNonNegative(value ?? fallback, name);
      if (result > 1) throw new DomainValidationError(`${name} must be within 0..1`);
      return result;
    };
    this.implementationThroughput = bounded(
      input.implementationThroughput,
      0.15,
      "capacity.implementationThroughput",
    );
    this.reviewCapacity = bounded(input.reviewCapacity, 0.1, "capacity.reviewCapacity");
    this.integrationCapacity = bounded(
      input.integrationCapacity,
      0.05,
      "capacity.integrationCapacity",
    );
    this.observedRework = bounded(input.observedRework, 0.2, "capacity.observedRework");
    this.contextSwitchCost = bounded(input.contextSwitchCost, 0.2, "capacity.contextSwitchCost");
    this.reliability = bounded(input.reliability, 0.5, "capacity.reliability");
    this.confidence = bounded(input.confidence, 0.2, "capacity.confidence");
    Object.freeze(this);
  }

  /** Conservative multiplier: AI assistance can help, but never creates extra people. */
  effectiveImplementationMultiplier(): number {
    const observedBoost =
      this.implementationThroughput * this.reliability * this.confidence -
      this.observedRework * 0.25 -
      this.contextSwitchCost * 0.15;
    return Math.max(0.75, Math.min(1.35, 1 + observedBoost));
  }
}

export interface AssignmentRecord {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly memberId: TeamMemberId;
  readonly reasons: readonly string[];
  readonly score: number;
  readonly confidence: number;
  readonly automatic: boolean;
  readonly approvedBy?: TeamMemberId | undefined;
  readonly createdAt: Date;
}

export interface RiskHistoryEntry {
  readonly projectId: ProjectId;
  readonly previousScore: number;
  readonly score: number;
  readonly changedAt: Date;
  readonly changes: readonly {
    readonly signal: string;
    readonly delta: number;
    readonly evidence: string;
  }[];
}
