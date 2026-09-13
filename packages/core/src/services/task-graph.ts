import {
  CycleDetectedError,
  DomainValidationError,
  DuplicateEntityError,
  EntityNotFoundError,
} from "../errors.js";
import {
  COMPLETED_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  round,
  type ProjectId,
  type TaskId,
} from "../domain/common.js";
import { dependencyIsSatisfied } from "../domain/task.js";
import type { Task, TaskDependency } from "../domain/task.js";

export type BlockReasonCode = "EXPLICITLY_BLOCKED" | "BLOCKED_DEPENDENCY" | "CANCELLED_DEPENDENCY";

export interface TaskBlockage {
  task: Task;
  reasons: readonly Readonly<{
    code: BlockReasonCode;
    dependencyTaskId?: TaskId | undefined;
    evidence: string;
  }>[];
}

export interface EffortOptions {
  remainingOnly?: boolean | undefined;
  weighted?: boolean | undefined;
}

export type CriticalPathOptions = EffortOptions;

export interface CriticalPathResult {
  taskIds: readonly TaskId[];
  estimatedEffortHours: number;
  weightedEffort: number;
  duration: number;
  weighted: boolean;
}

function edgeKey(dependency: Pick<TaskDependency, "dependencyTaskId" | "dependantTaskId">): string {
  return `${dependency.dependencyTaskId}\u0000${dependency.dependantTaskId}`;
}

