export interface ProjectSetupRequest {
  readonly discordGuildId: string;
  readonly ownerExternalUserId: string;
  readonly ownerDisplayName: string;
  readonly name: string;
  readonly description: string;
  readonly vision: string;
  readonly deadline: string;
  readonly timezone: string;
  readonly mode: "STANDARD" | "GAME_JAM";
  readonly githubRepository?: string;
  readonly constraints: readonly string[];
}

export interface ProjectStatusView {
  readonly projectId: string;
  readonly name: string;
  readonly phase: string;
  readonly remainingTime: string;
  readonly deadlineBufferHours: number;
  readonly health: {
    readonly implementation: number;
    readonly integration: number;
    readonly verification: number;
    readonly releaseReadiness: number;
  };
  readonly risk: {
    readonly score: number;
    readonly severity: string;
    readonly signals: readonly string[];
  };
  readonly criticalPath: readonly string[];
}

export interface TeamJoinRequest {
  readonly discordGuildId: string;
  readonly externalUserId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly skills: readonly { readonly name: string; readonly level: number }[];
  readonly hoursPerWeek: number;
  readonly timezone: string;
  readonly aiTools: readonly string[];
}

export interface TaskView {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly impact: string;
  readonly dueAt?: string;
}

export interface ProducerAnswer {
  readonly answer: string;
  readonly provider: string;
}

export interface WhatNowView {
  readonly phase: string;
  readonly message?: string;
  readonly recommendation?: {
    readonly taskId: string;
    readonly title: string;
    readonly priority: string;
    readonly expectedResult: string;
    readonly reasons: readonly string[];
    readonly avoidForNow: readonly string[];
    readonly confidence: number;
  };
}

export interface MissionControlView {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly deadline: string;
    readonly phase: string;
  };
  readonly health: {
    readonly overallScore: number;
    readonly dimensions: Readonly<Record<string, { readonly score: number }>>;
  };
  readonly integrationProgress: number;
  readonly release: {
    readonly score: number;
    readonly ready: boolean;
    readonly blockers: readonly string[];
  };
  readonly criticalPath: readonly string[];
  readonly blockers: readonly {
    readonly explanation: string;
    readonly blocker: { readonly description: string; readonly severity: string };
  }[];
  readonly risks: {
    readonly overallScore: number;
    readonly severity: string;
    readonly signals: readonly { readonly active: boolean; readonly title: string }[];
  };
  readonly nextCheckpointAt: string;
  readonly missionControlLocation?: { readonly channelId: string; readonly messageId: string };
}

export interface BlockerView {
  readonly id: string;
  readonly description: string;
  readonly severity: string;
  readonly suggestedResolution: string;
  readonly priority?: { readonly explanation: string };
}

