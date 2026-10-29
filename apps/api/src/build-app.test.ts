import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@nehemiah/config";
import { InMemoryProjectStore } from "@nehemiah/database";
import {
  GitHubWebhookProcessor,
  GitHubWebhookReceiver,
  InMemoryWebhookInbox,
  signGitHubWebhook,
} from "@nehemiah/github";
import { createLlmRegistry, FakeProvider, fakeJsonResponse, LlmRegistry } from "@nehemiah/llm";
import { createLogger } from "@nehemiah/observability";
import { buildApp } from "./build-app.js";
import { createConfiguredLlmRegistry } from "./llm-configuration.js";

const internalHeaders = { "x-nehemiah-internal-token": "integration-secret" };

function testConfig(aiProvider: "fake" | "none" = "fake") {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    INTERNAL_API_TOKEN: "integration-secret",
    AI_PROVIDER: aiProvider,
  });
}

function logger() {
  return createLogger({ level: "silent", service: "api-test", environment: "test" });
}

const setupPayload = {
  discordGuildId: "guild-1",
  ownerExternalUserId: "owner-user",
  ownerDisplayName: "Producer",
  name: "Jam Game",
  description: "A complete playable game",
  vision: "Ship a small cohesive experience",
  deadline: "2099-08-15T18:00:00+03:00",
  timezone: "Europe/Kiev",
  mode: "GAME_JAM" as const,
  githubRepository: "team/jam-game",
  constraints: ["No feature work after freeze"],
};

