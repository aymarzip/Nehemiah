import { REST, Routes } from "discord.js";
import { loadConfig, requireDiscordConfig } from "@nehemiah/config";
import { buildDiscordCommands } from "@nehemiah/discord-kit";

const config = loadConfig();
const discord = requireDiscordConfig(config);
const rest = new REST({ version: "10" }).setToken(discord.token);
const commands = buildDiscordCommands();

if (discord.developmentGuildId === undefined) {
  await rest.put(Routes.applicationCommands(discord.applicationId), { body: commands });
  process.stdout.write(`Registered ${commands.length} global commands.\n`);
} else {
  await rest.put(
    Routes.applicationGuildCommands(discord.applicationId, discord.developmentGuildId),
    { body: commands },
  );
  process.stdout.write(
    `Registered ${commands.length} development commands in guild ${discord.developmentGuildId}.\n`,
  );
}
