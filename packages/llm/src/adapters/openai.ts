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
  LlmCallOptions,
  LlmContent,
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
  capabilitiesForModel,
  contentFromTextAndTools,
  errorFromPayload,
  parseArguments,
  stringifyJson,
  usage,
} from "./common.js";

export interface OpenAiProviderConfig {
  readonly id?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly path?: string;
  readonly organization?: string;
  readonly project?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
}

const mapInputContent = (message: LlmMessage): readonly unknown[] =>
  message.content.flatMap((part): readonly unknown[] => {
    switch (part.type) {
      case "text":
        return [
          {
            type: message.role === "assistant" ? "output_text" : "input_text",
            text: part.text,
          },
        ];
      case "image":
        return [
          {
            type: "input_image",
            image_url:
              part.source.type === "url"
                ? part.source.url
                : `data:${part.source.mediaType};base64,${part.source.data}`,
            ...(part.detail === undefined ? {} : { detail: part.detail }),
          },
        ];
      default:
        return [];
    }
  });

const stateItems = (state: ProviderState | undefined): readonly unknown[] => {
  const openai = asRecord(state?.openai);
  return asArray(openai?.inputItems);
};

export const mapOpenAiResponsesInput = (
  messages: readonly LlmMessage[],
  requestState?: ProviderState,
): readonly unknown[] => [
  ...stateItems(requestState),
  ...messages.flatMap((message) => {
    const normalContent = mapInputContent(message);
    const items: unknown[] = [...stateItems(message.providerState)];
    if (normalContent.length > 0) {
      items.push({
        role: message.role === "tool" ? "user" : message.role,
        content: normalContent,
      });
    }
    for (const part of message.content) {
      if (part.type === "tool_call") {
        items.push({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.arguments),
        });
      } else if (part.type === "tool_result") {
        items.push({
          type: "function_call_output",
          call_id: part.toolCallId,
          output: stringifyJson(part.output),
        });
      }
    }
    return items;
  }),
];

const mapToolChoice = (choice: GenerateRequest["toolChoice"]): unknown => {
  if (choice === undefined) return undefined;
  if (choice.type === "named") return { type: "function", name: choice.name };
  return choice.type;
};

export const mapOpenAiResponsesRequest = (
  request: GenerateRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> => ({
  model,
  input: mapOpenAiResponsesInput(request.messages, request.providerState),
  stream,
  store: false,
  include: ["reasoning.encrypted_content"],
  ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
  ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  ...(request.tools === undefined || request.tools.length === 0
    ? {}
    : {
        tools: request.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          parameters: tool.inputSchema,
          strict: tool.strict ?? false,
        })),
      }),
  ...(mapToolChoice(request.toolChoice) === undefined
    ? {}
    : { tool_choice: mapToolChoice(request.toolChoice) }),
  ...(request.responseFormat === undefined || request.responseFormat.type === "text"
    ? {}
    : request.responseFormat.type === "json_object"
      ? { text: { format: { type: "json_object" } } }
      : {
          text: {
            format: {
              type: "json_schema",
              name: request.responseFormat.name,
              schema: request.responseFormat.schema,
              strict: request.responseFormat.strict ?? true,
              ...(request.responseFormat.description === undefined
                ? {}
                : { description: request.responseFormat.description }),
            },
          },
        }),
  ...(request.reasoning?.enabled !== true
    ? {}
    : {
        reasoning: {
          ...(request.reasoning.effort === undefined ? {} : { effort: request.reasoning.effort }),
          ...(request.reasoning.includeSummary === true ? { summary: "auto" } : {}),
        },
      }),
});

const outputState = (root: Record<string, unknown>): ProviderState | undefined => {
  const preserved = asArray(root.output).filter((item) => {
    const type = asString(asRecord(item)?.type);
    return type === "reasoning";
  });
  const responseId = asString(root.id);
  if (preserved.length === 0 && responseId === undefined) return undefined;
  return {
    openai: {
      ...(responseId === undefined ? {} : { responseId }),
      inputItems: preserved as never,
    },
  };
};

