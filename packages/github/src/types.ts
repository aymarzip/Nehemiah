export const supportedGitHubEvents = [
  "push",
  "pull_request",
  "pull_request_review",
  "issues",
  "check_run",
  "check_suite",
  "workflow_run",
  "installation",
  "installation_repositories",
] as const;

export type SupportedGitHubEventName = (typeof supportedGitHubEvents)[number];

export interface GitHubWebhookEnvelope {
  readonly deliveryId: string;
  readonly eventName: SupportedGitHubEventName;
  readonly action?: string;
  readonly receivedAt: Date;
  readonly installationId?: number;
  readonly repositoryId?: number;
  readonly repositoryFullName?: string;
  readonly senderId?: number;
  /** GitHub content is external and must never be promoted into trusted LLM instructions. */
  readonly trust: "untrusted_external";
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface StoredGitHubWebhook extends GitHubWebhookEnvelope {
  readonly attempts: number;
  /** Lease generation used to prevent a stale worker from acknowledging a reclaimed delivery. */
  readonly claimToken: string;
}

export type WebhookInsertResult = "inserted" | "duplicate";

export interface WebhookInbox {
  insert(envelope: GitHubWebhookEnvelope): Promise<WebhookInsertResult>;
  claimPending(limit: number, now: Date): Promise<readonly StoredGitHubWebhook[]>;
  markProcessed(deliveryId: string, claimToken: string, processedAt: Date): Promise<void>;
  markFailed(
    deliveryId: string,
    claimToken: string,
    message: string,
    retryAt: Date,
    terminal: boolean,
  ): Promise<void>;
}

export type GitHubSignal =
  | {
      readonly type: "push";
      readonly ref: string;
      readonly commitCount: number;
      readonly after: string;
      readonly changedFiles: readonly string[];
      readonly occurredAt?: string;
    }
  | {
      readonly type: "pull_request";
      readonly action: string;
      readonly number: number;
      readonly merged: boolean;
      readonly draft: boolean;
      readonly title: string;
      readonly url?: string;
      readonly branch?: string;
      readonly changedFileCount: number;
      readonly openedAt?: string;
      readonly updatedAt?: string;
    }
  | {
      readonly type: "pull_request_review";
      readonly action: string;
      readonly pullRequestNumber: number;
      readonly reviewId: number;
      readonly state: string;
      readonly url?: string;
      readonly occurredAt?: string;
    }
  | {
      readonly type: "issue";
      readonly action: string;
      readonly number: number;
      readonly title: string;
      readonly url?: string;
      readonly occurredAt?: string;
    }
  | {
      readonly type: "check";
      readonly source: "check_run" | "check_suite";
      readonly action: string;
      readonly checkId: number;
      readonly status: string;
      readonly conclusion?: string;
      readonly url?: string;
      readonly pullRequestNumbers: readonly number[];
      readonly occurredAt?: string;
    }
  | {
      readonly type: "workflow_run";
      readonly action: string;
      readonly workflowRunId: number;
      readonly status: string;
      readonly conclusion?: string;
      readonly url?: string;
      readonly branch?: string;
      readonly occurredAt?: string;
    }
  | {
      readonly type: "installation";
      readonly action: string;
      readonly installationId: number;
      readonly accountLogin?: string;
    }
  | {
      readonly type: "installation_repositories";
      readonly action: string;
      readonly installationId: number;
      readonly addedRepositoryIds: readonly number[];
      readonly removedRepositoryIds: readonly number[];
    };

export interface GitHubEventHandler {
  handle(envelope: GitHubWebhookEnvelope, signals: readonly GitHubSignal[]): Promise<void>;
}