export interface DiscordDirectorApi {
  setupProject(request: ProjectSetupRequest): Promise<{ readonly projectId: string }>;
  bootstrapDemo(
    discordGuildId: string,
    ownerExternalUserId: string,
    ownerDisplayName: string,
  ): Promise<{
    readonly projectId: string;
    readonly reused: boolean;
    readonly walkthrough: readonly string[];
  }>;
  projectStatus(discordGuildId: string): Promise<ProjectStatusView>;
  joinTeam(request: TeamJoinRequest): Promise<{ readonly memberId: string }>;
  currentTasks(discordGuildId: string, externalUserId: string): Promise<readonly TaskView[]>;
  updateTask(
    taskId: string,
    externalUserId: string,
    status: string,
    evidence?: string,
  ): Promise<TaskView>;
  askProducer(
    discordGuildId: string,
    externalUserId: string,
    question: string,
  ): Promise<ProducerAnswer>;
  whatNow(discordGuildId: string, externalUserId: string): Promise<WhatNowView>;
  why(
    discordGuildId: string,
    externalUserId: string,
    taskId?: string,
  ): Promise<{
    readonly known: boolean;
    readonly reasons: readonly string[];
    readonly confidence?: number;
  }>;
  missionControl(discordGuildId: string, externalUserId: string): Promise<MissionControlView>;
  saveMissionControl(
    discordGuildId: string,
    externalUserId: string,
    channelId: string,
    messageId: string,
  ): Promise<unknown>;
  recentDecisions(
    discordGuildId: string,
    externalUserId: string,
  ): Promise<
    readonly {
      readonly title: string;
      readonly status: string;
      readonly rationale: string;
      readonly createdAt: string;
    }[]
  >;
  cutScope(
    discordGuildId: string,
    externalUserId: string,
  ): Promise<{
    readonly candidates: readonly {
      readonly title: string;
      readonly expectedTimeSavedHours: number;
      readonly riskReduction: string;
      readonly productImpact: string;
      readonly confidence: number;
    }[];
  }>;
  updatePreferences(
    discordGuildId: string,
    externalUserId: string,
    preferences: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  addBlocker(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly description: string;
      readonly severity: string;
      readonly blockedTaskId?: string | undefined;
      readonly suggestedResolution?: string | undefined;
    },
  ): Promise<BlockerView>;
  listBlockers(discordGuildId: string, externalUserId: string): Promise<readonly BlockerView[]>;
  resolveBlocker(
    discordGuildId: string,
    externalUserId: string,
    blockerId: string,
  ): Promise<BlockerView>;
  goalStatus(discordGuildId: string, externalUserId: string): Promise<GoalStatusView>;
  updateGoal(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly statement?: string | undefined;
      readonly targetOutcome?: string | undefined;
      readonly successCriteria?: readonly string[] | undefined;
    },
  ): Promise<GoalStatusView>;
  browserRepo(discordGuildId: string, externalUserId: string): Promise<BrowserRepoView>;
  browserDoc(discordGuildId: string, externalUserId: string, url: string): Promise<BrowserDocView>;
  browserSearch(
    discordGuildId: string,
    externalUserId: string,
    query: string,
  ): Promise<BrowserSearchView>;
  grillStart(
    discordGuildId: string,
    externalUserId: string,
    topic: string,
    taskId?: string,
  ): Promise<GrillQuestionnaireView>;
  grillAnswer(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly topic: string;
      readonly answers: readonly {
        readonly question: string;
        readonly selectedOptionKey: string;
        readonly notes?: string | undefined;
      }[];
      readonly taskId?: string | undefined;
      readonly saveAsDecision?: boolean | undefined;
    },
  ): Promise<GrillAnswerResultView>;
  teamworkPreview(discordGuildId: string, externalUserId: string): Promise<TeamworkPreviewView>;
  learningInsights(discordGuildId: string, externalUserId: string): Promise<LearningInsightsView>;
  learningRecord(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly title: string;
      readonly lesson: string;
      readonly taskId?: string | undefined;
    },
  ): Promise<LearningRecordResultView>;
  boostTask(discordGuildId: string, externalUserId: string, taskId: string): Promise<BoostTaskView>;
  boostUnblock(discordGuildId: string, externalUserId: string): Promise<BoostUnblockView>;
  boostSuggest(discordGuildId: string, externalUserId: string): Promise<BoostSuggestView>;
}

export interface GoalStatusView {
  readonly projectId: string;
  readonly name: string;
  readonly progress: {
    readonly goalStatement: string;
    readonly statement?: string | undefined;
    readonly totalTasks: number;
    readonly completedTasks: number;
    readonly percentage: number;
    readonly overallProgressPercent?: number | undefined;
    readonly mustHaveTasks: number;
    readonly mustHaveTotal?: number | undefined;
    readonly completedMustHaveTasks: number;
    readonly mustHaveCompleted?: number | undefined;
    readonly mustHavePercentage: number;
    readonly mustHaveProgressPercent?: number | undefined;
    readonly targetDate?: string | undefined;
    readonly primaryMilestone?: string | undefined;
    readonly scopeCeiling?: string | undefined;
    readonly unalignedTasks?:
      | readonly {
          readonly id: string;
          readonly title: string;
          readonly reason: string;
        }[]
      | undefined;
    readonly unalignedTaskIds?: readonly string[] | undefined;
  };
}

export interface BrowserRepoView {
  readonly projectId: string;
  readonly githubRepository: string | null;
  readonly activities: readonly {
    readonly kind: string;
    readonly externalId: string;
    readonly branch: string | null;
    readonly url: string | null;
    readonly occurredAt: string;
  }[];
}

export interface BrowserDocView {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly headings: readonly string[];
  readonly links: readonly string[];
  readonly fetchedAt: string;
}

export interface BrowserSearchView {
  readonly query: string;
  readonly results: readonly {
    readonly sourceKind: string;
    readonly title: string;
    readonly snippet: string;
    readonly score: number;
    readonly date: string;
  }[];
}

