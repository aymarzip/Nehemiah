import { describe, expect, it, vi } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import {
  createInteractionHandler,
  DirectorApiError,
  InMemorySetupDraftStore,
  type DiscordDirectorApi,
  type ProjectStatusView,
  type MissionControlView,
  type WhatNowView,
} from "./index.js";

function createMockApi(): DiscordDirectorApi {
  const sampleStatus: ProjectStatusView = {
    projectId: "proj-1",
    name: "Nehemiah Game",
    phase: "EXECUTION",
    remainingTime: "48h",
    deadlineBufferHours: 12,
    health: { implementation: 80, integration: 75, verification: 70, releaseReadiness: 65 },
    risk: { score: 25, severity: "LOW", signals: ["Deadline healthy"] },
    criticalPath: ["Core Engine", "Level 1"],
  };

  const sampleMissionControl: MissionControlView = {
    project: {
      id: "proj-1",
      name: "Nehemiah Game",
      deadline: new Date(Date.now() + 86400000).toISOString(),
      phase: "EXECUTION",
    },
    health: {
      overallScore: 85,
      dimensions: {
        IMPLEMENTATION: { score: 80 },
        VERIFICATION: { score: 70 },
      },
    },
    integrationProgress: 75,
    release: { score: 65, ready: false, blockers: ["Build verification pending"] },
    criticalPath: ["Core Engine", "Level 1"],
    blockers: [
      {
        explanation: "Waiting on assets",
        blocker: { description: "Missing textures", severity: "HIGH" },
      },
    ],
    risks: {
      overallScore: 25,
      severity: "LOW",
      signals: [{ active: true, title: "Asset delivery delay" }],
    },
    nextCheckpointAt: new Date(Date.now() + 3600000).toISOString(),
  };

  const sampleWhatNow: WhatNowView = {
    phase: "EXECUTION",
    recommendation: {
      taskId: "task-1",
      title: "Implement player controller",
      priority: "HIGH",
      expectedResult: "Player moves with WASD",
      reasons: ["Critical path blocker", "Prerequisite for Level 1"],
      avoidForNow: ["Polishing particle effects"],
      confidence: 0.95,
    },
  };

  return {
    setupProject: vi.fn().mockResolvedValue({ projectId: "proj-1" }),
    bootstrapDemo: vi.fn().mockResolvedValue({
      projectId: "proj-demo",
      reused: false,
      walkthrough: ["/project status", "/task mine"],
    }),
    projectStatus: vi.fn().mockResolvedValue(sampleStatus),
    missionControl: vi.fn().mockResolvedValue(sampleMissionControl),
    saveMissionControl: vi.fn().mockResolvedValue(undefined),
    recentDecisions: vi.fn().mockResolvedValue([
      {
        title: "Use SQLite for local store",
        status: "ACCEPTED",
        rationale: "Zero external dependencies",
      },
    ]),
    updatePreferences: vi.fn().mockResolvedValue({ memberId: "mem-1" }),
    currentTasks: vi
      .fn()
      .mockResolvedValue([{ id: "task-1", title: "Write tests", status: "READY", impact: "HIGH" }]),
    updateTask: vi.fn().mockResolvedValue({
      id: "task-1",
      title: "Write tests",
      status: "IN_PROGRESS",
    }),
    whatNow: vi.fn().mockResolvedValue(sampleWhatNow),
    why: vi.fn().mockResolvedValue({
      reasons: ["On critical path", "Unblocks integration"],
    }),
    cutScope: vi.fn().mockResolvedValue({
      candidates: [
        {
          id: "task-2",
          title: "Mini-game",
          expectedTimeSavedHours: 8,
          riskReduction: "MODERATE",
          productImpact: "LOW",
        },
      ],
    }),
    askProducer: vi.fn().mockResolvedValue({
      answer: "We are on track for Sunday deadline.",
      provider: "fake",
    }),
    addBlocker: vi.fn().mockResolvedValue({
      id: "blocker-1",
      description: "Asset missing",
      severity: "CRITICAL",
    }),
    resolveBlocker: vi.fn().mockResolvedValue({
      id: "blocker-1",
      description: "Asset missing",
      severity: "CRITICAL",
      suggestedResolution: "Use placeholder",
    }),
    listBlockers: vi.fn().mockResolvedValue([
      {
        id: "blocker-1",
        description: "Asset missing",
        severity: "CRITICAL",
        suggestedResolution: "Use placeholder",
      },
    ]),
    joinTeam: vi.fn().mockResolvedValue({ memberId: "mem-1" }),
    goalStatus: vi.fn().mockResolvedValue({
      projectId: "proj-1",
      name: "Nehemiah Game",
      progress: {
        goalStatement: "Ship v1.0",
        totalTasks: 10,
        completedTasks: 7,
        percentage: 70,
        mustHaveTasks: 5,
        completedMustHaveTasks: 4,
        mustHavePercentage: 80,
        primaryMilestone: "Alpha",
        targetDate: "2026-08-15T00:00:00Z",
        unalignedTasks: [{ id: "t-99", title: "Side quest", reason: "Not aligned" }],
      },
    }),
    updateGoal: vi.fn().mockResolvedValue({
      projectId: "proj-1",
      name: "Nehemiah Game",
      progress: {
        goalStatement: "Ship v1.0 revised",
        totalTasks: 10,
        completedTasks: 7,
        percentage: 70,
        mustHaveTasks: 5,
        completedMustHaveTasks: 4,
        mustHavePercentage: 80,
        primaryMilestone: "Alpha",
        targetDate: "2026-08-15T00:00:00Z",
        unalignedTasks: [],
      },
    }),
    browserRepo: vi.fn().mockResolvedValue({
      projectId: "proj-1",
      githubRepository: "owner/repo",
      activities: [
        {
          kind: "PUSH",
          externalId: "abc1234",
          branch: "main",
          url: "https://github.com/owner/repo/commit/abc",
          occurredAt: "2026-08-13T00:00:00Z",
        },
      ],
    }),
    browserDoc: vi.fn().mockResolvedValue({
      url: "https://example.com/docs",
      title: "API Reference",
      text: "Summary text for the API reference doc.",
      headings: ["Overview", "Authentication"],
      links: ["https://example.com/login"],
      fetchedAt: "2026-08-13T00:00:00Z",
    }),
    browserSearch: vi.fn().mockResolvedValue({
      query: "database",
      results: [
        {
          sourceKind: "DECISION",
          title: "Use SQLite",
          snippet: "Zero-dependency local database",
          score: 3,
          date: "2026-08-13T00:00:00Z",
        },
      ],
    }),
    grillStart: vi.fn().mockResolvedValue({
      topic: "Caching",
      questions: [
        {
          pillar: "PERFORMANCE",
          question: "What cache eviction strategy?",
          tradeoff: "Higher CPU vs hit rate",
          options: [
            { key: "A", label: "LRU", pros: "Higher hit rate", cons: "Higher CPU" },
            { key: "B", label: "FIFO", pros: "Simpler logic", cons: "Suboptimal hit rate" },
          ],
          recommendedOptionKey: "A",
        },
      ],
    }),
    grillAnswer: vi.fn().mockResolvedValue({
      draft: {
        title: "Cache Strategy: LRU",
        description: "Use LRU",
        outcome: "Adopt LRU",
        context: "High throughput read cache",
        rationale: "Maintains hottest items",
        alternatives: ["FIFO"],
        type: "TECHNICAL",
      },
      decisionId: "dec-123",
    }),
    teamworkPreview: vi.fn().mockResolvedValue({
      totalMembers: 2,
      overloadedMembersCount: 0,
      members: [
        {
          memberId: "m1",
          displayName: "Alice",
          roles: ["DEVELOPER"],
          assignedTasksCount: 3,
          activeTasksCount: 2,
          estimatedHoursRemaining: 20,
          hoursPerWeek: 30,
          workloadRatio: 0.67,
          loadCategory: "BALANCED",
          blockedTasksCount: 0,
          aiTools: ["Cursor"],
        },
      ],
      handoffs: [
        {
          waitingMemberId: "m2",
          waitingMemberName: "Bob",
          blockedTaskId: "t2",
          blockedTaskTitle: "Level 1",
          blockingMemberId: "m1",
          blockingMemberName: "Alice",
          dependencyTaskId: "t1",
          dependencyTaskTitle: "Engine",
        },
      ],
      bottleneckMemberIds: ["m1"],
    }),
    learningInsights: vi.fn().mockResolvedValue({
      completedTasksCount: 10,
      resolvedBlockersCount: 2,
      averageEffortHours: 4.5,
      primaryBlockerSource: "DEPENDENCY",
      insights: [
        {
          category: "VELOCITY",
          title: "Steady progress",
          observation: "Tasks completed on schedule",
          recommendation: "Maintain cadence",
        },
      ],
    }),
    learningRecord: vi.fn().mockResolvedValue({
      id: "lr-1",
      title: "Verify contract schemas",
      lesson: "Run integration tests against mocked endpoints.",
    }),
    boostTask: vi.fn().mockResolvedValue({
      taskId: "t1",
      title: "Engine Setup",
      executionBlueprint: ["Install dependencies", "Configure pipeline"],
      verificationChecklist: ["Run test suite", "Verify output"],
      aiPromptTemplate: "Act as an expert dev to setup the engine...",
    }),
    boostUnblock: vi.fn().mockResolvedValue([
      {
        blockerId: "b1",
        description: "Waiting on assets",
        severity: "HIGH",
        tacticalSteps: ["Use geometric placeholders", "Mock sound channels"],
        estimatedTimeSavedHours: 6,
      },
    ]),
    boostSuggest: vi.fn().mockResolvedValue([
      {
        type: "PARALLEL",
        description: "Tasks t1 and t2 can run concurrently.",
        affectedTaskIds: ["t1", "t2"],
      },
    ]),
  };
}

