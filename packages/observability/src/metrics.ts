export interface OperationalMetricsSnapshot {
  readonly startedAt: string;
  readonly httpRequests: number;
  readonly httpErrors: number;
  readonly httpByStatus: Readonly<Record<string, number>>;
  readonly webhookAccepted: number;
  readonly webhookDuplicates: number;
  readonly llmRequests: number;
  readonly llmFailures: number;
  readonly llmByProvider: Readonly<Record<string, number>>;
}

export class OperationalMetrics {
  readonly #startedAt = new Date();
  #httpRequests = 0;
  #httpErrors = 0;
  readonly #httpByStatus = new Map<number, number>();
  #webhookAccepted = 0;
  #webhookDuplicates = 0;
  #llmRequests = 0;
  #llmFailures = 0;
  readonly #llmByProvider = new Map<string, number>();

  recordHttp(statusCode: number): void {
    this.#httpRequests += 1;
    if (statusCode >= 500) this.#httpErrors += 1;
    this.#httpByStatus.set(statusCode, (this.#httpByStatus.get(statusCode) ?? 0) + 1);
  }

  recordWebhook(outcome: "accepted" | "duplicate"): void {
    if (outcome === "accepted") this.#webhookAccepted += 1;
    else this.#webhookDuplicates += 1;
  }

  recordLlm(provider: string, failed = false): void {
    this.#llmRequests += 1;
    if (failed) this.#llmFailures += 1;
    this.#llmByProvider.set(provider, (this.#llmByProvider.get(provider) ?? 0) + 1);
  }

  snapshot(): OperationalMetricsSnapshot {
    return Object.freeze({
      startedAt: this.#startedAt.toISOString(),
      httpRequests: this.#httpRequests,
      httpErrors: this.#httpErrors,
      httpByStatus: Object.freeze(
        Object.fromEntries(
          [...this.#httpByStatus].map(([status, count]) => [String(status), count]),
        ),
      ),
      webhookAccepted: this.#webhookAccepted,
      webhookDuplicates: this.#webhookDuplicates,
      llmRequests: this.#llmRequests,
      llmFailures: this.#llmFailures,
      llmByProvider: Object.freeze(Object.fromEntries(this.#llmByProvider)),
    });
  }
}
