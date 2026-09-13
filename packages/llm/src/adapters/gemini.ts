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
  capabilitiesForModel,
  errorFromPayload,
  finishReason,
  jsonObject,
  messageText,
  usage,
} from "./common.js";

export interface GeminiProviderConfig {
  readonly id?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiVersion?: "v1" | "v1beta";
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
}

const allPreservedParts = (state: ProviderState | undefined): readonly unknown[] => {
  const gemini = asRecord(state?.gemini);
  return asArray(gemini?.parts);
};

const mapGeminiParts = (message: LlmMessage): readonly unknown[] => [
  ...allPreservedParts(message.providerState).filter(
    (part) => asRecord(asRecord(part)?.functionCall) === undefined,
  ),
  ...message.content.flatMap((part): readonly unknown[] => {
    switch (part.type) {
      case "text":
        return [{ text: part.text }];
      case "image":
        return [
          part.source.type === "base64"
            ? { inlineData: { mimeType: part.source.mediaType, data: part.source.data } }
            : { fileData: { fileUri: part.source.url } },
        ];
      case "tool_call": {
        const preserved =
          asRecord(asRecord(part.providerState?.gemini)?.part) ??
          allPreservedParts(message.providerState)
            .map(asRecord)
            .find((candidate) => {
              const fn = asRecord(candidate?.functionCall);
              return asString(fn?.id) === part.id || asString(fn?.name) === part.name;
            });
        return [
          {
            ...(preserved ?? {}),
            functionCall: { name: part.name, args: part.arguments },
          },
        ];
      }
      case "tool_result":
        return [
          {
            functionResponse: {
              name: part.name ?? part.toolCallId,
              response:
                typeof part.output === "object" && part.output !== null
                  ? part.output
                  : { result: part.output },
            },
          },
        ];
      case "reasoning":
        return [];
    }
  }),
];

const toolConfig = (choice: GenerateRequest["toolChoice"]): unknown => {
  if (choice === undefined) return undefined;
  switch (choice.type) {
    case "auto":
      return { functionCallingConfig: { mode: "AUTO" } };
    case "none":
      return { functionCallingConfig: { mode: "NONE" } };
    case "required":
      return { functionCallingConfig: { mode: "ANY" } };
    case "named":
      return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] } };
  }
};

export const mapGeminiRequest = (request: GenerateRequest): Record<string, unknown> => {
  const systemText = request.messages
    .filter((message) => message.role === "system")
    .map(messageText)
    .filter(Boolean)
    .join("\n\n");
  const contents = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: mapGeminiParts(message),
    }));
  return {
    contents,
    ...(systemText === "" ? {} : { systemInstruction: { parts: [{ text: systemText }] } }),
    ...(request.tools === undefined || request.tools.length === 0
      ? {}
      : {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                ...(tool.description === undefined ? {} : { description: tool.description }),
                parametersJsonSchema: tool.inputSchema,
              })),
            },
          ],
        }),
    ...(toolConfig(request.toolChoice) === undefined
      ? {}
      : { toolConfig: toolConfig(request.toolChoice) }),
    generationConfig: {
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.stopSequences === undefined ? {} : { stopSequences: request.stopSequences }),
      ...(request.responseFormat === undefined || request.responseFormat.type === "text"
        ? {}
        : request.responseFormat.type === "json_object"
          ? { responseMimeType: "application/json" }
          : {
              responseMimeType: "application/json",
              responseJsonSchema: request.responseFormat.schema,
            }),
      ...(request.reasoning?.enabled !== true
        ? {}
        : {
            thinkingConfig: {
              includeThoughts: request.reasoning.includeSummary ?? false,
              ...(request.reasoning.maxTokens === undefined
                ? {}
                : { thinkingBudget: request.reasoning.maxTokens }),
            },
          }),
    },
  };
};

const geminiUsage = (value: unknown): TokenUsage | undefined => {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  return usage({
    input: record.promptTokenCount,
    output: record.candidatesTokenCount,
    total: record.totalTokenCount,
    reasoning: record.thoughtsTokenCount,
    cacheRead: record.cachedContentTokenCount,
  });
};

export const parseGeminiResponse = (
  payload: unknown,
  provider: string,
  model: string,
): LlmResponse => {
  const root = asRecord(payload);
  if (root === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned an invalid generateContent envelope`,
      provider,
      model,
    });
  }
  if (root.error !== undefined) throw errorFromPayload(root, provider, model);
  const candidate = asRecord(asArray(root.candidates)[0]);
  const promptBlock = asString(asRecord(root.promptFeedback)?.blockReason);
  if (candidate === undefined && promptBlock === undefined) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned no candidate`,
      provider,
      model,
    });
  }
  const parts = asArray(asRecord(candidate?.content)?.parts);
  const content: LlmContent[] = [];
  const stateParts: unknown[] = [];
  parts.forEach((value, index) => {
    const part = asRecord(value);
    if (part === undefined) return;
    const text = asString(part.text);
    const functionCall = asRecord(part.functionCall);
    const isThought =
      part.thought === true || (functionCall === undefined && part.thoughtSignature !== undefined);
    if (isThought) {
      stateParts.push(part);
      content.push({
        type: "reasoning",
        ...(text === undefined ? {} : { text }),
        providerState: { gemini: { parts: [part as never] } },
      });
    } else if (text !== undefined) {
      content.push({ type: "text", text });
    }
    if (functionCall !== undefined) {
      content.push({
        type: "tool_call",
        id: asString(functionCall.id) ?? `gemini-call-${index}`,
        name: asString(functionCall.name) ?? "",
        arguments: jsonObject(functionCall.args),
        ...(part.thoughtSignature === undefined
          ? {}
          : { providerState: { gemini: { part: part as never } } }),
      });
      if (part.thoughtSignature !== undefined) stateParts.push(part);
    }
  });
  const state: ProviderState | undefined =
    stateParts.length === 0 ? undefined : { gemini: { parts: stateParts as never } };
  return {
    provider,
    model: asString(root.modelVersion) ?? model,
    content,
    finishReason:
      promptBlock === undefined ? finishReason(candidate?.finishReason) : "content_filter",
    ...(geminiUsage(root.usageMetadata) === undefined
      ? {}
      : { usage: geminiUsage(root.usageMetadata) as TokenUsage }),
    ...(state === undefined ? {} : { providerState: state }),
  };
};

