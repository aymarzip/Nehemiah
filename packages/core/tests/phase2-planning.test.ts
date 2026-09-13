import { describe, expect, it } from "vitest";
import {
  AICapacityDimensions,
  AssignmentEngine,
  Availability,
  Blocker,
  BlockerEngine,
  DeadlineService,
  ProjectVision,
  RecommendationEngine,
  ReleaseReadinessService,
  Role,
  ScopeEngine,
  Skill,
  TaskDependency,
  TaskDecompositionValidator,
  TaskGraph,
} from "../src/index.js";
import { BASE_TIME, makeMember, makeTask } from "./factories.js";

describe("Phase 2 planning engines", () => {
  it("models a durable, tiered vision without losing the original statement", () => {
    const vision = new ProjectVision({
      statement: "Ship the smallest useful director",
      problem: "Teams confuse implementation with release readiness",
      targetOutcome: "A team can confidently ship",
      coreExperience: "Ask what now and get an evidence-grounded answer",
      mustHaveScope: ["Critical path", "Evidence"],
      shouldHaveScope: ["Mission Control"],
      niceToHaveScope: ["Animations"],
      excludedScope: ["Employee surveillance"],
      constraints: ["No required AI key"],
    });
    expect(vision.mustHaveScope).toEqual(["Critical path", "Evidence"]);
    expect(vision.excludedScope).toContain("Employee surveillance");
  });

  it("recommends assignments from context, workload, dependencies and conservative AI capacity", () => {
    const task = makeTask("api", {
      title: "Stabilize API contract",
      ownerRole: "Developer",
      component: "API",
      tags: ["TypeScript", "API"],
      impact: "CRITICAL",
    });
    const member = makeMember({
      id: "developer",
      roles: [new Role({ id: "developer", name: "Developer" })],
      skills: [new Skill({ name: "TypeScript", level: 5, tags: ["API"] })],
      availability: new Availability({ timezone: "UTC", weeklyHours: 30 }),
    });
    const recommendation = new AssignmentEngine().recommend({
      task,
      candidates: [
        {
          member,
          currentTasks: [],
          recentComponent: "API",
          aiCapacity: new AICapacityDimensions({ confidence: 0.2, reliability: 0.5 }),
        },
      ],
      graph: new TaskGraph([task]),
      criticalPathTaskIds: new Set([task.id]),
      now: BASE_TIME,
    })[0];
    expect(recommendation?.score).toBeGreaterThan(70);
    expect(recommendation?.reasons.join(" ")).toContain("critical path");
    expect(recommendation?.cautions.join(" ")).toContain("low confidence");
  });

  it("what-now prioritizes critical fan-out and suppresses optional refactors in ship mode", () => {
    const contract = makeTask("contract", {
      title: "Finish inventory serialization",
      expectedOutcome: "Serialization API merged and integration tests passing",
      ownerId: "member-1",
      impact: "CRITICAL",
      status: "READY",
    });
    const crafting = makeTask("crafting", { title: "Integrate crafting", status: "PLANNED" });
    const refactor = makeTask("refactor", {
      title: "Refactor registry",
      status: "READY",
      scopeTier: "NICE",
      tags: ["optional", "refactor"],
    });
    const dependency = new TaskDependency({
      projectId: "project-1",
      dependencyTaskId: contract.id,
      dependantTaskId: crafting.id,
    });
    const recommendation = new RecommendationEngine().whatNow({
      member: makeMember(),
      tasks: [contract, crafting, refactor],
      dependencies: [dependency],
      phase: "SHIP_MODE",
      deadlineBufferHours: -2,
    });
    expect(recommendation?.taskId).toBe(contract.id);
    expect(recommendation?.reasons.join(" ")).toContain("dependant");
    expect(recommendation?.avoidForNow).toContain("Refactor registry");
  });

  it("ranks blocker fan-out and never mutates scope when proposing cuts", () => {
    const root = makeTask("root", { scopeTier: "SHOULD", estimatedEffortHours: 4 });
    const one = makeTask("one");
    const two = makeTask("two");
    const dependencies = [
      new TaskDependency({
        projectId: "project-1",
        dependencyTaskId: root.id,
        dependantTaskId: one.id,
      }),
      new TaskDependency({
        projectId: "project-1",
        dependencyTaskId: one.id,
        dependantTaskId: two.id,
      }),
    ];
    const graph = new TaskGraph([root, one, two], dependencies);
    const blocker = new Blocker({
      id: "blocker",
      projectId: "project-1",
      description: "Contract unavailable",
      source: "TASK",
      severity: "HIGH",
      blockedTaskId: root.id,
    });
    expect(new BlockerEngine().prioritize([blocker], graph)[0]?.fanOut).toBe(2);
    const cuts = new ScopeEngine().cutCandidates([root, one, two], dependencies);
    expect(cuts[0]).toMatchObject({ taskId: root.id, expectedTimeSavedHours: 4 });
    expect(root.status).toBe("PLANNED");
  });

  it("keeps release readiness independent and exposes failed gates", () => {
    const assessment = new ReleaseReadinessService().assess({
      tasks: [makeTask("done", { status: "INTEGRATED", releaseRequired: true })],
      requiredChecks: [{ name: "test", passed: true }],
      buildAvailable: true,
      packagingComplete: false,
    });
    expect(assessment.ready).toBe(false);
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Packaging"),
        expect.stringContaining("required tasks"),
      ]),
    );
  });

  it("supports a configurable exploration stage for game jams", () => {
    const service = new DeadlineService({ gameJamExplorationRemainingRatio: 0.8 });
    expect(
      service.phase({
        deadline: new Date("2030-01-03T00:00:00Z"),
        now: new Date("2030-01-01T04:00:00Z"),
        projectStartedAt: BASE_TIME,
        mode: "GAME_JAM",
      }),
    ).toBe("EXPLORATION");
  });

  it("rejects cycles and unknown dependencies in AI-proposed task graphs", () => {
    const validator = new TaskDecompositionValidator();
    const proposal = (key: string, dependencyKeys: readonly string[]) => ({
      key,
      title: key,
      description: key,
      expectedOutcome: `${key} complete`,
      estimatedEffortHours: 1,
      impact: "MEDIUM" as const,
      riskLevel: "LOW" as const,
      dependencyKeys,
      verificationRequirements: ["test passes"],
      suggestedEvidence: ["TEST_RESULT"],
      deadlineCriticality: "IMPORTANT" as const,
      scopeTier: "MUST" as const,
    });
    expect(() =>
      validator.validate({
        projectId: "project-1",
        proposals: [proposal("a", ["b"]), proposal("b", ["a"])],
        idForKey: (key) => key,
      }),
    ).toThrow(/cycle/iu);
    expect(() =>
      validator.validate({
        projectId: "project-1",
        proposals: [proposal("a", ["missing"])],
        idForKey: (key) => key,
      }),
    ).toThrow(/unknown dependency/iu);
  });
});
