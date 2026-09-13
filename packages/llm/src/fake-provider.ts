import { LlmError, type LlmErrorOptions } from "./errors.js";
import { BaseLlmProvider, assertRequestCapabilities, resolveModel } from "./provider.js";
import {
  responseText,
  textContent,
  type FinishReason,
  type GenerateRequest,
  type JsonValue,
  type LlmCallOptions,
  type LlmContent,
  type LlmResponse,
  type LlmStreamEvent,
  type ModelCapabilities,
  type ProviderState,
  type TokenUsage,
} from "./types.js";

export type FakeOperation = "generate" | "stream";

export interface FakeResponseDefinition {
  readonly text?: string;
  readonly content?: readonly LlmContent[];
  readonly finishReason?: FinishReason;
  readonly usage?: TokenUsage;
  readonly providerState?: ProviderState;
  readonly id?: string;
  readonly model?: string;
}

export interface FakeScenarioContext {
  readonly request: GenerateRequest;
  readonly operation: FakeOperation;
  readonly invocation: number;
}

export interface FakeScenario {
  readonly name?: string;
  readonly operation?: FakeOperation | "any";
  readonly matches?: (context: FakeScenarioContext) => boolean;
  readonly response?:
    | FakeResponseDefinition
    | ((context: FakeScenarioContext) => FakeResponseDefinition | Promise<FakeResponseDefinition>);
  readonly stream?:
    | readonly LlmStreamEvent[]
    | ((
        context: FakeScenarioContext,
      ) => readonly LlmStreamEvent[] | Promise<readonly LlmStreamEvent[]>);
  readonly error?: LlmError | LlmErrorOptions;
  /** Defaults to one; use Infinity for a reusable scenario. */
  readonly times?: number;
}

export interface FakeProviderConfig {
  readonly id?: string;
  readonly model?: string;
  readonly scenarios?: readonly FakeScenario[];
  readonly fallback?: FakeResponseDefinition;
  readonly streamChunkSize?: number;
  readonly capabilities?: Partial<Omit<ModelCapabilities, "model">>;
}

interface StoredScenario {
  readonly scenario: FakeScenario;
  remaining: number;
}

const defaultUsage = (text: string): TokenUsage => {
  const outputTokens = text === "" ? 0 : Math.max(1, Math.ceil(text.length / 4));
  return { inputTokens: 0, outputTokens, totalTokens: outputTokens };
};

/** A deterministic, scenario-driven provider for tests and credential-free development. */
export class FakeProvider extends BaseLlmProvider {
  readonly id: string;
  readonly kind = "fake";
  readonly invocations: FakeScenarioContext[] = [];
  readonly #defaultModel: string;
  readonly #scenarios: StoredScenario[] = [];
  readonly #fallback: FakeResponseDefinition;
  readonly #chunkSize: number;
  readonly #capabilities: Partial<Omit<ModelCapabilities, "model">>;

  constructor(config: FakeProviderConfig = {}) {
    super();
    this.id = config.id ?? "fake";
    this.#defaultModel = config.model ?? "fake-model";
    this.#fallback = config.fallback ?? { text: "Deterministic fake response" };
    this.#chunkSize = Math.max(1, config.streamChunkSize ?? 8);
    this.#capabilities = config.capabilities ?? {};
    config.scenarios?.forEach((scenario) => this.enqueue(scenario));
  }

  enqueue(...scenarios: readonly FakeScenario[]): void {
    scenarios.forEach((scenario) => {
      this.#scenarios.push({ scenario, remaining: scenario.times ?? 1 });
    });
  }

  reset(): void {
    this.#scenarios.splice(0);
    this.invocations.splice(0);
  }

  capabilities(model = this.#defaultModel): ModelCapabilities {
    return {
      model,
      streaming: true,
      toolCalling: true,
      parallelToolCalls: true,
      structuredOutput: "json_schema",
      reasoning: true,
      vision: true,
      providerState: true,
      ...this.#capabilities,
    };
  }

