import type { FetchLike } from "../transport.js";
import type { ModelCapabilities } from "../types.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";

export interface DeepSeekProviderConfig {
  readonly id?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
}

export class DeepSeekProvider extends OpenAiCompatibleProvider {
  constructor(config: DeepSeekProviderConfig, fetch?: FetchLike) {
    const reasoningModel = config.model?.toLowerCase().includes("reasoner") ?? false;
    super(
      {
        id: config.id ?? "deepseek",
        kind: "deepseek",
        baseUrl: config.baseUrl ?? "https://api.deepseek.com",
        path: "/chat/completions",
        ...(config.model === undefined ? {} : { model: config.model }),
        auth:
          config.apiKey === undefined ? { type: "none" } : { type: "bearer", token: config.apiKey },
        ...(config.headers === undefined ? {} : { headers: config.headers }),
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        streamProtocol: "sse",
        reasoningDialect: "reasoning_content",
        requireAuthentication: true,
        capabilities: {
          streaming: true,
          toolCalling: !reasoningModel,
          parallelToolCalls: !reasoningModel,
          structuredOutput: "json_object",
          reasoning: true,
          vision: false,
          providerState: true,
          ...config.capabilities,
        },
      },
      fetch,
    );
  }
}
