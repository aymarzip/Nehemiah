import type {
  GitHubWebhookEnvelope,
  StoredGitHubWebhook,
  WebhookInbox,
  WebhookInsertResult,
} from "./types.js";

interface MemoryRecord {
  envelope: GitHubWebhookEnvelope;
  attempts: number;
  status: "pending" | "processing" | "processed" | "failed";
  availableAt: Date;
  error?: string;
  claimToken?: string;
}

export class InMemoryWebhookInbox implements WebhookInbox {
  readonly #records = new Map<string, MemoryRecord>();

  async insert(envelope: GitHubWebhookEnvelope): Promise<WebhookInsertResult> {
    if (this.#records.has(envelope.deliveryId)) return "duplicate";
    this.#records.set(envelope.deliveryId, {
      envelope,
      attempts: 0,
      status: "pending",
      availableAt: envelope.receivedAt,
    });
    return "inserted";
  }

  async claimPending(limit: number, now: Date): Promise<readonly StoredGitHubWebhook[]> {
    const claimed: StoredGitHubWebhook[] = [];
    for (const record of this.#records.values()) {
      if (claimed.length >= limit) break;
      if (record.status !== "pending" || record.availableAt > now) continue;
      record.status = "processing";
      record.attempts += 1;
      record.claimToken = String(record.attempts);
      claimed.push({
        ...record.envelope,
        attempts: record.attempts,
        claimToken: record.claimToken,
      });
    }
    return claimed;
  }

  async markProcessed(deliveryId: string, claimToken: string, processedAt: Date): Promise<void> {
    void processedAt;
    const record = this.#records.get(deliveryId);
    if (record?.status === "processing" && record.claimToken === claimToken) {
      record.status = "processed";
    }
  }

  async markFailed(
    deliveryId: string,
    claimToken: string,
    message: string,
    retryAt: Date,
    terminal: boolean,
  ): Promise<void> {
    const record = this.#records.get(deliveryId);
    if (record?.status !== "processing" || record.claimToken !== claimToken) return;
    record.status = terminal ? "failed" : "pending";
    record.availableAt = retryAt;
    record.error = message;
  }

  status(deliveryId: string): string | undefined {
    return this.#records.get(deliveryId)?.status;
  }
}
