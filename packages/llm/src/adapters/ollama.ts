import { LlmError } from "../errors.js";
import { BaseLlmProvider, assertRequestCapabilities, resolveModel } from "../provider.js";
import { joinUrl, parseNdjson, postJson, readJson, type FetchLike } from "../transport.js";
import type {
  FinishReason,
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
  asRecord,
  asString,
  capabilitiesWith,
  errorFromPayload,
  finishReason,
  jsonObject,
  messageText,
  stringifyJson,
  usage,
} from "./common.js";

export interface OllamaProviderConfig {
  readonly id?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly path?: string;
  /** Optional for Ollama Cloud; local Ollama needs no credential. */
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
}

const preservedMessage = (state: ProviderState | undefined): Record<string, unknown> => {
  const ollama = asRecord(state?.ollama);
  return asRecord(ollama?.message) ?? {};
};

const mapOllamaMessages = (message: LlmMessage): readonly Record<string, unknown>[] => {
  const toolCalls = message.content
    .filter((part) => part.type === "tool_call")
    .map((call) => ({
      function: { name: call.name, arguments: call.arguments },
    }));
  const toolResults = message.content.filter((part) => part.type === "tool_result");
  const images = message.content
    .filter(
      (part): part is Extract<LlmMessage["content"][number], { type: "image" }> =>
        part.type === "image" && part.source.type === "base64",
    )
    .map((part) => (part.source.type === "base64" ? part.source.data : ""));
  const text = messageText(message);
  const primary =
    text === "" && toolCalls.length === 0 && images.length === 0
      ? []
      : [
          {
            ...preservedMessage(message.providerState),
            role: message.role === "tool" ? "user" : message.role,
            content: text,
            ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
            ...(images.length === 0 ? {} : { images }),
          },
        ];
  return [
    ...primary,
    ...toolResults.map((result) => ({
      role: "tool",
      content: stringifyJson(result.output),
      ...(result.name === undefined ? {} : { tool_name: result.name }),
    })),
  ];
};

export const mapOllamaRequest = (
  request: GenerateRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> => ({
  model,
  messages: request.messages.flatMap(mapOllamaMessages),
  stream,
  ...(request.tools === undefined || request.tools.length === 0
    ? {}
    : {
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            parameters: tool.inputSchema,
          },
        })),
      }),
  ...(request.responseFormat === undefined || request.responseFormat.type === "text"
    ? {}
    : request.responseFormat.type === "json_object"
      ? { format: "json" }
      : { format: request.responseFormat.schema }),
  ...(request.reasoning?.enabled !== true
    ? {}
    : {
        think:
          request.reasoning.effort === undefined
            ? true
            : request.reasoning.effort === "minimal"
              ? "low"
              : request.reasoning.effort,
      }),
  options: {
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }),
    ...(request.stopSequences === undefined ? {} : { stop: request.stopSequences }),
  },
});

const ollamaUsage = (root: Record<string, unknown>): TokenUsage | undefined =>
  usage({ input: root.prompt_eval_count, output: root.eval_count });

export const parseOllamaResponse = (
  payload: unknown,
  provider: string,
  requestedModel: string,
): LlmResponse => {
  const root = asRecord(payload);
  if (root === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned an invalid chat envelope`,
      provider,
      model: requestedModel,
    });
  }
  if (root.error !== undefined) throw errorFromPayload(root, provider, requestedModel);
  const message = asRecord(root.message);
  if (message === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned no chat message`,
      provider,
      model: requestedModel,
    });
  }
  const content: LlmContent[] = [];
  const thinking = asString(message.thinking);
  if (thinking !== undefined && thinking !== "")
    content.push({ type: "reasoning", text: thinking });
  const text = asString(message.content);
  if (text !== undefined && text !== "") content.push({ type: "text", text });
  asArray(message.tool_calls).forEach((value, index) => {
    const fn = asRecord(asRecord(value)?.function);
    if (fn === undefined) return;
    content.push({
      type: "tool_call",
      id: asString(asRecord(value)?.id) ?? `ollama-call-${index}`,
      name: asString(fn.name) ?? "",
      arguments: jsonObject(fn.arguments),
    });
  });
  const state: ProviderState = { ollama: { message: message as never } };
  return {
    provider,
    model: asString(root.model) ?? requestedModel,
    content,
    finishReason: content.some((part) => part.type === "tool_call")
      ? "tool_calls"
      : finishReason(root.done_reason ?? (root.done === true ? "stop" : undefined)),
    ...(ollamaUsage(root) === undefined ? {} : { usage: ollamaUsage(root) as TokenUsage }),
    providerState: state,
  };
};

