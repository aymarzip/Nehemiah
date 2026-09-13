import type {
  AssignmentRecord,
  BlockerRecord,
  DecisionRecord,
  MemoryCategoryRecord,
  MemoryEntryRecord,
  ProjectRecord,
  ProjectSettingsRecord,
  ProjectSetupInput,
  ProjectStore,
  RiskSnapshotRecord,
  GitHubActivityRecord,
  MilestoneRecord,
  TaskCreateInput,
  TaskEvidenceRecord,
  TaskRecord,
  TaskPlanCreateInput,
  TaskTransitionPersistenceInput,
  TeamMemberProfileInput,
  TeamMemberRecord,
  VisionRevisionRecord,
} from "./records.js";

export class PersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}

function cloneProject(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    deadline: new Date(project.deadline),
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    successCriteria: [...project.successCriteria],
    nonGoals: [...project.nonGoals],
    constraints: [...project.constraints],
    visionDetails: {
      ...project.visionDetails,
      mustHaveScope: [...project.visionDetails.mustHaveScope],
      shouldHaveScope: [...project.visionDetails.shouldHaveScope],
      niceToHaveScope: [...project.visionDetails.niceToHaveScope],
      excludedScope: [...project.visionDetails.excludedScope],
    },
  };
}

function cloneMember(member: TeamMemberRecord): TeamMemberRecord {
  return {
    ...member,
    roles: [...member.roles],
    skills: member.skills.map((skill) => ({ ...skill })),
    availability: { ...member.availability },
    communicationPreferences: { ...member.communicationPreferences },
    aiToolProfiles: member.aiToolProfiles.map((profile) => ({ ...profile })),
    createdAt: new Date(member.createdAt),
    updatedAt: new Date(member.updatedAt),
  };
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    dependencyIds: [...task.dependencyIds],
    verificationRequirements: [...(task.verificationRequirements ?? [])],
    suggestedEvidence: [...(task.suggestedEvidence ?? [])],
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    ...(task.dueAt === undefined ? {} : { dueAt: new Date(task.dueAt) }),
    ...(task.metadata === undefined ? {} : { metadata: { ...task.metadata } }),
  };
}

export class InMemoryProjectStore implements ProjectStore {
  readonly #projects = new Map<string, ProjectRecord>();
  readonly #guildProjects = new Map<string, string>();
  readonly #members = new Map<string, TeamMemberRecord>();
  readonly #tasks = new Map<string, TaskRecord>();
  readonly #milestones = new Map<string, MilestoneRecord[]>();
  readonly #evidence = new Map<string, TaskEvidenceRecord[]>();
  readonly #memory = new Map<string, MemoryEntryRecord[]>();
  readonly #visionRevisions = new Map<string, VisionRevisionRecord[]>();
  readonly #decisions = new Map<string, DecisionRecord[]>();
  readonly #blockers = new Map<string, BlockerRecord[]>();
  readonly #assignments = new Map<string, AssignmentRecord[]>();
  readonly #riskSnapshots = new Map<string, RiskSnapshotRecord[]>();
  readonly #settings = new Map<string, ProjectSettingsRecord>();
  readonly #githubRepositories = new Map<
    number,
    { projectId: string; installationId: number; fullName: string }
  >();
  readonly #githubActivity = new Map<string, GitHubActivityRecord[]>();
  readonly #githubLinks = new Set<string>();

