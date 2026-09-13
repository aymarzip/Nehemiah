import { COMPLETED_TASK_STATUSES, round, type TaskId } from "../domain/common.js";
import { AICapacityDimensions, type Blocker } from "../domain/planning.js";
import type { TeamMember } from "../domain/team.js";
import type { Task } from "../domain/task.js";
import type { TaskGraph } from "./task-graph.js";

export interface AssignmentCandidate {
  readonly member: TeamMember;
  readonly currentTasks: readonly Task[];
  readonly recentComponent?: string | undefined;
  readonly aiCapacity?: AICapacityDimensions | undefined;
}

export interface AssignmentRecommendation {
  readonly taskId: TaskId;
  readonly memberId: string;
  readonly score: number;
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly cautions: readonly string[];
}

export interface AssignmentInput {
  readonly task: Task;
  readonly candidates: readonly AssignmentCandidate[];
  readonly graph: TaskGraph;
  readonly criticalPathTaskIds?: ReadonlySet<TaskId> | undefined;
  readonly blockers?: readonly Blocker[] | undefined;
  readonly now?: Date | undefined;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

export class AssignmentEngine {
  recommend(input: AssignmentInput): readonly AssignmentRecommendation[] {
    if (COMPLETED_TASK_STATUSES.has(input.task.status) || input.task.status === "CANCELLED")
      return [];
    const blockers = (input.blockers ?? []).filter(
      (blocker) => blocker.status === "OPEN" && blocker.blockedTaskId === input.task.id,
    );
    return input.candidates
      .filter((candidate) => candidate.member.status === "ACTIVE")
      .map((candidate): AssignmentRecommendation => {
        const reasons: string[] = [];
        const cautions: string[] = [];
        let score = 30;
        const active = candidate.currentTasks.filter(
          (task) => !COMPLETED_TASK_STATUSES.has(task.status) && task.status !== "CANCELLED",
        );
        const committed = active.reduce((sum, task) => sum + task.estimatedEffortHours, 0);
        const weekly = candidate.member.availability.weeklyHours;
        if (candidate.member.availability.isAvailableAt(input.now ?? new Date())) {
          const freeRatio = weekly === 0 ? 0 : Math.max(0, (weekly - committed) / weekly);
          score += freeRatio * 20;
          reasons.push(`${round(Math.max(0, weekly - committed), 1)}h estimated capacity remains.`);
        } else {
          score -= 40;
          cautions.push("Member is currently unavailable.");
        }
        if (
          input.task.ownerRole !== undefined &&
          candidate.member.roles.some(
            (role) => normalize(role.name) === normalize(input.task.ownerRole!),
          )
        ) {
          score += 16;
          reasons.push(`Role matches ${input.task.ownerRole}.`);
        }
        const terms = new Set(
          [input.task.ownerRole, input.task.component, ...input.task.tags]
            .filter((value): value is string => value !== undefined)
            .flatMap((value) => normalize(value).split(/[^\p{L}\p{N}]+/u))
            .filter(Boolean),
        );
        const matchingSkills = candidate.member.skills.filter((skill) => {
          const skillTerms = [skill.name, ...skill.tags].flatMap((value) =>
            normalize(value).split(/[^\p{L}\p{N}]+/u),
          );
          return skillTerms.some((term) => terms.has(term));
        });
        if (matchingSkills.length > 0) {
          score += Math.min(
            18,
            matchingSkills.reduce((sum, skill) => sum + skill.level * 2, 0),
          );
          reasons.push(
            `Relevant context: ${matchingSkills.map((skill) => skill.name).join(", ")}.`,
          );
        }
        if (input.task.ownerId === candidate.member.id) {
          score += 18;
          reasons.push("Already owns the task; reassignment cost is avoided.");
        }
        if (
          input.task.component !== undefined &&
          (candidate.recentComponent === input.task.component ||
            active.some((task) => task.component === input.task.component))
        ) {
          score += 12;
          reasons.push(`Has current context in ${input.task.component}.`);
        } else if (active.length > 0) {
          score -= 6;
          cautions.push("Assignment introduces a context switch.");
        }
        if (input.criticalPathTaskIds?.has(input.task.id) === true) {
          score += 12;
          reasons.push("Task is on the current critical path.");
        }
        if (input.graph.getReadyTasks().some((task) => task.id === input.task.id)) {
          score += 8;
          reasons.push("All deterministic dependencies are satisfied.");
        } else {
          score -= 30;
          cautions.push("Dependencies are not yet satisfied.");
        }
        if (blockers.length > 0) {
          score -= 25;
          cautions.push(`${blockers.length} unresolved blocker(s) affect this task.`);
        }
        const capacity = candidate.aiCapacity ?? new AICapacityDimensions();
        const multiplier = capacity.effectiveImplementationMultiplier();
        score += (multiplier - 1) * 10;
        if (capacity.confidence < 0.4) {
          cautions.push(
            "AI augmentation estimate has low confidence and is applied conservatively.",
          );
        }
        const confidence = Math.min(
          0.9,
          0.35 +
            (matchingSkills.length > 0 ? 0.15 : 0) +
            (weekly > 0 ? 0.15 : 0) +
            capacity.confidence * 0.2,
        );
        return Object.freeze({
          taskId: input.task.id,
          memberId: candidate.member.id,
          score: round(Math.max(0, Math.min(100, score))),
          confidence: round(confidence, 2),
          reasons: Object.freeze(reasons),
          cautions: Object.freeze(cautions),
        });
      })
      .sort(
        (left, right) => right.score - left.score || left.memberId.localeCompare(right.memberId),
      );
  }
}