function mockChatCommand(
  subcommand: string,
  optionsMap: Record<string, unknown> = {},
  guild = true,
) {
  return {
    id: "interaction-1",
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    inGuild: () => guild,
    guildId: guild ? "guild-1" : null,
    commandName: "project",
    options: {
      getSubcommand: () => subcommand,
      getString: (key: string, required?: boolean) => {
        const val = optionsMap[key];
        if (required && val === undefined) throw new Error(`Missing ${key}`);
        return (val as string) ?? null;
      },
      getInteger: (key: string) => (optionsMap[key] as number) ?? null,
    },
    user: { id: "user-1", username: "alice", globalName: "Alice" },
    member: { displayName: "Alice Dev" },
    memberPermissions: {
      has: (perm: bigint) =>
        perm === PermissionFlagsBits.ManageGuild ? Boolean(optionsMap["manageGuild"]) : true,
    },
    appPermissions: {
      has: () => true,
    },
    channel: {
      id: "chan-1",
      isSendable: () => true,
      messages: { fetch: vi.fn().mockRejectedValue(new Error("not found")) },
      send: vi.fn().mockResolvedValue({ id: "msg-1" }),
    },
    deferred: false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(function (this: { deferred: boolean }) {
      this.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Interaction Handler", () => {
  it("rejects interactions executed outside of a guild", async () => {
    const api = createMockApi();
    const setupDrafts = new InMemorySetupDraftStore();
    const handler = createInteractionHandler({ api, setupDrafts });
    const interaction = mockChatCommand("status", {}, false);

    await handler(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "This command can only be used inside a Discord server.",
      }),
    );
  });

  describe("project commands", () => {
    it("handles /project demo when user has ManageGuild permission", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("demo", { manageGuild: true });
      interaction.commandName = "project";

      await handler(interaction as never);

      expect(api.bootstrapDemo).toHaveBeenCalledWith("guild-1", "user-1", "Alice Dev");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("proj-demo"),
        }),
      );
    });

    it("rejects /project demo when user lacks ManageGuild permission", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("demo", { manageGuild: false });
      interaction.commandName = "project";

      await handler(interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "You need Manage Server permission to create the demo project.",
        }),
      );
    });

    it("handles /project setup and opens modal", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("setup", {
        manageGuild: true,
        mode: "GAME_JAM",
        constraints: "no external art, 48h limit",
        github: "org/repo",
      });
      interaction.commandName = "project";

      await handler(interaction as never);

      expect(interaction.showModal).toHaveBeenCalled();
    });

    it("handles /project status", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("status");
      interaction.commandName = "project";

      await handler(interaction as never);

      expect(api.projectStatus).toHaveBeenCalledWith("guild-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
        }),
      );
    });

    it("handles /project mission-control", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("mission-control");
      interaction.commandName = "project";

      await handler(interaction as never);

      expect(api.missionControl).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.channel.send).toHaveBeenCalled();
      expect(api.saveMissionControl).toHaveBeenCalledWith("guild-1", "user-1", "chan-1", "msg-1");
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it("handles /project decisions", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("decisions");
      interaction.commandName = "project";

      await handler(interaction as never);

      expect(api.recentDecisions).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("SQLite"),
        }),
      );
    });
  });

  describe("team commands", () => {
    it("handles /team preferences", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("preferences", {
        detail: "CONCISE",
        notifications: "HOURLY",
        delivery: "DM",
      });
      interaction.commandName = "team";

      await handler(interaction as never);

      expect(api.updatePreferences).toHaveBeenCalledWith("guild-1", "user-1", {
        style: "CONCISE",
        notificationFrequency: "HOURLY",
        deliveryPreference: "DM",
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Communication preferences saved." }),
      );
    });

    it("handles /team join by showing modal", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("join");
      interaction.commandName = "team";

      await handler(interaction as never);

      expect(interaction.showModal).toHaveBeenCalled();
    });
  });

  describe("task commands", () => {
    it("handles /task mine", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("mine");
      interaction.commandName = "task";

      await handler(interaction as never);

      expect(api.currentTasks).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Write tests"),
        }),
      );
    });

    it("handles /task update", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("update", {
        task_id: "task-1",
        status: "IN_PROGRESS",
        evidence: "Started working on unit tests",
      });
      interaction.commandName = "task";

      await handler(interaction as never);

      expect(api.updateTask).toHaveBeenCalledWith(
        "task-1",
        "user-1",
        "IN_PROGRESS",
        "Started working on unit tests",
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("IN_PROGRESS"),
        }),
      );
    });
  });

  describe("producer commands", () => {
    it("handles /producer what-now", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("what-now");
      interaction.commandName = "producer";

      await handler(interaction as never);

      expect(api.whatNow).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /producer why", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("why", { task_id: "task-1" });
      interaction.commandName = "producer";

      await handler(interaction as never);

      expect(api.why).toHaveBeenCalledWith("guild-1", "user-1", "task-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("critical path") }),
      );
    });

    it("handles /producer cut-scope", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("cut-scope");
      interaction.commandName = "producer";

      await handler(interaction as never);

      expect(api.cutScope).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Mini-game") }),
      );
    });

    it("handles /producer ask", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("ask", { question: "What is next?" });
      interaction.commandName = "producer";

      await handler(interaction as never);

      expect(api.askProducer).toHaveBeenCalledWith("guild-1", "user-1", "What is next?");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("We are on track") }),
      );
    });
  });

  describe("blocker commands", () => {
    it("handles /blocker add", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("add", {
        description: "Network timeout",
        severity: "HIGH",
        task_id: "task-1",
        resolution: "Increase timeout",
      });
      interaction.commandName = "blocker";

      await handler(interaction as never);

      expect(api.addBlocker).toHaveBeenCalledWith("guild-1", "user-1", {
        description: "Network timeout",
        severity: "HIGH",
        blockedTaskId: "task-1",
        suggestedResolution: "Increase timeout",
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("blocker-1") }),
      );
    });

    it("handles /blocker resolve", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("resolve", { blocker_id: "blocker-1" });
      interaction.commandName = "blocker";

      await handler(interaction as never);

      expect(api.resolveBlocker).toHaveBeenCalledWith("guild-1", "user-1", "blocker-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Resolved blocker") }),
      );
    });

    it("handles /blocker list", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("list");
      interaction.commandName = "blocker";

      await handler(interaction as never);

      expect(api.listBlockers).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("CRITICAL") }),
      );
    });

    it("handles /blocker list when no blockers exist", async () => {
      const api = createMockApi();
      (api.listBlockers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("list");
      interaction.commandName = "blocker";

      await handler(interaction as never);

      expect(api.listBlockers).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "No open blockers." }),
      );
    });
  });

  describe("goal commands", () => {
    it("handles /goal status", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("status");
      interaction.commandName = "goal";

      await handler(interaction as never);

      expect(api.goalStatus).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /goal set", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("set", {
        statement: "Ship v1.0 on time",
        outcome: "Fully verified release",
        criteria: "all tests pass, zero blockers",
      });
      interaction.commandName = "goal";

      await handler(interaction as never);

      expect(api.updateGoal).toHaveBeenCalledWith("guild-1", "user-1", {
        statement: "Ship v1.0 on time",
        targetOutcome: "Fully verified release",
        successCriteria: ["all tests pass", "zero blockers"],
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });
  });

  describe("browser commands", () => {
    it("handles /browser repo", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("repo");
      interaction.commandName = "browser";

      await handler(interaction as never);

      expect(api.browserRepo).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /browser repo when not connected", async () => {
      const api = createMockApi();
      (api.browserRepo as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        projectId: "proj-1",
        githubRepository: null,
        activities: [],
      });
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("repo");
      interaction.commandName = "browser";

      await handler(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("No GitHub repository") }),
      );
    });

    it("handles /browser doc", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("doc", { url: "https://example.com/docs" });
      interaction.commandName = "browser";

      await handler(interaction as never);

      expect(api.browserDoc).toHaveBeenCalledWith("guild-1", "user-1", "https://example.com/docs");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /browser search", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("search", { query: "database" });
      interaction.commandName = "browser";

      await handler(interaction as never);

      expect(api.browserSearch).toHaveBeenCalledWith("guild-1", "user-1", "database");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });
  });

  describe("grill-me commands", () => {
    it("handles /grill-me start", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("start", { topic: "Caching", task_id: "t1" });
      interaction.commandName = "grill-me";

      await handler(interaction as never);

      expect(api.grillStart).toHaveBeenCalledWith("guild-1", "user-1", "Caching", "t1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /grill-me answer", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("answer", {
        topic: "Caching",
        question: "q1",
        option: "A",
        notes: "LRU fits memory budget",
        task_id: "t1",
      });
      interaction.commandName = "grill-me";

      await handler(interaction as never);

      expect(api.grillAnswer).toHaveBeenCalledWith("guild-1", "user-1", {
        topic: "Caching",
        answers: [{ question: "q1", selectedOptionKey: "A", notes: "LRU fits memory budget" }],
        taskId: "t1",
        saveAsDecision: true,
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });
  });

  describe("teamwork-preview commands", () => {
    it("handles /teamwork-preview overview", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("overview");
      interaction.commandName = "teamwork-preview";

      await handler(interaction as never);

      expect(api.teamworkPreview).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });
  });

  describe("learn commands", () => {
    it("handles /learn insights", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("insights");
      interaction.commandName = "learn";

      await handler(interaction as never);

      expect(api.learningInsights).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /learn record", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("record", {
        title: "Verify contract schemas",
        lesson: "Run integration tests against mocked endpoints.",
        task_id: "t1",
      });
      interaction.commandName = "learn";

      await handler(interaction as never);

      expect(api.learningRecord).toHaveBeenCalledWith("guild-1", "user-1", {
        title: "Verify contract schemas",
        lesson: "Run integration tests against mocked endpoints.",
        taskId: "t1",
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("lr-1") }),
      );
    });
  });

  describe("boost commands", () => {
    it("handles /boost task", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("task", { task_id: "t1" });
      interaction.commandName = "boost";

      await handler(interaction as never);

      expect(api.boostTask).toHaveBeenCalledWith("guild-1", "user-1", "t1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /boost unblock", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("unblock");
      interaction.commandName = "boost";

      await handler(interaction as never);

      expect(api.boostUnblock).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles /boost suggest", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("suggest");
      interaction.commandName = "boost";

      await handler(interaction as never);

      expect(api.boostSuggest).toHaveBeenCalledWith("guild-1", "user-1");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });
  });

  describe("button interactions", () => {
    function mockButton(customId: string) {
      return {
        id: "btn-interaction-1",
        isChatInputCommand: () => false,
        isButton: () => true,
        isModalSubmit: () => false,
        isRepliable: () => true,
        inGuild: () => true,
        guildId: "guild-1",
        customId,
        user: { id: "user-1", username: "alice" },
        member: { displayName: "Alice" },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("handles mc:my-task button", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const btn = mockButton("mc:my-task");

      await handler(btn as never);

      expect(api.whatNow).toHaveBeenCalledWith("guild-1", "user-1");
      expect(btn.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles mc:project button", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const btn = mockButton("mc:project");

      await handler(btn as never);

      expect(api.missionControl).toHaveBeenCalledWith("guild-1", "user-1");
      expect(btn.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) }),
      );
    });

    it("handles mc:risks button", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const btn = mockButton("mc:risks");

      await handler(btn as never);

      expect(api.missionControl).toHaveBeenCalledWith("guild-1", "user-1");
      expect(btn.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Asset delivery delay") }),
      );
    });

    it("handles mc:risks button when no active signals exist", async () => {
      const api = createMockApi();
      const missionControl = await api.missionControl("guild-1", "user-1");
      (api.missionControl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...missionControl,
        risks: { overallScore: 0, severity: "LOW", signals: [] },
      });
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const btn = mockButton("mc:risks");

      await handler(btn as never);

      expect(btn.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "No active deterministic risk signals." }),
      );
    });

    it("handles mc:ask and mc:update buttons", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const askBtn = mockButton("mc:ask");
      await handler(askBtn as never);
      expect(askBtn.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("/producer ask") }),
      );

      const updateBtn = mockButton("mc:update");
      await handler(updateBtn as never);
      expect(updateBtn.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("/task update") }),
      );
    });
  });

  describe("modal submissions", () => {
    it("handles project setup modal submission with active draft", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const draft = await setupDrafts.create({
        guildId: "guild-1",
        userId: "user-1",
        mode: "GAME_JAM",
        constraints: ["48h"],
        githubRepository: "org/game",
      });

      const handler = createInteractionHandler({ api, setupDrafts });
      const modal = {
        id: "modal-1",
        isChatInputCommand: () => false,
        isButton: () => false,
        isModalSubmit: () => true,
        isRepliable: () => true,
        inGuild: () => true,
        guildId: "guild-1",
        customId: `project-setup:${draft.id}`,
        user: { id: "user-1", username: "alice", globalName: "Alice" },
        member: { displayName: "Alice" },
        fields: {
          getTextInputValue: (field: string) => {
            const map: Record<string, string> = {
              name: "Game Jam Project",
              description: "Fast-paced platformer",
              vision: "Publish to itch.io",
              deadline: "2026-08-15T18:00:00Z",
              timezone: "UTC",
            };
            return map[field] ?? "";
          },
        },
        deferReply: vi.fn().mockImplementation(function (this: { deferred: boolean }) {
          this.deferred = true;
          return Promise.resolve();
        }),
        editReply: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      };

      await handler(modal as never);

      expect(api.setupProject).toHaveBeenCalledWith({
        discordGuildId: "guild-1",
        ownerExternalUserId: "user-1",
        ownerDisplayName: "Alice",
        name: "Game Jam Project",
        description: "Fast-paced platformer",
        vision: "Publish to itch.io",
        deadline: "2026-08-15T18:00:00Z",
        timezone: "UTC",
        mode: "GAME_JAM",
        constraints: ["48h"],
        githubRepository: "org/game",
      });
      expect(modal.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("proj-1") }),
      );
    });

    it("handles expired project setup modal submission", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const modal = {
        id: "modal-1",
        isChatInputCommand: () => false,
        isButton: () => false,
        isModalSubmit: () => true,
        isRepliable: () => true,
        inGuild: () => true,
        guildId: "guild-1",
        customId: "project-setup:expired-id",
        user: { id: "user-1", username: "alice" },
        reply: vi.fn().mockResolvedValue(undefined),
      };

      await handler(modal as never);

      expect(modal.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("expired") }),
      );
    });

    it("handles team join modal submission", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const modal = {
        id: "modal-2",
        isChatInputCommand: () => false,
        isButton: () => false,
        isModalSubmit: () => true,
        isRepliable: () => true,
        inGuild: () => true,
        guildId: "guild-1",
        customId: "team-join",
        user: { id: "user-1", username: "alice", globalName: "Alice" },
        member: { displayName: "Alice" },
        fields: {
          getTextInputValue: (field: string) => {
            const map: Record<string, string> = {
              roles: "DEVELOPER, QA",
              skills: "TypeScript:4, Godot:3",
              hours: "25",
              timezone: "UTC",
              ai_tools: "Cursor, Claude",
            };
            return map[field] ?? "";
          },
        },
        deferReply: vi.fn().mockImplementation(function (this: { deferred: boolean }) {
          this.deferred = true;
          return Promise.resolve();
        }),
        editReply: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      };

      await handler(modal as never);

      expect(api.joinTeam).toHaveBeenCalledWith({
        discordGuildId: "guild-1",
        externalUserId: "user-1",
        displayName: "Alice",
        roles: ["DEVELOPER", "QA"],
        skills: [
          { name: "TypeScript", level: 4 },
          { name: "Godot", level: 3 },
        ],
        hoursPerWeek: 25,
        timezone: "UTC",
        aiTools: ["Cursor", "Claude"],
      });
      expect(modal.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("mem-1") }),
      );
    });

    it("rejects team join modal with invalid hours", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const modal = {
        id: "modal-invalid-hours",
        isChatInputCommand: () => false,
        isButton: () => false,
        isModalSubmit: () => true,
        isRepliable: () => true,
        inGuild: () => true,
        guildId: "guild-1",
        customId: "team-join",
        user: { id: "user-1", username: "alice", globalName: "Alice" },
        member: { displayName: "Alice" },
        fields: {
          getTextInputValue: (field: string) => (field === "hours" ? "200" : "test"),
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      };

      await handler(modal as never);

      expect(modal.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Available hours must be between 0 and 168.",
        }),
      );
    });

    it("rejects team join modal with empty or whitespace hours", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const modal = {
        id: "modal-empty-hours",
        isChatInputCommand: () => false,
        isButton: () => false,
        isModalSubmit: () => true,
        isRepliable: () => true,
        inGuild: () => true,
        guildId: "guild-1",
        customId: "team-join",
        user: { id: "user-1", username: "alice", globalName: "Alice" },
        member: { displayName: "Alice" },
        fields: {
          getTextInputValue: (field: string) => (field === "hours" ? "   " : "test"),
        },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      };

      await handler(modal as never);

      expect(modal.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Available hours must be between 0 and 168.",
        }),
      );
    });
  });

  describe("error handling", () => {
    it("handles DirectorApiError with PROVIDER_NOT_CONFIGURED gracefully", async () => {
      const api = createMockApi();
      (api.askProducer as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DirectorApiError(503, "No provider", "PROVIDER_NOT_CONFIGURED"),
      );
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("ask", { question: "What now?" });
      interaction.commandName = "producer";

      await handler(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content:
            "No AI provider is configured. Deterministic project tracking remains available.",
        }),
      );
    });

    it("handles generic unexpected errors", async () => {
      const api = createMockApi();
      (api.projectStatus as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Database connection dropped"),
      );
      const setupDrafts = new InMemorySetupDraftStore();
      const logger = { error: vi.fn() };
      const handler = createInteractionHandler({ api, setupDrafts, logger });
      const interaction = mockChatCommand("status");
      interaction.commandName = "project";

      await handler(interaction as never);

      expect(logger.error).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Something went wrong while processing that request. Please try again.",
        }),
      );
    });

    it("uses followUp if interaction was already replied", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = {
        isChatInputCommand: () => {
          throw new Error("Late error");
        },
        isRepliable: () => true,
        replied: true,
        deferred: false,
        followUp: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
      };

      await handler(interaction as never);

      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Something went wrong while processing that request. Please try again.",
        }),
      );
    });

    it("safely ignores unknown chat command name", async () => {
      const api = createMockApi();
      const setupDrafts = new InMemorySetupDraftStore();
      const handler = createInteractionHandler({ api, setupDrafts });
      const interaction = mockChatCommand("unknown");
      interaction.commandName = "nonexistent";

      await handler(interaction as never);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });
});
