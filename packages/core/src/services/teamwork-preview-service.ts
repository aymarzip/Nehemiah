import { COMPLETED_TASK_STATUSES, round } from "../domain/common.js";
import type { Blocker } from "../domain/planning.js";
import { TaskDependency, type Task } from "../domain/task.js";
import type { TeamMember } from "../domain/team.js";
import { TaskGraph } from "./task-graph.js";

export interface MemberWorkloadPreview {
  readonly memberId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly assignedTasksCount: number;
  readonly activeTasksCount: number;
  readonly estimatedHoursRemaining: number;
  readonly hoursPerWeek: number;
  readonly workloadRatio: number;
  readonly loadCategory: "BALANCED" | "OVERLOADED" | "AVAILABLE";
  readonly blockedTasksCount: number;
  readonly aiTools: readonly string[];
}

export interface CrossMemberHandoff {
  readonly waitingMemberId: string;
  readonly waitingMemberName: string;
  readonly blockedTaskId: string;
  readonly blockedTaskTitle: string;
  readonly blockingMemberId: string;
  readonly blockingMemberName: string;
  readonly dependencyTaskId: string;
  readonly dependencyTaskTitle: string;
}

export interface TeamworkPreviewResult {
  readonly totalMembers: number;
  readonly overloadedMembersCount: number;
  readonly members: readonly MemberWorkloadPreview[];
  readonly handoffs: readonly CrossMemberHandoff[];
  readonly bottleneckMemberIds: readonly string[];
}

export class TeamworkPreviewService {
  generate(
    members: readonly TeamMember[],
    tasks: readonly Task[],
    dependencies: readonly (
      | TaskDependency
      | { readonly dependantTaskId: string; readonly dependencyTaskId: string }
    )[],
    blockers: readonly Blocker[] = [],
  ): TeamworkPreviewResult {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const normalizedDeps: TaskDependency[] = dependencies.map((d) =>
      d instanceof TaskDependency
        ? d
        : new TaskDependency({
            projectId: taskMap.get(d.dependantTaskId)?.projectId ?? "project-1",
            dependantTaskId: d.dependantTaskId,
            dependencyTaskId: d.dependencyTaskId,
          }),
    );
    const graph = new TaskGraph(tasks, normalizedDeps);
    const criticalTaskIds = new Set(graph.criticalPath({ remainingOnly: true }).taskIds);
    const memberMap = new Map(members.map((m) => [m.id, m]));

    const openBlockedTaskIds = new Set(
      blockers
        .filter((b) => b.status === "OPEN" && b.blockedTaskId !== undefined)
        .map((b) => b.blockedTaskId!),
    );

    const memberPreviews: MemberWorkloadPreview[] = members.map((member) => {
      const assigned = tasks.filter((t) => t.ownerId === member.id && t.status !== "CANCELLED");
      const active = assigned.filter((t) => !COMPLETED_TASK_STATUSES.has(t.status));
      const hoursRemaining = active.reduce((sum, t) => sum + t.estimatedEffortHours, 0);
      const capacity = member.availability.weeklyHours;
      const ratio = capacity > 0 ? round(hoursRemaining / capacity, 2) : 0;

      const loadCategory = ratio > 1.2 ? "OVERLOADED" : ratio < 0.5 ? "AVAILABLE" : "BALANCED";

      const blockedCount = active.filter(
        (t) => t.status === "BLOCKED" || openBlockedTaskIds.has(t.id),
      ).length;

      const aiTools = member.aiToolProfile?.tools.map((t) => t.name) ?? [];

      return {
        memberId: member.id,
        displayName: member.displayName,
        roles: member.roles.map((r) => r.name),
        assignedTasksCount: assigned.length,
        activeTasksCount: active.length,
        estimatedHoursRemaining: hoursRemaining,
        hoursPerWeek: capacity,
        workloadRatio: ratio,
        loadCategory,
        blockedTasksCount: blockedCount,
        aiTools,
      };
    });

    const handoffs: CrossMemberHandoff[] = [];
    const blockingMemberImpact = new Map<string, number>();

    for (const dep of dependencies) {
      const dependant = taskMap.get(dep.dependantTaskId);
      const dependency = taskMap.get(dep.dependencyTaskId);

      if (
        dependant &&
        dependency &&
        !COMPLETED_TASK_STATUSES.has(dependency.status) &&
        dependant.ownerId &&
        dependency.ownerId &&
        dependant.ownerId !== dependency.ownerId
      ) {
        const waitingMember = memberMap.get(dependant.ownerId);
        const blockingMember = memberMap.get(dependency.ownerId);

        if (waitingMember && blockingMember) {
          handoffs.push({
            waitingMemberId: waitingMember.id,
            waitingMemberName: waitingMember.displayName,
            blockedTaskId: dependant.id,
            blockedTaskTitle: dependant.title,
            blockingMemberId: blockingMember.id,
            blockingMemberName: blockingMember.displayName,
            dependencyTaskId: dependency.id,
            dependencyTaskTitle: dependency.title,
          });

          const currentImpact = blockingMemberImpact.get(blockingMember.id) ?? 0;
          const weight = criticalTaskIds.has(dependency.id) ? 3 : 1;
          blockingMemberImpact.set(blockingMember.id, currentImpact + weight);
        }
      }
    }

    const bottleneckMemberIds = Array.from(blockingMemberImpact.entries())
      .filter(([, impact]) => impact >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    const overloadedCount = memberPreviews.filter((m) => m.loadCategory === "OVERLOADED").length;

    return {
      totalMembers: members.length,
      overloadedMembersCount: overloadedCount,
      members: memberPreviews,
      handoffs,
      bottleneckMemberIds,
    };
  }
}
