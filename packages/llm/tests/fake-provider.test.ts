import { describe, expect, it } from "vitest";

import type { LlmError } from "../src/errors.js";
import { FakeProvider, fakeJsonResponse } from "../src/fake-provider.js";
import { message, responseText } from "../src/types.js";

describe("FakeProvider", () => {
  it("selects deterministic scenarios and records invocations", async () => {
    const provider = new FakeProvider({
      scenarios: [
        {
          name: "matching request",
          matches: ({ request }) =>
            request.messages.some((entry) => responseText({ content: entry.content }) === "ping"),
          response: { text: "pong", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        },
      ],
      fallback: { text: "fallback" },
    });

    const first = await provider.generate({ messages: [message("user", "ping")] });
    const second = await provider.generate({ messages: [message("user", "ping")] });

    expect(responseText(first)).toBe("pong");
    expect(first.usage).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    expect(responseText(second)).toBe("fallback");
    expect(provider.invocations.map((entry) => entry.operation)).toEqual(["generate", "generate"]);
  });

  it("generates and locally validates schema-constrained JSON", async () => {
    const provider = new FakeProvider({
      scenarios: [{ response: fakeJsonResponse({ status: "ready", count: 2 }) }],
    });

    const result = await provider.generateStructured<{ status: string; count: number }>({
      messages: [message("user", "status")],
      schema: {
        type: "object",
        required: ["status", "count"],
        additionalProperties: false,
        properties: {
          status: { type: "string" },
          count: { type: "number", minimum: 0 },
        },
      },
    });

    expect(result.value).toEqual({ status: "ready", count: 2 });
    expect(result.response.finishReason).toBe("stop");
  });

  it("rejects malformed structured output with a normalized error", async () => {
    const provider = new FakeProvider({ fallback: { text: "not-json" } });

    await expect(
      provider.generateStructured({
        messages: [message("user", "json")],
        schema: { type: "object" },
      }),
    ).rejects.toMatchObject({ code: "invalid_response", provider: "fake" });
  });

  it("streams deterministic lifecycle, chunks and usage", async () => {
    const provider = new FakeProvider({ fallback: { text: "abcdef" }, streamChunkSize: 2 });
    const events = [];

    for await (const event of provider.stream({ messages: [message("user", "stream")] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "response_start",
      "text_delta",
      "text_delta",
      "text_delta",
      "usage",
      "response_end",
    ]);
    expect(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("abcdef");
  });

  it("enforces configured model capabilities before invoking a scenario", async () => {
    const provider = new FakeProvider({ capabilities: { toolCalling: false } });

    await expect(
      provider.generate({
        messages: [message("user", "call")],
        tools: [{ name: "clock", inputSchema: { type: "object" } }],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LlmError>>({ code: "unsupported_capability" }),
    );
  });
});