export class OllamaProvider extends BaseLlmProvider {
  readonly id: string;
  readonly kind = "ollama";
  readonly #config: OllamaProviderConfig;
  readonly #fetch: FetchLike | undefined;

  constructor(config: OllamaProviderConfig, fetch?: FetchLike) {
    super();
    this.id = config.id ?? "ollama";
    this.#config = config;
    this.#fetch = fetch;
  }

  capabilities(model = this.#config.model ?? "unconfigured"): ModelCapabilities {
    return capabilitiesWith(
      model,
      {
        streaming: true,
        toolCalling: false,
        parallelToolCalls: false,
        structuredOutput: "json_schema",
        reasoning: false,
        vision: false,
        providerState: true,
      },
      this.#config.capabilities,
    );
  }

  async generate(request: GenerateRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const model = resolveModel(request.model, this.#config.model, this.id);
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const response = await postJson({
      url: joinUrl(
        this.#config.baseUrl ?? "http://127.0.0.1:11434",
        this.#config.path ?? "/api/chat",
      ),
      provider: this.id,
      model,
      headers: this.#headers(),
      body: mapOllamaRequest(request, model, false),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    return parseOllamaResponse(await readJson(response, this.id, model), this.id, model);
  }

  async *stream(
    request: GenerateRequest,
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamEvent> {
    const model = resolveModel(request.model, this.#config.model, this.id);
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const response = await postJson({
      url: joinUrl(
        this.#config.baseUrl ?? "http://127.0.0.1:11434",
        this.#config.path ?? "/api/chat",
      ),
      provider: this.id,
      model,
      headers: this.#headers(),
      body: mapOllamaRequest(request, model, true),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    yield { type: "response_start", provider: this.id, model };
    const content: LlmContent[] = [];
    const toolCalls: ToolCallContent[] = [];
    let reasoning = "";
    let text = "";
    let resultUsage: TokenUsage | undefined;
    let reason: FinishReason = "unknown";
    for await (const value of parseNdjson<unknown>(response, this.id)) {
      const root = asRecord(value);
      if (root === undefined) continue;
      if (root.error !== undefined) {
        yield { type: "error", error: errorFromPayload(root, this.id, model, text) };
        return;
      }
      const message = asRecord(root.message) ?? {};
      const textDelta = asString(message.content) ?? "";
      if (textDelta !== "") {
        text += textDelta;
        yield { type: "text_delta", delta: textDelta };
      }
      const reasoningDelta = asString(message.thinking) ?? "";
      if (reasoningDelta !== "") {
        reasoning += reasoningDelta;
        yield { type: "reasoning_delta", delta: reasoningDelta };
      }
      for (const toolValue of asArray(message.tool_calls)) {
        const fn = asRecord(asRecord(toolValue)?.function);
        if (fn === undefined) continue;
        const index = toolCalls.length;
        const call: ToolCallContent = {
          type: "tool_call",
          id: asString(asRecord(toolValue)?.id) ?? `ollama-call-${index}`,
          name: asString(fn.name) ?? "",
          arguments: jsonObject(fn.arguments),
        };
        toolCalls.push(call);
        yield { type: "tool_call_start", index, id: call.id, name: call.name };
        yield { type: "tool_call_delta", index, argumentsDelta: JSON.stringify(call.arguments) };
        yield { type: "tool_call_end", index, call };
      }
      if (root.done === true) {
        reason = toolCalls.length > 0 ? "tool_calls" : finishReason(root.done_reason ?? "stop");
        resultUsage = ollamaUsage(root);
        if (resultUsage !== undefined) yield { type: "usage", usage: resultUsage };
      }
    }
    if (reasoning !== "") content.push({ type: "reasoning", text: reasoning });
    if (text !== "") content.push({ type: "text", text });
    content.push(...toolCalls);
    const state: ProviderState = {
      ollama: {
        message: {
          role: "assistant",
          content: text,
          ...(reasoning === "" ? {} : { thinking: reasoning }),
          ...(toolCalls.length === 0
            ? {}
            : {
                tool_calls: toolCalls.map((call) => ({
                  function: { name: call.name, arguments: call.arguments },
                })),
              }),
        },
      },
    };
    yield {
      type: "response_end",
      response: {
        provider: this.id,
        model,
        content,
        finishReason: reason,
        ...(resultUsage === undefined ? {} : { usage: resultUsage }),
        providerState: state,
      },
    };
  }

  #headers(): Record<string, string> {
    return {
      ...(this.#config.apiKey === undefined
        ? {}
        : { authorization: `Bearer ${this.#config.apiKey}` }),
      ...this.#config.headers,
    };
  }
}
