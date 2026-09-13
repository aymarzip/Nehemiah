import { randomUUID } from "node:crypto";
import {
  AICapacityDimensions,
  AIToolProfile,
  AssignmentEngine,
  Availability,
  Blocker,
  BlockerEngine,
  CommunicationPreferences,
  Project,
  ProjectDirector,
  CycleDetectedError,
  DomainValidationError,
  GitHubIntelligenceService,
  ProjectVision,
  RecommendationEngine,
  ReleaseReadinessService,
  Role,
  ScopeEngine,
  Skill,
  SmartCheckpointService,
  Task,
  TaskDecompositionValidator,
  TaskDependency,
  TaskGraph,
  TeamMember,
  type ProposedTask,
  type TaskEvidenceKind,
} from "@nehemiah/core";
import type {
  BlockerRecord,
  DecisionRecord,
  ProjectRecord,
  ProjectStore,
  ProjectVisionDetailsRecord,
  TaskRecord,
  TeamMemberRecord,
  VisionRevisionRecord,
} from "@nehemiah/database";
import { isLlmError, message, type JsonSchema, type LlmRegistry } from "@nehemiah/llm";
import { DirectorServiceError } from "./director-service.js";

const evidenceKinds = [
  "COMMIT",
  "PULL_REQUEST",
  "REVIEW",
  "CHECK_RUN",
  "TEST_RESULT",
  "BUILD",
  "ARTIFACT",
  "DEPLOYMENT",
  "MANUAL_VERIFICATION",
  "NOTE",
] as const;

const decompositionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "key",
          "title",
          "description",
          "expectedOutcome",
          "estimatedEffortHours",
          "impact",
          "riskLevel",
          "dependencyKeys",
          "verificationRequirements",
          "suggestedEvidence",
          "deadlineCriticality",
          "scopeTier",
        ],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 80 },
          title: { type: "string", minLength: 1, maxLength: 300 },
          description: { type: "string", maxLength: 4_000 },
          expectedOutcome: { type: "string", minLength: 1, maxLength: 2_000 },
          ownerRole: { type: "string", minLength: 1, maxLength: 100 },
          estimatedEffortHours: { type: "number", minimum: 0, maximum: 10_000 },
          impact: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          dependencyKeys: {
            type: "array",
            maxItems: 40,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
          verificationRequirements: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 500 },
          },
          suggestedEvidence: {
            type: "array",
            maxItems: 10,
            items: { type: "string", enum: [...evidenceKinds] },
          },
          component: { type: "string", minLength: 1, maxLength: 200 },
          deadlineCriticality: {
            type: "string",
            enum: ["OPTIONAL", "IMPORTANT", "CRITICAL"],
          },
          scopeTier: { type: "string", enum: ["MUST", "SHOULD", "NICE"] },
        },
      },
    },
  },
};

interface DecompositionValue {
  readonly tasks: readonly ProposedTask[];
}

export interface VisionRevisionInput extends ProjectVisionDetailsRecord {
  readonly statement: string;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly string[];
}

export interface DecisionInput {
  readonly type: DecisionRecord["type"];
  readonly title: string;
  readonly description: string;
  readonly context: string;
  readonly rationale: string;
  readonly outcome: string;
  readonly alternatives?: readonly string[] | undefined;
  readonly affectedTaskIds?: readonly string[] | undefined;
  readonly affectedComponents?: readonly string[] | undefined;
  readonly status?: "PROPOSED" | "ACCEPTED" | undefined;
  readonly supersedesDecisionId?: string | undefined;
}

