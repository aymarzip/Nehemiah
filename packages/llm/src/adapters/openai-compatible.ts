import { LlmError } from "../errors.js";
import { BaseLlmProvider, assertRequestCapabilities, resolveModel } from "../provider.js";
import {
  joinUrl,
  parseNdjson,
  parseSse,
  parseSseJson,
  postJson,
  readJson,
  type FetchLike,
} from "../transport.js";
import type {
  GenerateRequest,
  JsonObject,
  LlmCallOptions,
  LlmMessage,
  LlmResponse,
  LlmStreamEvent,
  ModelCapabilities,
  ProviderState,
  TokenUsage,
  ToolCallContent,
} from "../types.js";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  capabilitiesWith,
  contentFromTextAndTools,
  errorFromPayload,
  finishReason,
  parseArguments,
  stringifyJson,
  toolCallFromUnknown,
  usage,
} from "./common.js";

export type AdapterAuth =
  | { readonly type: "none" }
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "header"; readonly name: string; readonly value: string };

export type ChatReasoningDialect = "none" | "reasoning_content" | "reasoning_details";

export interface OpenAiCompatibleConfig {
  readonly id?: string;
  readonly kind?: string;
  readonly baseUrl: string;
  readonly path?: string;
  readonly model?: string;
  readonly auth?: AdapterAuth;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly streamProtocol?: "sse" | "ndjson";
  readonly timeoutMs?: number;
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
  readonly reasoningDialect?: ChatReasoningDialect;
  /** Extra provider routing/options owned by this adapter, never interpreted by the domain. */
  readonly providerOptions?: JsonObject;
  readonly requireAuthentication?: boolean;
}

interface ChatDialect {
  readonly reasoning: ChatReasoningDialect;
  readonly requireParameters?: boolean;
}

const toolChoice = (choice: GenerateRequest["toolChoice"]): unknown => {
  if (choice === undefined) return undefined;
  if (choice.type === "named") return { type: "function", function: { name: choice.name } };
  return choice.type;
};

const imagePart = (part: Extract<LlmMessage["content"][number], { type: "image" }>): unknown => ({
  type: "image_url",
  image_url: {
    url:
      part.source.type === "url"
        ? part.source.url
        : `data:${part.source.mediaType};base64,${part.source.data}`,
    ...(part.detail === undefined ? {} : { detail: part.detail }),
  },
});

const providerReasoning = (
  state: ProviderState | undefined,
  dialect: ChatReasoningDialect,
): Record<string, unknown> => {
  if (state === undefined || dialect === "none") return {};
  if (dialect === "reasoning_content") {
    const deepSeek = asRecord(state.deepseek);
    const value = asString(deepSeek?.reasoningContent);
    return value === undefined ? {} : { reasoning_content: value };
  }
  const openRouter = asRecord(state.openrouter);
  return openRouter?.reasoningDetails === undefined
    ? {}
    : { reasoning_details: openRouter.reasoningDetails };
};

export const mapOpenAiCompatibleMessages = (
  messages: readonly LlmMessage[],
  dialect: ChatDialect,
): readonly unknown[] =>
  messages.flatMap((message) => {
    const results = message.content.filter((part) => part.type === "tool_result");
    const normal = message.content.filter((part) => part.type !== "tool_result");
    const mappedResults = results.map((result) => ({
      role: "tool",
      tool_call_id: result.toolCallId,
      ...(result.name === undefined ? {} : { name: result.name }),
      content: stringifyJson(result.output),
    }));
    if (normal.length === 0) return mappedResults;

    const tools = normal.filter((part) => part.type === "tool_call");
    const images = normal.filter((part) => part.type === "image");
    const text = normal
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const content =
      images.length === 0
        ? text
        : [
            ...(text === "" ? [] : [{ type: "text", text }]),
            ...images.map((part) => imagePart(part)),
          ];
    const mapped = {
      role: message.role === "tool" ? "user" : message.role,
      content,
      ...(message.name === undefined ? {} : { name: message.name }),
      ...(tools.length === 0
        ? {}
        : {
            tool_calls: tools.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }),
      ...providerReasoning(message.providerState, dialect.reasoning),
    };
    return [mapped, ...mappedResults];
  });

