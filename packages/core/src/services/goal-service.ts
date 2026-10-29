import { COMPLETED_TASK_STATUSES, round } from "../domain/common.js";
import type { Project, ProjectVision } from "../domain/project.js";
import type { Task } from "../domain/task.js";

export interface GoalProgressSummary {
  readonly statement: string;
  readonly goalStatement: string;
  readonly targetOutcome: string;
  readonly problem: string;
  readonly successCriteria: readonly string[];
  readonly mustHaveScope: readonly string[];
  readonly shouldHaveScope: readonly string[];
  readonly niceToHaveScope: readonly string[];
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly mustHaveTotal: number;
  readonly mustHaveTasks: number;
  readonly mustHaveCompleted: number;
  readonly completedMustHaveTasks: number;
  readonly overallProgressPercent: number;
  readonly percentage: number;
  readonly mustHaveProgressPercent: number;
  readonly mustHavePercentage: number;
  readonly unalignedTaskIds: readonly string[];
  readonly isMustHaveComplete: boolean;
}

export class GoalService {
  computeProgress(project: Project | ProjectVision, tasks: readonly Task[]): GoalProgressSummary {
    const vision = "vision" in project ? project.vision : project;
    const activeTasks = tasks.filter((t) => t.status !== "CANCELLED");
    const total = activeTasks.length;
    const completed = activeTasks.filter((t) => COMPLETED_TASK_STATUSES.has(t.status)).length;

    const mustHaveTasks = activeTasks.filter((t) => t.scopeTier === "MUST");
    const mustHaveTotal = mustHaveTasks.length;
    const mustHaveCompleted = mustHaveTasks.filter((t) =>
      COMPLETED_TASK_STATUSES.has(t.status),
    ).length;

    const unaligned = activeTasks
      .filter(
        (t) =>
          (t.scopeTier === "NICE" || t.deadlineCriticality === "OPTIONAL") && !t.releaseRequired,
      )
      .map((t) => t.id);

    const overallProgressPercent = total === 0 ? 0 : round((completed / total) * 100, 1);
    const mustHaveProgressPercent =
      mustHaveTotal === 0 ? 100 : round((mustHaveCompleted / mustHaveTotal) * 100, 1);

    return {
      statement: vision.statement,
      goalStatement: vision.statement,
      targetOutcome: vision.targetOutcome,
      problem: vision.problem,
      successCriteria: vision.successCriteria,
      mustHaveScope: vision.mustHaveScope,
      shouldHaveScope: vision.shouldHaveScope,
      niceToHaveScope: vision.niceToHaveScope,
      totalTasks: total,
      completedTasks: completed,
      mustHaveTotal,
      mustHaveTasks: mustHaveTotal,
      mustHaveCompleted,
      completedMustHaveTasks: mustHaveCompleted,
      overallProgressPercent,
      percentage: overallProgressPercent,
      mustHaveProgressPercent,
      mustHavePercentage: mustHaveProgressPercent,
      unalignedTaskIds: unaligned,
      isMustHaveComplete: mustHaveTotal > 0 && mustHaveCompleted === mustHaveTotal,
    };
  }
}
