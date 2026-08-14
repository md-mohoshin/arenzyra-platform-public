import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import {
  ArenzyraApiClient,
  type DiscordIdpScheduleResponse,
  type ResolvedDiscordChannelResponse,
} from "../api/api-client";

const STAFF_ROLE_NAMES = [
  "[OWNER]",
  "Arenzyra Admin",
  "Arenzyra Staff",
  "Production Lead",
  "Tournament Organizer",
];
const DISCORD_MESSAGE_MAX_LENGTH = 2000;

export class DiscordIdpScheduleService {
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

  private memberHasStaffAccess(
    member: GuildMember,
    config: ResolvedDiscordChannelResponse["config"],
  ) {
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return true;
    }
    const configured = (config.manageRoleIds ?? []).filter(Boolean);
    if (configured.some((roleId) => member.roles.cache.has(roleId))) {
      return true;
    }
    if (configured.length > 0) return false;
    return STAFF_ROLE_NAMES.some((roleName) =>
      member.roles.cache.some((role) => role.name === roleName),
    );
  }

  private actor(interaction: { user: { id: string; username: string; globalName?: string | null } }) {
    return {
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.globalName ?? interaction.user.username,
    };
  }

  private parseGameCode(value: string) {
    const match = /^g?(\d{1,3})$/i.exec(value.trim());
    const matchNumber = match ? Number(match[1]) : 0;
    if (!Number.isInteger(matchNumber) || matchNumber < 1 || matchNumber > 100) {
      throw new Error("Use a game code such as G1 or G2.");
    }
    return matchNumber;
  }

  private configuredTimeZone(value: string | null | undefined) {
    const timeZone = value?.trim() || "Europe/Bucharest";
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return "Europe/Bucharest";
    }
  }

  private localTimeToIso(value: string, timeZone: string, now = new Date()) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!match) {
      throw new Error("Use start time as local HH:MM, for example 21:30.");
    }
    const readLocalParts = (date: Date) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date);
      const read = (type: string) =>
        Number(parts.find((part) => part.type === type)?.value ?? "0");
      return {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        hour: read("hour"),
        minute: read("minute"),
      };
    };
    const resolveLocalDateTime = (
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
    ) => {
      const target = Date.UTC(year, month - 1, day, hour, minute);
      let candidate = target;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const local = readLocalParts(new Date(candidate));
        const difference =
          target -
          Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
        if (difference === 0) break;
        candidate += difference;
      }
      const resolved = new Date(candidate);
      const local = readLocalParts(resolved);
      if (
        local.year !== year ||
        local.month !== month ||
        local.day !== day ||
        local.hour !== hour ||
        local.minute !== minute
      ) {
        throw new Error("That local time does not exist on this date. Use another time.");
      }
      return resolved;
    };

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const currentLocal = readLocalParts(now);
    let candidate = resolveLocalDateTime(
      currentLocal.year,
      currentLocal.month,
      currentLocal.day,
      hour,
      minute,
    );
    if (candidate.getTime() <= now.getTime()) {
      const tomorrow = new Date(
        Date.UTC(currentLocal.year, currentLocal.month - 1, currentLocal.day) +
          24 * 60 * 60 * 1000,
      );
      candidate = resolveLocalDateTime(
        tomorrow.getUTCFullYear(),
        tomorrow.getUTCMonth() + 1,
        tomorrow.getUTCDate(),
        hour,
        minute,
      );
    }
    return candidate.toISOString();
  }

  private allowedMentions(content: string) {
    const roleIds = Array.from(content.matchAll(/<@&(\d{17,22})>/g)).map(
      (match) => match[1],
    );
    return {
      parse: [] as [],
      ...(roleIds.length ? { roles: roleIds } : {}),
    };
  }

  private primaryMessageContent(schedule: DiscordIdpScheduleResponse) {
    const startsAt = new Date(schedule.startsAt);
    if (Number.isNaN(startsAt.getTime())) return schedule.primaryMessage;

    const unix = Math.floor(startsAt.getTime() / 1000);
    const discordTime = `<t:${unix}:t>`;
    if (!schedule.primaryMessage.includes(discordTime)) {
      return schedule.primaryMessage;
    }

    const timeZone = this.configuredTimeZone(schedule.timeZone);
    const plainTime = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(startsAt);

    const content = schedule.primaryMessage.replace(
      discordTime,
      `${plainTime} (${timeZone}) · ${discordTime}`,
    );
    return content.length <= DISCORD_MESSAGE_MAX_LENGTH
      ? content
      : schedule.primaryMessage;
  }

  private async resolveChannelSession(
    interaction: ChatInputCommandInteraction,
  ) {
    if (!interaction.guildId || !interaction.channelId) {
      throw new Error("Use this command in a synced scrim channel.");
    }
    return this.apiClient.resolveDiscordChannel(
      interaction.guildId,
      interaction.channelId,
    );
  }

  private async upsertPrimaryMessage(
    guild: Guild,
    schedule: DiscordIdpScheduleResponse,
  ) {
    const channel = await guild.channels.fetch(schedule.channelId).catch(() => null);
    if (!this.isTextChannel(channel)) {
      throw new Error("The configured IDP channel is unavailable or not a text channel.");
    }
    let message: Message | null = schedule.primaryMessageId
      ? await channel.messages.fetch(schedule.primaryMessageId).catch(() => null)
      : null;
    const content = this.primaryMessageContent(schedule);
    const payload = {
      content,
      allowedMentions: this.allowedMentions(content),
    };
    if (message?.editable) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
    }
    return message;
  }

  private async sendRoomIdCopyMessage(
    guild: Guild,
    schedule: DiscordIdpScheduleResponse,
    roomId: string,
  ) {
    const channel = await guild.channels.fetch(schedule.channelId).catch(() => null);
    if (!this.isTextChannel(channel)) {
      throw new Error("The configured IDP channel is unavailable or not a text channel.");
    }
    await channel.send({ content: roomId, allowedMentions: { parse: [] } });
  }

  private async sendLog(
    guild: Guild,
    schedule: DiscordIdpScheduleResponse,
    text: string,
  ) {
    if (!schedule.logChannelId) return;
    const channel = await guild.channels.fetch(schedule.logChannelId).catch(() => null);
    if (!this.isTextChannel(channel)) return;
    await channel
      .send({ content: text, allowedMentions: { parse: [] } })
      .catch((error) => {
        console.warn(`[IDP] failed to send log schedule=${schedule.id}: ${String(error)}`);
      });
  }

  async handleCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Use this command inside the Discord server.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const resolved = await this.resolveChannelSession(interaction);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !this.memberHasStaffAccess(member, resolved.config)) {
      await interaction.editReply("Only configured staff can schedule IDP room messages.");
      return;
    }
    const matchNumber = this.parseGameCode(interaction.options.getString("game", true));
    const timeZone = this.configuredTimeZone(
      resolved.config.emojis?.idpScheduleTimeZone,
    );
    const startsAt = this.localTimeToIso(
      interaction.options.getString("starts-at", true),
      timeZone,
    );
    const roomId = interaction.options.getString("room-id", true).trim();
    const actor = this.actor(interaction);
    const schedule = await this.apiClient.withOrganization(
      resolved.config.organizationId,
      () =>
        this.apiClient.createDiscordIdpSchedule(resolved.session.id, {
          guildId: interaction.guild!.id,
          matchNumber,
          roomId,
          roomPassword: interaction.options.getString("password", true),
          startsAt,
          ...actor,
        }),
    );
    const matchLabel = schedule.matchName?.trim() || `G${schedule.matchNumber}`;
    const mapLabel = schedule.map?.trim() ? ` (${schedule.map.trim()})` : "";
    const message = await this.upsertPrimaryMessage(interaction.guild, schedule);
    const saved = await this.apiClient.withOrganization(
      resolved.config.organizationId,
      () =>
        this.apiClient.markDiscordIdpPrimaryPosted(schedule.id, {
          ...actor,
          messageId: message.id,
        }),
    );
    await this.sendRoomIdCopyMessage(interaction.guild, saved, roomId);
    const startsUnix = Math.floor(new Date(saved.startsAt).getTime() / 1000);
    await this.sendLog(
      interaction.guild,
      schedule,
      `**IDP scheduled**\n${matchLabel}${mapLabel} room information and Room ID copy message posted in <#${saved.channelId}>. Start: <t:${startsUnix}:F>. Reminders: ${saved.reminders.map((reminder) => `${reminder.offsetMinutes}m`).join(", ")}.`,
    );
    await interaction.editReply(
      `${matchLabel}${mapLabel} ID/password and Room ID copy message posted in <#${saved.channelId}>. Automatic reminders are scheduled for ${saved.reminders.map((reminder) => `${reminder.offsetMinutes}m`).join(", ")} before <t:${startsUnix}:t>.`,
    );
  }

  private async runGuildScheduler(guild: Guild) {
    const linked = await this.apiClient.resolveDiscordGuild(guild.id);
    const due = await this.apiClient.withOrganization(linked.organizationId, () =>
      this.apiClient.listDueDiscordIdpSchedules(guild.id),
    );
    const now = Date.now();
    for (const schedule of due.schedules) {
      for (const reminder of schedule.reminders) {
        if (schedule.sentReminderKeys.includes(reminder.key)) continue;
        const dueAt =
          new Date(schedule.startsAt).getTime() - reminder.offsetMinutes * 60_000;
        if (now < dueAt || now >= new Date(schedule.startsAt).getTime()) continue;
        let claimed: (DiscordIdpScheduleResponse & { reminder: typeof reminder }) | null = null;
        try {
          claimed = await this.apiClient.withOrganization(linked.organizationId, () =>
            this.apiClient.claimDiscordIdpReminder(schedule.id, reminder.key),
          );
        } catch (error) {
          const text = error instanceof Error ? error.message.toLowerCase() : "";
          if (!text.includes("already sent") && !text.includes("not due")) {
            console.warn(`[IDP] reminder claim failed schedule=${schedule.id} key=${reminder.key}: ${String(error)}`);
          }
          continue;
        }
        const channel = await guild.channels.fetch(claimed.channelId).catch(() => null);
        try {
          if (!this.isTextChannel(channel)) {
            throw new Error("Configured IDP channel is unavailable");
          }
          await channel.send({
            content: claimed.reminder.message,
            allowedMentions: this.allowedMentions(claimed.reminder.message),
          });
          await this.sendLog(
            guild,
            claimed,
            `**IDP reminder sent**\nG${claimed.matchNumber}: ${claimed.reminder.offsetMinutes} minute${claimed.reminder.offsetMinutes === 1 ? "" : "s"} remaining.`,
          );
        } catch (error) {
          await this.apiClient
            .withOrganization(linked.organizationId, () =>
              this.apiClient.releaseDiscordIdpReminder(
                schedule.id,
                reminder.key,
              ),
            )
            .catch(() => undefined);
          console.warn(`[IDP] reminder send failed schedule=${schedule.id} key=${reminder.key}: ${String(error)}`);
        }
      }
    }
  }

  private async runScheduler(client: Client) {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await this.runGuildScheduler(guild).catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          if (
            !message.includes("not linked") &&
            !message.includes("limited to discord management")
          ) {
            console.warn(`[IDP] scheduler skipped guild=${guild.id}: ${String(error)}`);
          }
        });
      }
    } finally {
      this.schedulerRunning = false;
    }
  }

  start(client: Client) {
    if (this.schedulerTimer) return;
    void this.runScheduler(client);
    this.schedulerTimer = setInterval(() => {
      void this.runScheduler(client);
    }, 30_000);
    this.schedulerTimer.unref?.();
  }

  stop() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
}
