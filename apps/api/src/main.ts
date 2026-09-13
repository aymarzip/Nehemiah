import { loadConfig } from "@nehemiah/config";
import {
  InMemoryProjectStore,
  PostgresGitHubEventHandler,
  PostgresProjectStore,
  PostgresWebhookInbox,
  createPostgresPool,
  type ProjectStore,
} from "@nehemiah/database";
import {
  GitHubWebhookProcessor,
  GitHubWebhookReceiver,
  InMemoryWebhookInbox,
  type GitHubEventHandler,
  type WebhookInbox,
} from "@nehemiah/github";
import { createLogger } from "@nehemiah/observability";
import { buildApp } from "./build-app.js";
import { createConfiguredLlmRegistry } from "./llm-configuration.js";

const config = loadConfig();
const logger = createLogger({
  level: config.logLevel,
  service: "nehemiah-api",
  environment: config.environment,
});

let store: ProjectStore;
let inbox: WebhookInbox;
let handler: GitHubEventHandler;
let close = async (): Promise<void> => {};
if (config.storage.driver === "postgres") {
  const pool = createPostgresPool({
    connectionString: config.storage.databaseUrl,
    max: config.storage.poolSize,
    applicationName: "nehemiah-api",
    statementTimeoutMs: config.storage.statementTimeoutMs,
    idleTimeoutMs: config.storage.idleTimeoutMs,
    connectionTimeoutMs: config.storage.connectionTimeoutMs,
  });
  store = new PostgresProjectStore(pool);
  inbox = new PostgresWebhookInbox(pool);
  handler = new PostgresGitHubEventHandler(pool);
  close = async (): Promise<void> => {
    await pool.end();
  };
} else {
  store = new InMemoryProjectStore();
  inbox = new InMemoryWebhookInbox();
  handler = {
    async handle(event, signals) {
      logger.info(
        { deliveryId: event.deliveryId, eventName: event.eventName, signalCount: signals.length },
        "Processed in-memory GitHub event",
      );
    },
  };
}

const llm = createConfiguredLlmRegistry(config.ai);
const webhookReceiver =
  config.github.webhookSecret === undefined
    ? undefined
    : new GitHubWebhookReceiver(config.github.webhookSecret, inbox);
const webhookProcessor = new GitHubWebhookProcessor(inbox, handler);
const app = buildApp({
  config,
  store,
  llm,
  logger,
  ...(webhookReceiver === undefined ? {} : { webhookReceiver }),
  webhookProcessor,
});

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  logger.info({ signal }, "Stopping API");
  const shutdownDeadline = setTimeout(() => {
    logger.error("API did not stop within 5 seconds; forcing termination");
    process.exit(1);
  }, 5_000);
  shutdownDeadline.unref();
  try {
    await app.close();
  } catch (error) {
    logger.error({ err: error }, "API server close failed");
    process.exitCode = 1;
  }
  try {
    await close();
  } catch (error) {
    logger.error({ err: error }, "API storage close failed");
    process.exitCode = 1;
  } finally {
    clearTimeout(shutdownDeadline);
    process.exit(process.exitCode ?? 0);
  }
};
const onSigint = (): void => void shutdown("SIGINT");
const onSigterm = (): void => void shutdown("SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

try {
  await app.listen({ host: config.http.host, port: config.http.port });
} catch (error) {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  logger.fatal({ err: error }, "API failed to start");
  try {
    await app.close();
  } catch (closeError) {
    logger.error({ err: closeError }, "API server close failed during startup abort");
  }
  try {
    await close();
  } catch (storageError) {
    logger.error({ err: storageError }, "API storage close failed during startup abort");
  }
  process.exitCode = 1;
}