const responseUsage = (value: unknown): TokenUsage | undefined => {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  return usage({
    input: record.input_tokens,
    output: record.output_tokens,
    total: record.total_tokens,
    reasoning: asRecord(record.output_tokens_details)?.reasoning_tokens,
    cacheRead: asRecord(record.input_tokens_details)?.cached_tokens,
  });
};

export const parseOpenAiResponsesResponse = (
  payload: unknown,
  provider: string,
  requestedModel: string,
): LlmResponse => {
  const root = asRecord(payload);
  if (root === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned an invalid Responses envelope`,
      provider,
      model: requestedModel,
    });
  }
  if (root.error !== undefined) throw errorFromPayload(root, provider, requestedModel);
  const content: LlmContent[] = [];
  let hasTools = false;
  let wasRefused = false;
  for (const itemValue of asArray(root.output)) {
    const item = asRecord(itemValue);
    const type = asString(item?.type);
    if (item === undefined) continue;
    if (type === "message") {
      for (const partValue of asArray(item.content)) {
        const part = asRecord(partValue);
        if (part === undefined) continue;
        if (part.type === "output_text" && typeof part.text === "string") {
          content.push({ type: "text", text: part.text });
        } else if (part.type === "refusal" && typeof part.refusal === "string") {
          wasRefused = true;
          content.push({ type: "text", text: part.refusal });
        }
      }
    } else if (type === "function_call") {
      hasTools = true;
      content.push({
        type: "tool_call",
        id: asString(item.call_id) ?? asString(item.id) ?? `call-${content.length}`,
        name: asString(item.name) ?? "",
        arguments: parseArguments(item.arguments),
      });
    } else if (type === "reasoning") {
      const summary = asArray(item.summary)
        .map((entry) => asString(asRecord(entry)?.text))
        .filter((entry): entry is string => entry !== undefined)
        .join("\n");
      content.push({
        type: "reasoning",
        ...(summary === "" ? {} : { text: summary }),
        providerState: { openai: { item: item as never } },
      });
    }
  }
  const state = outputState(root);
  const status = asString(root.status);
  const incompleteReason = asString(asRecord(root.incomplete_details)?.reason);
  return {
    ...(asString(root.id) === undefined ? {} : { id: asString(root.id) as string }),
    provider,
    model: asString(root.model) ?? requestedModel,
    content,
    finishReason:
      status === "failed"
        ? "error"
        : wasRefused || incompleteReason === "content_filter"
          ? "content_filter"
          : incompleteReason === "max_output_tokens"
            ? "length"
            : hasTools
              ? "tool_calls"
              : status === "completed"
                ? "stop"
                : "unknown",
    ...(responseUsage(root.usage) === undefined
      ? {}
      : { usage: responseUsage(root.usage) as TokenUsage }),
    ...(state === undefined ? {} : { providerState: state }),
  };
};

interface ToolAccumulator {
  readonly id: string;
  readonly name: string;
  arguments: string;
}

export class OpenAiProvider extends BaseLlmProvider {
  readonly id: string;
  readonly kind = "openai";
  readonly #config: OpenAiProviderConfig;
  readonly #fetch: FetchLike | undefined;

  constructor(config: OpenAiProviderConfig, fetch?: FetchLike) {
    super();
    this.#config = config;
    this.id = config.id ?? "openai";
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
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const response = await postJson({
      url: joinUrl(
        this.#config.baseUrl ?? "https://api.openai.com",
        this.#config.path ?? "/v1/responses",
      ),
      provider: this.id,
      model,
      headers: this.#headers(),
      body: mapOpenAiResponsesRequest(request, model, false),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    return parseOpenAiResponsesResponse(await readJson(response, this.id, model), this.id, model);
  }

  async *stream(
    request: GenerateRequest,
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamEvent> {
    const requestedModel = resolveModel(request.model, this.#config.model, this.id);
    this.#assertCredential(requestedModel);
    assertRequestCapabilities(request, this.capabilities(requestedModel), this.id);
    const response = await postJson({
      url: joinUrl(
        this.#config.baseUrl ?? "https://api.openai.com",
        this.#config.path ?? "/v1/responses",
      ),
      provider: this.id,
      model: requestedModel,
      headers: { accept: "text/event-stream", ...this.#headers() },
      body: mapOpenAiResponsesRequest(request, requestedModel, true),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });

    let started = false;
    let id: string | undefined;
    let model = requestedModel;
    let text = "";
    let reasoning = "";
    const calls = new Map<number, ToolAccumulator>();
    for await (const event of parseSse(response, this.id)) {
      if (event.data.trim() === "[DONE]") break;
      const payload = asRecord(parseSseJson(event, this.id));
      if (payload === undefined) continue;
      const eventType = asString(payload.type) ?? event.event;
      if (eventType === "error" || eventType === "response.failed") {
        yield { type: "error", error: errorFromPayload(payload, this.id, model, text) };
        return;
      }
      const responseEnvelope = asRecord(payload.response);
      id = asString(responseEnvelope?.id) ?? id;
      model = asString(responseEnvelope?.model) ?? model;
      if (
        !started &&
        (eventType === "response.created" || eventType?.startsWith("response.") === true)
      ) {
        started = true;
        yield {
          type: "response_start",
          ...(id === undefined ? {} : { id }),
          provider: this.id,
          model,
        };
      }
      if (eventType === "response.output_text.delta") {
        const delta = asString(payload.delta) ?? "";
        text += delta;
        if (delta !== "") yield { type: "text_delta", delta };
      } else if (eventType === "response.reasoning_summary_text.delta") {
        const delta = asString(payload.delta) ?? "";
        reasoning += delta;
        if (delta !== "") yield { type: "reasoning_delta", delta };
      } else if (eventType === "response.output_item.added") {
        const item = asRecord(payload.item);
        if (item?.type === "function_call") {
          const index = asNumber(payload.output_index) ?? calls.size;
          const call = {
            id: asString(item.call_id) ?? asString(item.id) ?? `call-${index}`,
            name: asString(item.name) ?? "",
            arguments: asString(item.arguments) ?? "",
          };
          calls.set(index, call);
          yield { type: "tool_call_start", index, id: call.id, name: call.name };
        }
      } else if (eventType === "response.function_call_arguments.delta") {
        const index = asNumber(payload.output_index) ?? 0;
        const delta = asString(payload.delta) ?? "";
        const call = calls.get(index);
        if (call !== undefined) call.arguments += delta;
        if (delta !== "") yield { type: "tool_call_delta", index, argumentsDelta: delta };
      } else if (eventType === "response.function_call_arguments.done") {
        const index = asNumber(payload.output_index) ?? 0;
        const call = calls.get(index);
        if (call !== undefined) {
          call.arguments = asString(payload.arguments) ?? call.arguments;
          yield {
            type: "tool_call_end",
            index,
            call: {
              type: "tool_call",
              id: call.id,
              name: call.name,
              arguments: parseArguments(call.arguments),
            },
          };
        }
      } else if (eventType === "response.completed" && responseEnvelope !== undefined) {
        const completed = parseOpenAiResponsesResponse(responseEnvelope, this.id, model);
        if (completed.usage !== undefined) yield { type: "usage", usage: completed.usage };
        yield { type: "response_end", response: completed };
        return;
      }
    }
    if (!started) yield { type: "response_start", provider: this.id, model };
    const toolContent: ToolCallContent[] = [...calls.values()].map((call) => ({
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: parseArguments(call.arguments),
    }));
    const content = contentFromTextAndTools(text, toolContent, reasoning || undefined);
    yield {
      type: "response_end",
      response: {
        ...(id === undefined ? {} : { id }),
        provider: this.id,
        model,
        content,
        finishReason: toolContent.length > 0 ? "tool_calls" : "unknown",
      },
    };
  }

  #headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.#config.apiKey ?? ""}`,
      ...(this.#config.organization === undefined
        ? {}
        : { "OpenAI-Organization": this.#config.organization }),
      ...(this.#config.project === undefined ? {} : { "OpenAI-Project": this.#config.project }),
      ...this.#config.headers,
    };
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
