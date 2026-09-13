import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig, requireDiscordConfig } from "./index.js";

describe("configuration", () => {
  it("uses a deterministic fake provider for keyless development", () => {
    const config = loadConfig({});
    expect(config.ai.provider).toBe("fake");
    expect(config.storage.driver).toBe("memory");
  });

  it("uses no AI provider by default in production", () => {
    expect(
      loadConfig({
        NODE_ENV: "production",
        STORAGE_DRIVER: "postgres",
        DATABASE_URL: "postgresql://nehemiah:nehemiah@localhost/nehemiah",
        INTERNAL_API_TOKEN: "test-internal-token-at-least-32-chars",
      }).ai.provider,
    ).toBe("none");
  });

  it("rejects volatile storage and weak service credentials in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        INTERNAL_API_TOKEN: "test-internal-token-at-least-32-chars",
      }),
    ).toThrow("STORAGE_DRIVER=postgres");
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        STORAGE_DRIVER: "postgres",
        DATABASE_URL: "postgresql://nehemiah:nehemiah@localhost/nehemiah",
        INTERNAL_API_TOKEN: "too-short",
      }),
    ).toThrow("at least 32 characters");
  });

  it("rejects weak GitHub webhook secrets when the integration is enabled", () => {
    expect(() => loadConfig({ GITHUB_WEBHOOK_SECRET: "too-short" })).toThrow(
      "GITHUB_WEBHOOK_SECRET",
    );
  });

  it("allows keyless Ollama and generic no-auth endpoints", () => {
    expect(loadConfig({ AI_PROVIDER: "ollama", AI_MODEL: "qwen3" }).ai.provider).toBe("ollama");
    expect(
      loadConfig({
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://localhost:1234/v1",
        AI_MODEL: "local-model",
      }).ai.provider,
    ).toBe("openai-compatible");
  });

  it("rejects live remote providers without their credential", () => {
    expect(() => loadConfig({ AI_PROVIDER: "anthropic" })).toThrow(ConfigurationError);
  });

  it("requires a database URL only when durable storage is selected", () => {
    expect(() => loadConfig({ STORAGE_DRIVER: "postgres" })).toThrow("DATABASE_URL");
  });

  it("validates Discord credentials only in the Discord composition root", () => {
    const config = loadConfig({});
    expect(() => requireDiscordConfig(config)).toThrow("DISCORD_TOKEN");
  });

  it("enables deterministic demo mode only when explicitly requested", () => {
    expect(loadConfig({}).demoMode).toBe(false);
    expect(loadConfig({ DEMO_MODE: "true" }).demoMode).toBe(true);
  });

  it("parses fine-grained AI token budgeting and database timeout configuration", () => {
    const config = loadConfig({
      STORAGE_DRIVER: "postgres",
      DATABASE_URL: "postgresql://localhost/db",
      AI_MAX_OUTPUT_TOKENS: "1200",
      AI_DECOMPOSITION_MAX_OUTPUT_TOKENS: "2500",
      AI_MAX_CONTEXT_MEMORY_ITEMS: "40",
      AI_MAX_CONTEXT_SIGNALS: "25",
      AI_TEMPERATURE: "0.7",
      AI_TIMEOUT_MS: "25000",
      DATABASE_STATEMENT_TIMEOUT_MS: "45000",
      DATABASE_IDLE_TIMEOUT_MS: "60000",
      DATABASE_CONNECTION_TIMEOUT_MS: "15000",
    });
    expect(config.ai.maxOutputTokens).toBe(1200);
    expect(config.ai.decompositionMaxOutputTokens).toBe(2500);
    expect(config.ai.maxContextMemoryItems).toBe(40);
    expect(config.ai.maxContextSignals).toBe(25);
    expect(config.ai.temperature).toBe(0.7);
    expect(config.ai.timeoutMs).toBe(25000);
    if (config.storage.driver === "postgres") {
      expect(config.storage.statementTimeoutMs).toBe(45000);
      expect(config.storage.idleTimeoutMs).toBe(60000);
      expect(config.storage.connectionTimeoutMs).toBe(15000);
    }
  });
});
