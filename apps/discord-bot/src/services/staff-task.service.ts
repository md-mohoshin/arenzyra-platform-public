import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type ModalSubmitInteraction,
  type Role,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ArenzyraApiClient,
  type CreateStaffTaskTemplatePayload,
  type StaffTaskActionResponse,
  type StaffTaskResponse,
  type StaffTaskRunResponse,
  type StaffTaskTemplateResponse,
} from "../api/api-client";

const STAFF_ROLE_NAMES = [
  "[OWNER]",
  "Arenzyra Admin",
  "Arenzyra Staff",
  "Production Lead",
  "Tournament Organizer",
];
const ADMIN_ROLE_NAMES = ["[OWNER]", "Arenzyra Admin", "Production Lead"];
const TASK_SELECT_PREFIX = "stafftask:select:";
const TASK_REFRESH_PREFIX = "stafftask:refresh:";
const TASK_TEMPLATE_SELECT_PREFIX = "stafftask:template:";
const TASK_COMPLETION_MODAL_PREFIX = "stafftask:completion-modal:";
const DISCORD_USER_MENTION = /^<@!?(\d{17,22})>$/;

type TaskSpec = CreateStaffTaskTemplatePayload["items"][number];

export class StaffTaskService {
  private readonly apiClient = new ArenzyraApiClient();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;

  private isTextChannel(channel: unknown): channel is GuildTextBasedChannel {
    return Boolean(
      channel &&
        typeof (channel as { isTextBased?: () => boolean }).isTextBased ===
          "function" &&
        (channel as { isTextBased: () => boolean }).isTextBased() &&
        typeof (channel as { send?: unknown }).send === "function",
    );
  }

  private memberHasRoleName(member: GuildMember, roleName: string) {
    return member.roles.cache.some((role) => role.name === roleName);
  }

