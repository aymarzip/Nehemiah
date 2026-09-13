import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

const taskStatuses = [
  "PLANNED",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "IMPLEMENTED",
  "VERIFIED",
  "INTEGRATED",
  "SHIPPED",
  "CANCELLED",
] as const;

export function buildDiscordCommands(): readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const project = new SlashCommandBuilder()
    .setName("project")
    .setDescription("Set up and inspect the current project")
    .addSubcommand((command) =>
      command
        .setName("setup")
        .setDescription("Start the project setup wizard")
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Planning mode")
            .setRequired(true)
            .addChoices(
              { name: "Standard", value: "STANDARD" },
              { name: "Game Jam", value: "GAME_JAM" },
            ),
        )
        .addStringOption((option) =>
          option.setName("github").setDescription("GitHub repository as owner/name"),
        )
        .addStringOption((option) =>
          option.setName("constraints").setDescription("Comma-separated initial constraints"),
        ),
    )
    .addSubcommand((command) => command.setName("status").setDescription("Show project health"))
    .addSubcommand((command) =>
      command.setName("mission-control").setDescription("Show the persistent shipping overview"),
    )
    .addSubcommand((command) =>
      command.setName("decisions").setDescription("Show recent approved and proposed decisions"),
    )
    .addSubcommand((command) =>
      command
        .setName("demo")
        .setDescription("Create a deterministic evaluation project (when enabled)"),
    )
    .setDefaultMemberPermissions(null);

  const team = new SlashCommandBuilder()
    .setName("team")
    .setDescription("Manage your team profile")
    .addSubcommand((command) =>
      command.setName("join").setDescription("Register or update your profile"),
    )
    .addSubcommand((command) =>
      command
        .setName("preferences")
        .setDescription("Configure how Nehemiah communicates with you")
        .addStringOption((option) =>
          option
            .setName("detail")
            .setDescription("Response detail")
            .setRequired(true)
            .addChoices(
              { name: "Concise", value: "CONCISE" },
              { name: "Detailed", value: "DETAILED" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("notifications")
            .setDescription("Notification cadence")
            .setRequired(true)
            .addChoices(
              { name: "Immediate", value: "IMMEDIATE" },
              { name: "Batched", value: "BATCHED" },
              { name: "Checkpoints only", value: "CHECKPOINT_ONLY" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("delivery")
            .setDescription("Preferred delivery")
            .setRequired(true)
            .addChoices(
              { name: "Direct message", value: "DM" },
              { name: "Channel", value: "CHANNEL" },
              { name: "Either", value: "EITHER" },
            ),
        ),
    );

  const task = new SlashCommandBuilder()
    .setName("task")
    .setDescription("Inspect and update project tasks")
    .addSubcommand((command) => command.setName("mine").setDescription("Show your current tasks"))
    .addSubcommand((command) =>
      command
        .setName("update")
        .setDescription("Update one of your tasks")
        .addStringOption((option) =>
          option.setName("task_id").setDescription("Task identifier").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("New lifecycle state")
            .setRequired(true)
            .addChoices(...taskStatuses.map((status) => ({ name: status, value: status }))),
        )
        .addStringOption((option) =>
          option.setName("evidence").setDescription("Evidence or blocker summary"),
        ),
    );

  const producer = new SlashCommandBuilder()
    .setName("producer")
    .setDescription("Ask the project-aware producer")
    .addSubcommand((command) =>
      command
        .setName("ask")
        .setDescription("Ask a question about the current project")
        .addStringOption((option) =>
          option
            .setName("question")
            .setDescription("Your project question")
            .setRequired(true)
            .setMaxLength(1_500),
        ),
    )
    .addSubcommand((command) =>
      command.setName("what-now").setDescription("Show your highest-impact action right now"),
    )
    .addSubcommand((command) =>
      command
        .setName("why")
        .setDescription("Explain a recommendation or assignment from recorded state")
        .addStringOption((option) =>
          option.setName("task_id").setDescription("Optional task identifier"),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("cut-scope")
        .setDescription("Recommend optional scope cuts without applying them"),
    );

  const blocker = new SlashCommandBuilder()
    .setName("blocker")
    .setDescription("Record and resolve project blockers")
    .addSubcommand((command) =>
      command
        .setName("add")
        .setDescription("Record a blocker")
        .addStringOption((option) =>
          option
            .setName("description")
            .setDescription("What is blocked and why")
            .setRequired(true)
            .setMaxLength(1_500),
        )
        .addStringOption((option) =>
          option
            .setName("severity")
            .setDescription("Impact")
            .setRequired(true)
            .addChoices(
              { name: "Low", value: "LOW" },
              { name: "Medium", value: "MEDIUM" },
              { name: "High", value: "HIGH" },
              { name: "Critical", value: "CRITICAL" },
            ),
        )
        .addStringOption((option) =>
          option.setName("task_id").setDescription("Blocked task identifier"),
        )
        .addStringOption((option) =>
          option.setName("resolution").setDescription("Suggested resolution"),
        ),
    )
    .addSubcommand((command) =>
      command.setName("list").setDescription("Show open blockers by fan-out"),
    )
    .addSubcommand((command) =>
      command
        .setName("resolve")
        .setDescription("Resolve a blocker")
        .addStringOption((option) =>
          option.setName("blocker_id").setDescription("Blocker identifier").setRequired(true),
        ),
    );

  return [project, team, task, producer, blocker].map((command) => command.toJSON());
}

export { PermissionFlagsBits };
