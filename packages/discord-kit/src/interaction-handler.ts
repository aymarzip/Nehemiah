import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  DirectorApiError,
  type DiscordDirectorApi,
  type MissionControlView,
  type ProjectStatusView,
  type WhatNowView,
} from "./api-client.js";
import type { SetupDraftStore } from "./setup-drafts.js";

export interface InteractionLogger {
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
}

export interface InteractionHandlerOptions {
  readonly api: DiscordDirectorApi;
  readonly setupDrafts: SetupDraftStore;
  readonly logger?: InteractionLogger;
}

const privateMessage = (content: string): InteractionReplyOptions => ({
  content,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});

function textInput(
  customId: string,
  label: string,
  style: TextInputStyle,
  options: { placeholder?: string; maxLength?: number; required?: boolean } = {},
): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(options.required ?? true);
  if (options.placeholder !== undefined) input.setPlaceholder(options.placeholder);
  if (options.maxLength !== undefined) input.setMaxLength(options.maxLength);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

export function canSetUpProject(inGuild: boolean, hasManageGuild: boolean): boolean {
  return inGuild && hasManageGuild;
}

function requireGuild(interaction: Interaction): string {
  if (!interaction.inGuild() || interaction.guildId === null) {
    throw new DirectorApiError(400, "This command can only be used inside a Discord server.");
  }
  return interaction.guildId;
}

