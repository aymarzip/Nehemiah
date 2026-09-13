import { DomainValidationError } from "../errors.js";
import { Risk, severityForScore, type RiskSeverity } from "../domain/governance.js";
import {
  COMPLETED_TASK_STATUSES,
  assertDate,
  assertFiniteNonNegative,
  assertNonEmpty,
  clamp,
  round,
  type Impact,
  type ProjectId,
  type TaskId,
} from "../domain/common.js";
import type { Task } from "../domain/task.js";

export const RISK_SIGNAL_CODES = [
  "CRITICAL_TASK_WITHOUT_OWNER",
  "OVERDUE_CRITICAL_PATH_TASK",
  "BLOCKED_CRITICAL_TASK",
  "FAILING_REQUIRED_CHECKS",
  "UNREVIEWED_HIGH_IMPACT_CHANGE",
  "SHRINKING_DEADLINE_BUFFER",
  "NO_INTEGRATED_BUILD_TOO_LONG",
  "INCREASING_UNFINISHED_SCOPE",
  "UNRESOLVED_INTEGRATION_DEPENDENCY",
] as const;

export type RiskSignalCode = (typeof RISK_SIGNAL_CODES)[number];
export type RiskSignalWeights = Readonly<Record<RiskSignalCode, number>>;

export const DEFAULT_RISK_SIGNAL_WEIGHTS: RiskSignalWeights = Object.freeze({
  CRITICAL_TASK_WITHOUT_OWNER: 15,
  OVERDUE_CRITICAL_PATH_TASK: 18,
  BLOCKED_CRITICAL_TASK: 16,
  FAILING_REQUIRED_CHECKS: 12,
  UNREVIEWED_HIGH_IMPACT_CHANGE: 10,
  SHRINKING_DEADLINE_BUFFER: 12,
  NO_INTEGRATED_BUILD_TOO_LONG: 7,
  INCREASING_UNFINISHED_SCOPE: 5,
  UNRESOLVED_INTEGRATION_DEPENDENCY: 5,
});

export interface RequiredCheck {
  name: string;
  status: "PASSED" | "FAILED" | "PENDING";
  required?: boolean | undefined;
  taskId?: TaskId | undefined;
  details?: string | undefined;
}

export interface HighImpactChange {
  id: string;
  summary: string;
  impact: Extract<Impact, "HIGH" | "CRITICAL">;
  reviewed: boolean;
  taskId?: TaskId | undefined;
}

export interface ScopeSnapshot {
  capturedAt: Date;
  unfinishedWeightedEffort: number;
}

export interface IntegrationDependencyStatus {
  name: string;
  resolved: boolean;
  taskId?: TaskId | undefined;
  requiredBy?: Date | undefined;
  details?: string | undefined;
}

export interface DeadlineRiskContext {
  deadline: Date;
  requiredEffortHours: number;
  availableCapacityHours?: number | undefined;
  minimumBufferHours?: number | undefined;
  previousBufferHours?: number | undefined;
}

export interface BuildFreshnessContext {
  projectStartedAt: Date;
  lastIntegratedBuildAt?: Date | undefined;
  maximumAgeHours?: number | undefined;
}

export interface RiskAssessmentContext {
  projectId: ProjectId;
  tasks: readonly Task[];
  criticalPathTaskIds?: ReadonlySet<TaskId> | readonly TaskId[] | undefined;
  requiredChecks?: readonly RequiredCheck[] | undefined;
  highImpactChanges?: readonly HighImpactChange[] | undefined;
  deadline?: DeadlineRiskContext | undefined;
  buildFreshness?: BuildFreshnessContext | undefined;
  scopeHistory?: readonly ScopeSnapshot[] | undefined;
  integrationDependencies?: readonly IntegrationDependencyStatus[] | undefined;
  now?: Date | undefined;
}

export interface RiskSignalEvaluation {
  code: RiskSignalCode;
  title: string;
  active: boolean;
  weight: number;
  contribution: number;
  severity: RiskSeverity;
  rawValue: number;
  evidence: readonly string[];
  affectedTaskIds: readonly TaskId[];
}

export interface RiskAssessment {
  projectId: ProjectId;
  assessedAt: Date;
  overallScore: number;
  severity: RiskSeverity;
  signals: readonly RiskSignalEvaluation[];
  risks: readonly Risk[];
}

interface SignalResult {
  rawValue: number;
  evidence: readonly string[];
  affectedTaskIds?: readonly TaskId[] | undefined;
  severity?: RiskSeverity | undefined;
}

