import { COMPLETED_TASK_STATUSES, round } from "../domain/common.js";
import type { Blocker } from "../domain/planning.js";
import type { Task } from "../domain/task.js";

export interface LearningInsight {
  readonly category: "VELOCITY" | "BLOCKER_PATTERN" | "RISK_PATTERN" | "PROCESS_IMPROVEMENT";
  readonly title: string;
  readonly observation: string;
  readonly recommendation: string;
}

export interface ProjectLearningReport {
  readonly completedTasksCount: number;
  readonly resolvedBlockersCount: number;
  readonly averageEffortHours: number;
  readonly primaryBlockerSource: string;
  readonly insights: readonly LearningInsight[];
}

export class LearningEngine {
  analyze(tasks: readonly Task[], blockers: readonly Blocker[]): ProjectLearningReport {
    const completedTasks = tasks.filter((t) => COMPLETED_TASK_STATUSES.has(t.status));
    const resolvedBlockers = blockers.filter((b) => b.status === "RESOLVED");

    const totalHours = completedTasks.reduce((acc, t) => acc + t.estimatedEffortHours, 0);
    const averageEffortHours =
      completedTasks.length > 0 ? round(totalHours / completedTasks.length, 1) : 0;

    const blockerSourceCounts = new Map<string, number>();
    for (const b of blockers) {
      blockerSourceCounts.set(b.source, (blockerSourceCounts.get(b.source) ?? 0) + 1);
    }

    let primarySource = "NONE";
    let maxCount = 0;
    for (const [source, count] of blockerSourceCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        primarySource = source;
      }
    }

    const insights: LearningInsight[] = [];

    if (completedTasks.length >= 1) {
      insights.push({
        category: "VELOCITY",
        title: "Cadence and estimation predictability",
        observation: `${completedTasks.length} task(s) completed with an average effort of ${averageEffortHours}h per task.`,
        recommendation:
          averageEffortHours > 8
            ? "Split tasks exceeding 8 hours into smaller sub-tasks to maintain continuous delivery momentum."
            : "Task sizing is compact and promotes rapid verification loops.",
      });
    }

    if (blockers.length > 0) {
      insights.push({
        category: "BLOCKER_PATTERN",
        title: `Primary blocker vector: ${primarySource}`,
        observation: `${maxCount} blocker(s) originated from ${primarySource} dependencies.`,
        recommendation:
          primarySource === "TASK"
            ? "Introduce explicit interface contracts earlier to prevent downstream tasks from waiting on implementation details."
            : primarySource === "GITHUB" || primarySource === "CI"
              ? "Ensure local verification tests pass before pushing branches to avoid CI queue bottlenecks."
              : "Review dependency handoffs during checkpoint check-ins.",
      });
    }

    const unverifiedTasks = tasks.filter((t) => t.status === "IMPLEMENTED");
    if (unverifiedTasks.length >= 2) {
      insights.push({
        category: "PROCESS_IMPROVEMENT",
        title: "Verification pipeline lag",
        observation: `${unverifiedTasks.length} tasks are implemented but waiting on verification evidence.`,
        recommendation:
          "Prioritize reviewing and attaching evidence (PR reviews or check runs) to close the gap between code completion and release readiness.",
      });
    }

    if (insights.length === 0) {
      insights.push({
        category: "PROCESS_IMPROVEMENT",
        title: "Early phase observation",
        observation: "Project is in early stages with minimal historical variance.",
        recommendation:
          "Maintain strict verification requirements for initial must-have tasks to establish a stable architectural baseline.",
      });
    }

    return {
      completedTasksCount: completedTasks.length,
      resolvedBlockersCount: resolvedBlockers.length,
      averageEffortHours,
      primaryBlockerSource: primarySource,
      insights,
    };
  }
}
