import type { Blocker } from "../domain/planning.js";
import type { Task } from "../domain/task.js";
import type { TaskGraph } from "./task-graph.js";

export interface PrioritizedBlocker {
  readonly blocker: Blocker;
  readonly fanOut: number;
  readonly priorityScore: number;
  readonly explanation: string;
}

export class BlockerEngine {
  prioritize(blockers: readonly Blocker[], graph: TaskGraph): readonly PrioritizedBlocker[] {
    const descendants = (task: Task, seen = new Set<string>()): number => {
      if (seen.has(task.id)) return 0;
      seen.add(task.id);
      return graph
        .getDependantTasks(task.id)
        .reduce((total, dependant) => total + 1 + descendants(dependant, seen), 0);
    };
    const severity = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;
    return blockers
      .filter((blocker) => blocker.status === "OPEN")
      .map((blocker): PrioritizedBlocker => {
        const blockedTask =
          blocker.blockedTaskId === undefined ? undefined : graph.getTask(blocker.blockedTaskId);
        const fanOut = blockedTask === undefined ? 0 : descendants(blockedTask);
        const priorityScore = severity[blocker.severity] * 20 + Math.min(40, fanOut * 8);
        return Object.freeze({
          blocker,
          fanOut,
          priorityScore,
          explanation:
            fanOut === 0
              ? `${blocker.severity} blocker with no recorded downstream fan-out.`
              : `${blocker.severity} blocker affects ${fanOut} downstream task(s).`,
        });
      })
      .sort((left, right) => right.priorityScore - left.priorityScore);
  }
}
