import { randomUUID } from "node:crypto";
import {
  Project,
  ProjectDirector,
  ProjectVision,
  Task,
  TaskDependency,
  TaskEvidence,
  TaskGraph,
  TaskStateMachine,
  TASK_STATUSES,
  type TaskEvidenceKind,
  type TaskStatus,
} from "@nehemiah/core";
import type {
  MemoryCategoryRecord,
  ProjectRecord,
  ProjectSetupInput,
  ProjectStore,
  TaskCreateInput,
  TaskEvidenceRecord,
  TaskRecord,
  TeamMemberProfileInput,
} from "@nehemiah/database";
import { isLlmError, message, responseText, type LlmRegistry } from "@nehemiah/llm";
import { compressContext, producerSystemPrompt } from "./prompts.js";

export class DirectorServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, messageValue: string, options?: ErrorOptions) {
    super(messageValue, options);
    this.name = "DirectorServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SetupProjectCommand {
  readonly discordGuildId?: string | undefined;
  readonly ownerExternalUserId: string;
  readonly ownerDisplayName: string;
  readonly name: string;
  readonly description: string;
  readonly vision: string;
  readonly problem?: string | undefined;
  readonly targetOutcome?: string | undefined;
  readonly coreExperience?: string | undefined;
  readonly mustHaveScope?: readonly string[] | undefined;
  readonly shouldHaveScope?: readonly string[] | undefined;
  readonly niceToHaveScope?: readonly string[] | undefined;
  readonly excludedScope?: readonly string[] | undefined;
  readonly successCriteria?: readonly string[] | undefined;
  readonly nonGoals?: readonly string[] | undefined;
  readonly deadline: string;
  readonly timezone: string;
  readonly mode: "STANDARD" | "GAME_JAM";
  readonly githubRepository?: string | undefined;
  readonly constraints?: readonly string[] | undefined;
}

export interface JoinTeamCommand {
  readonly discordGuildId: string;
  readonly externalUserId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly skills: readonly { readonly name: string; readonly level: number }[];
  readonly hoursPerWeek: number;
  readonly timezone: string;
  readonly aiTools: readonly string[];
}

function validateTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch (error) {
    throw new DirectorServiceError(400, "INVALID_TIMEZONE", `Unknown IANA timezone: ${timezone}`, {
      cause: error,
    });
  }
}

function parseDeadline(value: string, now: Date): Date {
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) {
    throw new DirectorServiceError(400, "INVALID_DEADLINE", "Deadline must be ISO 8601.");
  }
  if (deadline <= now) {
    throw new DirectorServiceError(400, "INVALID_DEADLINE", "Deadline must be in the future.");
  }
  return deadline;
}

