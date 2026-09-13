import { AnthropicProvider, type AnthropicProviderConfig } from "./adapters/anthropic.js";
import { DeepSeekProvider, type DeepSeekProviderConfig } from "./adapters/deepseek.js";
import { GeminiProvider, type GeminiProviderConfig } from "./adapters/gemini.js";
import { OllamaProvider, type OllamaProviderConfig } from "./adapters/ollama.js";
import {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleConfig,
} from "./adapters/openai-compatible.js";
import { OpenAiProvider, type OpenAiProviderConfig } from "./adapters/openai.js";
import { OpenRouterProvider, type OpenRouterProviderConfig } from "./adapters/openrouter.js";
import { LlmError } from "./errors.js";
import { FakeProvider, type FakeProviderConfig } from "./fake-provider.js";
import type { LlmProvider } from "./provider.js";
import { LlmRegistry } from "./registry.js";
import type { FetchLike } from "./transport.js";

export type ProviderConfig =
  | ({ readonly kind: "fake" } & FakeProviderConfig)
  | ({ readonly kind: "openai" } & OpenAiProviderConfig)
  | ({ readonly kind: "gemini" } & GeminiProviderConfig)
  | ({ readonly kind: "anthropic" } & AnthropicProviderConfig)
  | ({ readonly kind: "deepseek" } & DeepSeekProviderConfig)
  | ({ readonly kind: "openrouter" } & OpenRouterProviderConfig)
  | ({ readonly kind: "ollama" } & OllamaProviderConfig)
  | ({ readonly kind: "openai-compatible" } & Omit<OpenAiCompatibleConfig, "kind">);

export type ConfiguredProvider = ProviderConfig & { readonly enabled?: boolean };

export interface LlmConfiguration {
  /** Absence is a valid deterministic-only application configuration. */
  readonly providers?: readonly ConfiguredProvider[];
  readonly defaultProviderId?: string;
}

export interface ProviderFactoryOptions {
  /** Dependency injection point for tests, proxies and hardened transports. */
  readonly fetch?: FetchLike;
}

export const createProvider = (
  config: ProviderConfig,
  options: ProviderFactoryOptions = {},
): LlmProvider => {
  switch (config.kind) {
    case "fake":
      return new FakeProvider(config);
    case "openai":
      return new OpenAiProvider(config, options.fetch);
    case "gemini":
      return new GeminiProvider(config, options.fetch);
    case "anthropic":
      return new AnthropicProvider(config, options.fetch);
    case "deepseek":
      return new DeepSeekProvider(config, options.fetch);
    case "openrouter":
      return new OpenRouterProvider(config, options.fetch);
    case "ollama":
      return new OllamaProvider(config, options.fetch);
    case "openai-compatible":
      return new OpenAiCompatibleProvider(config, options.fetch);
    default: {
      const unreachable: never = config;
      throw new LlmError({
        code: "invalid_request",
        message: `Unsupported LLM provider kind ${String((unreachable as { kind?: unknown }).kind)}`,
      });
    }
  }
};

export const createLlmRegistry = (
  config: LlmConfiguration | undefined,
  options: ProviderFactoryOptions = {},
): LlmRegistry => {
  if (config === undefined) return new LlmRegistry();
  const providers = (config.providers ?? [])
    .filter((provider) => provider.enabled !== false)
    .map((provider) => createProvider(provider, options));
  return new LlmRegistry(providers, config.defaultProviderId);
};
