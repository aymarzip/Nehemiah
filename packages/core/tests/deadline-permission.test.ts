import { describe, expect, it } from "vitest";
import {
  DeadlineService,
  DomainValidationError,
  PermissionDeniedError,
  PermissionService,
  Role,
} from "../src/index.js";
import { BASE_TIME, makeMember, makeTask, makeWorkspace } from "./factories.js";

describe("DeadlineService", () => {
  const service = new DeadlineService();

  it("selects standard phases from explicit time windows", () => {
    const at = (days: number) =>
      service.phase({
        deadline: new Date(BASE_TIME.getTime() + days * 24 * 60 * 60 * 1000),
        now: BASE_TIME,
        mode: "STANDARD",
      });

    expect(at(31)).toBe("PRODUCTION");
    expect(at(20)).toBe("SCOPE_LOCK");
    expect(at(7)).toBe("FEATURE_FREEZE");
    expect(at(2)).toBe("SHIP_MODE");
    expect(at(0)).toBe("DEADLINE_PASSED");
  });

  it("selects game jam phases relative to total jam duration", () => {
    const deadline = new Date(BASE_TIME.getTime() + 48 * 60 * 60 * 1000);
    const phaseAfter = (hours: number) =>
      service.phase({
        deadline,
        projectStartedAt: BASE_TIME,
        now: new Date(BASE_TIME.getTime() + hours * 60 * 60 * 1000),
        mode: "GAME_JAM",
      });

    expect(phaseAfter(0)).toBe("EXPLORATION");
    expect(phaseAfter(25)).toBe("SCOPE_LOCK");
    expect(phaseAfter(38)).toBe("FEATURE_FREEZE");
    expect(phaseAfter(45)).toBe("SHIP_MODE");
  });

  it("calculates remaining time and a capacity-based deadline buffer", () => {
    const snapshot = service.calculate({
      deadline: new Date(BASE_TIME.getTime() + 48 * 60 * 60 * 1000),
      now: BASE_TIME,
      requiredEffortHours: 15,
      availableCapacityHours: 10,
      desiredBufferHours: 2,
    });

    expect(snapshot.remainingHours).toBe(48);
    expect(snapshot.remainingDays).toBe(2);
    expect(snapshot.bufferHours).toBe(-5);
    expect(snapshot.bufferRatio).toBe(-0.5);
    expect(snapshot.bufferStatus).toBe("EXHAUSTED");
  });

  it("reports overdue time without returning negative remaining time", () => {
    const snapshot = service.calculate({
      deadline: BASE_TIME,
      now: new Date(BASE_TIME.getTime() + 6 * 60 * 60 * 1000),
    });
    expect(snapshot.remainingHours).toBe(0);
    expect(snapshot.overdueByHours).toBe(6);
    expect(snapshot.isOverdue).toBe(true);
    expect(snapshot.phase).toBe("DEADLINE_PASSED");
  });

  it("treats the exact instant as passed and remains independent of DST display zones", () => {
    const exact = service.calculate({ deadline: BASE_TIME, now: BASE_TIME });
    expect(exact).toMatchObject({
      remainingMilliseconds: 0,
      remainingHours: 0,
      overdueByHours: 0,
      isOverdue: true,
      phase: "DEADLINE_PASSED",
    });

    const beforeDstJump = new Date("2030-03-31T00:30:00.000Z");
    const afterDstJump = new Date("2030-03-31T02:30:00+02:00");
    expect(afterDstJump.getTime()).toBe(beforeDstJump.getTime());
    expect(
      service.calculate({
        deadline: new Date("2030-03-31T02:30:00.000Z"),
        now: beforeDstJump,
      }).remainingHours,
    ).toBe(2);
  });

  it("requires project start information for relative game jam phases", () => {
    expect(() =>
      service.phase({
        deadline: new Date(BASE_TIME.getTime() + 24 * 60 * 60 * 1000),
        now: BASE_TIME,
        mode: "GAME_JAM",
      }),
    ).toThrow(DomainValidationError);
    expect(
      () =>
        new DeadlineService({
          standardScopeLockHours: 10,
          standardFeatureFreezeHours: 20,
        }),
    ).toThrow(DomainValidationError);
  });
});

describe("PermissionService", () => {
  const service = new PermissionService();
  const workspace = makeWorkspace();

  it("grants workspace owners every permission", () => {
    const owner = makeMember({ id: "owner", roles: [], projectIds: [] });
    expect(service.can("INTEGRATION_MANAGE", { member: owner, workspace })).toBe(true);
  });

  it("grants role permissions only inside project membership", () => {
    const role = new Role({ id: "manager", name: "Manager", permissions: ["TASK_ASSIGN"] });
    const member = makeMember({ roles: [role] });
    expect(service.can("TASK_ASSIGN", { member, workspace, projectId: "project-1" })).toBe(true);

    const outsider = makeMember({ id: "outsider", roles: [role], projectIds: [] });
    expect(
      service.can("TASK_ASSIGN", { member: outsider, workspace, projectId: "project-1" }),
    ).toBe(false);
  });

  it("allows contributors to update their own task but not another member's", () => {
    const contributor = makeMember({
      roles: [
        new Role({
          id: "contributor",
          name: "Contributor",
          permissions: ["TASK_UPDATE_OWN"],
        }),
      ],
    });
    const owned = makeTask("owned", { ownerId: contributor.id });
    const other = makeTask("other", { ownerId: "somebody-else" });

    expect(service.checkTaskUpdate({ member: contributor, workspace, task: owned }).allowed).toBe(
      true,
    );
    expect(service.checkTaskUpdate({ member: contributor, workspace, task: other }).allowed).toBe(
      false,
    );
    expect(() =>
      service.authorizeTaskUpdate({ member: contributor, workspace, task: other }),
    ).toThrow(PermissionDeniedError);
  });

  it("supports broad task update roles and rejects cross-workspace actors", () => {
    const manager = makeMember({
      roles: [new Role({ id: "manager", name: "Manager", permissions: ["TASK_UPDATE_ANY"] })],
    });
    expect(
      service.checkTaskUpdate({ member: manager, workspace, task: makeTask("other") }).allowed,
    ).toBe(true);

    const foreign = makeMember({ workspaceId: "another-workspace", roles: manager.roles });
    expect(
      service.can("TASK_UPDATE_ANY", {
        member: foreign,
        workspace,
        task: makeTask("other"),
      }),
    ).toBe(false);
  });
});