export interface GrillQuestionnaireView {
  readonly topic: string;
  readonly taskId?: string | undefined;
  readonly questions: readonly {
    readonly pillar: string;
    readonly question: string;
    readonly tradeoff: string;
    readonly options: readonly {
      readonly key: string;
      readonly label: string;
      readonly pros: string;
      readonly cons: string;
    }[];
    readonly recommendedOptionKey: string;
  }[];
}

export interface GrillAnswerResultView {
  readonly draft: {
    readonly title: string;
    readonly description: string;
    readonly outcome: string;
    readonly context: string;
    readonly rationale: string;
    readonly alternatives: readonly string[];
    readonly type: string;
  };
  readonly decisionId?: string | undefined;
}

export interface TeamworkPreviewView {
  readonly totalMembers: number;
  readonly overloadedMembersCount: number;
  readonly members: readonly {
    readonly memberId: string;
    readonly displayName: string;
    readonly roles: readonly string[];
    readonly assignedTasksCount: number;
    readonly activeTasksCount: number;
    readonly estimatedHoursRemaining: number;
    readonly hoursPerWeek: number;
    readonly workloadRatio: number;
    readonly loadCategory: "BALANCED" | "OVERLOADED" | "AVAILABLE";
    readonly blockedTasksCount: number;
    readonly aiTools: readonly string[];
  }[];
  readonly handoffs: readonly {
    readonly waitingMemberId: string;
    readonly waitingMemberName: string;
    readonly blockedTaskId: string;
    readonly blockedTaskTitle: string;
    readonly blockingMemberId: string;
    readonly blockingMemberName: string;
    readonly dependencyTaskId: string;
    readonly dependencyTaskTitle: string;
  }[];
  readonly bottleneckMemberIds: readonly string[];
}

export interface LearningInsightsView {
  readonly completedTasksCount: number;
  readonly resolvedBlockersCount: number;
  readonly averageEffortHours: number;
  readonly primaryBlockerSource: string;
  readonly insights: readonly {
    readonly category: string;
    readonly title: string;
    readonly observation: string;
    readonly recommendation: string;
  }[];
}

export interface LearningRecordResultView {
  readonly id: string;
  readonly title: string;
  readonly lesson: string;
}

export interface BoostTaskView {
  readonly taskId: string;
  readonly title: string;
  readonly executionBlueprint?: readonly string[] | undefined;
  readonly executionSteps?: readonly string[] | undefined;
  readonly verificationChecklist: readonly string[];
  readonly aiPromptTemplate: string;
}

export type BoostUnblockView = readonly {
  readonly blockerId: string;
  readonly description: string;
  readonly severity: string;
  readonly action?: string | undefined;
  readonly rationale?: string | undefined;
  readonly tacticalSteps?: readonly string[] | undefined;
  readonly estimatedTimeSavedHours?: number | undefined;
}[];

export type BoostSuggestView = readonly {
  readonly title?: string | undefined;
  readonly category?: string | undefined;
  readonly type?: string | undefined;
  readonly details?: string | undefined;
  readonly description?: string | undefined;
  readonly estimatedHoursSaved?: number | undefined;
  readonly affectedTaskIds?: readonly string[] | undefined;
}[];

export class DirectorApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "DirectorApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseResponse<Value>(response: Response): Promise<Value> {
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const value =
      typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    throw new DirectorApiError(
      response.status,
      typeof value["message"] === "string" ? value["message"] : "Nehemiah API request failed",
      typeof value["code"] === "string" ? value["code"] : undefined,
    );
  }
  return payload as Value;
}

