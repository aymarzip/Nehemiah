import { DomainValidationError } from "../errors.js";
import {
  assertDate,
  assertFiniteNonNegative,
  assertNonEmpty,
  clamp,
  type DecisionId,
  type IntegrationId,
  type ProjectCheckpointId,
  type ProjectEventId,
  type ProjectId,
  type RiskId,
  type TaskId,
  type TeamMemberId,
} from "./common.js";

export type DecisionStatus = "PROPOSED" | "ACCEPTED" | "SUPERSEDED" | "REJECTED";
export type DecisionType =
  | "GENERAL"
  | "SCOPE_CHANGE"
  | "ARCHITECTURE"
  | "DEADLINE_CHANGE"
  | "ASSIGNMENT"
  | "RISK_ACCEPTANCE"
  | "OVERRIDE";

export interface DecisionInput {
  id: DecisionId;
  projectId: ProjectId;
  title: string;
  type?: DecisionType | undefined;
  description?: string | undefined;
  context: string;
  outcome: string;
  rationale?: string | undefined;
  consequences?: readonly string[] | undefined;
  alternatives?: readonly string[] | undefined;
  affectedTaskIds?: readonly TaskId[] | undefined;
  affectedComponents?: readonly string[] | undefined;
  approvedBy?: TeamMemberId | undefined;
  approvedAt?: Date | undefined;
  status?: DecisionStatus | undefined;
  proposedBy?: TeamMemberId | undefined;
  decidedAt?: Date | undefined;
  supersedesDecisionId?: DecisionId | undefined;
  supersededByDecisionId?: DecisionId | undefined;
}

export class Decision {
  public readonly id: DecisionId;
  public readonly projectId: ProjectId;
  public readonly title: string;
  public readonly type: DecisionType;
  public readonly description: string;
  public readonly context: string;
  public readonly outcome: string;
  public readonly rationale: string;
  public readonly consequences: readonly string[];
  public readonly alternatives: readonly string[];
  public readonly affectedTaskIds: readonly TaskId[];
  public readonly affectedComponents: readonly string[];
  public readonly status: DecisionStatus;
  public readonly proposedBy: TeamMemberId;
  public readonly approvedBy?: TeamMemberId | undefined;
  public readonly approvedAt?: Date | undefined;
  public readonly decidedAt: Date;
  public readonly supersedesDecisionId?: DecisionId | undefined;
  public readonly supersededByDecisionId?: DecisionId | undefined;

  public constructor(input: DecisionInput) {
    this.id = assertNonEmpty(input.id, "decision.id");
    this.projectId = assertNonEmpty(input.projectId, "decision.projectId");
    this.title = assertNonEmpty(input.title, "decision.title");
    this.type = input.type ?? "GENERAL";
    this.description = input.description?.trim() ?? this.title;
    this.context = assertNonEmpty(input.context, "decision.context");
    this.outcome = assertNonEmpty(input.outcome, "decision.outcome");
    this.rationale = input.rationale?.trim() ?? "";
    this.consequences = Object.freeze(
      (input.consequences ?? []).map((consequence, index) =>
        assertNonEmpty(consequence, `decision.consequences[${index}]`),
      ),
    );
    this.alternatives = Object.freeze(
      (input.alternatives ?? []).map((alternative, index) =>
        assertNonEmpty(alternative, `decision.alternatives[${index}]`),
      ),
    );
    this.affectedTaskIds = Object.freeze([...new Set(input.affectedTaskIds ?? [])]);
    this.affectedComponents = Object.freeze(
      [...new Set(input.affectedComponents ?? [])].map((component, index) =>
        assertNonEmpty(component, `decision.affectedComponents[${index}]`),
      ),
    );
    this.status = input.status ?? "PROPOSED";
    this.proposedBy = input.proposedBy ?? "SYSTEM";
    this.approvedBy =
      input.approvedBy ??
      (input.status === "ACCEPTED" ? (input.proposedBy ?? "SYSTEM") : undefined);
    this.approvedAt =
      input.approvedAt === undefined
        ? undefined
        : assertDate(input.approvedAt, "decision.approvedAt");
    this.decidedAt = assertDate(input.decidedAt ?? new Date(), "decision.decidedAt");
    this.supersedesDecisionId = input.supersedesDecisionId;
    this.supersededByDecisionId = input.supersededByDecisionId;
    if (this.status === "SUPERSEDED" && this.supersededByDecisionId === undefined) {
      throw new DomainValidationError("A superseded decision must reference its replacement");
    }
    Object.freeze(this);
  }
}

