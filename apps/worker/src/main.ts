import { loadConfig } from "@nehemiah/config";
import {
  PostgresGitHubEventHandler,
  PostgresWebhookInbox,
  createPostgresPool,
} from "@nehemiah/database";
import {
  GitHubWebhookProcessor,
  InMemoryWebhookInbox,
  type GitHubEventHandler,
  type WebhookInbox,
} from "@nehemiah/github";
import { createLogger } from "@nehemiah/observability";
import { runWorkerLoop } from "./worker-loop.js";

const config = loadConfig();
const logger = createLogger({
  level: config.logLevel,
  service: "nehemiah-worker",
  environment: config.environment,
});
let inbox: WebhookInbox;
let handler: GitHubEventHandler;
let close = async (): Promise<void> => {};

if (config.storage.driver === "postgres") {
  const pool = createPostgresPool({
    connectionString: config.storage.databaseUrl,
    max: config.storage.poolSize,
    applicationName: "nehemiah-worker",
    statementTimeoutMs: config.storage.statementTimeoutMs,
    idleTimeoutMs: config.storage.idleTimeoutMs,
    connectionTimeoutMs: config.storage.connectionTimeoutMs,
  });
  inbox = new PostgresWebhookInbox(pool);
  handler = new PostgresGitHubEventHandler(pool);
  close = async () => pool.end();
} else {
  inbox = new InMemoryWebhookInbox();
  handler = {
    async handle(event, signals) {
      logger.info(
        { deliveryId: event.deliveryId, eventName: event.eventName, signalCount: signals.length },
        "Processed in-memory event",
      );
    },
  };
  logger.warn(
    "Worker uses an isolated in-memory inbox; select PostgreSQL for durable shared processing",
  );
}

const abortController = new AbortController();
let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
const shutdown = (signal: string): void => {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  logger.info({ signal }, "Stopping worker");
  shutdownDeadline ??= setTimeout(() => {
    logger.error("Worker did not stop within 10 seconds; forcing termination");
    process.exit(1);
  }, 10_000);
  shutdownDeadline.unref();
  abortController.abort();
};
const onSigint = (): void => shutdown("SIGINT");
const onSigterm = (): void => shutdown("SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

logger.info({ storage: config.storage.driver }, "Worker started");
await runWorkerLoop({
  processor: new GitHubWebhookProcessor(inbox, handler),
  logger,
  pollIntervalMs: config.worker.pollIntervalMs,
  batchSize: config.worker.batchSize,
  signal: abortController.signal,
});
await close();
logger.info("Worker stopped");
if (shutdownDeadline !== undefined) {
  clearTimeout(shutdownDeadline);
  process.exit(process.exitCode ?? 0);
}