  async generate(request: GenerateRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const model = resolveModel(request.model, this.#defaultModel, this.id);
    if (options?.signal?.aborted === true) throw this.#aborted(model);
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const context = this.#context(request, "generate");
    const scenario = this.#takeScenario(context);
    if (scenario?.error !== undefined) throw this.#scenarioError(scenario.error, model);
    const definition =
      scenario?.response === undefined
        ? this.#fallback
        : typeof scenario.response === "function"
          ? await scenario.response(context)
          : scenario.response;
    return this.#response(definition, model, context.invocation);
  }

  async *stream(
    request: GenerateRequest,
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamEvent> {
    const model = resolveModel(request.model, this.#defaultModel, this.id);
    if (options?.signal?.aborted === true) {
      yield { type: "error", error: this.#aborted(model) };
      return;
    }
    assertRequestCapabilities(request, this.capabilities(model), this.id);
    const context = this.#context(request, "stream");
    const scenario = this.#takeScenario(context);
    if (scenario?.error !== undefined) {
      yield { type: "error", error: this.#scenarioError(scenario.error, model) };
      return;
    }
    if (scenario?.stream !== undefined) {
      const events =
        typeof scenario.stream === "function" ? await scenario.stream(context) : scenario.stream;
      for (const event of events) yield event;
      return;
    }
    const definition =
      scenario?.response === undefined
        ? this.#fallback
        : typeof scenario.response === "function"
          ? await scenario.response(context)
          : scenario.response;
    const response = this.#response(definition, model, context.invocation);
    yield {
      type: "response_start",
      ...(response.id === undefined ? {} : { id: response.id }),
      provider: this.id,
      model: response.model,
    };
    const text = responseText(response);
    for (let offset = 0; offset < text.length; offset += this.#chunkSize) {
      yield { type: "text_delta", delta: text.slice(offset, offset + this.#chunkSize) };
    }
    if (response.usage !== undefined) yield { type: "usage", usage: response.usage };
    yield { type: "response_end", response };
  }

  #context(request: GenerateRequest, operation: FakeOperation): FakeScenarioContext {
    const context = { request, operation, invocation: this.invocations.length + 1 } as const;
    this.invocations.push(context);
    return context;
  }

  #takeScenario(context: FakeScenarioContext): FakeScenario | undefined {
    const found = this.#scenarios.find(
      ({ scenario, remaining }) =>
        remaining > 0 &&
        (scenario.operation === undefined ||
          scenario.operation === "any" ||
          scenario.operation === context.operation) &&
        (scenario.matches?.(context) ?? true),
    );
    if (found === undefined) return undefined;
    if (found.remaining !== Number.POSITIVE_INFINITY) found.remaining -= 1;
    return found.scenario;
  }

  #response(
    definition: FakeResponseDefinition,
    requestedModel: string,
    invocation: number,
  ): LlmResponse {
    const content =
      definition.content ?? (definition.text === undefined ? [] : [textContent(definition.text)]);
    const text = content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    return {
      id: definition.id ?? `fake-${invocation}`,
      provider: this.id,
      model: definition.model ?? requestedModel,
      content,
      finishReason: definition.finishReason ?? "stop",
      usage: definition.usage ?? defaultUsage(text),
      ...(definition.providerState === undefined
        ? {}
        : { providerState: definition.providerState }),
    };
  }

  #scenarioError(error: LlmError | LlmErrorOptions, model: string): LlmError {
    if (error instanceof LlmError) return error;
    return new LlmError({
      ...error,
      provider: error.provider ?? this.id,
      model: error.model ?? model,
    });
  }

  #aborted(model: string): LlmError {
    return new LlmError({
      code: "aborted",
      message: `${this.id} request was aborted`,
      provider: this.id,
      model,
    });
  }
}

export const fakeJsonResponse = (value: JsonValue): FakeResponseDefinition => ({
  text: JSON.stringify(value),
});
