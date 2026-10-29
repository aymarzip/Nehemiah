import { describe, expect, it, vi } from "vitest";
import {
  Availability,
  Blocker,
  BoostEngine,
  GoalService,
  GraphSlicer,
  LearningEngine,
  ProjectBrowserService,
  ProjectVision,
  TechnicalGrillEngine,
  TeamworkPreviewService,
  cleanHtmlContent,
  isSafePublicUrl,
} from "../src/index.js";
import { makeMember, makeProject, makeTask } from "./factories.js";

describe("GoalService", () => {
  it("computes goal alignment, completion percentages, and unaligned tasks", () => {
    const service = new GoalService();
    const vision = new ProjectVision({
      statement: "Build a multiplayer turn-based tactics game",
      targetOutcome: "Playable demo shipped to Steam",
      problem: "Current prototypes lack tactical depth",
      mustHaveScope: ["Combat loop", "Grid movement"],
      shouldHaveScope: ["Inventory"],
      niceToHaveScope: ["Particle trails"],
      successCriteria: ["Multiplayer match completes without desync"],
    });

    const tasks = [
      makeTask("t1", { title: "Combat loop", scopeTier: "MUST", status: "SHIPPED" }),
      makeTask("t2", { title: "Grid movement", scopeTier: "MUST", status: "IN_PROGRESS" }),
      makeTask("t3", { title: "Inventory", scopeTier: "SHOULD", status: "PLANNED" }),
      makeTask("t4", {
        title: "Random side experiment",
        scopeTier: "NICE",
        deadlineCriticality: "OPTIONAL",
        releaseRequired: false,
        status: "PLANNED",
      }),
    ];

    const summary = service.computeProgress(vision, tasks);

    expect(summary.statement).toBe("Build a multiplayer turn-based tactics game");
    expect(summary.totalTasks).toBe(4);
    expect(summary.completedTasks).toBe(1);
    expect(summary.mustHaveTotal).toBe(2);
    expect(summary.mustHaveCompleted).toBe(1);
    expect(summary.mustHaveProgressPercent).toBe(50);
    expect(summary.overallProgressPercent).toBe(25);
    expect(summary.isMustHaveComplete).toBe(false);
    expect(summary.unalignedTaskIds).toContain("t4");
  });
});

