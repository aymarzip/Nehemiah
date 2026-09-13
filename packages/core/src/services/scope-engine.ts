import { COMPLETED_TASK_STATUSES, round, type TaskId } from "../domain/common.js";
import type { Task, TaskDependency } from "../domain/task.js";
import type { ProjectPhase } from "./deadline-service.js";
import { TaskGraph } from "./task-graph.js";

export interface ScopeCutCandidate {
  readonly taskId: TaskId;
  readonly title: string;
  readonly expectedTimeSavedHours: number;
  readonly dependenciesRemoved: number;
  readonly riskReduction: "LOW" | "MEDIUM" | "HIGH";
  readonly productImpact: "LOW" | "MEDIUM" | "HIGH";
  readonly confidence: number;
  readonly reasons: readonly string[];
}

export interface DriftAssessment {
  readonly detected: boolean;
  readonly severity: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  readonly evidence: readonly string[];
}

export class ScopeEngine {
  cutCandidates(
    tasks: readonly Task[],
    dependencies: readonly TaskDependency[] = [],
  ): readonly ScopeCutCandidate[] {
    const graph = new TaskGraph(tasks, dependencies);
    const candidates = tasks
      .filter(
        (task) =>
          task.scopeTier !== "MUST" &&
          !COMPLETED_TASK_STATUSES.has(task.status) &&
          task.status !== "CANCELLED" &&
          task.status !== "IN_PROGRESS",
      )
      .map((task): ScopeCutCandidate => {
        const optionalDependants = graph
          .getDependantTasks(task.id)
          .filter((dependant) => dependant.scopeTier !== "MUST");
        const saved =
          task.estimatedEffortHours +
          optionalDependants.reduce(
            (total, dependant) => total + dependant.estimatedEffortHours,
            0,
          );
        const dependenciesRemoved = dependencies.filter(
          (dependency) =>
            dependency.dependencyTaskId === task.id || dependency.dependantTaskId === task.id,
        ).length;
        return Object.freeze({
          taskId: task.id,
          title: task.title,
          expectedTimeSavedHours: round(saved, 1),
          dependenciesRemoved,
          riskReduction:
            task.riskLevel === "CRITICAL" || dependenciesRemoved >= 3
              ? "HIGH"
              : task.riskLevel === "HIGH" || dependenciesRemoved > 0
                ? "MEDIUM"
                : "LOW",
          productImpact: task.scopeTier === "NICE" ? "LOW" : "MEDIUM",
          confidence: round(
            Math.min(
              0.9,
              0.45 +
                (task.estimatedEffortHours > 0 ? 0.2 : 0) +
                (dependenciesRemoved > 0 ? 0.1 : 0),
            ),
            2,
          ),
          reasons: Object.freeze([
            `${task.scopeTier.toLowerCase()}-to-have scope is not currently in progress.`,
            `${round(saved, 1)}h of tracked remaining effort could be removed.`,
          ]),
        });
      });
    return candidates.sort(
      (left, right) => right.expectedTimeSavedHours - left.expectedTimeSavedHours,
    );
  }

  detectDrift(input: {
    readonly baselineTaskIds: ReadonlySet<TaskId>;
    readonly tasks: readonly Task[];
    readonly phase: ProjectPhase;
  }): DriftAssessment {
    const additions = input.tasks.filter(
      (task) => !input.baselineTaskIds.has(task.id) && task.status !== "CANCELLED",
    );
    const optionalAdditions = additions.filter((task) => task.scopeTier !== "MUST");
    const evidence: string[] = [];
    if (additions.length > 0)
      evidence.push(`${additions.length} active task(s) were added after the approved baseline.`);
    if (optionalAdditions.length > 0)
      evidence.push(`${optionalAdditions.length} added task(s) are optional scope.`);
    if (input.phase !== "PRODUCTION" && additions.length > 0) {
      evidence.push(`${additions.length} scope addition(s) occurred during ${input.phase}.`);
    }
    const severity =
      input.phase === "SHIP_MODE" && additions.length > 0
        ? "HIGH"
        : input.phase !== "PRODUCTION" && optionalAdditions.length > 0
          ? "MEDIUM"
          : additions.length > 0
            ? "LOW"
            : "NONE";
    return Object.freeze({
      detected: severity !== "NONE",
      severity,
      evidence: Object.freeze(evidence),
    });
  }
}