function coreProject(project: ProjectRecord): Project {
  return new Project({
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    description: project.description,
    vision: new ProjectVision({
      statement: project.vision,
      ...project.visionDetails,
      constraints: project.constraints,
      successCriteria: project.successCriteria,
      nonGoals: project.nonGoals,
    }),
    deadline: project.deadline,
    timezone: project.timezone,
    mode: project.mode,
    status: project.status,
    constraints: project.constraints,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
}

function evidenceKindForStatus(status: TaskStatus): TaskEvidenceKind {
  switch (status) {
    case "IMPLEMENTED":
      return "ARTIFACT";
    case "VERIFIED":
      return "MANUAL_VERIFICATION";
    case "INTEGRATED":
      return "BUILD";
    case "SHIPPED":
      return "DEPLOYMENT";
    default:
      return "NOTE";
  }
}

function coreEvidence(record: TaskEvidenceRecord): TaskEvidence {
  const kind = record.kind as TaskEvidenceKind;
  return new TaskEvidence({
    id: record.id,
    taskId: record.taskId,
    kind,
    summary: record.summary,
    ...(record.uri === undefined ? {} : { uri: record.uri }),
    recordedBy: record.submittedBy ?? "SYSTEM",
    recordedAt: record.createdAt,
  });
}

function blockReason(record: TaskRecord): string | undefined {
  const value = record.metadata?.["blockReason"];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function coreTask(record: TaskRecord, evidence: readonly TaskEvidenceRecord[] = []): Task {
  return new Task({
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    description: record.description,
    expectedOutcome: record.expectedOutcome,
    ownerRole: record.ownerRole,
    riskLevel: record.riskLevel,
    verificationRequirements: record.verificationRequirements,
    suggestedEvidence: record.suggestedEvidence as readonly TaskEvidenceKind[],
    component: record.component,
    deadlineCriticality: record.deadlineCriticality,
    scopeTier: record.scopeTier,
    status: record.status,
    impact: record.impact,
    weight: record.weight,
    estimatedEffortHours: record.estimatedEffortHours,
    ...(record.ownerMemberId === undefined ? {} : { ownerId: record.ownerMemberId }),
    ...(record.milestoneId === undefined ? {} : { milestoneId: record.milestoneId }),
    ...(record.dueAt === undefined ? {} : { dueAt: record.dueAt }),
    releaseRequired: record.releaseRequired,
    tags: Array.isArray(record.metadata?.["tags"])
      ? record.metadata["tags"].filter((tag): tag is string => typeof tag === "string")
      : [],
    ...(record.status !== "BLOCKED"
      ? {}
      : { blockReason: blockReason(record) ?? "Reason not recorded" }),
    evidence: evidence.map(coreEvidence),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function dependenciesFor(records: readonly TaskRecord[]): readonly TaskDependency[] {
  return records.flatMap((record) =>
    record.dependencyIds.map(
      (dependencyId) =>
        new TaskDependency({
          projectId: record.projectId,
          dependencyTaskId: dependencyId,
          dependantTaskId: record.id,
          requiredStatus: "VERIFIED",
        }),
    ),
  );
}

function humanDuration(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

export interface DirectorServiceOptions {
  readonly maxOutputTokens?: number;
  readonly maxContextMemoryItems?: number;
  readonly maxContextSignals?: number;
  readonly temperature?: number;
}

export class DirectorApplicationService {
  readonly #store: ProjectStore;
  readonly #llm: LlmRegistry;
  readonly #director = new ProjectDirector();
  readonly #stateMachine = new TaskStateMachine();
  readonly #onLlm?: ((metadata: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly #options: DirectorServiceOptions;

  constructor(
    store: ProjectStore,
    llm: LlmRegistry,
    onLlm?: (metadata: Readonly<Record<string, unknown>>) => void,
    options?: DirectorServiceOptions,
  ) {
    this.#store = store;
    this.#llm = llm;
    this.#onLlm = onLlm;
    this.#options = options ?? {};
  }

  async setupProject(command: SetupProjectCommand, now = new Date()): Promise<ProjectRecord> {
    const input: ProjectSetupInput = {
      workspaceId: randomUUID(),
      projectId: randomUUID(),
      ownerMemberId: randomUUID(),
      workspaceName: `${command.name} workspace`,
      ownerExternalUserId: command.ownerExternalUserId.trim(),
      ownerDisplayName: command.ownerDisplayName.trim(),
      name: command.name.trim(),
      description: command.description.trim(),
      vision: command.vision.trim(),
      visionDetails: {
        problem: command.problem?.trim() ?? "",
        targetOutcome: command.targetOutcome?.trim() || command.vision.trim(),
        coreExperience: command.coreExperience?.trim() ?? "",
        mustHaveScope: command.mustHaveScope ?? [],
        shouldHaveScope: command.shouldHaveScope ?? [],
        niceToHaveScope: command.niceToHaveScope ?? [],
        excludedScope: command.excludedScope ?? command.nonGoals ?? [],
      },
      deadline: parseDeadline(command.deadline, now),
      timezone: validateTimezone(command.timezone.trim()),
      mode: command.mode,
      createdAt: now,
      ...(command.discordGuildId === undefined ? {} : { discordGuildId: command.discordGuildId }),
      ...(command.githubRepository === undefined
        ? {}
        : { githubRepository: command.githubRepository.trim() }),
      ...(command.constraints === undefined ? {} : { constraints: command.constraints }),
      ...(command.successCriteria === undefined
        ? {}
        : { successCriteria: command.successCriteria }),
      ...(command.nonGoals === undefined ? {} : { nonGoals: command.nonGoals }),
    };
    if (
      [
        input.ownerExternalUserId,
        input.ownerDisplayName,
        input.name,
        input.description,
        input.vision,
      ].some((value) => value.length === 0)
    ) {
      throw new DirectorServiceError(
        400,
        "INVALID_PROJECT",
        "Project setup fields must not be empty.",
      );
    }
    return this.#store.setupProject(input);
  }

  async joinTeam(command: JoinTeamCommand, now = new Date()) {
    const project = await this.#requireProjectByGuild(command.discordGuildId);
    validateTimezone(command.timezone);
    const current = await this.#store.getTeamMember(project.workspaceId, command.externalUserId);
    const protectedRoles =
      current?.roles.filter((role) =>
        ["OWNER", "PROJECT_OWNER", "PRODUCER", "INTEGRATION"].includes(role.toUpperCase()),
      ) ?? [];
    const selfSelectedRoles = command.roles.filter(
      (role) => !["OWNER", "PROJECT_OWNER", "PRODUCER", "INTEGRATION"].includes(role.toUpperCase()),
    );
    const input: TeamMemberProfileInput = {
      id: randomUUID(),
      workspaceId: project.workspaceId,
      externalUserId: command.externalUserId,
      displayName: command.displayName,
      roles: [...new Set([...protectedRoles, ...selfSelectedRoles])],
      skills: command.skills,
      availability: { hoursPerWeek: command.hoursPerWeek, timezone: command.timezone },
      communicationPreferences: { timezone: command.timezone },
      aiToolProfiles: command.aiTools.map((tool) => ({ tool })),
      now,
    };
    return this.#store.joinTeam(input);
  }

  async createTask(
    projectId: string,
    externalUserId: string,
    input: Omit<TaskCreateInput, "id" | "projectId" | "now">,
    now = new Date(),
  ) {
    const project = await this.#requireProject(projectId);
    await this.#requireManager(project, externalUserId);
    return this.#store.createTask({ ...input, id: randomUUID(), projectId, now });
  }

  async addDependency(
    taskId: string,
    dependsOnTaskId: string,
    externalUserId: string,
  ): Promise<void> {
    const task = await this.#store.getTask(taskId);
    if (task === undefined)
      throw new DirectorServiceError(404, "TASK_NOT_FOUND", "Task was not found.");
    const project = await this.#requireProject(task.projectId);
    await this.#requireManager(project, externalUserId);
    await this.#store.addTaskDependency(taskId, dependsOnTaskId);
  }

  async currentTasks(discordGuildId: string, externalUserId: string) {
    const project = await this.#requireProjectByGuild(discordGuildId);
    const member = await this.#store.getTeamMember(project.workspaceId, externalUserId);
    if (member === undefined) {
      throw new DirectorServiceError(404, "MEMBER_NOT_FOUND", "Join the project team first.");
    }
    return this.#store.listMemberTasks(project.id, member.id);
  }

  async updateTask(
    taskId: string,
    externalUserId: string,
    statusValue: string,
    evidenceSummary: string | undefined,
    now = new Date(),
  ): Promise<TaskRecord> {
    if (!TASK_STATUSES.some((status) => status === statusValue)) {
      throw new DirectorServiceError(400, "INVALID_TASK_STATUS", "Unknown task status.");
    }
    const status = statusValue as TaskStatus;
    const records = await this.#findTaskProject(taskId);
    const taskRecord = records.tasks.find((task) => task.id === taskId)!;
    const member = await this.#store.getTeamMember(records.project.workspaceId, externalUserId);
    if (member === undefined || taskRecord.ownerMemberId !== member.id) {
      throw new DirectorServiceError(
        403,
        "FORBIDDEN",
        "You may update only a task assigned to you.",
      );
    }
    const evidenceRecords = await this.#store.listTaskEvidence(taskId);
    const tasks = records.tasks.map((task) =>
      coreTask(task, task.id === taskId ? evidenceRecords : []),
    );
    const task = tasks.find((candidate) => candidate.id === taskId)!;
    const graph = new TaskGraph(tasks, dependenciesFor(records.tasks));
    const newEvidence =
      evidenceSummary === undefined || evidenceSummary.trim().length === 0
        ? []
        : [
            new TaskEvidence({
              id: randomUUID(),
              taskId,
              kind: evidenceKindForStatus(status),
              summary: evidenceSummary.trim(),
              recordedBy: member.id,
              recordedAt: now,
            }),
          ];
    const transition = this.#stateMachine.transition({
      task,
      to: status,
      graph,
      evidence: newEvidence,
      ownerId: member.id,
      ...(status === "BLOCKED"
        ? { blockReason: evidenceSummary?.trim() || "Blocked without a supplied reason" }
        : {}),
      now,
    });
    const persistenceEvidence = newEvidence.map((evidence) => ({
      id: evidence.id,
      taskId: evidence.taskId,
      kind: evidence.kind,
      summary: evidence.summary,
      verified: false,
      submittedBy: member.id,
      createdAt: evidence.recordedAt,
    }));
    return this.#store.applyTaskTransition({
      taskId,
      expectedStatus: taskRecord.status,
      expectedUpdatedAt: taskRecord.updatedAt,
      status: transition.status,
      now,
      ...(transition.blockReason === undefined ? {} : { blockReason: transition.blockReason }),
      ...(persistenceEvidence.length === 0 ? {} : { evidence: persistenceEvidence }),
    });
  }

  async projectStatus(discordGuildId: string, now = new Date()) {
    const project = await this.#requireProjectByGuild(discordGuildId);
    const records = await this.#store.listTasks(project.id);
    const tasks = records.map((task) => coreTask(task));
    const snapshot = this.#director.analyze({
      project: coreProject(project),
      tasks,
      dependencies: dependenciesFor(records),
      now,
      buildFreshness: {
        projectStartedAt: project.createdAt,
        maximumAgeHours: project.mode === "GAME_JAM" ? 6 : 72,
      },
    });
    const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
    return {
      projectId: project.id,
      name: project.name,
      phase: snapshot.deadline.phase,
      remainingTime: humanDuration(snapshot.deadline.remainingHours),
      deadlineBufferHours: snapshot.deadline.bufferHours,
      health: {
        implementation: snapshot.health.dimensions.IMPLEMENTATION.score,
        integration: snapshot.health.dimensions.INTEGRATION.score,
        verification: snapshot.health.dimensions.VERIFICATION.score,
        releaseReadiness: snapshot.health.dimensions.RELEASE_READINESS.score,
      },
      risk: {
        score: snapshot.risk.overallScore,
        severity: snapshot.risk.severity,
        signals: snapshot.risk.signals
          .filter((signal) => signal.active)
          .flatMap((signal) => (signal.evidence.length === 0 ? [signal.title] : signal.evidence)),
      },
      criticalPath: snapshot.criticalPath.taskIds.map((id) => taskTitles.get(id) ?? id),
      readyTaskIds: snapshot.readyTaskIds,
      blockedTaskIds: snapshot.blockedTasks.map((entry) => entry.task.id),
      remainingEstimatedEffortHours: snapshot.remainingEstimatedEffortHours,
      overallHealth: snapshot.health.overallScore,
    };
  }

  async askProducer(
    discordGuildId: string,
    externalUserId: string,
    question: string,
  ): Promise<{ answer: string; provider: string }> {
    const project = await this.#requireProjectByGuild(discordGuildId);
    const member = await this.#store.getTeamMember(project.workspaceId, externalUserId);
    if (member === undefined) {
      throw new DirectorServiceError(403, "FORBIDDEN", "Join the project team before asking.");
    }
    const status = await this.projectStatus(discordGuildId);
    const maxMemory = this.#options.maxContextMemoryItems ?? 20;
    const memory = await this.#store.listMemory(
      project.id,
      [
        "FACT",
        "DECISION",
        "CONSTRAINT",
        "ARCHITECTURE",
        "REQUIREMENT",
        "TEAM",
        "RISK",
        "LESSON",
      ] satisfies readonly MemoryCategoryRecord[],
      maxMemory * 2,
    );
    const queryTokens = new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]/giu, " ")
        .split(/\s+/)
        .filter((tok) => tok.length > 2),
    );
    const scoredMemory = memory.map((entry) => {
      let score = entry.confidence ?? 1;
      if (entry.category === "CONSTRAINT" || entry.category === "ARCHITECTURE") {
        score += 5;
      }
      const text = `${entry.title} ${entry.content}`.toLowerCase();
      for (const token of queryTokens) {
        if (text.includes(token)) score += 3;
      }
      return { entry, score };
    });
    scoredMemory.sort((a, b) => b.score - a.score);
    const selectedMemory = scoredMemory.slice(0, maxMemory).map(({ entry }) => ({
      category: entry.category,
      title: entry.title.slice(0, 150),
      content: entry.content.length > 500 ? `${entry.content.slice(0, 500)}...` : entry.content,
    }));

    const maxSignals = this.#options.maxContextSignals ?? 10;
    const compactStatus = {
      phase: status.phase,
      remainingTime: status.remainingTime,
      deadlineBufferHours: status.deadlineBufferHours,
      health: status.health,
      risk: {
        score: status.risk.score,
        severity: status.risk.severity,
        signals: status.risk.signals
          .slice(0, maxSignals)
          .map((sig) => (sig.length > 150 ? `${sig.slice(0, 150)}...` : sig)),
      },
      criticalPath: status.criticalPath.slice(0, 8),
      readyTaskCount: status.readyTaskIds.length,
      blockedTaskCount: status.blockedTaskIds.length,
      remainingEstimatedEffortHours: status.remainingEstimatedEffortHours,
      overallHealth: status.overallHealth,
    };

    const trustedContext = compressContext({
      project: {
        name: project.name,
        description: project.description ? project.description.slice(0, 1_000) : undefined,
        vision: project.vision ? project.vision.slice(0, 1_500) : undefined,
      },
      status: compactStatus,
      memory: selectedMemory,
    });
    try {
      const response = await this.#llm.generate({
        messages: [
          message("system", producerSystemPrompt(trustedContext)),
          message("user", question.slice(0, 4_000)),
        ],
        maxOutputTokens: this.#options.maxOutputTokens ?? 800,
        ...(this.#options.temperature !== undefined
          ? { temperature: this.#options.temperature }
          : {}),
      });
      this.#onLlm?.({
        operation: "producer_answer",
        provider: response.provider,
        model: response.model,
        finishReason: response.finishReason,
        usage: response.usage,
      });
      return { answer: responseText(response), provider: response.provider };
    } catch (error) {
      this.#onLlm?.({
        operation: "producer_answer",
        provider: isLlmError(error) ? (error.provider ?? "unknown") : "unknown",
        errorCategory: isLlmError(error) ? error.code : "unknown",
      });
      if (isLlmError(error) && error.code === "provider_not_configured") {
        throw new DirectorServiceError(
          503,
          "PROVIDER_NOT_CONFIGURED",
          "No AI provider is configured. Deterministic project tracking remains available.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  async addMemory(
    projectId: string,
    externalUserId: string,
    category: MemoryCategoryRecord,
    title: string,
    content: string,
    confidence = 1,
    now = new Date(),
  ) {
    const project = await this.#requireProject(projectId);
    await this.#requireManager(project, externalUserId);
    if (title.trim().length === 0 || content.trim().length === 0) {
      throw new DirectorServiceError(
        400,
        "INVALID_MEMORY",
        "Memory title and content are required.",
      );
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new DirectorServiceError(400, "INVALID_MEMORY", "Confidence must be between 0 and 1.");
    }
    const entry = {
      id: randomUUID(),
      projectId,
      category,
      title: title.trim(),
      content: content.trim(),
      confidence,
      createdAt: now,
    } as const;
    await this.#store.addMemoryEntry(entry);
    return entry;
  }

  async listMemory(
    projectId: string,
    externalUserId: string,
    categories?: readonly MemoryCategoryRecord[],
  ) {
    const project = await this.#requireProject(projectId);
    const member = await this.#store.getTeamMember(project.workspaceId, externalUserId);
    if (member === undefined)
      throw new DirectorServiceError(403, "FORBIDDEN", "You are not a member of this workspace.");
    return this.#store.listMemory(projectId, categories);
  }

  async #findTaskProject(taskId: string) {
    const task = await this.#store.getTask(taskId);
    if (task === undefined)
      throw new DirectorServiceError(404, "TASK_NOT_FOUND", "Task was not found.");
    const project = await this.#requireProject(task.projectId);
    return { project, tasks: await this.#store.listTasks(project.id) };
  }

  async #requireProject(projectId: string): Promise<ProjectRecord> {
    const project = await this.#store.getProject(projectId);
    if (project === undefined)
      throw new DirectorServiceError(404, "PROJECT_NOT_FOUND", "Project was not found.");
    return project;
  }

  async #requireProjectByGuild(discordGuildId: string): Promise<ProjectRecord> {
    const project = await this.#store.getProjectByGuild(discordGuildId);
    if (project === undefined) {
      throw new DirectorServiceError(404, "PROJECT_NOT_FOUND", "Run `/project setup` first.");
    }
    return project;
  }

  async #requireManager(project: ProjectRecord, externalUserId: string) {
    const member = await this.#store.getTeamMember(project.workspaceId, externalUserId);
    if (
      member === undefined ||
      !member.roles.some((role) =>
        ["OWNER", "PROJECT_OWNER", "PRODUCER"].includes(role.toUpperCase()),
      )
    ) {
      throw new DirectorServiceError(
        403,
        "FORBIDDEN",
        "This operation requires a project owner or producer role.",
      );
    }
    return member;
  }
}
