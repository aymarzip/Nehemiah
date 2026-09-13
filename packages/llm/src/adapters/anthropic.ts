import { LlmError } from "../errors.js";
import { BaseLlmProvider, assertRequestCapabilities, resolveModel } from "../provider.js";
import {
  joinUrl,
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
  LlmContent,
  LlmMessage,
  LlmResponse,
  LlmStreamEvent,
  ModelCapabilities,
  ProviderState,
  TokenUsage,
} from "../types.js";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  capabilitiesForModel,
  errorFromPayload,
  finishReason,
  jsonObject,
  messageText,
  stringifyJson,
  usage,
} from "./common.js";

export interface AnthropicProviderConfig {
  readonly id?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly path?: string;
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
}

const preservedBlocks = (state: ProviderState | undefined): readonly unknown[] => {
  const anthropic = asRecord(state?.anthropic);
  return asArray(anthropic?.contentBlocks);
};

const mapAnthropicContent = (message: LlmMessage): readonly unknown[] => [
  ...preservedBlocks(message.providerState),
  ...message.content.flatMap((part): readonly unknown[] => {
    switch (part.type) {
      case "text":
        return [{ type: "text", text: part.text }];
      case "image":
        return [
          {
            type: "image",
            source:
              part.source.type === "base64"
                ? {
                    type: "base64",
                    media_type: part.source.mediaType,
                    data: part.source.data,
                  }
                : { type: "url", url: part.source.url },
          },
        ];
      case "tool_call":
        return [{ type: "tool_use", id: part.id, name: part.name, input: part.arguments }];
      case "tool_result":
        return [
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: stringifyJson(part.output),
            is_error: part.isError ?? false,
          },
        ];
      case "reasoning":
        return [];
    }
  }),
];

const toolChoice = (choice: GenerateRequest["toolChoice"]): unknown => {
  if (choice === undefined) return undefined;
  if (choice.type === "named") return { type: "tool", name: choice.name };
  if (choice.type === "required") return { type: "any" };
  return { type: choice.type };
};

export const mapAnthropicRequest = (
  request: GenerateRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> => {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map(messageText)
    .filter(Boolean)
    .join("\n\n");
  const messages = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: mapAnthropicContent(message),
    }));
  const structured =
    request.responseFormat?.type === "json_schema"
      ? {
          format: {
            type: "json_schema",
            name: request.responseFormat.name,
            schema: request.responseFormat.schema,
          },
        }
      : undefined;
  return {
    model,
    messages,
    max_tokens: request.maxOutputTokens ?? 1_024,
    stream,
    ...(system === "" ? {} : { system }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.stopSequences === undefined ? {} : { stop_sequences: request.stopSequences }),
    ...(request.tools === undefined || request.tools.length === 0
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            input_schema: tool.inputSchema,
            ...(tool.strict === undefined ? {} : { strict: tool.strict }),
          })),
        }),
    ...(toolChoice(request.toolChoice) === undefined
      ? {}
      : { tool_choice: toolChoice(request.toolChoice) }),
    ...(structured === undefined ? {} : { output_config: structured }),
    ...(request.reasoning?.enabled !== true
      ? {}
      : request.reasoning.maxTokens === undefined
        ? {
            thinking: { type: "adaptive" },
            ...(request.reasoning.effort === undefined
              ? {}
              : { output_config: { ...structured, effort: request.reasoning.effort } }),
          }
        : {
            thinking: { type: "enabled", budget_tokens: request.reasoning.maxTokens },
          }),
  };
};

const anthropicUsage = (value: unknown): TokenUsage | undefined => {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  return usage({
    input: record.input_tokens,
    output: record.output_tokens,
    cacheRead: record.cache_read_input_tokens,
    cacheWrite: record.cache_creation_input_tokens,
  });
};

