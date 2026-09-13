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