export const mapOpenAiCompatibleRequest = (
  request: GenerateRequest,
  model: string,
  dialect: ChatDialect,
  stream: boolean,
  providerOptions?: JsonObject,
): Record<string, unknown> => ({
  model,
  messages: mapOpenAiCompatibleMessages(request.messages, dialect),
  stream,
  ...(stream ? { stream_options: { include_usage: true } } : {}),
  ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
  ...(request.stopSequences === undefined ? {} : { stop: request.stopSequences }),
  ...(request.tools === undefined || request.tools.length === 0
    ? {}
    : {
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            parameters: tool.inputSchema,
            ...(tool.strict === undefined ? {} : { strict: tool.strict }),
          },
        })),
      }),
  ...(toolChoice(request.toolChoice) === undefined
    ? {}
    : { tool_choice: toolChoice(request.toolChoice) }),
  ...(request.responseFormat === undefined || request.responseFormat.type === "text"
    ? {}
    : request.responseFormat.type === "json_object"
      ? { response_format: { type: "json_object" } }
      : {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.responseFormat.name,
              schema: request.responseFormat.schema,
              ...(request.responseFormat.description === undefined
                ? {}
                : { description: request.responseFormat.description }),
              ...(request.responseFormat.strict === undefined
                ? {}
                : { strict: request.responseFormat.strict }),
            },
          },
        }),
  ...(request.reasoning?.enabled !== true || dialect.reasoning === "none"
    ? {}
    : dialect.reasoning === "reasoning_details"
      ? {
          reasoning: {
            ...(request.reasoning.effort === undefined ? {} : { effort: request.reasoning.effort }),
            ...(request.reasoning.maxTokens === undefined
              ? {}
              : { max_tokens: request.reasoning.maxTokens }),
          },
        }
      : {
          thinking: {
            type: "enabled",
            ...(request.reasoning.maxTokens === undefined
              ? {}
              : { budget_tokens: request.reasoning.maxTokens }),
          },
        }),
  ...(dialect.requireParameters === true ? { provider: { require_parameters: true } } : {}),
  ...(providerOptions ?? {}),
});

const providerStateFromMessage = (
  message: Record<string, unknown>,
  dialect: ChatReasoningDialect,
): ProviderState | undefined => {
  if (dialect === "reasoning_content") {
    const reasoningContent = asString(message.reasoning_content);
    return reasoningContent === undefined ? undefined : { deepseek: { reasoningContent } };
  }
  if (dialect === "reasoning_details" && message.reasoning_details !== undefined) {
    return { openrouter: { reasoningDetails: message.reasoning_details as never } };
  }
  return undefined;
};

const usageFromChat = (value: unknown): TokenUsage | undefined => {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const outputDetails = asRecord(record.completion_tokens_details);
  const inputDetails = asRecord(record.prompt_tokens_details);
  return usage({
    input: record.prompt_tokens,
    output: record.completion_tokens,
    total: record.total_tokens,
    reasoning: outputDetails?.reasoning_tokens,
    cacheRead: inputDetails?.cached_tokens,
  });
};

export const parseOpenAiCompatibleResponse = (
  payload: unknown,
  provider: string,
  requestedModel: string,
  dialect: ChatReasoningDialect,
): LlmResponse => {
  const root = asRecord(payload);
  if (root === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned an invalid response envelope`,
      provider,
      model: requestedModel,
    });
  }
  if (root.error !== undefined) throw errorFromPayload(root, provider, requestedModel);
  const choice = asRecord(asArray(root.choices)[0]);
  const message = asRecord(choice?.message);
  if (choice === undefined || message === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned no completion choice`,
      provider,
      model: requestedModel,
    });
  }
  const tools = asArray(message.tool_calls)
    .map((item, index) => toolCallFromUnknown(item, `call-${index}`))
    .filter((item): item is ToolCallContent => item !== undefined);
  const reasoningText =
    dialect === "reasoning_content"
      ? asString(message.reasoning_content)
      : dialect === "reasoning_details"
        ? asString(message.reasoning)
        : undefined;
  const state = providerStateFromMessage(message, dialect);
  return {
    ...(asString(root.id) === undefined ? {} : { id: asString(root.id) as string }),
    provider,
    model: asString(root.model) ?? requestedModel,
    content: contentFromTextAndTools(asString(message.content), tools, reasoningText, state),
    finishReason: finishReason(choice.finish_reason),
    ...(usageFromChat(root.usage) === undefined
      ? {}
      : { usage: usageFromChat(root.usage) as TokenUsage }),
    ...(state === undefined ? {} : { providerState: state }),
  };
};