export const parseAnthropicResponse = (
  payload: unknown,
  provider: string,
  requestedModel: string,
): LlmResponse => {
  const root = asRecord(payload);
  if (root === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned an invalid Messages envelope`,
      provider,
      model: requestedModel,
    });
  }
  if (root.type === "error" || root.error !== undefined) {
    throw errorFromPayload(root, provider, requestedModel);
  }
  const content: LlmContent[] = [];
  const stateBlocks: unknown[] = [];
  for (const value of asArray(root.content)) {
    const block = asRecord(value);
    if (block === undefined) continue;
    if (block.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_call",
        id: asString(block.id) ?? `tool-${content.length}`,
        name: asString(block.name) ?? "",
        arguments: jsonObject(block.input),
      });
    } else if (block.type === "thinking" || block.type === "redacted_thinking") {
      stateBlocks.push(block);
      content.push({
        type: "reasoning",
        ...(asString(block.thinking) === undefined
          ? {}
          : { text: asString(block.thinking) as string }),
        ...(block.type === "redacted_thinking" ? { redacted: true } : {}),
        providerState: { anthropic: { contentBlocks: [block as never] } },
      });
    }
  }
  const state: ProviderState | undefined =
    stateBlocks.length === 0 ? undefined : { anthropic: { contentBlocks: stateBlocks as never } };
  return {
    ...(asString(root.id) === undefined ? {} : { id: asString(root.id) as string }),
    provider,
    model: asString(root.model) ?? requestedModel,
    content,
    finishReason: finishReason(root.stop_reason),
    ...(anthropicUsage(root.usage) === undefined
      ? {}
      : { usage: anthropicUsage(root.usage) as TokenUsage }),
    ...(state === undefined ? {} : { providerState: state }),
  };
};

interface StreamBlock {
  type: "text" | "tool" | "thinking" | "redacted";
  id: string;
  name: string;
  text: string;
  json: string;
  signature: string;
  raw: Record<string, unknown>;
}

export class AnthropicProvider extends BaseLlmProvider {
  readonly id: string;
  readonly kind = "anthropic";
  readonly #config: AnthropicProviderConfig;
  readonly #fetch: FetchLike | undefined;

  constructor(config: AnthropicProviderConfig, fetch?: FetchLike) {
    super();
    this.id = config.id ?? "anthropic";
    this.#config = config;
    this.#fetch = fetch;
  }

  capabilities(model = this.#config.model ?? "unconfigured"): ModelCapabilities {
    return capabilitiesForModel(
      model,
      this.#config.model,
      {
        streaming: true,
        toolCalling: true,
        parallelToolCalls: true,
        structuredOutput: "json_schema",
        reasoning: true,
        vision: true,
        providerState: true,
      },
      this.#config.capabilities,
    );
  }

  async generate(request: GenerateRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const model = resolveModel(request.model, this.#config.model, this.id);
    this.#assertCredential(model);
    this.#assertRequest(request, model);
    const response = await postJson({
      url: joinUrl(
        this.#config.baseUrl ?? "https://api.anthropic.com",
        this.#config.path ?? "/v1/messages",
      ),
      provider: this.id,
      model,
      headers: this.#headers(),
      body: mapAnthropicRequest(request, model, false),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    return parseAnthropicResponse(await readJson(response, this.id, model), this.id, model);
  }

  async *stream(
    request: GenerateRequest,
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamEvent> {
    const requestedModel = resolveModel(request.model, this.#config.model, this.id);
    this.#assertCredential(requestedModel);
    this.#assertRequest(request, requestedModel);
    const response = await postJson({
      url: joinUrl(
        this.#config.baseUrl ?? "https://api.anthropic.com",
        this.#config.path ?? "/v1/messages",
      ),
      provider: this.id,
      model: requestedModel,
      headers: { accept: "text/event-stream", ...this.#headers() },
      body: mapAnthropicRequest(request, requestedModel, true),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    let id: string | undefined;
    let model = requestedModel;
    let reason: ReturnType<typeof finishReason> = "unknown";
    let resultUsage: TokenUsage | undefined;
    let started = false;
    const blocks = new Map<number, StreamBlock>();
    for await (const event of parseSse(response, this.id)) {
      const payload = asRecord(parseSseJson(event, this.id));
      if (payload === undefined) continue;
      const eventType = asString(payload.type) ?? event.event;
      if (eventType === "error") {
        yield { type: "error", error: errorFromPayload(payload, this.id, model) };
        return;
      }
      if (eventType === "message_start") {
        const message = asRecord(payload.message);
        id = asString(message?.id);
        model = asString(message?.model) ?? model;
        resultUsage = anthropicUsage(message?.usage);
        started = true;
        yield {
          type: "response_start",
          ...(id === undefined ? {} : { id }),
          provider: this.id,
          model,
        };
      } else if (eventType === "content_block_start") {
        const index = asNumber(payload.index) ?? blocks.size;
        const block = asRecord(payload.content_block) ?? {};
        const type =
          block.type === "tool_use"
            ? "tool"
            : block.type === "thinking"
              ? "thinking"
              : block.type === "redacted_thinking"
                ? "redacted"
                : "text";
        const stored: StreamBlock = {
          type,
          id: asString(block.id) ?? `tool-${index}`,
          name: asString(block.name) ?? "",
          text: asString(block.text) ?? asString(block.thinking) ?? "",
          json: "",
          signature: asString(block.signature) ?? "",
          raw: block,
        };
        blocks.set(index, stored);
        if (type === "tool") {
          yield { type: "tool_call_start", index, id: stored.id, name: stored.name };
        }
      } else if (eventType === "content_block_delta") {
        const index = asNumber(payload.index) ?? 0;
        const delta = asRecord(payload.delta) ?? {};
        const block = blocks.get(index);
        if (block === undefined) continue;
        if (delta.type === "text_delta") {
          const value = asString(delta.text) ?? "";
          block.text += value;
          if (value !== "") yield { type: "text_delta", delta: value };
        } else if (delta.type === "thinking_delta") {
          const value = asString(delta.thinking) ?? "";
          block.text += value;
          if (value !== "") yield { type: "reasoning_delta", delta: value };
        } else if (delta.type === "signature_delta") {
          block.signature += asString(delta.signature) ?? "";
        } else if (delta.type === "input_json_delta") {
          const value = asString(delta.partial_json) ?? "";
          block.json += value;
          if (value !== "") yield { type: "tool_call_delta", index, argumentsDelta: value };
        }
      } else if (eventType === "content_block_stop") {
        const index = asNumber(payload.index) ?? 0;
        const block = blocks.get(index);
        if (block?.type === "tool") {
          yield {
            type: "tool_call_end",
            index,
            call: {
              type: "tool_call",
              id: block.id,
              name: block.name,
              arguments: (() => {
                try {
                  return jsonObject(JSON.parse(block.json) as unknown);
                } catch {
                  return {};
                }
              })(),
            },
          };
        }
      } else if (eventType === "message_delta") {
        reason = finishReason(asRecord(payload.delta)?.stop_reason);
        const output = asNumber(asRecord(payload.usage)?.output_tokens);
        if (output !== undefined) {
          const base = resultUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          resultUsage = { ...base, outputTokens: output, totalTokens: base.inputTokens + output };
          yield { type: "usage", usage: resultUsage };
        }
      }
    }
    if (!started) yield { type: "response_start", provider: this.id, model };
    const content: LlmContent[] = [];
    const stateBlocks: unknown[] = [];
    for (const [index, block] of [...blocks.entries()].sort(([a], [b]) => a - b)) {
      if (block.type === "text" && block.text !== "")
        content.push({ type: "text", text: block.text });
      else if (block.type === "tool") {
        const input: JsonObject = (() => {
          try {
            return jsonObject(JSON.parse(block.json) as unknown);
          } catch {
            return {};
          }
        })();
        content.push({ type: "tool_call", id: block.id, name: block.name, arguments: input });
      } else {
        const stateBlock =
          block.type === "redacted"
            ? block.raw
            : {
                ...block.raw,
                type: "thinking",
                thinking: block.text,
                signature: block.signature,
              };
        stateBlocks.push(stateBlock);
        content.push({
          type: "reasoning",
          ...(block.text === "" ? {} : { text: block.text }),
          ...(block.type === "redacted" ? { redacted: true } : {}),
          providerState: { anthropic: { contentBlocks: [stateBlock as never] } },
        });
      }
      void index;
    }
    const state: ProviderState | undefined =
      stateBlocks.length === 0 ? undefined : { anthropic: { contentBlocks: stateBlocks as never } };
    yield {
      type: "response_end",
      response: {
        ...(id === undefined ? {} : { id }),
        provider: this.id,
        model,
        content,
        finishReason: reason,
        ...(resultUsage === undefined ? {} : { usage: resultUsage }),
        ...(state === undefined ? {} : { providerState: state }),
      },
    };
  }

  #headers(): Record<string, string> {
    return {
      "x-api-key": this.#config.apiKey ?? "",
      "anthropic-version": this.#config.apiVersion ?? "2023-06-01",
      ...this.#config.headers,
    };
  }

  #assertRequest(request: GenerateRequest, model: string): void {
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    if (
      request.reasoning?.enabled === true &&
      request.reasoning.maxTokens !== undefined &&
      (request.toolChoice?.type === "required" || request.toolChoice?.type === "named")
    ) {
      throw new LlmError({
        code: "unsupported_capability",
        message: `${this.id} model ${model} cannot combine manual extended thinking with forced tool choice`,
        provider: this.id,
        model,
      });
    }
  }

  #assertCredential(model: string): void {
    if (this.#config.apiKey?.trim()) return;
    throw new LlmError({
      code: "authentication",
      message: `No credential was configured for ${this.id}`,
      provider: this.id,
      model,
    });
  }
}