  private memberHasStaffAccess(member: GuildMember, staffRoleIds: string[] = []) {
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return true;
    }
    if (staffRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
      return true;
    }
    if (staffRoleIds.length > 0) return false;
    return STAFF_ROLE_NAMES.some((roleName) =>
      this.memberHasRoleName(member, roleName),
    );
  }

  private memberCanManageTasks(member: GuildMember) {
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      return true;
    }
    return ADMIN_ROLE_NAMES.some((roleName) =>
      this.memberHasRoleName(member, roleName),
    );
  }

  private async memberForInteraction(
    interaction:
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction
      | ChatInputCommandInteraction,
  ) {
    if (!interaction.inGuild() || !interaction.guild) return null;
    return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  }

  private actor(interaction: {
    user: { id: string; username: string; globalName?: string | null };
  }) {
    return {
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.globalName ?? interaction.user.username,
    };
  }

  private async withGuildOrganization<T>(guild: Guild, fn: () => Promise<T>) {
    const linked = await this.apiClient.resolveDiscordGuild(guild.id);
    return this.apiClient.withOrganization(linked.organizationId, fn);
  }

  private scheduleLabel(template: StaffTaskTemplateResponse) {
    if (template.scheduleFrequency === "ONCE") {
      return template.scheduledAt
        ? `once at <t:${Math.floor(new Date(template.scheduledAt).getTime() / 1000)}:f>`
        : "once";
    }
    if (template.scheduleFrequency === "DAILY") {
      return `daily at ${template.scheduleTime ?? "--:--"} (${template.timeZone})`;
    }
    const days = template.scheduleWeekdays
      .map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day])
      .filter(Boolean)
      .join(", ");
    return `${days || "weekly"} at ${template.scheduleTime ?? "--:--"} (${template.timeZone})`;
  }

  private taskStatusLabel(task: StaffTaskResponse) {
    switch (task.status) {
      case "OPEN":
        return task.assigneeDiscordUserId
          ? `assigned to <@${task.assigneeDiscordUserId}>`
          : "available";
      case "CLAIM_PENDING":
        return "claim waiting for confirmation";
      case "CLAIMED":
        return `in progress by <@${task.claimedByDiscordUserId}>`;
      case "RELEASE_PENDING":
        return "release waiting for confirmation";
      case "COMPLETION_PENDING":
        return "completion waiting for confirmation";
      case "PENDING_REVIEW":
        return "waiting for staff review";
      case "COMPLETED":
        return `completed by <@${task.claimedByDiscordUserId}>`;
      default:
        return "closed";
    }
  }

  private boardPayload(run: StaffTaskRunResponse) {
    const description = run.tasks
      .map(
        (task, index) =>
          `**${index + 1}. ${task.title}** · ${task.points} pt${
            task.points === 1 ? "" : "s"
          }\n${this.taskStatusLabel(task)}`,
      )
      .join("\n\n")
      .slice(0, 3900);
    const closesAt = Math.floor(new Date(run.closesAt).getTime() / 1000);
    const embed = new EmbedBuilder()
      .setTitle(`Staff Tasks · ${run.template?.name ?? "Schedule"}`)
      .setDescription(description || "No tasks configured.")
      .setColor(0x5865f2)
      .setFooter({ text: "Choose a task below. Every claim, release, completion, and review is logged." })
      .addFields({ name: "Closes", value: `<t:${closesAt}:R>`, inline: true });

    const taskOptions = run.tasks.slice(0, 25).map((task, index) => ({
      label: `${index + 1}. ${task.title}`.slice(0, 100),
      value: task.id,
      description: `${this.taskStatusLabel(task)} · ${task.points} point${
        task.points === 1 ? "" : "s"
      }`.slice(0, 100),
    }));
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    if (taskOptions.length) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${TASK_SELECT_PREFIX}${run.id}`)
            .setPlaceholder("Choose a task to view its actions")
            .addOptions(taskOptions),
        ),
      );
    }
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${TASK_REFRESH_PREFIX}${run.id}`)
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
    return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
  }

  private taskDetailPayload(task: StaffTaskResponse, canManage: boolean) {
    const lines = [
      `**${task.title}**`,
      task.description || "No extra instructions.",
      `Status: **${this.taskStatusLabel(task)}**`,
      `Value: **${task.points} point${task.points === 1 ? "" : "s"}**${
        task.requiresReview ? " · review required" : ""
      }`,
    ];
    const buttons: ButtonBuilder[] = [];
    if (task.status === "OPEN") {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`stafftask:claim:${task.id}`)
          .setLabel("Take task")
          .setStyle(ButtonStyle.Primary),
      );
    }
    if (task.status === "CLAIMED") {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`stafftask:complete:${task.id}`)
          .setLabel("Complete")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`stafftask:release:${task.id}`)
          .setLabel("Release task")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (task.status === "PENDING_REVIEW" && canManage) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`stafftask:approve:${task.id}`)
          .setLabel("Approve completion")
          .setStyle(ButtonStyle.Success),
      );
    }
    return {
      content: lines.join("\n"),
      components: buttons.length
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)]
        : [],
      allowedMentions: { parse: [] as [] },
    };
  }

  private confirmationPayload(
    taskId: string,
    action: "claim" | "release" | "completion",
    title: string,
  ) {
    return {
      content: `${title}\nThis request expires in 5 minutes unless you confirm or cancel it.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`stafftask:${action}-confirm:${taskId}`)
            .setLabel("Confirm")
            .setStyle(action === "release" ? ButtonStyle.Danger : ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`stafftask:${action}-cancel:${taskId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  }

  private async taskForGuild(guild: Guild, taskId: string) {
    return this.withGuildOrganization(guild, async () => {
      const board = await this.apiClient.getStaffTaskBoard(guild.id);
      for (const run of board.runs) {
        const task = run.tasks.find((candidate) => candidate.id === taskId);
        if (task) return { run, task };
      }
      return null;
    });
  }

  private async ensureTaskStaffAccess(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    taskId: string,
  ) {
    if (!interaction.guild) return null;
    const resolved = await this.taskForGuild(interaction.guild, taskId);
    if (!resolved) return null;
    const member = await this.memberForInteraction(interaction);
    if (!member || !this.memberHasStaffAccess(member, resolved.run.template?.staffRoleIds ?? [])) {
      throw new Error("Only configured staff can use this task board.");
    }
    return { ...resolved, member };
  }

  private async refreshRunBoard(guild: Guild, runId: string) {
    const run = await this.withGuildOrganization(guild, async () => {
      const board = await this.apiClient.getStaffTaskBoard(guild.id);
      return board.runs.find((candidate) => candidate.id === runId) ?? null;
    });
    if (!run?.boardMessageId) return;
    const channel = await guild.channels.fetch(run.boardChannelId).catch(() => null);
    if (!this.isTextChannel(channel)) return;
    const message = await channel.messages.fetch(run.boardMessageId).catch(() => null);
    if (!message?.editable) return;
    await message.edit(this.boardPayload(run));
  }

  private eventLabel(action: string) {
    return action
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  private async sendActionLog(
    guild: Guild,
    result: StaffTaskActionResponse,
    actorId: string,
  ) {
    const channel = await guild.channels.fetch(result.logChannelId).catch(() => null);
    if (!this.isTextChannel(channel)) return;
    const claimedBy = result.task.claimedByDiscordUserId
      ? `<@${result.task.claimedByDiscordUserId}>`
      : "unassigned";
    const note = result.task.completionNote
      ? `\nProof/note: ${result.task.completionNote}`
      : "";
    await channel
      .send({
        content: `**Staff task ${this.eventLabel(result.action)}**\n` +
          `Board: **${result.templateName}** · Task: **${result.task.title}**\n` +
          `Action by: <@${actorId}> · Holder: ${claimedBy} · Status: **${result.task.status}**${note}`,
        allowedMentions: { parse: [] },
      })
      .catch((error) => {
        console.warn(
          `[StaffTasks] failed to send action log for task=${result.task.id}: ${String(error)}`,
        );
      });
  }

  private async applyActionResult(
    guild: Guild,
    result: StaffTaskActionResponse,
    actorId: string,
  ) {
    await Promise.all([
      this.refreshRunBoard(guild, result.runId).catch((error) => {
        console.warn(`[StaffTasks] failed to refresh board ${result.runId}: ${String(error)}`);
      }),
      this.sendActionLog(guild, result, actorId),
    ]);
  }

  private parseWeekdays(value: string | null) {
    if (!value?.trim()) return [];
    const lookup: Record<string, number> = {
      sun: 0,
      sunday: 0,
      mon: 1,
      monday: 1,
      tue: 2,
      tues: 2,
      tuesday: 2,
      wed: 3,
      wednesday: 3,
      thu: 4,
      thur: 4,
      thurs: 4,
      thursday: 4,
      fri: 5,
      friday: 5,
      sat: 6,
      saturday: 6,
    };
    const days = value
      .split(/[\s,]+/)
      .map((part) => lookup[part.trim().toLowerCase()])
      .filter((day): day is number => Number.isInteger(day));
    if (!days.length) {
      throw new Error("Use weekday names such as mon,wed,fri.");
    }
    return Array.from(new Set(days)).sort((left, right) => left - right);
  }

  private localDateTimeToIso(dateKey: string, time: string, timeZone: string) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    const timeMatch = /^([01]\d|2[0-3]):[0-5]\d$/.exec(time);
    if (!dateMatch || !timeMatch) {
      throw new Error("Use date YYYY-MM-DD and time HH:MM.");
    }
    const target = Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(time.slice(0, 2)),
      Number(time.slice(3, 5)),
    );
    let candidate = target;
    const localParts = (date: Date) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date);
      const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
      return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"));
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const difference = target - localParts(new Date(candidate));
      if (difference === 0) break;
      candidate += difference;
    }
    return new Date(candidate).toISOString();
  }

  private parseTaskSpecs(value: string) {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      throw new Error("Add at least one task line.");
    }
    if (lines.length > 25) {
      throw new Error("A task board can contain up to 25 tasks.");
    }
    return lines.map((line): TaskSpec => {
      const parts = line.split("|").map((part) => part.trim());
      const title = parts[0] ?? "";
      const points = Number(parts[1]);
      if (!title || !Number.isInteger(points) || points < 1 || points > 100) {
        throw new Error(
          "Each task must use: title | points | description | optional @staff | optional review",
        );
      }
      const assigneeMatch = DISCORD_USER_MENTION.exec(parts[3] ?? "");
      const review = /^(review|yes|true|required)$/i.test(parts[4] ?? "");
      return {
        title: title.slice(0, 160),
        points,
        description: parts[2]?.slice(0, 1200) || null,
        assigneeDiscordUserId: assigneeMatch?.[1] ?? null,
        requiresReview: review,
      };
    });
  }

  private async selectedTemplate(
    guild: Guild,
    templateId: string,
  ) {
    return this.withGuildOrganization(guild, async () => {
      const templates = await this.apiClient.listStaffTaskTemplates(guild.id);
      return templates.find((template) => template.id === templateId) ?? null;
    });
  }

  private templateCard(template: StaffTaskTemplateResponse) {
    const description = template.items
      .map(
        (item, index) =>
          `${index + 1}. **${item.title}** · ${item.points} pt${
            item.points === 1 ? "" : "s"
          }${item.requiresReview ? " · review" : ""}`,
      )
      .join("\n")
      .slice(0, 3000);
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`Staff task template · ${template.name}`)
          .setColor(template.enabled ? 0x57f287 : 0xed4245)
          .setDescription(description || "No tasks")
          .addFields(
            { name: "Schedule", value: this.scheduleLabel(template) },
            {
              name: "State",
              value: template.enabled ? "Enabled" : "Disabled",
              inline: true,
            },
          ),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`stafftask:template-post:${template.id}`)
            .setLabel("Post now")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!template.enabled),
          new ButtonBuilder()
            .setCustomId(`stafftask:template-toggle:${template.id}`)
            .setLabel(template.enabled ? "Disable schedule" : "Enable schedule")
            .setStyle(template.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        ),
      ],
    };
  }

  async handleCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: "Use staff tasks inside the Discord server.", ephemeral: true });
      return;
    }
    const member = await this.memberForInteraction(interaction);
    if (!member || !this.memberCanManageTasks(member)) {
      await interaction.reply({ content: "Only server task managers can configure staff task schedules.", ephemeral: true });
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "configure") {
      const frequency = interaction.options.getString("frequency", true) as CreateStaffTaskTemplatePayload["scheduleFrequency"];
      const time = interaction.options.getString("time")?.trim() || "18:00";
      const date = interaction.options.getString("date")?.trim() || null;
      const boardChannel = interaction.options.getChannel("board-channel") ?? interaction.channel;
      const logChannel = interaction.options.getChannel("log-channel") ?? interaction.channel;
      if (!this.isTextChannel(boardChannel) || !this.isTextChannel(logChannel)) {
        await interaction.reply({ content: "Choose text channels for the board and log.", ephemeral: true });
        return;
      }
      if (frequency === "ONCE" && !date) {
        await interaction.reply({ content: "A one-time board needs a date in YYYY-MM-DD.", ephemeral: true });
        return;
      }
      try {
        const timeZone = "Europe/Bucharest";
        const payload: CreateStaffTaskTemplatePayload = {
          guildId: interaction.guild.id,
          name: interaction.options.getString("name", true),
          scheduleFrequency: frequency,
          ...(frequency === "ONCE"
            ? { scheduledAt: this.localDateTimeToIso(date!, time, timeZone) }
            : {
                scheduleTime: time,
                ...(frequency === "WEEKLY"
                  ? { scheduleWeekdays: this.parseWeekdays(interaction.options.getString("weekdays")) }
                  : {}),
              }),
          timeZone,
          durationMinutes: (interaction.options.getInteger("duration-hours") ?? 24) * 60,
          boardChannelId: boardChannel.id,
          logChannelId: logChannel.id,
          staffRoleIds: interaction.options.getRole("staff-role")
            ? [interaction.options.getRole("staff-role", true).id]
            : [],
          items: this.parseTaskSpecs(interaction.options.getString("tasks", true)),
        };
        const template = await this.withGuildOrganization(interaction.guild, () =>
          this.apiClient.createStaffTaskTemplate(payload),
        );
        await interaction.reply({
          content: `Saved **${template.name}**. ${this.scheduleLabel(template)}. Use **/staff-tasks templates** to post it now or manage it.`,
          ephemeral: true,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        await interaction.reply({
          content: error instanceof Error ? error.message : "Unable to save the staff task schedule.",
          ephemeral: true,
        });
      }
      return;
    }

    if (subcommand === "templates") {
      try {
        const templates = await this.withGuildOrganization(interaction.guild, () =>
          this.apiClient.listStaffTaskTemplates(interaction.guild!.id),
        );
        if (!templates.length) {
          await interaction.reply({ content: "No staff task templates are configured yet.", ephemeral: true });
          return;
        }
        await interaction.reply({
          content: "Choose a staff task template to post now, enable, or disable.",
          ephemeral: true,
          components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`${TASK_TEMPLATE_SELECT_PREFIX}${interaction.guild.id}`)
                .setPlaceholder("Choose a task template")
                .addOptions(
                  templates.slice(0, 25).map((template) => ({
                    label: template.name.slice(0, 100),
                    value: template.id,
                    description: `${template.enabled ? "Enabled" : "Disabled"} · ${this.scheduleLabel(template)}`.slice(0, 100),
                  })),
                ),
            ),
          ],
        });
      } catch (error) {
        await interaction.reply({ content: error instanceof Error ? error.message : "Unable to load task templates.", ephemeral: true });
      }
      return;
    }

    const month = interaction.options.getString("month")?.trim() || undefined;
    try {
      const leaderboard = await this.withGuildOrganization(interaction.guild, () =>
        this.apiClient.getStaffTaskLeaderboard(interaction.guild!.id, month),
      );
      const rows = leaderboard.rankings.length
        ? leaderboard.rankings
            .slice(0, 20)
            .map(
              (row) =>
                `**${row.rank}.** <@${row.discordUserId}> — **${row.points} pts** (${row.completedTasks} task${row.completedTasks === 1 ? "" : "s"})`,
            )
            .join("\n")
        : "No approved or completed task points yet.";
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Staff Activity · ${leaderboard.month}`)
            .setDescription(rows)
            .setColor(0xf5a524)
            .setFooter({ text: `Task points only · ${leaderboard.timeZone}` }),
        ],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await interaction.reply({ content: error instanceof Error ? error.message : "Unable to load the staff leaderboard.", ephemeral: true });
    }
  }

  async handleStringSelectMenu(interaction: StringSelectMenuInteraction) {
    if (!interaction.inGuild() || !interaction.guild) return false;
    if (interaction.customId.startsWith(TASK_SELECT_PREFIX)) {
      const taskId = interaction.values[0];
      if (!taskId) return true;
      try {
        const resolved = await this.ensureTaskStaffAccess(interaction, taskId);
        if (!resolved) {
          await interaction.reply({ content: "This task is no longer active.", ephemeral: true });
          return true;
        }
        await interaction.reply({
          ...this.taskDetailPayload(resolved.task, this.memberCanManageTasks(resolved.member)),
          ephemeral: true,
        });
      } catch (error) {
        await interaction.reply({ content: error instanceof Error ? error.message : "Unable to open this task.", ephemeral: true });
      }
      return true;
    }
    if (interaction.customId.startsWith(TASK_TEMPLATE_SELECT_PREFIX)) {
      const member = await this.memberForInteraction(interaction);
      if (!member || !this.memberCanManageTasks(member)) {
        await interaction.reply({ content: "Only server task managers can manage templates.", ephemeral: true });
        return true;
      }
      const templateId = interaction.values[0];
      if (!templateId) return true;
      const template = await this.selectedTemplate(interaction.guild, templateId);
      if (!template) {
        await interaction.reply({ content: "This task template no longer exists.", ephemeral: true });
        return true;
      }
      await interaction.update(this.templateCard(template));
      return true;
    }
    return false;
  }

  private async postRun(guild: Guild, run: StaffTaskRunResponse) {
    const channel = await guild.channels.fetch(run.boardChannelId).catch(() => null);
    if (!this.isTextChannel(channel)) {
      throw new Error("Configured task board channel is unavailable or not a text channel");
    }
    const message = await channel.send(this.boardPayload(run));
    await this.withGuildOrganization(guild, () =>
      this.apiClient.markStaffTaskBoardPosted(run.id, {
        discordUserId: guild.client.user?.id ?? "0",
        discordUsername: guild.client.user?.username ?? "Arenzyra Bot",
        boardChannelId: channel.id,
        boardMessageId: message.id,
      }),
    );
    const logChannelId = run.template?.logChannelId;
    const logChannel = logChannelId
      ? await guild.channels.fetch(logChannelId).catch(() => null)
      : null;
    if (this.isTextChannel(logChannel)) {
      await logChannel.send({
        content: `**Daily staff task board posted**\nBoard: **${run.template?.name ?? "Schedule"}** · closes <t:${Math.floor(new Date(run.closesAt).getTime() / 1000)}:R>`,
        allowedMentions: { parse: [] },
      });
    }
  }

  async handleButton(interaction: ButtonInteraction) {
    if (!interaction.inGuild() || !interaction.guild) return false;
    if (interaction.customId.startsWith(TASK_REFRESH_PREFIX)) {
      const runId = interaction.customId.slice(TASK_REFRESH_PREFIX.length);
      await interaction.deferReply({ ephemeral: true });
      await this.refreshRunBoard(interaction.guild, runId);
      await interaction.editReply("Task board refreshed.");
      return true;
    }
    if (interaction.customId.startsWith("stafftask:template-")) {
      const member = await this.memberForInteraction(interaction);
      if (!member || !this.memberCanManageTasks(member)) {
        await interaction.reply({ content: "Only server task managers can manage templates.", ephemeral: true });
        return true;
      }
      const [, , action, templateId] = interaction.customId.split(":");
      const template = await this.selectedTemplate(interaction.guild, templateId ?? "");
      if (!template) {
        await interaction.reply({ content: "This task template no longer exists.", ephemeral: true });
        return true;
      }
      if (action === "post") {
        await interaction.deferReply({ ephemeral: true });
        const run = await this.withGuildOrganization(interaction.guild, () =>
          this.apiClient.postStaffTaskTemplateNow(template.id),
        );
        await this.postRun(interaction.guild, run);
        await interaction.editReply(`Posted **${template.name}** in <#${run.boardChannelId}>.`);
        return true;
      }
      if (action === "toggle") {
        await interaction.deferUpdate();
        const updated = await this.withGuildOrganization(interaction.guild, () =>
          this.apiClient.setStaffTaskTemplateEnabled(template.id, !template.enabled),
        );
        await interaction.editReply(this.templateCard(updated));
        return true;
      }
      return true;
    }
    if (!interaction.customId.startsWith("stafftask:")) return false;

    const segments = interaction.customId.split(":");
    const action = segments[1] ?? "";
    const taskId = segments[2] ?? "";
    if (action === "complete") {
      const resolved = await this.ensureTaskStaffAccess(interaction, taskId);
      if (!resolved) {
        await interaction.reply({ content: "This task is no longer active.", ephemeral: true });
        return true;
      }
      if (resolved.task.claimedByDiscordUserId !== interaction.user.id) {
        await interaction.reply({ content: "Only the staff member holding this task can complete it.", ephemeral: true });
        return true;
      }
      const modal = new ModalBuilder()
        .setCustomId(`${TASK_COMPLETION_MODAL_PREFIX}${taskId}`)
        .setTitle("Complete staff task")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("stafftask-note")
              .setLabel("Proof or completion note (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(1200),
          ),
        );
      await interaction.showModal(modal);
      return true;
    }
    if (
      ![
        "claim",
        "claim-confirm",
        "claim-cancel",
        "release",
        "release-confirm",
        "release-cancel",
        "approve",
      ].includes(action)
    ) {
      return false;
    }
    await interaction.deferReply({ ephemeral: true });
    const resolved = await this.ensureTaskStaffAccess(interaction, taskId);
    if (!resolved) {
      await interaction.editReply("This task is no longer active.");
      return true;
    }
    const actor = this.actor(interaction);
    const client = this.apiClient;
    const call = async () => {
      switch (action) {
        case "claim":
          return client.requestStaffTaskClaim(taskId, actor);
        case "claim-confirm":
          return client.confirmStaffTaskClaim(taskId, actor);
        case "claim-cancel":
          return client.cancelStaffTaskClaim(taskId, actor);
        case "release":
          return client.requestStaffTaskRelease(taskId, actor);
        case "release-confirm":
          return client.confirmStaffTaskRelease(taskId, actor);
        case "release-cancel":
          return client.cancelStaffTaskRelease(taskId, actor);
        case "approve":
          if (!this.memberCanManageTasks(resolved.member)) {
            throw new Error("Only a task manager can approve completed work.");
          }
          return client.approveStaffTaskCompletion(taskId, actor);
        default:
          return null;
      }
    };
    const result = await this.withGuildOrganization(interaction.guild, call);
    if (!result) return false;
    await this.applyActionResult(interaction.guild, result, interaction.user.id);
    if (action === "claim") {
      await interaction.editReply(
        this.confirmationPayload(taskId, "claim", `Take **${resolved.task.title}**?`),
      );
      return true;
    }
    if (action === "release") {
      await interaction.editReply(
        this.confirmationPayload(
          taskId,
          "release",
          `Release **${resolved.task.title}** back to the board?`,
        ),
      );
      return true;
    }
    const response =
      action === "approve"
        ? `Approved **${result.task.title}** and awarded ${result.task.points} point${result.task.points === 1 ? "" : "s"}.`
        : `${this.eventLabel(result.action)}: **${result.task.title}**.`;
    await interaction.editReply(response);
    return true;
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction) {
    if (!interaction.inGuild() || !interaction.guild) return false;
    if (!interaction.customId.startsWith(TASK_COMPLETION_MODAL_PREFIX)) return false;
    const taskId = interaction.customId.slice(TASK_COMPLETION_MODAL_PREFIX.length);
    const resolved = await this.ensureTaskStaffAccess(interaction, taskId);
    if (!resolved) {
      await interaction.reply({ content: "This task is no longer active.", ephemeral: true });
      return true;
    }
    if (resolved.task.claimedByDiscordUserId !== interaction.user.id) {
      await interaction.reply({ content: "Only the staff member holding this task can complete it.", ephemeral: true });
      return true;
    }
    const result = await this.withGuildOrganization(interaction.guild, () =>
      this.apiClient.requestStaffTaskCompletion(taskId, {
        ...this.actor(interaction),
        completionNote: interaction.fields.getTextInputValue("stafftask-note") || null,
      }),
    );
    await this.applyActionResult(interaction.guild, result, interaction.user.id);
    await interaction.reply({
      ...this.confirmationPayload(taskId, "completion", `Confirm completion of **${resolved.task.title}**?`),
      ephemeral: true,
    });
    return true;
  }

  private async dispatchGuild(guild: Guild) {
    const runs = await this.withGuildOrganization(guild, async () => {
      const result = await this.apiClient.dispatchStaffTasks(guild.id);
      return result.runs;
    });
    for (const run of runs) {
      try {
        await this.postRun(guild, run);
      } catch (error) {
        console.warn(`[StaffTasks] failed to post scheduled board run=${run.id}: ${String(error)}`);
      }
    }
  }

  private async runScheduler(client: { guilds: { cache: Map<string, Guild> } }) {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await this.dispatchGuild(guild).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.toLowerCase().includes("not linked")) {
            console.warn(`[StaffTasks] scheduler skipped guild=${guild.id}: ${message}`);
          }
        });
      }
    } finally {
      this.schedulerRunning = false;
    }
  }

  start(client: { guilds: { cache: Map<string, Guild> } }) {
    if (this.schedulerTimer) return;
    void this.runScheduler(client);
    this.schedulerTimer = setInterval(() => {
      void this.runScheduler(client);
    }, 60_000);
    this.schedulerTimer.unref?.();
  }

  stop() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
}
