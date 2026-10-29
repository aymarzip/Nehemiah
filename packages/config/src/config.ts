import { z } from "zod";

export const aiProviderNames = [
  "none",
  "fake",
  "openai",
  "gemini",
  "anthropic",
  "deepseek",
  "openrouter",
  "ollama",
  "openai-compatible",
] as const;

export type AiProviderName = (typeof aiProviderNames)[number];
export type Environment = "development" | "test" | "production";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  STORAGE_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  DATABASE_URL: optionalString,
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  AI_PROVIDER: z.enum(aiProviderNames).optional(),
  AI_MODEL: optionalString,
  AI_BASE_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  OLLAMA_API_KEY: optionalString,
  AI_API_KEY: optionalString,
  GITHUB_WEBHOOK_SECRET: optionalString,
  DISCORD_TOKEN: optionalString,
  DISCORD_APPLICATION_ID: optionalString,
  DISCORD_DEV_GUILD_ID: optionalString,
  NEHEMIAH_API_URL: z.url().default("http://localhost:3000"),
  INTERNAL_API_TOKEN: optionalString,
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(20),
  DEMO_MODE: z.stringbool().default(false),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(50).max(32_768).default(800),
  AI_DECOMPOSITION_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(32_768).default(4_000),
  AI_MAX_CONTEXT_MEMORY_ITEMS: z.coerce.number().int().min(1).max(500).default(20),
  AI_MAX_CONTEXT_SIGNALS: z.coerce.number().int().min(1).max(100).default(10),
  AI_MAX_GRAPH_TASKS_IN_CONTEXT: z.coerce.number().int().min(5).max(500).default(40),
  AI_ENABLE_PROMPT_COMPACTING: z.stringbool().default(true),
  AI_MAX_PROMPT_CHARS: z.coerce.number().int().min(2_000).max(200_000).default(24_000),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
});

export interface AppConfig {
  readonly environment: Environment;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly http: { readonly host: string; readonly port: number };
  readonly storage:
    | { readonly driver: "memory" }
    | {
        readonly driver: "postgres";
        readonly databaseUrl: string;
        readonly poolSize: number;
        readonly statementTimeoutMs: number;
        readonly idleTimeoutMs: number;
        readonly connectionTimeoutMs: number;
      };
  readonly ai: {
    readonly provider: AiProviderName;
    readonly model?: string;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly maxOutputTokens: number;
    readonly decompositionMaxOutputTokens: number;
    readonly maxContextMemoryItems: number;
    readonly maxContextSignals: number;
    readonly maxGraphTasksInContext: number;
    readonly enablePromptCompacting: boolean;
    readonly maxPromptChars: number;
    readonly temperature?: number;
    readonly timeoutMs: number;
  };
  readonly github: {
    readonly webhookSecret?: string;
  };
  readonly discord: {
    readonly token?: string;
    readonly applicationId?: string;
    readonly developmentGuildId?: string;
    readonly apiUrl: string;
    readonly internalApiToken?: string;
  };
  readonly worker: { readonly pollIntervalMs: number; readonly batchSize: number };
  readonly demoMode: boolean;
}

export class ConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}

function selectedApiKey(
  provider: AiProviderName,
  raw: z.infer<typeof environmentSchema>,
): string | undefined {
  switch (provider) {
    case "openai":
      return raw.OPENAI_API_KEY;
    case "gemini":
      return raw.GEMINI_API_KEY;
    case "anthropic":
      return raw.ANTHROPIC_API_KEY;
    case "deepseek":
      return raw.DEEPSEEK_API_KEY;
    case "openrouter":
      return raw.OPENROUTER_API_KEY;
    case "ollama":
      return raw.OLLAMA_API_KEY;
    case "openai-compatible":
      return raw.AI_API_KEY;
    case "none":
    case "fake":
      return undefined;
  }
}

