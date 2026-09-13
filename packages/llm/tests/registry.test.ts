import { describe, expect, it } from "vitest";

import { createLlmRegistry, createProvider, type ProviderConfig } from "../src/factory.js";
import { FakeProvider } from "../src/fake-provider.js";
import { LlmRegistry } from "../src/registry.js";
import { message, responseText } from "../src/types.js";

describe("LlmRegistry", () => {
  it("is valid without providers and reports provider_not_configured only on AI use", async () => {
    const registry = createLlmRegistry(undefined);

    expect(registry.configured).toBe(false);
    expect(registry.list()).toEqual([]);
    await expect(registry.generate({ messages: [message("user", "hello")] })).rejects.toMatchObject(
      {
        code: "provider_not_configured",
      },
    );

    const events = [];
    for await (const event of registry.stream({ messages: [message("user", "hello")] })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      error: { code: "provider_not_configured" },
    });
  });

  it("routes by default or explicit provider id", async () => {
    const first = new FakeProvider({ id: "first", fallback: { text: "one" } });
    const second = new FakeProvider({ id: "second", fallback: { text: "two" } });
    const registry = new LlmRegistry([first, second], "second");

    expect(responseText(await registry.generate({ messages: [] }))).toBe("two");
    expect(responseText(await registry.generate({ messages: [] }, { providerId: "first" }))).toBe(
      "one",
    );
  });

  it("rejects duplicate ids and missing explicit defaults", () => {
    const provider = new FakeProvider({ id: "duplicate" });
    const registry = new LlmRegistry([provider]);

    expect(() => registry.register(provider)).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(() => registry.setDefault("missing")).toThrowError(
      expect.objectContaining({ code: "provider_not_configured" }),
    );
  });
});

describe("provider factory", () => {
  const configs: readonly [ProviderConfig, string][] = [
    [{ kind: "fake" }, "fake"],
    [{ kind: "openai", apiKey: "test", model: "configured-model" }, "openai"],
    [{ kind: "gemini", apiKey: "test", model: "configured-model" }, "gemini"],
    [{ kind: "anthropic", apiKey: "test", model: "configured-model" }, "anthropic"],
    [{ kind: "deepseek", apiKey: "test", model: "configured-model" }, "deepseek"],
    [{ kind: "openrouter", apiKey: "test", model: "configured-model" }, "openrouter"],
    [{ kind: "ollama", model: "configured-model" }, "ollama"],
    [
      {
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:1234",
        model: "configured-model",
      },
      "openai-compatible",
    ],
  ];

  it.each(configs)("constructs $kind without making a request", (config, expectedKind) => {
    const provider = createProvider(config);
    expect(provider.kind).toBe(expectedKind);
    expect(provider.capabilities().model).toBe(
      expectedKind === "fake" ? "fake-model" : "configured-model",
    );
  });

  it("ignores disabled provider configurations", () => {
    const registry = createLlmRegistry({
      providers: [{ kind: "fake", id: "disabled", enabled: false }],
    });
    expect(registry.configured).toBe(false);
  });

  it("constructs cloud adapters with zero credentials and defers failure until an AI call", async () => {
    const registry = createLlmRegistry({
      providers: [{ kind: "openai", model: "configured-model" }],
    });

    expect(registry.configured).toBe(true);
    await expect(registry.generate({ messages: [] })).rejects.toMatchObject({
      code: "authentication",
      provider: "openai",
    });
  });
});
