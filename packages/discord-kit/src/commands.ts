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

  const goal = new SlashCommandBuilder()
    .setName("goal")
    .setDescription("Inspect and update project shipping goal and alignment")
    .addSubcommand((command) =>
      command
        .setName("status")
        .setDescription("Show current goal tracking, progress, and alignment"),
    )
    .addSubcommand((command) =>
      command
        .setName("set")
        .setDescription("Update project shipping goal")
        .addStringOption((option) =>
          option
            .setName("statement")
            .setDescription("New goal statement")
            .setRequired(true)
            .setMaxLength(2_000),
        )
        .addStringOption((option) =>
          option.setName("outcome").setDescription("Target outcome").setMaxLength(2_000),
        )
        .addStringOption((option) =>
          option
            .setName("criteria")
            .setDescription("Comma-separated success criteria")
            .setMaxLength(1_000),
        ),
    );

  const browser = new SlashCommandBuilder()
    .setName("browser")
    .setDescription("Safe project research and document inspection")
    .addSubcommand((command) =>
      command.setName("repo").setDescription("Inspect connected repository activity"),
    )
    .addSubcommand((command) =>
      command
        .setName("doc")
        .setDescription("Fetch and summarize external documentation safely")
        .addStringOption((option) =>
          option.setName("url").setDescription("HTTP(S) URL to fetch").setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("search")
        .setDescription("Search project decisions, memory, and code activities")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search terms")
            .setRequired(true)
            .setMaxLength(500),
        ),
    );

  const grillMe = new SlashCommandBuilder()
    .setName("grill-me")
    .setDescription("Technical interrogation on architecture and trade-offs")
    .addSubcommand((command) =>
      command
        .setName("start")
        .setDescription("Start technical interrogation on an architectural topic")
        .addStringOption((option) =>
          option
            .setName("topic")
            .setDescription("Architectural topic")
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption((option) =>
          option.setName("task_id").setDescription("Optional task ID to associate"),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("answer")
        .setDescription("Record choice for an interrogation question")
        .addStringOption((option) =>
          option
            .setName("topic")
            .setDescription("Architectural topic")
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption((option) =>
          option
            .setName("question")
            .setDescription("Interrogation question or key")
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption((option) =>
          option
            .setName("option")
            .setDescription("Selected option key (A, B, C)")
            .setRequired(true)
            .setMaxLength(100),
        )
        .addStringOption((option) =>
          option
            .setName("notes")
            .setDescription("Additional rationale or notes")
            .setMaxLength(1_000),
        )
        .addStringOption((option) => option.setName("task_id").setDescription("Optional task ID")),
    );

  const teamworkPreview = new SlashCommandBuilder()
    .setName("teamwork-preview")
    .setDescription("Preview team workload distribution and critical handoffs")
    .addSubcommand((command) =>
      command
        .setName("overview")
        .setDescription("Show workload, handoffs, and bottlenecks across team"),
    );

  const learn = new SlashCommandBuilder()
    .setName("learn")
    .setDescription("Project learning engine and retrospective insights")
    .addSubcommand((command) =>
      command
        .setName("insights")
        .setDescription("Show retrospective insights, velocity, and blocker root causes"),
    )
    .addSubcommand((command) =>
      command
        .setName("record")
        .setDescription("Record an engineering lesson or architectural takeaway")
        .addStringOption((option) =>
          option
            .setName("title")
            .setDescription("Lesson title")
            .setRequired(true)
            .setMaxLength(300),
        )
        .addStringOption((option) =>
          option
            .setName("lesson")
            .setDescription("Detailed takeaway or lesson")
            .setRequired(true)
            .setMaxLength(4_000),
        )
        .addStringOption((option) => option.setName("task_id").setDescription("Optional task ID")),
    );

  const boost = new SlashCommandBuilder()
    .setName("boost")
    .setDescription("AI task execution blueprint and unblocking accelerator")
    .addSubcommand((command) =>
      command
        .setName("task")
        .setDescription("Generate execution blueprint, checklist, and prompt for a task")
        .addStringOption((option) =>
          option.setName("task_id").setDescription("Task identifier").setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("unblock")
        .setDescription("Analyze open blockers and produce tactical unblocking steps"),
    )
    .addSubcommand((command) =>
      command
        .setName("suggest")
        .setDescription("Suggest scope deferrals and parallelization opportunities"),
    );

  return [
    project,
    team,
    task,
    producer,
    blocker,
    goal,
    browser,
    grillMe,
    teamworkPreview,
    learn,
    boost,
  ].map((command) => command.toJSON());
}

export { PermissionFlagsBits };
