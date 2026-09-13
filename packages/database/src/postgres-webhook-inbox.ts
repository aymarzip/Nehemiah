import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  GitHubEventHandler,
  GitHubSignal,
  GitHubWebhookEnvelope,
  StoredGitHubWebhook,
  WebhookInbox,
  WebhookInsertResult,
} from "@nehemiah/github";

interface WebhookRow extends QueryResultRow {
  delivery_id: string;
  event_name: GitHubWebhookEnvelope["eventName"];
  action: string | null;
  received_at: Date;
  installation_id: string | number | null;
  repository_id: string | number | null;
  repository_full_name: string | null;
  sender_id: string | number | null;
  payload: unknown;
  attempts: number;
  claim_token: string | null;
}

function payloadObject(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function storedFromRow(row: WebhookRow): StoredGitHubWebhook {
  if (row.claim_token === null) {
    throw new TypeError(`Claimed webhook ${row.delivery_id} has no claim token`);
  }
  return {
    deliveryId: row.delivery_id,
    eventName: row.event_name,
    receivedAt: new Date(row.received_at),
    trust: "untrusted_external",
    payload: payloadObject(row.payload),
    attempts: row.attempts,
    claimToken: row.claim_token,
    ...(row.action === null ? {} : { action: row.action }),
    ...(row.installation_id === null ? {} : { installationId: Number(row.installation_id) }),
    ...(row.repository_id === null ? {} : { repositoryId: Number(row.repository_id) }),
    ...(row.repository_full_name === null ? {} : { repositoryFullName: row.repository_full_name }),
    ...(row.sender_id === null ? {} : { senderId: Number(row.sender_id) }),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"
  );
}

async function rollback(client: PoolClient, error: unknown): Promise<never> {
  await client.query("ROLLBACK");
  throw error;
}

export class PostgresWebhookInbox implements WebhookInbox {
  readonly #pool: Pool;
  readonly #staleLockMs: number;

  constructor(pool: Pool, staleLockMs = 5 * 60_000) {
    this.#pool = pool;
    this.#staleLockMs = staleLockMs;
  }

  async insert(envelope: GitHubWebhookEnvelope): Promise<WebhookInsertResult> {
    try {
      await this.#pool.query(
        `INSERT INTO github_webhook_events
          (delivery_id, event_name, action, installation_id, repository_id, repository_full_name,
           sender_id, trust_level, payload, status, attempts, available_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'untrusted_external', $8::jsonb, 'PENDING', 0, $9, $9)`,
        [
          envelope.deliveryId,
          envelope.eventName,
          envelope.action ?? null,
          envelope.installationId ?? null,
          envelope.repositoryId ?? null,
          envelope.repositoryFullName ?? null,
          envelope.senderId ?? null,
          JSON.stringify(envelope.payload),
          envelope.receivedAt,
        ],
      );
      return "inserted";
    } catch (error) {
      if (isUniqueViolation(error)) return "duplicate";
      throw error;
    }
  }

  async claimPending(limit: number, now: Date): Promise<readonly StoredGitHubWebhook[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be positive");
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      const staleBefore = new Date(now.getTime() - this.#staleLockMs);
      const result = await client.query<WebhookRow>(
        `SELECT delivery_id, event_name, action, received_at, installation_id, repository_id,
                repository_full_name, sender_id, payload, attempts, claim_token
         FROM github_webhook_events
         WHERE ((status = 'PENDING' AND available_at <= $1)
                OR (status = 'PROCESSING' AND locked_at < $2))
         ORDER BY received_at
         FOR UPDATE SKIP LOCKED
         LIMIT $3`,
        [now, staleBefore, limit],
      );
      const claimed: StoredGitHubWebhook[] = [];
      for (const row of result.rows) {
        const claimToken = randomUUID();
        const updated = await client.query<{ attempts: number; claim_token: string }>(
          `UPDATE github_webhook_events
           SET status = 'PROCESSING', locked_at = $2, attempts = attempts + 1, claim_token = $3
           WHERE delivery_id = $1 RETURNING attempts, claim_token`,
          [row.delivery_id, now, claimToken],
        );
        claimed.push(
          storedFromRow({
            ...row,
            attempts: updated.rows[0]?.attempts ?? row.attempts + 1,
            claim_token: updated.rows[0]?.claim_token ?? claimToken,
          }),
        );
      }
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      return rollback(client, error);
    } finally {
      client.release();
    }
  }

  async markProcessed(deliveryId: string, claimToken: string, processedAt: Date): Promise<void> {
    await this.#pool.query(
      `UPDATE github_webhook_events
       SET status = 'PROCESSED', processed_at = $3, locked_at = NULL, last_error = NULL,
           claim_token = NULL
       WHERE delivery_id = $1 AND status = 'PROCESSING' AND claim_token = $2`,
      [deliveryId, claimToken, processedAt],
    );
  }

  async markFailed(
    deliveryId: string,
    claimToken: string,
    message: string,
    retryAt: Date,
    terminal: boolean,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE github_webhook_events
       SET status = $3, available_at = $4, locked_at = NULL, last_error = $5,
           claim_token = NULL
       WHERE delivery_id = $1 AND status = 'PROCESSING' AND claim_token = $2`,
      [deliveryId, claimToken, terminal ? "FAILED" : "PENDING", retryAt, message.slice(0, 1_000)],
    );
  }
}

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function repositoryValues(value: unknown): readonly { id: number; fullName: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const candidate = object(entry);
    const id = candidate?.["id"];
    const fullName = candidate?.["full_name"];
    return typeof id === "number" && typeof fullName === "string" ? [{ id, fullName }] : [];
  });
}

function signalIdentity(signal: GitHubSignal, deliveryId: string): string {
  switch (signal.type) {
    case "pull_request":
      return String(signal.number);
    case "pull_request_review":
      return signal.reviewId > 0
        ? `${signal.pullRequestNumber}:${signal.reviewId}`
        : `${signal.pullRequestNumber}:${deliveryId}`;
    case "issue":
      return String(signal.number);
    case "workflow_run":
      return String(signal.workflowRunId);
    case "push":
      return signal.after;
    case "check":
      return signal.checkId > 0 ? `${signal.source}:${signal.checkId}` : deliveryId;
    case "installation":
      return String(signal.installationId);
    case "installation_repositories":
      return deliveryId;
  }
}

function signalOccurredAt(signal: GitHubSignal, fallback: Date): Date {
  const value =
    signal.type === "pull_request"
      ? signal.updatedAt
      : "occurredAt" in signal
        ? signal.occurredAt
        : undefined;
  if (value === undefined) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function activityKind(signal: GitHubSignal): string {
  return signal.type.toUpperCase();
}

function signalUrl(signal: GitHubSignal): string | undefined {
  return "url" in signal ? signal.url : undefined;
}

function signalBranch(signal: GitHubSignal): string | undefined {
  if (signal.type === "push") return signal.ref.replace(/^refs\/heads\//u, "");
  return "branch" in signal ? signal.branch : undefined;
}

function signalFiles(signal: GitHubSignal): readonly string[] {
  return signal.type === "push" ? signal.changedFiles : [];
}

function linkTarget(signal: GitHubSignal): { kind: string; externalId: string } | undefined {
  if (signal.type === "pull_request")
    return { kind: "PULL_REQUEST", externalId: String(signal.number) };
  if (signal.type === "pull_request_review")
    return { kind: "PULL_REQUEST", externalId: String(signal.pullRequestNumber) };
  if (signal.type === "issue") return { kind: "ISSUE", externalId: String(signal.number) };
  if (signal.type === "check" && signal.pullRequestNumbers[0] !== undefined)
    return { kind: "PULL_REQUEST", externalId: String(signal.pullRequestNumbers[0]) };
  return undefined;
}

function evidenceForSignal(
  signal: GitHubSignal,
): { kind: string; verified: boolean; summary: string } | undefined {
  switch (signal.type) {
    case "pull_request":
      return {
        kind: "PULL_REQUEST",
        verified: signal.merged,
        summary: `Pull request #${signal.number} ${signal.merged ? "merged" : signal.action}`,
      };
    case "pull_request_review":
      return {
        kind: "REVIEW",
        verified: signal.state.toLocaleLowerCase() === "approved",
        summary: `Pull request #${signal.pullRequestNumber} review: ${signal.state}`,
      };
    case "check":
      return {
        kind: "CHECK_RUN",
        verified: signal.conclusion === "success",
        summary: `${signal.source} ${signal.status}${signal.conclusion === undefined ? "" : `: ${signal.conclusion}`}`,
      };
    case "workflow_run":
      return {
        kind: "TEST_RESULT",
        verified: signal.conclusion === "success",
        summary: `Workflow run ${signal.workflowRunId}: ${signal.conclusion ?? signal.status}`,
      };
    case "push":
      return {
        kind: "COMMIT",
        verified: false,
        summary: `Push to ${signal.ref}; commit activity is not treated as productivity evidence`,
      };
    default:
      return undefined;
  }
}