function sorted<T extends string>(values: Iterable<T>): T[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export class TaskGraph {
  readonly #tasks = new Map<TaskId, Task>();
  readonly #dependenciesByTask = new Map<TaskId, Map<TaskId, TaskDependency>>();
  readonly #dependantsByTask = new Map<TaskId, Map<TaskId, TaskDependency>>();
  readonly #edges = new Map<string, TaskDependency>();
  #projectId?: ProjectId | undefined;

  public constructor(tasks: readonly Task[] = [], dependencies: readonly TaskDependency[] = []) {
    for (const task of tasks) this.registerTask(task);
    for (const dependency of dependencies) this.registerDependency(dependency);
  }

  public get size(): number {
    return this.#tasks.size;
  }

  public get projectId(): ProjectId | undefined {
    return this.#projectId;
  }

  public tasks(): readonly Task[] {
    return sorted(this.#tasks.keys()).map((id) => this.requireTask(id));
  }

  public dependencies(): readonly TaskDependency[] {
    return [...this.#edges.values()].sort((left, right) =>
      edgeKey(left).localeCompare(edgeKey(right)),
    );
  }

  public getTask(taskId: TaskId): Task | undefined {
    return this.#tasks.get(taskId);
  }

  public requireTask(taskId: TaskId): Task {
    const task = this.getTask(taskId);
    if (task === undefined) throw new EntityNotFoundError("Task", taskId);
    return task;
  }

  public addTask(task: Task): void {
    this.registerTask(task);
  }

  public replaceTask(task: Task): void {
    const existing = this.requireTask(task.id);
    if (existing.projectId !== task.projectId) {
      throw new DomainValidationError("A replacement task cannot change projectId", {
        taskId: task.id,
      });
    }
    this.#tasks.set(task.id, task);
  }

  public addDependency(dependency: TaskDependency): void {
    this.registerDependency(dependency);
    const cycle = this.findCycles()[0];
    if (cycle !== undefined) {
      this.unregisterDependency(dependency);
      throw new CycleDetectedError(cycle);
    }
  }

  public removeDependency(dependencyTaskId: TaskId, dependantTaskId: TaskId): boolean {
    const dependency = this.#edges.get(edgeKey({ dependencyTaskId, dependantTaskId }));
    if (dependency === undefined) return false;
    this.unregisterDependency(dependency);
    return true;
  }

  public getDependencies(taskId: TaskId): readonly TaskDependency[] {
    this.requireTask(taskId);
    return [...(this.#dependenciesByTask.get(taskId)?.values() ?? [])].sort((left, right) =>
      left.dependencyTaskId.localeCompare(right.dependencyTaskId),
    );
  }

  public getDependants(taskId: TaskId): readonly TaskDependency[] {
    this.requireTask(taskId);
    return [...(this.#dependantsByTask.get(taskId)?.values() ?? [])].sort((left, right) =>
      left.dependantTaskId.localeCompare(right.dependantTaskId),
    );
  }

  public getDependencyTasks(taskId: TaskId): readonly Task[] {
    return this.getDependencies(taskId).map((dependency) =>
      this.requireTask(dependency.dependencyTaskId),
    );
  }

  public getDependantTasks(taskId: TaskId): readonly Task[] {
    return this.getDependants(taskId).map((dependency) =>
      this.requireTask(dependency.dependantTaskId),
    );
  }

  public dependenciesSatisfied(taskId: TaskId): boolean {
    return this.getDependencies(taskId).every((dependency) =>
      dependencyIsSatisfied(
        this.requireTask(dependency.dependencyTaskId),
        dependency.requiredStatus,
      ),
    );
  }

  public unmetDependencies(taskId: TaskId): readonly TaskDependency[] {
    return this.getDependencies(taskId).filter(
      (dependency) =>
        !dependencyIsSatisfied(
          this.requireTask(dependency.dependencyTaskId),
          dependency.requiredStatus,
        ),
    );
  }

  public getReadyTasks(): readonly Task[] {
    return this.tasks().filter(
      (task) =>
        (task.status === "PLANNED" || task.status === "READY") &&
        this.dependenciesSatisfied(task.id),
    );
  }

  public getBlockedTasks(): readonly Task[] {
    return this.getBlockedTaskDetails().map(({ task }) => task);
  }

  public getBlockedTaskDetails(): readonly TaskBlockage[] {
    const result: TaskBlockage[] = [];
    const effectivelyBlocked = new Set<TaskId>(
      this.tasks()
        .filter((task) => task.status === "BLOCKED")
        .map((task) => task.id),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of this.tasks()) {
        if (TERMINAL_TASK_STATUSES.has(task.status) || effectivelyBlocked.has(task.id)) continue;
        const unavailableDependency = this.getDependencies(task.id).some((dependency) => {
          const dependencyTask = this.requireTask(dependency.dependencyTaskId);
          return dependencyTask.status === "CANCELLED" || effectivelyBlocked.has(dependencyTask.id);
        });
        if (unavailableDependency) {
          effectivelyBlocked.add(task.id);
          changed = true;
        }
      }
    }
    for (const task of this.tasks()) {
      if (TERMINAL_TASK_STATUSES.has(task.status)) continue;
      const reasons: Array<{
        code: BlockReasonCode;
        dependencyTaskId?: TaskId | undefined;
        evidence: string;
      }> = [];
      if (task.status === "BLOCKED") {
        reasons.push({
          code: "EXPLICITLY_BLOCKED",
          evidence: task.blockReason ?? "Task is explicitly blocked",
        });
      }
      for (const dependency of this.getDependencies(task.id)) {
        const dependencyTask = this.requireTask(dependency.dependencyTaskId);
        if (dependencyTask.status === "BLOCKED" || effectivelyBlocked.has(dependencyTask.id)) {
          reasons.push({
            code: "BLOCKED_DEPENDENCY",
            dependencyTaskId: dependencyTask.id,
            evidence: `Dependency '${dependencyTask.title}' is blocked`,
          });
        } else if (dependencyTask.status === "CANCELLED") {
          reasons.push({
            code: "CANCELLED_DEPENDENCY",
            dependencyTaskId: dependencyTask.id,
            evidence: `Required dependency '${dependencyTask.title}' was cancelled`,
          });
        }
      }
      if (reasons.length > 0) result.push({ task, reasons: Object.freeze(reasons) });
    }
    return Object.freeze(result);
  }

  public hasCycle(): boolean {
    return this.findCycles().length > 0;
  }

  public findCycles(): readonly (readonly TaskId[])[] {
    const state = new Map<TaskId, "VISITING" | "VISITED">();
    const stack: TaskId[] = [];
    const cycles = new Map<string, readonly TaskId[]>();

    const canonicalize = (cycle: readonly TaskId[]): readonly TaskId[] => {
      const open = cycle.slice(0, -1);
      let minimumIndex = 0;
      for (let index = 1; index < open.length; index += 1) {
        if ((open[index] ?? "").localeCompare(open[minimumIndex] ?? "") < 0) minimumIndex = index;
      }
      const rotated = [...open.slice(minimumIndex), ...open.slice(0, minimumIndex)];
      return Object.freeze([...rotated, rotated[0] ?? ""]);
    };

    const visit = (taskId: TaskId): void => {
      state.set(taskId, "VISITING");
      stack.push(taskId);
      for (const dependency of this.getDependants(taskId)) {
        const nextId = dependency.dependantTaskId;
        const nextState = state.get(nextId);
        if (nextState === undefined) {
          visit(nextId);
        } else if (nextState === "VISITING") {
          const start = stack.lastIndexOf(nextId);
          const cycle = canonicalize([...stack.slice(start), nextId]);
          cycles.set(cycle.join("\u0000"), cycle);
        }
      }
      stack.pop();
      state.set(taskId, "VISITED");
    };

    for (const taskId of sorted(this.#tasks.keys())) {
      if (state.get(taskId) === undefined) visit(taskId);
    }
    return Object.freeze([...cycles.values()].sort((a, b) => a.join().localeCompare(b.join())));
  }

  public topologicalOrder(): readonly Task[] {
    const inDegree = new Map<TaskId, number>();
    for (const taskId of this.#tasks.keys()) {
      inDegree.set(taskId, this.#dependenciesByTask.get(taskId)?.size ?? 0);
    }
    const queue = sorted(
      [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([taskId]) => taskId),
    );
    const result: Task[] = [];
    while (queue.length > 0) {
      const taskId = queue.shift();
      if (taskId === undefined) break;
      result.push(this.requireTask(taskId));
      for (const dependency of this.getDependants(taskId)) {
        const dependantId = dependency.dependantTaskId;
        const newDegree = (inDegree.get(dependantId) ?? 0) - 1;
        inDegree.set(dependantId, newDegree);
        if (newDegree === 0) {
          queue.push(dependantId);
          queue.sort((left, right) => left.localeCompare(right));
        }
      }
    }
    if (result.length !== this.#tasks.size) {
      throw new CycleDetectedError(this.findCycles()[0] ?? []);
    }
    return Object.freeze(result);
  }

  public estimatedEffort(options: EffortOptions = {}): number {
    return round(
      this.tasks()
        .filter((task) => this.includeInRemaining(task, options.remainingOnly ?? false))
        .reduce(
          (sum, task) =>
            sum + (options.weighted === true ? task.weightedEffort : task.estimatedEffortHours),
          0,
        ),
    );
  }

  public weightedEstimatedEffort(options: Omit<EffortOptions, "weighted"> = {}): number {
    return this.estimatedEffort({ ...options, weighted: true });
  }

  public criticalPath(options: CriticalPathOptions = {}): CriticalPathResult {
    const order = this.topologicalOrder();
    if (order.length === 0) {
      return {
        taskIds: Object.freeze([]),
        estimatedEffortHours: 0,
        weightedEffort: 0,
        duration: 0,
        weighted: options.weighted ?? false,
      };
    }
    const remainingOnly = options.remainingOnly ?? false;
    const weighted = options.weighted ?? false;
    const longest = new Map<TaskId, number>();
    const predecessor = new Map<TaskId, TaskId>();

    for (const task of order) {
      let bestDependencyDuration = 0;
      let bestDependencyId: TaskId | undefined;
      for (const dependency of this.getDependencies(task.id)) {
        const candidate = longest.get(dependency.dependencyTaskId) ?? 0;
        if (
          bestDependencyId === undefined ||
          candidate > bestDependencyDuration ||
          (candidate === bestDependencyDuration &&
            bestDependencyId !== undefined &&
            dependency.dependencyTaskId.localeCompare(bestDependencyId) < 0)
        ) {
          bestDependencyDuration = candidate;
          bestDependencyId = dependency.dependencyTaskId;
        }
      }
      if (bestDependencyId !== undefined) predecessor.set(task.id, bestDependencyId);
      const included = this.includeInRemaining(task, remainingOnly);
      const duration = included ? (weighted ? task.weightedEffort : task.estimatedEffortHours) : 0;
      longest.set(task.id, bestDependencyDuration + duration);
    }

    let endId = order[0]?.id;
    for (const task of order.slice(1)) {
      if (endId === undefined) {
        endId = task.id;
        continue;
      }
      const candidate = longest.get(task.id) ?? 0;
      const current = longest.get(endId) ?? 0;
      if (candidate > current || (candidate === current && task.id.localeCompare(endId) < 0)) {
        endId = task.id;
      }
    }
    const path: TaskId[] = [];
    let cursor = endId;
    while (cursor !== undefined) {
      path.push(cursor);
      cursor = predecessor.get(cursor);
    }
    path.reverse();
    const visiblePath = path.filter((taskId) =>
      this.includeInRemaining(this.requireTask(taskId), remainingOnly),
    );
    const pathTasks = visiblePath.map((taskId) => this.requireTask(taskId));
    return {
      taskIds: Object.freeze(visiblePath),
      estimatedEffortHours: round(
        pathTasks.reduce((sum, task) => sum + task.estimatedEffortHours, 0),
      ),
      weightedEffort: round(pathTasks.reduce((sum, task) => sum + task.weightedEffort, 0)),
      duration: round(endId === undefined ? 0 : (longest.get(endId) ?? 0)),
      weighted,
    };
  }

  private registerTask(task: Task): void {
    if (this.#tasks.has(task.id)) throw new DuplicateEntityError("Task", task.id);
    if (this.#projectId !== undefined && task.projectId !== this.#projectId) {
      throw new DomainValidationError("A task graph cannot span multiple projects", {
        expectedProjectId: this.#projectId,
        actualProjectId: task.projectId,
      });
    }
    this.#projectId = task.projectId;
    this.#tasks.set(task.id, task);
    this.#dependenciesByTask.set(task.id, new Map());
    this.#dependantsByTask.set(task.id, new Map());
  }

  private registerDependency(dependency: TaskDependency): void {
    const dependencyTask = this.requireTask(dependency.dependencyTaskId);
    const dependantTask = this.requireTask(dependency.dependantTaskId);
    if (
      dependency.projectId !== dependencyTask.projectId ||
      dependency.projectId !== dependantTask.projectId
    ) {
      throw new DomainValidationError("Task dependency projectId does not match its tasks", {
        dependencyId: dependency.id,
      });
    }
    const key = edgeKey(dependency);
    if (this.#edges.has(key)) throw new DuplicateEntityError("TaskDependency", dependency.id);
    this.#edges.set(key, dependency);
    this.#dependenciesByTask
      .get(dependency.dependantTaskId)
      ?.set(dependency.dependencyTaskId, dependency);
    this.#dependantsByTask
      .get(dependency.dependencyTaskId)
      ?.set(dependency.dependantTaskId, dependency);
  }

  private unregisterDependency(dependency: TaskDependency): void {
    this.#edges.delete(edgeKey(dependency));
    this.#dependenciesByTask.get(dependency.dependantTaskId)?.delete(dependency.dependencyTaskId);
    this.#dependantsByTask.get(dependency.dependencyTaskId)?.delete(dependency.dependantTaskId);
  }

  private includeInRemaining(task: Task, remainingOnly: boolean): boolean {
    if (task.status === "CANCELLED") return false;
    return !remainingOnly || !COMPLETED_TASK_STATUSES.has(task.status);
  }
}