const SIGNAL_TITLES: Readonly<Record<RiskSignalCode, string>> = Object.freeze({
  CRITICAL_TASK_WITHOUT_OWNER: "Critical task has no owner",
  OVERDUE_CRITICAL_PATH_TASK: "Critical-path task is overdue",
  BLOCKED_CRITICAL_TASK: "Critical task is blocked",
  FAILING_REQUIRED_CHECKS: "Required checks are failing",
  UNREVIEWED_HIGH_IMPACT_CHANGE: "High-impact change has not been reviewed",
  SHRINKING_DEADLINE_BUFFER: "Deadline buffer is shrinking",
  NO_INTEGRATED_BUILD_TOO_LONG: "No recent integrated build",
  INCREASING_UNFINISHED_SCOPE: "Unfinished scope is increasing",
  UNRESOLVED_INTEGRATION_DEPENDENCY: "Integration dependency is unresolved",
});

const HOUR_MS = 60 * 60 * 1000;

export class RiskEngine {
  readonly #weights: RiskSignalWeights;

  public constructor(weights: Partial<RiskSignalWeights> = {}) {
    const complete = { ...DEFAULT_RISK_SIGNAL_WEIGHTS, ...weights };
    for (const code of RISK_SIGNAL_CODES) {
      const value = complete[code];
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new DomainValidationError(`Risk weight '${code}' must be between 0 and 100`, {
          code,
          value,
        });
      }
    }
    this.#weights = Object.freeze(complete);
  }

  public get weights(): RiskSignalWeights {
    return this.#weights;
  }

  public assess(context: RiskAssessmentContext): RiskAssessment {
    const projectId = assertNonEmpty(context.projectId, "riskAssessment.projectId");
    const now = assertDate(context.now ?? new Date(), "riskAssessment.now");
    for (const task of context.tasks) {
      if (task.projectId !== projectId) {
        throw new DomainValidationError(
          "Risk assessment cannot include tasks from another project",
          {
            projectId,
            taskId: task.id,
            taskProjectId: task.projectId,
          },
        );
      }
    }
    const criticalPath = new Set(context.criticalPathTaskIds ?? []);
    const results: Readonly<Record<RiskSignalCode, SignalResult>> = {
      CRITICAL_TASK_WITHOUT_OWNER: this.criticalTaskWithoutOwner(context.tasks, criticalPath),
      OVERDUE_CRITICAL_PATH_TASK: this.overdueCriticalPathTask(context.tasks, criticalPath, now),
      BLOCKED_CRITICAL_TASK: this.blockedCriticalTask(context.tasks, criticalPath),
      FAILING_REQUIRED_CHECKS: this.failingRequiredChecks(context.requiredChecks ?? []),
      UNREVIEWED_HIGH_IMPACT_CHANGE: this.unreviewedHighImpactChanges(
        context.highImpactChanges ?? [],
      ),
      SHRINKING_DEADLINE_BUFFER: this.shrinkingDeadlineBuffer(context.deadline, now),
      NO_INTEGRATED_BUILD_TOO_LONG: this.noIntegratedBuild(context.buildFreshness, now),
      INCREASING_UNFINISHED_SCOPE: this.increasingScope(context.scopeHistory ?? []),
      UNRESOLVED_INTEGRATION_DEPENDENCY: this.unresolvedIntegrations(
        context.integrationDependencies ?? [],
        now,
      ),
    };

    const signals = RISK_SIGNAL_CODES.map((code): RiskSignalEvaluation => {
      const result = results[code];
      const active = result.rawValue > 0;
      const weight = this.#weights[code];
      return Object.freeze({
        code,
        title: SIGNAL_TITLES[code],
        active,
        weight,
        contribution: active ? weight : 0,
        severity: active ? (result.severity ?? "HIGH") : "LOW",
        rawValue: round(result.rawValue),
        evidence: Object.freeze([...result.evidence]),
        affectedTaskIds: Object.freeze([...new Set(result.affectedTaskIds ?? [])].sort()),
      });
    });
    const overallScore = round(
      clamp(
        signals.reduce((total, signal) => total + signal.contribution, 0),
        0,
        100,
      ),
    );
    const risks = signals
      .filter((signal) => signal.active)
      .map(
        (signal) =>
          new Risk({
            id: `${projectId}:${signal.code}`,
            projectId,
            signal: signal.code,
            title: signal.title,
            severity: signal.severity,
            weight: signal.weight,
            scoreContribution: signal.contribution,
            evidence: signal.evidence,
            affectedTaskIds: signal.affectedTaskIds,
            detectedAt: now,
          }),
      );
    return Object.freeze({
      projectId,
      assessedAt: now,
      overallScore,
      severity: severityForScore(overallScore),
      signals: Object.freeze(signals),
      risks: Object.freeze(risks),
    });
  }

  private criticalTaskWithoutOwner(
    tasks: readonly Task[],
    criticalPath: ReadonlySet<TaskId>,
  ): SignalResult {
    const affected = tasks.filter(
      (task) =>
        (task.isCritical || criticalPath.has(task.id)) &&
        task.ownerId === undefined &&
        !COMPLETED_TASK_STATUSES.has(task.status) &&
        task.status !== "CANCELLED",
    );
    return {
      rawValue: affected.length,
      affectedTaskIds: affected.map((task) => task.id),
      severity: affected.some((task) => task.isCritical) ? "CRITICAL" : "HIGH",
      evidence: affected.map(
        (task) => `Task '${task.title}' (${task.id}) is critical and has no owner.`,
      ),
    };
  }

  private overdueCriticalPathTask(
    tasks: readonly Task[],
    criticalPath: ReadonlySet<TaskId>,
    now: Date,
  ): SignalResult {
    const affected = tasks.filter(
      (task) =>
        criticalPath.has(task.id) &&
        task.dueAt !== undefined &&
        task.dueAt < now &&
        !COMPLETED_TASK_STATUSES.has(task.status) &&
        task.status !== "CANCELLED",
    );
    return {
      rawValue: affected.length,
      affectedTaskIds: affected.map((task) => task.id),
      severity: "CRITICAL",
      evidence: affected.map((task) => {
        const overdueHours = Math.max(
          0,
          (now.getTime() - (task.dueAt?.getTime() ?? now.getTime())) / HOUR_MS,
        );
        return `Critical-path task '${task.title}' (${task.id}) is ${round(overdueHours, 1)} hours overdue.`;
      }),
    };
  }

  private blockedCriticalTask(
    tasks: readonly Task[],
    criticalPath: ReadonlySet<TaskId>,
  ): SignalResult {
    const affected = tasks.filter(
      (task) => task.status === "BLOCKED" && (task.isCritical || criticalPath.has(task.id)),
    );
    return {
      rawValue: affected.length,
      affectedTaskIds: affected.map((task) => task.id),
      severity: "CRITICAL",
      evidence: affected.map(
        (task) =>
          `Critical task '${task.title}' (${task.id}) is blocked: ${task.blockReason ?? "reason not recorded"}.`,
      ),
    };
  }

  private failingRequiredChecks(checks: readonly RequiredCheck[]): SignalResult {
    for (const [index, check] of checks.entries()) {
      assertNonEmpty(check.name, `risk.requiredChecks[${index}].name`);
    }
    const failing = checks.filter((check) => (check.required ?? true) && check.status === "FAILED");
    return {
      rawValue: failing.length,
      affectedTaskIds: failing.flatMap((check) =>
        check.taskId === undefined ? [] : [check.taskId],
      ),
      severity: "HIGH",
      evidence: failing.map(
        (check) =>
          `Required check '${check.name}' is failing${check.details === undefined ? "." : `: ${check.details}.`}`,
      ),
    };
  }

  private unreviewedHighImpactChanges(changes: readonly HighImpactChange[]): SignalResult {
    for (const [index, change] of changes.entries()) {
      assertNonEmpty(change.id, `risk.highImpactChanges[${index}].id`);
      assertNonEmpty(change.summary, `risk.highImpactChanges[${index}].summary`);
    }
    const unreviewed = changes.filter((change) => !change.reviewed);
    return {
      rawValue: unreviewed.length,
      affectedTaskIds: unreviewed.flatMap((change) =>
        change.taskId === undefined ? [] : [change.taskId],
      ),
      severity: unreviewed.some((change) => change.impact === "CRITICAL") ? "CRITICAL" : "HIGH",
      evidence: unreviewed.map(
        (change) =>
          `${change.impact.toLowerCase()}-impact change '${change.summary}' (${change.id}) has not been reviewed.`,
      ),
    };
  }

  private shrinkingDeadlineBuffer(
    deadline: DeadlineRiskContext | undefined,
    now: Date,
  ): SignalResult {
    if (deadline === undefined) return { rawValue: 0, evidence: [] };
    const deadlineAt = assertDate(deadline.deadline, "risk.deadline.deadline");
    const required = assertFiniteNonNegative(
      deadline.requiredEffortHours,
      "risk.deadline.requiredEffortHours",
    );
    const remainingClockHours = Math.max(0, (deadlineAt.getTime() - now.getTime()) / HOUR_MS);
    const capacity = assertFiniteNonNegative(
      deadline.availableCapacityHours ?? remainingClockHours,
      "risk.deadline.availableCapacityHours",
    );
    const minimum = assertFiniteNonNegative(
      deadline.minimumBufferHours ?? 24,
      "risk.deadline.minimumBufferHours",
    );
    const buffer = capacity - required;
    const shrinking =
      deadline.previousBufferHours !== undefined && deadline.previousBufferHours > buffer;
    const active = buffer <= minimum || (shrinking && buffer <= minimum * 2);
    if (!active) return { rawValue: 0, evidence: [] };
    const trend = shrinking
      ? `, down from ${round(deadline.previousBufferHours ?? buffer, 1)} hours`
      : "";
    return {
      rawValue: Math.max(0.01, minimum - buffer + 1),
      severity: buffer < 0 || deadlineAt <= now ? "CRITICAL" : "HIGH",
      evidence: [
        `Deadline buffer is ${round(buffer, 1)} hours${trend}; the minimum safe buffer is ${round(minimum, 1)} hours.`,
      ],
    };
  }

  private noIntegratedBuild(freshness: BuildFreshnessContext | undefined, now: Date): SignalResult {
    if (freshness === undefined) return { rawValue: 0, evidence: [] };
    const baseline = assertDate(
      freshness.lastIntegratedBuildAt ?? freshness.projectStartedAt,
      "risk.buildFreshness.baseline",
    );
    const maximumAge = assertFiniteNonNegative(
      freshness.maximumAgeHours ?? 72,
      "risk.buildFreshness.maximumAgeHours",
    );
    const age = Math.max(0, (now.getTime() - baseline.getTime()) / HOUR_MS);
    if (age <= maximumAge) return { rawValue: 0, evidence: [] };
    return {
      rawValue: age - maximumAge,
      severity: age > maximumAge * 2 ? "HIGH" : "MODERATE",
      evidence: [
        freshness.lastIntegratedBuildAt === undefined
          ? `No integrated build has been recorded in ${round(age, 1)} hours.`
          : `The last integrated build is ${round(age, 1)} hours old; the maximum is ${round(maximumAge, 1)} hours.`,
      ],
    };
  }

  private increasingScope(history: readonly ScopeSnapshot[]): SignalResult {
    if (history.length < 2) return { rawValue: 0, evidence: [] };
    const ordered = [...history].sort(
      (left, right) => left.capturedAt.getTime() - right.capturedAt.getTime(),
    );
    for (const snapshot of ordered) {
      assertDate(snapshot.capturedAt, "risk.scopeHistory.capturedAt");
      assertFiniteNonNegative(
        snapshot.unfinishedWeightedEffort,
        "risk.scopeHistory.unfinishedWeightedEffort",
      );
    }
    const previous = ordered.at(-2);
    const current = ordered.at(-1);
    if (previous === undefined || current === undefined) return { rawValue: 0, evidence: [] };
    const increase = current.unfinishedWeightedEffort - previous.unfinishedWeightedEffort;
    if (increase <= 0) return { rawValue: 0, evidence: [] };
    const percent =
      previous.unfinishedWeightedEffort === 0
        ? 100
        : (increase / previous.unfinishedWeightedEffort) * 100;
    return {
      rawValue: increase,
      severity: percent >= 25 ? "HIGH" : "MODERATE",
      evidence: [
        `Unfinished weighted scope increased by ${round(increase, 1)} hours (${round(percent, 1)}%) between the two latest snapshots.`,
      ],
    };
  }

  private unresolvedIntegrations(
    dependencies: readonly IntegrationDependencyStatus[],
    now: Date,
  ): SignalResult {
    for (const [index, dependency] of dependencies.entries()) {
      assertNonEmpty(dependency.name, `risk.integrationDependencies[${index}].name`);
      if (dependency.requiredBy !== undefined) {
        assertDate(dependency.requiredBy, `risk.integrationDependencies[${index}].requiredBy`);
      }
    }
    const unresolved = dependencies.filter((dependency) => !dependency.resolved);
    return {
      rawValue: unresolved.length,
      affectedTaskIds: unresolved.flatMap((dependency) =>
        dependency.taskId === undefined ? [] : [dependency.taskId],
      ),
      severity: unresolved.some(
        (dependency) => dependency.requiredBy !== undefined && dependency.requiredBy <= now,
      )
        ? "CRITICAL"
        : "HIGH",
      evidence: unresolved.map((dependency) => {
        const deadline =
          dependency.requiredBy === undefined
            ? ""
            : `, required by ${dependency.requiredBy.toISOString()}`;
        const details = dependency.details === undefined ? "" : `: ${dependency.details}`;
        return `Integration dependency '${dependency.name}' is unresolved${deadline}${details}.`;
      }),
    };
  }
}