export type RiskSeverity = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type RiskStatus = "OPEN" | "ACKNOWLEDGED" | "MITIGATED" | "ACCEPTED";

export interface RiskInput {
  id: RiskId;
  projectId: ProjectId;
  signal: string;
  title: string;
  severity: RiskSeverity;
  weight: number;
  scoreContribution: number;
  evidence: readonly string[];
  affectedTaskIds?: readonly TaskId[] | undefined;
  status?: RiskStatus | undefined;
  detectedAt?: Date | undefined;
}

export class Risk {
  public readonly id: RiskId;
  public readonly projectId: ProjectId;
  public readonly signal: string;
  public readonly title: string;
  public readonly severity: RiskSeverity;
  public readonly weight: number;
  public readonly scoreContribution: number;
  public readonly evidence: readonly string[];
  public readonly affectedTaskIds: readonly TaskId[];
  public readonly status: RiskStatus;
  public readonly detectedAt: Date;

  public constructor(input: RiskInput) {
    this.id = assertNonEmpty(input.id, "risk.id");
    this.projectId = assertNonEmpty(input.projectId, "risk.projectId");
    this.signal = assertNonEmpty(input.signal, "risk.signal");
    this.title = assertNonEmpty(input.title, "risk.title");
    this.severity = input.severity;
    this.weight = assertFiniteNonNegative(input.weight, "risk.weight");
    this.scoreContribution = assertFiniteNonNegative(
      input.scoreContribution,
      "risk.scoreContribution",
    );
    if (this.weight > 100 || this.scoreContribution > this.weight) {
      throw new DomainValidationError("Risk contribution must not exceed its weight", {
        weight: this.weight,
        contribution: this.scoreContribution,
      });
    }
    this.evidence = Object.freeze(
      input.evidence.map((item, index) => assertNonEmpty(item, `risk.evidence[${index}]`)),
    );
    this.affectedTaskIds = Object.freeze([...new Set(input.affectedTaskIds ?? [])]);
    this.status = input.status ?? "OPEN";
    this.detectedAt = assertDate(input.detectedAt ?? new Date(), "risk.detectedAt");
    Object.freeze(this);
  }
}

export type CheckpointKind =
  | "MILESTONE"
  | "SCOPE_LOCK"
  | "FEATURE_FREEZE"
  | "RELEASE_CANDIDATE"
  | "POSTMORTEM";
export type CheckpointStatus = "PENDING" | "PASSED" | "FAILED" | "WAIVED";

export interface ProjectCheckpointInput {
  id: ProjectCheckpointId;
  projectId: ProjectId;
  name: string;
  kind: CheckpointKind;
  dueAt: Date;
  status?: CheckpointStatus | undefined;
  requiredTaskIds?: readonly TaskId[] | undefined;
  criteria?: readonly string[] | undefined;
  notes?: string | undefined;
  completedAt?: Date | undefined;
}

export class ProjectCheckpoint {
  public readonly id: ProjectCheckpointId;
  public readonly projectId: ProjectId;
  public readonly name: string;
  public readonly kind: CheckpointKind;
  public readonly dueAt: Date;
  public readonly status: CheckpointStatus;
  public readonly requiredTaskIds: readonly TaskId[];
  public readonly criteria: readonly string[];
  public readonly notes: string;
  public readonly completedAt?: Date | undefined;

