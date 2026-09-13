import { describe, expect, it } from "vitest";
import { GitHubIntelligenceService, Task, TaskDependency } from "../src/index.js";

describe("GitHub intelligence", () => {
  it("derives contract, stale PR, parallel integration and late broad-change risk from metadata", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const contract = new Task({
      id: "contract",
      projectId: "p",
      title: "Change inventory contract",
      status: "IN_PROGRESS",
      impact: "CRITICAL",
      deadlineCriticality: "CRITICAL",
      estimatedEffortHours: 4,
    });
    const consumer = new Task({
      id: "consumer",
      projectId: "p",
      title: "Build crafting",
      status: "IN_PROGRESS",
      impact: "HIGH",
      estimatedEffortHours: 5,
    });
    const service = new GitHubIntelligenceService();
    const findings = service.assess({
      tasks: [contract, consumer],
      dependencies: [
        new TaskDependency({
          projectId: "p",
          dependencyTaskId: "contract",
          dependantTaskId: "consumer",
        }),
      ],
      criticalPathTaskIds: new Set(["contract", "consumer"]),
      phase: "SHIP_MODE",
      now,
      broadChangeFileCount: 2,
      activities: [
        {
          id: "pr-1",
          kind: "PULL_REQUEST",
          taskId: "contract",
          title: "PR #1",
          changedFiles: ["src/api/inventory.ts", "src/database/schema.ts"],
          openedAt: new Date("2026-08-10T00:00:00Z"),
          updatedAt: new Date("2026-08-10T00:00:00Z"),
          reviewed: false,
          checksPassing: false,
          merged: false,
        },
        {
          id: "pr-2",
          kind: "PULL_REQUEST",
          taskId: "consumer",
          title: "PR #2",
          changedFiles: ["src/api/inventory.ts"],
          updatedAt: now,
          merged: false,
        },
      ],
    });
    expect(new Set(findings.map((finding) => finding.code))).toEqual(
      new Set(["CONTRACT_CHANGE", "STALE_BLOCKING_PR", "LARGE_RISK_CHANGE", "INTEGRATION_RISK"]),
    );
  });

  it("does not use commit count as a productivity signal", () => {
    const task = new Task({ id: "t", projectId: "p", title: "Task", status: "IN_PROGRESS" });
    const findings = new GitHubIntelligenceService().assess({
      tasks: [task],
      activities: [
        {
          id: "push",
          kind: "PUSH",
          taskId: "t",
          title: "Large push",
          changedFiles: [],
          updatedAt: new Date(),
        },
      ],
      phase: "PRODUCTION",
    });
    expect(findings).toEqual([]);
  });
});
