import type { ProjectId, TaskId, TaskStatus, TeamMemberId } from "../domain/common.js";
import type { Project } from "../domain/project.js";
import type { TeamMember } from "../domain/team.js";
import type { Task, TaskDependency, TaskEvidence } from "../domain/task.js";
import { DeadlineService, type DeadlineSnapshot } from "../services/deadline-service.js";
import { PermissionService, type PermissionContext } from "../services/permission-service.js";
import { ProjectHealthService, type ProjectHealthAssessment } from "../services/project-health.js";
import {
  RiskEngine,
  type BuildFreshnessContext,
  type HighImpactChange,
  type IntegrationDependencyStatus,
  type RequiredCheck,
  type RiskAssessment,
  type ScopeSnapshot,
} from "../services/risk-engine.js";
import { TaskGraph, type CriticalPathResult, type TaskBlockage } from "../services/task-graph.js";
import { TaskStateMachine } from "../services/task-state-machine.js";

export interface ProjectDirectorAnalysisInput {
  project: Project;
  tasks: readonly Task[];
  dependencies?: readonly TaskDependency[] | undefined;
  now?: Date | undefined;
  availableCapacityHours?: number | undefined;
  desiredBufferHours?: number | undefined;
  previousDeadlineBufferHours?: number | undefined;
  requiredChecks?: readonly RequiredCheck[] | undefined;
  highImpactChanges?: readonly HighImpactChange[] | undefined;
  buildFreshness?: BuildFreshnessContext | undefined;
  scopeHistory?: readonly ScopeSnapshot[] | undefined;
  integrationDependencies?: readonly IntegrationDependencyStatus[] | undefined;
}

export interface ProjectDirectorSnapshot {
  projectId: ProjectId;
  generatedAt: Date;
  health: ProjectHealthAssessment;
  deadline: DeadlineSnapshot;
  risk: RiskAssessment;
  criticalPath: CriticalPathResult;
  readyTaskIds: readonly TaskId[];
  blockedTasks: readonly TaskBlockage[];
  remainingEstimatedEffortHours: number;
  remainingWeightedEffort: number;
}

export interface DirectorTaskTransitionInput {
  permission: PermissionContext & { member: TeamMember; task: Task };
  graph: TaskGraph;
  to: TaskStatus;
  evidence?: readonly TaskEvidence[] | undefined;
  ownerId?: TeamMemberId | undefined;
  blockReason?: string | undefined;
  now?: Date | undefined;
}

export class ProjectDirector {
  public constructor(
    private readonly healthService = new ProjectHealthService(),
    private readonly deadlineService = new DeadlineService(),
    private readonly riskEngine = new RiskEngine(),
    private readonly stateMachine = new TaskStateMachine(),
    private readonly permissionService = new PermissionService(),
  ) {}

  public analyze(input: ProjectDirectorAnalysisInput): ProjectDirectorSnapshot {
    const now = input.now ?? new Date();
    const graph = new TaskGraph(input.tasks, input.dependencies ?? []);
    const criticalPath = graph.criticalPath({ remainingOnly: true });
    const remainingEstimatedEffortHours = graph.estimatedEffort({ remainingOnly: true });
    const remainingWeightedEffort = graph.weightedEstimatedEffort({ remainingOnly: true });
    const deadline = this.deadlineService.calculate({
      deadline: input.project.deadline,
      now,
      projectStartedAt: input.project.createdAt,
      mode: input.project.mode,
      requiredEffortHours: remainingEstimatedEffortHours,
      availableCapacityHours: input.availableCapacityHours,
      desiredBufferHours: input.desiredBufferHours,
    });
    const risk = this.riskEngine.assess({
      projectId: input.project.id,
      tasks: input.tasks,
      criticalPathTaskIds: criticalPath.taskIds,
      requiredChecks: input.requiredChecks,
      highImpactChanges: input.highImpactChanges,
      deadline: {
        deadline: input.project.deadline,
        requiredEffortHours: remainingEstimatedEffortHours,
        availableCapacityHours: input.availableCapacityHours,
        minimumBufferHours: input.desiredBufferHours,
        previousBufferHours: input.previousDeadlineBufferHours,
      },
      buildFreshness: input.buildFreshness,
      scopeHistory: input.scopeHistory,
      integrationDependencies: input.integrationDependencies,
      now,
    });
    return Object.freeze({
      projectId: input.project.id,
      generatedAt: new Date(now.getTime()),
      health: this.healthService.calculate(input.project.id, input.tasks),
      deadline,
      risk,
      criticalPath,
      readyTaskIds: Object.freeze(graph.getReadyTasks().map((task) => task.id)),
      blockedTasks: graph.getBlockedTaskDetails(),
      remainingEstimatedEffortHours,
      remainingWeightedEffort,
    });
  }

  public transitionTask(input: DirectorTaskTransitionInput): Task {
    this.permissionService.authorizeTaskUpdate(input.permission);
    return this.stateMachine.transition({
      task: input.permission.task,
      to: input.to,
      graph: input.graph,
      evidence: input.evidence,
      ownerId: input.ownerId,
      blockReason: input.blockReason,
      now: input.now,
    });
  }
}