describe("Phase 1 HTTP vertical slice", () => {
  it("runs setup, team, task lifecycle, status, memory and producer without live credentials", async () => {
    const config = testConfig();
    const store = new InMemoryProjectStore();
    const app = buildApp({
      config,
      store,
      llm: createConfiguredLlmRegistry(config.ai),
      logger: logger(),
    });
    try {
      const denied = await app.inject({ method: "GET", url: "/v1/tasks/mine" });
      expect(denied.statusCode).toBe(401);

      const invalidProjectId = await app.inject({
        method: "POST",
        url: "/v1/projects/not-a-uuid/tasks",
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          title: "Invalid",
          description: "Rejected before persistence",
          impact: "LOW",
          weight: 1,
          estimatedEffortHours: 1,
        },
      });
      expect(invalidProjectId.statusCode).toBe(400);
      expect(invalidProjectId.json()).toMatchObject({ code: "INVALID_REQUEST" });

      const setup = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: setupPayload,
      });
      expect(setup.statusCode).toBe(201);
      const identifiers = setup.json<{ projectId: string; workspaceId: string }>();
      const owner = await store.getTeamMember(identifiers.workspaceId, "owner-user");
      expect(owner?.roles).toEqual(["OWNER", "PRODUCER"]);
      const duplicateSetup = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: setupPayload,
      });
      expect(duplicateSetup.statusCode).toBe(409);
      expect(duplicateSetup.json()).toMatchObject({ code: "ALREADY_EXISTS" });

      const joined = await app.inject({
        method: "POST",
        url: "/v1/team/join",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
          displayName: "Developer",
          roles: ["DEVELOPER"],
          skills: [{ name: "TypeScript", level: 4 }],
          hoursPerWeek: 30,
          timezone: "Europe/Kiev",
          aiTools: ["Codex"],
        },
      });
      expect(joined.statusCode).toBe(201);
      const developerId = joined.json<{ memberId: string }>().memberId;

      const firstTask = await app.inject({
        method: "POST",
        url: `/v1/projects/${identifiers.projectId}/tasks`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          ownerMemberId: developerId,
          title: "Implement core loop",
          description: "Build the playable loop",
          impact: "CRITICAL",
          weight: 3,
          estimatedEffortHours: 8,
        },
      });
      const firstTaskId = firstTask.json<{ id: string }>().id;
      expect(firstTask.statusCode).toBe(201);

      const secondTask = await app.inject({
        method: "POST",
        url: `/v1/projects/${identifiers.projectId}/tasks`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          ownerMemberId: developerId,
          title: "Produce integrated build",
          description: "Package and smoke-test the game",
          impact: "HIGH",
          weight: 2,
          estimatedEffortHours: 4,
        },
      });
      const secondTaskId = secondTask.json<{ id: string }>().id;
      expect(secondTask.statusCode).toBe(201);

      const dependency = await app.inject({
        method: "POST",
        url: `/v1/tasks/${secondTaskId}/dependencies`,
        headers: internalHeaders,
        payload: { dependsOnTaskId: firstTaskId, externalUserId: "owner-user" },
      });
      expect(dependency.statusCode).toBe(204);
      const cycle = await app.inject({
        method: "POST",
        url: `/v1/tasks/${firstTaskId}/dependencies`,
        headers: internalHeaders,
        payload: { dependsOnTaskId: secondTaskId, externalUserId: "owner-user" },
      });
      expect(cycle.statusCode).toBe(409);
      expect(cycle.json()).toMatchObject({ code: "CYCLE" });

      const mine = await app.inject({
        method: "GET",
        url: "/v1/tasks/mine?discordGuildId=guild-1&externalUserId=developer-user",
        headers: internalHeaders,
      });
      expect(mine.statusCode).toBe(200);
      expect(mine.json<unknown[]>()).toHaveLength(2);

      const ready = await app.inject({
        method: "PATCH",
        url: `/v1/tasks/${firstTaskId}/status`,
        headers: internalHeaders,
        payload: { externalUserId: "developer-user", status: "READY" },
      });
      expect(ready.statusCode).toBe(200);
      const started = await app.inject({
        method: "PATCH",
        url: `/v1/tasks/${firstTaskId}/status`,
        headers: internalHeaders,
        payload: { externalUserId: "developer-user", status: "IN_PROGRESS" },
      });
      expect(started.json<{ status: string }>().status).toBe("IN_PROGRESS");
      const invalidTransition = await app.inject({
        method: "PATCH",
        url: `/v1/tasks/${firstTaskId}/status`,
        headers: internalHeaders,
        payload: {
          externalUserId: "developer-user",
          status: "SHIPPED",
          evidence: "No deployment exists yet",
        },
      });
      expect(invalidTransition.statusCode).toBe(400);
      expect(invalidTransition.json()).toMatchObject({ code: "INVALID_TASK_TRANSITION" });

      const memory = await app.inject({
        method: "POST",
        url: `/v1/projects/${identifiers.projectId}/memory`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          category: "DECISION",
          title: "Scope lock",
          content: "No new features after the halfway point.",
          confidence: 1,
        },
      });
      expect(memory.statusCode).toBe(201);

      const status = await app.inject({
        method: "GET",
        url: "/v1/projects/by-guild/guild-1/status",
        headers: internalHeaders,
      });
      expect(status.statusCode).toBe(200);
      expect(
        status.json<{ criticalPath: string[]; health: Record<string, number> }>(),
      ).toMatchObject({
        criticalPath: ["Implement core loop", "Produce integrated build"],
        health: {
          implementation: expect.any(Number),
          integration: expect.any(Number),
          verification: expect.any(Number),
          releaseReadiness: expect.any(Number),
        },
      });

      const producer = await app.inject({
        method: "POST",
        url: "/v1/producer/ask",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
          question: "What is the critical path?",
        },
      });
      expect(producer.statusCode).toBe(200);
      expect(producer.json<{ provider: string; answer: string }>()).toMatchObject({
        provider: "fake",
        answer: expect.stringContaining("FakeProvider"),
      });
    } finally {
      await app.close();
    }
  });

  it("runs the Phase 2 planning, governance, blocker, memory and Mission Control workflow", async () => {
    const config = testConfig();
    const app = buildApp({
      config,
      store: new InMemoryProjectStore(),
      llm: createConfiguredLlmRegistry(config.ai),
      logger: logger(),
    });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: {
          ...setupPayload,
          problem: "The team needs a shippable jam build",
          targetOutcome: "A tested playable release",
          coreExperience: "Complete one cohesive run",
          mustHaveScope: ["Core loop", "Release build"],
          shouldHaveScope: ["Audio"],
          niceToHaveScope: ["Extra animation"],
          excludedScope: ["Multiplayer"],
        },
      });
      const { projectId } = setup.json<{ projectId: string }>();

      const decomposition = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/decompose`,
        headers: internalHeaders,
        payload: { externalUserId: "owner-user", goal: "Deliver inventory serialization" },
      });
      expect(decomposition.statusCode).toBe(201);
      const created = decomposition.json<{
        tasks: { id: string; title: string }[];
        provider: string;
      }>();
      expect(created.provider).toBe("fake");
      expect(created.tasks).toHaveLength(3);

      const whatNow = await app.inject({
        method: "POST",
        url: "/v1/producer/what-now",
        headers: internalHeaders,
        payload: { discordGuildId: "guild-1", externalUserId: "owner-user" },
      });
      expect(whatNow.statusCode).toBe(200);
      expect(whatNow.json()).toMatchObject({ recommendation: { priority: "CRITICAL" } });

      const blocker = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/blockers`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          description: "Contract review is waiting",
          source: "HUMAN",
          severity: "HIGH",
          blockedTaskId: created.tasks[1]!.id,
          suggestedResolution: "Review the acceptance contract",
        },
      });
      expect(blocker.statusCode).toBe(201);
      const blockerId = blocker.json<{ id: string }>().id;
      const blockers = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/blockers?externalUserId=owner-user`,
        headers: internalHeaders,
      });
      expect(blockers.json<{ priority: unknown }[]>()[0]).toHaveProperty("priority");

      const scope = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/scope/cut-recommendations`,
        headers: internalHeaders,
        payload: { externalUserId: "owner-user" },
      });
      expect(scope.json()).toMatchObject({ requiresExplicitDecision: true });

      const vision = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/vision/revisions`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          statement: "Ship a small verified inventory slice",
          problem: "Integration risk",
          targetOutcome: "Verified inventory in a build",
          coreExperience: "Save and restore inventory",
          mustHaveScope: ["Serialization"],
          shouldHaveScope: [],
          niceToHaveScope: [],
          excludedScope: ["Cloud saves"],
          constraints: ["Jam deadline"],
          successCriteria: ["Round-trip integration test passes"],
        },
      });
      const revisionId = vision.json<{ id: string }>().id;
      const approved = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/vision/revisions/${revisionId}/approve`,
        headers: internalHeaders,
        payload: { externalUserId: "owner-user", reason: "Protect the release path" },
      });
      expect(approved.json()).toMatchObject({ status: "APPROVED" });

      await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/memory`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          category: "ARCHITECTURE",
          title: "Persistence",
          content: "PostgreSQL is the durable project truth.",
          confidence: 1,
        },
      });
      const memory = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/memory/query`,
        headers: internalHeaders,
        payload: { externalUserId: "owner-user", question: "Why PostgreSQL persistence?" },
      });
      expect(memory.json()).toMatchObject({
        citations: [expect.objectContaining({ kind: "ARCHITECTURE" })],
      });

      const mission = await app.inject({
        method: "POST",
        url: "/v1/projects/mission-control",
        headers: internalHeaders,
        payload: { discordGuildId: "guild-1", externalUserId: "owner-user" },
      });
      expect(mission.statusCode).toBe(200);
      expect(mission.json()).toMatchObject({
        integrationProgress: expect.any(Number),
        release: { score: expect.any(Number), ready: false },
        drift: { detected: false },
      });

      const resolved = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/blockers/${blockerId}/resolve`,
        headers: internalHeaders,
        payload: { externalUserId: "owner-user" },
      });
      expect(resolved.json()).toMatchObject({ resolvedBy: expect.any(String) });

      const ready = await app.inject({ method: "GET", url: "/ready" });
      expect(ready.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
        version: "1.0.0",
      });
    } finally {
      await app.close();
    }
  });

  it("keeps deterministic endpoints available when no AI provider is configured", async () => {
    const config = testConfig("none");
    const app = buildApp({
      config,
      store: new InMemoryProjectStore(),
      llm: createLlmRegistry(undefined),
      logger: logger(),
    });
    try {
      await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: setupPayload,
      });
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.json()).toMatchObject({ status: "ok", aiConfigured: false });
      const status = await app.inject({
        method: "GET",
        url: "/v1/projects/by-guild/guild-1/status",
        headers: internalHeaders,
      });
      expect(status.statusCode).toBe(200);
      const producer = await app.inject({
        method: "POST",
        url: "/v1/producer/ask",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "owner-user",
          question: "What next?",
        },
      });
      expect(producer.statusCode).toBe(503);
      expect(producer.json()).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
      const deterministic = await app.inject({
        method: "POST",
        url: "/v1/producer/what-now",
        headers: internalHeaders,
        payload: { discordGuildId: "guild-1", externalUserId: "owner-user" },
      });
      expect(deterministic.statusCode).toBe(200);
      const unavailableDecomposition = await app.inject({
        method: "POST",
        url: `/v1/projects/${status.json<{ projectId: string }>().projectId}/decompose`,
        headers: internalHeaders,
        payload: { externalUserId: "owner-user", goal: "Build a feature" },
      });
      expect(unavailableDecomposition.statusCode).toBe(503);
      expect(unavailableDecomposition.json()).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    } finally {
      await app.close();
    }
  });

  it("boots a deterministic demo without external services or credentials", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      INTERNAL_API_TOKEN: "integration-secret",
      AI_PROVIDER: "fake",
      DEMO_MODE: "true",
    });
    const app = buildApp({
      config,
      store: new InMemoryProjectStore(),
      llm: createConfiguredLlmRegistry(config.ai),
      logger: logger(),
    });
    try {
      const first = await app.inject({
        method: "POST",
        url: "/v1/demo/bootstrap",
        headers: internalHeaders,
        payload: {
          discordGuildId: "demo-guild",
          ownerExternalUserId: "demo-owner",
          ownerDisplayName: "Demo Owner",
        },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        reused: false,
        walkthrough: expect.arrayContaining(["/producer what-now"]),
      });
      const mission = await app.inject({
        method: "POST",
        url: "/v1/projects/mission-control",
        headers: internalHeaders,
        payload: { discordGuildId: "demo-guild", externalUserId: "demo-owner" },
      });
      expect(mission.statusCode).toBe(200);
      expect(mission.json()).toMatchObject({
        project: { name: "Clockwork Garden Demo" },
        blockers: [expect.objectContaining({ fanOut: expect.any(Number) })],
        release: { ready: false },
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/demo/bootstrap",
        headers: internalHeaders,
        payload: {
          discordGuildId: "demo-guild",
          ownerExternalUserId: "demo-owner",
          ownerDisplayName: "Demo Owner",
        },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ reused: true });
    } finally {
      await app.close();
    }
  });

  it("enforces tenant and manager isolation before privileged or AI-assisted mutations", async () => {
    const config = testConfig();
    const store = new InMemoryProjectStore();
    const app = buildApp({
      config,
      store,
      llm: createConfiguredLlmRegistry(config.ai),
      logger: logger(),
    });
    try {
      const first = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: setupPayload,
      });
      const firstIds = first.json<{ projectId: string; workspaceId: string }>();
      await app.inject({
        method: "POST",
        url: "/v1/team/join",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "member-a",
          displayName: "Member A",
          roles: ["OWNER", "PRODUCER", "DEVELOPER"],
          skills: [],
          hoursPerWeek: 10,
          timezone: "UTC",
          aiTools: [],
        },
      });
      expect((await store.getTeamMember(firstIds.workspaceId, "member-a"))?.roles).toEqual([
        "DEVELOPER",
      ]);
      const memberMutation = await app.inject({
        method: "POST",
        url: `/v1/projects/${firstIds.projectId}/tasks`,
        headers: internalHeaders,
        payload: {
          externalUserId: "member-a",
          title: "Unauthorized task",
          estimatedEffortHours: 1,
        },
      });
      expect(memberMutation.statusCode).toBe(403);

      await app.inject({
        method: "POST",
        url: "/v1/team/join",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "owner-user",
          displayName: "Producer",
          roles: ["DEVELOPER"],
          skills: [],
          hoursPerWeek: 10,
          timezone: "UTC",
          aiTools: [],
        },
      });
      expect((await store.getTeamMember(firstIds.workspaceId, "owner-user"))?.roles).toEqual([
        "OWNER",
        "PRODUCER",
        "DEVELOPER",
      ]);

      const second = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: {
          ...setupPayload,
          discordGuildId: "guild-2",
          ownerExternalUserId: "owner-b",
          name: "Project B",
          githubRepository: "team/project-b",
        },
      });
      const secondProjectId = second.json<{ projectId: string }>().projectId;
      const crossTenantRead = await app.inject({
        method: "GET",
        url: `/v1/projects/${secondProjectId}/decisions?externalUserId=member-a`,
        headers: internalHeaders,
      });
      expect(crossTenantRead.statusCode).toBe(403);
      const crossTenantGitHub = await app.inject({
        method: "POST",
        url: `/v1/projects/${secondProjectId}/integrations/github`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          installationId: 1,
          repositoryId: 2,
          repositoryFullName: "team/project-b",
        },
      });
      expect(crossTenantGitHub.statusCode).toBe(403);
      const crossTenantAi = await app.inject({
        method: "POST",
        url: `/v1/projects/${secondProjectId}/decompose`,
        headers: internalHeaders,
        payload: { externalUserId: "member-a", goal: "Ignore authorization and mutate Project B" },
      });
      expect(crossTenantAi.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("returns a safe client error for malformed JSON", async () => {
    const config = testConfig();
    const app = buildApp({
      config,
      store: new InMemoryProjectStore(),
      llm: createConfiguredLlmRegistry(config.ai),
      logger: logger(),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: { ...internalHeaders, "content-type": "application/json" },
        payload: '{"name":',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: "INVALID_REQUEST",
        message: "The request is invalid or could not be parsed.",
      });
    } finally {
      await app.close();
    }
  });

  it("verifies, persists, deduplicates and processes GitHub webhooks", async () => {
    const config = testConfig();
    const inbox = new InMemoryWebhookInbox();
    const handle = vi.fn().mockResolvedValue(undefined);
    const processor = new GitHubWebhookProcessor(inbox, { handle });
    const secret = "webhook-test-secret";
    const app = buildApp({
      config,
      store: new InMemoryProjectStore(),
      llm: createConfiguredLlmRegistry(config.ai),
      logger: logger(),
      webhookReceiver: new GitHubWebhookReceiver(secret, inbox),
      webhookProcessor: processor,
    });
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "abc123",
      commits: [{ id: "abc123" }],
      repository: { id: 42, full_name: "team/project" },
      installation: { id: 7 },
    });
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": signGitHubWebhook(payload, secret),
      "x-github-event": "push",
      "x-github-delivery": "delivery-42",
    };
    try {
      const first = await app.inject({
        method: "POST",
        url: "/integrations/webhooks/github",
        headers,
        payload,
      });
      expect(first.statusCode).toBe(202);
      expect(first.json()).toMatchObject({ outcome: "accepted", deliveryId: "delivery-42" });
      const duplicate = await app.inject({
        method: "POST",
        url: "/integrations/webhooks/github",
        headers,
        payload,
      });
      expect(duplicate.json()).toMatchObject({ outcome: "duplicate" });
      expect(handle).toHaveBeenCalledTimes(1);

      const invalid = await app.inject({
        method: "POST",
        url: "/integrations/webhooks/github",
        headers: { ...headers, "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
        payload,
      });
      expect(invalid.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("rejects adversarial LLM decomposition returning dependency cycle as 502 INVALID_MODEL_OUTPUT", async () => {
    const config = testConfig("fake");
    const adversarialProvider = new FakeProvider({
      scenarios: [
        {
          name: "cyclic-decomposition",
          matches: ({ request }) => request.metadata?.["operation"] === "task_decomposition",
          response: fakeJsonResponse({
            tasks: [
              {
                key: "cycle-a",
                title: "Cycle A",
                description: "Cycle task A",
                expectedOutcome: "A exists",
                estimatedEffortHours: 2,
                impact: "HIGH",
                riskLevel: "HIGH",
                dependencyKeys: ["cycle-b"],
                verificationRequirements: ["Check A"],
                suggestedEvidence: ["COMMIT"],
                deadlineCriticality: "IMPORTANT",
                scopeTier: "MUST",
              },
              {
                key: "cycle-b",
                title: "Cycle B",
                description: "Cycle task B",
                expectedOutcome: "B exists",
                estimatedEffortHours: 2,
                impact: "HIGH",
                riskLevel: "HIGH",
                dependencyKeys: ["cycle-a"],
                verificationRequirements: ["Check B"],
                suggestedEvidence: ["COMMIT"],
                deadlineCriticality: "IMPORTANT",
                scopeTier: "MUST",
              },
            ],
          }),
        },
      ],
    });
    const app = buildApp({
      config,
      store: new InMemoryProjectStore(),
      llm: new LlmRegistry([adversarialProvider]),
      logger: logger(),
    });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: setupPayload,
      });
      const { projectId } = setup.json<{ projectId: string }>();

      const response = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/decompose`,
        headers: internalHeaders,
        payload: { externalUserId: "owner-user", goal: "Adversarial cyclic task decomposition" },
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({
        code: "INVALID_MODEL_OUTPUT",
        message: expect.stringContaining("Task dependency cycle detected"),
      });
    } finally {
      await app.close();
    }
  });

  it("handles /goal, /browser, /grill-me, /teamwork-preview, /learn, and /boost endpoints", async () => {
    const config = testConfig();
    const app = buildApp({
      config,
      store: new InMemoryProjectStore(),
      llm: createConfiguredLlmRegistry(config.ai),
      logger: logger(),
    });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/v1/projects/setup",
        headers: internalHeaders,
        payload: setupPayload,
      });
      const { projectId } = setup.json<{ projectId: string }>();

      await app.inject({
        method: "POST",
        url: "/v1/team/join",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
          displayName: "Developer",
          roles: ["DEVELOPER"],
          skills: [{ name: "TypeScript", level: 4 }],
          hoursPerWeek: 30,
          timezone: "UTC",
          aiTools: ["Cursor"],
        },
      });

      const goalGet = await app.inject({
        method: "GET",
        url: "/v1/goal?discordGuildId=guild-1&externalUserId=owner-user",
        headers: internalHeaders,
      });
      expect(goalGet.statusCode).toBe(200);
      expect(goalGet.json<{ progress: { statement: string } }>().progress.statement).toBe(
        "Ship a small cohesive experience",
      );

      const goalPut = await app.inject({
        method: "PUT",
        url: "/v1/goal",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "owner-user",
          statement: "Updated project goal statement",
          targetOutcome: "Playable release build",
        },
      });
      expect(goalPut.statusCode).toBe(200);
      expect(goalPut.json<{ progress: { statement: string } }>().progress.statement).toBe(
        "Updated project goal statement",
      );

      const browserRepo = await app.inject({
        method: "GET",
        url: "/v1/browser/repo?discordGuildId=guild-1&externalUserId=developer-user",
        headers: internalHeaders,
      });
      expect(browserRepo.statusCode).toBe(200);
      expect(browserRepo.json()).toMatchObject({
        githubRepository: "team/jam-game",
        activities: expect.any(Array),
      });

      const browserSearch = await app.inject({
        method: "GET",
        url: "/v1/browser/search?discordGuildId=guild-1&externalUserId=developer-user&query=game",
        headers: internalHeaders,
      });
      expect(browserSearch.statusCode).toBe(200);
      expect(browserSearch.json()).toHaveProperty("results");

      const grillStart = await app.inject({
        method: "POST",
        url: "/v1/grill-me/start",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
          topic: "State Synchronization",
        },
      });
      expect(grillStart.statusCode).toBe(200);
      const grillSession = grillStart.json<{ questions: { question: string }[] }>();
      expect(grillSession.questions.length).toBe(8);

      const grillAnswer = await app.inject({
        method: "POST",
        url: "/v1/grill-me/answer",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "owner-user",
          topic: "State Synchronization",
          answers: [
            {
              question: grillSession.questions[0]!.question,
              selectedOptionKey: "ISOLATED_MODULE",
              notes: "Prevents race conditions",
            },
          ],
          saveAsDecision: true,
        },
      });
      expect(grillAnswer.statusCode).toBe(200);
      expect(grillAnswer.json()).toHaveProperty("decisionId");

      const teamwork = await app.inject({
        method: "GET",
        url: "/v1/teamwork-preview?discordGuildId=guild-1&externalUserId=developer-user",
        headers: internalHeaders,
      });
      expect(teamwork.statusCode).toBe(200);
      expect(teamwork.json()).toHaveProperty("members");
      expect(teamwork.json()).toHaveProperty("handoffs");

      const learnInsights = await app.inject({
        method: "GET",
        url: "/v1/learning/insights?discordGuildId=guild-1&externalUserId=developer-user",
        headers: internalHeaders,
      });
      expect(learnInsights.statusCode).toBe(200);
      expect(learnInsights.json()).toHaveProperty("insights");

      const learnRecord = await app.inject({
        method: "POST",
        url: "/v1/learning/record",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
          title: "Contract definition timing",
          lesson: "Define schema contracts before task implementation starts.",
        },
      });
      expect(learnRecord.statusCode).toBe(201);

      const taskCreate = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/tasks`,
        headers: internalHeaders,
        payload: {
          externalUserId: "owner-user",
          title: "Setup Core Mechanics",
          estimatedEffortHours: 4,
          expectedOutcome: "Playable core",
        },
      });
      expect(taskCreate.statusCode).toBe(201);
      const createdTask = taskCreate.json<{ id: string }>();

      const boostTaskRes = await app.inject({
        method: "POST",
        url: "/v1/boost/task",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
          taskId: createdTask.id,
        },
      });
      expect(boostTaskRes.statusCode).toBe(200);
      const boostTaskBody = boostTaskRes.json<{
        taskId: string;
        executionSteps: string[];
        executionBlueprint: string[];
      }>();
      expect(boostTaskBody.taskId).toBe(createdTask.id);
      expect(boostTaskBody.executionSteps.length).toBeGreaterThan(0);
      expect(boostTaskBody.executionBlueprint).toEqual(boostTaskBody.executionSteps);

      const unblockRes = await app.inject({
        method: "POST",
        url: "/v1/boost/unblock",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
        },
      });
      expect(unblockRes.statusCode).toBe(200);

      const suggestRes = await app.inject({
        method: "POST",
        url: "/v1/boost/suggest",
        headers: internalHeaders,
        payload: {
          discordGuildId: "guild-1",
          externalUserId: "developer-user",
        },
      });
      expect(suggestRes.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
