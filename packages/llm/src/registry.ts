import { LlmError } from "./errors.js";
import type { LlmProvider } from "./provider.js";
import type {
  GenerateRequest,
  JsonValue,
  LlmCallOptions,
  LlmResponse,
  LlmStreamEvent,
  StructuredGenerateRequest,
  StructuredLlmResponse,
} from "./types.js";

export interface RegistryCallOptions extends LlmCallOptions {
  readonly providerId?: string;
}

/**
 * Provider registration is optional by design. Constructing an empty registry never prevents the
 * application from starting; only an actual AI call reports provider_not_configured.
 */
export class LlmRegistry {
  readonly #providers = new Map<string, LlmProvider>();
  #defaultProviderId: string | undefined;

  constructor(providers: readonly LlmProvider[] = [], defaultProviderId?: string) {
    providers.forEach((provider) => this.register(provider));
    if (defaultProviderId !== undefined) this.setDefault(defaultProviderId);
  }

  get configured(): boolean {
    return this.#providers.size > 0;
  }

  get defaultProviderId(): string | undefined {
    return this.#defaultProviderId;
  }

  list(): readonly LlmProvider[] {
    return [...this.#providers.values()];
  }

  register(provider: LlmProvider, options: { readonly makeDefault?: boolean } = {}): void {
    if (this.#providers.has(provider.id)) {
      throw new LlmError({
        code: "invalid_request",
        message: `LLM provider id ${provider.id} is already registered`,
        provider: provider.id,
      });
    }
    this.#providers.set(provider.id, provider);
    if (options.makeDefault === true || this.#defaultProviderId === undefined) {
      this.#defaultProviderId = provider.id;
    }
  }

  unregister(providerId: string): boolean {
    const removed = this.#providers.delete(providerId);
    if (removed && this.#defaultProviderId === providerId) {
      this.#defaultProviderId = this.#providers.keys().next().value;
    }
    return removed;
  }

  setDefault(providerId: string): void {
    if (!this.#providers.has(providerId)) {
      throw this.#notConfigured(providerId);
    }
    this.#defaultProviderId = providerId;
  }

  get(providerId?: string): LlmProvider | undefined {
    const selected = providerId ?? this.#defaultProviderId;
    return selected === undefined ? undefined : this.#providers.get(selected);
  }

  require(providerId?: string): LlmProvider {
    const provider = this.get(providerId);
    if (provider === undefined) throw this.#notConfigured(providerId);
    return provider;
  }

  async generate(
    request: GenerateRequest,
    options: RegistryCallOptions = {},
  ): Promise<LlmResponse> {
    return this.require(options.providerId).generate(
      request,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  }

  async generateStructured<T = JsonValue>(
    request: StructuredGenerateRequest,
    options: RegistryCallOptions = {},
  ): Promise<StructuredLlmResponse<T>> {
    return this.require(options.providerId).generateStructured<T>(
      request,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  }

  stream(
    request: GenerateRequest,
    options: RegistryCallOptions = {},
  ): AsyncIterable<LlmStreamEvent> {
    const provider = this.get(options.providerId);
    if (provider === undefined) {
      const error = this.#notConfigured(options.providerId);
      return (async function* (): AsyncGenerator<LlmStreamEvent> {
        yield { type: "error", error };
      })();
    }
    return provider.stream(
      request,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  }

  #notConfigured(requested?: string): LlmError {
    return new LlmError({
      code: "provider_not_configured",
      message:
        requested === undefined
          ? "No LLM provider is configured"
          : `LLM provider ${requested} is not configured`,
      ...(requested === undefined ? {} : { provider: requested }),
    });
  }
}
