import { timingSafeEqual } from "node:crypto";
import Fastify, { LogController, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { AppConfig } from "@nehemiah/config";
import { DomainError } from "@nehemiah/core";
import { PersistenceError, type ProjectStore } from "@nehemiah/database";
import {
  GitHubWebhookError,
  type GitHubWebhookProcessor,
  type GitHubWebhookReceiver,
} from "@nehemiah/github";
import { isLlmError, type LlmRegistry } from "@nehemiah/llm";
import { OperationalMetrics, type Logger } from "@nehemiah/observability";
import { APPLICATION_VERSION } from "@nehemiah/shared";
import { DirectorApplicationService, DirectorServiceError } from "./director-service.js";
import { Phase2ApplicationService } from "./phase2-service.js";

const setupSchema = z.object({
  discordGuildId: z.string().trim().min(1).optional(),
  ownerExternalUserId: z.string().trim().min(1),
  ownerDisplayName: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(4_000),
  vision: z.string().trim().min(1).max(4_000),
  problem: z.string().trim().max(4_000).optional(),
  targetOutcome: z.string().trim().max(4_000).optional(),
  coreExperience: z.string().trim().max(4_000).optional(),
  mustHaveScope: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  shouldHaveScope: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  niceToHaveScope: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  excludedScope: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  successCriteria: z.array(z.string().trim().min(1)).max(50).optional(),
  nonGoals: z.array(z.string().trim().min(1)).max(50).optional(),
  deadline: z.string().trim().min(1),
  timezone: z.string().trim().min(1).max(100),
  mode: z.enum(["STANDARD", "GAME_JAM"]),
  githubRepository: z
    .string()
    .trim()
    .regex(/^[^/\s]+\/[^/\s]+$/u, "Use owner/repository")
    .optional(),
  constraints: z.array(z.string().trim().min(1)).max(50).default([]),
});

const teamSchema = z.object({
  discordGuildId: z.string().trim().min(1),
  externalUserId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(100),
  roles: z.array(z.string().trim().min(1)).max(20),
  skills: z
    .array(z.object({ name: z.string().trim().min(1), level: z.number().int().min(1).max(5) }))
    .max(100),
  hoursPerWeek: z.number().min(0).max(168),
  timezone: z.string().trim().min(1).max(100),
  aiTools: z.array(z.string().trim().min(1)).max(50),
});

const taskCreateSchema = z.object({
  externalUserId: z.string().trim().min(1),
  milestoneId: z.uuid().optional(),
  ownerMemberId: z.uuid().optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10_000).default(""),
  expectedOutcome: z.string().trim().max(4_000).optional(),
  ownerRole: z.string().trim().min(1).max(100).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  verificationRequirements: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  suggestedEvidence: z
    .array(
      z.enum([
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
      ]),
    )
    .max(20)
    .optional(),
  component: z.string().trim().min(1).max(200).optional(),
  deadlineCriticality: z.enum(["OPTIONAL", "IMPORTANT", "CRITICAL"]).optional(),
  scopeTier: z.enum(["MUST", "SHOULD", "NICE"]).optional(),
  releaseRequired: z.boolean().optional(),
  status: z.enum(["PLANNED", "READY"]).default("PLANNED"),
  impact: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  weight: z.number().positive().max(100).default(1),
  estimatedEffortHours: z.number().min(0).max(100_000),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const taskUpdateSchema = z.object({
  externalUserId: z.string().trim().min(1),
  status: z.enum([
    "PLANNED",
    "READY",
    "IN_PROGRESS",
    "BLOCKED",
    "IMPLEMENTED",
    "VERIFIED",
    "INTEGRATED",
    "SHIPPED",
    "CANCELLED",
  ]),
  evidence: z.string().trim().min(1).max(4_000).optional(),
});

const producerSchema = z.object({
  discordGuildId: z.string().trim().min(1),
  externalUserId: z.string().trim().min(1),
  question: z.string().trim().min(1).max(4_000),
});

const memoryCategories = [
  "FACT",
  "DECISION",
  "CONSTRAINT",
  "ARCHITECTURE",
  "REQUIREMENT",
  "TEAM",
  "RISK",
  "LESSON",
] as const;

const memorySchema = z.object({
  externalUserId: z.string().trim().min(1),
  category: z.enum(memoryCategories),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(20_000),
  confidence: z.number().min(0).max(1).default(1),
});

const actorSchema = z.object({ externalUserId: z.string().trim().min(1) });

const preferencesSchema = z.object({
  discordGuildId: z.string().trim().min(1),
  externalUserId: z.string().trim().min(1),
  style: z.enum(["CONCISE", "DETAILED", "VISUAL", "CONVERSATIONAL"]).optional(),
  notificationFrequency: z.enum(["IMMEDIATE", "BATCHED", "CHECKPOINT_ONLY"]).optional(),
  deliveryPreference: z.enum(["DM", "CHANNEL", "EITHER"]).optional(),
  feedbackStyle: z.enum(["DIRECT", "SUPPORTIVE", "NEUTRAL"]).optional(),
  taskPresentation: z.enum(["ONE_AT_A_TIME", "SHORTLIST", "FULL_QUEUE"]).optional(),
  allowDirectMessages: z.boolean().optional(),
  preferredLanguage: z.string().trim().min(2).max(20).optional(),
});

const visionDetailsSchema = z.object({
  externalUserId: z.string().trim().min(1),
  statement: z.string().trim().min(1).max(4_000),
  problem: z.string().trim().max(4_000).default(""),
  targetOutcome: z.string().trim().min(1).max(4_000),
  coreExperience: z.string().trim().max(4_000).default(""),
  mustHaveScope: z.array(z.string().trim().min(1).max(500)).max(100),
  shouldHaveScope: z.array(z.string().trim().min(1).max(500)).max(100),
  niceToHaveScope: z.array(z.string().trim().min(1).max(500)).max(100),
  excludedScope: z.array(z.string().trim().min(1).max(500)).max(100),
  constraints: z.array(z.string().trim().min(1).max(500)).max(100),
  successCriteria: z.array(z.string().trim().min(1).max(500)).max(100),
});

const decisionSchema = z.object({
  externalUserId: z.string().trim().min(1),
  type: z.enum([
    "GENERAL",
    "SCOPE_CHANGE",
    "ARCHITECTURE",
    "DEADLINE_CHANGE",
    "ASSIGNMENT",
    "RISK_ACCEPTANCE",
    "OVERRIDE",
  ]),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(4_000),
  context: z.string().trim().max(4_000).default(""),
  rationale: z.string().trim().min(1).max(4_000),
  outcome: z.string().trim().min(1).max(4_000),
  alternatives: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  affectedTaskIds: z.array(z.uuid()).max(100).default([]),
  affectedComponents: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  status: z.enum(["PROPOSED", "ACCEPTED"]).default("PROPOSED"),
  supersedesDecisionId: z.uuid().optional(),
});

const blockerSchema = z.object({
  externalUserId: z.string().trim().min(1),
  description: z.string().trim().min(1).max(4_000),
  source: z.enum(["HUMAN", "TASK", "GITHUB", "CI", "INTEGRATION", "SYSTEM"]).default("HUMAN"),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  blockedTaskId: z.uuid().optional(),
  blockingTaskId: z.uuid().optional(),
  blockedMemberId: z.uuid().optional(),
  suggestedResolution: z.string().trim().max(4_000).optional(),
});

const idSchema = z.uuid();

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function internalToken(request: FastifyRequest): string | undefined {
  const value = request.headers["x-nehemiah-internal-token"];
  return Array.isArray(value) ? value[0] : value;
}

function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const status = (error as { readonly statusCode?: unknown }).statusCode;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status < 500
    ? status
    : undefined;
}

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly store: ProjectStore;
  readonly llm: LlmRegistry;
  readonly logger: Logger;
  readonly webhookReceiver?: GitHubWebhookReceiver;
  readonly webhookProcessor?: GitHubWebhookProcessor;
}

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    loggerInstance: options.logger,
    trustProxy: false,
    bodyLimit: 1_048_576,
    forceCloseConnections: true,
    requestIdHeader: "x-request-id",
    logController: new LogController({ disableRequestLogging: false }),
  });
  const metrics = new OperationalMetrics();
  const onLlm = (metadata: Readonly<Record<string, unknown>>): void => {
    const provider = typeof metadata["provider"] === "string" ? metadata["provider"] : "unknown";
    const failed = metadata["errorCategory"] !== undefined;
    metrics.recordLlm(provider, failed);
    options.logger.info({ llm: metadata }, failed ? "LLM request failed" : "LLM request completed");
  };
  const service = new DirectorApplicationService(options.store, options.llm, onLlm, {
    maxOutputTokens: options.config.ai.maxOutputTokens,
    maxContextMemoryItems: options.config.ai.maxContextMemoryItems,
    maxContextSignals: options.config.ai.maxContextSignals,
    ...(options.config.ai.temperature === undefined
      ? {}
      : { temperature: options.config.ai.temperature }),
  });
  const phase2 = new Phase2ApplicationService(options.store, options.llm, onLlm, {
    decompositionMaxOutputTokens: options.config.ai.decompositionMaxOutputTokens,
    ...(options.config.ai.temperature === undefined
      ? {}
      : { temperature: options.config.ai.temperature }),
  });

  app.addHook("onResponse", async (request, reply) => {
    metrics.recordHttp(reply.statusCode);
    request.log.info(
      { correlationId: request.id, statusCode: reply.statusCode },
      "API request completed",
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Request validation failed.",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    if (error instanceof DirectorServiceError || error instanceof GitHubWebhookError) {
      void reply.status(error.statusCode).send({ code: error.code, message: error.message });
      return;
    }
    if (error instanceof DomainError) {
      const status =
        error.code === "PERMISSION_DENIED"
          ? 403
          : error.code === "ENTITY_NOT_FOUND"
            ? 404
            : error.code === "DUPLICATE_ENTITY" || error.code === "TASK_GRAPH_CYCLE"
              ? 409
              : 400;
      void reply.status(status).send({ code: error.code, message: error.message });
      return;
    }
    if (error instanceof PersistenceError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : ["ALREADY_EXISTS", "CYCLE", "PROJECT_MISMATCH", "CONFLICT"].includes(error.code)
            ? 409
            : 500;
      void reply.status(status).send({ code: error.code, message: error.message });
      return;
    }
    if (isLlmError(error)) {
      const status = error.code === "rate_limit" ? 429 : (error.httpStatus ?? 502);
      void reply.status(status).send({ code: error.code.toUpperCase(), message: error.message });
      return;
    }
    const clientStatus = clientErrorStatus(error);
    if (clientStatus !== undefined) {
      void reply.status(clientStatus).send({
        code: clientStatus === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
        message:
          clientStatus === 413
            ? "Request payload is too large."
            : "The request is invalid or could not be parsed.",
      });
      return;
    }
    request.log.error({ err: error }, "Unhandled API error");
    void reply.status(500).send({ code: "INTERNAL_ERROR", message: "An internal error occurred." });
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status", "version", "storage", "aiConfigured"],
            properties: {
              status: { type: "string" },
              version: { type: "string" },
              storage: { type: "string" },
              aiConfigured: { type: "boolean" },
            },
          },
        },
      },
    },
    async () => ({
      status: "ok",
      version: APPLICATION_VERSION,
      storage: options.config.storage.driver,
      aiConfigured: options.llm.configured,
    }),
  );

  app.get("/ready", async (_request, reply) => {
    const ready = await options.store.readiness();
    return reply.status(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready" });
  });

  app.get("/operations/metrics", async () => metrics.snapshot());

  app.register(
    async (api) => {
      api.addHook("onRequest", async (request, reply) => {
        const expected = options.config.discord.internalApiToken;
        if (expected !== undefined && !secureEqual(internalToken(request), expected)) {
          return reply
            .status(401)
            .send({ code: "UNAUTHORIZED", message: "Internal API token is invalid." });
        }
      });

      api.post("/projects/setup", async (request, reply) => {
        const project = await service.setupProject(setupSchema.parse(request.body));
        return reply.status(201).send({ projectId: project.id, workspaceId: project.workspaceId });
      });

      api.get<{ Params: { guildId: string } }>(
        "/projects/by-guild/:guildId/status",
        async (request) => service.projectStatus(request.params.guildId),
      );

      api.post("/team/join", async (request, reply) => {
        const member = await service.joinTeam(teamSchema.parse(request.body));
        return reply.status(201).send({ memberId: member.id });
      });

      api.get<{ Querystring: { discordGuildId?: string; externalUserId?: string } }>(
        "/tasks/mine",
        async (request) => {
          const query = z
            .object({ discordGuildId: z.string().min(1), externalUserId: z.string().min(1) })
            .parse(request.query);
          return service.currentTasks(query.discordGuildId, query.externalUserId);
        },
      );

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/tasks",
        async (request, reply) => {
          const body = taskCreateSchema.parse(request.body);
          const task = await service.createTask(
            idSchema.parse(request.params.projectId),
            body.externalUserId,
            {
              title: body.title,
              description: body.description,
              ...(body.expectedOutcome === undefined
                ? {}
                : { expectedOutcome: body.expectedOutcome }),
              ...(body.ownerRole === undefined ? {} : { ownerRole: body.ownerRole }),
              ...(body.riskLevel === undefined ? {} : { riskLevel: body.riskLevel }),
              ...(body.verificationRequirements === undefined
                ? {}
                : { verificationRequirements: body.verificationRequirements }),
              ...(body.suggestedEvidence === undefined
                ? {}
                : { suggestedEvidence: body.suggestedEvidence }),
              ...(body.component === undefined ? {} : { component: body.component }),
              ...(body.deadlineCriticality === undefined
                ? {}
                : { deadlineCriticality: body.deadlineCriticality }),
              ...(body.scopeTier === undefined ? {} : { scopeTier: body.scopeTier }),
              ...(body.releaseRequired === undefined
                ? {}
                : { releaseRequired: body.releaseRequired }),
              status: body.status,
              impact: body.impact,
              weight: body.weight,
              estimatedEffortHours: body.estimatedEffortHours,
              ...(body.milestoneId === undefined ? {} : { milestoneId: body.milestoneId }),
              ...(body.ownerMemberId === undefined ? {} : { ownerMemberId: body.ownerMemberId }),
              ...(body.dueAt === undefined ? {} : { dueAt: new Date(body.dueAt) }),
              ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
            },
          );
          return reply.status(201).send(task);
        },
      );

      api.post<{ Params: { taskId: string } }>(
        "/tasks/:taskId/dependencies",
        async (request, reply) => {
          const body = z
            .object({ dependsOnTaskId: z.uuid(), externalUserId: z.string().trim().min(1) })
            .parse(request.body);
          await service.addDependency(
            idSchema.parse(request.params.taskId),
            body.dependsOnTaskId,
            body.externalUserId,
          );
          return reply.status(204).send();
        },
      );

      api.patch<{ Params: { taskId: string } }>("/tasks/:taskId/status", async (request) => {
        const body = taskUpdateSchema.parse(request.body);
        return service.updateTask(
          idSchema.parse(request.params.taskId),
          body.externalUserId,
          body.status,
          body.evidence,
        );
      });

      api.post("/producer/ask", async (request) => {
        const body = producerSchema.parse(request.body);
        return service.askProducer(body.discordGuildId, body.externalUserId, body.question);
      });

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/memory",
        async (request, reply) => {
          const body = memorySchema.parse(request.body);
          const entry = await service.addMemory(
            idSchema.parse(request.params.projectId),
            body.externalUserId,
            body.category,
            body.title,
            body.content,
            body.confidence,
          );
          return reply.status(201).send(entry);
        },
      );

      api.get<{
        Params: { projectId: string };
        Querystring: { category?: string | string[]; externalUserId?: string };
      }>("/projects/:projectId/memory", async (request) => {
        const raw = request.query.category;
        const categories =
          raw === undefined
            ? undefined
            : z.array(z.enum(memoryCategories)).parse(Array.isArray(raw) ? raw : [raw]);
        const actor = actorSchema.parse(request.query);
        return service.listMemory(
          idSchema.parse(request.params.projectId),
          actor.externalUserId,
          categories,
        );
      });

      api.put("/team/preferences", async (request) => {
        const body = preferencesSchema.parse(request.body);
        const { discordGuildId, externalUserId, ...preferences } = body;
        return phase2.updatePreferences(discordGuildId, externalUserId, preferences);
      });

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/vision/revisions",
        async (request, reply) => {
          const body = visionDetailsSchema.parse(request.body);
          const { externalUserId, ...revision } = body;
          const result = await phase2.proposeVision(
            idSchema.parse(request.params.projectId),
            externalUserId,
            revision,
          );
          return reply.status(201).send(result);
        },
      );

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/milestones",
        async (request, reply) => {
          const body = actorSchema
            .extend({
              name: z.string().trim().min(1).max(200),
              description: z.string().trim().max(2_000).default(""),
              dueAt: z.iso.datetime({ offset: true }),
              completionCriteria: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
            })
            .parse(request.body);
          const result = await phase2.createMilestone(
            idSchema.parse(request.params.projectId),
            body.externalUserId,
            {
              name: body.name,
              description: body.description,
              dueAt: new Date(body.dueAt),
              completionCriteria: body.completionCriteria,
            },
          );
          return reply.status(201).send(result);
        },
      );

      api.get<{ Params: { projectId: string }; Querystring: { externalUserId?: string } }>(
        "/projects/:projectId/milestones",
        async (request) => {
          const query = actorSchema.parse(request.query);
          return phase2.listMilestones(
            idSchema.parse(request.params.projectId),
            query.externalUserId,
          );
        },
      );

      api.get<{ Params: { projectId: string }; Querystring: { externalUserId?: string } }>(
        "/projects/:projectId/vision/revisions",
        async (request) => {
          const actor = actorSchema.parse(request.query);
          return phase2.listVision(idSchema.parse(request.params.projectId), actor.externalUserId);
        },
      );

      api.post<{ Params: { projectId: string; revisionId: string } }>(
        "/projects/:projectId/vision/revisions/:revisionId/approve",
        async (request) => {
          const body = actorSchema
            .extend({ reason: z.string().trim().min(1).max(4_000) })
            .parse(request.body);
          return phase2.approveVision(
            idSchema.parse(request.params.projectId),
            idSchema.parse(request.params.revisionId),
            body.externalUserId,
            body.reason,
          );
        },
      );

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/decisions",
        async (request, reply) => {
          const body = decisionSchema.parse(request.body);
          const { externalUserId, ...decision } = body;
          const result = await phase2.recordDecision(
            idSchema.parse(request.params.projectId),
            externalUserId,
            decision,
          );
          return reply.status(201).send(result);
        },
      );

      api.get<{
        Params: { projectId: string };
        Querystring: { externalUserId?: string; limit?: string };
      }>("/projects/:projectId/decisions", async (request) => {
        const query = actorSchema
          .extend({ limit: z.coerce.number().int().min(1).max(100).default(20) })
          .parse(request.query);
        return phase2.listDecisions(
          idSchema.parse(request.params.projectId),
          query.externalUserId,
          query.limit,
        );
      });

      api.post<{ Params: { projectId: string; decisionId: string } }>(
        "/projects/:projectId/decisions/:decisionId/approve",
        async (request) => {
          const body = actorSchema.parse(request.body);
          return phase2.approveDecision(
            idSchema.parse(request.params.projectId),
            idSchema.parse(request.params.decisionId),
            body.externalUserId,
          );
        },
      );

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/decompose",
        async (request, reply) => {
          const body = actorSchema
            .extend({ goal: z.string().trim().min(1).max(8_000) })
            .parse(request.body);
          const result = await phase2.decompose(
            idSchema.parse(request.params.projectId),
            body.externalUserId,
            body.goal,
          );
          return reply.status(201).send(result);
        },
      );

      api.post("/producer/what-now", async (request) => {
        const body = actorSchema
          .extend({ discordGuildId: z.string().trim().min(1) })
          .parse(request.body);
        return phase2.whatNow(body.discordGuildId, body.externalUserId);
      });

      api.post("/producer/why", async (request) => {
        const body = actorSchema
          .extend({ discordGuildId: z.string().trim().min(1), taskId: z.uuid().optional() })
          .parse(request.body);
        return phase2.why(body.discordGuildId, body.externalUserId, body.taskId);
      });

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/scope/cut-recommendations",
        async (request) => {
          const body = actorSchema.parse(request.body);
          return phase2.cutScope(idSchema.parse(request.params.projectId), body.externalUserId);
        },
      );

      api.post<{ Params: { projectId: string; taskId: string } }>(
        "/projects/:projectId/tasks/:taskId/assignment-recommendations",
        async (request) => {
          const body = actorSchema.parse(request.body);
          return phase2.assignmentRecommendations(
            idSchema.parse(request.params.projectId),
            idSchema.parse(request.params.taskId),
            body.externalUserId,
          );
        },
      );

      api.post<{ Params: { projectId: string; taskId: string } }>(
        "/projects/:projectId/tasks/:taskId/assign",
        async (request) => {
          const body = actorSchema
            .extend({
              memberId: z.uuid(),
              reasons: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
              score: z.number().min(0).max(100),
              confidence: z.number().min(0).max(1),
            })
            .parse(request.body);
          return phase2.approveAssignment(
            idSchema.parse(request.params.projectId),
            idSchema.parse(request.params.taskId),
            body.memberId,
            body.externalUserId,
            body.reasons,
            body.score,
            body.confidence,
          );
        },
      );

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/blockers",
        async (request, reply) => {
          const body = blockerSchema.parse(request.body);
          const { externalUserId, ...blocker } = body;
          const result = await phase2.addBlocker(
            idSchema.parse(request.params.projectId),
            externalUserId,
            blocker,
          );
          return reply.status(201).send(result);
        },
      );

      api.get<{
        Params: { projectId: string };
        Querystring: { externalUserId?: string; includeResolved?: string };
      }>("/projects/:projectId/blockers", async (request) => {
        const query = actorSchema
          .extend({ includeResolved: z.stringbool().default(false) })
          .parse(request.query);
        return phase2.listBlockers(
          idSchema.parse(request.params.projectId),
          query.externalUserId,
          query.includeResolved,
        );
      });

      api.post<{ Params: { projectId: string; blockerId: string } }>(
        "/projects/:projectId/blockers/:blockerId/resolve",
        async (request) => {
          const body = actorSchema.parse(request.body);
          return phase2.resolveBlocker(
            idSchema.parse(request.params.projectId),
            idSchema.parse(request.params.blockerId),
            body.externalUserId,
          );
        },
      );

      api.post("/projects/mission-control", async (request) => {
        const body = actorSchema
          .extend({ discordGuildId: z.string().trim().min(1) })
          .parse(request.body);
        return phase2.missionControl(body.discordGuildId, body.externalUserId);
      });

      api.post("/demo/bootstrap", async (request, reply) => {
        if (!options.config.demoMode) {
          return reply
            .status(404)
            .send({ code: "DEMO_DISABLED", message: "Demo mode is not enabled." });
        }
        const body = z
          .object({
            discordGuildId: z.string().trim().min(1),
            ownerExternalUserId: z.string().trim().min(1),
            ownerDisplayName: z.string().trim().min(1).max(100),
          })
          .parse(request.body);
        const result = await phase2.bootstrapDemo(
          body.discordGuildId,
          body.ownerExternalUserId,
          body.ownerDisplayName,
        );
        return reply.status(result.reused ? 200 : 201).send(result);
      });

      api.put<{ Params: { projectId: string } }>(
        "/projects/:projectId/settings",
        async (request) => {
          const body = actorSchema
            .extend({
              checkpointCadenceHours: z.number().int().min(1).max(720).optional(),
              notificationPolicy: z
                .enum(["IMMEDIATE_CRITICAL", "BATCHED", "CHECKPOINT_ONLY"])
                .optional(),
              missionControlChannelId: z.string().trim().min(1).max(100).optional(),
              missionControlMessageId: z.string().trim().min(1).max(100).optional(),
            })
            .parse(request.body);
          const { externalUserId, ...settings } = body;
          return phase2.configureProjectSettings(
            idSchema.parse(request.params.projectId),
            externalUserId,
            settings,
          );
        },
      );

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/checkpoints",
        async (request, reply) => {
          const body = actorSchema.parse(request.body);
          const result = await phase2.captureCheckpoint(
            idSchema.parse(request.params.projectId),
            body.externalUserId,
          );
          return reply.status(201).send(result);
        },
      );

      api.post("/team/checkpoint", async (request) => {
        const body = actorSchema
          .extend({ discordGuildId: z.string().trim().min(1) })
          .parse(request.body);
        return phase2.smartCheckpoint(body.discordGuildId, body.externalUserId);
      });

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/memory/query",
        async (request) => {
          const body = actorSchema
            .extend({ question: z.string().trim().min(1).max(4_000) })
            .parse(request.body);
          return phase2.queryMemory(
            idSchema.parse(request.params.projectId),
            body.externalUserId,
            body.question,
          );
        },
      );

      api.post<{ Params: { projectId: string } }>(
        "/projects/:projectId/integrations/github",
        async (request) => {
          const body = actorSchema
            .extend({
              installationId: z.number().int().positive().safe(),
              repositoryId: z.number().int().positive().safe(),
              repositoryFullName: z
                .string()
                .trim()
                .regex(/^[^/\s]+\/[^/\s]+$/u),
            })
            .parse(request.body);
          return phase2.connectGitHub(
            idSchema.parse(request.params.projectId),
            body.externalUserId,
            body.installationId,
            body.repositoryId,
            body.repositoryFullName,
          );
        },
      );

      api.post<{ Params: { projectId: string; taskId: string } }>(
        "/projects/:projectId/tasks/:taskId/github-links",
        async (request) => {
          const body = actorSchema
            .extend({
              repositoryId: z.number().int().positive().safe(),
              linkKind: z.enum(["BRANCH", "PULL_REQUEST", "ISSUE"]),
              externalId: z.string().trim().min(1).max(300),
            })
            .parse(request.body);
          return phase2.linkTaskToGitHub(
            idSchema.parse(request.params.projectId),
            idSchema.parse(request.params.taskId),
            body.externalUserId,
            body.repositoryId,
            body.linkKind,
            body.externalId,
          );
        },
      );
    },
    { prefix: "/v1" },
  );

  app.register(
    async (github) => {
      github.removeContentTypeParser("application/json");
      github.addContentTypeParser(
        "application/json",
        { parseAs: "string" },
        (_request, body, done) => {
          done(null, body);
        },
      );
      github.post("/webhooks/github", async (request, reply) => {
        if (options.webhookReceiver === undefined) {
          return reply.status(503).send({
            code: "GITHUB_NOT_CONFIGURED",
            message: "GitHub webhook verification is not configured.",
          });
        }
        const receipt = await options.webhookReceiver.receive(
          typeof request.body === "string" ? request.body : String(request.body),
          request.headers,
        );
        metrics.recordWebhook(receipt.outcome === "duplicate" ? "duplicate" : "accepted");
        if (options.config.storage.driver === "memory" && options.webhookProcessor !== undefined) {
          await options.webhookProcessor.processBatch(20);
        }
        return reply.status(202).send(receipt);
      });
    },
    { prefix: "/integrations" },
  );

  app.addHook("onClose", async () => options.store.close());
  return app;
}
