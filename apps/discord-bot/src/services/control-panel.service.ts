import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildMember,
  MessageContextMenuCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type {
  DiscordNoShowTeamBanCommand,
  DiscordSessionService,
  DiscordTeamBanCommand,
  DiscordTeamBanServerAction,
  DiscordTeamBanTarget,
  RegistrationPlayStatusAction,
  RegistrationPlayStatusTarget,
} from "./session.service";
import type {
  SessionResponse,
  SessionDiscordConfigResponse,
  TeamBanScope,
} from "../api/api-client";

export type ControlPanelAudience = "teams" | "staff";

type ControlAction =
  | "register-team"
  | "join-scrim"
  | "leave-scrim"
  | "list-slots"
  | "standings"
  | "create-scrim"
  | "configure-scrim"
  | "setup-channels"
  | "sync-discord"
  | "remove-team"
  | "start-scrim"
  | "post-room"
  | "map-slots"
  | "preview-results"
  | "apply-results";

type PanelInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction
  | MessageContextMenuCommandInteraction;

type ResolvedSessionContext = {
  session: SessionResponse;
  config: SessionDiscordConfigResponse;
};

type TextInputConfig = {
  customId: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  style?: TextInputStyle;
  maxLength?: number;
  value?: string;
};

type ParsedControlAction = {
  action: ControlAction;
  sessionId: string | null;
};

type RegistrationControlAction = "a" | "s" | "w" | "v" | "r";

type ParsedRegistrationControlAction = {
  action: RegistrationControlAction;
  sessionId: string;
  registrationId: string;
};

type ParsedRegistrationRemoveConfirmationAction = {
  action: "confirm" | "cancel" | "expired";
  sessionId?: string;
  registrationId?: string;
};

type ParsedPlayStatusAction = {
  action: RegistrationPlayStatusAction;
  sessionId: string;
};

type ParsedPlayStatusTargetSelectAction = {
  action: RegistrationPlayStatusAction;
  sessionId: string;
};

type ParsedWaitlistControlPageAction = {
  sessionId: string;
  page: number;
};

type ParsedWaitlistControlSelectAction = {
  sessionId: string;
  page: number;
};

type BanControlAction =
  | "create"
  | "missing"
  | "list"
  | "refresh"
  | "confirm"
  | "cancel";

type ParsedBanControlAction = {
  action: BanControlAction;
  sessionId: string | null;
  token: string | null;
};

type ManageCardBanAction = "d" | "p";

type ParsedManageCardBanAction = {
  action: ManageCardBanAction;
  sessionId: string;
  teamId: string;
};

type ParsedCaptainPanelAction = {
  action: "logo-help";
  sessionId: string;
};

type ParsedLiveCenterAction = {
  action: "refresh";
  sessionId: string;
};

type PendingBanControlAction =
  | {
      kind: "team";
      userId: string;
      sessionId: string;
      command: DiscordTeamBanCommand;
      expiresAt: number;
    }
  | {
      kind: "no-show";
      userId: string;
      sessionId: string;
      command: DiscordNoShowTeamBanCommand;
      expiresAt: number;
    };

type DiscordRegistrationMemberInput = {
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
};

const STAFF_ROLE_NAMES = [
  "[OWNER]",
  "Arenzyra Admin",
  "Arenzyra Staff",
  "Production Lead",
  "Tournament Organizer",
];
const CHECK = "\u2705";
const ACTION_CONFIRMATION_DELETE_DELAY_MS = 2000;
const BAN_CONTROL_CONFIRMATION_TTL_MS = 60_000;
const MATCH_NUMBER_TEXT_PATTERN =
  /(?:^|[\s,;:])(?:game|match|round|g|m)\s*(?:(?:no|num|number)\.?\s*)?[-#]?\s*(\d{1,3})(?=$|[\s,;:!.?()\-])/gi;

const STAFF_ACTIONS = new Set<ControlAction>([
  "create-scrim",
  "configure-scrim",
  "setup-channels",
  "sync-discord",
  "remove-team",
  "start-scrim",
  "post-room",
  "map-slots",
  "preview-results",
  "apply-results",
]);

function controlButton(
  action: ControlAction,
  label: string,
  style = ButtonStyle.Secondary,
  sessionId?: string | null,
) {
  return new ButtonBuilder()
    .setCustomId(
      sessionId ? `control:${action}:${sessionId}` : `control:${action}`,
    )
    .setLabel(label)
    .setStyle(style);
}

function modalId(action: ControlAction, sessionId?: string | null) {
  return sessionId
    ? `control-modal:${action}:${sessionId}`
    : `control-modal:${action}`;
}

function actionFromCustomId(
  customId: string,
  prefix: string,
): ParsedControlAction | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const payload = customId.slice(prefix.length);
  const [action, ...rest] = payload.split(":");
  if (!isControlAction(action)) {
    return null;
  }
  return {
    action,
    sessionId: rest.join(":") || null,
  };
}

function registrationActionFromCustomId(
  customId: string,
): ParsedRegistrationControlAction | null {
  if (!customId.startsWith("regctl:")) {
    return null;
  }
  const [, action, sessionId, registrationId] = customId.split(":");
  if (!isRegistrationControlAction(action) || !sessionId || !registrationId) {
    return null;
  }
  return { action, sessionId, registrationId };
}

function registrationRemoveConfirmationFromCustomId(
  customId: string,
): ParsedRegistrationRemoveConfirmationAction | null {
  if (customId.startsWith("regctl-remove-confirm:")) {
    return { action: "expired" };
  }
  if (customId.startsWith("regctl-remove-cancel:")) {
    return { action: "expired" };
  }
  if (!customId.startsWith("regctl:rm:")) {
    return null;
  }
  const [, , action, sessionId, registrationId] = customId.split(":");
  if (
    (action !== "confirm" && action !== "cancel") ||
    !sessionId ||
    !registrationId
  ) {
    return null;
  }
  return { action, sessionId, registrationId };
}

function waitlistControlPageFromCustomId(
  customId: string,
): ParsedWaitlistControlPageAction | null {
  if (!customId.startsWith("waitctl:p:")) {
    return null;
  }
  const [, , sessionId, rawPage] = customId.split(":");
  const page = Number(rawPage);
  if (!sessionId || !Number.isInteger(page) || page < 0) {
    return null;
  }
  return { sessionId, page };
}

function waitlistControlSelectFromCustomId(
  customId: string,
): ParsedWaitlistControlSelectAction | null {
  if (!customId.startsWith("waitctl:select:")) {
    return null;
  }
  const [, , sessionId, rawPage] = customId.split(":");
  const page = Number(rawPage);
  if (!sessionId || !Number.isInteger(page) || page < 0) {
    return null;
  }
  return { sessionId, page };
}

function banControlCustomId(
  action: BanControlAction,
  sessionIdOrToken?: string | null,
) {
  return sessionIdOrToken
    ? `banctl:${action}:${sessionIdOrToken}`
    : `banctl:${action}`;
}

function banControlModalId(action: "create" | "missing", sessionId: string) {
  return `banctl-modal:${action}:${sessionId}`;
}

function banControlActionFromCustomId(
  customId: string,
): ParsedBanControlAction | null {
  if (!customId.startsWith("banctl:")) {
    return null;
  }
  const [, action, value] = customId.split(":");
  if (!isBanControlAction(action)) {
    return null;
  }
  if (action === "confirm" || action === "cancel") {
    return { action, sessionId: null, token: value ?? null };
  }
  return { action, sessionId: value ?? null, token: null };
}

