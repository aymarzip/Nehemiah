import type { FetchLike } from "../transport.js";
import type { ModelCapabilities } from "../types.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";

export interface OpenRouterProviderConfig {
  readonly id?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly siteUrl?: string;
  readonly appName?: string;
  /** OpenRouter features vary by model and route; callers should supply discovered overrides. */
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
}

export class OpenRouterProvider extends OpenAiCompatibleProvider {
  constructor(config: OpenRouterProviderConfig, fetch?: FetchLike) {
    super(
      {
        id: config.id ?? "openrouter",
        kind: "openrouter",
        baseUrl: config.baseUrl ?? "https://openrouter.ai/api",
        path: "/v1/chat/completions",
        ...(config.model === undefined ? {} : { model: config.model }),
        auth:
          config.apiKey === undefined ? { type: "none" } : { type: "bearer", token: config.apiKey },
        headers: {
          ...(config.siteUrl === undefined ? {} : { "HTTP-Referer": config.siteUrl }),
          ...(config.appName === undefined ? {} : { "X-Title": config.appName }),
        },
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        streamProtocol: "sse",
        reasoningDialect: "reasoning_details",
        requireAuthentication: true,
        capabilities: {
          streaming: true,
          toolCalling: false,
          parallelToolCalls: false,
          structuredOutput: "none",
          reasoning: false,
          vision: false,
          providerState: true,
          ...config.capabilities,
        },
      },
      fetch,
    );
  }
}
