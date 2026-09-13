import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  InMemoryProjectStore,
  PostgresGitHubEventHandler,
  PostgresProjectStore,
  PostgresWebhookInbox,
  runMigrations,
} from "./index.js";
import type { ProjectSetupInput, ProjectStore } from "./records.js";

function setupInput(overrides: Partial<ProjectSetupInput> = {}): ProjectSetupInput {
  const now = new Date("2026-08-13T00:00:00.000Z");
  return {
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    ownerMemberId: randomUUID(),
    workspaceName: "Jam team",
    discordGuildId: randomUUID(),
    ownerExternalUserId: "discord-owner",
    ownerDisplayName: "Owner",
    name: "Build in 48 hours",
    description: "Game jam project",
    vision: "A complete, playable experience",
    deadline: new Date(now.getTime() + 48 * 60 * 60 * 1_000),
    timezone: "Europe/Kiev",
    mode: "GAME_JAM",
    githubRepository: "team/game",
    constraints: ["48 hours"],
    createdAt: now,
    ...overrides,
  };
}

async function exerciseStore(store: ProjectStore): Promise<void> {
  const input = setupInput();
  const project = await store.setupProject(input);
  expect(project.mode).toBe("GAME_JAM");
  expect((await store.getProjectByGuild(input.discordGuildId!))?.id).toBe(input.projectId);

  const member = await store.joinTeam({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    externalUserId: "developer",
    displayName: "Developer",
    roles: ["DEVELOPER"],
    skills: [{ name: "TypeScript", level: 4 }],
    availability: { hoursPerWeek: 20 },
    communicationPreferences: { timezone: "UTC" },
    aiToolProfiles: [{ tool: "Codex" }],
    now: input.createdAt,
  });
  const milestone = {
    id: randomUUID(),
    projectId: project.id,
    name: "Release candidate",
    description: "A verified, packaged build",
    dueAt: new Date(input.createdAt.getTime() + 36 * 60 * 60 * 1_000),
    status: "ACTIVE" as const,
    completionCriteria: ["Artifact is downloadable"],
    createdAt: input.createdAt,
  };
  await store.createMilestone(milestone);
  expect(await store.listMilestones(project.id)).toMatchObject([
    { id: milestone.id, name: "Release candidate" },
  ]);
  const dependency = await store.createTask({
    id: randomUUID(),
    projectId: project.id,
    ownerMemberId: member.id,
    title: "Core loop",
    description: "Implement loop",
    impact: "CRITICAL",
    weight: 3,
    estimatedEffortHours: 5,
    now: input.createdAt,
  });
  const task = await store.createTask({
    id: randomUUID(),
    projectId: project.id,
    ownerMemberId: member.id,
    title: "Integrated build",
    description: "Package the game",
    impact: "HIGH",
    weight: 2,
    estimatedEffortHours: 3,
    now: input.createdAt,
  });
  await store.addTaskDependency(task.id, dependency.id);
  await expect(store.addTaskDependency(task.id, dependency.id)).resolves.toBeUndefined();
  const tasks = await store.listTasks(project.id);
  expect(tasks.find((candidate) => candidate.id === task.id)?.dependencyIds).toEqual([
    dependency.id,
  ]);
  expect(await store.listMemberTasks(project.id, member.id)).toHaveLength(2);
  const transitionTime = new Date(input.createdAt.getTime() + 1_000);
  const transitioned = await store.applyTaskTransition({
    taskId: dependency.id,
    expectedStatus: dependency.status,
    expectedUpdatedAt: dependency.updatedAt,
    status: "READY",
    now: transitionTime,
  });
  expect(transitioned.status).toBe("READY");
  await expect(
    store.applyTaskTransition({
      taskId: dependency.id,
      expectedStatus: dependency.status,
      expectedUpdatedAt: dependency.updatedAt,
      status: "CANCELLED",
      now: new Date(transitionTime.getTime() + 1_000),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  const planned = await store.createTaskPlan({
    projectId: project.id,
    tasks: [
      {
        id: randomUUID(),
        projectId: project.id,
        milestoneId: milestone.id,
        title: "Release package",
        description: "Create the release artifact",
        expectedOutcome: "A downloadable release artifact exists",
        ownerRole: "RELEASE",
        riskLevel: "HIGH",
        verificationRequirements: ["artifact can be downloaded"],
        suggestedEvidence: ["ARTIFACT"],
        component: "release",
        deadlineCriticality: "CRITICAL",
        scopeTier: "MUST",
        releaseRequired: true,
        impact: "CRITICAL",
        weight: 2,
        estimatedEffortHours: 2,
        now: input.createdAt,
      },
    ],
    dependencies: [],
  });
  expect(planned[0]).toMatchObject({
    component: "release",
    scopeTier: "MUST",
    milestoneId: milestone.id,
  });

  const revisionId = randomUUID();
  await store.addVisionRevision({
    id: revisionId,
    projectId: project.id,
    statement: "Ship a complete, tested experience",
    problem: "The build is not yet demonstrably releasable",
    targetOutcome: "A tested release exists",
    coreExperience: "Play from start to finish",
    mustHaveScope: ["Core loop"],
    shouldHaveScope: ["Audio"],
    niceToHaveScope: [],
    excludedScope: ["Multiplayer"],
    constraints: ["48 hours"],
    successCriteria: ["Playable build"],
    status: "PROPOSED",
    proposedBy: member.id,
    createdAt: input.createdAt,
  });
  const decision = {
    id: randomUUID(),
    projectId: project.id,
    type: "SCOPE_CHANGE" as const,
    title: "Cut multiplayer",
    description: "Remove multiplayer from approved scope",
    context: "Deadline buffer is shrinking",
    rationale: "Protect the playable build",
    outcome: "Multiplayer excluded",
    alternatives: ["Reduce content"],
    affectedTaskIds: [],
    affectedComponents: ["networking"],
    status: "ACCEPTED" as const,
    authorMemberId: member.id,
    approvedByMemberId: member.id,
    createdAt: input.createdAt,
    approvedAt: input.createdAt,
  };
  await store.approveVisionRevision(revisionId, member.id, decision, input.createdAt);
  expect((await store.getProject(project.id))?.visionDetails.excludedScope).toContain(
    "Multiplayer",
  );
  expect(await store.listDecisions(project.id)).toHaveLength(1);
  const replacementDecisionId = randomUUID();
  await store.addDecision({
    ...decision,
    id: replacementDecisionId,
    title: "Replace scope-cut rationale",
    rationale: "New integration evidence supports a clearer reason",
    supersedesDecisionId: decision.id,
  });
  const decisionHistory = await store.listDecisions(project.id);
  expect(decisionHistory.find((entry) => entry.id === decision.id)).toMatchObject({
    status: "SUPERSEDED",
    supersededByDecisionId: replacementDecisionId,
  });
  expect(await store.getDecision(project.id, decision.id)).toMatchObject({
    id: decision.id,
    status: "SUPERSEDED",
  });
  expect(await store.getDecision(project.id, "nonexistent-id")).toBeUndefined();

  const mem1Id = randomUUID();
  const mem2Id = randomUUID();
  await store.addMemoryEntry({
    id: mem1Id,
    projectId: project.id,
    category: "FACT",
    title: "Server spec",
    content: "Host has 16GB RAM",
    confidence: 1,
    createdAt: input.createdAt,
  });
  await store.addMemoryEntry({
    id: mem2Id,
    projectId: project.id,
    category: "CONSTRAINT",
    title: "Latency limit",
    content: "Must respond in 100ms",
    confidence: 1,
    createdAt: new Date(input.createdAt.getTime() + 1000),
  });
  const allMem = await store.listMemory(project.id);
  expect(allMem).toHaveLength(2);
  const limitedMem = await store.listMemory(project.id, undefined, 1);
  expect(limitedMem).toHaveLength(1);

  const blockerId = randomUUID();
  await store.addBlocker({
    id: blockerId,
    projectId: project.id,
    description: "Release signing is unavailable",
    source: "HUMAN",
    severity: "HIGH",
    blockedTaskId: planned[0]!.id,
    suggestedResolution: "Ask the producer for signing credentials",
    createdBy: member.id,
    createdAt: input.createdAt,
  });
  expect(await store.listBlockers(project.id)).toHaveLength(1);
  await store.resolveBlocker(blockerId, member.id, input.createdAt);
  expect(await store.listBlockers(project.id)).toHaveLength(0);

  await store.assignTask(
    {
      id: randomUUID(),
      projectId: project.id,
      taskId: planned[0]!.id,
      memberId: member.id,
      reasons: ["Release role and available capacity"],
      score: 80,
      confidence: 0.6,
      automatic: false,
      approvedBy: member.id,
      createdAt: input.createdAt,
    },
    input.createdAt,
  );
  expect(await store.listAssignments(project.id, planned[0]!.id)).toHaveLength(1);

  await store.addRiskSnapshot({
    id: randomUUID(),
    projectId: project.id,
    score: 42,
    severity: "HIGH",
    signals: [{ code: "BLOCKED_CRITICAL_TASK" }],
    changes: [{ delta: 8 }],
    capturedAt: input.createdAt,
  });
  expect(await store.listRiskSnapshots(project.id)).toHaveLength(1);
  const settings = await store.getProjectSettings(project.id);
  await store.saveProjectSettings({
    ...settings,
    checkpointCadenceHours: 6,
    notificationPolicy: "IMMEDIATE_CRITICAL",
    baselineTaskIds: planned.map((task) => task.id),
  });
  expect(await store.getProjectSettings(project.id)).toMatchObject({ checkpointCadenceHours: 6 });
  await store.addGitHubActivity({
    id: randomUUID(),
    projectId: project.id,
    taskId: planned[0]!.id,
    kind: "PULL_REQUEST",
    externalId: "41",
    url: "https://github.example/team/game/pull/41",
    branch: `task/${planned[0]!.id}`,
    changedFiles: ["src/release/package.ts"],
    metadata: { action: "opened", trust: "untrusted_external" },
    occurredAt: input.createdAt,
  });
  expect(await store.listGitHubActivity(project.id)).toMatchObject([
    { taskId: planned[0]!.id, externalId: "41", changedFiles: ["src/release/package.ts"] },
  ]);
}

function postgresMemory() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  memory.public.registerFunction({
    name: "trim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.trim(),
  });
  memory.public.registerFunction({
    name: "length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value: string) => [...value].length,
  });
  return memory;
}

describe("InMemoryProjectStore", () => {
  it("persists the Phase 1 vertical slice and rejects cycles", async () => {
    const store = new InMemoryProjectStore();
    await exerciseStore(store);
    const project = await store.setupProject(setupInput());
    const one = await store.createTask({
      id: randomUUID(),
      projectId: project.id,
      title: "one",
      description: "one",
      impact: "LOW",
      weight: 1,
      estimatedEffortHours: 1,
      now: project.createdAt,
    });
    const two = await store.createTask({
      id: randomUUID(),
      projectId: project.id,
      title: "two",
      description: "two",
      impact: "LOW",
      weight: 1,
      estimatedEffortHours: 1,
      now: project.createdAt,
    });
    await store.addTaskDependency(two.id, one.id);
    await expect(store.addTaskDependency(one.id, two.id)).rejects.toMatchObject({ code: "CYCLE" });
  });

  it("rejects task ownership from another workspace", async () => {
    const store = new InMemoryProjectStore();
    const first = setupInput();
    const second = setupInput();
    const firstProject = await store.setupProject(first);
    await store.setupProject(second);
    await expect(
      store.createTask({
        id: randomUUID(),
        projectId: firstProject.id,
        ownerMemberId: second.ownerMemberId,
        title: "Cross-tenant task",
        description: "must be rejected",
        impact: "HIGH",
        weight: 1,
        estimatedEffortHours: 1,
        now: first.createdAt,
      }),
    ).rejects.toMatchObject({ code: "PROJECT_MISMATCH" });
  });

  it("allows only one concurrent transition from the same task revision", async () => {
    const store = new InMemoryProjectStore();
    const input = setupInput();
    const project = await store.setupProject(input);
    const task = await store.createTask({
      id: randomUUID(),
      projectId: project.id,
      title: "Contended task",
      description: "Two clients race from the same revision",
      impact: "HIGH",
      weight: 1,
      estimatedEffortHours: 1,
      now: input.createdAt,
    });
    const outcomes = await Promise.allSettled([
      store.applyTaskTransition({
        taskId: task.id,
        expectedStatus: task.status,
        expectedUpdatedAt: task.updatedAt,
        status: "READY",
        now: new Date(input.createdAt.getTime() + 1_000),
      }),
      store.applyTaskTransition({
        taskId: task.id,
        expectedStatus: task.status,
        expectedUpdatedAt: task.updatedAt,
        status: "CANCELLED",
        now: new Date(input.createdAt.getTime() + 2_000),
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  });
});

describe("PostgreSQL migrations and persistence", () => {
  it("applies committed migrations idempotently and persists project data", async () => {
    const memory = postgresMemory();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const directory = fileURLToPath(new URL("../migrations", import.meta.url));
    const first = await runMigrations(pool, { directory, advisoryLock: false });
    expect(first.applied).toEqual([
      "001_initial.sql",
      "002_phase2_product.sql",
      "003_release_hardening.sql",
    ]);
    const second = await runMigrations(pool, { directory, advisoryLock: false });
    expect(second.applied).toEqual([]);
    await exerciseStore(new PostgresProjectStore(pool));
    await pool.end();
  });

  it("normalizes duplicate setup conflicts at the PostgreSQL boundary", async () => {
    const memory = postgresMemory();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const directory = fileURLToPath(new URL("../migrations", import.meta.url));
    await runMigrations(pool, { directory, advisoryLock: false });
    const store = new PostgresProjectStore(pool);
    const input = setupInput();
    await store.setupProject(input);
    await expect(
      store.setupProject(
        setupInput({
          discordGuildId: input.discordGuildId!,
        }),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    await pool.end();
  });

  it("deduplicates GitHub deliveries at the database boundary", async () => {
    const memory = postgresMemory();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const directory = fileURLToPath(new URL("../migrations", import.meta.url));
    await runMigrations(pool, { directory, advisoryLock: false });
    const inbox = new PostgresWebhookInbox(pool);
    const event = {
      deliveryId: "delivery-id",
      eventName: "push" as const,
      receivedAt: new Date("2026-08-13T00:00:00Z"),
      trust: "untrusted_external" as const,
      payload: { ref: "refs/heads/main" },
    };
    await expect(inbox.insert(event)).resolves.toBe("inserted");
    await expect(inbox.insert(event)).resolves.toBe("duplicate");
    await pool.end();
  });

  it("does not activate a repository for an inactive GitHub installation", async () => {
    const memory = postgresMemory();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const directory = fileURLToPath(new URL("../migrations", import.meta.url));
    await runMigrations(pool, { directory, advisoryLock: false });
    await pool.query(
      `INSERT INTO github_installations (installation_id, status, updated_at)
       VALUES ($1, 'INACTIVE', $2)`,
      [77, new Date("2026-08-13T01:00:00Z")],
    );

    const handler = new PostgresGitHubEventHandler(pool);
    await handler.handle(
      {
        deliveryId: "delivery-after-suspension",
        eventName: "push",
        receivedAt: new Date("2026-08-13T02:00:00Z"),
        trust: "untrusted_external",
        installationId: 77,
        repositoryId: 88,
        repositoryFullName: "team/inactive-repository",
        payload: { ref: "refs/heads/main" },
      },
      [],
    );

    const repositories = await pool.query(
      "SELECT repository_id FROM github_repositories WHERE repository_id = $1",
      [88],
    );
    expect(repositories.rowCount).toBe(0);
    await pool.end();
  });

  it("keeps the newest GitHub state when deliveries arrive out of order", async () => {
    const memory = postgresMemory();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const directory = fileURLToPath(new URL("../migrations", import.meta.url));
    await runMigrations(pool, { directory, advisoryLock: false });
    const store = new PostgresProjectStore(pool);
    const input = setupInput();
    const project = await store.setupProject(input);
    const task = await store.createTask({
      id: randomUUID(),
      projectId: project.id,
      title: "Release candidate",
      description: "Merge and verify the release candidate",
      impact: "CRITICAL",
      weight: 3,
      estimatedEffortHours: 2,
      now: input.createdAt,
    });
    const handler = new PostgresGitHubEventHandler(pool);
    const observedAt = new Date("2026-08-13T01:00:00Z");
    await handler.handle(
      {
        deliveryId: "repository-discovered",
        eventName: "push",
        receivedAt: observedAt,
        trust: "untrusted_external",
        installationId: 77,
        repositoryId: 88,
        repositoryFullName: "team/game",
        payload: { ref: "refs/heads/main" },
      },
      [],
    );
    await store.connectGitHubRepository(project.id, 77, 88, "team/game");
    await store.linkTaskToGitHub(project.id, task.id, 88, "PULL_REQUEST", "41", observedAt);

    const envelope = (deliveryId: string, receivedAt: string) => ({
      deliveryId,
      eventName: "pull_request" as const,
      receivedAt: new Date(receivedAt),
      trust: "untrusted_external" as const,
      installationId: 77,
      repositoryId: 88,
      repositoryFullName: "team/game",
      payload: {},
    });
    await handler.handle(envelope("pr-merged", "2026-08-13T03:01:00Z"), [
      {
        type: "pull_request",
        action: "closed",
        number: 41,
        merged: true,
        draft: false,
        title: "Release candidate",
        changedFileCount: 2,
        updatedAt: "2026-08-13T03:00:00Z",
      },
    ]);
    await handler.handle(envelope("pr-opened-delayed", "2026-08-13T04:00:00Z"), [
      {
        type: "pull_request",
        action: "opened",
        number: 41,
        merged: false,
        draft: false,
        title: "Release candidate",
        changedFileCount: 1,
        updatedAt: "2026-08-13T02:00:00Z",
      },
    ]);
    expect(await store.listGitHubActivity(project.id)).toMatchObject([
      { externalId: "41", metadata: expect.objectContaining({ merged: true }) },
    ]);
    expect(await store.listTaskEvidence(task.id)).toMatchObject([
      { kind: "PULL_REQUEST", verified: true, summary: "Pull request #41 merged" },
    ]);

    const checkEnvelope = (deliveryId: string, receivedAt: string) => ({
      ...envelope(deliveryId, receivedAt),
      eventName: "check_run" as const,
    });
    await handler.handle(checkEnvelope("check-failed", "2026-08-13T05:01:00Z"), [
      {
        type: "check",
        source: "check_run",
        action: "completed",
        checkId: 501,
        status: "completed",
        conclusion: "failure",
        pullRequestNumbers: [41],
        occurredAt: "2026-08-13T05:00:00Z",
      },
    ]);
    await handler.handle(checkEnvelope("check-succeeded", "2026-08-13T06:01:00Z"), [
      {
        type: "check",
        source: "check_run",
        action: "completed",
        checkId: 501,
        status: "completed",
        conclusion: "success",
        pullRequestNumbers: [41],
        occurredAt: "2026-08-13T06:00:00Z",
      },
    ]);
    expect(
      (await store.listTaskEvidence(task.id)).filter((entry) => entry.kind === "CHECK_RUN"),
    ).toMatchObject([{ verified: true, summary: "check_run completed: success" }]);
    const notification = await pool.query<{ delivered_at: Date | null }>(
      `SELECT delivered_at FROM notification_events
       WHERE project_id = $1 AND deduplication_key = 'github-check:check_run:501'`,
      [project.id],
    );
    expect(notification.rows[0]?.delivered_at).toEqual(new Date("2026-08-13T06:00:00Z"));
    await pool.end();
  });
});
