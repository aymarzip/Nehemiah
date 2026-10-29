import { COMPLETED_TASK_STATUSES } from "../domain/common.js";
import type { Blocker } from "../domain/planning.js";
import type { Project, ProjectVision } from "../domain/project.js";
import { TaskDependency, type Task } from "../domain/task.js";
import type { TeamMember } from "../domain/team.js";
import { TaskGraph } from "./task-graph.js";

function normalizeDependencies(
  tasks: readonly Task[],
  dependencies: readonly (
    | TaskDependency
    | { readonly dependantTaskId: string; readonly dependencyTaskId: string }
  )[],
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

export interface TaskBoostBlueprint {
  readonly taskId: string;
  readonly title: string;
  readonly executionSteps: readonly string[];
  readonly verificationChecklist: readonly string[];
  readonly aiPromptTemplate: string;
  readonly potentialRisks: readonly string[];
}

export interface TacticalUnblockAction {
  readonly blockerId: string;
  readonly description: string;
  readonly severity: string;
  readonly action: string;
  readonly rationale: string;
}

export interface DeliveryOptimization {
  readonly title: string;
  readonly category: "PARALLELIZE" | "SCOPE_REDUCTION" | "FAST_TRACK";
  readonly details: string;
  readonly estimatedHoursSaved: number;
}

export class BoostEngine {
  boostTask(
    task: Task,
    project: Project | ProjectVision,
    dependencies: readonly Task[],
    teamMember?: TeamMember,
  ): TaskBoostBlueprint {
    const vision = "vision" in project ? project.vision : project;
    const dependencyTitles = dependencies.map((d) => d.title);

    const executionSteps: string[] = [
      `1. Review contract assumptions: Ensure prerequisites [${dependencyTitles.length > 0 ? dependencyTitles.join(", ") : "none"}] are satisfied.`,
      `2. Implement core logic: Focus on expected outcome "${task.expectedOutcome}".`,
      `3. Boundary isolation: Keep changes scoped to component "${task.component ?? "core"}" without side effects.`,
      `4. Verify evidence: Collect required proof [${task.suggestedEvidence.join(", ") || "TEST_RESULT"}] prior to marking IMPLEMENTED.`,
    ];

    const verificationChecklist = [
      ...task.verificationRequirements,
      "Ensure all automated unit and integration tests pass cleanly.",
      "Validate boundary and edge-case behavior (e.g. empty inputs, network timeouts).",
    ];

    const potentialRisks: string[] = [
      ...(task.riskLevel === "CRITICAL" || task.riskLevel === "HIGH"
        ? ["High-impact task: Any contract drift will break downstream dependants."]
        : []),
      ...(task.deadlineCriticality === "CRITICAL"
        ? ["Critical path item: Delays directly reduce the project deadline buffer."]
        : []),
    ];

    const memberAiTool = teamMember?.aiToolProfile?.tools[0]?.name ?? "Your AI Assistant";

    const aiPromptTemplate = [
      `### Context for ${memberAiTool}`,
      `Project: ${vision.statement}`,
      `Task: ${task.title} (ID: ${task.id})`,
      `Component: ${task.component ?? "general"}`,
      `Expected Outcome: ${task.expectedOutcome}`,
      `Scope Tier: ${task.scopeTier ?? "STANDARD"}`,
      "",
      "### Verification Requirements",
      ...verificationChecklist.map((r) => `- ${r}`),
      "",
      "### Instructions for AI Coding Worker",
      "1. Implement this feature cleanly following existing repo conventions.",
      "2. Write unit tests satisfying the verification checklist above.",
      "3. Do not introduce extraneous dependencies, placeholders or untested assumptions.",
      "4. Ensure all error handling uses typed domain exceptions.",
    ].join("\n");

    return {
      taskId: task.id,
      title: task.title,
      executionSteps,
      verificationChecklist,
      aiPromptTemplate,
      potentialRisks,
    };
  }

  analyzeUnblocking(
    blockers: readonly Blocker[],
    tasks: readonly Task[],
  ): readonly TacticalUnblockAction[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const actions: TacticalUnblockAction[] = [];

    for (const b of blockers) {
      if (b.status !== "OPEN") continue;
      const blockedTask = b.blockedTaskId ? taskMap.get(b.blockedTaskId) : undefined;
      const blockingTask = b.blockingTaskId ? taskMap.get(b.blockingTaskId) : undefined;

      let action = b.suggestedResolution;
      let rationale = "Resolves blocking impediment.";

      if (blockingTask && blockedTask) {
        action = `Stub interface for "${blockingTask.title}" using mock data so "${blockedTask.title}" can proceed in parallel.`;
        rationale = "Decouples consumer development from producer completion.";
      } else if (b.source === "GITHUB" || b.source === "CI") {
        action = "Run verification tests locally and rebase onto latest main.";
        rationale = "Clears stale or conflicting pull request check runs.";
      }

      actions.push({
        blockerId: b.id,
        description: b.description,
        severity: b.severity,
        action,
        rationale,
      });
    }

    return actions;
  }

  suggestOptimizations(
    tasks: readonly Task[],
    dependencies: readonly (
      | TaskDependency
      | { readonly dependantTaskId: string; readonly dependencyTaskId: string }
    )[],
  ): readonly DeliveryOptimization[] {
    const graph = new TaskGraph(tasks, normalizeDependencies(tasks, dependencies));
    const critical = new Set(graph.criticalPath({ remainingOnly: true }).taskIds);
    const optimizations: DeliveryOptimization[] = [];

    const optionalInPath = tasks.filter(
      (t) =>
        critical.has(t.id) &&
        (t.scopeTier === "NICE" || t.deadlineCriticality === "OPTIONAL") &&
        !COMPLETED_TASK_STATUSES.has(t.status),
    );

    for (const opt of optionalInPath) {
      optimizations.push({
        title: `Deschedule non-critical task "${opt.title}" from critical path`,
        category: "SCOPE_REDUCTION",
        details: `Task is marked OPTIONAL or NICE tier but sits on the remaining critical path. Removing or deferring it saves ${opt.estimatedEffortHours}h.`,
        estimatedHoursSaved: opt.estimatedEffortHours,
      });
    }

    const readyTasks = graph.getReadyTasks().filter((t) => t.status === "READY");
    if (readyTasks.length >= 2) {
      const hours = readyTasks.reduce((acc, t) => acc + t.estimatedEffortHours, 0);
      optimizations.push({
        title: "Parallelize unblocked ready tasks across available teammates",
        category: "PARALLELIZE",
        details: `${readyTasks.length} tasks (${readyTasks
          .map((t) => t.title)
          .slice(0, 3)
          .join(", ")}) are unblocked and ready for concurrent implementation.`,
        estimatedHoursSaved: Math.round(hours * 0.4),
      });
    }

    return optimizations;
  }
}