export interface HttpDirectorApiClientOptions {
  readonly baseUrl: string;
  readonly internalToken?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class HttpDirectorApiClient implements DiscordDirectorApi {
  readonly #baseUrl: string;
  readonly #internalToken: string | undefined;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: HttpDirectorApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.#internalToken = options.internalToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async #request<Value>(path: string, init: RequestInit = {}): Promise<Value> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (this.#internalToken !== undefined)
      headers.set("x-nehemiah-internal-token", this.#internalToken);
    return parseResponse<Value>(await this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers }));
  }

  setupProject(request: ProjectSetupRequest): Promise<{ readonly projectId: string }> {
    return this.#request("/v1/projects/setup", { method: "POST", body: JSON.stringify(request) });
  }

  bootstrapDemo(
    discordGuildId: string,
    ownerExternalUserId: string,
    ownerDisplayName: string,
  ): Promise<{
    readonly projectId: string;
    readonly reused: boolean;
    readonly walkthrough: readonly string[];
  }> {
    return this.#request("/v1/demo/bootstrap", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, ownerExternalUserId, ownerDisplayName }),
    });
  }

  projectStatus(discordGuildId: string): Promise<ProjectStatusView> {
    return this.#request(`/v1/projects/by-guild/${encodeURIComponent(discordGuildId)}/status`);
  }

  joinTeam(request: TeamJoinRequest): Promise<{ readonly memberId: string }> {
    return this.#request("/v1/team/join", { method: "POST", body: JSON.stringify(request) });
  }

  currentTasks(discordGuildId: string, externalUserId: string): Promise<readonly TaskView[]> {
    const query = new URLSearchParams({ discordGuildId, externalUserId });
    return this.#request(`/v1/tasks/mine?${query.toString()}`);
  }

  updateTask(
    taskId: string,
    externalUserId: string,
    status: string,
    evidence?: string,
  ): Promise<TaskView> {
    return this.#request(`/v1/tasks/${encodeURIComponent(taskId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        externalUserId,
        status,
        ...(evidence === undefined ? {} : { evidence }),
      }),
    });
  }

  askProducer(
    discordGuildId: string,
    externalUserId: string,
    question: string,
  ): Promise<ProducerAnswer> {
    return this.#request("/v1/producer/ask", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId, question }),
    });
  }

  whatNow(discordGuildId: string, externalUserId: string): Promise<WhatNowView> {
    return this.#request("/v1/producer/what-now", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId }),
    });
  }

  why(
    discordGuildId: string,
    externalUserId: string,
    taskId?: string,
  ): Promise<{
    readonly known: boolean;
    readonly reasons: readonly string[];
    readonly confidence?: number;
  }> {
    return this.#request("/v1/producer/why", {
      method: "POST",
      body: JSON.stringify({
        discordGuildId,
        externalUserId,
        ...(taskId === undefined ? {} : { taskId }),
      }),
    });
  }

  missionControl(discordGuildId: string, externalUserId: string): Promise<MissionControlView> {
    return this.#request("/v1/projects/mission-control", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId }),
    });
  }

  async saveMissionControl(
    discordGuildId: string,
    externalUserId: string,
    channelId: string,
    messageId: string,
  ): Promise<unknown> {
    const project = await this.projectStatus(discordGuildId);
    return this.#request(`/v1/projects/${encodeURIComponent(project.projectId)}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        externalUserId,
        missionControlChannelId: channelId,
        missionControlMessageId: messageId,
      }),
    });
  }

  async recentDecisions(
    discordGuildId: string,
    externalUserId: string,
  ): Promise<
    readonly {
      readonly title: string;
      readonly status: string;
      readonly rationale: string;
      readonly createdAt: string;
    }[]
  > {
    const project = await this.projectStatus(discordGuildId);
    const query = new URLSearchParams({ externalUserId, limit: "10" });
    return this.#request(
      `/v1/projects/${encodeURIComponent(project.projectId)}/decisions?${query.toString()}`,
    );
  }

  async cutScope(
    discordGuildId: string,
    externalUserId: string,
  ): Promise<{
    readonly candidates: readonly {
      readonly title: string;
      readonly expectedTimeSavedHours: number;
      readonly riskReduction: string;
      readonly productImpact: string;
      readonly confidence: number;
    }[];
  }> {
    const project = await this.projectStatus(discordGuildId);
    return this.#request(
      `/v1/projects/${encodeURIComponent(project.projectId)}/scope/cut-recommendations`,
      {
        method: "POST",
        body: JSON.stringify({ externalUserId }),
      },
    );
  }

  updatePreferences(
    discordGuildId: string,
    externalUserId: string,
    preferences: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.#request("/v1/team/preferences", {
      method: "PUT",
      body: JSON.stringify({ discordGuildId, externalUserId, ...preferences }),
    });
  }

  async addBlocker(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly description: string;
      readonly severity: string;
      readonly blockedTaskId?: string;
      readonly suggestedResolution?: string;
    },
  ): Promise<BlockerView> {
    const project = await this.projectStatus(discordGuildId);
    return this.#request(`/v1/projects/${encodeURIComponent(project.projectId)}/blockers`, {
      method: "POST",
      body: JSON.stringify({ externalUserId, source: "HUMAN", ...input }),
    });
  }

  async listBlockers(
    discordGuildId: string,
    externalUserId: string,
  ): Promise<readonly BlockerView[]> {
    const project = await this.projectStatus(discordGuildId);
    const query = new URLSearchParams({ externalUserId });
    return this.#request(
      `/v1/projects/${encodeURIComponent(project.projectId)}/blockers?${query.toString()}`,
    );
  }

  async resolveBlocker(
    discordGuildId: string,
    externalUserId: string,
    blockerId: string,
  ): Promise<BlockerView> {
    const project = await this.projectStatus(discordGuildId);
    return this.#request(
      `/v1/projects/${encodeURIComponent(project.projectId)}/blockers/${encodeURIComponent(blockerId)}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ externalUserId }),
      },
    );
  }

  goalStatus(discordGuildId: string, externalUserId: string): Promise<GoalStatusView> {
    const query = new URLSearchParams({ discordGuildId, externalUserId });
    return this.#request(`/v1/goal?${query.toString()}`);
  }

  updateGoal(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly statement?: string | undefined;
      readonly targetOutcome?: string | undefined;
      readonly successCriteria?: readonly string[] | undefined;
    },
  ): Promise<GoalStatusView> {
    return this.#request("/v1/goal", {
      method: "PUT",
      body: JSON.stringify({ discordGuildId, externalUserId, ...input }),
    });
  }

  browserRepo(discordGuildId: string, externalUserId: string): Promise<BrowserRepoView> {
    const query = new URLSearchParams({ discordGuildId, externalUserId });
    return this.#request(`/v1/browser/repo?${query.toString()}`);
  }

  browserDoc(discordGuildId: string, externalUserId: string, url: string): Promise<BrowserDocView> {
    return this.#request("/v1/browser/doc", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId, url }),
    });
  }

  browserSearch(
    discordGuildId: string,
    externalUserId: string,
    query: string,
  ): Promise<BrowserSearchView> {
    const params = new URLSearchParams({ discordGuildId, externalUserId, query });
    return this.#request(`/v1/browser/search?${params.toString()}`);
  }

  grillStart(
    discordGuildId: string,
    externalUserId: string,
    topic: string,
    taskId?: string,
  ): Promise<GrillQuestionnaireView> {
    return this.#request("/v1/grill-me/start", {
      method: "POST",
      body: JSON.stringify({
        discordGuildId,
        externalUserId,
        topic,
        ...(taskId === undefined ? {} : { taskId }),
      }),
    });
  }

  grillAnswer(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly topic: string;
      readonly answers: readonly {
        readonly question: string;
        readonly selectedOptionKey: string;
        readonly notes?: string | undefined;
      }[];
      readonly taskId?: string | undefined;
      readonly saveAsDecision?: boolean | undefined;
    },
  ): Promise<GrillAnswerResultView> {
    return this.#request("/v1/grill-me/answer", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId, ...input }),
    });
  }

  teamworkPreview(discordGuildId: string, externalUserId: string): Promise<TeamworkPreviewView> {
    const query = new URLSearchParams({ discordGuildId, externalUserId });
    return this.#request(`/v1/teamwork-preview?${query.toString()}`);
  }

  learningInsights(discordGuildId: string, externalUserId: string): Promise<LearningInsightsView> {
    const query = new URLSearchParams({ discordGuildId, externalUserId });
    return this.#request(`/v1/learning/insights?${query.toString()}`);
  }

  learningRecord(
    discordGuildId: string,
    externalUserId: string,
    input: {
      readonly title: string;
      readonly lesson: string;
      readonly taskId?: string | undefined;
    },
  ): Promise<LearningRecordResultView> {
    return this.#request("/v1/learning/record", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId, ...input }),
    });
  }

  boostTask(
    discordGuildId: string,
    externalUserId: string,
    taskId: string,
  ): Promise<BoostTaskView> {
    return this.#request("/v1/boost/task", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId, taskId }),
    });
  }

  boostUnblock(discordGuildId: string, externalUserId: string): Promise<BoostUnblockView> {
    return this.#request("/v1/boost/unblock", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId }),
    });
  }

  boostSuggest(discordGuildId: string, externalUserId: string): Promise<BoostSuggestView> {
    return this.#request("/v1/boost/suggest", {
      method: "POST",
      body: JSON.stringify({ discordGuildId, externalUserId }),
    });
  }
}