  async setupProject(input: ProjectSetupInput): Promise<ProjectRecord> {
    if (this.#projects.has(input.projectId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Project ${input.projectId} already exists`);
    }
    if (input.discordGuildId !== undefined && this.#guildProjects.has(input.discordGuildId)) {
      throw new PersistenceError("ALREADY_EXISTS", "This Discord server already has a project");
    }
    const project: ProjectRecord = {
      id: input.projectId,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      name: input.name,
      description: input.description,
      vision: input.vision,
      visionDetails: {
        problem: input.visionDetails?.problem ?? "",
        targetOutcome: input.visionDetails?.targetOutcome ?? input.vision,
        coreExperience: input.visionDetails?.coreExperience ?? "",
        mustHaveScope: [...(input.visionDetails?.mustHaveScope ?? [])],
        shouldHaveScope: [...(input.visionDetails?.shouldHaveScope ?? [])],
        niceToHaveScope: [...(input.visionDetails?.niceToHaveScope ?? [])],
        excludedScope: [...(input.visionDetails?.excludedScope ?? input.nonGoals ?? [])],
      },
      successCriteria: [...(input.successCriteria ?? [])],
      nonGoals: [...(input.nonGoals ?? [])],
      deadline: new Date(input.deadline),
      timezone: input.timezone,
      mode: input.mode,
      status: "ACTIVE",
      constraints: [...(input.constraints ?? [])],
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
      ...(input.discordGuildId === undefined ? {} : { discordGuildId: input.discordGuildId }),
      ...(input.githubRepository === undefined ? {} : { githubRepository: input.githubRepository }),
    };
    const owner: TeamMemberRecord = {
      id: input.ownerMemberId,
      workspaceId: input.workspaceId,
      externalUserId: input.ownerExternalUserId,
      displayName: input.ownerDisplayName,
      roles: ["OWNER", "PRODUCER"],
      skills: [],
      availability: {},
      communicationPreferences: {},
      aiToolProfiles: [],
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    };
    this.#projects.set(project.id, project);
    if (project.discordGuildId !== undefined) {
      this.#guildProjects.set(project.discordGuildId, project.id);
    }
    this.#members.set(`${owner.workspaceId}:${owner.externalUserId}`, owner);
    return cloneProject(project);
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    const project = this.#projects.get(projectId);
    return project === undefined ? undefined : cloneProject(project);
  }

  async getProjectByGuild(discordGuildId: string): Promise<ProjectRecord | undefined> {
    const projectId = this.#guildProjects.get(discordGuildId);
    return projectId === undefined ? undefined : this.getProject(projectId);
  }

  async joinTeam(input: TeamMemberProfileInput): Promise<TeamMemberRecord> {
    const key = `${input.workspaceId}:${input.externalUserId}`;
    const current = this.#members.get(key);
    const member: TeamMemberRecord = {
      id: current?.id ?? input.id,
      workspaceId: input.workspaceId,
      externalUserId: input.externalUserId,
      displayName: input.displayName,
      roles: [...input.roles],
      skills: input.skills.map((skill) => ({ ...skill })),
      availability: { ...input.availability },
      communicationPreferences: { ...input.communicationPreferences },
      aiToolProfiles: input.aiToolProfiles.map((profile) => ({ ...profile })),
      createdAt: new Date(current?.createdAt ?? input.now),
      updatedAt: new Date(input.now),
    };
    this.#members.set(key, member);
    return cloneMember(member);
  }

