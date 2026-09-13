import type { LlmError } from "./errors.js";

/** Values that can safely cross an LLM provider boundary. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** JSON Schema is intentionally vendor-neutral; adapters may support different subsets. */
export type JsonSchema = boolean | JsonObject;

/** Opaque state that an adapter needs to round-trip (for example thought signatures). */
export type ProviderState = JsonObject;

export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

export interface ImageContent {
  readonly type: "image";
  readonly source:
    | { readonly type: "url"; readonly url: string }
    | { readonly type: "base64"; readonly mediaType: string; readonly data: string };
  readonly detail?: "auto" | "low" | "high";
}

export interface ToolCallContent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly providerState?: ProviderState;
}

export interface ToolResultContent {
  readonly type: "tool_result";
  readonly toolCallId: string;
  readonly name?: string;
  readonly output: JsonValue;
  readonly isError?: boolean;
}

export interface ReasoningContent {
  readonly type: "reasoning";
  /** May be absent when a provider returns only an encrypted/redacted reasoning block. */
  readonly text?: string;
  readonly redacted?: boolean;
  readonly providerState?: ProviderState;
}

export type LlmContent =
  | TextContent
  | ImageContent
  | ToolCallContent
  | ToolResultContent
  | ReasoningContent;

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: readonly LlmContent[];
  readonly name?: string;
  /** State is opaque to the domain and must be returned unchanged in a follow-up turn. */
  readonly providerState?: ProviderState;
}

export interface LlmTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchema;
  readonly strict?: boolean;
}

export type ToolChoice =
  | { readonly type: "auto" }
  | { readonly type: "none" }
  | { readonly type: "required" }
  | { readonly type: "named"; readonly name: string };

export type ResponseFormat =
  | { readonly type: "text" }
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly name: string;
      readonly schema: JsonSchema;
      readonly description?: string;
      readonly strict?: boolean;
    };

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "max";

export interface ReasoningOptions {
  readonly enabled?: boolean;
  readonly effort?: ReasoningEffort;
  readonly maxTokens?: number;
  readonly includeSummary?: boolean;
}

export interface GenerateRequest {
  /** Optional when the provider was configured with a default model. */
  readonly model?: string;
  readonly messages: readonly LlmMessage[];
  readonly tools?: readonly LlmTool[];
  readonly toolChoice?: ToolChoice;
  readonly responseFormat?: ResponseFormat;
  readonly reasoning?: ReasoningOptions;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly providerState?: ProviderState;
}

export type StructuredGenerateRequest = Omit<GenerateRequest, "responseFormat"> & {
  readonly schema: JsonSchema;
  readonly schemaName?: string;
  readonly schemaDescription?: string;
  readonly strict?: boolean;
};

export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "cancelled"
  | "unknown";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface LlmResponse {
  readonly id?: string;
  readonly provider: string;
  readonly model: string;
  readonly content: readonly LlmContent[];
  readonly finishReason: FinishReason;
  readonly usage?: TokenUsage;
  readonly providerState?: ProviderState;
}

export interface StructuredLlmResponse<T = JsonValue> {
  readonly value: T;
  readonly response: LlmResponse;
}

export type StructuredOutputSupport = "none" | "json_object" | "json_schema";

export interface ModelCapabilities {
  readonly model: string;
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly parallelToolCalls: boolean;
  readonly structuredOutput: StructuredOutputSupport;
  readonly reasoning: boolean;
  readonly vision: boolean;
  readonly providerState: boolean;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
}

export interface LlmCallOptions {
  readonly signal?: AbortSignal;
}

export type LlmStreamEvent =
  | {
      readonly type: "response_start";
      readonly id?: string;
      readonly provider: string;
      readonly model: string;
    }
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "reasoning_delta"; readonly delta: string }
  | {
      readonly type: "tool_call_start";
      readonly index: number;
      readonly id: string;
      readonly name: string;
    }
  | { readonly type: "tool_call_delta"; readonly index: number; readonly argumentsDelta: string }
  | { readonly type: "tool_call_end"; readonly index: number; readonly call: ToolCallContent }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "response_end"; readonly response: LlmResponse }
  | { readonly type: "error"; readonly error: LlmError };

export const textContent = (text: string): TextContent => ({ type: "text", text });

export const message = (role: LlmRole, text: string): LlmMessage => ({
  role,
  content: [textContent(text)],
});

export const responseText = (response: Pick<LlmResponse, "content">): string =>
  response.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");

export const responseToolCalls = (
  response: Pick<LlmResponse, "content">,
): readonly ToolCallContent[] =>
  response.content.filter((part): part is ToolCallContent => part.type === "tool_call");