function parseList(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseSkills(value: string): readonly { name: string; level: number }[] {
  return parseList(value).map((entry) => {
    const [nameValue, levelValue] = entry.split(":", 2);
    const name = nameValue?.trim() ?? "";
    const level = Number(levelValue ?? "3");
    if (name.length === 0 || !Number.isInteger(level) || level < 1 || level > 5) {
      throw new DirectorApiError(400, `Invalid skill "${entry}". Use Skill:1-5.`);
    }
    return { name, level };
  });
}

function displayName(interaction: Interaction): string {
  if (!interaction.inGuild()) return interaction.user.globalName ?? interaction.user.username;
  const member = interaction.member;
  return (
    (typeof member === "object" && member !== null && "displayName" in member
      ? String(member.displayName)
      : undefined) ??
    interaction.user.globalName ??
    interaction.user.username
  );
}

function projectStatusEmbed(status: ProjectStatusView): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(escapeMarkdown(status.name))
    .setDescription(`**${status.phase}** · ${status.remainingTime} remaining`)
    .addFields(
      {
        name: "Progress",
        value: [
          `Implementation: ${status.health.implementation}%`,
          `Integration: ${status.health.integration}%`,
          `Verification: ${status.health.verification}%`,
          `Release: ${status.health.releaseReadiness}%`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Risk",
        value: `${status.risk.severity} (${status.risk.score}/100)\nBuffer: ${status.deadlineBufferHours}h`,
        inline: true,
      },
      {
        name: "Critical path",
        value:
          status.criticalPath.length === 0
            ? "No tasks yet"
            : status.criticalPath
                .map((title) => escapeMarkdown(title))
                .join(" → ")
                .slice(0, 1_024),
      },
      ...(status.risk.signals.length === 0
        ? []
        : [
            {
              name: "Active signals",
              value: status.risk.signals
                .map((signal) => `• ${escapeMarkdown(signal)}`)
                .join("\n")
                .slice(0, 1_024),
            },
          ]),
    );
}

function missionControlEmbed(view: MissionControlView): EmbedBuilder {
  const dimensions = view.health.dimensions;
  const score = (name: string): number => dimensions[name]?.score ?? 0;
  return new EmbedBuilder()
    .setTitle(`Mission Control · ${escapeMarkdown(view.project.name)}`)
    .setDescription(
      `**${view.project.phase}** · deadline <t:${Math.floor(new Date(view.project.deadline).getTime() / 1_000)}:R>`,
    )
    .addFields(
      {
        name: "Delivery",
        value: [
          `Implementation: **${score("IMPLEMENTATION")}%**`,
          `Integration: **${view.integrationProgress}%**`,
          `QA: **${score("VERIFICATION")}%**`,
          `Release readiness: **${view.release.score}%**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Risk",
        value: `${view.risks.severity} · ${view.risks.overallScore}/100\nProject health: ${view.health.overallScore}/100`,
        inline: true,
      },
      {
        name: "Critical path",
        value:
          view.criticalPath.length === 0
            ? "No active path"
            : view.criticalPath
                .map((title) => escapeMarkdown(title))
                .join(" → ")
                .slice(0, 1_024),
      },
      {
        name: "Top blockers",
        value:
          view.blockers.length === 0
            ? "No open blockers"
            : view.blockers
                .map(
                  (entry) =>
                    `• ${escapeMarkdown(entry.blocker.description)}: ${escapeMarkdown(entry.explanation)}`,
                )
                .join("\n")
                .slice(0, 1_024),
      },
      {
        name: "Release gates",
        value: view.release.ready
          ? "Ready to release"
          : view.release.blockers
              .map((reason) => `• ${escapeMarkdown(reason)}`)
              .join("\n")
              .slice(0, 1_024),
      },
    )
    .setFooter({ text: `Next checkpoint: ${new Date(view.nextCheckpointAt).toISOString()}` });
}

function missionControls(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("mc:my-task").setLabel("My Task").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("mc:project")
      .setLabel("Project")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("mc:risks").setLabel("Risks").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("mc:ask")
      .setLabel("Ask Producer")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("mc:update")
      .setLabel("Update Status")
      .setStyle(ButtonStyle.Secondary),
  );
}

function whatNowEmbed(view: WhatNowView): EmbedBuilder {
  const recommendation = view.recommendation;
  if (recommendation === undefined)
    return new EmbedBuilder()
      .setTitle("What now")
      .setDescription(view.message ?? "No action is ready.");
  return new EmbedBuilder()
    .setTitle("Highest-impact action right now")
    .setDescription(`**${escapeMarkdown(recommendation.title)}**`)
    .addFields(
      {
        name: "Why",
        value: recommendation.reasons
          .map((reason) => `• ${escapeMarkdown(reason)}`)
          .join("\n")
          .slice(0, 1_024),
      },
      { name: "Priority", value: recommendation.priority, inline: true },
      {
        name: "Confidence",
        value: `${Math.round(recommendation.confidence * 100)}%`,
        inline: true,
      },
      {
        name: "Expected result",
        value: escapeMarkdown(recommendation.expectedResult).slice(0, 1_024),
      },
      ...(recommendation.avoidForNow.length === 0
        ? []
        : [
            {
              name: "Avoid for now",
              value: recommendation.avoidForNow
                .map((title) => `• ${escapeMarkdown(title)}`)
                .join("\n")
                .slice(0, 1_024),
            },
          ]),
    );
}

async function handleProjectCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "demo") {
    const allowed = canSetUpProject(
      interaction.inGuild(),
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    );
    if (!allowed) {
      await interaction.reply(
        privateMessage("You need Manage Server permission to create the demo project."),
      );
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await options.api.bootstrapDemo(
      guildId,
      interaction.user.id,
      displayName(interaction),
    );
    await interaction.editReply({
      content: [
        `Demo project ${result.reused ? "already exists" : "created"}: \`${result.projectId}\``,
        "Try:",
        ...result.walkthrough.map((command) => `• ${command}`),
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (subcommand === "setup") {
    const allowed = canSetUpProject(
      interaction.inGuild(),
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    );
    if (!allowed) {
      await interaction.reply(
        privateMessage("You need Manage Server permission to set up a project."),
      );
      return;
    }
    const mode = interaction.options.getString("mode", true);
    if (mode !== "STANDARD" && mode !== "GAME_JAM") {
      throw new DirectorApiError(400, "Project mode is invalid.");
    }
    const githubRepository = interaction.options.getString("github")?.trim();
    const draft = await options.setupDrafts.create({
      guildId,
      userId: interaction.user.id,
      mode,
      constraints: parseList(interaction.options.getString("constraints") ?? ""),
      ...(githubRepository === undefined || githubRepository.length === 0
        ? {}
        : { githubRepository }),
    });
    const modal = new ModalBuilder()
      .setCustomId(`project-setup:${draft.id}`)
      .setTitle("Set up Nehemiah project")
      .addComponents(
        textInput("name", "Project name", TextInputStyle.Short, { maxLength: 100 }),
        textInput("description", "What are you building?", TextInputStyle.Paragraph, {
          maxLength: 1_000,
        }),
        textInput("vision", "Project vision / success", TextInputStyle.Paragraph, {
          maxLength: 1_000,
        }),
        textInput("deadline", "Deadline (ISO 8601)", TextInputStyle.Short, {
          placeholder: "2030-08-15T18:00:00+03:00",
          maxLength: 40,
        }),
        textInput("timezone", "IANA timezone", TextInputStyle.Short, {
          placeholder: "Europe/Kiev",
          maxLength: 80,
        }),
      );
    await interaction.showModal(modal);
    return;
  }
  if (subcommand === "status") {
    await interaction.deferReply();
    const status = await options.api.projectStatus(guildId);
    await interaction.editReply({
      embeds: [projectStatusEmbed(status)],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (subcommand === "mission-control") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const view = await options.api.missionControl(guildId, interaction.user.id);
    const channel = interaction.channel;
    if (channel === null || !channel.isSendable())
      throw new DirectorApiError(400, "Mission Control needs a sendable project channel.");
    const payload = {
      embeds: [missionControlEmbed(view)],
      components: [missionControls()],
      allowedMentions: { parse: [] as never[] },
    };
    let message =
      view.missionControlLocation?.channelId === channel.id
        ? await channel.messages.fetch(view.missionControlLocation.messageId).catch(() => undefined)
        : undefined;
    if (message === undefined) {
      if (!(interaction.appPermissions?.has(PermissionFlagsBits.SendMessages) ?? false)) {
        throw new DirectorApiError(403, "Nehemiah needs Send Messages permission in this channel.");
      }
      message = await channel.send(payload);
    } else {
      await message.edit(payload);
    }
    await options.api.saveMissionControl(guildId, interaction.user.id, channel.id, message.id);
    await interaction.editReply({
      content: `Mission Control ${view.missionControlLocation === undefined ? "created" : "updated"}.`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (subcommand === "decisions") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const decisions = await options.api.recentDecisions(guildId, interaction.user.id);
    await interaction.editReply({
      content:
        decisions.length === 0
          ? "No decisions are recorded yet."
          : decisions
              .map(
                (decision) =>
                  `• **${escapeMarkdown(decision.title)}** · ${decision.status}\n${escapeMarkdown(decision.rationale)}`,
              )
              .join("\n\n")
              .slice(0, 1_900),
      allowedMentions: { parse: [] },
    });
  }
}

async function handleTeamCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  if (interaction.options.getSubcommand() === "preferences") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await options.api.updatePreferences(guildId, interaction.user.id, {
      style: interaction.options.getString("detail", true),
      notificationFrequency: interaction.options.getString("notifications", true),
      deliveryPreference: interaction.options.getString("delivery", true),
    });
    await interaction.editReply({
      content: "Communication preferences saved.",
      allowedMentions: { parse: [] },
    });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId("team-join")
    .setTitle("Your Nehemiah profile")
    .addComponents(
      textInput("roles", "Roles (comma-separated)", TextInputStyle.Short, {
        placeholder: "DEVELOPER, QA",
        maxLength: 200,
      }),
      textInput("skills", "Skills as Name:1-5", TextInputStyle.Short, {
        placeholder: "TypeScript:4, Game Design:3",
        maxLength: 400,
      }),
      textInput("hours", "Available hours per week", TextInputStyle.Short, {
        placeholder: "20",
        maxLength: 4,
      }),
      textInput("timezone", "Your IANA timezone", TextInputStyle.Short, {
        placeholder: "Europe/Kiev",
        maxLength: 80,
      }),
      textInput("ai_tools", "AI tools (optional)", TextInputStyle.Short, {
        placeholder: "Codex, Claude Code, Cursor",
        maxLength: 300,
        required: false,
      }),
    );
  await interaction.showModal(modal);
}

async function handleTaskCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (subcommand === "mine") {
    const tasks = await options.api.currentTasks(guildId, interaction.user.id);
    const content =
      tasks.length === 0
        ? "You have no assigned tasks right now."
        : tasks
            .map(
              (task) =>
                `• **${escapeMarkdown(task.title)}**: ${task.status} · ${task.impact} \`${task.id}\``,
            )
            .join("\n")
            .slice(0, 1_900);
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
    return;
  }
  const taskId = interaction.options.getString("task_id", true);
  const status = interaction.options.getString("status", true);
  const evidence = interaction.options.getString("evidence") ?? undefined;
  const task = await options.api.updateTask(taskId, interaction.user.id, status, evidence);
  await interaction.editReply({
    content: `Updated **${escapeMarkdown(task.title)}** to **${task.status}**.`,
    allowedMentions: { parse: [] },
  });
}

async function handleProducerCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "what-now") {
    const result = await options.api.whatNow(guildId, interaction.user.id);
    await interaction.editReply({ embeds: [whatNowEmbed(result)], allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "why") {
    const result = await options.api.why(
      guildId,
      interaction.user.id,
      interaction.options.getString("task_id") ?? undefined,
    );
    await interaction.editReply({
      content: result.reasons
        .map((reason) => `• ${escapeMarkdown(reason)}`)
        .join("\n")
        .slice(0, 1_900),
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (subcommand === "cut-scope") {
    const result = await options.api.cutScope(guildId, interaction.user.id);
    await interaction.editReply({
      content:
        result.candidates.length === 0
          ? "No safe optional scope-cut candidate is currently supported by the task graph."
          : [
              "**Scope-cut candidates (nothing was changed):**",
              ...result.candidates.map(
                (candidate) =>
                  `• **${escapeMarkdown(candidate.title)}**: saves ${candidate.expectedTimeSavedHours}h · risk ${candidate.riskReduction} · product impact ${candidate.productImpact}`,
              ),
            ]
              .join("\n")
              .slice(0, 1_900),
      allowedMentions: { parse: [] },
    });
    return;
  }
  const response = await options.api.askProducer(
    guildId,
    interaction.user.id,
    interaction.options.getString("question", true),
  );
  await interaction.editReply({
    content: `${response.answer.slice(0, 1_850)}\n\n_Provider: ${escapeMarkdown(response.provider)}_`,
    allowedMentions: { parse: [] },
  });
}

async function handleBlockerCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (subcommand === "add") {
    const blocker = await options.api.addBlocker(guildId, interaction.user.id, {
      description: interaction.options.getString("description", true),
      severity: interaction.options.getString("severity", true),
      ...(interaction.options.getString("task_id") === null
        ? {}
        : { blockedTaskId: interaction.options.getString("task_id", true) }),
      ...(interaction.options.getString("resolution") === null
        ? {}
        : { suggestedResolution: interaction.options.getString("resolution", true) }),
    });
    await interaction.editReply({
      content: `Recorded **${escapeMarkdown(blocker.severity)}** blocker \`${blocker.id}\`.`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (subcommand === "resolve") {
    const blocker = await options.api.resolveBlocker(
      guildId,
      interaction.user.id,
      interaction.options.getString("blocker_id", true),
    );
    await interaction.editReply({
      content: `Resolved blocker: ${escapeMarkdown(blocker.description)}`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const blockers = await options.api.listBlockers(guildId, interaction.user.id);
  await interaction.editReply({
    content:
      blockers.length === 0
        ? "No open blockers."
        : blockers
            .map(
              (blocker) =>
                `• **${blocker.severity}** ${escapeMarkdown(blocker.description)} \`${blocker.id}\`\n${escapeMarkdown(blocker.priority?.explanation ?? blocker.suggestedResolution)}`,
            )
            .join("\n")
            .slice(0, 1_900),
    allowedMentions: { parse: [] },
  });
}

async function handleGoalCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "set") {
    const statement = interaction.options.getString("statement", true);
    const outcome = interaction.options.getString("outcome") ?? undefined;
    const criteriaRaw = interaction.options.getString("criteria");
    const successCriteria = criteriaRaw !== null ? parseList(criteriaRaw) : undefined;
    const result = await options.api.updateGoal(guildId, interaction.user.id, {
      statement,
      targetOutcome: outcome,
      successCriteria,
    });
    const embed = new EmbedBuilder()
      .setTitle(`Goal Updated · ${escapeMarkdown(result.name)}`)
      .setDescription(`**Goal:** ${escapeMarkdown(result.progress.goalStatement)}`)
      .addFields(
        {
          name: "Progress",
          value: `Must-Have: ${result.progress.completedMustHaveTasks}/${result.progress.mustHaveTasks} (${result.progress.mustHavePercentage}%)\nTotal: ${result.progress.completedTasks}/${result.progress.totalTasks} (${result.progress.percentage}%)`,
          inline: true,
        },
        {
          name: "Details",
          value: `Milestone: ${escapeMarkdown(result.progress.primaryMilestone ?? "None")}\nTarget: ${result.progress.targetDate ?? "Not set"}\nCeiling: ${escapeMarkdown(result.progress.scopeCeiling ?? "None")}`,
          inline: true,
        },
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const result = await options.api.goalStatus(guildId, interaction.user.id);
  const goalText = result.progress.goalStatement ?? result.progress.statement;
  const unaligned = result.progress.unalignedTasks ?? [];
  const embed = new EmbedBuilder()
    .setTitle(`Goal · ${escapeMarkdown(result.name)}`)
    .setDescription(`**Goal:** ${escapeMarkdown(goalText)}`)
    .addFields(
      {
        name: "Progress",
        value: `Must-Have: ${result.progress.completedMustHaveTasks ?? result.progress.mustHaveCompleted}/${result.progress.mustHaveTasks ?? result.progress.mustHaveTotal} (${result.progress.mustHavePercentage ?? result.progress.mustHaveProgressPercent}%)\nTotal: ${result.progress.completedTasks}/${result.progress.totalTasks} (${result.progress.percentage ?? result.progress.overallProgressPercent}%)`,
        inline: true,
      },
      {
        name: "Details",
        value: `Milestone: ${escapeMarkdown(result.progress.primaryMilestone ?? "None")}\nTarget: ${result.progress.targetDate ?? "Not set"}\nCeiling: ${escapeMarkdown(result.progress.scopeCeiling ?? "None")}`,
        inline: true,
      },
      ...(unaligned.length === 0
        ? []
        : [
            {
              name: "Unaligned Tasks",
              value: unaligned
                .slice(0, 5)
                .map((t) => `• ${escapeMarkdown(t.title)}: ${escapeMarkdown(t.reason)}`)
                .join("\n")
                .slice(0, 1_024),
            },
          ]),
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleBrowserCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "repo") {
    const repo = await options.api.browserRepo(guildId, interaction.user.id);
    if (!repo.githubRepository) {
      await interaction.editReply({
        content: "No GitHub repository connected to this project.",
        allowedMentions: { parse: [] },
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`GitHub Repository · ${escapeMarkdown(repo.githubRepository)}`)
      .setDescription(
        repo.activities.length === 0
          ? "No recent GitHub activity recorded."
          : repo.activities
              .slice(0, 10)
              .map(
                (act) =>
                  `• [${act.kind}] ${act.branch ? `(${escapeMarkdown(act.branch)}) ` : ""}${escapeMarkdown(act.externalId)} at ${act.occurredAt}`,
              )
              .join("\n")
              .slice(0, 4_000),
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === "doc") {
    const url = interaction.options.getString("url", true);
    const doc = await options.api.browserDoc(guildId, interaction.user.id, url);
    const headings = doc.headings ?? [];
    const links = doc.links ?? [];
    const embed = new EmbedBuilder()
      .setTitle(`Doc · ${escapeMarkdown(doc.title || doc.url)}`)
      .setDescription(`**URL:** ${doc.url}\n\n${escapeMarkdown(doc.text).slice(0, 1_500)}`)
      .addFields(
        {
          name: "Headings",
          value:
            headings
              .slice(0, 5)
              .map((h) => escapeMarkdown(h))
              .join(", ")
              .slice(0, 1_024) || "None",
        },
        {
          name: "Links",
          value: `${links.length} discovered link(s)`,
        },
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const query = interaction.options.getString("query", true);
  const search = await options.api.browserSearch(guildId, interaction.user.id, query);
  const embed = new EmbedBuilder()
    .setTitle(`Knowledge Search · "${escapeMarkdown(search.query)}"`)
    .setDescription(`${search.results.length} result(s) found`)
    .addFields(
      search.results.slice(0, 5).map((res) => {
        const source =
          (res as { sourceKind?: string; kind?: string }).sourceKind ??
          (res as { kind?: string }).kind ??
          "KNOWLEDGE";
        return {
          name: `[${source}] ${escapeMarkdown(res.title)} (score: ${res.score})`,
          value: escapeMarkdown(res.snippet).slice(0, 250) || "No snippet",
        };
      }),
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleGrillMeCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "start") {
    const topic = interaction.options.getString("topic", true);
    const taskId = interaction.options.getString("task_id") ?? undefined;
    const questionnaire = await options.api.grillStart(guildId, interaction.user.id, topic, taskId);
    const embed = new EmbedBuilder()
      .setTitle(`Technical Interrogation · ${escapeMarkdown(questionnaire.topic)}`)
      .setDescription(`${questionnaire.questions.length} architectural question(s) generated:`)
      .addFields(
        questionnaire.questions.slice(0, 8).map((q) => ({
          name: `[${q.pillar}] ${escapeMarkdown(q.question)}`,
          value: q.options
            .map(
              (o) =>
                `• **${o.key}**: ${escapeMarkdown(o.label)}${q.recommendedOptionKey === o.key ? " ⭐ Recommended" : ""}\n  _${escapeMarkdown(o.pros)}_`,
            )
            .join("\n")
            .slice(0, 1_024),
        })),
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const topic = interaction.options.getString("topic", true);
  const question = interaction.options.getString("question", true);
  const optionKey = interaction.options.getString("option", true);
  const notes = interaction.options.getString("notes") ?? undefined;
  const taskId = interaction.options.getString("task_id") ?? undefined;
  const result = await options.api.grillAnswer(guildId, interaction.user.id, {
    topic,
    answers: [{ question, selectedOptionKey: optionKey, notes }],
    taskId,
    saveAsDecision: true,
  });

  const embed = new EmbedBuilder()
    .setTitle(`Architectural Decision · ${escapeMarkdown(result.draft.title)}`)
    .setDescription(
      `Recorded decision${result.decisionId ? ` \`${result.decisionId}\`` : ""}: ${escapeMarkdown(result.draft.description)}`,
    )
    .addFields(
      {
        name: "Outcome",
        value: escapeMarkdown(result.draft.outcome).slice(0, 1_024),
      },
      {
        name: "Rationale",
        value: escapeMarkdown(result.draft.rationale).slice(0, 1_024),
      },
      {
        name: "Context",
        value: escapeMarkdown(result.draft.context).slice(0, 1_024),
      },
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleTeamworkPreviewCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const preview = await options.api.teamworkPreview(guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setTitle("Teamwork Preview · Workload & Bottlenecks")
    .setDescription(
      `Team of ${preview.totalMembers} member(s) (${preview.overloadedMembersCount} overloaded)`,
    )
    .addFields(
      {
        name: "Member Workloads",
        value:
          preview.members.length === 0
            ? "No members assigned"
            : preview.members
                .map(
                  (m) =>
                    `• **${escapeMarkdown(m.displayName)}** (${m.roles.join(", ")}): ${m.assignedTasksCount} task(s), ~${m.estimatedHoursRemaining}h remaining (${m.loadCategory})`,
                )
                .join("\n")
                .slice(0, 1_024),
      },
      {
        name: "Critical Handoffs",
        value:
          preview.handoffs.length === 0
            ? "No cross-member handoffs"
            : preview.handoffs
                .slice(0, 5)
                .map(
                  (h) =>
                    `• ${escapeMarkdown(h.blockingMemberName)} → ${escapeMarkdown(h.waitingMemberName)} (Tasks \`${h.dependencyTaskId}\` → \`${h.blockedTaskId}\`)`,
                )
                .join("\n")
                .slice(0, 1_024),
      },
      {
        name: "Bottleneck Members",
        value:
          preview.bottleneckMemberIds.length === 0
            ? "No bottleneck members detected"
            : preview.bottleneckMemberIds
                .map((id) => {
                  const m = preview.members.find((member) => member.memberId === id);
                  return `⚠️ **${escapeMarkdown(m?.displayName ?? id)}** (\`${id}\`)`;
                })
                .join("\n")
                .slice(0, 1_024),
      },
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleLearnCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "record") {
    const title = interaction.options.getString("title", true);
    const lesson = interaction.options.getString("lesson", true);
    const taskId = interaction.options.getString("task_id") ?? undefined;
    const res = await options.api.learningRecord(guildId, interaction.user.id, {
      title,
      lesson,
      taskId,
    });
    await interaction.editReply({
      content: `Engineering lesson recorded: **${escapeMarkdown(res.title)}** (\`${res.id}\`)`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const report = await options.api.learningInsights(guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setTitle("Retrospective Learning Insights")
    .setDescription(
      `Analyzed project execution: ${report.completedTasksCount} completed task(s), ${report.resolvedBlockersCount} resolved blocker(s).`,
    )
    .addFields(
      {
        name: "Velocity",
        value: `Avg effort: ${report.averageEffortHours}h / task\nPrimary blocker source: ${report.primaryBlockerSource}`,
        inline: true,
      },
      {
        name: "Insights & Recommendations",
        value:
          report.insights.length === 0
            ? "No specific learning patterns identified yet."
            : report.insights
                .slice(0, 5)
                .map(
                  (i) =>
                    `• [${i.category}] **${escapeMarkdown(i.title)}**\n  _${escapeMarkdown(i.observation)}_\n  👉 ${escapeMarkdown(i.recommendation)}`,
                )
                .join("\n\n")
                .slice(0, 1_024),
      },
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleBoostCommand(
  interaction: ChatInputCommandInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "task") {
    const taskId = interaction.options.getString("task_id", true);
    const boost = await options.api.boostTask(guildId, interaction.user.id, taskId);
    const rawBlueprint = boost as {
      executionBlueprint?: readonly string[];
      executionSteps?: readonly string[];
    };
    const blueprintSteps = rawBlueprint.executionBlueprint ?? rawBlueprint.executionSteps ?? [];
    const checklist = boost.verificationChecklist ?? [];
    const embed = new EmbedBuilder()
      .setTitle(`Task Boost · ${escapeMarkdown(boost.title)}`)
      .setDescription(`Execution accelerator for task \`${boost.taskId}\``)
      .addFields(
        {
          name: "Execution Blueprint",
          value:
            blueprintSteps
              .map((s) => `• ${escapeMarkdown(s)}`)
              .join("\n")
              .slice(0, 1_024) || "None",
        },
        {
          name: "Verification Checklist",
          value:
            checklist
              .map((s) => `☐ ${escapeMarkdown(s)}`)
              .join("\n")
              .slice(0, 1_024) || "None",
        },
        {
          name: "AI Prompt Template",
          value: `\`\`\`\n${boost.aiPromptTemplate.slice(0, 950)}\n\`\`\``,
        },
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === "unblock") {
    const plans = await options.api.boostUnblock(guildId, interaction.user.id);
    const embed = new EmbedBuilder()
      .setTitle("Tactical Unblocking Plans")
      .setDescription(`Analyzed ${plans.length} blocker(s).`)
      .addFields(
        plans.length === 0
          ? [{ name: "Status", value: "No active blockers require tactical unblocking." }]
          : plans.slice(0, 5).map((plan) => {
              const raw = plan as {
                tacticalSteps?: readonly string[];
                action?: string;
                estimatedTimeSavedHours?: number;
              };
              const steps = raw.tacticalSteps ?? (raw.action ? [raw.action] : []);
              const hours = raw.estimatedTimeSavedHours ?? 0;
              return {
                name: `[${plan.severity}] ${escapeMarkdown(plan.description)}${hours > 0 ? ` (Save ~${hours}h)` : ""}`,
                value:
                  steps
                    .map((s) => `• ${escapeMarkdown(s)}`)
                    .join("\n")
                    .slice(0, 1_000) || "None",
              };
            }),
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const suggestions = await options.api.boostSuggest(guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setTitle("Scope & Execution Optimizations")
    .setDescription(`${suggestions.length} optimization recommendation(s) generated.`)
    .addFields(
      suggestions.length === 0
        ? [{ name: "Status", value: "Task graph is optimal; no adjustments recommended." }]
        : suggestions.slice(0, 5).map((s) => {
            const raw = s as {
              type?: string;
              category?: string;
              description?: string;
              details?: string;
              affectedTaskIds?: readonly string[];
            };
            const type = raw.type ?? raw.category ?? "OPTIMIZATION";
            const desc = raw.description ?? raw.details ?? "";
            const count = raw.affectedTaskIds?.length ?? 0;
            return {
              name: `[${type}]${count > 0 ? ` (${count} task(s) affected)` : ""}`,
              value: escapeMarkdown(desc).slice(0, 1_000) || "No details",
            };
          }),
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleMissionControlButton(
  interaction: ButtonInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (interaction.customId === "mc:my-task") {
    const result = await options.api.whatNow(guildId, interaction.user.id);
    await interaction.editReply({ embeds: [whatNowEmbed(result)] });
    return;
  }
  if (interaction.customId === "mc:project") {
    const view = await options.api.missionControl(guildId, interaction.user.id);
    await interaction.editReply({ embeds: [missionControlEmbed(view)] });
    return;
  }
  if (interaction.customId === "mc:risks") {
    const view = await options.api.missionControl(guildId, interaction.user.id);
    const active = view.risks.signals.filter((signal) => signal.active);
    await interaction.editReply({
      content:
        active.length === 0
          ? "No active deterministic risk signals."
          : active.map((signal) => `• ${escapeMarkdown(signal.title)}`).join("\n"),
    });
    return;
  }
  await interaction.editReply({
    content:
      interaction.customId === "mc:ask"
        ? "Use `/producer ask` to ask a project-grounded question."
        : "Use `/task update` to record a lifecycle change and evidence.",
  });
}

async function handleSetupModal(
  interaction: ModalSubmitInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const draftId = interaction.customId.slice("project-setup:".length);
  const draft = await options.setupDrafts.take(draftId, interaction.user.id, guildId);
  if (draft === undefined) {
    await interaction.reply(privateMessage("This setup form expired. Run `/project setup` again."));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await options.api.setupProject({
    discordGuildId: guildId,
    ownerExternalUserId: interaction.user.id,
    ownerDisplayName: displayName(interaction),
    name: interaction.fields.getTextInputValue("name"),
    description: interaction.fields.getTextInputValue("description"),
    vision: interaction.fields.getTextInputValue("vision"),
    deadline: interaction.fields.getTextInputValue("deadline"),
    timezone: interaction.fields.getTextInputValue("timezone"),
    mode: draft.mode,
    constraints: draft.constraints,
    ...(draft.githubRepository === undefined ? {} : { githubRepository: draft.githubRepository }),
  });
  await interaction.editReply({
    content: `Project configured. Nehemiah is now tracking it as \`${result.projectId}\`.`,
    allowedMentions: { parse: [] },
  });
}

async function handleTeamModal(
  interaction: ModalSubmitInteraction,
  options: InteractionHandlerOptions,
): Promise<void> {
  const guildId = requireGuild(interaction);
  const hoursRaw = interaction.fields.getTextInputValue("hours").trim();
  const hoursPerWeek = Number(hoursRaw);
  if (hoursRaw === "" || !Number.isFinite(hoursPerWeek) || hoursPerWeek < 0 || hoursPerWeek > 168) {
    throw new DirectorApiError(400, "Available hours must be between 0 and 168.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await options.api.joinTeam({
    discordGuildId: guildId,
    externalUserId: interaction.user.id,
    displayName: displayName(interaction),
    roles: parseList(interaction.fields.getTextInputValue("roles")).map((role) =>
      role.toUpperCase(),
    ),
    skills: parseSkills(interaction.fields.getTextInputValue("skills")),
    hoursPerWeek,
    timezone: interaction.fields.getTextInputValue("timezone"),
    aiTools: parseList(interaction.fields.getTextInputValue("ai_tools")),
  });
  await interaction.editReply({
    content: `Your team profile is saved (\`${result.memberId}\`).`,
    allowedMentions: { parse: [] },
  });
}

function humanError(error: unknown): string {
  if (error instanceof DirectorApiError) {
    if (error.code === "PROVIDER_NOT_CONFIGURED") {
      return "No AI provider is configured. Deterministic project tracking remains available.";
    }
    return error.message;
  }
  return "Something went wrong while processing that request. Please try again.";
}

async function replyWithError(interaction: Interaction, error: unknown): Promise<void> {
  if (!interaction.isRepliable()) return;
  const content = humanError(error);
  if (interaction.deferred) {
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  } else if (interaction.replied) {
    await interaction.followUp(privateMessage(content));
  } else {
    await interaction.reply(privateMessage(content));
  }
}

export function createInteractionHandler(options: InteractionHandlerOptions) {
  return async (interaction: Interaction): Promise<void> => {
    try {
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          case "project":
            await handleProjectCommand(interaction, options);
            return;
          case "team":
            await handleTeamCommand(interaction, options);
            return;
          case "task":
            await handleTaskCommand(interaction, options);
            return;
          case "producer":
            await handleProducerCommand(interaction, options);
            return;
          case "blocker":
            await handleBlockerCommand(interaction, options);
            return;
          case "goal":
            await handleGoalCommand(interaction, options);
            return;
          case "browser":
            await handleBrowserCommand(interaction, options);
            return;
          case "grill-me":
            await handleGrillMeCommand(interaction, options);
            return;
          case "teamwork-preview":
            await handleTeamworkPreviewCommand(interaction, options);
            return;
          case "learn":
            await handleLearnCommand(interaction, options);
            return;
          case "boost":
            await handleBoostCommand(interaction, options);
            return;
          default:
            return;
        }
      }
      if (interaction.isButton() && interaction.customId.startsWith("mc:")) {
        await handleMissionControlButton(interaction, options);
        return;
      }
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith("project-setup:")) {
          await handleSetupModal(interaction, options);
        } else if (interaction.customId === "team-join") {
          await handleTeamModal(interaction, options);
        }
      }
    } catch (error) {
      options.logger?.error(
        {
          interactionId: interaction.id,
          commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
          errorCategory:
            error instanceof DirectorApiError
              ? { name: error.name, status: error.status, code: error.code }
              : { name: error instanceof Error ? error.name : "UnknownError" },
        },
        "Discord interaction failed",
      );
      await replyWithError(interaction, error);
    }
  };
}
