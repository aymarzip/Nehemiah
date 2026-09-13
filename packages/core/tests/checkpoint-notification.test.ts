import { describe, expect, it } from "vitest";
import { NotificationPolicyService, SmartCheckpointService, Task } from "../src/index.js";

describe("notification quality and checkpoints", () => {
  it("deduplicates notifications and reserves interruption for high-value events", () => {
    const at = new Date("2026-08-13T00:00:00Z");
    const plan = new NotificationPolicyService().plan(
      [
        {
          id: "old",
          kind: "BLOCKER_CREATED",
          priority: "HIGH",
          deduplicationKey: "blocker:1",
          summary: "old",
          occurredAt: at,
        },
        {
          id: "new",
          kind: "BLOCKER_CREATED",
          priority: "HIGH",
          deduplicationKey: "blocker:1",
          summary: "new",
          occurredAt: new Date(at.getTime() + 1),
        },
        {
          id: "info",
          kind: "CHECKPOINT_SUMMARY",
          priority: "NORMAL",
          deduplicationKey: "checkpoint:1",
          summary: "summary",
          occurredAt: at,
        },
      ],
      "IMMEDIATE_CRITICAL",
    );
    expect(plan.immediate.map((entry) => entry.id)).toEqual(["new"]);
    expect(plan.batched.map((entry) => entry.id)).toEqual(["info"]);
    expect(plan.suppressed.map((entry) => entry.id)).toEqual(["old"]);
  });

  it("does not ask people to repeat repository activity already observed", () => {
    const checkpoint = new SmartCheckpointService().create({
      memberId: "member",
      tasks: [
        new Task({
          id: "t",
          projectId: "p",
          title: "Feature",
          ownerId: "member",
          status: "IN_PROGRESS",
        }),
      ],
      activity: [{ kind: "PULL_REQUEST_OPENED", summary: "PR #41 was opened", taskId: "t" }],
    });
    expect(checkpoint.observed).toEqual(["PR #41 was opened"]);
    expect(checkpoint.questions.map((question) => question.key)).toEqual(["BLOCKER"]);
  });
});