export class PostgresGitHubEventHandler implements GitHubEventHandler {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async handle(envelope: GitHubWebhookEnvelope, signals: readonly GitHubSignal[]): Promise<void> {
    const client = await this.#pool.connect();
    await client.query("BEGIN");
    try {
      await this.#synchronizeInstallation(client, envelope, signals);
      const project =
        envelope.repositoryId === undefined
          ? undefined
          : await client.query<{ project_id: string | null }>(
              `SELECT repository.project_id
               FROM github_repositories repository
               JOIN github_installations installation
                 ON installation.installation_id = repository.installation_id
               WHERE repository.repository_id = $1
                 AND repository.active = true
                 AND installation.status = 'ACTIVE'`,
              [envelope.repositoryId],
            );
      const projectId = project?.rows[0]?.project_id ?? null;
      await client.query(
        `INSERT INTO project_events
          (id, project_id, event_type, source, external_key, trust_level, payload, occurred_at)
         VALUES ($1, $2, $3, 'github', $4, 'untrusted_external', $5::jsonb, $6)
         ON CONFLICT (source, external_key, event_type) DO NOTHING`,
        [
          randomUUID(),
          projectId,
          envelope.eventName,
          envelope.deliveryId,
          JSON.stringify({ signals, repositoryId: envelope.repositoryId ?? null }),
          envelope.receivedAt,
        ],
      );
      if (projectId !== null && envelope.repositoryId !== undefined) {
        await this.#recordProjectSignals(
          client,
          projectId,
          envelope.repositoryId,
          envelope,
          signals,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client, error);
    } finally {
      client.release();
    }
  }

