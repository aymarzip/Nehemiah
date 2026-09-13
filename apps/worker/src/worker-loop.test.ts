import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@nehemiah/observability";
import { runWorkerLoop } from "./worker-loop.js";

describe("worker loop", () => {
  it("processes a batch and stops on cancellation", async () => {
    const abort = new AbortController();
    const processBatch = vi.fn().mockImplementation(async () => {
      abort.abort();
      return { claimed: 1, processed: 1, failed: 0 };
    });
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
    await runWorkerLoop({
      processor: { processBatch } as never,
      logger,
      pollIntervalMs: 100,
      batchSize: 10,
      signal: abort.signal,
    });
    expect(processBatch).toHaveBeenCalledWith(10);
  });

  it("does not retain an abort listener after each idle poll", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const addListener = vi.spyOn(abort.signal, "addEventListener");
    const removeListener = vi.spyOn(abort.signal, "removeEventListener");
    const processBatch = vi.fn().mockResolvedValue({ claimed: 0, processed: 0, failed: 0 });
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
    const loop = runWorkerLoop({
      processor: { processBatch } as never,
      logger,
      pollIntervalMs: 100,
      batchSize: 10,
      signal: abort.signal,
    });

    for (let iteration = 0; iteration < 12; iteration += 1) {
      await vi.advanceTimersByTimeAsync(100);
    }
    abort.abort();
    await loop;

    expect(removeListener).toHaveBeenCalledTimes(addListener.mock.calls.length);
    vi.useRealTimers();
  });
});