interface ToolAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAiCompatibleProvider extends BaseLlmProvider {
  readonly id: string;
  readonly kind: string;
  readonly #config: OpenAiCompatibleConfig;
  readonly #fetch: FetchLike | undefined;

  constructor(config: OpenAiCompatibleConfig, fetch?: FetchLike) {
    super();
    this.#config = config;
    this.id = config.id ?? "openai-compatible";
    this.kind = config.kind ?? "openai-compatible";
    this.#fetch = fetch;
  }

  capabilities(model = this.#config.model ?? "unconfigured"): ModelCapabilities {
    return capabilitiesWith(
      model,
      {
        streaming: true,
        toolCalling: false,
        parallelToolCalls: false,
        structuredOutput: "none",
        reasoning: false,
        vision: false,
        providerState: true,
      },
      this.#config.capabilities,
    );
  }

  async generate(request: GenerateRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const model = resolveModel(request.model, this.#config.model, this.id);
    this.#assertAuth(model);
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const response = await postJson({
      url: this.#url(),
      provider: this.id,
      model,
      headers: this.#headers(),
      body: mapOpenAiCompatibleRequest(
        request,
        model,
        this.#dialect(),
        false,
        this.#config.providerOptions,
      ),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    return parseOpenAiCompatibleResponse(
      await readJson(response, this.id, model),
      this.id,
      model,
      this.#dialect().reasoning,
    );
  }

  async *stream(
    request: GenerateRequest,
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamEvent> {
    const model = resolveModel(request.model, this.#config.model, this.id);
    this.#assertAuth(model);
    const capabilities = this.capabilities(model);
    assertRequestCapabilities(request, capabilities, this.id);
    if (!capabilities.streaming) {
      throw new LlmError({
        code: "unsupported_capability",
        message: `${this.id} model ${model} does not support streaming`,
        provider: this.id,
        model,
      });
    }
    const response = await postJson({
      url: this.#url(),
      provider: this.id,
      model,
      headers: { accept: "text/event-stream", ...this.#headers() },
      body: mapOpenAiCompatibleRequest(
        request,
        model,
        this.#dialect(),
        true,
        this.#config.providerOptions,
      ),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    const values =
      (this.#config.streamProtocol ?? "sse") === "sse"
        ? this.#sseValues(response)
        : parseNdjson<unknown>(response, this.id);
    yield* this.#events(values, model);
  }

  async *#sseValues(response: Response): AsyncGenerator<unknown> {
    for await (const event of parseSse(response, this.id)) {
      if (event.data.trim() === "[DONE]") return;
      yield parseSseJson(event, this.id);
    }
  }

  async *#events(
    values: AsyncIterable<unknown>,
    requestedModel: string,
  ): AsyncGenerator<LlmStreamEvent> {
    let id: string | undefined;
    let model = requestedModel;
    let started = false;
    let text = "";
    let reasoning = "";
    let resultUsage: TokenUsage | undefined;
    let reason: ReturnType<typeof finishReason> = "unknown";
    let state: ProviderState | undefined;
    const reasoningDetails: unknown[] = [];
    const calls = new Map<number, ToolAccumulator>();
    for await (const value of values) {
      const root = asRecord(value);
      if (root === undefined) continue;
      if (root.error !== undefined) {
        yield { type: "error", error: errorFromPayload(root, this.id, model, text) };
        return;
      }
      id = asString(root.id) ?? id;
      model = asString(root.model) ?? model;
      if (!started) {
        started = true;
        yield {
          type: "response_start",
          ...(id === undefined ? {} : { id }),
          provider: this.id,
          model,
        };
      }
      const chunkUsage = usageFromChat(root.usage);
      if (chunkUsage !== undefined) {
        resultUsage = chunkUsage;
        yield { type: "usage", usage: chunkUsage };
      }
      for (const choiceValue of asArray(root.choices)) {
        const choice = asRecord(choiceValue);
        const delta = asRecord(choice?.delta);
        if (choice === undefined || delta === undefined) continue;
        const finish = finishReason(choice.finish_reason);
        if (finish !== "unknown") reason = finish;
        const textDelta = asString(delta.content);
        if (textDelta !== undefined && textDelta !== "") {
          text += textDelta;
          yield { type: "text_delta", delta: textDelta };
        }
        const reasoningDelta = asString(delta.reasoning_content) ?? asString(delta.reasoning);
        if (reasoningDelta !== undefined && reasoningDelta !== "") {
          reasoning += reasoningDelta;
          yield { type: "reasoning_delta", delta: reasoningDelta };
        }
        if (delta.reasoning_details !== undefined) {
          if (Array.isArray(delta.reasoning_details))
            reasoningDetails.push(...asArray(delta.reasoning_details));
          else reasoningDetails.push(delta.reasoning_details);
        }
        for (const callValue of asArray(delta.tool_calls)) {
          const call = asRecord(callValue);
          if (call === undefined) continue;
          const index = asNumber(call.index) ?? 0;
          const fn = asRecord(call.function);
          const existing = calls.get(index);
          if (existing === undefined) {
            const created = {
              id: asString(call.id) ?? `call-${index}`,
              name: asString(fn?.name) ?? "",
              arguments: asString(fn?.arguments) ?? "",
            };
            calls.set(index, created);
            yield {
              type: "tool_call_start",
              index,
              id: created.id,
              name: created.name,
            };
            if (created.arguments !== "") {
              yield { type: "tool_call_delta", index, argumentsDelta: created.arguments };
            }
          } else {
            existing.id = asString(call.id) ?? existing.id;
            existing.name += asString(fn?.name) ?? "";
            const argumentsDelta = asString(fn?.arguments) ?? "";
            existing.arguments += argumentsDelta;
            if (argumentsDelta !== "") {
              yield { type: "tool_call_delta", index, argumentsDelta };
            }
          }
        }
      }
    }
    if (!started) {
      yield { type: "response_start", provider: this.id, model };
    }
    const tools = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        index,
        value: {
          type: "tool_call" as const,
          id: call.id,
          name: call.name,
          arguments: parseArguments(call.arguments),
        },
      }));
    for (const tool of tools) yield { type: "tool_call_end", index: tool.index, call: tool.value };
    if (this.#dialect().reasoning === "reasoning_content" && reasoning !== "") {
      state = { deepseek: { reasoningContent: reasoning } };
    } else if (this.#dialect().reasoning === "reasoning_details" && reasoningDetails.length > 0) {
      state = { openrouter: { reasoningDetails: reasoningDetails as never } };
    }
    const response: LlmResponse = {
      ...(id === undefined ? {} : { id }),
      provider: this.id,
      model,
      content: contentFromTextAndTools(
        text,
        tools.map((tool) => tool.value),
        reasoning === "" ? undefined : reasoning,
        state,
      ),
      finishReason: reason,
      ...(resultUsage === undefined ? {} : { usage: resultUsage }),
      ...(state === undefined ? {} : { providerState: state }),
    };
    yield { type: "response_end", response };
  }

  #url(): string {
    const url = new URL(joinUrl(this.#config.baseUrl, this.#config.path ?? "/v1/chat/completions"));
    Object.entries(this.#config.query ?? {}).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    return url.toString();
  }

  #headers(): Record<string, string> {
    const auth = this.#config.auth ?? { type: "none" };
    return {
      ...this.#config.headers,
      ...(auth.type === "bearer"
        ? { authorization: `Bearer ${auth.token}` }
        : auth.type === "header"
          ? { [auth.name]: auth.value }
          : {}),
    };
  }

  #dialect(): ChatDialect {
    return {
      reasoning: this.#config.reasoningDialect ?? "none",
      requireParameters: this.kind === "openrouter",
    };
  }

  #assertAuth(model: string): void {
    if (this.#config.requireAuthentication !== true) return;
    const auth = this.#config.auth;
    const hasCredential =
      auth !== undefined &&
      auth.type !== "none" &&
      (auth.type === "bearer" ? auth.token.trim() !== "" : auth.value.trim() !== "");
    if (!hasCredential) {
      throw new LlmError({
        code: "authentication",
        message: `No credential was configured for ${this.id}`,
        provider: this.id,
        model,
      });
    }
  }
}
