import type { GitHubWebhookProcessor } from "@nehemiah/github";
import type { Logger } from "@nehemiah/observability";

export interface WorkerLoopOptions {
  readonly processor: GitHubWebhookProcessor;
  readonly logger: Logger;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly signal: AbortSignal;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  while (!options.signal.aborted) {
    try {
      const report = await options.processor.processBatch(options.batchSize);
      if (report.claimed > 0) {
        options.logger.info(report, "Processed GitHub webhook batch");
      }
      if (report.claimed >= options.batchSize) continue;
    } catch (error) {
      options.logger.error({ err: error }, "Webhook worker iteration failed");
    }
    await wait(options.pollIntervalMs, options.signal);
  }
}