describe("ProjectBrowserService and URL Safety", () => {
  it("rejects private, loopback, and unsafe URLs", () => {
    expect(isSafePublicUrl("http://localhost:3000").safe).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.1/status").safe).toBe(false);
    expect(isSafePublicUrl("http://[::1]/status").safe).toBe(false);
    expect(isSafePublicUrl("http://[::]/status").safe).toBe(false);
    expect(isSafePublicUrl("http://[fe80::1]/status").safe).toBe(false);
    expect(isSafePublicUrl("http://[fc00::1]/status").safe).toBe(false);
    expect(isSafePublicUrl("http://10.0.0.5/api").safe).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.1/admin").safe).toBe(false);
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data").safe).toBe(false);
    expect(isSafePublicUrl("ftp://example.com/file").safe).toBe(false);
    expect(isSafePublicUrl("file:///etc/passwd").safe).toBe(false);
  });

  it("accepts valid public https URLs", () => {
    const result = isSafePublicUrl("https://api.github.com/repos/aymarzip/Nehemiah");
    expect(result.safe).toBe(true);
    expect(result.url?.hostname).toBe("api.github.com");
  });

  it("cleans HTML content, extracts title, headings, links safely without ReDoS", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Nehemiah Specs</title></head>
        <body>
          <script>alert('bad');</script>
          <style>body { color: red; }</style>
          <h1>Project Director</h1>
          <h2>Architecture</h2>
          <p>Deterministic core &amp; AI boundary. See <a href="https://example.com/docs">docs</a>.</p>
        </body>
      </html>
    `;
    const cleaned = cleanHtmlContent(html);
    expect(cleaned.title).toBe("Nehemiah Specs");
    expect(cleaned.text).toContain("Project Director");
    expect(cleaned.text).toContain("Deterministic core & AI boundary.");
    expect(cleaned.text).not.toContain("alert");
    expect(cleaned.headings).toContain("Project Director");
    expect(cleaned.headings).toContain("Architecture");
    expect(cleaned.links).toContain("https://example.com/docs");

    const t0 = Date.now();
    cleanHtmlContent("<script>" + "<a".repeat(20_000));
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it("fetches docs safely with injected fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><head><title>Docs</title></head><body><h1>Specs</h1><p>Specs summary</p></body></html>",
    });
    const service = new ProjectBrowserService();
    const result = await service.fetchDoc(
      "https://docs.example.com/specs",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.title).toBe("Docs");
    expect(result.text).toContain("Specs summary");
    expect(result.headings).toContain("Specs");
    expect(result.fetchedAt).toBeDefined();
  });

  it("searches knowledge across memory, decisions, and github activities", () => {
    const service = new ProjectBrowserService();
    const memory = [
      {
        title: "Database Architecture",
        content: "PostgreSQL with connection pooling",
        category: "ARCHITECTURE",
      },
      { title: "UI Components", content: "React with tailwind", category: "TECH" },
    ];
    const decisions = [
      {
        title: "Use Postgres for Storage",
        rationale: "PostgreSQL provides transactional durability",
        outcome: "Postgres chosen",
      },
    ];
    const activities = [
      {
        kind: "PULL_REQUEST",
        externalId: "#42",
        branch: "feat/postgres-pool",
        url: "https://github.example/pr/42",
      },
    ];

    const results = service.searchKnowledge("postgres database", memory, decisions, activities);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.kind === "MEMORY")).toBe(true);
    expect(results.some((r) => r.sourceKind === "MEMORY")).toBe(true);
    expect(results.some((r) => r.kind === "DECISION")).toBe(true);
    expect(results.some((r) => r.kind === "GITHUB")).toBe(true);
  });
});

describe("TechnicalGrillEngine", () => {
  it("generates structured questions across all 8 pillars and compiles decisions", () => {
    const engine = new TechnicalGrillEngine();
    const session = engine.generateQuestions("User Authentication", "task-auth");

    expect(session.topic).toBe("User Authentication");
    expect(session.taskId).toBe("task-auth");
    expect(session.questions.length).toBe(8);
    expect(session.questions.map((q) => q.pillar)).toEqual([
      "ARCHITECTURE",
      "DATA_MODEL",
      "AUTH_SECURITY",
      "API_CONTRACTS",
      "UX_FLOW",
      "PERFORMANCE",
      "DEPLOYMENT",
      "EDGE_CASES",
    ]);

    const answers = [
      {
        question: session.questions[0]!.question,
        selectedOptionKey: "ISOLATED_MODULE",
        notes: "Keeps auth domain separated from discord kit",
      },
      {
        question: session.questions[1]!.question,
        selectedOptionKey: "AUDITABLE_APPEND_ONLY",
        notes: "Audit log for token revocation",
      },
    ];

    const decisionDraft = engine.compileDecision(session.topic, answers, session.taskId);
    expect(decisionDraft.title).toContain("User Authentication");
    expect(decisionDraft.type).toBe("ARCHITECTURE");
    expect(decisionDraft.rationale).toContain("ISOLATED_MODULE");
    expect(decisionDraft.rationale).toContain("AUDITABLE_APPEND_ONLY");
    expect(decisionDraft.alternatives.length).toBeGreaterThan(0);
    expect(decisionDraft.alternatives[0]).not.toContain("Alternative for:");
  });
});

describe("TeamworkPreviewService", () => {
  it("computes workload preview, bottlenecks, and cross-member handoffs", () => {
    const service = new TeamworkPreviewService();
    const memberA = makeMember({ id: "mem-a", displayName: "Alice" });
    const memberB = makeMember({ id: "mem-b", displayName: "Bob" });

    const taskA = makeTask("task-a", {
      title: "Backend Core",
      ownerId: "mem-a",
      estimatedEffortHours: 10,
      status: "IN_PROGRESS",
    });
    const taskB = makeTask("task-b", {
      title: "Frontend UI",
      ownerId: "mem-b",
      estimatedEffortHours: 5,
      status: "READY",
    });

    const dependencies = [{ dependantTaskId: "task-b", dependencyTaskId: "task-a" }];

    const preview = service.generate([memberA, memberB], [taskA, taskB], dependencies);

    expect(preview.totalMembers).toBe(2);
    expect(preview.members.length).toBe(2);
    expect(preview.handoffs.length).toBe(1);
    expect(preview.handoffs[0]?.waitingMemberName).toBe("Bob");
    expect(preview.handoffs[0]?.blockingMemberName).toBe("Alice");
    expect(preview.handoffs[0]?.dependencyTaskTitle).toBe("Backend Core");
  });

  it("handles dependency cycles and dangling dependencies gracefully without throwing", () => {
    const service = new TeamworkPreviewService();
    const memberA = makeMember({ id: "mem-a", displayName: "Alice" });
    const taskA = makeTask("task-a", { title: "A", ownerId: "mem-a" });
    const taskB = makeTask("task-b", { title: "B", ownerId: "mem-a" });

    const cyclicWithDangling = [
      { dependantTaskId: "task-a", dependencyTaskId: "task-b" },
      { dependantTaskId: "task-b", dependencyTaskId: "task-a" },
      { dependantTaskId: "task-a", dependencyTaskId: "non-existent" },
    ];

    expect(() => service.generate([memberA], [taskA, taskB], cyclicWithDangling)).not.toThrow();
  });

  it("flags member with 0 weekly hours but active tasks as OVERLOADED", () => {
    const service = new TeamworkPreviewService();
    const member = makeMember({
      id: "mem-leave",
      displayName: "On Leave",
      availability: new Availability({ timezone: "UTC", weeklyHours: 0 }),
    });
    const task = makeTask("task-1", {
      ownerId: "mem-leave",
      status: "IN_PROGRESS",
      estimatedEffortHours: 8,
    });

    const preview = service.generate([member], [task], []);
    expect(preview.members[0]?.loadCategory).toBe("OVERLOADED");
  });
});

describe("LearningEngine", () => {
  it("generates retrospective insights and identifies blocker patterns", () => {
    const engine = new LearningEngine();
    const tasks = [
      makeTask("t1", { status: "SHIPPED", estimatedEffortHours: 4 }),
      makeTask("t2", { status: "INTEGRATED", estimatedEffortHours: 6 }),
      makeTask("t3", { status: "VERIFIED", estimatedEffortHours: 5 }),
    ];
    const blockers = [
      new Blocker({
        id: "b1",
        projectId: "proj-1",
        description: "Waiting on API contract",
        source: "TASK",
        severity: "HIGH",
        suggestedResolution: "Agree on interface",
        createdAt: new Date(),
        resolvedAt: new Date(),
      }),
      new Blocker({
        id: "b2",
        projectId: "proj-1",
        description: "Task dependency pending",
        source: "TASK",
        severity: "MEDIUM",
        suggestedResolution: "Wait for merge",
        createdAt: new Date(),
      }),
    ];

    const report = engine.analyze(tasks, blockers);
    expect(report.completedTasksCount).toBe(3);
    expect(report.resolvedBlockersCount).toBe(1);
    expect(report.primaryBlockerSource).toBe("TASK");
    expect(report.insights.length).toBeGreaterThan(0);
    expect(report.insights.some((i) => i.category === "VELOCITY")).toBe(true);
  });
});

describe("BoostEngine", () => {
  it("generates task boost blueprint and tailored AI prompt template", () => {
    const engine = new BoostEngine();
    const project = makeProject();
    const task = makeTask("t1", {
      title: "Implement Inventory Contract",
      component: "inventory",
      expectedOutcome: "Inventory round-trips correctly",
      verificationRequirements: ["Unit test passes", "Boundary check on capacity"],
      suggestedEvidence: ["PULL_REQUEST", "TEST_RESULT"],
      riskLevel: "HIGH",
      deadlineCriticality: "CRITICAL",
    });

    const blueprint = engine.boostTask(task, project, []);
    expect(blueprint.taskId).toBe("t1");
    expect(blueprint.executionSteps.length).toBeGreaterThan(0);
    expect(blueprint.executionBlueprint).toEqual(blueprint.executionSteps);
    expect(blueprint.verificationChecklist).toContain("Unit test passes");
    expect(blueprint.aiPromptTemplate).toContain("Implement Inventory Contract");
    expect(blueprint.aiPromptTemplate).toContain("Context for Your AI Assistant");
  });

  it("identifies unblocking actions and optimization suggestions with cycle resilience", () => {
    const engine = new BoostEngine();
    const taskA = makeTask("tA", { title: "API Core", status: "IN_PROGRESS" });
    const taskB = makeTask("tB", {
      title: "Web Client",
      status: "BLOCKED",
      blockReason: "Waiting on API core",
    });
    const blocker = new Blocker({
      id: "b1",
      projectId: "proj-1",
      description: "Client blocked by API core",
      source: "TASK",
      severity: "CRITICAL",
      blockedTaskId: "tB",
      blockingTaskId: "tA",
      suggestedResolution: "Finish API",
      createdAt: new Date(),
    });

    const unblockActions = engine.analyzeUnblocking([blocker], [taskA, taskB]);
    expect(unblockActions.length).toBe(1);
    expect(unblockActions[0]?.action).toContain("Stub interface");
    expect(unblockActions[0]?.tacticalSteps).toContain(unblockActions[0]?.action);
    expect(unblockActions[0]?.estimatedTimeSavedHours).toBe(8);

    const cyclicDeps = [
      { dependantTaskId: "tB", dependencyTaskId: "tA" },
      { dependantTaskId: "tA", dependencyTaskId: "tB" },
      { dependantTaskId: "tA", dependencyTaskId: "missing" },
    ];
    expect(() => engine.suggestOptimizations([taskA, taskB], cyclicDeps)).not.toThrow();
  });
});

describe("GraphSlicer", () => {
  it("slices task graph to immediate neighborhood and saves prompt tokens", () => {
    const slicer = new GraphSlicer();
    const tasks = [
      makeTask("t1", { title: "Root A" }),
      makeTask("t2", { title: "Root B" }),
      makeTask("t3", { title: "Middle C" }),
      makeTask("t4", { title: "Leaf D" }),
      makeTask("t5", { title: "Unrelated E", status: "SHIPPED" }),
      makeTask("t6", { title: "Unrelated F", status: "SHIPPED" }),
    ];
    const deps = [
      { dependantTaskId: "t3", dependencyTaskId: "t1" },
      { dependantTaskId: "t4", dependencyTaskId: "t3" },
    ];

    const slice = slicer.sliceForTask("t3", tasks, deps, 4);
    expect(slice.tasks.some((t) => t.id === "t3")).toBe(true);
    expect(slice.tasks.some((t) => t.id === "t1")).toBe(true);
    expect(slice.tasks.some((t) => t.id === "t4")).toBe(true);
    expect(slice.totalProjectTasks).toBe(6);
    expect(slice.prunedTasksCount).toBeGreaterThan(0);
    expect(slice.tokenSavingsPercent).toBeGreaterThan(0);

    const generalSlice = slicer.sliceForGeneralContext(tasks, deps, 3);
    expect(generalSlice.tasks.length).toBeLessThanOrEqual(3);

    const summaries = slicer.compactSummaries(slice.tasks, slice.dependencies);
    expect(summaries.length).toBe(slice.tasks.length);
    expect(summaries[0]?.effort).toBeDefined();
  });

  it("handles cycle and missing target task gracefully without throwing", () => {
    const slicer = new GraphSlicer();
    const tasks = [makeTask("t1", { title: "A" }), makeTask("t2", { title: "B" })];
    const deps = [
      { dependantTaskId: "t1", dependencyTaskId: "t2" },
      { dependantTaskId: "t2", dependencyTaskId: "t1" },
      { dependantTaskId: "t1", dependencyTaskId: "nonexistent" },
    ];

    expect(() => slicer.sliceForGeneralContext(tasks, deps)).not.toThrow();
    const emptySlice = slicer.sliceForTask("non-existent-task", tasks, deps);
    expect(emptySlice.tasks).toEqual([]);
  });
});
