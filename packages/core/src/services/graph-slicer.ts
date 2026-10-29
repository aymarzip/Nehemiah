import { COMPLETED_TASK_STATUSES } from "../domain/common.js";
import { TaskDependency, type Task } from "../domain/task.js";
import { TaskGraph } from "./task-graph.js";

export type DependencyLike =
  | TaskDependency
  | { readonly dependantTaskId: string; readonly dependencyTaskId: string };

function normalizeDependencies(
  tasks: readonly Task[],
  dependencies: readonly DependencyLike[],
): TaskDependency[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  return dependencies.map((d) =>
    d instanceof TaskDependency
      ? d
      : new TaskDependency({
          projectId: taskMap.get(d.dependantTaskId)?.projectId ?? "project-1",
          dependantTaskId: d.dependantTaskId,
          dependencyTaskId: d.dependencyTaskId,
        }),
  );
}

export interface SlicedContext {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly TaskDependency[];
  readonly totalProjectTasks: number;
  readonly prunedTasksCount: number;
  readonly tokenSavingsPercent: number;
}

export interface CompactTaskSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly tier?: string;
  readonly role?: string;
  readonly effort: number;
  readonly deps: readonly string[];
}

export class GraphSlicer {
  sliceForTask(
    targetTaskId: string,
    tasks: readonly Task[],
    dependencies: readonly DependencyLike[],
    maxNeighborhoodSize = 40,
  ): SlicedContext {
    const normalized = normalizeDependencies(tasks, dependencies);
    const graph = new TaskGraph(tasks, normalized);
    const includedTaskIds = new Set<string>();
    includedTaskIds.add(targetTaskId);

    // Add immediate dependencies and dependants (up to 2 levels)
    let frontier = [targetTaskId];
    for (let depth = 0; depth < 2 && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const parents = graph.getDependencyTasks(id).map((t) => t.id);
        const children = graph.getDependantTasks(id).map((t) => t.id);
        for (const neighbor of [...parents, ...children]) {
          if (!includedTaskIds.has(neighbor) && includedTaskIds.size < maxNeighborhoodSize) {
            includedTaskIds.add(neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
    }

    // Add remaining critical path tasks if budget remains
    const critical = graph.criticalPath({ remainingOnly: true }).taskIds;
    for (const critId of critical) {
      if (includedTaskIds.size >= maxNeighborhoodSize) break;
      includedTaskIds.add(critId);
    }

    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const slicedTasks = Array.from(includedTaskIds)
      .map((id) => taskMap.get(id))
      .filter((t): t is Task => t !== undefined);

    const slicedDeps = normalized.filter(
      (d) => includedTaskIds.has(d.dependantTaskId) && includedTaskIds.has(d.dependencyTaskId),
    );

    const total = tasks.length;
    const pruned = total - slicedTasks.length;
    const savings = total === 0 ? 0 : Math.round((pruned / total) * 100);

    return {
      tasks: slicedTasks,
      dependencies: slicedDeps,
      totalProjectTasks: total,
      prunedTasksCount: pruned,
      tokenSavingsPercent: savings,
    };
  }

  sliceForGeneralContext(
    tasks: readonly Task[],
    dependencies: readonly DependencyLike[],
    maxTasks = 50,
  ): SlicedContext {
    const normalized = normalizeDependencies(tasks, dependencies);
    const graph = new TaskGraph(tasks, normalized);
    const critical = new Set(graph.criticalPath({ remainingOnly: true }).taskIds);
    const ready = new Set(graph.getReadyTasks().map((t) => t.id));

    // Sort tasks by priority:
    // 1. Critical path & uncompleted
    // 2. IN_PROGRESS & BLOCKED
    // 3. READY
    // 4. Recently completed
    // 5. PLANNED
    const scored = tasks
      .filter((t) => t.status !== "CANCELLED")
      .map((t) => {
        let score = 0;
        if (critical.has(t.id)) score += 50;
        if (t.status === "IN_PROGRESS") score += 40;
        if (t.status === "BLOCKED") score += 35;
        if (ready.has(t.id)) score += 30;
        if (t.scopeTier === "MUST") score += 20;
        if (COMPLETED_TASK_STATUSES.has(t.status)) score -= 25;
        return { task: t, score };
      })
      .sort((a, b) => b.score - a.score);

    const selectedTasks = scored.slice(0, maxTasks).map((s) => s.task);
    const selectedIds = new Set(selectedTasks.map((t) => t.id));

    const selectedDeps = normalized.filter(
      (d) => selectedIds.has(d.dependantTaskId) && selectedIds.has(d.dependencyTaskId),
    );

    const total = tasks.length;
    const pruned = total - selectedTasks.length;
    const savings = total === 0 ? 0 : Math.round((pruned / total) * 100);

    return {
      tasks: selectedTasks,
      dependencies: selectedDeps,
      totalProjectTasks: total,
      prunedTasksCount: pruned,
      tokenSavingsPercent: savings,
    };
  }

  compactSummaries(
    tasks: readonly Task[],
    dependencies: readonly DependencyLike[],
  ): readonly CompactTaskSummary[] {
    const depMap = new Map<string, string[]>();
    for (const d of dependencies) {
      const list = depMap.get(d.dependantTaskId) ?? [];
      list.push(d.dependencyTaskId);
      depMap.set(d.dependantTaskId, list);
    }

    return tasks.map((t) => ({
      id: t.id,
      title: t.title.slice(0, 100),
      status: t.status,
      ...(t.scopeTier ? { tier: t.scopeTier } : {}),
      ...(t.ownerRole ? { role: t.ownerRole } : {}),
      effort: t.estimatedEffortHours,
      deps: depMap.get(t.id) ?? [],
    }));
  }
}
