import { describe, expect, it } from "vitest";
import {
  InvalidTaskTransitionError,
  TASK_STATUSES,
  TaskDependency,
  TaskGraph,
  TaskStateMachine,
} from "../src/index.js";
import { BASE_TIME, makeEvidence, makeTask } from "./factories.js";

const machine = new TaskStateMachine();
const later = (hours: number): Date => new Date(BASE_TIME.getTime() + hours * 60 * 60 * 1000);

describe("TaskStateMachine", () => {
  it("exposes the exact Phase 1 lifecycle", () => {
    expect(TASK_STATUSES).toEqual([
      "PLANNED",
      "READY",
      "IN_PROGRESS",
      "BLOCKED",
      "IMPLEMENTED",
      "VERIFIED",
      "INTEGRATED",
      "SHIPPED",
      "CANCELLED",
    ]);
    expect(machine.allowedTargets("PLANNED")).toEqual(["READY", "CANCELLED"]);
    expect(machine.allowedTargets("READY")).toEqual(["IN_PROGRESS", "BLOCKED", "CANCELLED"]);
    expect(machine.allowedTargets("IN_PROGRESS")).toEqual(["BLOCKED", "IMPLEMENTED", "CANCELLED"]);
    expect(machine.allowedTargets("BLOCKED")).toEqual(["READY", "IN_PROGRESS", "CANCELLED"]);
    expect(machine.allowedTargets("IMPLEMENTED")).toEqual([
      "IN_PROGRESS",
      "VERIFIED",
      "BLOCKED",
      "CANCELLED",
    ]);
    expect(machine.allowedTargets("VERIFIED")).toEqual([
      "IN_PROGRESS",
      "INTEGRATED",
      "BLOCKED",
      "CANCELLED",
    ]);
    expect(machine.allowedTargets("INTEGRATED")).toEqual(["IN_PROGRESS", "SHIPPED", "BLOCKED"]);
    expect(machine.allowedTargets("SHIPPED")).toEqual([]);
    expect(machine.allowedTargets("CANCELLED")).toEqual([]);
  });

  it("guards readiness on dependency completion", () => {
    const dependency = makeTask("dependency", { status: "IMPLEMENTED" });
    const task = makeTask("task");
    const graph = new TaskGraph(
      [dependency, task],
      [
        new TaskDependency({
          projectId: "project-1",
          dependencyTaskId: dependency.id,
          dependantTaskId: task.id,
          requiredStatus: "VERIFIED",
        }),
      ],
    );

    expect(machine.canTransition({ task, to: "READY", graph, now: later(1) })).toEqual({
      allowed: false,
      reasons: ["dependencies are not satisfied: dependency"],
    });
    graph.replaceTask(dependency.with({ status: "VERIFIED", updatedAt: later(1) }));
    expect(machine.transition({ task, to: "READY", graph, now: later(2) }).status).toBe("READY");
  });

  it("requires an owner before starting work", () => {
    const task = makeTask("task", { status: "READY" });
    const graph = new TaskGraph([task]);
    expect(() =>
      machine.transition({ task, to: "IN_PROGRESS", ownerId: "developer", now: later(1) }),
    ).toThrow(/task graph is required/);
    expect(() => machine.transition({ task, to: "IN_PROGRESS", graph, now: later(1) })).toThrow(
      /owner is required/,
    );

    const started = machine.transition({
      task,
      to: "IN_PROGRESS",
      graph,
      ownerId: "developer",
      now: later(1),
    });
    expect(started.ownerId).toBe("developer");
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("requires a human-readable reason for blockage and clears it when unblocked", () => {
    const ready = makeTask("task", { status: "READY", ownerId: "developer" });
    const graph = new TaskGraph([ready]);
    expect(() => machine.transition({ task: ready, to: "BLOCKED", now: later(1) })).toThrow(
      /block reason/,
    );
    const blocked = machine.transition({
      task: ready,
      to: "BLOCKED",
      blockReason: "CI environment is unavailable",
      now: later(1),
    });
    expect(blocked.blockReason).toBe("CI environment is unavailable");

    const resumed = machine.transition({
      task: blocked,
      to: "IN_PROGRESS",
      graph,
      now: later(2),
    });
    expect(resumed.blockReason).toBeUndefined();
  });

  it("enforces evidence gates across implemented, verified, integrated, and shipped", () => {
    let task = makeTask("task", { status: "READY", ownerId: "developer" });
    const graph = new TaskGraph([task]);
    task = machine.transition({ task, to: "IN_PROGRESS", graph, now: later(1) });

    expect(() => machine.transition({ task, to: "IMPLEMENTED", now: later(2) })).toThrow(
      /implementation evidence/,
    );
    task = machine.transition({
      task,
      to: "IMPLEMENTED",
      evidence: [makeEvidence(task.id, "COMMIT")],
      now: later(2),
    });

    expect(() => machine.transition({ task, to: "VERIFIED", now: later(3) })).toThrow(
      /verification evidence/,
    );
    task = machine.transition({
      task,
      to: "VERIFIED",
      evidence: [makeEvidence(task.id, "TEST_RESULT")],
      now: later(3),
    });

    expect(() => machine.transition({ task, to: "INTEGRATED", now: later(4) })).toThrow(
      /integration evidence/,
    );
    task = machine.transition({
      task,
      to: "INTEGRATED",
      evidence: [makeEvidence(task.id, "BUILD")],
      now: later(4),
    });

    expect(() => machine.transition({ task, to: "SHIPPED", now: later(5) })).toThrow(
      /shipment evidence/,
    );
    task = machine.transition({
      task,
      to: "SHIPPED",
      evidence: [makeEvidence(task.id, "DEPLOYMENT")],
      now: later(5),
    });

    expect(task.status).toBe("SHIPPED");
    expect(task.evidence.map((item) => item.kind)).toEqual([
      "COMMIT",
      "TEST_RESULT",
      "BUILD",
      "DEPLOYMENT",
    ]);
  });

  it("rejects duplicate or cross-task evidence", () => {
    const original = makeEvidence("task", "COMMIT", "same-id");
    const task = makeTask("task", {
      status: "IN_PROGRESS",
      ownerId: "developer",
      evidence: [original],
    });
    expect(() =>
      machine.transition({
        task,
        to: "IMPLEMENTED",
        evidence: [makeEvidence("task", "COMMIT", "same-id")],
        now: later(1),
      }),
    ).toThrow(/duplicated/);
    expect(() =>
      machine.transition({
        task,
        to: "IMPLEMENTED",
        evidence: [makeEvidence("other", "COMMIT")],
        now: later(1),
      }),
    ).toThrow(/another task/);
  });

  it("keeps shipped and cancelled states terminal", () => {
    expect(() =>
      machine.transition({ task: makeTask("shipped", { status: "SHIPPED" }), to: "IN_PROGRESS" }),
    ).toThrow(InvalidTaskTransitionError);
    expect(() =>
      machine.transition({ task: makeTask("cancelled", { status: "CANCELLED" }), to: "PLANNED" }),
    ).toThrow(InvalidTaskTransitionError);
  });

  it("rejects time travel", () => {
    const task = makeTask("task", { status: "READY", updatedAt: later(5), ownerId: "developer" });
    const graph = new TaskGraph([task]);
    expect(() => machine.transition({ task, to: "IN_PROGRESS", graph, now: later(4) })).toThrow(
      /cannot precede/,
    );
  });
});