function banControlModalFromCustomId(
  customId: string,
): { action: "create" | "missing"; sessionId: string } | null {
  if (!customId.startsWith("banctl-modal:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if ((action !== "create" && action !== "missing") || !sessionId) {
    return null;
  }
  return { action, sessionId };
}

function manageCardBanActionFromCustomId(
  customId: string,
): ParsedManageCardBanAction | null {
  if (!customId.startsWith("cardban:")) {
    return null;
  }
  const [, action, sessionId, teamId] = customId.split(":");
  if ((action !== "d" && action !== "p") || !sessionId || !teamId) {
    return null;
  }
  return { action, sessionId, teamId };
}

function manageCardBanModalId(sessionId: string, teamId: string) {
  return `cardban-modal:${sessionId}:${teamId}`;
}

function manageCardBanModalFromCustomId(
  customId: string,
): Pick<ParsedManageCardBanAction, "sessionId" | "teamId"> | null {
  if (!customId.startsWith("cardban-modal:")) {
    return null;
  }
  const [, sessionId, teamId] = customId.split(":");
  return sessionId && teamId ? { sessionId, teamId } : null;
}

function captainPanelActionFromCustomId(
  customId: string,
): ParsedCaptainPanelAction | null {
  if (!customId.startsWith("captain:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (action !== "logo-help" || !sessionId) {
    return null;
  }
  return { action, sessionId };
}

function liveCenterActionFromCustomId(
  customId: string,
): ParsedLiveCenterAction | null {
  if (!customId.startsWith("livecenter:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (action !== "refresh" || !sessionId) {
    return null;
  }
  return { action, sessionId };
}

function isBanControlAction(value: string): value is BanControlAction {
  return ["create", "missing", "list", "refresh", "confirm", "cancel"].includes(
    value,
  );
}

function playStatusActionFromCustomId(
  customId: string,
): ParsedPlayStatusAction | null {
  if (!customId.startsWith("play:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (!sessionId) {
    return null;
  }
  if (action === "confirm") {
    return { action: "CONFIRM", sessionId };
  }
  if (action === "not") {
    return { action: "NOT_PLAYING", sessionId };
  }
  return null;
}

function playStatusTargetSelectCustomId(
  action: RegistrationPlayStatusAction,
  sessionId: string,
) {
  return `playpick:${action === "NOT_PLAYING" ? "n" : "c"}:${sessionId}`;
}

function playStatusTargetSelectFromCustomId(
  customId: string,
): ParsedPlayStatusTargetSelectAction | null {
  if (!customId.startsWith("playpick:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (!sessionId) {
    return null;
  }
  if (action === "c") {
    return { action: "CONFIRM", sessionId };
  }
  if (action === "n") {
    return { action: "NOT_PLAYING", sessionId };
  }
  return null;
}

function registrationSlotModalId(sessionId: string, registrationId: string) {
  return `regslot:${sessionId}:${registrationId}`;
}

function registrationSlotModalFromCustomId(
  customId: string,
): Pick<
  ParsedRegistrationControlAction,
  "sessionId" | "registrationId"
> | null {
  if (!customId.startsWith("regslot:")) {
    return null;
  }
  const [, sessionId, registrationId] = customId.split(":");
  return sessionId && registrationId ? { sessionId, registrationId } : null;
}

function isRegistrationControlAction(
  value: string,
): value is RegistrationControlAction {
  return ["a", "s", "w", "v", "r"].includes(value);
}

function isControlAction(value: string): value is ControlAction {
  return [
    "register-team",
    "join-scrim",
    "leave-scrim",
    "list-slots",
    "standings",
    "create-scrim",
    "configure-scrim",
    "setup-channels",
    "sync-discord",
    "remove-team",
    "start-scrim",
    "post-room",
    "map-slots",
    "preview-results",
    "apply-results",
  ].includes(value);
}

function limitDiscordContent(content: string) {
  if (content.length <= 1900) {
    return content;
  }
  return `${content.slice(0, 1870)}\n\nOutput truncated. Use the web dashboard for the full view.`;
}

function inputValue(interaction: ModalSubmitInteraction, customId: string) {
  return interaction.fields.getTextInputValue(customId).trim();
}

function optionalInputValue(
  interaction: ModalSubmitInteraction,
  customId: string,
) {
  try {
    return inputValue(interaction, customId);
  } catch {
    return "";
  }
}

export class ControlPanelService {
  private readonly activeSessionByGuildId = new Map<string, string>();
  private readonly pendingBanActions = new Map<
    string,
    PendingBanControlAction
  >();

  constructor(private readonly sessionService: DiscordSessionService) {}

  private async resolveInteractionOrganizationId(
    interaction: PanelInteraction,
    sessionId?: string | null,
  ) {
    if (!interaction.guild || !interaction.channelId) {
      return null;
    }

    const resolved = await this.sessionService
      .findScrimForDiscordChannel(interaction.guild.id, interaction.channelId)
      .catch(() => null);
    if (!resolved) {
      return null;
    }
    if (sessionId && resolved.session.id !== sessionId) {
      return null;
    }
    return resolved.config.organizationId;
  }

  private async withInteractionOrganization<T>(
    interaction: PanelInteraction,
    sessionId: string | null | undefined,
    fn: () => Promise<T>,
  ) {
    const organizationId = await this.resolveInteractionOrganizationId(
      interaction,
      sessionId,
    );
    return this.sessionService.withOrganization(organizationId, fn);
  }

  buildControlPanelMessage(audience: ControlPanelAudience = "staff") {
    if (audience === "teams") {
      return this.buildTeamsPanelMessage();
    }
    return this.buildStaffPanelMessage();
  }

  async postControlPanel(
    interaction: ChatInputCommandInteraction,
    audience: ControlPanelAudience,
  ) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Control panels can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction))) {
      await interaction.reply({
        content: "Only Arenzyra staff can post control panels.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const panel = await channel.send(this.buildControlPanelMessage(audience));
    await panel.pin("Pin Arenzyra control panel").catch(() => undefined);
    await interaction.editReply(`Control panel posted in <#${channel.id}>.`);
  }

  async postBanControlPanel(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Ban controls can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      interaction.guild!.id,
      interaction.channelId,
    );
    if (!resolved) {
      await interaction.editReply(
        "Use `/ban-control` inside a synced scrim Discord channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, resolved.session.id))) {
      await interaction.editReply("Only Arenzyra staff can post ban controls.");
      return;
    }

    if (
      (resolved.config.emojis?.banControlsEnabled ?? "true")
        .trim()
        .toLowerCase() === "false"
    ) {
      await interaction.editReply(
        "Discord ban controls are disabled for this scrim in the web app.",
      );
      return;
    }

    const panel = await channel.send(
      this.buildBanControlPanelMessage(
        resolved.session.id,
        resolved.session.name,
        resolved.config,
      ),
    );
    await panel.pin("Pin Arenzyra ban control panel").catch(() => undefined);
    await interaction.editReply(
      `Ban control panel posted in <#${channel.id}>.`,
    );
  }

  async showWaitlistControlPanel(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Waitlist controls can only be opened inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const resolved = await this.sessionService.findScrimForDiscordChannel(
      interaction.guild!.id,
      interaction.channelId,
    );
    if (!resolved || resolved.channelKind !== "waitlist") {
      await interaction.editReply(
        "Use this command inside the scrim waitlist channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, resolved.session.id))) {
      await interaction.editReply("Only Arenzyra staff can use this control.");
      return;
    }

    const panel = await this.sessionService.withOrganization(
      resolved.config.organizationId,
      () => this.sessionService.buildWaitlistControlPanel(resolved.session.id),
    );
    await interaction.editReply({
      ...panel.payload,
      content: panel.payload.content ?? undefined,
      allowedMentions: panel.payload.allowedMentions ?? { parse: [] },
    });
  }

  async postCaptainPanel(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Captain panels can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found for this channel. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can post this panel.");
      return;
    }

    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const panel = this.buildCaptainPanelMessage(context);
    const message = await channel.send(panel);
    await message.pin("Pin Arenzyra captain panel").catch(() => undefined);
    await interaction.editReply(`Captain panel posted in <#${channel.id}>.`);
  }

  async postLiveCenter(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Live center can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found for this channel. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can post live center.");
      return;
    }

    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const panel = await this.buildLiveCenterMessage(context, interaction.guild);
    const message = await channel.send(panel);
    await message.pin("Pin Arenzyra live center").catch(() => undefined);
    await interaction.editReply(`Live center posted in <#${channel.id}>.`);
  }

  async runDoctor(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Doctor can only inspect a Discord server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    const guild = interaction.guild!;
    const botMember = await guild.members.fetchMe().catch(() => null);
    const lines = ["Arenzyra Discord Doctor", ""];

    if (!botMember) {
      lines.push("WARNING Bot member could not be fetched.");
      await interaction.editReply(limitDiscordContent(lines.join("\n")));
      return;
    }

    lines.push(
      botMember.permissions.has(PermissionFlagsBits.ManageEvents)
        ? "OK Manage Events permission is available."
        : "WARNING Manage Events permission is missing; scheduled events may fail.",
      botMember.permissions.has(PermissionFlagsBits.ManageRoles)
        ? "OK Manage Roles permission is available."
        : "WARNING Manage Roles permission is missing; slot/waitlist/ban role sync may fail.",
      botMember.permissions.has(PermissionFlagsBits.ManageChannels)
        ? "OK Manage Channels permission is available."
        : "WARNING Manage Channels permission is missing; setup/channel repair may fail.",
    );

    if (!context) {
      lines.push(
        "",
        "WARNING No synced scrim was resolved from this channel. Use a session ID to inspect a specific scrim.",
      );
      await interaction.editReply(limitDiscordContent(lines.join("\n")));
      return;
    }

    lines.push(
      "",
      `Session: ${context.session.name}`,
      `Status: ${context.session.status}`,
      `Slots: ${context.session.counts.confirmedCount}/${context.session.slotCount}`,
      `Waitlist: ${context.session.counts.waitlistCount}`,
      "",
      "Channels:",
    );

    const channelChecks: Array<[string, string | null]> = [
      ["registration", context.config.registrationChannelId],
      ["slot list", context.config.slotListChannelId],
      ["waitlist", context.config.waitlistChannelId],
      ["screenshots", context.config.screenshotsChannelId],
      ["results", context.config.resultsChannelId],
      ["bans", context.config.bansChannelId],
      ["log", context.config.logChannelId],
      ["manager", context.config.managerChannelId],
      ["idp", context.config.idpChannelId],
    ];

    for (const [label, channelId] of channelChecks) {
      if (!channelId) {
        lines.push(`WARNING ${label}: not configured`);
        continue;
      }
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        lines.push(`WARNING ${label}: channel missing or not text-based`);
        continue;
      }
      const permissions = channel.permissionsFor(botMember);
      const ok =
        permissions?.has(PermissionFlagsBits.ViewChannel) &&
        permissions.has(PermissionFlagsBits.SendMessages) &&
        permissions.has(PermissionFlagsBits.ReadMessageHistory) &&
        permissions.has(PermissionFlagsBits.EmbedLinks) &&
        permissions.has(PermissionFlagsBits.AttachFiles);
      lines.push(`${ok ? "OK" : "WARNING"} ${label}: <#${channelId}>`);
    }

    await interaction.editReply(limitDiscordContent(lines.join("\n")));
  }

  async createScheduledEvent(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Scheduled events can only be created inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can create events.");
      return;
    }

    const startInput =
      interaction.options.getString("starts-at") ?? context.session.startsAt;
    const startsAt = this.parseEventDate(startInput);
    if (!startsAt) {
      await interaction.editReply(
        "Add `starts-at` or set the scrim start time in the web app first.",
      );
      return;
    }
    if (startsAt.getTime() <= Date.now()) {
      await interaction.editReply("Scheduled event start time must be future.");
      return;
    }

    const durationMinutes =
      interaction.options.getInteger("duration-minutes") ?? 120;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const title =
      interaction.options.getString("title")?.trim() ||
      context.session.name ||
      "Arenzyra Scrim";
    const description =
      interaction.options.getString("description")?.trim() ||
      `Arenzyra scrim event for ${context.session.name}.`;
    const location = context.config.idpChannelId
      ? `Discord IDP channel: #${context.config.idpChannelName ?? "idp"}`
      : "Arenzyra Discord scrim channels";

    const event = await interaction.guild!.scheduledEvents.create({
      name: title.slice(0, 100),
      description: description.slice(0, 1000),
      scheduledStartTime: startsAt,
      scheduledEndTime: endsAt,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: location.slice(0, 100) },
      reason: `Created by ${interaction.user.tag} from Arenzyra bot`,
    });

    await this.sessionService.sendDiscordActionLog(
      interaction.guild,
      context.config,
      {
        action: "Discord event scheduled",
        sessionId: context.session.id,
        sessionName: context.session.name,
        actorDiscordId: interaction.user.id,
        actorLabel: interaction.user.tag,
        sourceChannelId: interaction.channelId ?? null,
        status: title,
        details: [
          `Starts: <t:${Math.floor(startsAt.getTime() / 1000)}:F>`,
          `Event: https://discord.com/events/${interaction.guildId}/${event.id}`,
        ],
        color: 0x38bdf8,
      },
    );

    await interaction.editReply(
      [
        `${CHECK} Discord scheduled event created.`,
        `Event: https://discord.com/events/${interaction.guildId}/${event.id}`,
        `Starts: <t:${Math.floor(startsAt.getTime() / 1000)}:F>`,
      ].join("\n"),
    );
  }

  async showAuditTimeline(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Audit timeline can only be shown inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }
    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can view audit logs.");
      return;
    }
    if (!context.config.logChannelId) {
      await interaction.editReply("This scrim has no Discord log channel.");
      return;
    }

    const channel = await interaction.guild!.channels
      .fetch(context.config.logChannelId)
      .catch(() => null);
    if (!channel?.isTextBased()) {
      await interaction.editReply("The configured log channel is unavailable.");
      return;
    }

    const messages = await channel.messages.fetch({ limit: 12 });
    const rows = messages
      .filter((message) => !message.system)
      .map((message) => {
        const title =
          message.embeds[0]?.title ||
          message.content.trim().split("\n")[0] ||
          "Arenzyra log entry";
        return `- <t:${Math.floor(message.createdTimestamp / 1000)}:R> ${title}`;
      });
    await interaction.editReply(
      limitDiscordContent(
        [
          `Audit timeline for ${context.session.name}`,
          "",
          rows.length ? rows.join("\n") : "No recent Discord log entries.",
        ].join("\n"),
      ),
    );
  }

  async previewMessageAuthorBan(
    interaction: MessageContextMenuCommandInteraction,
  ) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Manager bans can only be started inside a server.",
        ephemeral: true,
      });
      return;
    }

    const targetMessage = interaction.targetMessage;
    if (targetMessage.author.bot) {
      await interaction.reply({
        content: "Bot messages cannot be manager-banned.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      null,
    );
    if (!context) {
      await interaction.editReply(
        "Use this action inside a synced scrim channel so the bot knows the ban scope.",
      );
      return;
    }
    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can ban managers.");
      return;
    }

    const command: DiscordTeamBanCommand = {
      target: { kind: "manager", discordUserId: targetMessage.author.id },
      scope: "SESSION",
      sessionId: context.session.id,
      days: this.parseBanDurationDays(
        context.config.emojis?.banDefaultDurationDays ?? "",
        context.config,
      ),
      reason:
        context.config.emojis?.banDefaultReason ||
        "Manual Discord manager ban",
      note: `Created from message context action: ${targetMessage.url}`,
      serverAction: null,
    };
    const preview = await this.withInteractionOrganization(
      interaction,
      context.session.id,
      () => this.sessionService.previewTeamBanFromDiscord(command),
    );
    const token = this.storePendingBanAction({
      kind: "team",
      userId: interaction.user.id,
      sessionId: context.session.id,
      command: preview.command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: preview.content,
      components: [this.buildBanConfirmationRow(token, "Ban Manager")],
      allowedMentions: { parse: [] },
    });
  }

  async handleButton(interaction: ButtonInteraction) {
    const playStatus = playStatusActionFromCustomId(interaction.customId);
    if (playStatus) {
      await this.handlePlayStatusButton(interaction, playStatus);
      return true;
    }

    const waitlistPage = waitlistControlPageFromCustomId(interaction.customId);
    if (waitlistPage) {
      await this.handleWaitlistControlPageButton(interaction, waitlistPage);
      return true;
    }

    const removeConfirmation = registrationRemoveConfirmationFromCustomId(
      interaction.customId,
    );
    if (removeConfirmation) {
      await this.handleRegistrationRemoveConfirmationButton(
        interaction,
        removeConfirmation,
      );
      return true;
    }

    const registrationControl = registrationActionFromCustomId(
      interaction.customId,
    );
    if (registrationControl) {
      await this.handleRegistrationControlButton(
        interaction,
        registrationControl,
      );
      return true;
    }

    const banControl = banControlActionFromCustomId(interaction.customId);
    if (banControl) {
      await this.handleBanControlButton(interaction, banControl);
      return true;
    }

    const manageCardBan = manageCardBanActionFromCustomId(
      interaction.customId,
    );
    if (manageCardBan) {
      await this.handleManageCardBanButton(interaction, manageCardBan);
      return true;
    }

    const captainAction = captainPanelActionFromCustomId(interaction.customId);
    if (captainAction) {
      await this.handleCaptainPanelButton(interaction, captainAction);
      return true;
    }

    const liveCenterAction = liveCenterActionFromCustomId(interaction.customId);
    if (liveCenterAction) {
      await this.handleLiveCenterButton(interaction, liveCenterAction);
      return true;
    }

    const parsed = actionFromCustomId(interaction.customId, "control:");
    if (!parsed) {
      return false;
    }

    if (
      STAFF_ACTIONS.has(parsed.action) &&
      !(await this.canUseStaffControls(interaction, parsed.sessionId))
    ) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return true;
    }

    if (parsed.sessionId && parsed.action === "list-slots") {
      await interaction.deferReply({ ephemeral: true });
      const content = await this.sessionService.listSlots(
        parsed.sessionId,
        interaction.guild,
      );
      await interaction.editReply(limitDiscordContent(content));
      return true;
    }

    if (parsed.sessionId && parsed.action === "standings") {
      await interaction.deferReply({ ephemeral: true });
      const content = await this.sessionService.standings(parsed.sessionId);
      await interaction.editReply(limitDiscordContent(content));
      return true;
    }

    await interaction.showModal(
      this.buildModal(parsed.action, parsed.sessionId),
    );
    return true;
  }

  async handleStringSelectMenu(interaction: StringSelectMenuInteraction) {
    const playStatusTarget = playStatusTargetSelectFromCustomId(
      interaction.customId,
    );
    if (playStatusTarget) {
      await this.handlePlayStatusTargetSelect(interaction, playStatusTarget);
      return true;
    }

    const parsed = waitlistControlSelectFromCustomId(interaction.customId);
    if (!parsed) {
      return false;
    }

    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return true;
    }

    const registrationId = interaction.values[0];
    if (!registrationId) {
      await interaction.reply({
        content: "Select one waitlist team first.",
        ephemeral: true,
      });
      return true;
    }

    const target = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.describeRegistrationControlTarget(
          parsed.sessionId,
          registrationId,
        ),
    );
    if (!target.found) {
      await interaction.reply({
        content: target.content,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    await interaction.reply({
      content: target.content,
      components: [
        this.buildRegistrationControlActionRow(
          parsed.sessionId,
          registrationId,
        ),
      ],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  private async handleWaitlistControlPageButton(
    interaction: ButtonInteraction,
    parsed: ParsedWaitlistControlPageAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    const panel = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.buildWaitlistControlPanel(
          parsed.sessionId,
          parsed.page,
        ),
    );
    await interaction.update({
      ...panel.payload,
      content: panel.payload.content ?? undefined,
      allowedMentions: panel.payload.allowedMentions ?? { parse: [] },
    });
  }

  private async handlePlayStatusButton(
    interaction: ButtonInteraction,
    parsed: ParsedPlayStatusAction,
  ) {
    if (!interaction.guild) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("Use this control inside the Discord server.");
      } else {
        await interaction.reply({
          content: "Use this control inside the Discord server.",
          ephemeral: true,
        });
      }
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    const targetResolution = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.resolveRegistrationPlayStatusTargets(
          parsed.sessionId,
          interaction.user.id,
          parsed.action,
        ),
    );
    if (targetResolution.kind === "blocked") {
      await interaction.editReply(
        limitDiscordContent(targetResolution.content),
      );
      this.deleteInteractionReplySoon(interaction);
      return;
    }

    if (targetResolution.kind === "multiple") {
      await interaction.editReply({
        content: limitDiscordContent(targetResolution.content),
        components: [
          this.buildPlayStatusTargetSelect(parsed, targetResolution.targets),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlayStatus(
          parsed.sessionId,
          interaction.user.id,
          interaction.user.username,
          parsed.action,
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
          { registrationId: targetResolution.target.registrationId },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
    this.deleteInteractionReplySoon(interaction);
  }

  private async handlePlayStatusTargetSelect(
    interaction: StringSelectMenuInteraction,
    parsed: ParsedPlayStatusTargetSelectAction,
  ) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Use this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    const selected = interaction.values[0];
    if (!selected) {
      await interaction.reply({
        content: "Select a team first.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();
    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlayStatus(
          parsed.sessionId,
          interaction.user.id,
          interaction.user.username,
          parsed.action,
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
          selected === "all"
            ? { applyAll: true }
            : { registrationId: selected },
        ),
    );
    await interaction.editReply({
      content: limitDiscordContent(content),
      components: [],
      allowedMentions: { parse: [] },
    });
    this.deleteInteractionReplySoon(interaction);
  }

  private buildPlayStatusTargetSelect(
    parsed: ParsedPlayStatusAction,
    targets: RegistrationPlayStatusTarget[],
  ) {
    const actionLabel =
      parsed.action === "NOT_PLAYING" ? "mark not playing" : "confirm";
    const options = targets
      .slice(0, 24)
      .map((target) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(target.optionLabel)
          .setDescription(target.optionDescription)
          .setValue(target.registrationId),
      );
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("All teams")
        .setDescription(`Apply to all ${targets.length} teams`)
        .setValue("all"),
    );

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          playStatusTargetSelectCustomId(parsed.action, parsed.sessionId),
        )
        .setPlaceholder(`Choose team to ${actionLabel}`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  private deleteInteractionReplySoon(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ) {
    setTimeout(() => {
      void interaction.deleteReply().catch(() => undefined);
    }, ACTION_CONFIRMATION_DELETE_DELAY_MS).unref?.();
  }

  private async showRegistrationRemovalConfirmation(
    interaction: ButtonInteraction,
    parsed: ParsedRegistrationControlAction,
  ) {
    const confirmId = `regctl:rm:confirm:${parsed.sessionId}:${parsed.registrationId}`;
    const cancelId = `regctl:rm:cancel:${parsed.sessionId}:${parsed.registrationId}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel("Remove Team")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: [
        "Remove this team from the scrim?",
        "This releases its slot/waitlist placement and roster links.",
        "Confirm within 30 seconds.",
      ].join("\n"),
      components: [row],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleRegistrationRemoveConfirmationButton(
    interaction: ButtonInteraction,
    parsed: ParsedRegistrationRemoveConfirmationAction,
  ) {
    if (parsed.action === "expired") {
      await interaction.reply({
        content: "This removal confirmation expired. Press Remove again.",
        ephemeral: true,
      });
      return;
    }

    if (!parsed.sessionId || !parsed.registrationId) {
      await interaction.reply({
        content: "This removal confirmation is invalid. Press Remove again.",
        ephemeral: true,
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "cancel") {
      await interaction.update({
        content: "Team removal cancelled.",
        components: [],
      });
      return;
    }

    await interaction.update({
      content: "Removing team...",
      components: [],
    });
    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlacement(
          parsed.sessionId!,
          parsed.registrationId!,
          { action: "REMOVE" },
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction) {
    const registrationSlotModal = registrationSlotModalFromCustomId(
      interaction.customId,
    );
    if (registrationSlotModal) {
      await this.handleRegistrationSlotModal(
        interaction,
        registrationSlotModal,
      );
      return true;
    }

    const banControlModal = banControlModalFromCustomId(interaction.customId);
    if (banControlModal) {
      await this.handleBanControlModal(interaction, banControlModal);
      return true;
    }

    const manageCardBanModal = manageCardBanModalFromCustomId(
      interaction.customId,
    );
    if (manageCardBanModal) {
      await this.handleManageCardBanModal(interaction, manageCardBanModal);
      return true;
    }

    const parsed = actionFromCustomId(interaction.customId, "control-modal:");
    if (!parsed) {
      return false;
    }

    if (
      STAFF_ACTIONS.has(parsed.action) &&
      !(await this.canUseStaffControls(interaction, parsed.sessionId))
    ) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return true;
    }

    await this.executeModalAction(interaction, parsed);
    return true;
  }

  private async handleCaptainPanelButton(
    interaction: ButtonInteraction,
    parsed: ParsedCaptainPanelAction,
  ) {
    if (parsed.action !== "logo-help") {
      return;
    }

    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    const logoChannelId = context?.config.emojis?.organizationLogoChannelId
      ? context.config.emojis.organizationLogoChannelId
      : context?.config.screenshotsChannelId;
    await interaction.reply({
      content: [
        "Logo upload",
        logoChannelId
          ? `Send \`%logo Team Name\` with a PNG, JPG, or WEBP image in <#${logoChannelId}>.`
          : "Send `%logo Team Name` with a PNG, JPG, or WEBP image in the synced logo channel.",
        "The saved logo is reused for registrations, slots, and result widgets.",
      ].join("\n"),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleLiveCenterButton(
    interaction: ButtonInteraction,
    parsed: ParsedLiveCenterAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can refresh live center.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This live center is no longer linked to a scrim.",
        ephemeral: true,
      });
      return;
    }
    await interaction.update(
      await this.buildLiveCenterMessage(context, interaction.guild),
    );
  }

  private async handleBanControlButton(
    interaction: ButtonInteraction,
    parsed: ParsedBanControlAction,
  ) {
    if (parsed.action === "confirm" || parsed.action === "cancel") {
      await this.handlePendingBanControlButton(interaction, parsed);
      return;
    }

    if (!parsed.sessionId) {
      await interaction.reply({
        content: "This ban control is missing its session context.",
        ephemeral: true,
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "Use this ban control inside the synced scrim channel.",
        ephemeral: true,
      });
      return;
    }

    if (
      (resolved.config.emojis?.banControlsEnabled ?? "true")
        .trim()
        .toLowerCase() === "false"
    ) {
      await interaction.reply({
        content: "Discord ban controls are disabled for this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "create") {
      await interaction.showModal(
        this.buildBanTeamModal(parsed.sessionId, resolved.config),
      );
      return;
    }

    if (parsed.action === "missing") {
      await interaction.showModal(
        this.buildNoShowBanModal(parsed.sessionId, resolved.config),
      );
      return;
    }

    if (parsed.action === "list") {
      await interaction.deferReply({ ephemeral: true });
      const content = await this.withInteractionOrganization(
        interaction,
        parsed.sessionId,
        () => this.sessionService.listTeamBansForDiscord(parsed.sessionId),
      );
      await interaction.editReply({
        content: limitDiscordContent(content),
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.update(
      this.buildBanControlPanelMessage(
        resolved.session.id,
        resolved.session.name,
        resolved.config,
      ),
    );
  }

  private async handleManageCardBanButton(
    interaction: ButtonInteraction,
    parsed: ParsedManageCardBanAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "This ban button is no longer linked to this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (!this.discordBanControlsEnabled(resolved.config)) {
      await interaction.reply({
        content: "Discord ban controls are disabled for this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "d") {
      await interaction.showModal(
        this.buildManageCardBanDurationModal(
          parsed.sessionId,
          parsed.teamId,
          resolved.config,
        ),
      );
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await this.previewManageCardBan(interaction, parsed, resolved.config, {
      days: null,
      reason:
        resolved.config.emojis?.banDefaultReason ||
        "Permanent Discord manager ban",
      confirmLabel: "Permanent Ban",
    });
  }

  private async handlePendingBanControlButton(
    interaction: ButtonInteraction,
    parsed: ParsedBanControlAction,
  ) {
    const token = parsed.token;
    const pending = token ? this.pendingBanActions.get(token) : null;
    if (!token || !pending) {
      await interaction.reply({
        content: "This ban confirmation expired. Open the ban control again.",
        ephemeral: true,
      });
      return;
    }

    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "Only the staff member who opened this confirmation can use it.",
        ephemeral: true,
      });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingBanActions.delete(token);
      await interaction.update({
        content: "This ban confirmation expired. Open the ban control again.",
        components: [],
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction, pending.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "cancel") {
      this.pendingBanActions.delete(token);
      await interaction.update({
        content: "Ban action cancelled.",
        components: [],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    this.pendingBanActions.delete(token);
    await interaction.update({
      content: "Applying ban action...",
      components: [],
    });

    const content = await this.withInteractionOrganization(
      interaction,
      pending.sessionId,
      () =>
        pending.kind === "team"
          ? this.sessionService.createTeamBanFromDiscord(
              pending.command,
              interaction.guild,
              {
                actorDiscordId: interaction.user.id,
                actorLabel: interaction.user.tag,
                sourceChannelId: interaction.channelId ?? null,
              },
            )
          : this.sessionService.createNoShowTeamBansFromDiscord(
              pending.command,
              interaction.guild,
              {
                actorDiscordId: interaction.user.id,
                actorLabel: interaction.user.tag,
                sourceChannelId: interaction.channelId ?? null,
              },
            ),
    );
    await interaction.editReply({
      content: limitDiscordContent(content),
      allowedMentions: { parse: [] },
    });
  }

  private async handleManageCardBanModal(
    interaction: ModalSubmitInteraction,
    parsed: Pick<ParsedManageCardBanAction, "sessionId" | "teamId">,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "This ban button is no longer linked to this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (!this.discordBanControlsEnabled(resolved.config)) {
      await interaction.reply({
        content: "Discord ban controls are disabled for this scrim.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const days = this.parseBanDurationDays(
      optionalInputValue(interaction, "days"),
      resolved.config,
    );
    await this.previewManageCardBan(interaction, parsed, resolved.config, {
      days,
      reason:
        optionalInputValue(interaction, "reason") ||
        resolved.config.emojis?.banDefaultReason ||
        "Manual Discord manager ban",
      confirmLabel: days ? "Apply Ban" : "Permanent Ban",
    });
  }

  private async handleBanControlModal(
    interaction: ModalSubmitInteraction,
    parsed: { action: "create" | "missing"; sessionId: string },
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "Use this ban control inside the synced scrim channel.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    if (parsed.action === "create") {
      await this.handleBanTeamModal(
        interaction,
        parsed.sessionId,
        resolved.config,
      );
      return;
    }
    await this.handleNoShowBanModal(
      interaction,
      parsed.sessionId,
      resolved.config,
    );
  }

  private async handleBanTeamModal(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const targetText = inputValue(interaction, "team-target");
    const parsedScope = this.parseBanControlScope(
      optionalInputValue(interaction, "scope"),
      config,
    );
    const matchInput = optionalInputValue(interaction, "matches");
    const parsedMatches = this.parseBanMatchNumbers(matchInput);
    const command: DiscordTeamBanCommand = {
      target: this.parseBanControlTarget(targetText),
      scope: parsedScope.scope,
      sessionId,
      matchNumbers: parsedMatches.matchNumbers,
      allMatches: parsedScope.allMatches || parsedMatches.allMatches,
      days: this.parseBanDurationDays(
        optionalInputValue(interaction, "days"),
        config,
      ),
      reason:
        optionalInputValue(interaction, "reason") ||
        config.emojis?.banDefaultReason ||
        "Manual Discord ban",
      note: "Created from Discord ban control",
      serverAction: parsedScope.serverAction,
    };

    const preview = await this.withInteractionOrganization(
      interaction,
      sessionId,
      () => this.sessionService.previewTeamBanFromDiscord(command),
    );
    const token = this.storePendingBanAction({
      kind: "team",
      userId: interaction.user.id,
      sessionId,
      command: preview.command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: preview.content,
      components: [this.buildBanConfirmationRow(token, "Apply Ban")],
      allowedMentions: { parse: [] },
    });
  }

  private buildManageCardBanDurationModal(
    sessionId: string,
    teamId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const defaultDays = (config.emojis?.banDefaultDurationDays || "").trim();
    const safeDefaultDays = /^(permanent|perm|none|0)$/i.test(defaultDays)
      ? "3"
      : defaultDays || "3";
    const modal = new ModalBuilder()
      .setCustomId(manageCardBanModalId(sessionId, teamId))
      .setTitle("Ban Manager");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("days")
          .setLabel("Ban days")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Example: 3")
          .setRequired(true)
          .setMaxLength(20)
          .setValue(safeDefaultDays),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(config.emojis?.banDefaultReason || "Manual Discord ban")
          .setRequired(false)
          .setMaxLength(300),
      ),
    );
    return modal;
  }

  private async previewManageCardBan(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    target: Pick<ParsedManageCardBanAction, "sessionId" | "teamId">,
    config: SessionDiscordConfigResponse,
    options: { days: number | null; reason: string; confirmLabel: string },
  ) {
    const command: DiscordTeamBanCommand = {
      target: { kind: "team-id", teamId: target.teamId },
      scope: "SESSION",
      sessionId: target.sessionId,
      days: options.days,
      reason: options.reason,
      note: "Created from Discord manage card",
      serverAction: null,
    };
    const preview = await this.withInteractionOrganization(
      interaction,
      target.sessionId,
      () => this.sessionService.previewTeamBanFromDiscord(command),
    );
    const token = this.storePendingBanAction({
      kind: "team",
      userId: interaction.user.id,
      sessionId: target.sessionId,
      command: preview.command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: preview.content,
      components: [this.buildBanConfirmationRow(token, options.confirmLabel)],
      allowedMentions: { parse: [] },
    });
  }

  private async handleNoShowBanModal(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const command: DiscordNoShowTeamBanCommand = {
      sessionId,
      matchNumber: this.parseOptionalMatchNumber(
        optionalInputValue(interaction, "match"),
      ),
      scope: this.parseNoShowBanScope(optionalInputValue(interaction, "scope")),
      days: this.parseBanDurationDays(
        optionalInputValue(interaction, "days"),
        config,
      ),
      reason:
        optionalInputValue(interaction, "reason") ||
        config.emojis?.banDefaultReason ||
        "Manual Discord no-show ban",
      note: "Created from Discord ban control",
    };

    const preview = await this.withInteractionOrganization(
      interaction,
      sessionId,
      () => this.sessionService.previewNoShowTeamBansFromDiscord(command),
    );
    if (preview.response.creatableCount === 0) {
      await interaction.editReply({
        content: preview.content,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const token = this.storePendingBanAction({
      kind: "no-show",
      userId: interaction.user.id,
      sessionId,
      command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: limitDiscordContent(preview.content),
      components: [this.buildBanConfirmationRow(token, "Ban No-Shows")],
      allowedMentions: { parse: [] },
    });
  }

  private async resolveBanControlSession(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    sessionId: string,
  ) {
    if (!interaction.guild || !interaction.channelId) {
      return null;
    }
    const resolved = await this.sessionService
      .findScrimForDiscordChannel(interaction.guild.id, interaction.channelId)
      .catch(() => null);
    if (!resolved || resolved.session.id !== sessionId) {
      return null;
    }
    return resolved;
  }

  private buildBanTeamModal(
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    return this.banModal("Ban Manager", "create", sessionId, [
      {
        customId: "team-target",
        label: "Team name, tag, or @manager",
        placeholder: "Example: DXB or @manager",
        maxLength: 120,
      },
      {
        customId: "scope",
        label: "Scope",
        placeholder: "session, team, match, all-matches, server",
        required: false,
        maxLength: 40,
        value: config.emojis?.banDefaultScope || "SESSION",
      },
      {
        customId: "matches",
        label: "Match numbers",
        placeholder: "Example: 1,2 or all",
        required: false,
        maxLength: 80,
      },
      {
        customId: "days",
        label: "Ban days",
        placeholder: "Example: 3 or permanent",
        required: false,
        maxLength: 20,
        value: config.emojis?.banDefaultDurationDays || "3",
      },
      {
        customId: "reason",
        label: "Reason",
        placeholder: config.emojis?.banDefaultReason || "Manual Discord ban",
        required: false,
        maxLength: 300,
      },
    ]);
  }

  private buildNoShowBanModal(
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    return this.banModal("Ban No-Shows", "missing", sessionId, [
      {
        customId: "match",
        label: "Match number",
        placeholder: "Leave blank for latest eligible match",
        required: false,
        maxLength: 20,
      },
      {
        customId: "scope",
        label: "Scope",
        placeholder: "session, team, or match",
        required: false,
        maxLength: 40,
        value: config.emojis?.banDefaultScope || "SESSION",
      },
      {
        customId: "days",
        label: "Ban days",
        placeholder: "Example: 3 or permanent",
        required: false,
        maxLength: 20,
        value: config.emojis?.banDefaultDurationDays || "3",
      },
      {
        customId: "reason",
        label: "Reason",
        placeholder: config.emojis?.banDefaultReason || "Manual no-show ban",
        required: false,
        maxLength: 300,
      },
    ]);
  }

  private banModal(
    title: string,
    action: "create" | "missing",
    sessionId: string,
    inputs: TextInputConfig[],
  ) {
    const modal = new ModalBuilder()
      .setCustomId(banControlModalId(action, sessionId))
      .setTitle(title);
    modal.addComponents(
      ...inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          (() => {
            const builder = new TextInputBuilder()
              .setCustomId(input.customId)
              .setLabel(input.label)
              .setStyle(input.style ?? TextInputStyle.Short)
              .setPlaceholder(input.placeholder ?? "")
              .setRequired(input.required ?? true)
              .setMaxLength(input.maxLength ?? 200);
            if (input.value) {
              builder.setValue(input.value);
            }
            return builder;
          })(),
        ),
      ),
    );
    return modal;
  }

  private buildBanConfirmationRow(token: string, label: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(banControlCustomId("confirm", token))
        .setLabel(label)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("cancel", token))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private storePendingBanAction(action: PendingBanControlAction) {
    const token = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.pendingBanActions.set(token, action);
    setTimeout(() => {
      this.pendingBanActions.delete(token);
    }, BAN_CONTROL_CONFIRMATION_TTL_MS).unref?.();
    return token;
  }

  private discordBanControlsEnabled(config: SessionDiscordConfigResponse) {
    return (
      (config.emojis?.banControlsEnabled ?? "true").trim().toLowerCase() !==
      "false"
    );
  }

  private parseBanControlTarget(value: string): DiscordTeamBanTarget {
    const mention = /<@!?(\d{15,25})>/.exec(value);
    if (mention?.[1]) {
      return { kind: "manager", discordUserId: mention[1] };
    }
    const query = value.trim().replace(/^"|"$/g, "").trim();
    if (!query) {
      throw new Error("Add a team name, tag, or manager mention.");
    }
    return { kind: "team", query };
  }

  private parseBanControlScope(
    value: string,
    config: SessionDiscordConfigResponse,
  ): {
    scope: TeamBanScope;
    allMatches: boolean;
    serverAction: DiscordTeamBanServerAction | null;
  } {
    const normalized = (value || config.emojis?.banDefaultScope || "SESSION")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (["session", "scrim", "current"].includes(normalized)) {
      return { scope: "SESSION", allMatches: false, serverAction: null };
    }
    if (
      [
        "team",
        "teams",
        "all-sessions",
        "all-session",
        "global",
        "all",
      ].includes(normalized)
    ) {
      return { scope: "TEAM", allMatches: false, serverAction: null };
    }
    if (["match", "matches"].includes(normalized)) {
      return { scope: "MATCH", allMatches: false, serverAction: null };
    }
    if (["all-matches", "allmatches"].includes(normalized)) {
      return { scope: "MATCH", allMatches: true, serverAction: null };
    }
    if (["server", "guild", "discord-server"].includes(normalized)) {
      return {
        scope: "TEAM",
        allMatches: false,
        serverAction: this.parseConfiguredBanServerAction(
          config.emojis?.banServerAction,
        ),
      };
    }
    throw new Error(
      "Scope must be session, team, match, all-matches, or server.",
    );
  }

  private parseNoShowBanScope(value: string): TeamBanScope {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (!normalized || ["session", "scrim", "current"].includes(normalized)) {
      return "SESSION";
    }
    if (
      ["team", "teams", "all-sessions", "global", "all"].includes(normalized)
    ) {
      return "TEAM";
    }
    if (["match", "matches"].includes(normalized)) {
      return "MATCH";
    }
    throw new Error("No-show scope must be session, team, or match.");
  }

  private parseConfiguredBanServerAction(
    value: string | null | undefined,
  ): DiscordTeamBanServerAction {
    const normalized = (value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (["discord-ban", "server-ban", "ban"].includes(normalized)) {
      return "DISCORD_BAN";
    }
    if (["role", "banned-role", "ban-role", ""].includes(normalized)) {
      return "ROLE";
    }
    return "NONE";
  }

  private parseBanDurationDays(
    value: string,
    config: SessionDiscordConfigResponse,
  ): number | null {
    const raw = (value || config.emojis?.banDefaultDurationDays || "").trim();
    if (!raw || /^(permanent|perm|none|0)$/i.test(raw)) {
      return null;
    }
    const match = /^(\d{1,3})(?:d|day|days)?$/i.exec(raw);
    if (!match) {
      throw new Error("Ban days must be a number from 1 to 365 or permanent.");
    }
    const days = Number.parseInt(match[1], 10);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error("Ban days must be between 1 and 365.");
    }
    return days;
  }

  private parseBanMatchNumbers(value: string): {
    matchNumbers: number[];
    allMatches: boolean;
  } {
    const trimmed = value.trim();
    if (!trimmed) {
      return { matchNumbers: [], allMatches: false };
    }
    if (
      ["all", "all-matches", "allmatches", "*"].includes(trimmed.toLowerCase())
    ) {
      return { matchNumbers: [], allMatches: true };
    }
    const matchNumbers = this.parseMatchNumberList(trimmed);
    if (!matchNumbers.length) {
      throw new Error("Match numbers must look like 1,2, match 1, M1, or all.");
    }
    return { matchNumbers, allMatches: false };
  }

  private parseOptionalMatchNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = this.parseMatchNumberList(trimmed)[0] ?? null;
    if (!parsed || parsed < 1 || parsed > 100) {
      throw new Error(
        "Match number must be between 1 and 100, for example 1, match 1, or M1.",
      );
    }
    return parsed;
  }

  private parseMatchNumberList(value: string): number[] {
    const explicitMatches = Array.from(
      value.matchAll(MATCH_NUMBER_TEXT_PATTERN),
    ).map((match) => Number.parseInt(match[1] ?? "", 10));
    const fallbackMatches = value
      .split(/[,\s]+/)
      .map((entry) => Number.parseInt(entry.replace(/^#/, ""), 10));
    return [
      ...new Set(
        [...explicitMatches, ...fallbackMatches].filter(
          (entry) => Number.isInteger(entry) && entry > 0 && entry <= 100,
        ),
      ),
    ];
  }

  private async handleRegistrationControlButton(
    interaction: ButtonInteraction,
    parsed: ParsedRegistrationControlAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "s") {
      await interaction.showModal(this.buildRegistrationSlotModal(parsed));
      return;
    }

    const action =
      parsed.action === "a"
        ? "APPROVE"
        : parsed.action === "w"
          ? "WAITLIST"
          : parsed.action === "v"
            ? "VIP"
            : "REMOVE";

    if (action === "REMOVE") {
      await this.showRegistrationRemovalConfirmation(interaction, parsed);
      return;
    } else {
      await interaction.deferReply({ ephemeral: true });
    }

    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlacement(
          parsed.sessionId,
          parsed.registrationId,
          { action },
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
  }

  private async handleRegistrationSlotModal(
    interaction: ModalSubmitInteraction,
    parsed: Pick<
      ParsedRegistrationControlAction,
      "sessionId" | "registrationId"
    >,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const slotNumber = this.parseIntegerInput(
      inputValue(interaction, "slot-number"),
      "Slot number",
      { min: 1, max: 100 },
    );
    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlacement(
          parsed.sessionId,
          parsed.registrationId,
          { action: "SLOT", slotNumber },
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
  }

  private buildCaptainPanelMessage(context: ResolvedSessionContext) {
    const sessionId = context.session.id;
    const embed = new EmbedBuilder()
      .setColor(0x06b6d4)
      .setTitle("Arenzyra Captain Panel")
      .setDescription(
        "Manager self-service controls for slot confirmation, logo upload, slots, and standings.",
      )
      .addFields(
        { name: "Session", value: context.session.name, inline: true },
        { name: "Status", value: context.session.status, inline: true },
        {
          name: "Slots",
          value: `${context.session.counts.confirmedCount}/${context.session.slotCount}`,
          inline: true,
        },
      )
      .setFooter({ text: "Arenzyra Captain Controls" })
      .setTimestamp(new Date());

    const playRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`play:confirm:${sessionId}`)
        .setLabel("Confirm Slot")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`play:not:${sessionId}`)
        .setLabel("Not Playing")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`captain:logo-help:${sessionId}`)
        .setLabel("Logo Help")
        .setStyle(ButtonStyle.Secondary),
    );
    const infoRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots", ButtonStyle.Secondary, sessionId),
      controlButton("standings", "Standings", ButtonStyle.Secondary, sessionId),
    );

    return {
      embeds: [embed],
      components: [playRow, infoRow],
      allowedMentions: { parse: [] },
    };
  }

  private async buildLiveCenterMessage(
    context: ResolvedSessionContext,
    guild: ButtonInteraction["guild"],
  ) {
    const matches = await this.sessionService
      .listSessionMatchesForDiscord(context.session.id)
      .catch(() => []);
    const latestMatch = [...matches].sort(
      (left, right) => (right.matchNumber ?? 0) - (left.matchNumber ?? 0),
    )[0];
    const startsAt = context.session.startsAt
      ? `<t:${Math.floor(Date.parse(context.session.startsAt) / 1000)}:F>`
      : "Not set";

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Arenzyra Live Match Center")
      .setDescription(context.session.name)
      .addFields(
        {
          name: "Session",
          value: [
            `Status: ${context.session.status}`,
            `Start: ${startsAt}`,
            `Slots: ${context.session.counts.confirmedCount}/${context.session.slotCount}`,
            `Waitlist: ${context.session.counts.waitlistCount}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Matches",
          value: latestMatch
            ? [
                `Created: ${matches.length}`,
                `Latest: #${latestMatch.matchNumber ?? "?"}`,
                `ID: ${latestMatch.id}`,
              ].join("\n")
            : "No match has been created yet.",
          inline: true,
        },
        {
          name: "Channels",
          value: [
            context.config.slotListChannelId
              ? `Slots: <#${context.config.slotListChannelId}>`
              : "Slots: not configured",
            context.config.resultsChannelId
              ? `Results: <#${context.config.resultsChannelId}>`
              : "Results: not configured",
            context.config.logChannelId
              ? `Log: <#${context.config.logChannelId}>`
              : "Log: not configured",
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({
        text: guild ? `Server: ${guild.name}` : "Arenzyra Production Control",
      })
      .setTimestamp(new Date());

    const sessionId = context.session.id;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots", ButtonStyle.Secondary, sessionId),
      controlButton("standings", "Standings", ButtonStyle.Secondary, sessionId),
      controlButton("sync-discord", "Sync", ButtonStyle.Secondary, sessionId),
      controlButton(
        "start-scrim",
        "Start Match",
        ButtonStyle.Success,
        sessionId,
      ),
      new ButtonBuilder()
        .setCustomId(`livecenter:refresh:${sessionId}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary),
    );
    const banRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(banControlCustomId("missing", sessionId))
        .setLabel("No-Show Assistant")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("list", sessionId))
        .setLabel("Ban Intelligence")
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      embeds: [embed],
      components: [row, banRow],
      allowedMentions: { parse: [] },
    };
  }

  private buildTeamsPanelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Arenzyra Scrim Registration")
      .setDescription(
        "Use %register in the registration channel. This panel is only for scrim status actions.",
      )
      .addFields(
        {
          name: "Team leaders",
          value:
            "Send %register, team name, tag, and at least one manager mention in the registration channel.",
        },
        {
          name: "Results",
          value:
            "Organizers review and apply match results from the staff control panel.",
        },
      )
      .setFooter({ text: "Arenzyra PUBG Production Control" })
      .setTimestamp(new Date());

    const teamRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("join-scrim", "Join Scrim", ButtonStyle.Success),
      controlButton("leave-scrim", "Leave Scrim", ButtonStyle.Danger),
    );
    const infoRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots"),
      controlButton("standings", "Standings"),
    );

    return {
      embeds: [embed],
      components: [teamRow, infoRow],
      allowedMentions: { parse: [] },
    };
  }

  private buildStaffPanelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x16a34a)
      .setTitle("Arenzyra Tournament Control")
      .setDescription(
        "Organizer controls for scrim creation, slots, match starts, room posts, standings, and screenshot result workflows.",
      )
      .addFields(
        {
          name: "Scrim flow",
          value:
            "Create scrim, publish room info, start a match, then monitor slots and standings.",
        },
        {
          name: "Result flow",
          value:
            "Preview screenshot OCR first. Apply only after every row resolves correctly.",
        },
      )
      .setFooter({ text: "Arenzyra PUBG Production Control" })
      .setTimestamp(new Date());

    const scrimRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("create-scrim", "Create Scrim", ButtonStyle.Primary),
      controlButton("configure-scrim", "Configure"),
      controlButton("setup-channels", "Setup Channels"),
      controlButton("sync-discord", "Sync Discord"),
    );
    const opsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("start-scrim", "Start Match", ButtonStyle.Success),
      controlButton("post-room", "Post Room Info"),
      controlButton("remove-team", "Remove Team", ButtonStyle.Danger),
    );
    const monitorRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots"),
      controlButton("standings", "Standings"),
    );
    const resultsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("map-slots", "Map Slots"),
      controlButton("preview-results", "Preview Results"),
      controlButton("apply-results", "Apply Results", ButtonStyle.Danger),
    );

    return {
      embeds: [embed],
      components: [scrimRow, opsRow, monitorRow, resultsRow],
      allowedMentions: { parse: [] },
    };
  }

  private buildBanControlPanelMessage(
    sessionId: string,
    sessionName: string | null | undefined,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const defaultScope = (config?.emojis?.banDefaultScope ?? "SESSION").trim();
    const defaultDays = (config?.emojis?.banDefaultDurationDays ?? "3").trim();
    const serverAction = (config?.emojis?.banServerAction ?? "ROLE").trim();
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Arenzyra Ban Control")
      .setDescription(
        "Staff controls for manager bans, no-show previews, active ban review, and server-level actions.",
      )
      .addFields(
        {
          name: "Session",
          value: sessionName?.trim() || sessionId,
          inline: true,
        },
        {
          name: "Defaults",
          value: `Scope: ${defaultScope || "SESSION"}\nDays: ${
            defaultDays || "permanent"
          }\nServer action: ${serverAction || "ROLE"}`,
          inline: true,
        },
      )
      .setFooter({ text: "Confirm destructive actions before they run" })
      .setTimestamp(new Date());

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(banControlCustomId("create", sessionId))
        .setLabel("Ban Manager")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("missing", sessionId))
        .setLabel("No-Show Assistant")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("list", sessionId))
        .setLabel("Active Bans")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("refresh", sessionId))
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [] },
    };
  }

  private buildRegistrationControlActionRow(
    sessionId: string,
    registrationId: string,
  ) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`regctl:a:${sessionId}:${registrationId}`)
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`regctl:s:${sessionId}:${registrationId}`)
        .setLabel("Set Slot")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`regctl:w:${sessionId}:${registrationId}`)
        .setLabel("Waitlist")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`regctl:v:${sessionId}:${registrationId}`)
        .setLabel("VIP")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`regctl:r:${sessionId}:${registrationId}`)
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger),
    );
  }

  private buildRegistrationSlotModal(parsed: ParsedRegistrationControlAction) {
    const modal = new ModalBuilder()
      .setCustomId(
        registrationSlotModalId(parsed.sessionId, parsed.registrationId),
      )
      .setTitle("Set Team Slot");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("slot-number")
          .setLabel("Slot number")
          .setPlaceholder("3")
          .setRequired(true)
          .setMaxLength(3)
          .setStyle(TextInputStyle.Short),
      ),
    );
    return modal;
  }

  private buildModal(action: ControlAction, sessionId?: string | null) {
    switch (action) {
      case "register-team":
        return this.modal(
          "Register Team",
          action,
          [
            ...(sessionId
              ? []
              : [
                  {
                    customId: "session-id",
                    label: "Session ID",
                    placeholder: "Leave blank to use the active scrim",
                    required: false,
                    maxLength: 80,
                  },
                ]),
            {
              customId: "tag",
              label: "Team tag",
              placeholder: "Example: ARZ",
              maxLength: 24,
            },
            {
              customId: "team-name",
              label: "Team name",
              placeholder: "Example: Arenzyra Esports",
              maxLength: 80,
            },
            {
              customId: "manager-mentions",
              label: "Manager/player mentions",
              placeholder: "@manager @player",
              required: false,
              maxLength: 300,
            },
            {
              customId: "team-logo",
              label: "Team logo URL",
              placeholder: "https://example.com/logo.png",
              required: false,
              maxLength: 1000,
            },
          ],
          sessionId,
        );
      case "join-scrim":
        return this.modal(
          "Join Scrim",
          action,
          [...(sessionId ? [] : [this.sessionIdInput()]), this.teamTagInput()],
          sessionId,
        );
      case "leave-scrim":
        return this.modal(
          "Leave Scrim",
          action,
          [...(sessionId ? [] : [this.sessionIdInput()]), this.teamTagInput()],
          sessionId,
        );
      case "list-slots":
        return this.modal(
          "List Slots",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "standings":
        return this.modal(
          "Standings",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "create-scrim":
        return this.modal(
          "Create Scrim",
          action,
          [
            {
              customId: "name",
              label: "Scrim name",
              placeholder: "Example: Arenzyra Practice Scrim",
              maxLength: 100,
            },
            {
              customId: "slots",
              label: "Slots",
              placeholder: "25",
              required: false,
              maxLength: 3,
            },
          ],
          sessionId,
        );
      case "configure-scrim":
        return this.modal(
          "Configure Scrim",
          action,
          [
            this.sessionIdInput(),
            {
              customId: "start-slot",
              label: "Start slot",
              placeholder: "3",
              maxLength: 3,
            },
            {
              customId: "normal-slots",
              label: "Normal slots",
              placeholder: "23",
              maxLength: 3,
            },
            {
              customId: "vip-slots",
              label: "VIP slots",
              placeholder: "0",
              required: false,
              maxLength: 3,
            },
            {
              customId: "manager-limits",
              label: "Managers / teams per manager",
              placeholder: "2/1",
              required: false,
              maxLength: 12,
            },
          ],
          sessionId,
        );
      case "setup-channels":
        return this.modal(
          "Setup Channels",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "sync-discord":
        return this.modal(
          "Sync Discord",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "remove-team":
        return this.modal(
          "Remove Team",
          action,
          [
            this.sessionIdInput(),
            this.teamTagInput(),
            {
              customId: "confirm-remove",
              label: "Type REMOVE to confirm",
              placeholder: "REMOVE",
              maxLength: 20,
            },
          ],
          sessionId,
        );
      case "start-scrim":
        return this.modal(
          "Start Match",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "post-room":
        return this.modal(
          "Post Room Info",
          action,
          [
            {
              customId: "session-id",
              label: "Session or match ID",
              required: false,
              maxLength: 80,
            },
            {
              customId: "room-id",
              label: "Room ID",
              maxLength: 80,
            },
            {
              customId: "password",
              label: "Password",
              maxLength: 80,
            },
            {
              customId: "map",
              label: "Map",
              required: false,
              placeholder: "Example: Erangel",
              maxLength: 50,
            },
            {
              customId: "starts-at",
              label: "Start time",
              required: false,
              placeholder: "Example: 21:00",
              maxLength: 50,
            },
          ],
          sessionId,
        );
      case "map-slots":
      case "preview-results":
      case "apply-results":
        return this.modal(
          action === "map-slots"
            ? "Map Slots"
            : action === "preview-results"
              ? "Preview Results"
              : "Apply Results",
          action,
          [
            {
              customId: "match-id",
              label: "Match ID",
              maxLength: 80,
            },
            {
              customId: "image-url",
              label: "Public screenshot URL",
              style: TextInputStyle.Paragraph,
              maxLength: 1000,
            },
          ],
          sessionId,
        );
    }
  }

  private modal(
    title: string,
    action: ControlAction,
    inputs: TextInputConfig[],
    sessionId?: string | null,
  ) {
    const modal = new ModalBuilder()
      .setCustomId(modalId(action, sessionId))
      .setTitle(title);
    modal.addComponents(
      ...inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          (() => {
            const builder = new TextInputBuilder()
              .setCustomId(input.customId)
              .setLabel(input.label)
              .setStyle(input.style ?? TextInputStyle.Short)
              .setPlaceholder(input.placeholder ?? "")
              .setRequired(input.required ?? true)
              .setMaxLength(input.maxLength ?? 200);
            if (input.value) {
              builder.setValue(input.value);
            }
            return builder;
          })(),
        ),
      ),
    );
    return modal;
  }

  private sessionIdInput(): TextInputConfig {
    return {
      customId: "session-id",
      label: "Session ID",
      maxLength: 80,
    };
  }

  private teamTagInput(): TextInputConfig {
    return {
      customId: "tag",
      label: "Team tag",
      placeholder: "Example: ARZ",
      maxLength: 24,
    };
  }

  private async executeModalAction(
    interaction: ModalSubmitInteraction,
    parsed: ParsedControlAction,
  ) {
    const { action, sessionId: boundSessionId } = parsed;
    if (action === "post-room") {
      await this.postRoomInfo(interaction, boundSessionId);
      return;
    }

    await interaction.deferReply();

    switch (action) {
      case "register-team": {
        const sessionId = await this.resolveSessionId(
          interaction,
          boundSessionId ?? optionalInputValue(interaction, "session-id"),
        );
        if (!sessionId) {
          await interaction.editReply(
            "Session ID is required. Staff can create a scrim first or you can paste the session ID in this form.",
          );
          return;
        }

        const members = await this.resolveMentionedMembers(
          interaction,
          optionalInputValue(interaction, "manager-mentions"),
        );
        const logoUrl = this.parseOptionalUrl(
          optionalInputValue(interaction, "team-logo"),
          "Team logo URL",
        );
        const leader = members[0] ?? {
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          displayName: interaction.user.globalName ?? null,
        };
        const content = await this.sessionService.registerTeamAndJoinScrim(
          leader.discordUserId,
          leader.discordUsername ?? leader.discordUserId,
          leader.displayName ?? null,
          inputValue(interaction, "tag"),
          inputValue(interaction, "team-name"),
          members,
          interaction.guild,
          sessionId,
          logoUrl,
          null,
          {
            requesterDiscordId: interaction.user.id,
            audit: {
              actorDiscordId: interaction.user.id,
              actorLabel: interaction.user.tag,
              sourceChannelId: interaction.channelId ?? null,
            },
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "join-scrim": {
        const content = await this.sessionService.joinScrim(
          interaction.user.id,
          boundSessionId ?? inputValue(interaction, "session-id"),
          inputValue(interaction, "tag"),
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "leave-scrim": {
        const content = await this.sessionService.leaveScrim(
          interaction.user.id,
          boundSessionId ?? inputValue(interaction, "session-id"),
          inputValue(interaction, "tag"),
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "list-slots": {
        const content = await this.sessionService.listSlots(
          boundSessionId ?? inputValue(interaction, "session-id"),
          interaction.guild,
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "standings": {
        const content = await this.sessionService.standings(
          boundSessionId ?? inputValue(interaction, "session-id"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "create-scrim": {
        const slots = this.parseSlots(inputValue(interaction, "slots"));
        const content = await this.sessionService.createScrim(
          interaction.user.id,
          inputValue(interaction, "name"),
          slots,
          interaction.guild,
        );
        this.rememberActiveSession(interaction, content);
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "configure-scrim": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const managerLimits = this.parseManagerLimits(
          optionalInputValue(interaction, "manager-limits"),
        );
        const content = await this.sessionService.configureSessionDiscord(
          interaction.guild,
          boundSessionId ?? inputValue(interaction, "session-id"),
          {
            startSlot: this.parseIntegerInput(
              inputValue(interaction, "start-slot"),
              "Start slot",
              { min: 3, max: 100 },
            ),
            normalSlots: this.parseIntegerInput(
              inputValue(interaction, "normal-slots"),
              "Normal slots",
              { min: 1, max: 100 },
            ),
            vipSlots: this.parseIntegerInput(
              optionalInputValue(interaction, "vip-slots"),
              "VIP slots",
              { min: 0, max: 50, required: false },
            ),
            ...managerLimits,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "setup-channels": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const content = await this.sessionService.ensureDiscordScrimSetup(
          interaction.guild,
          boundSessionId ?? inputValue(interaction, "session-id"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "sync-discord": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const setup = await this.sessionService.syncDiscordScrimState(
          interaction.guild,
          boundSessionId ?? inputValue(interaction, "session-id"),
        );
        await interaction.editReply(
          [
            `${CHECK} Discord roles and slot/waitlist messages synced.`,
            "",
            `Slot List: <#${setup.slotListChannelId}>`,
            `Waitlist: <#${setup.waitlistChannelId}>`,
            `IDP: <#${setup.idpChannelId}>`,
          ].join("\n"),
        );
        return;
      }
      case "remove-team": {
        if (
          optionalInputValue(interaction, "confirm-remove").toUpperCase() !==
          "REMOVE"
        ) {
          await interaction.editReply(
            "Team removal cancelled. Type REMOVE to confirm.",
          );
          return;
        }
        const content = await this.sessionService.removeTeamFromScrim(
          boundSessionId ?? inputValue(interaction, "session-id"),
          inputValue(interaction, "tag"),
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "start-scrim": {
        const content = await this.sessionService.startScrim(
          interaction.user.id,
          boundSessionId ?? inputValue(interaction, "session-id"),
          { allowOrganizerOverride: true },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "preview-results": {
        const content = await this.sessionService.previewResults(
          inputValue(interaction, "match-id"),
          inputValue(interaction, "image-url"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "map-slots": {
        const content = await this.sessionService.mapSlotsForResults(
          inputValue(interaction, "match-id"),
          inputValue(interaction, "image-url"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "apply-results": {
        const result = await this.sessionService.applyResults(
          inputValue(interaction, "match-id"),
          inputValue(interaction, "image-url"),
        );
        const files = result.imageFiles?.length
          ? result.imageFiles.map(
              (file) => new AttachmentBuilder(file.buffer, { name: file.name }),
            )
          : result.imageBuffer
            ? [
                new AttachmentBuilder(result.imageBuffer, {
                  name: "result.png",
                }),
              ]
            : [];
        await interaction.editReply({
          content: limitDiscordContent(result.content),
          files,
        });
        return;
      }
    }
  }

  private async postRoomInfo(
    interaction: ModalSubmitInteraction,
    boundSessionId: string | null,
  ) {
    await interaction.deferReply();
    const sessionId = boundSessionId ?? inputValue(interaction, "session-id");
    const roomId = inputValue(interaction, "room-id");
    const password = inputValue(interaction, "password");
    const map = inputValue(interaction, "map");
    const startsAt = inputValue(interaction, "starts-at");

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Arenzyra Room Information")
      .addFields(
        ...(sessionId
          ? [{ name: "Session / Match", value: sessionId, inline: false }]
          : []),
        { name: "Room ID", value: roomId, inline: true },
        { name: "Password", value: password, inline: true },
        ...(map ? [{ name: "Map", value: map, inline: true }] : []),
        ...(startsAt
          ? [{ name: "Start Time", value: startsAt, inline: true }]
          : []),
      )
      .setFooter({ text: "Arenzyra Tournament Operations" })
      .setTimestamp(new Date());

    if (sessionId && interaction.guild) {
      const content = await this.sessionService.postIdpToDiscord(
        interaction.guild,
        sessionId,
        embed,
      );
      await interaction.editReply(content);
      return;
    }

    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }

  private extractDiscordUserIds(value: string): string[] {
    const matches = value.matchAll(/<@!?(\d{15,25})>|\b(\d{15,25})\b/g);
    return [
      ...new Set(
        Array.from(matches)
          .map((match) => match[1] ?? match[2])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  private async resolveMentionedMembers(
    interaction: ModalSubmitInteraction,
    value: string,
  ): Promise<DiscordRegistrationMemberInput[]> {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    const discordUserIds = this.extractDiscordUserIds(trimmed);
    if (discordUserIds.length === 0) {
      throw new Error(
        "Mention managers/players with @name so the bot can read their Discord IDs.",
      );
    }
    if (discordUserIds.length > 10) {
      throw new Error("Add up to 10 manager/player mentions.");
    }

    const members: DiscordRegistrationMemberInput[] = [];
    for (const discordUserId of discordUserIds) {
      const guildMember = interaction.guild
        ? await interaction.guild.members.fetch(discordUserId).catch(() => null)
        : null;
      members.push({
        discordUserId,
        discordUsername: guildMember?.user.username ?? null,
        displayName:
          guildMember?.displayName ?? guildMember?.user.globalName ?? null,
      });
    }
    return members;
  }

  private parseOptionalUrl(value: string, label: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(`${label} must be a valid http or https URL.`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${label} must be a valid http or https URL.`);
    }

    return trimmed;
  }

  private parseSlots(value: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new Error("Slots must be a number from 1 to 100.");
    }
    return parsed;
  }

  private parseIntegerInput(
    value: string,
    label: string,
    opts: { min: number; max: number; required?: boolean },
  ): number | undefined {
    if (!value.trim()) {
      if (opts.required === false) {
        return undefined;
      }
      throw new Error(`${label} is required.`);
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < opts.min || parsed > opts.max) {
      throw new Error(
        `${label} must be a number from ${opts.min} to ${opts.max}.`,
      );
    }
    return parsed;
  }

  private parseManagerLimits(value: string) {
    if (!value.trim()) {
      return {};
    }

    const [managerLimit, teamLimit] = value
      .split(/[\/,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    return {
      maxManagersPerTeam: this.parseIntegerInput(
        managerLimit ?? "",
        "Max managers",
        {
          min: 1,
          max: 10,
        },
      ),
      maxTeamsPerManager: this.parseIntegerInput(
        teamLimit ?? "",
        "Max teams per manager",
        {
          min: 1,
          max: 10,
        },
      ),
    };
  }

  private rememberActiveSession(
    interaction: ModalSubmitInteraction,
    content: string,
  ) {
    const guildId = interaction.guildId;
    const match = /^ID:\s*(\S+)/m.exec(content);
    if (guildId && match?.[1]) {
      this.activeSessionByGuildId.set(guildId, match[1]);
    }
  }

  private parseEventDate(value: string | null | undefined): Date | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private async resolveSessionContextForInteraction(
    interaction: PanelInteraction,
    submittedSessionId: string | null | undefined,
  ): Promise<ResolvedSessionContext | null> {
    const sessionId = submittedSessionId?.trim();
    if (sessionId) {
      const context = await this.sessionService.getSessionContext(sessionId);
      if (interaction.guildId) {
        this.activeSessionByGuildId.set(interaction.guildId, context.session.id);
      }
      return context;
    }

    if (interaction.guild && interaction.channelId) {
      const resolved = await this.sessionService
        .findScrimForDiscordChannel(interaction.guild.id, interaction.channelId)
        .catch(() => null);
      if (resolved) {
        this.activeSessionByGuildId.set(
          interaction.guild.id,
          resolved.session.id,
        );
        return { session: resolved.session, config: resolved.config };
      }
    }

    if (interaction.guildId) {
      const activeSessionId = this.activeSessionByGuildId.get(
        interaction.guildId,
      );
      if (activeSessionId) {
        return this.sessionService.getSessionContext(activeSessionId);
      }
    }

    if (interaction.guildId) {
      const latestGuildScrim = await this.sessionService.findLatestGuildScrim(
        interaction.guildId,
      );
      if (latestGuildScrim) {
        this.activeSessionByGuildId.set(
          interaction.guildId,
          latestGuildScrim.session.id,
        );
        return latestGuildScrim;
      }
    }

    const latestScrim = await this.sessionService.findLatestAcceptingScrim();
    if (!latestScrim) {
      return null;
    }
    if (interaction.guildId) {
      this.activeSessionByGuildId.set(interaction.guildId, latestScrim.id);
    }
    return this.sessionService.getSessionContext(latestScrim.id);
  }

  private async resolveSessionId(
    interaction: ModalSubmitInteraction,
    submittedSessionId: string,
  ): Promise<string | null> {
    if (submittedSessionId) {
      return submittedSessionId;
    }
    if (interaction.guildId) {
      const activeSessionId = this.activeSessionByGuildId.get(
        interaction.guildId,
      );
      if (activeSessionId) {
        return activeSessionId;
      }
    }

    const latestScrim = await this.sessionService.findLatestAcceptingScrim();
    if (latestScrim && interaction.guildId) {
      this.activeSessionByGuildId.set(interaction.guildId, latestScrim.id);
    }

    return latestScrim?.id ?? null;
  }

  private async canUseStaffControls(
    interaction: PanelInteraction,
    sessionId?: string | null,
  ) {
    if (!interaction.inGuild()) {
      return false;
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id);
    if (this.isStaffMember(member)) {
      return true;
    }

    const resolvedSessionId =
      sessionId ?? this.activeSessionByGuildId.get(interaction.guildId) ?? null;
    return this.sessionService.userHasStaffAccess(
      interaction.user.id,
      interaction.guild,
      resolvedSessionId,
    );
  }

  private isStaffMember(member: GuildMember) {
    if (
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      return true;
    }

    return STAFF_ROLE_NAMES.some((roleName) =>
      member.roles.cache.some((role) => role.name === roleName),
    );
  }
}