  async #recordProjectSignals(
    client: PoolClient,
    projectId: string,
    repositoryId: number,
    envelope: GitHubWebhookEnvelope,
    signals: readonly GitHubSignal[],
  ): Promise<void> {
    for (const signal of signals) {
      if (signal.type === "installation" || signal.type === "installation_repositories") continue;
      const taskId = await this.#findTask(client, projectId, repositoryId, envelope, signal);
      const identity = signalIdentity(signal, envelope.deliveryId);
      const occurredAt = signalOccurredAt(signal, envelope.receivedAt);
      const activity = await client.query(
        `INSERT INTO github_activity
          (id, project_id, repository_id, task_id, kind, external_id, url, branch,
           changed_files, metadata, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
         ON CONFLICT (project_id, kind, external_id) DO UPDATE SET
           task_id = COALESCE(EXCLUDED.task_id, github_activity.task_id),
           url = COALESCE(EXCLUDED.url, github_activity.url),
           branch = COALESCE(EXCLUDED.branch, github_activity.branch),
           changed_files = EXCLUDED.changed_files, metadata = EXCLUDED.metadata,
           occurred_at = EXCLUDED.occurred_at
         WHERE github_activity.occurred_at <= EXCLUDED.occurred_at
         RETURNING id`,
        [
          randomUUID(),
          projectId,
          repositoryId,
          taskId ?? null,
          activityKind(signal),
          identity,
          signalUrl(signal) ?? null,
          signalBranch(signal) ?? null,
          JSON.stringify(signalFiles(signal)),
          JSON.stringify({ ...signal, deliveryId: envelope.deliveryId, trust: envelope.trust }),
          occurredAt,
        ],
      );
      if ((activity.rowCount ?? 0) === 0) continue;
      if (taskId === undefined) continue;
      const link = linkTarget(signal);
      if (link !== undefined) {
        await client.query(
          `INSERT INTO task_github_links (task_id, repository_id, link_kind, external_id, created_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [taskId, repositoryId, link.kind, link.externalId, occurredAt],
        );
      }
      const evidence = evidenceForSignal(signal);
      if (evidence !== undefined) {
        await client.query(
          `INSERT INTO task_evidence
            (id, task_id, kind, uri, summary, verified, external_id, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
           ON CONFLICT (task_id, kind, external_id) DO UPDATE SET
             uri = COALESCE(EXCLUDED.uri, task_evidence.uri),
             summary = EXCLUDED.summary,
             verified = EXCLUDED.verified,
             metadata = EXCLUDED.metadata,
             created_at = EXCLUDED.created_at
           WHERE task_evidence.created_at <= EXCLUDED.created_at`,
          [
            randomUUID(),
            taskId,
            evidence.kind,
            signalUrl(signal) ?? null,
            evidence.summary,
            evidence.verified,
            `${activityKind(signal)}:${identity}`,
            JSON.stringify({ source: "github", repositoryId, trust: envelope.trust }),
            occurredAt,
          ],
        );
      }
      const failed =
        (signal.type === "check" || signal.type === "workflow_run") &&
        signal.conclusion !== undefined &&
        signal.conclusion !== "success" &&
        signal.conclusion !== "neutral" &&
        signal.conclusion !== "skipped";
      if (failed) {
        await client.query(
          `INSERT INTO notification_events
            (id, project_id, kind, priority, deduplication_key, payload, available_at, created_at)
           VALUES ($1, $2, 'REQUIRED_CHECK_FAILED', 'HIGH', $3, $4::jsonb, $5, $5)
           ON CONFLICT (project_id, deduplication_key) DO UPDATE SET payload = EXCLUDED.payload,
             available_at = EXCLUDED.available_at, delivered_at = NULL`,
          [
            randomUUID(),
            projectId,
            `github-check:${identity}`,
            JSON.stringify({ taskId, signal }),
            occurredAt,
          ],
        );
      } else if (
        (signal.type === "check" || signal.type === "workflow_run") &&
        signal.conclusion === "success"
      ) {
        await client.query(
          `UPDATE notification_events SET delivered_at = $3
           WHERE project_id = $1 AND deduplication_key = $2 AND delivered_at IS NULL`,
          [projectId, `github-check:${identity}`, occurredAt],
        );
      }
    }
  }

  async #findTask(
    client: PoolClient,
    projectId: string,
    repositoryId: number,
    envelope: GitHubWebhookEnvelope,
    signal: GitHubSignal,
  ): Promise<string | undefined> {
    const link = linkTarget(signal);
    if (link !== undefined) {
      const linked = await client.query<{ id: string }>(
        `SELECT t.id FROM task_github_links link
         JOIN tasks t ON t.id = link.task_id
         WHERE t.project_id = $1 AND link.repository_id = $2
           AND link.link_kind = $3 AND link.external_id = $4 LIMIT 1`,
        [projectId, repositoryId, link.kind, link.externalId],
      );
      if (linked.rows[0] !== undefined) return linked.rows[0].id;
    }
    const candidates = await client.query<{ id: string; metadata: unknown }>(
      "SELECT id, metadata FROM tasks WHERE project_id = $1",
      [projectId],
    );
    const searchable = JSON.stringify({ signal, payload: envelope.payload }).toLocaleLowerCase();
    for (const candidate of candidates.rows) {
      if (searchable.includes(candidate.id.toLocaleLowerCase())) return candidate.id;
      const metadata = object(candidate.metadata) ?? {};
      const explicit = [
        metadata["githubBranch"],
        metadata["githubIssue"],
        metadata["githubPullRequest"],
      ]
        .filter(
          (value): value is string | number =>
            typeof value === "string" || typeof value === "number",
        )
        .map(String);
      if (explicit.some((value) => searchable.includes(value.toLocaleLowerCase())))
        return candidate.id;
    }
    return undefined;
  }

  async #synchronizeInstallation(
    client: PoolClient,
    envelope: GitHubWebhookEnvelope,
    signals: readonly GitHubSignal[],
  ): Promise<void> {
    const installation = signals.find((signal) => signal.type === "installation");
    if (installation?.type === "installation") {
      await client.query(
        `INSERT INTO github_installations (installation_id, account_login, status, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (installation_id) DO UPDATE SET
           account_login = EXCLUDED.account_login, status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at
         WHERE github_installations.updated_at <= EXCLUDED.updated_at`,
        [
          installation.installationId,
          installation.accountLogin ?? null,
          installation.action === "deleted" || installation.action === "suspend"
            ? "INACTIVE"
            : "ACTIVE",
          envelope.receivedAt,
        ],
      );
    }
    if (envelope.installationId !== undefined) {
      await client.query(
        `INSERT INTO github_installations (installation_id, status, updated_at)
         VALUES ($1, 'ACTIVE', $2)
         ON CONFLICT (installation_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
         WHERE github_installations.status = 'ACTIVE'
           AND github_installations.updated_at <= EXCLUDED.updated_at`,
        [envelope.installationId, envelope.receivedAt],
      );
    }
    if (
      envelope.installationId !== undefined &&
      envelope.repositoryId !== undefined &&
      envelope.repositoryFullName !== undefined
    ) {
      await this.#upsertRepository(
        client,
        envelope.installationId,
        envelope.repositoryId,
        envelope.repositoryFullName,
        envelope.receivedAt,
      );
    }
    if (
      envelope.eventName === "installation_repositories" &&
      envelope.installationId !== undefined
    ) {
      for (const repository of repositoryValues(envelope.payload["repositories_added"])) {
        await this.#upsertRepository(
          client,
          envelope.installationId,
          repository.id,
          repository.fullName,
          envelope.receivedAt,
        );
      }
      for (const repository of repositoryValues(envelope.payload["repositories_removed"])) {
        await client.query(
          `UPDATE github_repositories
           SET active = false, project_id = NULL, updated_at = $2
           WHERE repository_id = $1 AND updated_at <= $2`,
          [repository.id, envelope.receivedAt],
        );
      }
    }
  }

  async #upsertRepository(
    client: PoolClient,
    installationId: number,
    repositoryId: number,
    fullName: string,
    observedAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO github_repositories
        (repository_id, installation_id, project_id, full_name, active, updated_at)
       SELECT $1::bigint, installation.installation_id, NULL::uuid, $3::text, true, $4::timestamptz
       FROM github_installations installation
       WHERE installation.installation_id = $2::bigint
         AND installation.status = 'ACTIVE'
       ON CONFLICT (repository_id) DO UPDATE SET
         installation_id = EXCLUDED.installation_id,
         project_id = CASE
           WHEN github_repositories.installation_id = EXCLUDED.installation_id
             THEN github_repositories.project_id
           ELSE NULL
         END,
         full_name = EXCLUDED.full_name,
         active = true,
         updated_at = EXCLUDED.updated_at
       WHERE github_repositories.updated_at <= EXCLUDED.updated_at`,
      [repositoryId, installationId, fullName, observedAt],
    );
  }
}