  async createMilestone(milestone: MilestoneRecord): Promise<void> {
    if (!this.#projects.has(milestone.projectId))
      throw new PersistenceError("NOT_FOUND", "Project was not found");
    const milestones = this.#milestones.get(milestone.projectId) ?? [];
    if (milestones.some((entry) => entry.id === milestone.id))
      throw new PersistenceError("ALREADY_EXISTS", "Milestone already exists");
    milestones.push({
      ...milestone,
      dueAt: new Date(milestone.dueAt),
      createdAt: new Date(milestone.createdAt),
      completionCriteria: [...milestone.completionCriteria],
    });
    this.#milestones.set(milestone.projectId, milestones);
  }

  async listMilestones(projectId: string): Promise<readonly MilestoneRecord[]> {
    return (this.#milestones.get(projectId) ?? [])
      .map((entry) => ({
        ...entry,
        dueAt: new Date(entry.dueAt),
        createdAt: new Date(entry.createdAt),
        completionCriteria: [...entry.completionCriteria],
      }))
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
  }

  async getTeamMember(
    workspaceId: string,
    externalUserId: string,
  ): Promise<TeamMemberRecord | undefined> {
    const member = this.#members.get(`${workspaceId}:${externalUserId}`);
    return member === undefined ? undefined : cloneMember(member);
  }

  async createTask(input: TaskCreateInput): Promise<TaskRecord> {
    if (this.#tasks.has(input.id)) {
      throw new PersistenceError("ALREADY_EXISTS", `Task ${input.id} already exists`);
    }
    const project = this.#projects.get(input.projectId);
    if (project === undefined) {
      throw new PersistenceError("NOT_FOUND", `Project ${input.projectId} does not exist`);
    }
    if (input.ownerMemberId !== undefined) {
      const owner = [...this.#members.values()].find((member) => member.id === input.ownerMemberId);
      if (owner === undefined || owner.workspaceId !== project.workspaceId) {
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "Task owner must belong to the project's workspace",
        );
      }
    }
    if (input.milestoneId !== undefined) {
      const milestone = (this.#milestones.get(input.projectId) ?? []).find(
        (candidate) => candidate.id === input.milestoneId,
      );
      if (milestone === undefined) {
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "Task milestone must belong to the same project",
        );
      }
    }
    const task: TaskRecord = {
      id: input.id,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      expectedOutcome: input.expectedOutcome ?? input.description,
      riskLevel: input.riskLevel ?? input.impact,
      verificationRequirements: [...(input.verificationRequirements ?? [])],
      suggestedEvidence: [...(input.suggestedEvidence ?? [])],
      deadlineCriticality: input.deadlineCriticality ?? "IMPORTANT",
      scopeTier: input.scopeTier ?? "MUST",
      releaseRequired: input.releaseRequired ?? true,
      status: input.status ?? "PLANNED",
      impact: input.impact,
      weight: input.weight,
      estimatedEffortHours: input.estimatedEffortHours,
      dependencyIds: [],
      createdAt: new Date(input.now),
      updatedAt: new Date(input.now),
      ...(input.milestoneId === undefined ? {} : { milestoneId: input.milestoneId }),
      ...(input.ownerRole === undefined ? {} : { ownerRole: input.ownerRole }),
      ...(input.component === undefined ? {} : { component: input.component }),
      ...(input.ownerMemberId === undefined ? {} : { ownerMemberId: input.ownerMemberId }),
      ...(input.dueAt === undefined ? {} : { dueAt: new Date(input.dueAt) }),
      ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
    };
    this.#tasks.set(task.id, task);
    return cloneTask(task);
  }

  async createTaskPlan(input: TaskPlanCreateInput): Promise<readonly TaskRecord[]> {
    const project = this.#projects.get(input.projectId);
    if (project === undefined) throw new PersistenceError("NOT_FOUND", "Project was not found");
    const ids = new Set(input.tasks.map((task) => task.id));
    if (ids.size !== input.tasks.length || input.tasks.some((task) => this.#tasks.has(task.id))) {
      throw new PersistenceError("ALREADY_EXISTS", "Task plan contains a duplicate task id");
    }
    for (const task of input.tasks) {
      if (task.projectId !== input.projectId) {
        throw new PersistenceError("PROJECT_MISMATCH", "Task plan crosses a project boundary");
      }
      if (task.milestoneId !== undefined) {
        const milestone = (this.#milestones.get(input.projectId) ?? []).find(
          (candidate) => candidate.id === task.milestoneId,
        );
        if (milestone === undefined) {
          throw new PersistenceError(
            "PROJECT_MISMATCH",
            "Task milestone belongs to another project",
          );
        }
      }
      if (task.ownerMemberId !== undefined) {
        const owner = [...this.#members.values()].find(
          (member) => member.id === task.ownerMemberId,
        );
        if (owner?.workspaceId !== project.workspaceId) {
          throw new PersistenceError("PROJECT_MISMATCH", "Task owner belongs to another workspace");
        }
      }
    }
    const allProjectTaskIds = new Set([
      ...[...this.#tasks.values()]
        .filter((task) => task.projectId === input.projectId)
        .map((task) => task.id),
      ...ids,
    ]);
    const dependencyMap = new Map<string, string[]>();
    for (const task of this.#tasks.values()) dependencyMap.set(task.id, [...task.dependencyIds]);
    for (const edge of input.dependencies) {
      if (!allProjectTaskIds.has(edge.taskId) || !allProjectTaskIds.has(edge.dependsOnTaskId)) {
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "Task plan dependency is outside the project",
        );
      }
      const values = dependencyMap.get(edge.taskId) ?? [];
      values.push(edge.dependsOnTaskId);
      dependencyMap.set(edge.taskId, values);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (taskId: string): void => {
      if (visiting.has(taskId)) throw new PersistenceError("CYCLE", "Task plan contains a cycle");
      if (visited.has(taskId)) return;
      visiting.add(taskId);
      for (const dependencyId of dependencyMap.get(taskId) ?? []) visit(dependencyId);
      visiting.delete(taskId);
      visited.add(taskId);
    };
    for (const taskId of allProjectTaskIds) visit(taskId);
    const created: TaskRecord[] = [];
    for (const task of input.tasks) created.push(await this.createTask(task));
    for (const edge of input.dependencies) {
      const task = this.#tasks.get(edge.taskId)!;
      this.#tasks.set(edge.taskId, {
        ...task,
        dependencyIds: [...new Set([...task.dependencyIds, edge.dependsOnTaskId])],
      });
    }
    return created.map((task) => cloneTask(this.#tasks.get(task.id)!));
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const task = this.#tasks.get(taskId);
    return task === undefined ? undefined : cloneTask(task);
  }

  async addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    if (taskId === dependsOnTaskId) {
      throw new PersistenceError("CYCLE", "A task cannot depend on itself");
    }
    const task = this.#tasks.get(taskId);
    const dependency = this.#tasks.get(dependsOnTaskId);
    if (task === undefined || dependency === undefined) {
      throw new PersistenceError("NOT_FOUND", "Both dependency tasks must exist");
    }
    if (task.projectId !== dependency.projectId) {
      throw new PersistenceError("PROJECT_MISMATCH", "Dependencies must belong to one project");
    }
    if (task.status !== "PLANNED") {
      throw new PersistenceError(
        "CONFLICT",
        "Dependencies can only be changed while the dependant task is PLANNED",
      );
    }
    const visit = (candidateId: string, visited = new Set<string>()): boolean => {
      if (candidateId === taskId) return true;
      if (visited.has(candidateId)) return false;
      visited.add(candidateId);
      const candidate = this.#tasks.get(candidateId);
      return candidate?.dependencyIds.some((id) => visit(id, visited)) ?? false;
    };
    if (visit(dependsOnTaskId)) {
      throw new PersistenceError("CYCLE", "Task dependency would create a cycle");
    }
    if (!task.dependencyIds.includes(dependsOnTaskId)) {
      this.#tasks.set(taskId, { ...task, dependencyIds: [...task.dependencyIds, dependsOnTaskId] });
    }
  }

  async listTasks(projectId: string): Promise<readonly TaskRecord[]> {
    return [...this.#tasks.values()].filter((task) => task.projectId === projectId).map(cloneTask);
  }

  async listMemberTasks(projectId: string, memberId: string): Promise<readonly TaskRecord[]> {
    return [...this.#tasks.values()]
      .filter((task) => task.projectId === projectId && task.ownerMemberId === memberId)
      .map(cloneTask);
  }

  async addTaskEvidence(evidence: TaskEvidenceRecord): Promise<void> {
    if (!this.#tasks.has(evidence.taskId)) {
      throw new PersistenceError("NOT_FOUND", `Task ${evidence.taskId} does not exist`);
    }
    const entries = this.#evidence.get(evidence.taskId) ?? [];
    if (
      !entries.some(
        (entry) =>
          entry.id === evidence.id ||
          (evidence.externalId !== undefined &&
            entry.kind === evidence.kind &&
            entry.externalId === evidence.externalId),
      )
    )
      entries.push({
        ...evidence,
        ...(evidence.metadata === undefined ? {} : { metadata: { ...evidence.metadata } }),
      });
    this.#evidence.set(evidence.taskId, entries);
  }

  async applyTaskTransition(input: TaskTransitionPersistenceInput): Promise<TaskRecord> {
    const task = this.#tasks.get(input.taskId);
    if (task === undefined) {
      throw new PersistenceError("NOT_FOUND", `Task ${input.taskId} does not exist`);
    }
    if (
      task.status !== input.expectedStatus ||
      task.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new PersistenceError(
        "CONFLICT",
        "Task changed after its transition was validated; reload and retry",
      );
    }
    if (input.status === "READY" || input.status === "IN_PROGRESS") {
      const satisfied = task.dependencyIds.every((dependencyId) => {
        const status = this.#tasks.get(dependencyId)?.status;
        return status === "VERIFIED" || status === "INTEGRATED" || status === "SHIPPED";
      });
      if (!satisfied) {
        throw new PersistenceError("CONFLICT", "Task dependencies are no longer satisfied");
      }
    }
    for (const evidence of input.evidence ?? []) {
      if (evidence.taskId !== input.taskId) {
        throw new PersistenceError("PROJECT_MISMATCH", "Evidence belongs to another task");
      }
    }
    const metadata = { ...(task.metadata ?? {}) };
    if (input.status === "BLOCKED" && input.blockReason !== undefined) {
      metadata["blockReason"] = input.blockReason;
    } else {
      delete metadata["blockReason"];
    }
    const updated: TaskRecord = {
      ...task,
      status: input.status,
      metadata,
      updatedAt: new Date(input.now),
    };
    const entries = [...(this.#evidence.get(input.taskId) ?? [])];
    for (const evidence of input.evidence ?? []) {
      if (!entries.some((candidate) => candidate.id === evidence.id)) entries.push({ ...evidence });
    }
    this.#tasks.set(input.taskId, updated);
    this.#evidence.set(input.taskId, entries);
    return cloneTask(updated);
  }

  async listTaskEvidence(taskId: string): Promise<readonly TaskEvidenceRecord[]> {
    return (this.#evidence.get(taskId) ?? []).map((entry) => ({ ...entry }));
  }

  async listProjectTaskEvidence(projectId: string): Promise<readonly TaskEvidenceRecord[]> {
    const taskIds = new Set(
      [...this.#tasks.values()]
        .filter((task) => task.projectId === projectId)
        .map((task) => task.id),
    );
    return [...this.#evidence.entries()]
      .filter(([taskId]) => taskIds.has(taskId))
      .flatMap(([, entries]) => entries)
      .map((entry) => ({
        ...entry,
        createdAt: new Date(entry.createdAt),
        ...(entry.metadata === undefined ? {} : { metadata: { ...entry.metadata } }),
      }))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async addMemoryEntry(entry: MemoryEntryRecord): Promise<void> {
    const entries = this.#memory.get(entry.projectId) ?? [];
    if (!entries.some((candidate) => candidate.id === entry.id)) entries.push({ ...entry });
    this.#memory.set(entry.projectId, entries);
  }

  async listMemory(
    projectId: string,
    categories?: readonly MemoryCategoryRecord[],
    limit?: number,
  ): Promise<readonly MemoryEntryRecord[]> {
    const allowed = categories === undefined ? undefined : new Set(categories);
    const results = (this.#memory.get(projectId) ?? [])
      .filter((entry) => allowed === undefined || allowed.has(entry.category))
      .map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) }));
    return limit === undefined ? results : results.slice(0, limit);
  }

  async listTeamMembers(workspaceId: string): Promise<readonly TeamMemberRecord[]> {
    return [...this.#members.values()]
      .filter((member) => member.workspaceId === workspaceId)
      .map(cloneMember);
  }

  async updateCommunicationPreferences(
    workspaceId: string,
    externalUserId: string,
    preferences: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<TeamMemberRecord> {
    const key = `${workspaceId}:${externalUserId}`;
    const member = this.#members.get(key);
    if (member === undefined) throw new PersistenceError("NOT_FOUND", "Team member was not found");
    const updated = {
      ...member,
      communicationPreferences: { ...member.communicationPreferences, ...preferences },
      updatedAt: new Date(now),
    };
    this.#members.set(key, updated);
    return cloneMember(updated);
  }

  async addVisionRevision(revision: VisionRevisionRecord): Promise<void> {
    const project = this.#projects.get(revision.projectId);
    if (project === undefined) throw new PersistenceError("NOT_FOUND", "Project was not found");
    const author = [...this.#members.values()].find((member) => member.id === revision.proposedBy);
    if (author?.workspaceId !== project.workspaceId) {
      throw new PersistenceError("PROJECT_MISMATCH", "Vision author belongs to another workspace");
    }
    const revisions = this.#visionRevisions.get(revision.projectId) ?? [];
    if (!revisions.some((entry) => entry.id === revision.id)) revisions.push({ ...revision });
    this.#visionRevisions.set(revision.projectId, revisions);
  }

  async listVisionRevisions(projectId: string): Promise<readonly VisionRevisionRecord[]> {
    return (this.#visionRevisions.get(projectId) ?? [])
      .map((revision) => ({
        ...revision,
        mustHaveScope: [...revision.mustHaveScope],
        shouldHaveScope: [...revision.shouldHaveScope],
        niceToHaveScope: [...revision.niceToHaveScope],
        excludedScope: [...revision.excludedScope],
        constraints: [...revision.constraints],
        successCriteria: [...revision.successCriteria],
        createdAt: new Date(revision.createdAt),
        ...(revision.approvedAt === undefined ? {} : { approvedAt: new Date(revision.approvedAt) }),
      }))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async approveVisionRevision(
    revisionId: string,
    approvedBy: string,
    decision: DecisionRecord,
    now: Date,
  ): Promise<VisionRevisionRecord> {
    const located = [...this.#visionRevisions.entries()].find(([, entries]) =>
      entries.some((entry) => entry.id === revisionId),
    );
    if (located === undefined)
      throw new PersistenceError("NOT_FOUND", "Vision revision was not found");
    const [projectId, entries] = located;
    const index = entries.findIndex((entry) => entry.id === revisionId);
    const revision = entries[index]!;
    if (revision.status !== "PROPOSED")
      throw new PersistenceError("CONFLICT", "Vision revision is already resolved");
    const project = this.#projects.get(projectId)!;
    const approver = [...this.#members.values()].find((member) => member.id === approvedBy);
    if (approver?.workspaceId !== project.workspaceId) {
      throw new PersistenceError(
        "PROJECT_MISMATCH",
        "Vision approver belongs to another workspace",
      );
    }
    const approved: VisionRevisionRecord = {
      ...revision,
      status: "APPROVED",
      approvedBy,
      approvedAt: new Date(now),
      decisionId: decision.id,
    };
    entries[index] = approved;
    this.#projects.set(projectId, {
      ...project,
      vision: approved.statement,
      visionDetails: {
        problem: approved.problem,
        targetOutcome: approved.targetOutcome,
        coreExperience: approved.coreExperience,
        mustHaveScope: [...approved.mustHaveScope],
        shouldHaveScope: [...approved.shouldHaveScope],
        niceToHaveScope: [...approved.niceToHaveScope],
        excludedScope: [...approved.excludedScope],
      },
      successCriteria: [...approved.successCriteria],
      constraints: [...approved.constraints],
      nonGoals: [...approved.excludedScope],
      updatedAt: new Date(now),
    });
    await this.addDecision(decision);
    return (await this.listVisionRevisions(projectId)).find((entry) => entry.id === revisionId)!;
  }

  async addDecision(decision: DecisionRecord): Promise<void> {
    if (!this.#projects.has(decision.projectId))
      throw new PersistenceError("NOT_FOUND", "Project was not found");
    const decisions = this.#decisions.get(decision.projectId) ?? [];
    if (decisions.some((entry) => entry.id === decision.id)) {
      throw new PersistenceError("ALREADY_EXISTS", "Decision already exists");
    }
    if (decision.supersedesDecisionId !== undefined) {
      const index = decisions.findIndex((entry) => entry.id === decision.supersedesDecisionId);
      if (index < 0) throw new PersistenceError("NOT_FOUND", "Superseded decision was not found");
      if (decision.status === "ACCEPTED")
        decisions[index] = {
          ...decisions[index]!,
          status: "SUPERSEDED",
          supersededByDecisionId: decision.id,
        };
    }
    decisions.push({ ...decision });
    this.#decisions.set(decision.projectId, decisions);
  }

  async getDecision(projectId: string, decisionId: string): Promise<DecisionRecord | undefined> {
    const candidate = (this.#decisions.get(projectId) ?? []).find(
      (entry) => entry.id === decisionId,
    );
    return candidate === undefined
      ? undefined
      : { ...candidate, createdAt: new Date(candidate.createdAt) };
  }

  async listDecisions(projectId: string, limit = 20): Promise<readonly DecisionRecord[]> {
    return (this.#decisions.get(projectId) ?? [])
      .map((decision) => ({ ...decision, createdAt: new Date(decision.createdAt) }))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);
  }

  async approveDecision(
    decisionId: string,
    approvedBy: string,
    now: Date,
  ): Promise<DecisionRecord> {
    const located = [...this.#decisions.entries()].find(([, entries]) =>
      entries.some((entry) => entry.id === decisionId),
    );
    if (located === undefined) throw new PersistenceError("NOT_FOUND", "Decision was not found");
    const [projectId, entries] = located;
    const index = entries.findIndex((entry) => entry.id === decisionId);
    const current = entries[index]!;
    if (current.status !== "PROPOSED")
      throw new PersistenceError("CONFLICT", "Decision is already resolved");
    const previousIndex =
      current.supersedesDecisionId === undefined
        ? -1
        : entries.findIndex((entry) => entry.id === current.supersedesDecisionId);
    if (current.supersedesDecisionId !== undefined && previousIndex < 0) {
      throw new PersistenceError("NOT_FOUND", "Superseded decision was not found");
    }
    const approved: DecisionRecord = {
      ...current,
      status: "ACCEPTED",
      approvedByMemberId: approvedBy,
      approvedAt: new Date(now),
    };
    entries[index] = approved;
    if (previousIndex >= 0) {
      entries[previousIndex] = {
        ...entries[previousIndex]!,
        status: "SUPERSEDED",
        supersededByDecisionId: approved.id,
      };
    }
    this.#decisions.set(projectId, entries);
    return { ...approved };
  }

  async addBlocker(blocker: BlockerRecord): Promise<void> {
    const project = this.#projects.get(blocker.projectId);
    if (project === undefined) throw new PersistenceError("NOT_FOUND", "Project was not found");
    for (const taskId of [blocker.blockedTaskId, blocker.blockingTaskId]) {
      if (taskId !== undefined && this.#tasks.get(taskId)?.projectId !== blocker.projectId) {
        throw new PersistenceError("PROJECT_MISMATCH", "Blocker tasks must belong to the project");
      }
    }
    for (const memberId of [blocker.blockedMemberId, blocker.createdBy, blocker.resolvedBy]) {
      if (
        memberId !== undefined &&
        ![...this.#members.values()].some(
          (member) => member.id === memberId && member.workspaceId === project.workspaceId,
        )
      ) {
        throw new PersistenceError(
          "PROJECT_MISMATCH",
          "Blocker members must belong to the project workspace",
        );
      }
    }
    const blockers = this.#blockers.get(blocker.projectId) ?? [];
    if (!blockers.some((entry) => entry.id === blocker.id)) blockers.push({ ...blocker });
    this.#blockers.set(blocker.projectId, blockers);
  }

  async listBlockers(
    projectId: string,
    includeResolved = false,
  ): Promise<readonly BlockerRecord[]> {
    return (this.#blockers.get(projectId) ?? [])
      .filter((blocker) => includeResolved || blocker.resolvedAt === undefined)
      .map((blocker) => ({ ...blocker, createdAt: new Date(blocker.createdAt) }));
  }

  async resolveBlocker(blockerId: string, resolvedBy: string, now: Date): Promise<BlockerRecord> {
    const located = [...this.#blockers.entries()].find(([, entries]) =>
      entries.some((entry) => entry.id === blockerId),
    );
    if (located === undefined) throw new PersistenceError("NOT_FOUND", "Blocker was not found");
    const [, entries] = located;
    const index = entries.findIndex((entry) => entry.id === blockerId);
    const resolved = { ...entries[index]!, resolvedBy, resolvedAt: new Date(now) };
    entries[index] = resolved;
    return { ...resolved };
  }

  async assignTask(assignment: AssignmentRecord, now: Date): Promise<TaskRecord> {
    const task = this.#tasks.get(assignment.taskId);
    const member = [...this.#members.values()].find((entry) => entry.id === assignment.memberId);
    const project = this.#projects.get(assignment.projectId);
    if (task === undefined || member === undefined || project === undefined) {
      throw new PersistenceError("NOT_FOUND", "Task, member or project was not found");
    }
    if (task.projectId !== assignment.projectId || member.workspaceId !== project.workspaceId) {
      throw new PersistenceError("PROJECT_MISMATCH", "Assignment crosses a project boundary");
    }
    const updated = { ...task, ownerMemberId: member.id, updatedAt: new Date(now) };
    this.#tasks.set(task.id, updated);
    const assignments = this.#assignments.get(assignment.projectId) ?? [];
    assignments.push({ ...assignment });
    this.#assignments.set(assignment.projectId, assignments);
    return cloneTask(updated);
  }

  async listAssignments(projectId: string, taskId?: string): Promise<readonly AssignmentRecord[]> {
    return (this.#assignments.get(projectId) ?? [])
      .filter((assignment) => taskId === undefined || assignment.taskId === taskId)
      .map((assignment) => ({
        ...assignment,
        reasons: [...assignment.reasons],
        createdAt: new Date(assignment.createdAt),
      }));
  }

  async addRiskSnapshot(snapshot: RiskSnapshotRecord): Promise<void> {
    const snapshots = this.#riskSnapshots.get(snapshot.projectId) ?? [];
    if (!snapshots.some((entry) => entry.id === snapshot.id)) snapshots.push({ ...snapshot });
    this.#riskSnapshots.set(snapshot.projectId, snapshots);
  }

  async listRiskSnapshots(projectId: string, limit = 20): Promise<readonly RiskSnapshotRecord[]> {
    return (this.#riskSnapshots.get(projectId) ?? [])
      .map((snapshot) => ({ ...snapshot, capturedAt: new Date(snapshot.capturedAt) }))
      .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())
      .slice(0, limit);
  }

  async getProjectSettings(projectId: string): Promise<ProjectSettingsRecord> {
    if (!this.#projects.has(projectId))
      throw new PersistenceError("NOT_FOUND", "Project was not found");
    return (
      this.#settings.get(projectId) ?? {
        projectId,
        checkpointCadenceHours: 24,
        notificationPolicy: "BATCHED",
        baselineTaskIds: [],
      }
    );
  }

  async saveProjectSettings(settings: ProjectSettingsRecord): Promise<void> {
    if (!this.#projects.has(settings.projectId))
      throw new PersistenceError("NOT_FOUND", "Project was not found");
    this.#settings.set(settings.projectId, {
      ...settings,
      baselineTaskIds: [...settings.baselineTaskIds],
    });
  }

  async readiness(): Promise<boolean> {
    return true;
  }

  async connectGitHubRepository(
    projectId: string,
    installationId: number,
    repositoryId: number,
    repositoryFullName: string,
  ): Promise<void> {
    const project = this.#projects.get(projectId);
    if (project === undefined) throw new PersistenceError("NOT_FOUND", "Project was not found");
    if (
      project.githubRepository === undefined ||
      project.githubRepository.toLocaleLowerCase() !== repositoryFullName.toLocaleLowerCase()
    ) {
      throw new PersistenceError(
        "PROJECT_MISMATCH",
        "Repository does not match the project configuration",
      );
    }
    const existing = this.#githubRepositories.get(repositoryId);
    if (existing !== undefined && existing.projectId !== projectId)
      throw new PersistenceError(
        "ALREADY_EXISTS",
        "Repository is already connected to another project",
      );
    this.#githubRepositories.set(repositoryId, {
      projectId,
      installationId,
      fullName: repositoryFullName,
    });
  }

  async addGitHubActivity(activity: GitHubActivityRecord): Promise<void> {
    if (!this.#projects.has(activity.projectId))
      throw new PersistenceError("NOT_FOUND", "Project was not found");
    if (
      activity.taskId !== undefined &&
      this.#tasks.get(activity.taskId)?.projectId !== activity.projectId
    )
      throw new PersistenceError(
        "PROJECT_MISMATCH",
        "GitHub activity task belongs to another project",
      );
    const entries = this.#githubActivity.get(activity.projectId) ?? [];
    const index = entries.findIndex(
      (entry) => entry.kind === activity.kind && entry.externalId === activity.externalId,
    );
    const clone = {
      ...activity,
      changedFiles: [...activity.changedFiles],
      metadata: { ...activity.metadata },
      occurredAt: new Date(activity.occurredAt),
    };
    if (index < 0) entries.push(clone);
    else if (entries[index]!.occurredAt <= activity.occurredAt) entries[index] = clone;
    this.#githubActivity.set(activity.projectId, entries);
  }

  async listGitHubActivity(
    projectId: string,
    limit = 100,
  ): Promise<readonly GitHubActivityRecord[]> {
    return (this.#githubActivity.get(projectId) ?? [])
      .map((entry) => ({
        ...entry,
        changedFiles: [...entry.changedFiles],
        metadata: { ...entry.metadata },
        occurredAt: new Date(entry.occurredAt),
      }))
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(0, limit);
  }

  async linkTaskToGitHub(
    projectId: string,
    taskId: string,
    repositoryId: number,
    linkKind: "BRANCH" | "PULL_REQUEST" | "ISSUE",
    externalId: string,
  ): Promise<void> {
    if (this.#tasks.get(taskId)?.projectId !== projectId)
      throw new PersistenceError("PROJECT_MISMATCH", "Task belongs to another project");
    if (this.#githubRepositories.get(repositoryId)?.projectId !== projectId)
      throw new PersistenceError("PROJECT_MISMATCH", "Repository is not connected to this project");
    this.#githubLinks.add(`${taskId}:${repositoryId}:${linkKind}:${externalId}`);
  }

  async close(): Promise<void> {}
}
