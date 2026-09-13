import { LlmError, sanitizeErrorMessage, type LlmErrorCode } from "../errors.js";
import type {
  FinishReason,
  JsonObject,
  JsonValue,
  LlmContent,
  LlmMessage,
  ModelCapabilities,
  TokenUsage,
  ToolCallContent,
} from "../types.js";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

export const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const jsonObject = (value: unknown): JsonObject =>
  (isRecord(value) ? value : {}) as JsonObject;

export const parseArguments = (value: unknown): JsonObject => {
  if (isRecord(value)) return value as JsonObject;
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return jsonObject(parsed);
  } catch {
    return {};
  }
};

export const stringifyJson = (value: JsonValue): string =>
  typeof value === "string" ? value : JSON.stringify(value);

export const messageText = (message: LlmMessage): string =>
  message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

export const finishReason = (value: unknown): FinishReason => {
  switch (value) {
    case "stop":
    case "end_turn":
    case "STOP":
      return "stop";
    case "length":
    case "max_tokens":
    case "MAX_TOKENS":
      return "length";
    case "tool_calls":
    case "tool_use":
      return "tool_calls";
    case "content_filter":
    case "SAFETY":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "RECITATION":
    case "SPII":
    case "refusal":
      return "content_filter";
    case "error":
    case "insufficient_system_resource":
      return "error";
    default:
      return "unknown";
  }
};

export const usage = (options: {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly total?: unknown;
  readonly reasoning?: unknown;
  readonly cacheRead?: unknown;
  readonly cacheWrite?: unknown;
}): TokenUsage | undefined => {
  const inputTokens = asNumber(options.input);
  const outputTokens = asNumber(options.output);
  const totalTokens = asNumber(options.total);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  const resolvedInput = inputTokens ?? 0;
  const resolvedOutput = outputTokens ?? 0;
  return {
    inputTokens: resolvedInput,
    outputTokens: resolvedOutput,
    totalTokens: totalTokens ?? resolvedInput + resolvedOutput,
    ...(asNumber(options.reasoning) === undefined
      ? {}
      : { reasoningTokens: asNumber(options.reasoning) as number }),
    ...(asNumber(options.cacheRead) === undefined
      ? {}
      : { cacheReadTokens: asNumber(options.cacheRead) as number }),
    ...(asNumber(options.cacheWrite) === undefined
      ? {}
      : { cacheWriteTokens: asNumber(options.cacheWrite) as number }),
  };
};

export const toolCallFromUnknown = (
  value: unknown,
  fallbackId: string,
): ToolCallContent | undefined => {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const fn = asRecord(record.function) ?? record;
  const name = asString(fn.name);
  if (name === undefined) return undefined;
  return {
    type: "tool_call",
    id: asString(record.id) ?? fallbackId,
    name,
    arguments: parseArguments(fn.arguments ?? fn.input ?? record.args),
  };
};

export const contentFromTextAndTools = (
  text: string | undefined,
  tools: readonly ToolCallContent[],
  reasoningText?: string,
  reasoningState?: JsonObject,
): readonly LlmContent[] => [
  ...(reasoningText === undefined && reasoningState === undefined
    ? []
    : [
        {
          type: "reasoning" as const,
          ...(reasoningText === undefined ? {} : { text: reasoningText }),
          ...(reasoningState === undefined ? {} : { providerState: reasoningState }),
        },
      ]),
  ...(text === undefined || text === "" ? [] : [{ type: "text" as const, text }]),
  ...tools,
];

export const capabilitiesWith = (
  model: string,
  defaults: Omit<ModelCapabilities, "model">,
  overrides?: Partial<Omit<ModelCapabilities, "model">>,
): ModelCapabilities => ({ model, ...defaults, ...overrides });

export const capabilitiesForModel = (
  model: string,
  configuredModel: string | undefined,
  defaults: Omit<ModelCapabilities, "model">,
  overrides?: Partial<Omit<ModelCapabilities, "model">>,
): ModelCapabilities => {
  if (configuredModel !== undefined && model !== configuredModel && overrides === undefined) {
    return {
      model,
      streaming: defaults.streaming,
      toolCalling: false,
      parallelToolCalls: false,
      structuredOutput: "none",
      reasoning: false,
      vision: false,
      providerState: defaults.providerState,
    };
  }
  return capabilitiesWith(model, defaults, overrides);
};

const codeFromProviderType = (type: string | undefined): LlmErrorCode | undefined => {
  const value = type?.toLowerCase();
  if (value === undefined) return undefined;
  if (value.includes("auth") || value.includes("api_key")) return "authentication";
  if (value.includes("permission")) return "permission";
  if (value.includes("rate")) return "rate_limit";
  if (value.includes("overload")) return "provider_overloaded";
  if (value.includes("context") || value.includes("token_limit")) return "context_limit";
  if (value.includes("model") && value.includes("not")) return "model_not_found";
  if (value.includes("safety") || value.includes("content_filter")) return "content_filter";
  if (value.includes("invalid")) return "invalid_request";
  return undefined;
};

export const errorFromPayload = (
  payload: unknown,
  provider: string,
  model: string,
  partialOutput?: string,
): LlmError => {
  const root = asRecord(payload) ?? {};
  const nested = asRecord(root.error) ?? root;
  const metadata = asRecord(nested.metadata);
  const type =
    asString(nested.type) ??
    asString(nested.code) ??
    asString(metadata?.error_type) ??
    asString(root.type);
  const code = codeFromProviderType(type) ?? "unknown";
  return new LlmError({
    code,
    message: sanitizeErrorMessage(
      asString(nested.message) ?? `${provider} returned a streaming error`,
    ),
    provider,
    model,
    retryable:
      code === "rate_limit" || code === "provider_overloaded" || code === "provider_unavailable",
    ...(type === undefined ? {} : { providerCode: type }),
    ...(partialOutput === undefined ? {} : { partialOutput }),
  });
};
