import { COMPLETED_TASK_STATUSES, round, type TaskId } from "../domain/common.js";
import type { Blocker } from "../domain/planning.js";
import type { TeamMember } from "../domain/team.js";
import type { Task, TaskDependency } from "../domain/task.js";
import type { ProjectPhase } from "./deadline-service.js";
import { TaskGraph } from "./task-graph.js";

export interface WhatNowRecommendation {
  readonly taskId: TaskId;
  readonly title: string;
  readonly priority: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly expectedResult: string;
  readonly reasons: readonly string[];
  readonly avoidForNow: readonly string[];
  readonly score: number;
  readonly confidence: number;
}

export interface WhatNowInput {
  readonly member: TeamMember;
  readonly tasks: readonly Task[];
  readonly dependencies?: readonly TaskDependency[] | undefined;
  readonly blockers?: readonly Blocker[] | undefined;
  readonly phase: ProjectPhase;
  readonly deadlineBufferHours: number;
}

export class RecommendationEngine {
  whatNow(input: WhatNowInput): WhatNowRecommendation | undefined {
    const graph = new TaskGraph(input.tasks, input.dependencies ?? []);
    const critical = new Set(graph.criticalPath({ remainingOnly: true }).taskIds);
    const ready = new Set(graph.getReadyTasks().map((task) => task.id));
    const openBlocked = new Set(
      (input.blockers ?? [])
        .filter((blocker) => blocker.status === "OPEN" && blocker.blockedTaskId !== undefined)
        .map((blocker) => blocker.blockedTaskId!),
    );
    const candidates = input.tasks
      .filter(
        (task) =>
          !COMPLETED_TASK_STATUSES.has(task.status) &&
          task.status !== "CANCELLED" &&
          task.status !== "BLOCKED" &&
          !openBlocked.has(task.id) &&
          (task.ownerId === undefined || task.ownerId === input.member.id) &&
          (ready.has(task.id) || task.status === "IN_PROGRESS"),
      )
      .map((task) => {
        const reasons: string[] = [];
        let score = task.impactWeight * 10 + task.weight * 4;
        if (task.ownerId === input.member.id) {
          score += 25;
          reasons.push("You already own this work and retain its context.");
        } else if (task.ownerId !== undefined) {
          score -= 18;
        }
        if (critical.has(task.id)) {
          score += 30;
          reasons.push("It is on the current critical path.");
        }
        const fanOut = graph.getDependants(task.id).length;
        if (fanOut > 0) {
          score += Math.min(20, fanOut * 6);
          reasons.push(`${fanOut} direct dependant task(s) benefit from this result.`);
        }
        if (task.status === "IN_PROGRESS") {
          score += 18;
          reasons.push("Finishing in-progress work avoids another context switch.");
        }
        if (input.deadlineBufferHours < 0 && task.deadlineCriticality === "CRITICAL") {
          score += 15;
          reasons.push("The deadline buffer is exhausted and this task is deadline-critical.");
        }
        const latePhase = input.phase === "FEATURE_FREEZE" || input.phase === "SHIP_MODE";
        if (
          latePhase &&
          (task.scopeTier === "NICE" ||
            task.tags.some((tag) => /refactor|polish|optional/iu.test(tag)))
        ) {
          score -= 80;
        }
        if (input.phase === "SHIP_MODE") {
          const shipWork = task.tags.some((tag) =>
            /ship|package|build|qa|submission|backup|credit/iu.test(tag),
          );
          if (shipWork) {
            score += 35;
            reasons.push("Ship Mode prioritizes build, packaging, submission and final QA work.");
          }
        }
        return { task, score, reasons, fanOut };
      })
      .sort((left, right) => right.score - left.score || left.task.id.localeCompare(right.task.id));
    const selected = candidates[0];
    if (selected === undefined) return undefined;
    const avoidForNow = input.tasks
      .filter(
        (task) =>
          task.id !== selected.task.id &&
          !COMPLETED_TASK_STATUSES.has(task.status) &&
          (task.scopeTier === "NICE" || !ready.has(task.id)),
      )
      .slice(0, 3)
      .map((task) => task.title);
    return Object.freeze({
      taskId: selected.task.id,
      title: selected.task.title,
      priority: critical.has(selected.task.id)
        ? "CRITICAL"
        : selected.task.impact === "HIGH" || selected.task.impact === "CRITICAL"
          ? "HIGH"
          : "MEDIUM",
      expectedResult:
        selected.task.expectedOutcome || selected.task.description || selected.task.title,
      reasons: Object.freeze(
        selected.reasons.length > 0
          ? selected.reasons
          : ["This is the highest-impact ready task for the current state."],
      ),
      avoidForNow: Object.freeze(avoidForNow),
      score: round(Math.max(0, selected.score)),
      confidence: round(
        Math.min(0.95, 0.45 + selected.reasons.length * 0.08 + (selected.fanOut > 0 ? 0.08 : 0)),
        2,
      ),
    });
  }
}
