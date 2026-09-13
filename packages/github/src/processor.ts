import { mapGitHubEvent } from "./event-mapper.js";
import type { GitHubEventHandler, WebhookInbox } from "./types.js";

export interface WebhookProcessorOptions {
  readonly maxAttempts?: number;
  readonly baseRetryDelayMs?: number;
}

export interface ProcessingReport {
  readonly claimed: number;
  readonly processed: number;
  readonly failed: number;
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown GitHub event processing failure";
  return error.message.slice(0, 1_000);
}

export class GitHubWebhookProcessor {
  readonly #inbox: WebhookInbox;
  readonly #handler: GitHubEventHandler;
  readonly #maxAttempts: number;
  readonly #baseRetryDelayMs: number;

  constructor(
    inbox: WebhookInbox,
    handler: GitHubEventHandler,
    options: WebhookProcessorOptions = {},
  ) {
    this.#inbox = inbox;
    this.#handler = handler;
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#baseRetryDelayMs = options.baseRetryDelayMs ?? 1_000;
  }

  async processBatch(limit: number, now = new Date()): Promise<ProcessingReport> {
    const events = await this.#inbox.claimPending(limit, now);
    let processed = 0;
    let failed = 0;
    for (const event of events) {
      try {
        await this.#handler.handle(event, mapGitHubEvent(event));
        await this.#inbox.markProcessed(event.deliveryId, event.claimToken, now);
        processed += 1;
      } catch (error) {
        failed += 1;
        const terminal = event.attempts >= this.#maxAttempts;
        const delay = this.#baseRetryDelayMs * 2 ** Math.max(0, event.attempts - 1);
        await this.#inbox.markFailed(
          event.deliveryId,
          event.claimToken,
          safeErrorMessage(error),
          new Date(now.getTime() + delay),
          terminal,
        );
      }
    }
    return { claimed: events.length, processed, failed };
  }
}