export interface BlockerInput {
  readonly description: string;
  readonly source: BlockerRecord["source"];
  readonly severity: BlockerRecord["severity"];
  readonly blockedTaskId?: string | undefined;
  readonly blockingTaskId?: string | undefined;
  readonly blockedMemberId?: string | undefined;
  readonly suggestedResolution?: string | undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coreProject(record: ProjectRecord): Project {
  return new Project({
    id: record.id,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description,
    vision: new ProjectVision({
      statement: record.vision,
      ...record.visionDetails,
      constraints: record.constraints,
      successCriteria: record.successCriteria,
      nonGoals: record.nonGoals,
    }),
    deadline: record.deadline,
    timezone: record.timezone,
    mode: record.mode,
    status: record.status,
    constraints: record.constraints,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function coreTask(record: TaskRecord): Task {
  const suggestedEvidence = record.suggestedEvidence?.filter((kind): kind is TaskEvidenceKind =>
    evidenceKinds.some((candidate) => candidate === kind),
  );
  return new Task({
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    description: record.description,
    expectedOutcome: record.expectedOutcome,
    ownerRole: record.ownerRole,
    riskLevel: record.riskLevel,
    verificationRequirements: record.verificationRequirements,
    suggestedEvidence,
    component: record.component,
    deadlineCriticality: record.deadlineCriticality,
    scopeTier: record.scopeTier,
    status: record.status,
    impact: record.impact,
    weight: record.weight,
    estimatedEffortHours: record.estimatedEffortHours,
    ownerId: record.ownerMemberId,
    milestoneId: record.milestoneId,
    dueAt: record.dueAt,
    releaseRequired: record.releaseRequired,
    blockReason:
      record.status === "BLOCKED" ? text(record.metadata?.["blockReason"], "Blocked") : undefined,
    tags: stringArray(record.metadata?.["tags"]),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function coreDependencies(records: readonly TaskRecord[]): readonly TaskDependency[] {
  return records.flatMap((record) =>
    record.dependencyIds.map(
      (dependencyTaskId) =>
        new TaskDependency({
          projectId: record.projectId,
          dependencyTaskId,
          dependantTaskId: record.id,
          requiredStatus: "VERIFIED",
        }),
    ),
  );
}

function coreBlocker(record: BlockerRecord): Blocker {
  return new Blocker({
    id: record.id,
    projectId: record.projectId,
    description: record.description,
    source: record.source,
    severity: record.severity,
    blockedTaskId: record.blockedTaskId,
    blockingTaskId: record.blockingTaskId,
    blockedMemberId: record.blockedMemberId,
    suggestedResolution: record.suggestedResolution,
    createdAt: record.createdAt,
    resolvedAt: record.resolvedAt,
    resolvedBy: record.resolvedBy,
  });
}

function coreMember(record: TeamMemberRecord, projectId: string): TeamMember {
  const availability = record.availability;
  const communication = record.communicationPreferences;
  return new TeamMember({
    id: record.id,
    workspaceId: record.workspaceId,
    projectIds: [projectId],
    displayName: record.displayName,
    externalIdentity: { source: "discord", externalId: record.externalUserId },
    roles: record.roles.map((role) => new Role({ id: role, name: role })),
    skills: record.skills.map(
      (skill) => new Skill({ name: skill.name, level: skill.level as 1 | 2 | 3 | 4 | 5 }),
    ),
    availability: new Availability({
      timezone: text(availability["timezone"], "UTC"),
      weeklyHours: numberValue(availability["hoursPerWeek"], 0),
    }),
    communicationPreferences: new CommunicationPreferences({
      style: communication["style"] as
        | "CONCISE"
        | "DETAILED"
        | "VISUAL"
        | "CONVERSATIONAL"
        | undefined,
      allowDirectMessages: communication["allowDirectMessages"] as boolean | undefined,
      preferredLanguage: text(communication["preferredLanguage"], "en"),
      notificationFrequency: communication["notificationFrequency"] as
        | "IMMEDIATE"
        | "BATCHED"
        | "CHECKPOINT_ONLY"
        | undefined,
      deliveryPreference: communication["deliveryPreference"] as
        | "DM"
        | "CHANNEL"
        | "EITHER"
        | undefined,
      feedbackStyle: communication["feedbackStyle"] as
        | "DIRECT"
        | "SUPPORTIVE"
        | "NEUTRAL"
        | undefined,
      taskPresentation: communication["taskPresentation"] as
        | "ONE_AT_A_TIME"
        | "SHORTLIST"
        | "FULL_QUEUE"
        | undefined,
    }),
    aiToolProfile: new AIToolProfile({
      tools: record.aiToolProfiles.map((profile) => ({
        name: text(profile["tool"], "unknown"),
        capabilities: stringArray(profile["capabilities"]),
      })),
    }),
  });
}

function manager(member: TeamMemberRecord): boolean {
  return member.roles.some((role) =>
    ["OWNER", "PROJECT_OWNER", "PRODUCER"].includes(role.toUpperCase()),
  );
}

export interface Phase2ServiceOptions {
  readonly decompositionMaxOutputTokens?: number;
  readonly temperature?: number;
}

export class Phase2ApplicationService {
  readonly #store: ProjectStore;
  readonly #llm: LlmRegistry;
  readonly #director = new ProjectDirector();
  readonly #assignment = new AssignmentEngine();
  readonly #recommendation = new RecommendationEngine();
  readonly #scope = new ScopeEngine();
  readonly #release = new ReleaseReadinessService();
  readonly #blockers = new BlockerEngine();
  readonly #decomposition = new TaskDecompositionValidator();
  readonly #github = new GitHubIntelligenceService();
  readonly #checkpoints = new SmartCheckpointService();
  readonly #onLlm?: ((metadata: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly #options: Phase2ServiceOptions;

  constructor(
    store: ProjectStore,
    llm: LlmRegistry,
    onLlm?: (metadata: Readonly<Record<string, unknown>>) => void,
    options?: Phase2ServiceOptions,
  ) {
    this.#store = store;
    this.#llm = llm;
    this.#onLlm = onLlm;
    this.#options = options ?? {};
  }

  async updatePreferences(
    discordGuildId: string,
    externalUserId: string,
    preferences: Readonly<Record<string, unknown>>,
    now = new Date(),
  ) {
    const { project } = await this.#authorizeGuild(discordGuildId, externalUserId);
    return this.#store.updateCommunicationPreferences(
      project.workspaceId,
      externalUserId,
      preferences,
      now,
    );
  }

  async bootstrapDemo(
    discordGuildId: string,
    ownerExternalUserId: string,
    ownerDisplayName: string,
    now = new Date(),
  ) {
    const existing = await this.#store.getProjectByGuild(discordGuildId);
    if (existing !== undefined) {
      return {
        projectId: existing.id,
        reused: true,
        walkthrough: [
          "/project mission-control",
          "/producer what-now",
          "/blocker list",
          "/project decisions",
        ],
      };
    }
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const ownerMemberId = randomUUID();
    const project = await this.#store.setupProject({
      workspaceId,
      projectId,
      ownerMemberId,
      workspaceName: "Nehemiah demo team",
      discordGuildId,
      ownerExternalUserId,
      ownerDisplayName,
      name: "Clockwork Garden Demo",
      description:
        "A deterministic game-jam scenario demonstrating planning through release readiness.",
      vision: "Ship a small, cohesive gardening loop with a verified downloadable build.",
      visionDetails: {
        problem: "A jam team needs to integrate a playable loop before time expires.",
        targetOutcome: "A reviewed, playable and packaged build.",
        coreExperience: "Plant, grow and harvest one clockwork crop.",
        mustHaveScope: ["Core loop", "Save contract", "Playable build", "Packaging"],
        shouldHaveScope: ["Sound feedback"],
        niceToHaveScope: ["Extra plant animation"],
        excludedScope: ["Multiplayer", "Procedural environments"],
      },
      successCriteria: [
        "One complete run is playable",
        "Integration checks pass",
        "A downloadable artifact exists",
      ],
      nonGoals: ["Multiplayer", "Live service"],
      deadline: new Date(now.getTime() + 48 * 3_600_000),
      timezone: "UTC",
      mode: "GAME_JAM",
      githubRepository: "demo/clockwork-garden",
      constraints: ["48-hour deadline", "No new systems after scope lock"],
      createdAt: now,
    });
    const developer = await this.#store.joinTeam({
      id: randomUUID(),
      workspaceId,
      externalUserId: `${ownerExternalUserId}:developer-demo`,
      displayName: "Demo Developer",
      roles: ["DEVELOPER"],
      skills: [
        { name: "TypeScript", level: 4 },
        { name: "Gameplay", level: 4 },
      ],
      availability: { hoursPerWeek: 35, timezone: "UTC" },
      communicationPreferences: { style: "CONCISE", notificationFrequency: "BATCHED" },
      aiToolProfiles: [{ tool: "Codex", capabilities: ["implementation", "tests"] }],
      now,
    });
    const integrator = await this.#store.joinTeam({
      id: randomUUID(),
      workspaceId,
      externalUserId: `${ownerExternalUserId}:integrator-demo`,
      displayName: "Demo Integrator",
      roles: ["QA", "RELEASE"],
      skills: [
        { name: "Integration", level: 4 },
        { name: "Release", level: 3 },
      ],
      availability: { hoursPerWeek: 20, timezone: "UTC" },
      communicationPreferences: { style: "DETAILED", notificationFrequency: "IMMEDIATE" },
      aiToolProfiles: [],
      now,
    });
    const ids = {
      contract: randomUUID(),
      serialization: randomUUID(),
      crafting: randomUUID(),
      integration: randomUUID(),
      package: randomUUID(),
      animation: randomUUID(),
    };
    const milestoneIds = { playable: randomUUID(), release: randomUUID() };
    await this.#store.createMilestone({
      id: milestoneIds.playable,
      projectId,
      name: "Playable loop",
      description: "The complete gardening loop is integrated.",
      dueAt: new Date(now.getTime() + 30 * 3_600_000),
      status: "ACTIVE",
      completionCriteria: ["End-to-end playthrough passes"],
      createdAt: now,
    });
    await this.#store.createMilestone({
      id: milestoneIds.release,
      projectId,
      name: "Submission ready",
      description: "The build is packaged, checked and backed up.",
      dueAt: new Date(now.getTime() + 46 * 3_600_000),
      status: "PLANNED",
      completionCriteria: ["Downloadable artifact", "Backup checksum"],
      createdAt: now,
    });
    const tasks = await this.#store.createTaskPlan({
      projectId,
      tasks: [
        {
          id: ids.contract,
          projectId,
          milestoneId: milestoneIds.playable,
          ownerMemberId,
          title: "Approve inventory save contract",
          description: "Define the shared serialization API.",
          expectedOutcome: "Reviewed schema and compatibility rules.",
          ownerRole: "PRODUCER",
          riskLevel: "HIGH",
          verificationRequirements: ["Contract reviewed"],
          suggestedEvidence: ["REVIEW"],
          component: "shared-contract",
          deadlineCriticality: "CRITICAL",
          scopeTier: "MUST",
          status: "VERIFIED",
          impact: "CRITICAL",
          weight: 3,
          estimatedEffortHours: 2,
          now,
        },
        {
          id: ids.serialization,
          projectId,
          milestoneId: milestoneIds.playable,
          ownerMemberId,
          title: "Finish inventory serialization",
          description: "Implement the approved save contract.",
          expectedOutcome: "Inventory round-trips in integration tests.",
          ownerRole: "DEVELOPER",
          riskLevel: "HIGH",
          verificationRequirements: ["Round-trip test passes"],
          suggestedEvidence: ["PULL_REQUEST", "TEST_RESULT"],
          component: "inventory",
          deadlineCriticality: "CRITICAL",
          scopeTier: "MUST",
          status: "IN_PROGRESS",
          impact: "CRITICAL",
          weight: 3,
          estimatedEffortHours: 6,
          now,
        },
        {
          id: ids.crafting,
          projectId,
          milestoneId: milestoneIds.playable,
          ownerMemberId: developer.id,
          title: "Connect crafting to inventory",
          description: "Consume the serialization contract in crafting.",
          expectedOutcome: "Crafted items persist after reload.",
          ownerRole: "DEVELOPER",
          riskLevel: "HIGH",
          verificationRequirements: ["Cross-component integration test"],
          suggestedEvidence: ["CHECK_RUN"],
          component: "crafting",
          deadlineCriticality: "CRITICAL",
          scopeTier: "MUST",
          status: "PLANNED",
          impact: "HIGH",
          weight: 2,
          estimatedEffortHours: 5,
          now,
        },
        {
          id: ids.integration,
          projectId,
          milestoneId: milestoneIds.playable,
          ownerMemberId: integrator.id,
          title: "Produce playable integrated build",
          description: "Verify the full gardening loop.",
          expectedOutcome: "A reviewed playable build exists.",
          ownerRole: "QA",
          riskLevel: "CRITICAL",
          verificationRequirements: ["End-to-end check passes", "Human playthrough"],
          suggestedEvidence: ["BUILD", "MANUAL_VERIFICATION"],
          component: "integration",
          deadlineCriticality: "CRITICAL",
          scopeTier: "MUST",
          status: "PLANNED",
          impact: "CRITICAL",
          weight: 3,
          estimatedEffortHours: 4,
          metadata: { tags: ["build", "qa", "ship"] },
          now,
        },
        {
          id: ids.package,
          projectId,
          milestoneId: milestoneIds.release,
          ownerMemberId: integrator.id,
          title: "Package and back up submission",
          description: "Create the release archive, screenshots and backup.",
          expectedOutcome: "Submission package is downloadable and backed up.",
          ownerRole: "RELEASE",
          riskLevel: "HIGH",
          verificationRequirements: ["Artifact downloads", "Backup checksum recorded"],
          suggestedEvidence: ["ARTIFACT"],
          component: "release",
          deadlineCriticality: "CRITICAL",
          scopeTier: "MUST",
          status: "PLANNED",
          impact: "CRITICAL",
          weight: 3,
          estimatedEffortHours: 3,
          metadata: { tags: ["package", "submission", "backup"] },
          now,
        },
        {
          id: ids.animation,
          projectId,
          title: "Add optional plant animation",
          description: "Polish an optional plant state transition.",
          expectedOutcome: "One extra animation plays.",
          ownerRole: "ART",
          riskLevel: "LOW",
          verificationRequirements: [],
          suggestedEvidence: ["MANUAL_VERIFICATION"],
          component: "visuals",
          deadlineCriticality: "OPTIONAL",
          scopeTier: "NICE",
          releaseRequired: false,
          status: "PLANNED",
          impact: "LOW",
          weight: 1,
          estimatedEffortHours: 4,
          metadata: { tags: ["optional", "polish"] },
          now,
        },
      ],
      dependencies: [
        { taskId: ids.serialization, dependsOnTaskId: ids.contract },
        { taskId: ids.crafting, dependsOnTaskId: ids.serialization },
        { taskId: ids.integration, dependsOnTaskId: ids.crafting },
        { taskId: ids.package, dependsOnTaskId: ids.integration },
      ],
    });
    await this.#store.addTaskEvidence({
      id: randomUUID(),
      taskId: ids.contract,
      kind: "REVIEW",
      summary: "Producer approved the compatibility contract.",
      verified: true,
      submittedBy: ownerMemberId,
      createdAt: now,
    });
    await this.#store.addBlocker({
      id: randomUUID(),
      projectId,
      description: "Crafting is blocked until serialization passes its round-trip test.",
      source: "TASK",
      severity: "CRITICAL",
      blockedTaskId: ids.crafting,
      blockingTaskId: ids.serialization,
      suggestedResolution: "Finish serialization and attach the passing integration test.",
      createdBy: ownerMemberId,
      createdAt: now,
    });
    await this.#store.addDecision({
      id: randomUUID(),
      projectId,
      type: "SCOPE_CHANGE",
      title: "Cut multiplayer",
      description: "Remove multiplayer from the jam build.",
      context: "Integration capacity is limited.",
      rationale: "Protect the core playable loop and release buffer.",
      outcome: "Multiplayer is explicitly excluded.",
      alternatives: ["Cut audio instead"],
      affectedTaskIds: [],
      affectedComponents: ["networking"],
      status: "ACCEPTED",
      authorMemberId: ownerMemberId,
      approvedByMemberId: ownerMemberId,
      createdAt: now,
      approvedAt: now,
    });
    await this.#store.addMemoryEntry({
      id: randomUUID(),
      projectId,
      category: "ARCHITECTURE",
      title: "Save contract ownership",
      content: "The inventory component owns the serialization contract; crafting consumes it.",
      confidence: 1,
      createdAt: now,
    });
    await this.#store.addGitHubActivity({
      id: randomUUID(),
      projectId,
      taskId: ids.serialization,
      kind: "PULL_REQUEST",
      externalId: "41",
      url: "https://github.com/demo/clockwork-garden/pull/41",
      branch: `task/${ids.serialization}`,
      changedFiles: ["src/shared/inventory-schema.ts", "src/inventory/serializer.ts"],
      metadata: {
        title: "Inventory serialization",
        action: "opened",
        merged: false,
        openedAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
        checksPassing: false,
        trust: "untrusted_external",
      },
      occurredAt: new Date(now.getTime() - 5 * 3_600_000),
    });
    await this.#store.addRiskSnapshot({
      id: randomUUID(),
      projectId,
      score: 38,
      severity: "MODERATE",
      signals: [{ code: "NO_INTEGRATED_BUILD_TOO_LONG", contribution: 7 }],
      changes: [],
      capturedAt: new Date(now.getTime() - 3_600_000),
    });
    await this.#store.addRiskSnapshot({
      id: randomUUID(),
      projectId,
      score: 61,
      severity: "HIGH",
      signals: [
        { code: "BLOCKED_CRITICAL_TASK", contribution: 16 },
        { code: "SHRINKING_DEADLINE_BUFFER", contribution: 12 },
      ],
      changes: [{ signal: "BLOCKED_CRITICAL_TASK", delta: 16, evidence: "Crafting is blocked" }],
      capturedAt: now,
    });
    await this.#store.saveProjectSettings({
      projectId,
      checkpointCadenceHours: 2,
      notificationPolicy: "IMMEDIATE_CRITICAL",
      baselineTaskIds: tasks.map((task) => task.id),
    });
    return {
      projectId: project.id,
      reused: false,
      demoMembers: {
        owner: ownerExternalUserId,
        developer: `${ownerExternalUserId}:developer-demo`,
        integrator: `${ownerExternalUserId}:integrator-demo`,
      },
      walkthrough: [
        "/project mission-control",
        "/producer what-now",
        "/blocker list",
        "/producer cut-scope",
        "/project decisions",
      ],
    };
  }

  async proposeVision(
    projectId: string,
    externalUserId: string,
    input: VisionRevisionInput,
    now = new Date(),
  ) {
    const { member } = await this.#authorizeProject(projectId, externalUserId, true);
    const revision: VisionRevisionRecord = {
      id: randomUUID(),
      projectId,
      ...input,
      status: "PROPOSED",
      proposedBy: member.id,
      createdAt: now,
    };
    await this.#store.addVisionRevision(revision);
    return revision;
  }

  async listVision(projectId: string, externalUserId: string) {
    await this.#authorizeProject(projectId, externalUserId);
    return this.#store.listVisionRevisions(projectId);
  }

  async createMilestone(
    projectId: string,
    externalUserId: string,
    input: {
      readonly name: string;
      readonly description: string;
      readonly dueAt: Date;
      readonly completionCriteria: readonly string[];
    },
    now = new Date(),
  ) {
    const { project } = await this.#authorizeProject(projectId, externalUserId, true);
    if (input.dueAt <= now || input.dueAt > project.deadline)
      throw new DirectorServiceError(
        400,
        "INVALID_MILESTONE",
        "Milestone must be in the future and no later than the project deadline.",
      );
    const milestone = {
      id: randomUUID(),
      projectId,
      name: input.name,
      description: input.description,
      dueAt: input.dueAt,
      status: "PLANNED" as const,
      completionCriteria: input.completionCriteria,
      createdAt: now,
    };
    await this.#store.createMilestone(milestone);
    return milestone;
  }

  async listMilestones(projectId: string, externalUserId: string) {
    await this.#authorizeProject(projectId, externalUserId);
    const [milestones, tasks] = await Promise.all([
      this.#store.listMilestones(projectId),
      this.#store.listTasks(projectId),
    ]);
    return milestones.map((milestone) => {
      const included = tasks.filter(
        (task) => task.milestoneId === milestone.id && task.status !== "CANCELLED",
      );
      const completed = included.filter((task) =>
        ["INTEGRATED", "SHIPPED"].includes(task.status),
      ).length;
      return {
        ...milestone,
        taskCount: included.length,
        integratedTaskCount: completed,
        progress: included.length === 0 ? 0 : Math.round((completed / included.length) * 100),
      };
    });
  }

  async approveVision(
    projectId: string,
    revisionId: string,
    externalUserId: string,
    reason: string,
    now = new Date(),
  ) {
    const { member } = await this.#authorizeProject(projectId, externalUserId, true);
    if (
      !(await this.#store.listVisionRevisions(projectId)).some(
        (revision) => revision.id === revisionId,
      )
    ) {
      throw new DirectorServiceError(
        404,
        "VISION_REVISION_NOT_FOUND",
        "Vision revision was not found in this project.",
      );
    }
    const decision: DecisionRecord = {
      id: randomUUID(),
      projectId,
      type: "SCOPE_CHANGE",
      title: "Approve project vision revision",
      description: `Approved vision revision ${revisionId}.`,
      context: "A proposed vision or scope change required explicit approval.",
      rationale: reason,
      outcome: "The approved revision becomes the active project vision.",
      alternatives: ["Keep the previous approved vision"],
      affectedTaskIds: [],
      affectedComponents: [],
      status: "ACCEPTED",
      authorMemberId: member.id,
      approvedByMemberId: member.id,
      createdAt: now,
      approvedAt: now,
    };
    return this.#store.approveVisionRevision(revisionId, member.id, decision, now);
  }

  async recordDecision(
    projectId: string,
    externalUserId: string,
    input: DecisionInput,
    now = new Date(),
  ) {
    const { member } = await this.#authorizeProject(
      projectId,
      externalUserId,
      input.status === "ACCEPTED",
    );
    for (const taskId of input.affectedTaskIds ?? []) {
      if ((await this.#store.getTask(taskId))?.projectId !== projectId)
        throw new DirectorServiceError(
          409,
          "PROJECT_MISMATCH",
          "Affected decisions must reference tasks in the same project.",
        );
    }
    const decision: DecisionRecord = {
      id: randomUUID(),
      projectId,
      type: input.type,
      title: input.title,
      description: input.description,
      context: input.context,
      rationale: input.rationale,
      outcome: input.outcome,
      alternatives: input.alternatives ?? [],
      affectedTaskIds: input.affectedTaskIds ?? [],
      affectedComponents: input.affectedComponents ?? [],
      status: input.status ?? "PROPOSED",
      ...(input.supersedesDecisionId === undefined
        ? {}
        : { supersedesDecisionId: input.supersedesDecisionId }),
      authorMemberId: member.id,
      ...(input.status === "ACCEPTED" ? { approvedByMemberId: member.id, approvedAt: now } : {}),
      createdAt: now,
    };
    await this.#store.addDecision(decision);
    return decision;
  }

  async listDecisions(projectId: string, externalUserId: string, limit = 20) {
    await this.#authorizeProject(projectId, externalUserId);
    return this.#store.listDecisions(projectId, limit);
  }

  async approveDecision(
    projectId: string,
    decisionId: string,
    externalUserId: string,
    now = new Date(),
  ) {
    const { member } = await this.#authorizeProject(projectId, externalUserId, true);
    const decision = await this.#store.getDecision(projectId, decisionId);
    if (decision === undefined) {
      throw new DirectorServiceError(
        404,
        "DECISION_NOT_FOUND",
        "Decision was not found in this project.",
      );
    }
    return this.#store.approveDecision(decisionId, member.id, now);
  }

  async decompose(projectId: string, externalUserId: string, goal: string, now = new Date()) {
    const { project } = await this.#authorizeProject(projectId, externalUserId, true);
    try {
      const generated = await this.#llm.generateStructured<DecompositionValue>({
        schema: decompositionSchema,
        schemaName: "nehemiah_task_decomposition",
        strict: true,
        metadata: { operation: "task_decomposition" },
        messages: [
          message(
            "system",
            [
              "You are Nehemiah's provider-neutral task decomposition adapter.",
              "Return only the requested schema. Propose changes; deterministic code validates the graph.",
              "Do not invent existing repository state or silently alter approved scope.",
              `Project vision: ${project.vision.slice(0, 2_000)}`,
              `Constraints: ${project.constraints
                .slice(0, 20)
                .map((c) => c.slice(0, 150))
                .join("; ")}`,
            ].join("\n"),
          ),
          message("user", goal.slice(0, 8_000)),
        ],
        maxOutputTokens: this.#options.decompositionMaxOutputTokens ?? 4_000,
        ...(this.#options.temperature !== undefined
          ? { temperature: this.#options.temperature }
          : {}),
      });
      const validated = this.#decomposition.validate({
        projectId,
        proposals: generated.value.tasks,
        idForKey: () => randomUUID(),
        now,
      });
      this.#onLlm?.({
        operation: "task_decomposition",
        provider: generated.response.provider,
        model: generated.response.model,
        finishReason: generated.response.finishReason,
        usage: generated.response.usage,
      });
      const tasks = validated.tasks.map((task) => ({
        id: task.id,
        projectId,
        title: task.title,
        description: task.description,
        expectedOutcome: task.expectedOutcome,
        ...(task.ownerRole === undefined ? {} : { ownerRole: task.ownerRole }),
        riskLevel: task.riskLevel,
        verificationRequirements: task.verificationRequirements,
        suggestedEvidence: task.suggestedEvidence,
        ...(task.component === undefined ? {} : { component: task.component }),
        deadlineCriticality: task.deadlineCriticality,
        scopeTier: task.scopeTier,
        releaseRequired: task.scopeTier === "MUST",
        status: "PLANNED" as const,
        impact: task.impact,
        weight: task.weight,
        estimatedEffortHours: task.estimatedEffortHours,
        now,
      }));
      const created = await this.#store.createTaskPlan({
        projectId,
        tasks,
        dependencies: validated.dependencies.map((dependency) => ({
          taskId: dependency.dependantTaskId,
          dependsOnTaskId: dependency.dependencyTaskId,
        })),
      });
      const settings = await this.#store.getProjectSettings(projectId);
      if (settings.baselineTaskIds.length === 0) {
        await this.#store.saveProjectSettings({
          ...settings,
          baselineTaskIds: created.map((task) => task.id),
        });
      }
      return { tasks: created, provider: generated.response.provider };
    } catch (error) {
      this.#onLlm?.({
        operation: "task_decomposition",
        provider: isLlmError(error) ? (error.provider ?? "unknown") : "unknown",
        errorCategory: isLlmError(error) ? error.code : "invalid_output",
      });
      if (isLlmError(error) && error.code === "provider_not_configured") {
        throw new DirectorServiceError(
          503,
          "PROVIDER_NOT_CONFIGURED",
          "No AI provider is configured. Configure any supported provider or use FakeProvider for deterministic development.",
          { cause: error },
        );
      }
      if (isLlmError(error) && error.code === "invalid_response") {
        throw new DirectorServiceError(
          502,
          "INVALID_MODEL_OUTPUT",
          "The provider returned a task plan that failed schema validation.",
          { cause: error },
        );
      }
      if (error instanceof DomainValidationError || error instanceof CycleDetectedError) {
        throw new DirectorServiceError(
          502,
          "INVALID_MODEL_OUTPUT",
          `The provider returned an invalid task plan: ${error.message}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  async whatNow(discordGuildId: string, externalUserId: string, now = new Date()) {
    const { project, member } = await this.#authorizeGuild(discordGuildId, externalUserId);
    const state = await this.#state(project, now);
    const recommendation = this.#recommendation.whatNow({
      member: coreMember(member, project.id),
      tasks: state.tasks,
      dependencies: state.dependencies,
      blockers: state.blockers,
      phase: state.snapshot.deadline.phase,
      deadlineBufferHours: state.snapshot.deadline.bufferHours,
    });
    return {
      projectId: project.id,
      phase: state.snapshot.deadline.phase,
      recommendation,
      message:
        recommendation === undefined
          ? "No actionable unblocked task is currently ready."
          : undefined,
    };
  }

  async why(discordGuildId: string, externalUserId: string, taskId?: string, now = new Date()) {
    const result = await this.whatNow(discordGuildId, externalUserId, now);
    if (taskId === undefined || result.recommendation?.taskId === taskId) {
      return result.recommendation === undefined
        ? {
            known: false,
            reasons: [
              "No current recommendation exists, so there is no evidence-backed rationale to explain.",
            ],
          }
        : {
            known: true,
            taskId: result.recommendation.taskId,
            reasons: result.recommendation.reasons,
            confidence: result.recommendation.confidence,
          };
    }
    const assignments = await this.#store.listAssignments(result.projectId, taskId);
    const latest = assignments[0];
    return latest === undefined
      ? {
          known: false,
          taskId,
          reasons: ["No persisted recommendation or assignment rationale exists for this task."],
        }
      : { known: true, taskId, reasons: latest.reasons, confidence: latest.confidence };
  }

  async assignmentRecommendations(
    projectId: string,
    taskId: string,
    externalUserId: string,
    now = new Date(),
  ) {
    const { project } = await this.#authorizeProject(projectId, externalUserId, true);
    const state = await this.#state(project, now);
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined)
      throw new DirectorServiceError(404, "TASK_NOT_FOUND", "Task was not found in this project.");
    const memberRecords = await this.#store.listTeamMembers(project.workspaceId);
    return this.#assignment.recommend({
      task,
      graph: new TaskGraph(state.tasks, state.dependencies),
      criticalPathTaskIds: new Set(state.snapshot.criticalPath.taskIds),
      blockers: state.blockers,
      now,
      candidates: memberRecords.map((candidate) => ({
        member: coreMember(candidate, project.id),
        currentTasks: state.tasks.filter((current) => current.ownerId === candidate.id),
        recentComponent: state.tasks.find(
          (current) => current.ownerId === candidate.id && current.component !== undefined,
        )?.component,
        aiCapacity: new AICapacityDimensions({
          confidence: candidate.aiToolProfiles.length > 0 ? 0.25 : 0.1,
        }),
      })),
    });
  }

  async approveAssignment(
    projectId: string,
    taskId: string,
    memberId: string,
    externalUserId: string,
    reasons: readonly string[],
    score: number,
    confidence: number,
    now = new Date(),
  ) {
    const { member } = await this.#authorizeProject(projectId, externalUserId, true);
    return this.#store.assignTask(
      {
        id: randomUUID(),
        projectId,
        taskId,
        memberId,
        reasons,
        score,
        confidence,
        automatic: false,
        approvedBy: member.id,
        createdAt: now,
      },
      now,
    );
  }

  async addBlocker(
    projectId: string,
    externalUserId: string,
    input: BlockerInput,
    now = new Date(),
  ) {
    const { member } = await this.#authorizeProject(projectId, externalUserId);
    const blocker: BlockerRecord = {
      id: randomUUID(),
      projectId,
      description: input.description,
      source: input.source,
      severity: input.severity,
      ...(input.blockedTaskId === undefined ? {} : { blockedTaskId: input.blockedTaskId }),
      ...(input.blockingTaskId === undefined ? {} : { blockingTaskId: input.blockingTaskId }),
      ...(input.blockedMemberId === undefined ? {} : { blockedMemberId: input.blockedMemberId }),
      suggestedResolution: input.suggestedResolution?.trim() ?? "",
      createdBy: member.id,
      createdAt: now,
    };
    await this.#store.addBlocker(blocker);
    return blocker;
  }

  async listBlockers(projectId: string, externalUserId: string, includeResolved = false) {
    const { project } = await this.#authorizeProject(projectId, externalUserId);
    const records = await this.#store.listBlockers(projectId, includeResolved);
    const state = await this.#state(project, new Date());
    const priority = new Map(
      this.#blockers
        .prioritize(records.map(coreBlocker), new TaskGraph(state.tasks, state.dependencies))
        .map((entry) => [entry.blocker.id, entry]),
    );
    return records.map((record) => ({ ...record, priority: priority.get(record.id) }));
  }

  async resolveBlocker(
    projectId: string,
    blockerId: string,
    externalUserId: string,
    now = new Date(),
  ) {
    const { member } = await this.#authorizeProject(projectId, externalUserId);
    if (
      !(await this.#store.listBlockers(projectId, true)).some((blocker) => blocker.id === blockerId)
    ) {
      throw new DirectorServiceError(
        404,
        "BLOCKER_NOT_FOUND",
        "Blocker was not found in this project.",
      );
    }
    return this.#store.resolveBlocker(blockerId, member.id, now);
  }

  async cutScope(projectId: string, externalUserId: string, now = new Date()) {
    const { project } = await this.#authorizeProject(projectId, externalUserId);
    const state = await this.#state(project, now);
    return {
      candidates: this.#scope.cutCandidates(state.tasks, state.dependencies),
      requiresExplicitDecision: true,
      note: "No task or approved scope was changed. An authorized SCOPE_CHANGE decision is required.",
    };
  }

  async missionControl(discordGuildId: string, externalUserId: string, now = new Date()) {
    const { project } = await this.#authorizeGuild(discordGuildId, externalUserId);
    const state = await this.#state(project, now);
    const settings = await this.#store.getProjectSettings(project.id);
    const milestones = await this.listMilestones(project.id, externalUserId);
    const evidence = await this.#store.listProjectTaskEvidence(project.id);
    const requiredChecks = evidence.filter(
      (item) => item.kind === "CHECK_RUN" || item.kind === "TEST_RESULT",
    );
    const packagingTasks = state.tasks.filter((task) =>
      task.tags.some((tag) => /packag|submission/iu.test(tag)),
    );
    const release = this.#release.assess({
      tasks: state.tasks,
      blockers: state.blockers,
      requiredChecks: requiredChecks.map((item) => ({ name: item.summary, passed: item.verified })),
      buildAvailable: evidence.some((item) =>
        ["BUILD", "ARTIFACT", "DEPLOYMENT"].includes(item.kind),
      ),
      packagingComplete:
        packagingTasks.length > 0 && packagingTasks.every((task) => task.status === "SHIPPED"),
      unresolvedCriticalRiskCount: state.snapshot.risk.risks.filter(
        (risk) => risk.severity === "CRITICAL",
      ).length,
    });
    const blockerPriority = this.#blockers.prioritize(
      state.blockers,
      new TaskGraph(state.tasks, state.dependencies),
    );
    const activity = await this.#store.listGitHubActivity(project.id, 200);
    const githubActivities = activity.map((entry) => {
      const kind =
        entry.kind === "PULL_REQUEST_REVIEW"
          ? "REVIEW"
          : entry.kind === "WORKFLOW_RUN"
            ? "WORKFLOW"
            : entry.kind;
      const mappedKind = ["PUSH", "PULL_REQUEST", "REVIEW", "CHECK", "ISSUE", "WORKFLOW"].includes(
        kind,
      )
        ? (kind as "PUSH" | "PULL_REQUEST" | "REVIEW" | "CHECK" | "ISSUE" | "WORKFLOW")
        : "PUSH";
      const openedAtRaw = entry.metadata["openedAt"];
      const openedAt =
        typeof openedAtRaw === "string" && !Number.isNaN(new Date(openedAtRaw).getTime())
          ? new Date(openedAtRaw)
          : undefined;
      return {
        id: entry.id,
        kind: mappedKind,
        taskId: entry.taskId,
        title: text(entry.metadata["title"], `${entry.kind} ${entry.externalId}`),
        url: entry.url,
        branch: entry.branch,
        state: text(entry.metadata["action"], text(entry.metadata["status"])),
        changedFiles: entry.changedFiles,
        openedAt,
        updatedAt: entry.occurredAt,
        reviewed:
          entry.taskId !== undefined &&
          activity.some(
            (candidate) =>
              candidate.taskId === entry.taskId &&
              candidate.kind === "PULL_REQUEST_REVIEW" &&
              text(candidate.metadata["state"]).toLocaleLowerCase() === "approved",
          ),
        checksPassing:
          entry.taskId !== undefined &&
          activity.some(
            (candidate) =>
              candidate.taskId === entry.taskId &&
              ["CHECK", "WORKFLOW_RUN"].includes(candidate.kind) &&
              candidate.metadata["conclusion"] === "success",
          ),
        merged: entry.metadata["merged"] === true,
      };
    });
    const githubFindings = this.#github.assess({
      tasks: state.tasks,
      dependencies: state.dependencies,
      activities: githubActivities,
      criticalPathTaskIds: new Set(state.snapshot.criticalPath.taskIds),
      phase: state.snapshot.deadline.phase,
      now,
      stalePullRequestHours: project.mode === "GAME_JAM" ? 3 : 48,
    });
    const drift = this.#scope.detectDrift({
      baselineTaskIds: new Set(settings.baselineTaskIds),
      tasks: state.tasks,
      phase: state.snapshot.deadline.phase,
    });
    const nextCheckpointAt = new Date(now.getTime() + settings.checkpointCadenceHours * 3_600_000);
    return {
      project: {
        id: project.id,
        name: project.name,
        deadline: project.deadline,
        phase: state.snapshot.deadline.phase,
      },
      health: state.snapshot.health,
      integrationProgress: state.snapshot.health.dimensions.INTEGRATION.score,
      release,
      criticalPath: state.snapshot.criticalPath.taskIds.map(
        (id) => state.tasks.find((task) => task.id === id)?.title ?? id,
      ),
      milestones,
      blockers: blockerPriority.slice(0, 5),
      risks: state.snapshot.risk,
      drift,
      githubFindings,
      nextCheckpointAt,
      deadlineForecast: {
        confidence:
          state.tasks.length < 3 || state.tasks.some((task) => task.estimatedEffortHours === 0)
            ? "LOW"
            : state.tasks.some(
                  (task) => task.ownerId === undefined && task.deadlineCriticality === "CRITICAL",
                )
              ? "MEDIUM"
              : "HIGH",
        evidence: [
          `${state.tasks.filter((task) => task.estimatedEffortHours > 0).length}/${state.tasks.length} active task estimates are recorded.`,
          `${state.tasks.filter((task) => task.ownerId !== undefined).length}/${state.tasks.length} task owners are recorded.`,
          `Tracked deadline buffer is ${state.snapshot.deadline.bufferHours}h; estimates remain planning inputs, not statistical certainty.`,
        ],
      },
      missionControlLocation:
        settings.missionControlChannelId === undefined ||
        settings.missionControlMessageId === undefined
          ? undefined
          : {
              channelId: settings.missionControlChannelId,
              messageId: settings.missionControlMessageId,
            },
    };
  }

  async configureProjectSettings(
    projectId: string,
    externalUserId: string,
    patch: {
      readonly checkpointCadenceHours?: number | undefined;
      readonly notificationPolicy?:
        | "IMMEDIATE_CRITICAL"
        | "BATCHED"
        | "CHECKPOINT_ONLY"
        | undefined;
      readonly missionControlChannelId?: string | undefined;
      readonly missionControlMessageId?: string | undefined;
    },
  ) {
    await this.#authorizeProject(projectId, externalUserId, true);
    const current = await this.#store.getProjectSettings(projectId);
    const settings = {
      ...current,
      ...(patch.checkpointCadenceHours === undefined
        ? {}
        : { checkpointCadenceHours: patch.checkpointCadenceHours }),
      ...(patch.notificationPolicy === undefined
        ? {}
        : { notificationPolicy: patch.notificationPolicy }),
      ...(patch.missionControlChannelId === undefined
        ? {}
        : { missionControlChannelId: patch.missionControlChannelId }),
      ...(patch.missionControlMessageId === undefined
        ? {}
        : { missionControlMessageId: patch.missionControlMessageId }),
    };
    await this.#store.saveProjectSettings(settings);
    return settings;
  }

  async smartCheckpoint(discordGuildId: string, externalUserId: string) {
    const { project, member } = await this.#authorizeGuild(discordGuildId, externalUserId);
    const state = await this.#state(project, new Date());
    const activity = await this.#store.listGitHubActivity(project.id, 50);
    const ownedIds = new Set(
      state.tasks.filter((task) => task.ownerId === member.id).map((task) => task.id),
    );
    return this.#checkpoints.create({
      memberId: member.id,
      tasks: state.tasks,
      blockers: state.blockers,
      activity: activity
        .filter((entry) => entry.taskId !== undefined && ownedIds.has(entry.taskId))
        .slice(0, 10)
        .map((entry) => ({
          kind:
            entry.kind === "PULL_REQUEST" && entry.metadata["merged"] === true
              ? "PULL_REQUEST_MERGED"
              : entry.kind === "PULL_REQUEST"
                ? "PULL_REQUEST_OPENED"
                : entry.metadata["conclusion"] === "success"
                  ? "CHECK_PASSED"
                  : "CHECK_FAILED",
          summary: `${entry.kind} ${entry.externalId}: ${text(entry.metadata["title"], text(entry.metadata["conclusion"], "observed"))}`,
          taskId: entry.taskId,
        })),
    });
  }

  async captureCheckpoint(projectId: string, externalUserId: string, now = new Date()) {
    const { project } = await this.#authorizeProject(projectId, externalUserId, true);
    const state = await this.#state(project, now);
    const history = await this.#store.listRiskSnapshots(projectId, 1);
    const previous = history[0];
    const currentSignals = state.snapshot.risk.signals.filter((signal) => signal.active);
    const previousContributions = new Map(
      (previous?.signals ?? []).map((signal) => [
        text(signal["code"]),
        numberValue(signal["contribution"], 0),
      ]),
    );
    const changes = currentSignals
      .map((signal) => ({
        signal: signal.code,
        delta: signal.contribution - (previousContributions.get(signal.code) ?? 0),
        evidence: signal.evidence.join(" "),
      }))
      .filter((change) => change.delta !== 0);
    for (const [signal, contribution] of previousContributions) {
      if (!currentSignals.some((current) => current.code === signal) && contribution !== 0) {
        changes.push({
          signal: signal as (typeof currentSignals)[number]["code"],
          delta: -contribution,
          evidence: "Signal is no longer active in deterministic project state.",
        });
      }
    }
    const snapshot = {
      id: randomUUID(),
      projectId,
      score: state.snapshot.risk.overallScore,
      severity: state.snapshot.risk.severity,
      signals: currentSignals.map((signal) => ({
        code: signal.code,
        title: signal.title,
        contribution: signal.contribution,
        severity: signal.severity,
        evidence: signal.evidence,
        affectedTaskIds: signal.affectedTaskIds,
      })),
      changes,
      capturedAt: now,
    };
    await this.#store.addRiskSnapshot(snapshot);
    return {
      snapshot,
      previousScore: previous?.score,
      scoreDelta: previous === undefined ? undefined : snapshot.score - previous.score,
      changes,
    };
  }

  async queryMemory(projectId: string, externalUserId: string, question: string) {
    await this.#authorizeProject(projectId, externalUserId);
    const [memory, decisions, assignments] = await Promise.all([
      this.#store.listMemory(projectId),
      this.#store.listDecisions(projectId, 100),
      this.#store.listAssignments(projectId),
    ]);
    const terms = question
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 3);
    const sources = [
      ...memory.map((entry) => ({
        id: `memory:${entry.id}`,
        kind: entry.category,
        title: entry.title,
        content: entry.content,
        at: entry.createdAt,
      })),
      ...decisions.map((entry) => ({
        id: `decision:${entry.id}`,
        kind: "DECISION",
        title: entry.title,
        content: `${entry.description} ${entry.rationale} ${entry.outcome}`,
        at: entry.createdAt,
      })),
      ...assignments.map((entry) => ({
        id: `assignment:${entry.id}`,
        kind: "ASSIGNMENT",
        title: `Task ${entry.taskId} assignment`,
        content: entry.reasons.join(" "),
        at: entry.createdAt,
      })),
    ];
    const matches = sources
      .map((source) => ({
        source,
        score: terms.filter((term) =>
          `${source.title} ${source.content}`.toLocaleLowerCase().includes(term),
        ).length,
      }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || right.source.at.getTime() - left.source.at.getTime(),
      )
      .slice(0, 5)
      .map((entry) => entry.source);
    return matches.length === 0
      ? { answer: "No recorded project evidence answers this question.", citations: [] }
      : {
          answer: matches.map((entry) => `${entry.title}: ${entry.content}`).join("\n"),
          citations: matches.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            recordedAt: entry.at,
          })),
        };
  }

  async connectGitHub(
    projectId: string,
    externalUserId: string,
    installationId: number,
    repositoryId: number,
    repositoryFullName: string,
  ) {
    await this.#authorizeProject(projectId, externalUserId, true);
    await this.#store.connectGitHubRepository(
      projectId,
      installationId,
      repositoryId,
      repositoryFullName,
    );
    return { connected: true, projectId, installationId, repositoryId, repositoryFullName };
  }

  async linkTaskToGitHub(
    projectId: string,
    taskId: string,
    externalUserId: string,
    repositoryId: number,
    linkKind: "BRANCH" | "PULL_REQUEST" | "ISSUE",
    externalId: string,
    now = new Date(),
  ) {
    await this.#authorizeProject(projectId, externalUserId, true);
    await this.#store.linkTaskToGitHub(projectId, taskId, repositoryId, linkKind, externalId, now);
    return { linked: true, taskId, repositoryId, linkKind, externalId };
  }

  async #state(project: ProjectRecord, now: Date) {
    const records = await this.#store.listTasks(project.id);
    const tasks = records.map(coreTask);
    const dependencies = coreDependencies(records);
    const blockers = (await this.#store.listBlockers(project.id)).map(coreBlocker);
    const members = await this.#store.listTeamMembers(project.workspaceId);
    const remainingHours = Math.max(0, (project.deadline.getTime() - now.getTime()) / 3_600_000);
    const availableCapacityHours =
      members.reduce(
        (sum, member) => sum + numberValue(member.availability["hoursPerWeek"], 0),
        0,
      ) *
      (remainingHours / 168);
    const snapshot = this.#director.analyze({
      project: coreProject(project),
      tasks,
      dependencies,
      now,
      availableCapacityHours,
      buildFreshness: {
        projectStartedAt: project.createdAt,
        maximumAgeHours: project.mode === "GAME_JAM" ? 6 : 72,
      },
    });
    return { records, tasks, dependencies, blockers, snapshot };
  }

  async #authorizeGuild(discordGuildId: string, externalUserId: string) {
    const project = await this.#store.getProjectByGuild(discordGuildId);
    if (project === undefined)
      throw new DirectorServiceError(404, "PROJECT_NOT_FOUND", "Run `/project setup` first.");
    const member = await this.#store.getTeamMember(project.workspaceId, externalUserId);
    if (member === undefined)
      throw new DirectorServiceError(403, "FORBIDDEN", "Join the project team first.");
    return { project, member };
  }

  async #authorizeProject(projectId: string, externalUserId: string, requireManager = false) {
    const project = await this.#store.getProject(projectId);
    if (project === undefined)
      throw new DirectorServiceError(404, "PROJECT_NOT_FOUND", "Project was not found.");
    const member = await this.#store.getTeamMember(project.workspaceId, externalUserId);
    if (member === undefined)
      throw new DirectorServiceError(403, "FORBIDDEN", "You are not a member of this workspace.");
    if (requireManager && !manager(member))
      throw new DirectorServiceError(
        403,
        "FORBIDDEN",
        "This operation requires a project owner or producer role.",
      );
    return { project, member };
  }
}