function requiresApiKey(provider: AiProviderName): boolean {
  return ["openai", "gemini", "anthropic", "deepseek", "openrouter"].includes(provider);
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  let raw: z.infer<typeof environmentSchema>;
  try {
    raw = environmentSchema.parse(source);
  } catch (error) {
    throw new ConfigurationError("Environment configuration is invalid", { cause: error });
  }

  if (raw.STORAGE_DRIVER === "postgres" && raw.DATABASE_URL === undefined) {
    throw new ConfigurationError("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  }

  const provider = raw.AI_PROVIDER ?? (raw.NODE_ENV === "production" ? "none" : "fake");
  const apiKey = selectedApiKey(provider, raw);
  if (requiresApiKey(provider) && apiKey === undefined) {
    throw new ConfigurationError(`The selected ${provider} provider requires its API key`);
  }
  if (provider === "openai-compatible" && raw.AI_BASE_URL === undefined) {
    throw new ConfigurationError("AI_BASE_URL is required for openai-compatible providers");
  }
  if (provider !== "none" && provider !== "fake" && raw.AI_MODEL === undefined) {
    throw new ConfigurationError(`AI_MODEL is required for the selected ${provider} provider`);
  }
  if (raw.NODE_ENV === "production" && raw.INTERNAL_API_TOKEN === undefined) {
    throw new ConfigurationError("INTERNAL_API_TOKEN is required in production");
  }
  if (raw.NODE_ENV === "production" && raw.INTERNAL_API_TOKEN!.length < 32) {
    throw new ConfigurationError("INTERNAL_API_TOKEN must be at least 32 characters in production");
  }
  if (raw.NODE_ENV === "production" && raw.STORAGE_DRIVER !== "postgres") {
    throw new ConfigurationError("STORAGE_DRIVER=postgres is required in production");
  }
  if (raw.GITHUB_WEBHOOK_SECRET !== undefined && raw.GITHUB_WEBHOOK_SECRET.length < 32) {
    throw new ConfigurationError("GITHUB_WEBHOOK_SECRET must be at least 32 characters");
  }

  const storage: AppConfig["storage"] =
    raw.STORAGE_DRIVER === "postgres"
      ? {
          driver: "postgres",
          databaseUrl: raw.DATABASE_URL!,
          poolSize: raw.DATABASE_POOL_SIZE,
          statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
          idleTimeoutMs: raw.DATABASE_IDLE_TIMEOUT_MS,
          connectionTimeoutMs: raw.DATABASE_CONNECTION_TIMEOUT_MS,
        }
      : { driver: "memory" };

  const ai: AppConfig["ai"] = {
    provider,
    ...(raw.AI_MODEL === undefined ? {} : { model: raw.AI_MODEL }),
    ...(raw.AI_BASE_URL === undefined ? {} : { baseUrl: raw.AI_BASE_URL }),
    ...(apiKey === undefined ? {} : { apiKey }),
    maxOutputTokens: raw.AI_MAX_OUTPUT_TOKENS,
    decompositionMaxOutputTokens: raw.AI_DECOMPOSITION_MAX_OUTPUT_TOKENS,
    maxContextMemoryItems: raw.AI_MAX_CONTEXT_MEMORY_ITEMS,
    maxContextSignals: raw.AI_MAX_CONTEXT_SIGNALS,
    maxGraphTasksInContext: raw.AI_MAX_GRAPH_TASKS_IN_CONTEXT,
    enablePromptCompacting: raw.AI_ENABLE_PROMPT_COMPACTING,
    maxPromptChars: raw.AI_MAX_PROMPT_CHARS,
    ...(raw.AI_TEMPERATURE === undefined ? {} : { temperature: raw.AI_TEMPERATURE }),
    timeoutMs: raw.AI_TIMEOUT_MS,
  };

  return {
    environment: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    http: { host: raw.HOST, port: raw.PORT },
    storage,
    ai,
    github: {
      ...(raw.GITHUB_WEBHOOK_SECRET === undefined
        ? {}
        : { webhookSecret: raw.GITHUB_WEBHOOK_SECRET }),
    },
    discord: {
      apiUrl: raw.NEHEMIAH_API_URL,
      ...(raw.DISCORD_TOKEN === undefined ? {} : { token: raw.DISCORD_TOKEN }),
      ...(raw.DISCORD_APPLICATION_ID === undefined
        ? {}
        : { applicationId: raw.DISCORD_APPLICATION_ID }),
      ...(raw.DISCORD_DEV_GUILD_ID === undefined
        ? {}
        : { developmentGuildId: raw.DISCORD_DEV_GUILD_ID }),
      ...(raw.INTERNAL_API_TOKEN === undefined ? {} : { internalApiToken: raw.INTERNAL_API_TOKEN }),
    },
    worker: {
      pollIntervalMs: raw.WORKER_POLL_INTERVAL_MS,
      batchSize: raw.WORKER_BATCH_SIZE,
    },
    demoMode: raw.DEMO_MODE,
  };
}

export function requireDiscordConfig(config: AppConfig): {
  token: string;
  applicationId: string;
  developmentGuildId?: string;
} {
  if (config.discord.token === undefined || config.discord.applicationId === undefined) {
    throw new ConfigurationError(
      "DISCORD_TOKEN and DISCORD_APPLICATION_ID are required to start the Discord adapter",
    );
  }
  return {
    token: config.discord.token,
    applicationId: config.discord.applicationId,
    ...(config.discord.developmentGuildId === undefined
      ? {}
      : { developmentGuildId: config.discord.developmentGuildId }),
  };
}
