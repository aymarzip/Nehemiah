import {
  Availability,
  Project,
  ProjectVision,
  Role,
  Task,
  TaskEvidence,
  TeamMember,
  Workspace,
  type ProjectInput,
  type TaskEvidenceInput,
  type TaskInput,
  type TeamMemberInput,
} from "../src/index.js";

export const BASE_TIME = new Date("2030-01-01T00:00:00.000Z");

export function makeTask(id: string, input: Partial<TaskInput> = {}): Task {
  return new Task({
    projectId: "project-1",
    title: `Task ${id}`,
    estimatedEffortHours: 1,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...input,
    id,
  });
}

export function makeEvidence(
  taskId: string,
  kind: TaskEvidenceInput["kind"],
  id = `${taskId}-${kind}`,
): TaskEvidence {
  return new TaskEvidence({
    id,
    taskId,
    kind,
    summary: `${kind} evidence`,
    recordedAt: new Date(BASE_TIME.getTime() + 60_000),
  });
}

export function makeProject(input: Partial<ProjectInput> = {}): Project {
  return new Project({
    id: "project-1",
    workspaceId: "workspace-1",
    name: "Nehemiah",
    description: "AI Project Director",
    vision: new ProjectVision({ statement: "Ship a reliable vertical slice" }),
    deadline: new Date("2030-02-01T00:00:00.000Z"),
    timezone: "UTC",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    status: "ACTIVE",
    ...input,
  });
}

export function makeWorkspace(): Workspace {
  return new Workspace({
    id: "workspace-1",
    name: "Studio",
    ownerId: "owner",
    createdAt: BASE_TIME,
  });
}

export function makeMember(input: Partial<TeamMemberInput> = {}): TeamMember {
  return new TeamMember({
    id: "member-1",
    workspaceId: "workspace-1",
    projectIds: ["project-1"],
    displayName: "Member",
    availability: new Availability({ timezone: "UTC", weeklyHours: 20 }),
    roles: [new Role({ id: "contributor", name: "Contributor" })],
    ...input,
  });
}