export class GeminiProvider extends BaseLlmProvider {
  readonly id: string;
  readonly kind = "gemini";
  readonly #config: GeminiProviderConfig;
  readonly #fetch: FetchLike | undefined;

  constructor(config: GeminiProviderConfig, fetch?: FetchLike) {
    super();
    this.id = config.id ?? "gemini";
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
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const response = await postJson({
      url: this.#url(model, false),
      provider: this.id,
      model,
      headers: this.#headers(),
      body: mapGeminiRequest(request),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    return parseGeminiResponse(await readJson(response, this.id, model), this.id, model);
  }

  async *stream(
    request: GenerateRequest,
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamEvent> {
    const model = resolveModel(request.model, this.#config.model, this.id);
    this.#assertCredential(model);
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const response = await postJson({
      url: this.#url(model, true),
      provider: this.id,
      model,
      headers: { accept: "text/event-stream", ...this.#headers() },
      body: mapGeminiRequest(request),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(this.#config.timeoutMs === undefined ? {} : { timeoutMs: this.#config.timeoutMs }),
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    yield { type: "response_start", provider: this.id, model };
    const content: LlmContent[] = [];
    const stateParts: unknown[] = [];
    let resultUsage: TokenUsage | undefined;
    let reason: FinishReason = "unknown";
    let callIndex = 0;
    for await (const event of parseSse(response, this.id)) {
      const payload = asRecord(parseSseJson(event, this.id));
      if (payload === undefined) continue;
      if (payload.error !== undefined) {
        yield { type: "error", error: errorFromPayload(payload, this.id, model) };
        return;
      }
      const candidate = asRecord(asArray(payload.candidates)[0]);
      const candidateParts = asArray(asRecord(candidate?.content)?.parts);
      for (const value of candidateParts) {
        const part = asRecord(value);
        if (part === undefined) continue;
        const text = asString(part.text);
        const fn = asRecord(part.functionCall);
        const isThought =
          part.thought === true || (fn === undefined && part.thoughtSignature !== undefined);
        if (isThought) {
          stateParts.push(part);
          content.push({
            type: "reasoning",
            ...(text === undefined ? {} : { text }),
            providerState: { gemini: { parts: [part as never] } },
          });
          if (text !== undefined && text !== "") yield { type: "reasoning_delta", delta: text };
        } else if (text !== undefined && text !== "") {
          content.push({ type: "text", text });
          yield { type: "text_delta", delta: text };
        }
        if (fn !== undefined) {
          const index = callIndex++;
          const call: ToolCallContent = {
            type: "tool_call",
            id: asString(fn.id) ?? `gemini-call-${index}`,
            name: asString(fn.name) ?? "",
            arguments: jsonObject(fn.args),
            ...(part.thoughtSignature === undefined
              ? {}
              : { providerState: { gemini: { part: part as never } } }),
          };
          if (part.thoughtSignature !== undefined) stateParts.push(part);
          content.push(call);
          yield { type: "tool_call_start", index, id: call.id, name: call.name };
          yield { type: "tool_call_delta", index, argumentsDelta: JSON.stringify(call.arguments) };
          yield { type: "tool_call_end", index, call };
        }
      }
      const currentReason = finishReason(candidate?.finishReason);
      if (currentReason !== "unknown") reason = currentReason;
      const currentUsage = geminiUsage(payload.usageMetadata);
      if (currentUsage !== undefined) {
        resultUsage = currentUsage;
        yield { type: "usage", usage: currentUsage };
      }
    }
    const state: ProviderState | undefined =
      stateParts.length === 0 ? undefined : { gemini: { parts: stateParts as never } };
    yield {
      type: "response_end",
      response: {
        provider: this.id,
        model,
        content,
        finishReason: reason,
        ...(resultUsage === undefined ? {} : { usage: resultUsage }),
        ...(state === undefined ? {} : { providerState: state }),
      },
    };
  }

  #url(model: string, stream: boolean): string {
    const version = this.#config.apiVersion ?? "v1beta";
    const action = stream ? "streamGenerateContent" : "generateContent";
    const url = new URL(
      joinUrl(
        this.#config.baseUrl ?? "https://generativelanguage.googleapis.com",
        `/${version}/models/${encodeURIComponent(model)}:${action}`,
      ),
    );
    if (stream) url.searchParams.set("alt", "sse");
    return url.toString();
  }

  #headers(): Record<string, string> {
    return { "x-goog-api-key": this.#config.apiKey ?? "", ...this.#config.headers };
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
