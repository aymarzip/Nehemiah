import { PermissionDeniedError } from "../errors.js";
import type { Workspace } from "../domain/project.js";
import type { TeamMember, Permission } from "../domain/team.js";
import type { Task } from "../domain/task.js";
import { type ProjectId } from "../domain/common.js";

export interface PermissionContext {
  member: TeamMember;
  workspace: Workspace;
  projectId?: ProjectId | undefined;
  task?: Task | undefined;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  grantedBy?: "WORKSPACE_OWNER" | "ROLE" | "TASK_OWNERSHIP" | undefined;
}

export class PermissionService {
  public check(permission: Permission, context: PermissionContext): PermissionDecision {
    if (context.member.workspaceId !== context.workspace.id) {
      return { allowed: false, reason: "Member belongs to another workspace." };
    }
    if (context.member.id === context.workspace.ownerId) {
      return {
        allowed: true,
        reason: "Workspace owners have all workspace permissions.",
        grantedBy: "WORKSPACE_OWNER",
      };
    }
    const projectId = context.projectId ?? context.task?.projectId;
    if (projectId !== undefined && !context.member.projectIds.includes(projectId)) {
      return { allowed: false, reason: "Member does not belong to this project." };
    }
    if (
      context.task !== undefined &&
      projectId !== undefined &&
      context.task.projectId !== projectId
    ) {
      return { allowed: false, reason: "Task belongs to another project." };
    }
    if (context.member.hasPermission(permission)) {
      return {
        allowed: true,
        reason: "Permission is granted by a member role.",
        grantedBy: "ROLE",
      };
    }
    return { allowed: false, reason: `No role grants '${permission}'.` };
  }

  public can(permission: Permission, context: PermissionContext): boolean {
    return this.check(permission, context).allowed;
  }

  public authorize(permission: Permission, context: PermissionContext): void {
    if (!this.can(permission, context)) {
      throw new PermissionDeniedError(context.member.id, permission);
    }
  }

  public checkTaskUpdate(context: PermissionContext & { task: Task }): PermissionDecision {
    const broad = this.check("TASK_UPDATE_ANY", context);
    if (broad.allowed) return broad;
    if (
      context.task.ownerId === context.member.id &&
      this.check("TASK_UPDATE_OWN", context).allowed
    ) {
      return {
        allowed: true,
        reason: "The member owns the task and may update their own work.",
        grantedBy: "TASK_OWNERSHIP",
      };
    }
    return {
      allowed: false,
      reason: "Member may update neither all tasks nor this owned task.",
    };
  }

  public authorizeTaskUpdate(context: PermissionContext & { task: Task }): void {
    if (!this.checkTaskUpdate(context).allowed) {
      throw new PermissionDeniedError(context.member.id, "TASK_UPDATE_ANY|TASK_UPDATE_OWN");
    }
  }
}
