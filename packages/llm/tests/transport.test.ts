import { afterEach, describe, expect, it, vi } from "vitest";

import type { LlmError } from "../src/errors.js";
import { parseSse, postJson, readJson, type FetchLike } from "../src/transport.js";

const responseFetch = (body: string, contentType: string, close = false): FetchLike =>
  vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        if (close) {
          controller.close();
          return;
        }
        const abort = (): void =>
          controller.error(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal?.aborted === true) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": contentType } });
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LLM transport response lifecycle", () => {
  it("keeps the configured timeout active while a JSON body is being read", async () => {
    vi.useFakeTimers();
    const response = await postJson({
      url: "https://provider.test/chat",
      provider: "test-provider",
      model: "test-model",
      body: {},
      timeoutMs: 100,
      fetch: responseFetch('{"partial":', "application/json"),
    });

    const assertion = expect(readJson(response, "test-provider", "test-model")).rejects.toEqual(
      expect.objectContaining<Partial<LlmError>>({
        code: "timeout",
        provider: "test-provider",
        model: "test-model",
        retryable: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the configured timeout active between streaming events", async () => {
    vi.useFakeTimers();
    const response = await postJson({
      url: "https://provider.test/stream",
      provider: "test-provider",
      model: "test-model",
      body: {},
      timeoutMs: 100,
      fetch: responseFetch("data: first\n\n", "text/event-stream"),
    });
    const events = parseSse(response, "test-provider")[Symbol.asyncIterator]();

    await expect(events.next()).resolves.toEqual({ done: false, value: { data: "first" } });
    const assertion = expect(events.next()).rejects.toEqual(
      expect.objectContaining<Partial<LlmError>>({
        code: "timeout",
        provider: "test-provider",
        model: "test-model",
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("normalizes a caller abort during body reading separately from a timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const response = await postJson({
      url: "https://provider.test/chat",
      provider: "test-provider",
      model: "test-model",
      body: {},
      signal: controller.signal,
      timeoutMs: 1_000,
      fetch: responseFetch('{"partial":', "application/json"),
    });

    const assertion = expect(readJson(response, "test-provider", "test-model")).rejects.toEqual(
      expect.objectContaining<Partial<LlmError>>({
        code: "aborted",
        provider: "test-provider",
        model: "test-model",
        retryable: false,
      }),
    );
    controller.abort();

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the request deadline after a complete JSON body", async () => {
    vi.useFakeTimers();
    const response = await postJson({
      url: "https://provider.test/chat",
      provider: "test-provider",
      body: {},
      timeoutMs: 100,
      fetch: responseFetch('{"ok":true}', "application/json", true),
    });

    await expect(readJson<{ ok: boolean }>(response, "test-provider")).resolves.toEqual({
      ok: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects unexpectedly large JSON and streaming responses", async () => {
    const jsonResponse = await postJson({
      url: "https://provider.test/chat",
      provider: "test-provider",
      body: {},
      maxResponseBytes: 8,
      fetch: responseFetch('{"value":"too large"}', "application/json", true),
    });
    await expect(readJson(jsonResponse, "test-provider")).rejects.toMatchObject({
      code: "invalid_response",
    });

    const streamResponse = await postJson({
      url: "https://provider.test/stream",
      provider: "test-provider",
      body: {},
      maxResponseBytes: 8,
      fetch: responseFetch("data: too-large\n\n", "text/event-stream", true),
    });
    const events = parseSse(streamResponse, "test-provider")[Symbol.asyncIterator]();
    await expect(events.next()).rejects.toMatchObject({ code: "invalid_response" });
  });
});
