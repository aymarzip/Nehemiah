import { round } from "../domain/common.js";
import type { Blocker } from "../domain/planning.js";
import type { Task } from "../domain/task.js";

export interface ReleaseReadinessInput {
  readonly tasks: readonly Task[];
  readonly blockers?: readonly Blocker[] | undefined;
  readonly requiredChecks?:
    | readonly { readonly name: string; readonly passed: boolean }[]
    | undefined;
  readonly buildAvailable?: boolean | undefined;
  readonly packagingComplete?: boolean | undefined;
  readonly unresolvedCriticalRiskCount?: number | undefined;
}

export interface ReleaseReadinessAssessment {
  readonly score: number;
  readonly ready: boolean;
  readonly gates: readonly {
    readonly key: string;
    readonly passed: boolean;
    readonly reason: string;
  }[];
  readonly blockers: readonly string[];
}

export class ReleaseReadinessService {
  assess(input: ReleaseReadinessInput): ReleaseReadinessAssessment {
    const requiredTasks = input.tasks.filter(
      (task) => task.releaseRequired && task.status !== "CANCELLED",
    );
    const shipped = requiredTasks.filter((task) => task.status === "SHIPPED").length;
    const criticalBlockers = (input.blockers ?? []).filter(
      (blocker) =>
        blocker.status === "OPEN" &&
        (blocker.severity === "CRITICAL" || blocker.severity === "HIGH"),
    );
    const checks = input.requiredChecks ?? [];
    const gates = [
      {
        key: "REQUIRED_SCOPE",
        passed: requiredTasks.length > 0 && shipped === requiredTasks.length,
        reason: `${shipped}/${requiredTasks.length} required tasks are shipped.`,
      },
      {
        key: "CRITICAL_BLOCKERS",
        passed: criticalBlockers.length === 0,
        reason: `${criticalBlockers.length} unresolved high/critical blockers.`,
      },
      {
        key: "REQUIRED_CHECKS",
        passed: checks.length > 0 && checks.every((check) => check.passed),
        reason: `${checks.filter((check) => check.passed).length}/${checks.length} required checks pass.`,
      },
      {
        key: "BUILD",
        passed: input.buildAvailable === true,
        reason:
          input.buildAvailable === true
            ? "A release build is available."
            : "No release build is recorded.",
      },
      {
        key: "PACKAGING",
        passed: input.packagingComplete === true,
        reason:
          input.packagingComplete === true ? "Packaging is complete." : "Packaging is incomplete.",
      },
      {
        key: "CRITICAL_RISKS",
        passed: (input.unresolvedCriticalRiskCount ?? 0) === 0,
        reason: `${input.unresolvedCriticalRiskCount ?? 0} unresolved release-critical risks.`,
      },
    ] as const;
    const score = round((gates.filter((gate) => gate.passed).length / gates.length) * 100);
    return Object.freeze({
      score,
      ready: gates.every((gate) => gate.passed),
      gates: Object.freeze(gates),
      blockers: Object.freeze(gates.filter((gate) => !gate.passed).map((gate) => gate.reason)),
    });
  }
}
