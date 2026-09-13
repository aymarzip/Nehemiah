import { describe, expect, it } from "vitest";
import { ProjectDirector, Role, TaskDependency, TaskGraph } from "../src/index.js";
import { makeMember, makeProject, makeTask, makeWorkspace } from "./factories.js";

describe("ProjectDirector", () => {
  it("assembles one deterministic project view from graph, health, deadline, and risk", () => {
    const project = makeProject();
    const foundation = makeTask("foundation", {
      status: "VERIFIED",
      ownerId: "developer",
      estimatedEffortHours: 2,
    });
    const feature = makeTask("feature", {
      status: "PLANNED",
      ownerId: "developer",
      estimatedEffortHours: 4,
    });
    const release = makeTask("release", {
      status: "BLOCKED",
      impact: "CRITICAL",
      blockReason: "Store approval pending",
      estimatedEffortHours: 8,
    });
    const snapshot = new ProjectDirector().analyze({
      project,
      tasks: [foundation, feature, release],
      dependencies: [
        new TaskDependency({
          projectId: project.id,
          dependencyTaskId: foundation.id,
          dependantTaskId: feature.id,
        }),
      ],
      now: new Date("2030-01-10T00:00:00.000Z"),
      availableCapacityHours: 20,
      desiredBufferHours: 4,
    });

    expect(snapshot.projectId).toBe(project.id);
    expect(snapshot.readyTaskIds).toEqual(["feature"]);
    expect(snapshot.blockedTasks.map(({ task }) => task.id)).toEqual(["release"]);
    expect(snapshot.criticalPath.taskIds).toEqual(["release"]);
    expect(snapshot.remainingEstimatedEffortHours).toBe(12);
    expect(snapshot.deadline.bufferHours).toBe(8);
    expect(snapshot.risk.overallScore).toBe(31);
    expect(snapshot.health.dimensions.IMPLEMENTATION.score).toBeGreaterThan(0);
  });

  it("combines permission and lifecycle guards for task updates", () => {
    const workspace = makeWorkspace();
    const member = makeMember({
      id: "developer",
      roles: [
        new Role({
          id: "contributor",
          name: "Contributor",
          permissions: ["TASK_UPDATE_OWN"],
        }),
      ],
    });
    const task = makeTask("task", { status: "READY", ownerId: member.id });
    const graph = new TaskGraph([task]);

    const updated = new ProjectDirector().transitionTask({
      permission: { member, workspace, task },
      graph,
      to: "IN_PROGRESS",
      now: new Date("2030-01-01T01:00:00.000Z"),
    });

    expect(updated.status).toBe("IN_PROGRESS");
    expect(updated.ownerId).toBe(member.id);
  });
});
