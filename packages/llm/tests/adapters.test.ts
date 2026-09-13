import { describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "../src/adapters/anthropic.js";
import { DeepSeekProvider } from "../src/adapters/deepseek.js";
import { GeminiProvider } from "../src/adapters/gemini.js";
import { OllamaProvider } from "../src/adapters/ollama.js";
import { OpenAiCompatibleProvider } from "../src/adapters/openai-compatible.js";
import { OpenAiProvider } from "../src/adapters/openai.js";
import { OpenRouterProvider } from "../src/adapters/openrouter.js";
import type { FetchLike } from "../src/transport.js";
import { message, responseText, responseToolCalls, type GenerateRequest } from "../src/types.js";

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
}

const jsonFetch = (
  payload: unknown,
  capture?: CapturedRequest[],
  responseInit: ResponseInit = {},
): FetchLike =>
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (capture !== undefined) {
      const body = init?.body;
      capture.push({
        url: input instanceof Request ? input.url : String(input),
        init: init ?? {},
        body: JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>,
      });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...responseInit,
    });
  });

const request: GenerateRequest = {
  messages: [message("system", "Be concise"), message("user", "Hello")],
};

describe("native provider request mapping", () => {
  it("does not overclaim capabilities for an unconfigured model override", () => {
    const provider = new OpenAiProvider({ apiKey: "test", model: "configured-model" });
    expect(provider.capabilities("different-model")).toMatchObject({
      model: "different-model",
      toolCalling: false,
      structuredOutput: "none",
      reasoning: false,
      vision: false,
    });
  });

  it("maps canonical requests to OpenAI Responses API and parses typed output", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OpenAiProvider(
      { apiKey: "test-secret", model: "model-openai" },
      jsonFetch(
        {
          id: "resp_1",
          model: "model-openai",
          status: "completed",
          output: [
            { type: "message", content: [{ type: "output_text", text: "done" }] },
            {
              type: "reasoning",
              id: "reason_1",
              summary: [{ type: "summary_text", text: "summary" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        },
        captured,
      ),
    );

    const response = await provider.generate({
      ...request,
      tools: [
        {
          name: "lookup",
          description: "Look up a value",
          inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
          strict: true,
        },
      ],
      responseFormat: {
        type: "json_schema",
        name: "answer",
        schema: { type: "object", properties: { answer: { type: "string" } } },
      },
    });

    expect(captured[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(captured[0]?.init.headers).get("authorization")).toBe("Bearer test-secret");
    expect(captured[0]?.body).toMatchObject({
      model: "model-openai",
      stream: false,
      text: { format: { type: "json_schema", name: "answer" } },
    });
    expect(captured[0]?.body.input).toEqual([
      { role: "system", content: [{ type: "input_text", text: "Be concise" }] },
      { role: "user", content: [{ type: "input_text", text: "Hello" }] },
    ]);
    expect(responseText(response)).toBe("done");
    expect(response.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
    expect(response.providerState).toMatchObject({ openai: { responseId: "resp_1" } });
  });

  it("maps Gemini native generateContent including system instruction and JSON Schema", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new GeminiProvider(
      { apiKey: "gemini-secret", model: "gemini-model" },
      jsonFetch(
        {
          modelVersion: "gemini-model",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { text: '{"answer":"yes"}' },
                  {
                    functionCall: { id: "call-1", name: "lookup", args: { id: "42" } },
                    thoughtSignature: "opaque-signature",
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4, totalTokenCount: 6 },
        },
        captured,
      ),
    );

    const response = await provider.generate({
      ...request,
      responseFormat: {
        type: "json_schema",
        name: "answer",
        schema: { type: "object", properties: { answer: { type: "string" } } },
      },
    });

    expect(captured[0]?.url).toContain("/v1beta/models/gemini-model:generateContent");
    expect(new Headers(captured[0]?.init.headers).get("x-goog-api-key")).toBe("gemini-secret");
    expect(captured[0]?.body).toMatchObject({
      systemInstruction: { parts: [{ text: "Be concise" }] },
      generationConfig: { responseMimeType: "application/json" },
    });
    expect(responseText(response)).toBe('{"answer":"yes"}');
    expect(responseToolCalls(response)[0]).toMatchObject({
      id: "call-1",
      name: "lookup",
      arguments: { id: "42" },
    });
    expect(response.providerState).toBeDefined();
    if (response.providerState === undefined) throw new Error("expected Gemini provider state");

    await provider.generate({
      messages: [
        message("user", "Hello"),
        {
          role: "assistant",
          content: response.content,
          providerState: response.providerState,
        },
        message("user", "Continue"),
      ],
    });
    const followUpContents = captured[1]?.body.contents as readonly Record<string, unknown>[];
    const assistantParts = followUpContents[1]?.parts as readonly Record<string, unknown>[];
    expect(assistantParts).toHaveLength(2);
    expect(assistantParts[1]).toMatchObject({
      thoughtSignature: "opaque-signature",
      functionCall: { name: "lookup", args: { id: "42" } },
    });
  });

  it("maps Anthropic system, messages, tools, thinking state and structured output", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new AnthropicProvider(
      { apiKey: "anthropic-secret", model: "claude-model" },
      jsonFetch(
        {
          id: "msg_1",
          model: "claude-model",
          stop_reason: "end_turn",
          content: [
            { type: "thinking", thinking: "internal", signature: "opaque" },
            { type: "text", text: '{"ok":true}' },
          ],
          usage: { input_tokens: 3, output_tokens: 5 },
        },
        captured,
      ),
    );

    const result = await provider.generateStructured<{ ok: boolean }>({
      messages: request.messages,
      schemaName: "answer",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
    });

    expect(captured[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(captured[0]?.body).toMatchObject({
      system: "Be concise",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      output_config: { format: { type: "json_schema", name: "answer" } },
    });
    expect(result.value).toEqual({ ok: true });
    expect(result.response.providerState).toMatchObject({
      anthropic: { contentBlocks: [expect.objectContaining({ signature: "opaque" })] },
    });
  });

  it("maps Ollama native chat without requiring credentials", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OllamaProvider(
      { model: "local-model" },
      jsonFetch(
        {
          model: "local-model",
          done: true,
          done_reason: "stop",
          message: { role: "assistant", thinking: "think", content: "local" },
          prompt_eval_count: 3,
          eval_count: 2,
        },
        captured,
      ),
    );

    const response = await provider.generate(request);

    expect(captured[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(new Headers(captured[0]?.init.headers).has("authorization")).toBe(false);
    expect(captured[0]?.body).toMatchObject({ model: "local-model", stream: false });
    expect(responseText(response)).toBe("local");
    expect(response.content[0]).toEqual({ type: "reasoning", text: "think" });
  });
});

describe("OpenAI-compatible provider dialects", () => {
  it("isolates DeepSeek reasoning_content and round-trip state", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new DeepSeekProvider(
      { apiKey: "deepseek-secret", model: "deepseek-reasoner" },
      jsonFetch(
        {
          id: "deepseek-1",
          model: "deepseek-reasoner",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", reasoning_content: "reasoning", content: "answer" },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        },
        captured,
      ),
    );

    const response = await provider.generate({
      ...request,
      reasoning: { enabled: true, maxTokens: 2_048 },
    });
    expect(captured[0]?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(captured[0]?.body.thinking).toEqual({ type: "enabled", budget_tokens: 2_048 });
    expect(response.content[0]).toEqual({
      type: "reasoning",
      text: "reasoning",
      providerState: { deepseek: { reasoningContent: "reasoning" } },
    });
    expect(response.providerState).toEqual({ deepseek: { reasoningContent: "reasoning" } });
    if (response.providerState === undefined) throw new Error("expected DeepSeek provider state");

    await provider.generate({
      messages: [
        {
          role: "assistant",
          content: response.content,
          providerState: response.providerState,
        },
        message("user", "continue"),
      ],
    });
    expect(captured[1]?.body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "answer",
          reasoning_content: "reasoning",
        }),
      ]),
    );
  });

  it("uses DeepSeek JSON mode and still validates the requested schema locally", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new DeepSeekProvider(
      { apiKey: "test", model: "deepseek-chat" },
      jsonFetch(
        {
          model: "deepseek-chat",
          choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
        },
        captured,
      ),
    );

    const result = await provider.generateStructured<{ ok: boolean }>({
      messages: [message("user", "json")],
      schema: {
        type: "object",
        required: ["ok"],
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
      },
    });

    expect(captured[0]?.body.response_format).toEqual({ type: "json_object" });
    expect(result.value).toEqual({ ok: true });
  });

  it("keeps OpenRouter feature support explicit per configured route", () => {
    const conservative = new OpenRouterProvider({ apiKey: "test", model: "route/model" });
    const discovered = new OpenRouterProvider({
      apiKey: "test",
      model: "route/model",
      capabilities: { toolCalling: true, structuredOutput: "json_schema", reasoning: true },
    });

    expect(conservative.capabilities()).toMatchObject({
      toolCalling: false,
      structuredOutput: "none",
      reasoning: false,
    });
    expect(discovered.capabilities()).toMatchObject({
      toolCalling: true,
      structuredOutput: "json_schema",
      reasoning: true,
    });
  });
});

describe("streaming and normalized failures", () => {
  const fragmentedResponse = (chunks: readonly string[], contentType: string): Response =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": contentType } },
    );

  it("parses fragmented SSE, keep-alives, tool deltas, usage and DONE", async () => {
    const stream = [
      'data: {"id":"stream-1","model":"compat-model","choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
      ": keep-alive\n\n",
      'data: {"id":"stream-1","choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"call-1","function":{"name":"clock","arguments":"{\\"zone\\":"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"UTC\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ];
    const provider = new OpenAiCompatibleProvider(
      {
        baseUrl: "http://localhost:9000",
        model: "compat-model",
        capabilities: { toolCalling: true },
      },
      vi.fn(async () => fragmentedResponse(stream, "text/event-stream")),
    );
    const events = [];

    for await (const event of provider.stream({ messages: [message("user", "hello")] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toContain("tool_call_end");
    expect(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Hello");
    expect(events.find((event) => event.type === "tool_call_end")).toMatchObject({
      call: { name: "clock", arguments: { zone: "UTC" } },
    });
    expect(events.find((event) => event.type === "response_end")).toMatchObject({
      response: {
        finishReason: "tool_calls",
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      },
    });
  });

  it("normalizes an OpenRouter mid-stream error and retains partial output", async () => {
    const stream = [
      'data: {"model":"route/model","choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
      'data: {"error":{"message":"slow down","metadata":{"error_type":"provider_rate_limit"}},"finish_reason":"error"}\n\n',
    ];
    const provider = new OpenRouterProvider(
      { apiKey: "test", model: "route/model" },
      vi.fn(async () => fragmentedResponse(stream, "text/event-stream")),
    );
    const events = [];

    for await (const event of provider.stream({ messages: [] })) events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: { code: "rate_limit", provider: "openrouter", partialOutput: "partial" },
    });
  });

  it("parses Ollama NDJSON chunks and in-stream errors", async () => {
    const stream = [
      '{"model":"local","message":{"role":"assistant","thinking":"why ","content":"Hi "},"done":false}\n',
      '{"model":"local","message":{"role":"assistant","content":"there"},"done":false}\n',
      '{"model":"local","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":2,"eval_count":2}\n',
    ];
    const provider = new OllamaProvider(
      { model: "local" },
      vi.fn(async () => fragmentedResponse(stream, "application/x-ndjson")),
    );
    const events = [];

    for await (const event of provider.stream({ messages: [] })) events.push(event);

    expect(events.find((event) => event.type === "response_end")).toMatchObject({
      response: { finishReason: "stop", usage: { totalTokens: 4 } },
    });
    expect(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Hi there");
  });

  it("normalizes HTTP status, retry metadata and request id without exposing credentials", async () => {
    const provider = new OpenAiCompatibleProvider(
      {
        baseUrl: "http://localhost:9000",
        model: "compat-model",
        auth: { type: "bearer", token: "never-report-this" },
      },
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "Bearer never-report-this triggered too many requests",
                code: "rate_limit",
              },
            }),
            {
              status: 429,
              headers: { "retry-after": "2", "x-request-id": "request-42" },
            },
          ),
      ),
    );

    const promise = provider.generate({ messages: [] });
    await expect(promise).rejects.toMatchObject({
      code: "rate_limit",
      httpStatus: 429,
      retryable: true,
      retryAfterMs: 2_000,
      requestId: "request-42",
    });
    await expect(promise).rejects.not.toThrow("never-report-this");
  });
});