  public constructor(input: ProjectCheckpointInput) {
    this.id = assertNonEmpty(input.id, "checkpoint.id");
    this.projectId = assertNonEmpty(input.projectId, "checkpoint.projectId");
    this.name = assertNonEmpty(input.name, "checkpoint.name");
    this.kind = input.kind;
    this.dueAt = assertDate(input.dueAt, "checkpoint.dueAt");
    this.status = input.status ?? "PENDING";
    this.requiredTaskIds = Object.freeze([...new Set(input.requiredTaskIds ?? [])]);
    this.criteria = Object.freeze(
      (input.criteria ?? []).map((criterion, index) =>
        assertNonEmpty(criterion, `checkpoint.criteria[${index}]`),
      ),
    );
    this.notes = input.notes?.trim() ?? "";
    this.completedAt =
      input.completedAt === undefined
        ? undefined
        : assertDate(input.completedAt, "checkpoint.completedAt");
    if (
      (this.status === "PASSED" || this.status === "FAILED" || this.status === "WAIVED") &&
      this.completedAt === undefined
    ) {
      throw new DomainValidationError("A resolved checkpoint must have completedAt");
    }
    Object.freeze(this);
  }
}

export type IntegrationKind = "GITHUB" | "DISCORD" | "CI" | "ISSUE_TRACKER" | "CUSTOM";
export type IntegrationStatus = "PENDING" | "ACTIVE" | "DEGRADED" | "DISABLED";

export interface IntegrationInput {
  id: IntegrationId;
  projectId: ProjectId;
  kind: IntegrationKind;
  name: string;
  status?: IntegrationStatus | undefined;
  externalId?: string | undefined;
  configurationReference?: string | undefined;
  capabilities?: readonly string[] | undefined;
  lastSuccessfulSyncAt?: Date | undefined;
}

export class Integration {
  public readonly id: IntegrationId;
  public readonly projectId: ProjectId;
  public readonly kind: IntegrationKind;
  public readonly name: string;
  public readonly status: IntegrationStatus;
  public readonly externalId?: string | undefined;
  public readonly configurationReference?: string | undefined;
  public readonly capabilities: readonly string[];
  public readonly lastSuccessfulSyncAt?: Date | undefined;

  public constructor(input: IntegrationInput) {
    this.id = assertNonEmpty(input.id, "integration.id");
    this.projectId = assertNonEmpty(input.projectId, "integration.projectId");
    this.kind = input.kind;
    this.name = assertNonEmpty(input.name, "integration.name");
    this.status = input.status ?? "PENDING";
    this.externalId = input.externalId;
    this.configurationReference = input.configurationReference;
    this.capabilities = Object.freeze(
      (input.capabilities ?? []).map((capability, index) =>
        assertNonEmpty(capability, `integration.capabilities[${index}]`),
      ),
    );
    this.lastSuccessfulSyncAt =
      input.lastSuccessfulSyncAt === undefined
        ? undefined
        : assertDate(input.lastSuccessfulSyncAt, "integration.lastSuccessfulSyncAt");
    Object.freeze(this);
  }
}

export interface ProjectEventInput<TPayload = Readonly<Record<string, unknown>>> {
  id: ProjectEventId;
  projectId: ProjectId;
  type: string;
  payload: TPayload;
  occurredAt?: Date | undefined;
  actorId?: TeamMemberId | undefined;
  source?: string | undefined;
  correlationId?: string | undefined;
}

export class ProjectEvent<TPayload = Readonly<Record<string, unknown>>> {
  public readonly id: ProjectEventId;
  public readonly projectId: ProjectId;
  public readonly type: string;
  public readonly payload: TPayload;
  public readonly occurredAt: Date;
  public readonly actorId: TeamMemberId;
  public readonly source: string;
  public readonly correlationId?: string | undefined;

  public constructor(input: ProjectEventInput<TPayload>) {
    this.id = assertNonEmpty(input.id, "projectEvent.id");
    this.projectId = assertNonEmpty(input.projectId, "projectEvent.projectId");
    this.type = assertNonEmpty(input.type, "projectEvent.type");
    this.payload = input.payload;
    this.occurredAt = assertDate(input.occurredAt ?? new Date(), "projectEvent.occurredAt");
    this.actorId = input.actorId ?? "SYSTEM";
    this.source = assertNonEmpty(input.source ?? "DOMAIN", "projectEvent.source");
    this.correlationId = input.correlationId;
    Object.freeze(this);
  }
}

export function severityForScore(score: number): RiskSeverity {
  const normalized = clamp(score, 0, 100);
  if (normalized >= 70) return "CRITICAL";
  if (normalized >= 40) return "HIGH";
  if (normalized >= 20) return "MODERATE";
  return "LOW";
}
