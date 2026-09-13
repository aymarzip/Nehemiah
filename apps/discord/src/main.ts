import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig, requireDiscordConfig } from "@nehemiah/config";
import {
  HttpDirectorApiClient,
  InMemorySetupDraftStore,
  createInteractionHandler,
} from "@nehemiah/discord-kit";
import { createLogger } from "@nehemiah/observability";

const config = loadConfig();
const discord = requireDiscordConfig(config);
const logger = createLogger({
  level: config.logLevel,
  service: "nehemiah-discord",
  environment: config.environment,
});
const api = new HttpDirectorApiClient({
  baseUrl: config.discord.apiUrl,
  ...(config.discord.internalApiToken === undefined
    ? {}
    : { internalToken: config.discord.internalApiToken }),
});
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const handler = createInteractionHandler({
  api,
  setupDrafts: new InMemorySetupDraftStore(),
  logger,
});

client.on(Events.InteractionCreate, (interaction) => void handler(interaction));
client.once(Events.ClientReady, (readyClient) => {
  logger.info({ userId: readyClient.user.id }, "Discord adapter is ready");
});
client.on(Events.Error, (error) => logger.error({ err: error }, "Discord client error"));

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  logger.info({ signal }, "Stopping Discord adapter");
  const shutdownDeadline = setTimeout(() => {
    logger.error("Discord adapter did not stop within 5 seconds; forcing termination");
    process.exit(1);
  }, 5_000);
  shutdownDeadline.unref();
  try {
    await client.destroy();
  } catch (error) {
    logger.error({ err: error }, "Discord adapter shutdown failed");
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

await client.login(discord.token);
